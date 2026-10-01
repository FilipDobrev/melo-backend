import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import {
  attachedKeyFor,
  authHeader,
  buildJpegBytes,
  createProduct,
  createPost,
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

describe('upload hardening', () => {
  it('refuses to hand out an upload URL for a non-jpeg content type or an oversized file', async () => {
    const owner = await registerUser(app);

    const png = await request(app)
      .post('/api/v1/posts/images/upload-url')
      .set(...authHeader(owner.accessToken))
      .send({ contentType: 'image/png', contentLength: 1024 });
    expect(png.status).toBe(400);

    const oversized = await request(app)
      .post('/api/v1/posts/images/upload-url')
      .set(...authHeader(owner.accessToken))
      .send({ contentType: 'image/jpeg', contentLength: 2 * 1024 * 1024 + 1 });
    expect(oversized.status).toBe(400);
  });

  it('rejects a PUT whose content type differs from the one that was signed', async () => {
    const owner = await registerUser(app);
    const reserved = await getUploadUrl(app, owner.accessToken, 'posts');

    await expect(putToPresignedUrl(reserved.uploadUrl, 'text/html', TINY_JPEG_BYTES)).rejects.toThrow(/403/);
  });

  it('keeps the attached bytes unchanged when the presigned URL is re-used afterwards', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const upload = await getUploadUrl(app, owner.accessToken, 'posts');
    await putToPresignedUrl(upload.uploadUrl, 'image/jpeg', TINY_JPEG_BYTES);

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'overwrite attempt', recipeId: recipe.id, imageKeys: [upload.storageKey] });
    expect(res.status).toBe(201);
    expect(res.body.images[0].storageKey).toBe(attachedKeyFor(upload.storageKey, 'posts'));

    // Same URL, still inside its 5 minute lifetime, now carrying different bytes.
    const overwrite = buildJpegBytes(2, 2);
    await putToPresignedUrl(upload.uploadUrl, 'image/jpeg', overwrite);

    const served = Buffer.from(await (await fetch(res.body.images[0].url as string)).arrayBuffer());
    expect(served.equals(TINY_JPEG_BYTES)).toBe(true);
  });

  it('rejects an image whose declared dimensions exceed the limit', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const huge = buildJpegBytes(4000, 3000);
    const upload = await uploadRealImage(app, owner.accessToken, 'posts', huge);

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'too big', recipeId: recipe.id, imageKeys: [upload.storageKey] });

    expect(res.status).toBe(400);
  });

  it('rejects a path traversal key that points into another user prefix', async () => {
    const owner = await registerUser(app);
    const victim = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const victimUpload = await uploadRealImage(app, victim.accessToken, 'posts');
    const victimFile = victimUpload.storageKey.split('/')[2];

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({
        caption: 'traversal',
        recipeId: recipe.id,
        imageKeys: [`uploads/${owner.id}/../${victim.id}/${victimFile}`],
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate image keys in one request', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const upload = await uploadRealImage(app, owner.accessToken, 'posts');

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'dupes', recipeId: recipe.id, imageKeys: [upload.storageKey, upload.storageKey] });

    expect(res.status).toBe(422);
  });

  it('rejects re-attaching an already promoted key to a different post', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'reuse', recipeId: recipe.id, imageKeys: [post.images[0].storageKey] });

    expect(res.status).toBe(400);
  });
});

