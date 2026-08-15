import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../lib/errors';
import { verifyAccessToken } from '../services/token.service';

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Rejects the request unless it carries a valid Bearer access token; sets
 * `req.userId` when it does. Runs before `validate()`, so body and query are
 * still raw here - it deals in plain Express requests and only writes
 * `userId`. Use via {@link authed} rather than mounting directly.
 *
 * @throws {UnauthenticatedError} when the token is missing, malformed, or invalid/expired.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    next(new UnauthenticatedError());
    return;
  }
  try {
    req.userId = verifyAccessToken(token).sub;
    next();
  } catch {
    next(new UnauthenticatedError('Invalid or expired access token'));
  }
}

/**
 * Attaches `req.userId` when a valid token is present, but never rejects.
 * Used by public reads that personalise output, e.g. viewer reactions.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    next();
    return;
  }
  try {
    req.userId = verifyAccessToken(token).sub;
  } catch {
    // An invalid token on a public route is treated as anonymous.
  }
  next();
}
