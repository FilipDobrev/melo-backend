import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './helpers/testApp';

describe('helmet headers', () => {
  it('sends HSTS with the configured max-age and no includeSubDomains/preload', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('sends X-Content-Type-Options: nosniff on the static preset image route', async () => {
    // Any path under the mount exercises the same helmet middleware chain
    // that runs ahead of express.static, regardless of whether that
    // specific file exists on disk.
    const res = await request(app).get('/static/recipe-presets/does-not-exist.jpg');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows cross-origin loading of the static preset images', async () => {
    const res = await request(app).get('/static/recipe-presets/does-not-exist.jpg');

    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('does not advertise Express via X-Powered-By', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('JSON content-type discipline', () => {
  it('rejects a JSON-looking body sent with the wrong Content-Type instead of misparsing it', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email: 'a@b.com', password: 'Password123!' }));

    // express.json() only parses application/json, so req.body is never
    // populated from this request - validate() then rejects the (empty)
    // body with a normal 422, rather than a route reading attacker-shaped
    // data as if it had been validated.
    expect(res.status).toBe(422);
  });

  it('always returns an explicit JSON content type, including on errors', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });
});

/// Module-reset pattern matches tests/integration/trustProxy.test.ts: the
/// HTTPS redirect only activates when env.NODE_ENV === 'production', so a
/// fresh app has to be built after NODE_ENV is temporarily forced to
/// 'production'.
describe('force HTTPS in production', () => {
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  beforeEach(() => {
    vi.resetModules();
    // env.ts refuses to boot with NODE_ENV=production and CORS_ORIGINS left
    // at "*" (see cors.test.ts) - give it a concrete value here so this
    // suite's use of NODE_ENV=production to exercise the HTTPS redirect
    // doesn't trip that unrelated guard.
    process.env.CORS_ORIGINS = 'https://app.example.com';
  });

  afterAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = originalCorsOrigins;
    vi.resetModules();
  });

  it('redirects a plain-HTTP request to HTTPS', async () => {
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../../src/app');
    const prodApp = createApp();

    const res = await request(prodApp).get('/api/v1/does-not-exist').set('Host', 'api.example.com');

    expect(res.status).toBe(308);
    expect(res.headers.location).toBe('https://api.example.com/api/v1/does-not-exist');
  });

  it('does not redirect /health, so plain-HTTP orchestrator probes still work', async () => {
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../../src/app');
    const prodApp = createApp();

    const res = await request(prodApp).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not redirect outside production', async () => {
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/app');
    const testApp = createApp();

    const res = await request(testApp).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
  });
});
