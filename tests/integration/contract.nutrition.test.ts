import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createProduct, registerUser } from './helpers/factories';

describe('recipe nutrition totals over a real HTTP round trip', () => {
  it('sums per-ingredient nutrition computed from stored per-100g product values', async () => {
    const owner = await registerUser(app);

    // 100 g chicken (per 100g: 165 kcal / 31 P / 0 C / 3.6 F)
    const chicken = await createProduct(app, owner.accessToken, {
      caloriesPer100g: 165,
      proteinPer100g: 31,
      carbsPer100g: 0,
      fatPer100g: 3.6,
    });
    // 150 g rice (per 100g: 130 kcal / 2.7 P / 28.2 C / 0.3 F)
    const rice = await createProduct(app, owner.accessToken, {
      caloriesPer100g: 130,
      proteinPer100g: 2.7,
      carbsPer100g: 28.2,
      fatPer100g: 0.3,
    });

    const createRes = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Chicken and rice',
        description: 'A simple high-protein meal.',
        instructions: 'Grill the chicken. Cook the rice. Combine.',
        ingredients: [
          { productId: chicken.id, quantity: 200, unit: 'GRAM' }, // 200g -> 330/62/0/7.2
          { productId: rice.id, quantity: 150, unit: 'GRAM' }, // 150g -> 195/4.05/42.3/0.45
        ],
        categorySlugs: [],
      });
    expect(createRes.status).toBe(201);

    // Expected totals: 330+195=525 kcal, 62+4.05=66.05 P, 0+42.3=42.3 C, 7.2+0.45=7.65 F
    expect(createRes.body.nutrition.calories).toBeCloseTo(525, 1);
    expect(createRes.body.nutrition.protein).toBeCloseTo(66.05, 1);
    expect(createRes.body.nutrition.carbs).toBeCloseTo(42.3, 1);
    expect(createRes.body.nutrition.fat).toBeCloseTo(7.65, 1);

    // GET must recompute the same totals from the persisted rows, not just
    // echo back the create response.
    const getRes = await request(app).get(`/api/v1/recipes/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.nutrition).toEqual(createRes.body.nutrition);

    // A post documenting this recipe carries the same computed totals.
    const post = await createPost(app, owner.accessToken, createRes.body.id);
    expect(post.recipe.nutrition).toEqual(createRes.body.nutrition);
  });

  it('recomputes totals after ingredients are replaced by an update', async () => {
    const owner = await registerUser(app);
    const flour = await createProduct(app, owner.accessToken, {
      caloriesPer100g: 364,
      proteinPer100g: 10.3,
      carbsPer100g: 76.3,
      fatPer100g: 1,
    });
    const sugar = await createProduct(app, owner.accessToken, {
      caloriesPer100g: 387,
      proteinPer100g: 0,
      carbsPer100g: 100,
      fatPer100g: 0,
    });

    const createRes = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Flour only',
        description: 'desc',
        instructions: 'steps',
        ingredients: [{ productId: flour.id, quantity: 100, unit: 'GRAM' }],
        categorySlugs: [],
      });

    const updateRes = await request(app)
      .patch(`/api/v1/recipes/${createRes.body.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ ingredients: [{ productId: sugar.id, quantity: 50, unit: 'GRAM' }] });

    expect(updateRes.status).toBe(200);
    // 50g sugar -> 193.5 kcal / 0 P / 50 C / 0 F
    expect(updateRes.body.nutrition.calories).toBeCloseTo(193.5, 1);
    expect(updateRes.body.nutrition.protein).toBeCloseTo(0, 1);
    expect(updateRes.body.nutrition.carbs).toBeCloseTo(50, 1);
    expect(updateRes.body.nutrition.fat).toBeCloseTo(0, 1);
  });
});
