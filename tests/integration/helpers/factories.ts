import type { Express } from 'express';
import request from 'supertest';

/// Plain functions, no framework: register a user and get a token, create a
/// product, a recipe, a post, a collection, a comment. Every factory sends
/// real HTTP requests through the app rather than writing to the database
/// directly, so a broken endpoint fails the factory call itself instead of
/// silently seeding data the API could never have produced.

let sequence = 0;
function unique(): string {
  sequence += 1;
  return `${Date.now()}${sequence}`;
}

export const NONEXISTENT_UUID = '00000000-0000-0000-0000-000000000000';

export function authHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export interface AuthedUser {
  id: string;
  username: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(
  app: Express,
  overrides: Partial<{ username: string; email: string; password: string }> = {},
): Promise<AuthedUser> {
  const suffix = unique();
  const username = overrides.username ?? `user${suffix}`;
  const email = overrides.email ?? `user${suffix}@example.com`;
  const password = overrides.password ?? 'Password123!';

  const res = await request(app).post('/api/v1/auth/register').send({ username, email, password });
  if (res.status !== 201) {
    throw new Error(`registerUser failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return {
    id: res.body.user.id,
    username,
    email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export async function createProduct(
  app: Express,
  token: string,
  overrides: Partial<{
    name: string;
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
  }> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const body = {
    name: overrides.name ?? `Product ${unique()}`,
    caloriesPer100g: overrides.caloriesPer100g ?? 100,
    proteinPer100g: overrides.proteinPer100g ?? 10,
    carbsPer100g: overrides.carbsPer100g ?? 10,
    fatPer100g: overrides.fatPer100g ?? 5,
  };
  const res = await request(app).post('/api/v1/products').set(...authHeader(token)).send(body);
  if (res.status !== 201) {
    throw new Error(`createProduct failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createRecipe(
  app: Express,
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const product = await createProduct(app, token);
  const body = {
    title: `Recipe ${unique()}`,
    description: 'A test recipe.',
    instructions: 'Mix everything and cook.',
    ingredients: [{ productId: product.id, quantity: 100, unit: 'GRAM' }],
    categorySlugs: [],
    ...overrides,
  };
  const res = await request(app).post('/api/v1/recipes').set(...authHeader(token)).send(body);
  if (res.status !== 201) {
    throw new Error(`createRecipe failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function getUploadUrl(
  app: Express,
  token: string,
  kind: 'posts' | 'recipes',
): Promise<{ storageKey: string; uploadUrl: string }> {
  const path = kind === 'posts' ? '/api/v1/posts/images/upload-url' : '/api/v1/recipes/images/upload-url';
  const res = await request(app)
    .post(path)
    .set(...authHeader(token))
    .send({ contentType: 'image/png', contentLength: 1024 });
  if (res.status !== 200) {
    throw new Error(`getUploadUrl(${kind}) failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createPost(
  app: Express,
  token: string,
  recipeId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: Record<string, any> = {},
  imageCount = 1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const uploads = await Promise.all(
    Array.from({ length: imageCount }, () => getUploadUrl(app, token, 'posts')),
  );
  const body = {
    caption: 'A test post',
    recipeId,
    imageKeys: uploads.map((upload) => upload.storageKey),
    ...overrides,
  };
  const res = await request(app).post('/api/v1/posts').set(...authHeader(token)).send(body);
  if (res.status !== 201) {
    throw new Error(`createPost failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createCollection(
  app: Express,
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const body = { name: `Collection ${unique()}`, ...overrides };
  const res = await request(app).post('/api/v1/users/me/collections').set(...authHeader(token)).send(body);
  if (res.status !== 201) {
    throw new Error(`createCollection failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createComment(
  app: Express,
  token: string,
  postId: string,
  content = 'A test comment',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const res = await request(app)
    .post(`/api/v1/posts/${postId}/comments`)
    .set(...authHeader(token))
    .send({ content });
  if (res.status !== 201) {
    throw new Error(`createComment failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
