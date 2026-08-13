import { defineConfig } from 'vitest/config';

/// Integration suite: boots the real Express app against a real Postgres
/// (TEST_DATABASE_URL) via supertest. Runs test files sequentially - they
/// share one database that gets truncated between tests, so parallel files
/// would stomp on each other.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/env.ts', 'tests/integration/global-hooks.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
