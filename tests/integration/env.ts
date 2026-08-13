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
