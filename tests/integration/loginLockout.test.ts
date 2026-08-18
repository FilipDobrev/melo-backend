import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { registerUser } from './helpers/factories';

const PASSWORD = 'CorrectHorse1!';
// Matches LOGIN_LOCKOUT_THRESHOLD's default in src/config/env.ts. Not
// overridden by tests/integration/env.ts (unlike AUTH_RATE_LIMIT_MAX), so
// the real default is what's exercised here.
const LOCKOUT_THRESHOLD = 10;

describe('per-account login lockout', () => {
  it('locks the account after threshold consecutive wrong passwords, and the locked response is byte-identical to an ordinary wrong-password response', async () => {
    const user = await registerUser(app, { password: PASSWORD });

    const wrongPasswordRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1!' });
    expect(wrongPasswordRes.status).toBe(401);

    // Consume the rest of the threshold so the account becomes locked.
    for (let i = 1; i < LOCKOUT_THRESHOLD; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'WrongPassword1!' });
      expect(res.status).toBe(401);
    }

    // The account is now locked. The CORRECT password must be rejected
    // exactly like a wrong one - if a locked account answered differently,
    // that difference would tell an attacker the email is registered.
    const lockedWithCorrectPasswordRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    expect(lockedWithCorrectPasswordRes.status).toBe(wrongPasswordRes.status);
    expect(lockedWithCorrectPasswordRes.body).toEqual(wrongPasswordRes.body);
    expect(lockedWithCorrectPasswordRes.status).toBe(401);
  }, 30000);

  it('a successful login resets the counter so it does not carry over into a later attempt', async () => {
    const user = await registerUser(app, { password: PASSWORD });

    // One below the threshold - not enough to lock on its own.
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'WrongPassword1!' });
      expect(res.status).toBe(401);
    }

    const successRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(successRes.status).toBe(200);

    // The success above must have cleared the counter - otherwise this
    // account would already be one failure away from locking out on
    // whatever comes next, even though it just proved it owns the password.
    const nextLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(nextLoginRes.status).toBe(200);
  }, 30000);

  it('an unknown email and a wrong password get the identical response', async () => {
    const user = await registerUser(app, { password: PASSWORD });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1!' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `nobody${Date.now()}@example.com`, password: 'WrongPassword1!' });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });
});
