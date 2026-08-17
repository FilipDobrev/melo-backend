import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createCollection, createRecipe, registerUser } from './helpers/factories';

/// A collection is a folder inside the cookbook - the cookbook is always the
/// superset. These tests cover the direction that used to be broken:
/// unsaving a recipe must also remove it from every one of the caller's own
/// collections, in the same transaction as the unsave.
describe('DELETE /recipes/:recipeId/save clears collections', () => {
  async function addToCollection(token: string, collectionId: string, recipeId: string) {
    const res = await request(app)
      .post(`/api/v1/users/me/collections/${collectionId}/recipes`)
      .set(...authHeader(token))
      .send({ recipeId });
    if (res.status !== 204) {
      throw new Error(`addToCollection failed with ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  async function unsave(token: string, recipeId: string) {
    return request(app)
      .delete(`/api/v1/recipes/${recipeId}/save`)
      .set(...authHeader(token));
  }

  async function collectionRecipeIds(token: string, collectionId: string): Promise<string[]> {
    const res = await request(app)
      .get(`/api/v1/users/me/collections/${collectionId}/recipes`)
      .set(...authHeader(token));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return res.body.items.map((item: any) => item.id);
  }

  it('removes the recipe from every one of the caller\'s collections when unsaved', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const collectionA = await createCollection(app, owner.accessToken);
    const collectionB = await createCollection(app, owner.accessToken);
    await addToCollection(owner.accessToken, collectionA.id, recipe.id);
    await addToCollection(owner.accessToken, collectionB.id, recipe.id);

    const res = await unsave(owner.accessToken, recipe.id);
    expect(res.status).toBe(204);

    expect(await collectionRecipeIds(owner.accessToken, collectionA.id)).not.toContain(recipe.id);
    expect(await collectionRecipeIds(owner.accessToken, collectionB.id)).not.toContain(recipe.id);

    const listA = await request(app)
      .get(`/api/v1/users/me/collections/${collectionA.id}/recipes`)
      .set(...authHeader(owner.accessToken));
    expect(listA.body.items).toEqual([]);
  });

  it('does not touch a different user\'s collection containing the same recipe', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    // The stranger saves and files the owner's recipe under their own collection.
    const strangerCollection = await createCollection(app, stranger.accessToken);
    const strangerSave = await request(app)
      .post(`/api/v1/recipes/${recipe.id}/save`)
      .set(...authHeader(stranger.accessToken));
    expect(strangerSave.status).toBe(204);
    await addToCollection(stranger.accessToken, strangerCollection.id, recipe.id);

    // The owner unsaves their own recipe (they saved it automatically on create).
    const res = await unsave(owner.accessToken, recipe.id);
    expect(res.status).toBe(204);

    // The stranger's collection is unaffected.
    expect(await collectionRecipeIds(stranger.accessToken, strangerCollection.id)).toContain(recipe.id);
  });

  it('does not restore old collection memberships when the recipe is saved again', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const collection = await createCollection(app, owner.accessToken);
    await addToCollection(owner.accessToken, collection.id, recipe.id);

    const unsaveRes = await unsave(owner.accessToken, recipe.id);
    expect(unsaveRes.status).toBe(204);

    const resaveRes = await request(app)
      .post(`/api/v1/recipes/${recipe.id}/save`)
      .set(...authHeader(owner.accessToken));
    expect(resaveRes.status).toBe(204);

    expect(await collectionRecipeIds(owner.accessToken, collection.id)).not.toContain(recipe.id);
  });
});
