import type { RefreshToken } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export function create(data: CreateRefreshTokenData, db: Db = prisma): Promise<RefreshToken> {
  return db.refreshToken.create({ data });
}

export function findByTokenHash(tokenHash: string, db: Db = prisma): Promise<RefreshToken | null> {
  return db.refreshToken.findUnique({ where: { tokenHash } });
}

/** Marks a token used/invalid. A missing `id` raises P2025, which the error
 * middleware maps to 404 - callers rely on this instead of pre-checking existence. */
export function revoke(id: string, db: Db = prisma): Promise<RefreshToken> {
  return db.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

/**
 * Revokes every still-active (not yet revoked, not yet expired) refresh
 * token for a user. Used for reuse-detection: a replayed refresh token
 * means the token family may be compromised, so the whole family is killed
 * rather than just the one presented token.
 */
export function revokeAllActiveForUser(userId: string, db: Db = prisma): Promise<{ count: number }> {
  return db.refreshToken.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
}

/**
 * Deletes rows that no longer serve any purpose: expired tokens, and
 * revoked tokens past the grace period (see scripts/prune-refresh-tokens.ts
 * for why the grace period exists). Returns the number of rows removed.
 */
export function deleteStale(revokedGraceMs: number, db: Db = prisma): Promise<{ count: number }> {
  const graceCutoff = new Date(Date.now() - revokedGraceMs);
  return db.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: graceCutoff } }],
    },
  });
}
