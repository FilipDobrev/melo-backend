import path from 'node:path';

/// This file must have no other imports. ES module imports are hoisted
/// above the rest of a module's top-level code, so if this file imported
/// anything that itself reads process.env (e.g. src/lib/prisma via
/// src/config/env), that read would run before the env mutation below and
/// would see the wrong DATABASE_URL. Keeping the mutation in its own
/// import-free setup file, listed before global-hooks.ts in
/// vitest.integration.config.ts's setupFiles, guarantees ordering instead.
process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env'));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Add it to .env (see .env.example) before running the integration suite.',
  );
}

// Point the app at the test database for the remainder of this process.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';

/// The integration suite makes many requests from a single IP (localhost)
/// in rapid succession, far exceeding production rate limits. We deliberately
/// raise the ceilings here to 50-100x production values so the limiter never
/// blocks test requests. This is NOT disabling the limiter: it still enforces
/// the configured ceilings, and the suite exercises the limiter's basic
/// mechanics (window tracking, per-IP isolation). A future developer adding a
/// new integration test should confirm it does not accidentally trigger the
/// production values; if it does, the test has a real problem or the limit is
/// unreasonably tight. The production defaults (10 uploads/5min, 300
/// general/min, 10 auth/15min) are exercised by manual testing of the real app
/// against real load, not by the integration suite.
process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.GENERAL_RATE_LIMIT_MAX = '10000';
process.env.UPLOAD_URL_RATE_LIMIT_MAX = '5000';
process.env.EXPORT_RATE_LIMIT_MAX = '5000';
