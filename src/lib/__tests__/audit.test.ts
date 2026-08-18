import { describe, expect, it, vi } from 'vitest';

// Keeps the real pino logger silent (its level ternary checks NODE_ENV
// against the literal string 'test'), so this test does not spam stdout.
vi.mock('../../config/env', () => ({
  env: { NODE_ENV: 'test' },
}));

import { logger } from '../logger';
import { recordAuditEvent } from '../audit';

describe('recordAuditEvent', () => {
  it('emits a structured line tagged audit:true with the given fields', () => {
    const spy = vi.spyOn(logger, 'info');

    recordAuditEvent({
      action: 'auth.login.success',
      actorId: 'user-1',
      resourceType: 'user',
      resourceId: 'user-1',
      requestId: 'req-1',
      outcome: 'success',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: true,
        action: 'auth.login.success',
        actorId: 'user-1',
        resourceType: 'user',
        resourceId: 'user-1',
        requestId: 'req-1',
        outcome: 'success',
      }),
      'audit: auth.login.success',
    );
  });

  it('accepts a null actorId for an anonymous/unknown caller', () => {
    const spy = vi.spyOn(logger, 'info');

    recordAuditEvent({ action: 'auth.login.failure', actorId: null, outcome: 'failure' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ audit: true, actorId: null, outcome: 'failure' }),
      expect.any(String),
    );
  });

  it('never throws, even if the underlying logger does', () => {
    vi.spyOn(logger, 'info').mockImplementationOnce(() => {
      throw new Error('logger transport exploded');
    });

    expect(() =>
      recordAuditEvent({ action: 'authorization.denied', actorId: 'user-1', outcome: 'failure' }),
    ).not.toThrow();
  });
});
