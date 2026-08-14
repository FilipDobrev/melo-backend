import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import {
  authHeader,
  createPost,
  createRecipe,
  getUploadUrl,
  NONEXISTENT_UUID,
  registerUser,
  uploadRealImage,
} from './helpers/factories';

describe('PATCH /posts/:postId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app).patch(`/api/v1/posts/${post.id}`).send({ caption: 'Hacked' });

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(stranger.accessToken))
      .send({ caption: 'Hacked' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent post', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .patch(`/api/v1/posts/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'Hacked' });

    expect(res.status).toBe(404);
  });

  it('lets the owner update the post', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'Updated caption' });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('Updated caption');
  });

  it('changing only the caption leaves images and recipe untouched', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'Only the caption changes' });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('Only the caption changes');
    expect(res.body.recipe.id).toBe(recipe.id);
    expect(res.body.images.map((image: { storageKey: string }) => image.storageKey)).toEqual(
      post.images.map((image: { storageKey: string }) => image.storageKey),
    );
  });

  it('clears the caption with an explicit null', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, { caption: 'Has a caption' });

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ caption: null });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBeNull();
  });

  it('an absent caption key leaves the caption untouched', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, { caption: 'Keep me' });

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: recipe.id });

    expect(res.status).toBe(200);
    expect(res.body.caption).toBe('Keep me');
  });

  it('changes the linked recipe', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const otherRecipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: otherRecipe.id });

    expect(res.status).toBe(200);
    expect(res.body.recipe.id).toBe(otherRecipe.id);
  });

  it('returns 404 when recipeId points at a nonexistent recipe', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: NONEXISTENT_UUID });

    expect(res.status).toBe(404);
  });

  it('re-sending the existing keys unchanged is a no-op on content', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);
    const existingKeys = post.images.map((image: { storageKey: string }) => image.storageKey);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: existingKeys });

    expect(res.status).toBe(200);
    expect(res.body.images.map((image: { storageKey: string }) => image.storageKey)).toEqual(existingKeys);
    // The ids are reissued by the wholesale replace, even though the keys
    // (and therefore the storage objects and urls) are identical.
    expect(res.body.images.map((image: { url: string }) => image.url)).toEqual(
      post.images.map((image: { url: string }) => image.url),
    );
  });

  it('reordering keys changes the returned image order', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);
    const [first, second] = post.images.map((image: { storageKey: string }) => image.storageKey);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: [second, first] });

    expect(res.status).toBe(200);
    expect(res.body.images.map((image: { storageKey: string }) => image.storageKey)).toEqual([second, first]);
  });

  it('adds a newly uploaded key alongside an existing one', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 1);
    const existingKey = post.images[0].storageKey;
    const newUpload = await uploadRealImage(app, owner.accessToken, 'posts');

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: [existingKey, newUpload.storageKey] });

    expect(res.status).toBe(200);
    expect(res.body.images.map((image: { storageKey: string }) => image.storageKey)).toEqual([
      existingKey,
      newUpload.storageKey,
    ]);
  });

  it('rejects dropping to zero images', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: [] });

    expect(res.status).toBe(422);
  });

  it("rejects another user's key", async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const strangerUpload = await uploadRealImage(app, stranger.accessToken, 'posts');

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: [strangerUpload.storageKey] });

    expect(res.status).toBe(400);
  });

  it('rejects a key that was never uploaded', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const reserved = await getUploadUrl(app, owner.accessToken, 'posts'); // signed, never PUT

    const res = await request(app)
      .patch(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKeys: [reserved.storageKey] });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /posts/:postId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app).delete(`/api/v1/posts/${post.id}`);

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent post', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .delete(`/api/v1/posts/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner delete the post', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(204);

    const getRes = await request(app).get(`/api/v1/posts/${post.id}`);
    expect(getRes.status).toBe(404);
  });
});

describe('DELETE /posts/:postId/images/:imageId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);
    const imageId = post.images[0].id;

    const res = await request(app).delete(`/api/v1/posts/${post.id}/images/${imageId}`);

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);
    const imageId = post.images[0].id;

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/images/${imageId}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent image', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/images/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner delete an image, but refuses to remove the last one', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id, {}, 2);
    const [firstImage, secondImage] = post.images;

    const firstDelete = await request(app)
      .delete(`/api/v1/posts/${post.id}/images/${firstImage.id}`)
      .set(...authHeader(owner.accessToken));
    expect(firstDelete.status).toBe(204);

    const lastDelete = await request(app)
      .delete(`/api/v1/posts/${post.id}/images/${secondImage.id}`)
      .set(...authHeader(owner.accessToken));
    expect(lastDelete.status).toBe(400);
  });
});

describe('DELETE /posts/:postId/comments/:commentId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const commenter = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const commentRes = await request(app)
      .post(`/api/v1/posts/${post.id}/comments`)
      .set(...authHeader(commenter.accessToken))
      .send({ content: 'Looks great' });

    const res = await request(app).delete(`/api/v1/posts/${post.id}/comments/${commentRes.body.id}`);

    expect(res.status).toBe(401);
  });

  it('rejects a caller who is neither the comment author nor the post owner with 403', async () => {
    const owner = await registerUser(app);
    const commenter = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const commentRes = await request(app)
      .post(`/api/v1/posts/${post.id}/comments`)
      .set(...authHeader(commenter.accessToken))
      .send({ content: 'Looks great' });

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/comments/${commentRes.body.id}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent comment', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/comments/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the comment author delete their own comment', async () => {
    const owner = await registerUser(app);
    const commenter = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const commentRes = await request(app)
      .post(`/api/v1/posts/${post.id}/comments`)
      .set(...authHeader(commenter.accessToken))
      .send({ content: 'Looks great' });

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/comments/${commentRes.body.id}`)
      .set(...authHeader(commenter.accessToken));

    expect(res.status).toBe(204);
  });

  it('lets the post owner delete a comment written by someone else', async () => {
    const owner = await registerUser(app);
    const commenter = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const commentRes = await request(app)
      .post(`/api/v1/posts/${post.id}/comments`)
      .set(...authHeader(commenter.accessToken))
      .send({ content: 'Looks great' });

    const res = await request(app)
      .delete(`/api/v1/posts/${post.id}/comments/${commentRes.body.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(204);
  });
});
