import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import {
  authHeader,
  createProduct,
  createRecipe,
  getUploadUrl,
  NONEXISTENT_UUID,
  registerUser,
  uploadRealImage,
} from './helpers/factories';

describe('PATCH /recipes/:recipeId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app).patch(`/api/v1/recipes/${recipe.id}`).send({ title: 'Hacked' });

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(stranger.accessToken))
      .send({ title: 'Hacked' });

    expect(res.status).toBe(403);
  });

  it('lets the owner update the recipe', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ title: 'Updated title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
  });

  it('returns 404 for a nonexistent recipe', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .patch(`/api/v1/recipes/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken))
      .send({ title: 'Updated title' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /recipes/:recipeId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app).delete(`/api/v1/recipes/${recipe.id}`);

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent recipe', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .delete(`/api/v1/recipes/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner delete the recipe', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(204);

    const getRes = await request(app).get(`/api/v1/recipes/${recipe.id}`);
    expect(getRes.status).toBe(404);
  });
});

describe('recipe imageKey ownership', () => {
  it('rejects a create with a storage key under another user\'s prefix', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const strangerUpload = await getUploadUrl(app, stranger.accessToken, 'recipes');
    const product = await createProduct(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Someone else\'s picture',
        description: 'desc',
        instructions: 'steps',
        ingredients: [{ productId: product.id, quantity: 100, unit: 'GRAM' }],
        categorySlugs: [],
        imageKey: strangerUpload.storageKey,
      });

    expect(res.status).toBe(400);
  });

  it('rejects an update with a storage key under another user\'s prefix', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const strangerUpload = await getUploadUrl(app, stranger.accessToken, 'recipes');

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKey: strangerUpload.storageKey });

    expect(res.status).toBe(400);
  });

  it('accepts the caller\'s own uploaded storage key', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const ownUpload = await uploadRealImage(app, owner.accessToken, 'recipes');

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKey: ownUpload.storageKey });

    expect(res.status).toBe(200);
  });
});
