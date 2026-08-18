import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefreshToken, User } from '@prisma/client';

// Bypasses env.ts's runtime validation, which requires DATABASE_URL, JWT
// secrets, and S3 config that are not present in the test process.
vi.mock('../../config/env', () => ({
  env: { BCRYPT_ROUNDS: 4, LOGIN_LOCKOUT_THRESHOLD: 10, LOGIN_LOCKOUT_DURATION_MINUTES: 15 },
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));

vi.mock('../../repositories/user.repository');
vi.mock('../../repositories/refreshToken.repository');

// Real recordAuditEvent runs through pino, which is silent at this level of
// mocking (env.NODE_ENV is undefined here, not 'test') - spied on instead of
// mocked so individual tests can assert on the exact shape emitted, per the
// "no token or email in the payload" requirement in loginLockout's spec.
vi.mock('../../lib/audit', () => ({
  recordAuditEvent: vi.fn(),
}));

// The lockout counter is a module-level in-memory Map, so leaving it
// unmocked would let failures recorded by one test (all sharing 'user-1')
// leak into the next. Mocked here; lockout mechanics themselves are covered
// by loginLockout.service.test.ts.
vi.mock('../loginLockout.service', () => ({
  isLocked: vi.fn(() => false),
  recordFailure: vi.fn(() => ({ justLocked: false })),
  recordSuccess: vi.fn(),
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(async () => false),
  },
}));

vi.mock('../token.service', () => ({
  signAccessToken: vi.fn(() => 'signed-access-token'),
  issueRefreshToken: vi.fn(() => ({
    token: 'plain-refresh-token',
    tokenHash: 'hashed-refresh-token',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  })),
  hashRefreshToken: vi.fn((token: string) => `hash(${token})`),
}));

import bcrypt from 'bcrypt';
import * as authService from '../auth.service';
import * as userRepository from '../../repositories/user.repository';
import * as refreshTokenRepository from '../../repositories/refreshToken.repository';
import * as loginLockoutService from '../loginLockout.service';
import { recordAuditEvent } from '../../lib/audit';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'stored-hash',
    profileImage: null,
    deletionRequestedAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRefreshToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: 'hash(some-token)',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    revokedAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('auth.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not an implementation set by a
    // prior test's mockReturnValue - restored explicitly so tests stay
    // independent regardless of order.
    vi.mocked(loginLockoutService.isLocked).mockReturnValue(false);
    vi.mocked(loginLockoutService.recordFailure).mockReturnValue({ justLocked: false });
  });

  describe('register', () => {
    it('throws a 409 conflict when the email is already taken', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(userRepository.findByUsername).mockResolvedValue(null);

      await expect(
        authService.register({ username: 'bob', email: 'alice@example.com', password: 'password1' }),
      ).rejects.toMatchObject({ status: 409 });

      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('throws a 409 conflict when the username is already taken', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
      vi.mocked(userRepository.findByUsername).mockResolvedValue(makeUser());

      await expect(
        authService.register({ username: 'alice', email: 'new@example.com', password: 'password1' }),
      ).rejects.toMatchObject({ status: 409 });

      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('hashes the password and returns the user with tokens on success', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
      vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
      vi.mocked(userRepository.create).mockResolvedValue(makeUser());
      vi.mocked(refreshTokenRepository.create).mockResolvedValue(makeRefreshToken());

      const result = await authService.register({
        username: 'alice',
        email: 'alice@example.com',
        password: 'password1',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password1', expect.any(Number));
      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toBe('plain-refresh-token');
      expect(result.user).toEqual({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        profileImage: null,
        createdAt: makeUser().createdAt,
        deletionRequestedAt: null,
        purgeAt: null,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('login', () => {
    it('rejects with a generic error when the email does not exist', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'password1' }),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
    });

    it('rejects with the same generic error when the password is wrong', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        authService.login({ email: 'alice@example.com', password: 'wrong-password' }),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
    });

    it('returns user and tokens on valid credentials', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(refreshTokenRepository.create).mockResolvedValue(makeRefreshToken());

      const result = await authService.login({ email: 'alice@example.com', password: 'password1' });

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toBe('plain-refresh-token');
      expect(result.user.id).toBe('user-1');
      expect(loginLockoutService.recordSuccess).toHaveBeenCalledWith('user-1');
    });

    it('rejects a locked-out account with the identical generic error, without checking the password', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(loginLockoutService.isLocked).mockReturnValue(true);

      await expect(
        authService.login({ email: 'alice@example.com', password: 'password1' }),
      ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: 'Invalid email or password' });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('records a failed attempt against the account on a wrong password', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(authService.login({ email: 'alice@example.com', password: 'wrong' })).rejects.toThrow();

      expect(loginLockoutService.recordFailure).toHaveBeenCalledWith('user-1');
    });

    it('emits an audit event on failure that carries no email, password, or token', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        authService.login({ email: 'alice@example.com', password: 'wrong-password' }),
      ).rejects.toThrow();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login.failure', actorId: 'user-1', outcome: 'failure' }),
      );
      const payload = JSON.stringify(vi.mocked(recordAuditEvent).mock.calls[0]?.[0]);
      expect(payload).not.toContain('alice@example.com');
      expect(payload).not.toContain('wrong-password');
      expect(payload).not.toContain('stored-hash');
    });

    it('logs a distinct locked_out action, not a generic failure, on the attempt that crosses the threshold', async () => {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      vi.mocked(loginLockoutService.recordFailure).mockReturnValue({ justLocked: true });

      await expect(authService.login({ email: 'alice@example.com', password: 'wrong' })).rejects.toThrow();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login.locked_out', actorId: 'user-1' }),
      );
    });
  });

  describe('refresh', () => {
    it('rejects when no matching token exists', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(null);

      await expect(authService.refresh('missing-token')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects reuse of a revoked token and revokes the whole session family', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(
        makeRefreshToken({ revokedAt: new Date() }),
      );

      await expect(authService.refresh('revoked-token')).rejects.toMatchObject({ status: 401 });
      expect(refreshTokenRepository.revokeAllActiveForUser).toHaveBeenCalledWith('user-1');
    });

    it('rejects an expired-but-never-revoked token without touching other sessions', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(
        makeRefreshToken({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
      );

      await expect(authService.refresh('expired-token')).rejects.toMatchObject({ status: 401 });
      expect(refreshTokenRepository.revokeAllActiveForUser).not.toHaveBeenCalled();
    });

    it('revokes the old token and issues a new one on success', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(makeRefreshToken());
      vi.mocked(refreshTokenRepository.revoke).mockResolvedValue(makeRefreshToken({ revokedAt: new Date() }));
      vi.mocked(refreshTokenRepository.create).mockResolvedValue(makeRefreshToken());

      const result = await authService.refresh('valid-token');

      expect(refreshTokenRepository.revoke).toHaveBeenCalledWith('token-1', expect.anything());
      expect(refreshTokenRepository.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toBe('plain-refresh-token');
    });
  });

  describe('logout', () => {
    it('revokes the token when it belongs to the caller', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(makeRefreshToken());

      await authService.logout('user-1', 'valid-token');

      expect(refreshTokenRepository.revoke).toHaveBeenCalledWith('token-1');
    });

    it('does nothing when the token belongs to a different user', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(
        makeRefreshToken({ userId: 'someone-else' }),
      );

      await authService.logout('user-1', 'valid-token');

      expect(refreshTokenRepository.revoke).not.toHaveBeenCalled();
    });

    it('does nothing when the token does not exist', async () => {
      vi.mocked(refreshTokenRepository.findByTokenHash).mockResolvedValue(null);

      await authService.logout('user-1', 'missing-token');

      expect(refreshTokenRepository.revoke).not.toHaveBeenCalled();
    });
  });
});
