import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /// What jsonwebtoken's `expiresIn` actually accepts: a plain integer
  /// (seconds) or an integer followed by a single unit letter (s/m/h/d).
  /// It also accepts vercel/ms-style strings like "2 days", but we don't
  /// need that flexibility here and a narrower regex catches typos earlier.
  ///
  /// Converted to a plain number of seconds below rather than passed through
  /// as a string: jsonwebtoken hands string values to the `ms` package,
  /// which parses a *bare* numeric string (e.g. "3600") as milliseconds, not
  /// seconds - so "3600" would silently produce a 3.6 second token. Doing
  /// the unit conversion ourselves avoids that trap, and it means the value
  /// is a plain `number`, which matches `SignOptions.expiresIn` without an
  /// `as jwt.SignOptions` cast.
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

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  /// Login/register attempts allowed per IP per window. The default is the
  /// production value; raise it locally so repeated test runs are not blocked.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  CORS_ORIGINS: z.string().default('*'),

  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  /// Base URL for preset recipe images. Must be set to the machine's LAN
  /// address or public origin for a real device to load preset images.
  API_PUBLIC_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured environment must never boot silently.
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

export const env = parsed.data;
export type Env = typeof env;
