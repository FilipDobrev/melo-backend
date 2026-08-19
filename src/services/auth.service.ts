import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { prisma, type Db } from '../lib/prisma';
import { logger } from '../lib/logger';
import { recordAuditEvent } from '../lib/audit';
import { ConflictError, UnauthenticatedError } from '../lib/errors';
import * as userRepository from '../repositories/user.repository';
import * as refreshTokenRepository from '../repositories/refreshToken.repository';
import { isReservedUsername } from './accountPurge.service';
import * as loginLockoutService from './loginLockout.service';
import { signAccessToken, issueRefreshToken, hashRefreshToken } from './token.service';
import { toMeUser, type MeUser } from './user.service';
import type { LoginInput, RegisterInput } from '../dto/auth.dto';

export interface AuthResult {
  user: MeUser;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Signs a new access token and persists a new refresh token for the user.
 * @param db Lets the caller run this inside its own transaction (e.g. refresh's revoke+reissue).
 */
async function issueTokensFor(userId: string, db: Db = prisma): Promise<RefreshResult> {
  const accessToken = signAccessToken(userId);
  const issued = issueRefreshToken();
  await refreshTokenRepository.create(
    { userId, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt },
    db,
  );
  return { accessToken, refreshToken: issued.token };
}

/**
 * Creates a new account and immediately logs it in.
 * @throws {ConflictError} if the email or username is already taken.
 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  // Reserved for the account purge's tombstone user (see
  // accountPurge.service.ts) - rejected with the same message an ordinary
  // taken username gets, so this doesn't advertise that the name is special.
  if (isReservedUsername(input.username)) throw new ConflictError('Username is already taken');

  const [existingEmail, existingUsername] = await Promise.all([
    userRepository.findByEmail(input.email),
    userRepository.findByUsername(input.username),
  ]);
  if (existingEmail) throw new ConflictError('Email is already in use');
  if (existingUsername) throw new ConflictError('Username is already taken');

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await userRepository.create({
    username: input.username,
    email: input.email,
    passwordHash,
  });

  const tokens = await issueTokensFor(user.id);
  return { user: toMeUser(user), ...tokens };
}

/**
 * @param requestId pino-http's request id, threaded through so the emitted audit event joins the
 * originating HTTP request's log line. Optional because this is also unit-testable in isolation.
 * @throws {UnauthenticatedError} if the email is unknown, the account is locked out (see
 * loginLockout.service.ts), or the password does not match. The same error and message are used
 * for all three cases so a caller cannot enumerate registered emails, or distinguish a wrong
 * password from a locked account.
 */
export async function login(input: LoginInput, requestId?: string): Promise<AuthResult> {
  const invalidCredentialsError = new UnauthenticatedError('Invalid email or password');

  const user = await userRepository.findByEmail(input.email);
  if (!user) {
    recordAuditEvent({ action: 'auth.login.failure', actorId: null, requestId, outcome: 'failure' });
    throw invalidCredentialsError;
  }

  // Checked before touching the password at all: a locked account must
  // respond exactly like a wrong password, including not paying bcrypt's
  // cost on every hammering attempt once it is already locked.
  if (loginLockoutService.isLocked(user.id)) {
    recordAuditEvent({
      action: 'auth.login.locked_out',
      actorId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      requestId,
      outcome: 'failure',
    });
    throw invalidCredentialsError;
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    const { justLocked } = loginLockoutService.recordFailure(user.id);
    recordAuditEvent({
      action: justLocked ? 'auth.login.locked_out' : 'auth.login.failure',
      actorId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      requestId,
      outcome: 'failure',
    });
    throw invalidCredentialsError;
  }

  loginLockoutService.recordSuccess(user.id);
  const tokens = await issueTokensFor(user.id);
  recordAuditEvent({
    action: 'auth.login.success',
    actorId: user.id,
    resourceType: 'user',
    resourceId: user.id,
    requestId,
    outcome: 'success',
  });
  return { user: toMeUser(user), ...tokens };
}

/**
 * Rotates a refresh token: revokes the presented one and issues a fresh pair.
 * @throws {UnauthenticatedError} if the token is unknown, expired, or already revoked. A revoked
 * token being presented again means it leaked and was replayed - not an ordinary expiry - so this
 * also revokes every other active session for the user, forcing both the attacker and the
 * legitimate user to log in again.
 */
export async function refresh(refreshToken: string, requestId?: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

  const invalidTokenError = new UnauthenticatedError('Invalid or expired refresh token');
  if (!existing) {
    throw invalidTokenError;
  }

  if (existing.revokedAt) {
    await refreshTokenRepository.revokeAllActiveForUser(existing.userId);
    logger.warn({ userId: existing.userId }, 'refresh token reuse detected; revoked all active sessions');
    recordAuditEvent({
      action: 'auth.refresh.reuse_detected',
      actorId: existing.userId,
      resourceType: 'user',
      resourceId: existing.userId,
      requestId,
      outcome: 'failure',
    });
    throw invalidTokenError;
  }

  if (existing.expiresAt < new Date()) {
    throw invalidTokenError;
  }

  const result = await prisma.$transaction(async (tx) => {
    await refreshTokenRepository.revoke(existing.id, tx);
    return issueTokensFor(existing.userId, tx);
  });
  recordAuditEvent({
    action: 'auth.refresh.success',
    actorId: existing.userId,
    resourceType: 'user',
    resourceId: existing.userId,
    requestId,
    outcome: 'success',
  });
  return result;
}

/**
 * Idempotent and does not reveal whether the token exists: a missing token, a token belonging to
 * another user, or an already-revoked token are all silent no-ops.
 */
export async function logout(userId: string, refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

  if (!existing || existing.userId !== userId || existing.revokedAt) return;

  await refreshTokenRepository.revoke(existing.id);
}
