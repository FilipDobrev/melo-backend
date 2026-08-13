import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './helpers/testApp';
import { prisma } from '../../src/lib/prisma';

describe('GET /health', () => {
  it('reports ok without touching the database', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when the database is reachable', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports 503 when the database query fails', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', message: 'Database unreachable' });
  });
});
