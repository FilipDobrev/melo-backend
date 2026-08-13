import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { prisma, type Db } from '../lib/prisma';
import { logger } from '../lib/logger';
import { ConflictError, UnauthenticatedError } from '../lib/errors';
import * as userRepository from '../repositories/user.repository';
import * as refreshTokenRepository from '../repositories/refreshToken.repository';
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

async function issueTokensFor(userId: string, db: Db = prisma): Promise<RefreshResult> {
  const accessToken = signAccessToken(userId);
  const issued = issueRefreshToken();
  await refreshTokenRepository.create(
    { userId, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt },
    db,
  );
  return { accessToken, refreshToken: issued.token };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
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

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await userRepository.findByEmail(input.email);
  const invalidCredentialsError = new UnauthenticatedError('Invalid email or password');
  if (!user) throw invalidCredentialsError;

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) throw invalidCredentialsError;

  const tokens = await issueTokensFor(user.id);
  return { user: toMeUser(user), ...tokens };
}

export async function refresh(refreshToken: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

  const invalidTokenError = new UnauthenticatedError('Invalid or expired refresh token');
  if (!existing) {
    throw invalidTokenError;
  }

  // A revoked token being presented again is not an ordinary error: tokens
  // are only ever revoked by a prior refresh or a logout, so this token must
  // have leaked and been replayed. Kill the whole session family so both the
  // attacker and the legitimate user are forced to log in again. An expired
  // (but never revoked) token carries no such signal - it is just a stale
  // token - so it is rejected the ordinary way.
  if (existing.revokedAt) {
    await refreshTokenRepository.revokeAllActiveForUser(existing.userId);
    logger.warn({ userId: existing.userId }, 'refresh token reuse detected; revoked all active sessions');
    throw invalidTokenError;
  }

  if (existing.expiresAt < new Date()) {
    throw invalidTokenError;
  }

  return prisma.$transaction(async (tx) => {
    await refreshTokenRepository.revoke(existing.id, tx);
    return issueTokensFor(existing.userId, tx);
  });
}

export async function logout(userId: string, refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

  // Idempotent and does not reveal whether the token exists: a missing
  // token, a foreign token, or an already-revoked token are all no-ops.
  if (!existing || existing.userId !== userId || existing.revokedAt) return;

  await refreshTokenRepository.revoke(existing.id);
}
