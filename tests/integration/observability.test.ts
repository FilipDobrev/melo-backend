import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './helpers/testApp';
import { NONEXISTENT_UUID } from './helpers/factories';
import { prisma } from '../../src/lib/prisma';

describe('request id correlation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets X-Request-Id on every response, including 4xx, but only puts it in the body on 5xx', async () => {
    const res = await request(app).get(`/api/v1/products/${NONEXISTENT_UUID}`);

    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.body.error.requestId).toBeUndefined();
  });

  it('includes the same request id in the 5xx body and the response header', async () => {
    // Force a genuine unhandled failure through the real route -> service ->
    // repository -> errorHandler path, the same way a real outage would.
    vi.spyOn(prisma.product, 'findMany').mockRejectedValueOnce(new Error('unexpected db failure'));

    const res = await request(app).get('/api/v1/products');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });
});
