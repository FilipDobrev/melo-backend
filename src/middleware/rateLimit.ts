import type { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/// Shared 429 body so every limiter matches the API's documented error
/// envelope (see API.md) instead of express-rate-limit's default shape.
function tooManyRequests(_req: unknown, res: Response): void {
  res.status(429).json({
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
  });
}

/// Throttles credential-guessing and account-enumeration attempts against
/// login/register. Not applied elsewhere.
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

/// Backstop across the whole API. Set well above anything a normal client
/// (or the integration suite, ~80 requests total across one shared process)
/// would ever hit - this exists to blunt scripted abuse, not to shape
/// legitimate traffic. Module-level constant rather than an env var: this is
/// a fixed safety ceiling, not something that should vary by deployment.
const GENERAL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const GENERAL_RATE_LIMIT_MAX = 300;

export const generalApiLimiter = rateLimit({
  windowMs: GENERAL_RATE_LIMIT_WINDOW_MS,
  limit: GENERAL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

/// Presigned upload URLs mint temporary write access to object storage, so
/// this is deliberately far tighter than the general limiter - a caller
/// legitimately uploading images does so a handful of times per minute, not
/// dozens. The integration suite mints ~22 of these across its whole run
/// (shared limiter store, since vitest runs the suite in one process), so
/// this still clears that with headroom.
const UPLOAD_URL_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_URL_RATE_LIMIT_MAX = 30;

export const uploadUrlRateLimiter = rateLimit({
  windowMs: UPLOAD_URL_RATE_LIMIT_WINDOW_MS,
  limit: UPLOAD_URL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});
