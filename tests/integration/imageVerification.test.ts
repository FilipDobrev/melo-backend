import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import {
  authHeader,
  createProduct,
  createRecipe,
  getUploadUrl,
  NOT_AN_IMAGE_BYTES,
  putToPresignedUrl,
  registerUser,
  TINY_JPEG_BYTES,
  uploadRealImage,
} from './helpers/factories';

describe('attach-time image verification', () => {
  it('rejects a post created with a key that was never uploaded', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const reserved = await getUploadUrl(app, owner.accessToken, 'posts'); // signed, never PUT

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'never uploaded', recipeId: recipe.id, imageKeys: [reserved.storageKey] });

    expect(res.status).toBe(400);
  });

  it('rejects a recipe created with a key that was never uploaded', async () => {
    const owner = await registerUser(app);
    const product = await createProduct(app, owner.accessToken);
    const reserved = await getUploadUrl(app, owner.accessToken, 'recipes'); // signed, never PUT

    const res = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Never uploaded picture',
        description: 'desc',
        instructions: 'steps',
        ingredients: [{ productId: product.id, quantity: 100, unit: 'GRAM' }],
        categorySlugs: [],
        imageKey: reserved.storageKey,
      });

    expect(res.status).toBe(400);
  });

  it('accepts a post whose image was genuinely uploaded first', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const upload = await uploadRealImage(app, owner.accessToken, 'posts');

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'real upload', recipeId: recipe.id, imageKeys: [upload.storageKey] });

    expect(res.status).toBe(201);
    expect(res.body.images).toHaveLength(1);
  });

  it('rejects attaching bytes that are not an image despite a declared image content type', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const reserved = await getUploadUrl(app, owner.accessToken, 'posts', 'image/jpeg', NOT_AN_IMAGE_BYTES.length);
    await putToPresignedUrl(reserved.uploadUrl, 'image/jpeg', NOT_AN_IMAGE_BYTES);

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'fake image', recipeId: recipe.id, imageKeys: [reserved.storageKey] });

    expect(res.status).toBe(400);
  });

  it('still accepts a preset recipe image without touching storage', async () => {
    const owner = await registerUser(app);
    const product = await createProduct(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/recipes')
      .set(...authHeader(owner.accessToken))
      .send({
        title: 'Preset picture',
        description: 'desc',
        instructions: 'steps',
        ingredients: [{ productId: product.id, quantity: 100, unit: 'GRAM' }],
        categorySlugs: [],
        imageKey: 'preset:breakfast',
      });

    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toContain('breakfast');
  });

  it('accepts a recipe update with a genuinely uploaded image', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const upload = await uploadRealImage(app, owner.accessToken, 'recipes', TINY_JPEG_BYTES);

    const res = await request(app)
      .patch(`/api/v1/recipes/${recipe.id}`)
      .set(...authHeader(owner.accessToken))
      .send({ imageKey: upload.storageKey });

    expect(res.status).toBe(200);
  });
});
