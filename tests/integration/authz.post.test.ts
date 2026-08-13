import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createRecipe, NONEXISTENT_UUID, registerUser } from './helpers/factories';

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
