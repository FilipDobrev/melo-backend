import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../config/env', () => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('../../lib/audit', () => ({
  recordAuditEvent: vi.fn(),
}));

import { errorHandler } from '../error';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { recordAuditEvent } from '../../lib/audit';

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    id: 'req-123',
    path: '/api/v1/posts/abc',
    method: 'PATCH',
    userId: undefined,
    ...overrides,
  } as unknown as Request;
}

describe('errorHandler audit logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits an authorization.denied audit event for a 403, with no email/token in the payload', () => {
    const req = makeReq({ userId: 'user-1' });
    const res = makeRes();

    errorHandler(new ForbiddenError(), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authorization.denied',
        actorId: 'user-1',
        requestId: 'req-123',
        outcome: 'failure',
      }),
    );
    const payload = JSON.stringify(vi.mocked(recordAuditEvent).mock.calls[0]?.[0]);
    expect(payload).not.toMatch(/@/); // no email address
    expect(payload).not.toContain('Bearer');
  });

  it('records a null actorId when the 403 originates from an anonymous-shaped request', () => {
    const req = makeReq({ userId: undefined });
    const res = makeRes();

    errorHandler(new ForbiddenError(), req, res, vi.fn());

    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });

  it('does not emit an audit event for a non-403 error', () => {
    const req = makeReq({ userId: 'user-1' });
    const res = makeRes();

    errorHandler(new NotFoundError(), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
