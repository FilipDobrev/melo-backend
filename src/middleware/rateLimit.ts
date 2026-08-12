import rateLimit from 'express-rate-limit';

/// Throttles credential-guessing and account-enumeration attempts against
/// login/register. Not applied elsewhere.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later' },
    });
  },
});
