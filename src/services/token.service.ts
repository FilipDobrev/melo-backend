import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

/**
 * @throws {Error} (via jwt.verify, e.g. `TokenExpiredError`/`JsonWebTokenError`) if the token is
 * invalid, expired, or otherwise unverifiable; also thrown directly if the payload is malformed.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { sub: decoded.sub };
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Refresh tokens are opaque random strings. Only their SHA-256 hash is stored, so a database
 * leak does not yield usable tokens.
 */
export function issueRefreshToken(): IssuedRefreshToken {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashRefreshToken(token), expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
