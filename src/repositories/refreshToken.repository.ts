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

export function revoke(id: string, db: Db = prisma): Promise<RefreshToken> {
  return db.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}
