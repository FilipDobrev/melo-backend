import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { prisma } from '../../src/lib/prisma';
import {
  authHeader,
  createComment,
  createPost,
  createRecipe,
  getUploadUrl,
  registerUser,
  uploadRealImage,
} from './helpers/factories';

describe('POST /users/me/avatar/upload-url', () => {
  it('returns a storage key under the caller\'s own avatar prefix', async () => {
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/users/me/avatar/upload-url')
      .set(...authHeader(user.accessToken))
      .send({ contentType: 'image/jpeg', contentLength: 1024 });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toEqual(expect.any(String));
    expect(res.body.storageKey.startsWith(`avatars/${user.id}/`)).toBe(true);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/avatar/upload-url')
      .send({ contentType: 'image/jpeg', contentLength: 1024 });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /users/me profileImage', () => {
  it('accepts a key under the caller\'s own avatar prefix and reads back as a resolved URL', async () => {
    const user = await registerUser(app);
    const upload = await uploadRealImage(app, user.accessToken, 'avatars');

    const patchRes = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ profileImage: upload.storageKey });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.profileImage).toEqual(expect.any(String));
    expect(patchRes.body.profileImage).not.toBe(upload.storageKey);
    expect(patchRes.body.profileImage.startsWith('http')).toBe(true);

    const meRes = await request(app).get('/api/v1/users/me').set(...authHeader(user.accessToken));
    expect(meRes.status).toBe(200);
    expect(meRes.body.profileImage).toBe(patchRes.body.profileImage);
  });

  it('rejects a key belonging to another user with 400', async () => {
    const user = await registerUser(app);
    const stranger = await registerUser(app);
    const strangerUpload = await uploadRealImage(app, stranger.accessToken, 'avatars');

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ profileImage: strangerUpload.storageKey });

    expect(res.status).toBe(400);
  });

  it('rejects a key under the caller\'s own prefix that was never uploaded with 400', async () => {
    const user = await registerUser(app);
    const reserved = await getUploadUrl(app, user.accessToken, 'avatars'); // signed, never PUT

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ profileImage: reserved.storageKey });

    expect(res.status).toBe(400);
  });

  it('rejects a plain http(s) URL on write with 400', async () => {
    const user = await registerUser(app);
    const externalUrl = 'https://example.com/some-avatar.jpg';

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ profileImage: externalUrl });

    expect(res.status).toBe(400);
  });

  it('still resolves a legacy URL already stored on the row when reading, without touching it on write', async () => {
    const user = await registerUser(app);
    const legacyUrl = 'https://example.com/some-avatar.jpg';

    // Simulates a row written before the write path stopped accepting a
    // plain URL - the read path (resolveProfileImage) must keep rendering
    // it unchanged so those accounts don't lose their avatar.
    await prisma.user.update({ where: { id: user.id }, data: { profileImage: legacyUrl } });

    const res = await request(app).get('/api/v1/users/me').set(...authHeader(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.profileImage).toBe(legacyUrl);
  });

  it('rejects the reserved tombstone username, case- and whitespace-insensitively', async () => {
    const user = await registerUser(app);

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ username: ' Deleted-User ' });

    expect(res.status).toBe(409);
  });

  it('renders the avatar in a post\'s author summary fetched by a different user', async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const upload = await uploadRealImage(app, owner.accessToken, 'avatars');

    const patchRes = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(owner.accessToken))
      .send({ profileImage: upload.storageKey });
    expect(patchRes.status).toBe(200);

    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const getRes = await request(app)
      .get(`/api/v1/posts/${post.id}`)
      .set(...authHeader(viewer.accessToken));

    expect(getRes.status).toBe(200);
    expect(getRes.body.author.profileImage).toBe(patchRes.body.profileImage);
  });

  it('renders the avatar in a comment\'s author summary fetched by a different user', async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const upload = await uploadRealImage(app, owner.accessToken, 'avatars');

    const patchRes = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(owner.accessToken))
      .send({ profileImage: upload.storageKey });
    expect(patchRes.status).toBe(200);

    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const comment = await createComment(app, owner.accessToken, post.id);

    const listRes = await request(app)
      .get(`/api/v1/posts/${post.id}/comments`)
      .set(...authHeader(viewer.accessToken));

    expect(listRes.status).toBe(200);
    const found = listRes.body.items.find((item: { id: string }) => item.id === comment.id);
    expect(found.author.profileImage).toBe(patchRes.body.profileImage);
  });

  it('renders the avatar in a follower list entry fetched by a different user', async () => {
    const follower = await registerUser(app);
    const target = await registerUser(app);
    const viewer = await registerUser(app);
    const upload = await uploadRealImage(app, follower.accessToken, 'avatars');

    const patchRes = await request(app)
      .patch('/api/v1/users/me')
      .set(...authHeader(follower.accessToken))
      .send({ profileImage: upload.storageKey });
    expect(patchRes.status).toBe(200);

    const followRes = await request(app)
      .post(`/api/v1/users/${target.id}/follow`)
      .set(...authHeader(follower.accessToken));
    expect(followRes.status).toBe(204);

    const listRes = await request(app)
      .get(`/api/v1/users/${target.id}/followers`)
      .set(...authHeader(viewer.accessToken));

    expect(listRes.status).toBe(200);
    const found = listRes.body.items.find((item: { id: string }) => item.id === follower.id);
    expect(found.profileImage).toBe(patchRes.body.profileImage);
  });
});
