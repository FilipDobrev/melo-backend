import type { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Shared 429 body so every limiter matches the API's documented error
 * envelope (see API.md) instead of express-rate-limit's default shape.
 */
function tooManyRequests(_req: unknown, res: Response): void {
  res.status(429).json({
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
  });
}

/**
 * Throttles credential-guessing and account-enumeration attempts against
 * login/register. Not applied elsewhere.
 */
export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later' },
    });
  },
});

/**
 * Backstop across the whole API. Set well above anything a normal client
 * would ever hit - this exists to blunt scripted abuse, not to shape
 * legitimate traffic.
 */
export const generalApiLimiter = rateLimit({
  windowMs: env.GENERAL_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.GENERAL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

/**
 * Presigned upload URLs mint temporary write access to object storage, so
 * this is deliberately far tighter than the general limiter - a caller
 * legitimately uploading images does so a handful of times per window, not
 * dozens.
 */
export const uploadUrlRateLimiter = rateLimit({
  windowMs: env.UPLOAD_URL_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.UPLOAD_URL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

/**
 * GET /users/me/export walks every table the caller owns rows in, unpaginated,
 * in a single request - the most expensive read this API offers and an
 * obvious lever for hammering the database. A legitimate user exports their
 * own data rarely, so this is deliberately tighter than every other limiter.
 */
export const exportRateLimiter = rateLimit({
  windowMs: env.EXPORT_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.EXPORT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});
