import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createRecipe, registerUser } from './helpers/factories';
import { prisma } from '../../src/lib/prisma';

const PASSWORD = 'CorrectHorse1!';

describe('DELETE /users/me', () => {
  it('rejects the wrong password with 401 and changes nothing', async () => {
    const user = await registerUser(app, { password: PASSWORD });

    const res = await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ password: 'WrongPassword1!' });

    expect(res.status).toBe(401);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).toBeNull();

    // The account is not logged out: the refresh token is still usable.
    const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(refreshRes.status).toBe(200);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await request(app).delete('/api/v1/users/me').send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('schedules deletion and revokes every refresh token on success', async () => {
    const user = await registerUser(app, { password: PASSWORD });
    // A second session, as if logged in from another device.
    const secondLogin = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(secondLogin.status).toBe(200);

    const res = await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ password: PASSWORD });

    expect(res.status).toBe(204);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).not.toBeNull();

    // Every session, not just the one used to request deletion, is logged out.
    const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(refreshRes.status).toBe(401);
    const secondRefreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondLogin.body.refreshToken });
    expect(secondRefreshRes.status).toBe(401);
  });
});

describe('a pending-deletion account', () => {
  it('can still log in and see its own pending-deletion state', async () => {
    const user = await registerUser(app, { password: PASSWORD });
    await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ password: PASSWORD });

    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(loginRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.deletionRequestedAt).not.toBeNull();
    expect(meRes.body.purgeAt).not.toBeNull();
  });

  it('disappears from search, public profile, following lists, feed, the global recipe list, and post/recipe detail', async () => {
    const victim = await registerUser(app, { password: PASSWORD, username: `victim${Date.now()}` });
    const observer = await registerUser(app);

    // observer follows victim, so victim's posts would normally show in observer's feed
    // and victim would normally show in observer's "following" list.
    await request(app)
      .post(`/api/v1/users/${victim.id}/follow`)
      .set(...authHeader(observer.accessToken));

    const recipe = await createRecipe(app, victim.accessToken);
    const post = await createPost(app, victim.accessToken, recipe.id);

    // Sanity check: everything is visible before deletion is requested.
    const searchBefore = await request(app).get(`/api/v1/users?search=${victim.username}`);
    expect(searchBefore.body.items.map((u: { id: string }) => u.id)).toContain(victim.id);
    const feedBefore = await request(app).get('/api/v1/feed').set(...authHeader(observer.accessToken));
    expect(feedBefore.body.items.map((p: { id: string }) => p.id)).toContain(post.id);

    await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(victim.accessToken))
      .send({ password: PASSWORD });

    const searchRes = await request(app).get(`/api/v1/users?search=${victim.username}`);
    expect(searchRes.body.items.map((u: { id: string }) => u.id)).not.toContain(victim.id);

    const profileRes = await request(app).get(`/api/v1/users/${victim.id}`);
    expect(profileRes.status).toBe(404);

    const followingRes = await request(app).get(`/api/v1/users/${observer.id}/following`);
    expect(followingRes.body.items.map((u: { id: string }) => u.id)).not.toContain(victim.id);

    const feedRes = await request(app).get('/api/v1/feed').set(...authHeader(observer.accessToken));
    expect(feedRes.body.items.map((p: { id: string }) => p.id)).not.toContain(post.id);

    const recipesRes = await request(app).get('/api/v1/recipes');
    expect(recipesRes.body.items.map((r: { id: string }) => r.id)).not.toContain(recipe.id);

    const userPostsRes = await request(app).get(`/api/v1/users/${victim.id}/posts`);
    expect(userPostsRes.body.items).toEqual([]);

    const userRecipesRes = await request(app).get(`/api/v1/users/${victim.id}/recipes`);
    expect(userRecipesRes.body.items).toEqual([]);

    const postDetailRes = await request(app).get(`/api/v1/posts/${post.id}`);
    expect(postDetailRes.status).toBe(404);

    const recipeDetailRes = await request(app).get(`/api/v1/recipes/${recipe.id}`);
    expect(recipeDetailRes.status).toBe(404);
  });
});

describe('POST /users/me/restore', () => {
  it('rejects an account that is not pending deletion with 409', async () => {
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/users/me/restore')
      .set(...authHeader(user.accessToken));

    expect(res.status).toBe(409);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await request(app).post('/api/v1/users/me/restore');
    expect(res.status).toBe(401);
  });

  it('cancels a pending deletion and makes the account visible again', async () => {
    const user = await registerUser(app, { password: PASSWORD, username: `restorable${Date.now()}` });
    await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ password: PASSWORD });

    // Restoring requires a fresh session: deleting revoked every refresh
    // token, but the access token used to request deletion is still valid
    // for its remaining TTL, exactly like any other stolen-but-still-live
    // token would be - restore only needs authentication, not the password.
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    const restoreRes = await request(app)
      .post('/api/v1/users/me/restore')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(restoreRes.status).toBe(204);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).toBeNull();

    const searchRes = await request(app).get(`/api/v1/users?search=${user.username}`);
    expect(searchRes.body.items.map((u: { id: string }) => u.id)).toContain(user.id);

    const profileRes = await request(app).get(`/api/v1/users/${user.id}`);
    expect(profileRes.status).toBe(200);

    // Restoring again now that the account is active is a 409, not a no-op success.
    const secondRestoreRes = await request(app)
      .post('/api/v1/users/me/restore')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(secondRestoreRes.status).toBe(409);
  });
});
