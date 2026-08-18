import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/// Each test needs its own TRUST_PROXY value baked into a freshly-built
/// app, but config/env.ts (and therefore src/app.ts) reads process.env
/// once at import time and caches the result on the module. A dynamic
/// import after vi.resetModules() re-evaluates that module against
/// whatever TRUST_PROXY is set to at the time, which is the only way to
/// exercise both settings within one process. Vitest isolates the module
/// registry per test file, so this does not leak into other files.
describe('TRUST_PROXY controls what req.ip is derived from', () => {
  const forgedForwardedFor = '203.0.113.7';

  beforeEach(() => {
    vi.resetModules();
    delete process.env.TRUST_PROXY;
  });

  afterAll(() => {
    delete process.env.TRUST_PROXY;
    vi.resetModules();
  });

  it('uses the socket address and ignores X-Forwarded-For when inactive (default)', async () => {
    // TRUST_PROXY left unset -> env.ts defaults it to 0, i.e. trust nothing.
    const { createApp } = await import('../../src/app');
    const app = createApp();

    const res = await request(app).get('/__test/ip').set('X-Forwarded-For', forgedForwardedFor);

    expect(res.status).toBe(200);
    // Proves the header is not trusted: whatever req.ip resolved to, it is
    // not the client-supplied value, which anyone could set to anything.
    expect(res.body.ip).not.toBe(forgedForwardedFor);
    expect(typeof res.body.ip).toBe('string');
    expect(res.body.ip.length).toBeGreaterThan(0);
  });

  it('reads the forwarded client address once a trusted hop is declared', async () => {
    process.env.TRUST_PROXY = '1';
    const { createApp } = await import('../../src/app');
    const app = createApp();

    const res = await request(app).get('/__test/ip').set('X-Forwarded-For', forgedForwardedFor);

    expect(res.status).toBe(200);
    // Proves the opposite: with exactly one trusted proxy hop declared,
    // Express reads the client address the (trusted) proxy reported
    // instead of the socket address, which is what lets the rate limiter
    // key on distinct clients again.
    expect(res.body.ip).toBe(forgedForwardedFor);
  });

  it('does not let a client behind an untrusted extra hop spoof the trusted one', async () => {
    process.env.TRUST_PROXY = '1';
    const { createApp } = await import('../../src/app');
    const app = createApp();

    // Two-entry XFF: [client-forged, real-proxy]. With one trusted hop,
    // Express must read the entry nearest the trusted proxy (the right-most
    // one) - i.e. what the proxy itself appended - not the left-most entry
    // a malicious client could have prepended.
    const res = await request(app)
      .get('/__test/ip')
      .set('X-Forwarded-For', `${forgedForwardedFor}, 198.51.100.9`);

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('198.51.100.9');
  });
});
