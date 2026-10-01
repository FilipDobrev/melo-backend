import type { Request, Response } from 'express';
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
 * Keys a limiter by the authenticated user. Must be mounted after `requireAuth` (pass it to
 * `authed()` as an after-auth middleware), which is what sets `req.userId`.
 *
 * Per user rather than per IP: behind a carrier NAT one heavy user would lock out everyone
 * sharing the IP, and an attacker could sidestep a per-IP limit just by rotating IPs.
 */
function keyByUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('Per-user rate limiter mounted before requireAuth');
  }
  return req.userId;
}

/**
 * Presigned upload URLs mint temporary write access to object storage, so
 * this is deliberately far tighter than the general limiter. Shared by the
 * post, recipe and avatar upload-url routes, so the budget is per user
 * across all three.
 */
export const uploadUrlRateLimiter = rateLimit({
  windowMs: env.UPLOAD_URL_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.UPLOAD_URL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserId,
  handler: tooManyRequests,
});

/**
 * Second, longer budget on the same upload-url routes. The short window stops bursts; this caps
 * how much one account can push into storage in a day.
 */
export const uploadUrlDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: env.UPLOAD_URL_DAILY_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserId,
  handler: tooManyRequests,
});

/**
 * Writes that attach an uploaded image (create/update post, create/update recipe, update
 * profile) each cost several storage operations - HEAD, ranged GET, copy and delete - so they
 * get their own per-user budget on top of the general limiter.
 */
export const imageAttachRateLimiter = rateLimit({
  windowMs: env.IMAGE_ATTACH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.IMAGE_ATTACH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserId,
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
