import { defineConfig } from 'vitest/config';

/// Fast unit tests only: pure functions under src/**/__tests__, no database,
/// no HTTP. The integration suite lives in tests/integration and runs via
/// `npm run test:integration` with its own config (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
