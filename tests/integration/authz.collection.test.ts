import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createCollection, createRecipe, NONEXISTENT_UUID, registerUser } from './helpers/factories';

describe('PATCH /users/me/collections/:collectionId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/users/me/collections/${collection.id}`)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/users/me/collections/${collection.id}`)
      .set(...authHeader(stranger.accessToken))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent collection', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .patch(`/api/v1/users/me/collections/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(404);
  });

  it('lets the owner rename the collection', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/users/me/collections/${collection.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });
});

describe('DELETE /users/me/collections/:collectionId', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app).delete(`/api/v1/users/me/collections/${collection.id}`);

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${collection.id}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent collection', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${NONEXISTENT_UUID}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner delete the collection', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${collection.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(204);
  });
});

describe('GET /users/me/collections/:collectionId/recipes', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app).get(`/api/v1/users/me/collections/${collection.id}/recipes`);

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent collection', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .get(`/api/v1/users/me/collections/${NONEXISTENT_UUID}/recipes`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner list the collection', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('POST /users/me/collections/:collectionId/recipes', () => {
  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .send({ recipeId: recipe.id });

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(stranger.accessToken))
      .send({ recipeId: recipe.id });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent collection', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/users/me/collections/${NONEXISTENT_UUID}/recipes`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: recipe.id });

    expect(res.status).toBe(404);
  });

  it('returns 404 for a nonexistent recipe', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: NONEXISTENT_UUID });

    expect(res.status).toBe(404);
  });

  it('lets the owner add a recipe to their collection', async () => {
    const owner = await registerUser(app);
    const collection = await createCollection(app, owner.accessToken);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: recipe.id });

    expect(res.status).toBe(204);
  });
});

describe('DELETE /users/me/collections/:collectionId/recipes/:recipeId', () => {
  async function addRecipeToOwnCollection(token: string) {
    const collection = await createCollection(app, token);
    const recipe = await createRecipe(app, token);
    await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(token))
      .send({ recipeId: recipe.id });
    return { collection, recipe };
  }

  it('rejects an anonymous caller with 401', async () => {
    const owner = await registerUser(app);
    const { collection, recipe } = await addRecipeToOwnCollection(owner.accessToken);

    const res = await request(app).delete(
      `/api/v1/users/me/collections/${collection.id}/recipes/${recipe.id}`,
    );

    expect(res.status).toBe(401);
  });

  it('rejects a non-owner with 403', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const { collection, recipe } = await addRecipeToOwnCollection(owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${collection.id}/recipes/${recipe.id}`)
      .set(...authHeader(stranger.accessToken));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent collection', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${NONEXISTENT_UUID}/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it('lets the owner remove a recipe from their collection', async () => {
    const owner = await registerUser(app);
    const { collection, recipe } = await addRecipeToOwnCollection(owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/users/me/collections/${collection.id}/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken));

    expect(res.status).toBe(204);
  });
});
