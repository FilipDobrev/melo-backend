import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createCollection, createRecipe, NONEXISTENT_UUID, registerUser } from './helpers/factories';

describe('POST /users/me/collections with an initial recipeId', () => {
  it('creates the collection and adds the recipe atomically', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken))
      .send({ name: 'From a recipe', recipeId: recipe.id });

    expect(res.status).toBe(201);
    expect(res.body.recipeCount).toBe(1);

    const listRes = await request(app)
      .get(`/api/v1/users/me/collections/${res.body.id}/recipes`)
      .set(...authHeader(owner.accessToken));
    expect(listRes.body.items.map((item: { id: string }) => item.id)).toEqual([recipe.id]);
  });

  it('returns 404 for an unknown recipeId and creates no collection', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken))
      .send({ name: 'Doomed', recipeId: NONEXISTENT_UUID });

    expect(res.status).toBe(404);

    const listRes = await request(app)
      .get('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken));
    expect(listRes.body).toEqual([]);
  });

  it('returns 409 for a duplicate name and creates no second collection', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const existing = await createCollection(app, owner.accessToken, { name: 'Taken' });

    const res = await request(app)
      .post('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken))
      .send({ name: 'Taken', recipeId: recipe.id });

    expect(res.status).toBe(409);

    const listRes = await request(app)
      .get('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken));
    expect(listRes.body).toEqual([
      expect.objectContaining({ id: existing.id, name: 'Taken', recipeCount: 0 }),
    ]);
  });

  it('behaves exactly as before when recipeId is omitted', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/users/me/collections')
      .set(...authHeader(owner.accessToken))
      .send({ name: 'No recipe yet' });

    expect(res.status).toBe(201);
    expect(res.body.recipeCount).toBe(0);
  });
});
