import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createRecipe, registerUser } from './helpers/factories';

/// Walks every page of a cursor-paginated endpoint with a small page size,
/// collecting every item's id. Used to prove a full walk over more items
/// than fit on one page returns every item exactly once, with no
/// duplicates or gaps.
async function collectAllIds(
  targetApp: Express,
  basePath: string,
  limit: number,
  token?: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const separator = basePath.includes('?') ? '&' : '?';
    const url = `${basePath}${separator}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
    const req = request(targetApp).get(url);
    if (token) req.set(...authHeader(token));
    const res = await req;
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(limit);

    for (const item of res.body.items as Array<{ id: string }>) {
      ids.push(item.id);
    }
    cursor = res.body.nextCursor ?? undefined;

    pages += 1;
    if (pages > 200) throw new Error(`Pagination over ${basePath} did not terminate`);
  } while (cursor);

  return ids;
}

const RECIPE_COUNT = 25;
const PAGE_SIZE = 7; // deliberately not a divisor of RECIPE_COUNT, to exercise a short last page

describe('GET /recipes cursor pagination', () => {
  for (const sort of ['newest', 'oldest', 'popular'] as const) {
    it(`walks every recipe exactly once with sort=${sort}`, async () => {
      const owner = await registerUser(app);
      const createdIds: string[] = [];
      for (let i = 0; i < RECIPE_COUNT; i += 1) {
        const recipe = await createRecipe(app, owner.accessToken);
        createdIds.push(recipe.id);
      }

      const walkedIds = await collectAllIds(app, `/api/v1/recipes?sort=${sort}`, PAGE_SIZE);

      expect(walkedIds.length).toBe(RECIPE_COUNT);
      expect(new Set(walkedIds).size).toBe(RECIPE_COUNT);
      expect(new Set(walkedIds)).toEqual(new Set(createdIds));
    });
  }
});

describe('GET /feed cursor pagination', () => {
  it('walks every followed post exactly once', async () => {
    const author = await registerUser(app);
    const follower = await registerUser(app);

    const followRes = await request(app)
      .post(`/api/v1/users/${author.id}/follow`)
      .set(...authHeader(follower.accessToken));
    expect(followRes.status).toBe(204);

    const createdIds: string[] = [];
    for (let i = 0; i < RECIPE_COUNT; i += 1) {
      const recipe = await createRecipe(app, author.accessToken);
      const post = await createPost(app, author.accessToken, recipe.id);
      createdIds.push(post.id);
    }

    const walkedIds = await collectAllIds(app, '/api/v1/feed', PAGE_SIZE, follower.accessToken);

    expect(walkedIds.length).toBe(RECIPE_COUNT);
    expect(new Set(walkedIds).size).toBe(RECIPE_COUNT);
    expect(new Set(walkedIds)).toEqual(new Set(createdIds));
  });

  it('never returns posts from an unfollowed user', async () => {
    const stranger = await registerUser(app);
    const follower = await registerUser(app);
    const recipe = await createRecipe(app, stranger.accessToken);
    await createPost(app, stranger.accessToken, recipe.id);

    const res = await request(app).get('/api/v1/feed').set(...authHeader(follower.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
