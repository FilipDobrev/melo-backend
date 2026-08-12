import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../lib/errors';
import { verifyAccessToken } from '../services/token.service';

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/// Middleware runs before validate(), so body and query are still raw here.
/// It deals in plain Express requests and only writes `userId`.
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

/// Attaches the user when a valid token is present, but never rejects.
/// Used by public reads that personalise output, e.g. viewer reactions.
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
