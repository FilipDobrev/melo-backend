import { createApp } from '../../../src/app';

/// One Express app per test file, built after env.ts has pointed
/// DATABASE_URL at the test database (see vitest.integration.config.ts).
export const app = createApp();
