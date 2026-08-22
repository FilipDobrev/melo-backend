import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createProduct, createRecipe, registerUser } from './helpers/factories';

describe('recipe servings', () => {
  it('defaults to 1 when omitted on create', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    expect(recipe.servings).toBe(1);
  });

  it('stores and returns the given value on create', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken, { servings: 4 });

    expect(recipe.servings).toBe(4);

    const getRes = await request(app).get(`/api/v1/recipes/${recipe.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.servings).toBe(4);
  });

  it('updates servings on PATCH', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken, { servings: 2 });

    const updateRes = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ servings: 6 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.servings).toBe(6);
  });

  it('leaves servings unchanged when omitted on update, even alongside an ingredient replacement', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken, { servings: 3 });
    const newProduct = await createProduct(app, owner.accessToken);

    const updateRes = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ ingredients: [{ productId: newProduct.id, quantity: 50, unit: 'GRAM' }] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.servings).toBe(3);
    expect(updateRes.body.ingredients).toHaveLength(1);
    expect(updateRes.body.ingredients[0].product.id).toBe(newProduct.id);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
    ['above the upper bound', 101],
  ])('rejects %s servings with a validation error', async (_label, servings) => {
    const owner = await registerUser(app);
    const product = await createProduct(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Bad servings recipe',
        description: 'desc',
        instructions: 'steps',
        ingredients: [{ productId: product.id, quantity: 100, unit: 'GRAM' }],
        categorySlugs: [],
        servings,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid servings value on update too', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ servings: 0 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('appears on the recipe list', async () => {
    const owner = await registerUser(app);
    await createRecipe(app, owner.accessToken, { servings: 5 });

    const listRes = await request(app).get('/api/v1/recipes');
    expect(listRes.status).toBe(200);
    const item = listRes.body.items.find((recipe: { servings: number }) => recipe.servings === 5);
    expect(item).toBeDefined();
  });

  it('appears on the recipe embedded in a post', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken, { servings: 8 });
    const post = await createPost(app, owner.accessToken, recipe.id);

    expect(post.recipe.servings).toBe(8);
  });
});
