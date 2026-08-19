import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/// config/env.ts reads process.env once at import time and caches the
/// result on the module, so exercising the production guard on
/// CORS_ORIGINS requires a fresh import after vi.resetModules(), the same
/// pattern trustProxy.test.ts and transportSecurity.test.ts use. Vitest
/// isolates the module registry per test file, so this does not leak into
/// other files.
describe('CORS_ORIGINS production guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGINS = originalCorsOrigins;
    vi.resetModules();
  });

  it('refuses to boot with NODE_ENV=production and CORS_ORIGINS left at "*"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '*';

    await expect(import('../../src/config/env')).rejects.toThrow(/CORS_ORIGINS/);
  });

  it('boots fine in production once CORS_ORIGINS is set to a real origin list', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const { env } = await import('../../src/config/env');
    expect(env.CORS_ORIGINS).toBe('https://app.example.com');
  });

  it('still allows "*" outside production', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = '*';

    const { env } = await import('../../src/config/env');
    expect(env.CORS_ORIGINS).toBe('*');
  });
});
