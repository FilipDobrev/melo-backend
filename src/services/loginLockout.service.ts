import { env } from '../config/env';

interface LockoutState {
  failureCount: number;
  /** Epoch ms. Null while the account has failures recorded but is not yet locked. */
  lockedUntil: number | null;
}

/**
 * Per-account login lockout: counts consecutive failed login attempts per
 * account and refuses further attempts for a cooling-off period once the
 * configured threshold is crossed. Complements the per-IP limiter on
 * POST /auth/login (src/middleware/rateLimit.ts), which does nothing against
 * a distributed attempt - many IPs, one account - since it keys on IP alone.
 *
 * STORAGE DECISION: a plain in-memory Map, not a new User column and not
 * Redis. This app is deployed as a single small instance today (see the
 * TRUST_PROXY doc in src/config/env.ts for the deployment shape this project
 * targets - one process behind a single reverse proxy), so there is exactly
 * one process holding this counter, and it resets on restart/deploy. That is
 * an acceptable property for a security backstop rather than a correctness
 * requirement: a restart clearing an active lockout just hands an attacker a
 * few more attempts, it does not reopen an account that must stay locked
 * forever. A `User.failedLoginCount` column was rejected: it is a schema
 * migration for a value that is intentionally transient (an active lockout
 * has no reason to survive a backup/restore, and a healthy account clears it
 * back to zero the moment it logs in successfully), and it would add a
 * database write to the hot login path on every single failed attempt.
 *
 * MULTI-INSTANCE CAVEAT: if this app ever runs as more than one instance
 * (horizontally scaled behind a load balancer), this in-memory map stops
 * being a real lockout - each instance holds its own counter, so an attacker
 * spreading attempts across N instances gets roughly N times the effective
 * budget, and a user locked out by instance A can still succeed against
 * instance B. At that point this needs to move to a shared store (e.g.
 * Redis) keyed the same way (by user id), with the same
 * check-then-increment shape swapped for atomic Redis operations (e.g.
 * INCR + EXPIRE) to avoid a race between concurrent requests.
 */
const attempts = new Map<string, LockoutState>();

function now(): number {
  return Date.now();
}

/**
 * True if the account is currently inside its cooling-off period. Lazily
 * expires (and forgets) a lock whose duration has elapsed.
 */
export function isLocked(userId: string): boolean {
  const state = attempts.get(userId);
  if (!state?.lockedUntil) return false;
  if (state.lockedUntil <= now()) {
    attempts.delete(userId);
    return false;
  }
  return true;
}

/**
 * Records a failed login attempt for an account. Once the configured
 * threshold of consecutive failures is reached, the account is locked for
 * LOGIN_LOCKOUT_DURATION_MINUTES and the counter resets.
 * @returns `justLocked: true` only on the call that crosses the threshold,
 * so the caller can log a distinct "just locked" audit event without
 * changing the response it sends - which must stay identical to an ordinary
 * wrong-password response, or a locked account becomes an enumeration oracle.
 */
export function recordFailure(userId: string): { justLocked: boolean } {
  const state = attempts.get(userId) ?? { failureCount: 0, lockedUntil: null };
  state.failureCount += 1;

  if (state.failureCount >= env.LOGIN_LOCKOUT_THRESHOLD) {
    state.lockedUntil = now() + env.LOGIN_LOCKOUT_DURATION_MINUTES * 60 * 1000;
    state.failureCount = 0;
    attempts.set(userId, state);
    return { justLocked: true };
  }

  attempts.set(userId, state);
  return { justLocked: false };
}

/** Clears the counter on a successful login. */
export function recordSuccess(userId: string): void {
  attempts.delete(userId);
}
