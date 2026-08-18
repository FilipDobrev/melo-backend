import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  env: { LOGIN_LOCKOUT_THRESHOLD: 3, LOGIN_LOCKOUT_DURATION_MINUTES: 15 },
}));

import * as loginLockoutService from '../loginLockout.service';

describe('loginLockout.service', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('is not locked before any failures are recorded', () => {
    expect(loginLockoutService.isLocked('user-a')).toBe(false);
  });

  it('does not lock before the threshold is reached', () => {
    loginLockoutService.recordFailure('user-b');
    loginLockoutService.recordFailure('user-b');

    expect(loginLockoutService.isLocked('user-b')).toBe(false);
  });

  it('locks the account once the threshold is crossed, and reports justLocked only on that call', () => {
    expect(loginLockoutService.recordFailure('user-c')).toEqual({ justLocked: false });
    expect(loginLockoutService.recordFailure('user-c')).toEqual({ justLocked: false });
    expect(loginLockoutService.recordFailure('user-c')).toEqual({ justLocked: true });

    expect(loginLockoutService.isLocked('user-c')).toBe(true);
  });

  it('a successful login clears the counter entirely', () => {
    loginLockoutService.recordFailure('user-d');
    loginLockoutService.recordFailure('user-d');

    loginLockoutService.recordSuccess('user-d');

    // Two more failures after a reset must not be enough to lock (threshold is 3).
    loginLockoutService.recordFailure('user-d');
    loginLockoutService.recordFailure('user-d');
    expect(loginLockoutService.isLocked('user-d')).toBe(false);
  });

  it('expires the lock once its duration has elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    loginLockoutService.recordFailure('user-e');
    loginLockoutService.recordFailure('user-e');
    loginLockoutService.recordFailure('user-e');
    expect(loginLockoutService.isLocked('user-e')).toBe(true);

    vi.setSystemTime(new Date('2025-01-01T00:16:00.000Z')); // 16 minutes later, past the 15-minute lock
    expect(loginLockoutService.isLocked('user-e')).toBe(false);

    vi.useRealTimers();
  });

  it('tracks each account independently', () => {
    loginLockoutService.recordFailure('user-f');
    loginLockoutService.recordFailure('user-f');
    loginLockoutService.recordFailure('user-f');
    expect(loginLockoutService.isLocked('user-f')).toBe(true);

    expect(loginLockoutService.isLocked('user-g')).toBe(false);
  });
});
