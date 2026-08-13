import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { registerUser } from './helpers/factories';
import { prisma } from '../../src/lib/prisma';
import { hashRefreshToken } from '../../src/services/token.service';

describe('register / login', () => {
  it('logs in with the credentials just registered', async () => {
    const user = await registerUser(app, { password: 'CorrectHorse1!' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'CorrectHorse1!' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a duplicate email with 409', async () => {
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: `other${Date.now()}`, email: user.email, password: 'Password123!' });

    expect(res.status).toBe(409);
  });

  it('rejects the wrong password with 401', async () => {
    const user = await registerUser(app, { password: 'CorrectHorse1!' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1!' });

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const user = await registerUser(app);

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(user.refreshToken);
    // Not asserting the access token differs from the original: JWT `iat`
    // has second resolution, so two tokens signed for the same user inside
    // the same second are byte-identical. That is harmless (both are valid,
    // stateless, and expire at the same time either way) - only the
    // refresh token's rotation is a real security property to verify.
  });

  it('rejects reuse of an already-rotated refresh token', async () => {
    const user = await registerUser(app);

    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(first.status).toBe(200);

    // The original token was rotated away by the call above, so using it
    // again must fail even though it has not expired.
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('lets the newly rotated token be used for the next refresh', async () => {
    const user = await registerUser(app);

    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });

    expect(second.status).toBe(200);
  });

  it('rejects an unknown refresh token with 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });

  it('replaying a revoked refresh token kills the whole session family', async () => {
    const user = await registerUser(app);

    // Two independent sessions for the same user, as if they logged in from
    // two devices (or an attacker stole a token and now holds a second one).
    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123!' });
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123!' });
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);

    const sessionARefreshToken = loginA.body.refreshToken as string;
    const sessionBRefreshToken = loginB.body.refreshToken as string;

    // Rotate session A once, so its original token is now revoked (not
    // expired) - simulating the legitimate refresh that happened after the
    // token leaked.
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessionARefreshToken });
    expect(rotated.status).toBe(200);

    // Replaying the now-revoked original token is the attacker's move.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessionARefreshToken });
    expect(replay.status).toBe(401);

    // Session B - a completely different, still-valid session for the same
    // user - must now be dead too: reuse detection revokes the whole family.
    const sessionBRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessionBRefreshToken });
    expect(sessionBRefresh.status).toBe(401);
  });

  it('an expired-but-never-revoked token does not trigger family revocation', async () => {
    const user = await registerUser(app, { password: 'CorrectHorse1!' });

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'CorrectHorse1!' });
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'CorrectHorse1!' });
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);

    // Backdate only session A's token past its expiry directly in the
    // database - the HTTP API has no way to fabricate an expired row, but
    // the whole point of this test is that expiry, unlike revocation, is
    // not a replay signal, so it must be a genuinely expired (never
    // revoked) row, and session B's token must be left untouched.
    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(loginA.body.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expiredReplay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginA.body.refreshToken });
    expect(expiredReplay.status).toBe(401);

    // Session B must be unaffected: an expired token is an ordinary
    // rejection, not evidence of a leak, so it must not revoke the family.
    const sessionBRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginB.body.refreshToken });
    expect(sessionBRefresh.status).toBe(200);
  });
});

describe('POST /auth/logout', () => {
  it('rejects an anonymous caller with 401', async () => {
    const user = await registerUser(app);

    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: user.refreshToken });
    // No Authorization header set above.
    expect(res.status).toBe(401);
  });

  it('revokes the refresh token so it can no longer be used', async () => {
    const user = await registerUser(app);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ refreshToken: user.refreshToken });
    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(refreshRes.status).toBe(401);
  });
});
