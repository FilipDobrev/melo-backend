import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /**
   * What jsonwebtoken's `expiresIn` actually accepts: a plain integer
   * (seconds) or an integer followed by a single unit letter (s/m/h/d).
   * It also accepts vercel/ms-style strings like "2 days", but we don't
   * need that flexibility here and a narrower regex catches typos earlier.
   *
   * Converted to a plain number of seconds below rather than passed through
   * as a string: jsonwebtoken hands string values to the `ms` package,
   * which parses a *bare* numeric string (e.g. "3600") as milliseconds, not
   * seconds - so "3600" would silently produce a 3.6 second token. Doing
   * the unit conversion ourselves avoids that trap, and it means the value
   * is a plain `number`, which matches `SignOptions.expiresIn` without an
   * `as jwt.SignOptions` cast.
   */
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]?$/, 'must be a number of seconds, or a number followed by s/m/h/d')
    .default('15m')
    .transform((value, ctx) => {
      const match = /^(\d+)([smhd]?)$/.exec(value);
      if (!match) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid ACCESS_TOKEN_TTL format' });
        return z.NEVER;
      }
      const amount = Number(match[1]);
      switch (match[2]) {
        case 'm':
          return amount * 60;
        case 'h':
          return amount * 3600;
        case 'd':
          return amount * 86400;
        default:
          return amount;
      }
    }),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Days a soft-deleted account stays recoverable (POST /users/me/restore)
   * before scripts/purge-deleted-users.ts is eligible to purge it for good.
   */
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS: z.coerce.number().int().positive().default(30),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  /**
   * Login/register attempts allowed per IP per window. The default is the
   * production value; raise it locally so repeated test runs are not blocked.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  /**
   * Backstop across the whole API - set well above anything a normal
   * client would ever hit, to blunt scripted abuse rather than shape
   * legitimate traffic.
   */
  GENERAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  GENERAL_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
  /**
   * Presigned upload URLs mint temporary write access to object storage,
   * so this is deliberately far tighter than the general limiter.
   */
  UPLOAD_URL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  UPLOAD_URL_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
  CORS_ORIGINS: z.string().default('*'),

  /**
   * Controls Express's `trust proxy` setting, which decides whether
   * `req.ip` (and therefore every rate limiter, which keys on it) reads the
   * client's real address from `X-Forwarded-For` or the raw socket address.
   *
   * Every real deployment target (Render, Koyeb, Fly, a VPS behind nginx or
   * Caddy) terminates TLS at a reverse proxy in front of this process, so
   * the socket address seen by Node is always the proxy's, not the client's.
   * Left unset, every request appears to come from the same address and
   * shares one rate-limit bucket - ten failed logins from anyone locks out
   * everyone.
   *
   * Accepts:
   *   - a non-negative integer hop count: the number of reverse proxies
   *     between the client and this process. Express then trusts exactly
   *     that many entries from the right of `X-Forwarded-For` (i.e. it reads
   *     the address the *nearest trusted* hop reports, not just the
   *     left-most one, which a client could forge). Use `1` for a single
   *     PaaS-managed proxy (Render, Koyeb, Fly) or a single nginx/Caddy box.
   *   - a comma-separated list of trusted IPs/CIDR ranges (e.g. the proxy's
   *     known LAN address), passed straight through to Express.
   *
   * Deliberately does NOT accept `true`/"trust everything": that trusts
   * `X-Forwarded-For` from any client, letting an attacker forge the header
   * and pick their own rate-limit bucket - the exact vulnerability this
   * setting exists to close.
   *
   * Defaults to `0` (trust nothing, use the socket address), which is
   * correct for local development where requests hit the app directly.
   */
  TRUST_PROXY: z
    .string()
    .default('0')
    .transform((value, ctx) => {
      if (/^\d+$/.test(value)) {
        return Number(value);
      }
      const entries = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (entries.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TRUST_PROXY must be a non-negative integer hop count or a comma-separated list of IPs/CIDR ranges',
        });
        return z.NEVER;
      }
      return entries;
    }),

  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  /**
   * Base URL for preset recipe images. Must be set to the machine's LAN
   * address or public origin for a real device to load preset images.
   */
  API_PUBLIC_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured environment must never boot silently -
  // throwing here at import time stops the process before it can listen.
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

/** Parsed, validated process environment. Import this instead of `process.env`. */
export const env = parsed.data;
/** Type of the validated environment, e.g. for functions that accept a subset of it. */
export type Env = typeof env;
