import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import {
  authHeader,
  createCollection,
  createComment,
  createPost,
  createRecipe,
  registerUser,
} from './helpers/factories';

const PASSWORD = 'CorrectHorse1!';

/// Recursively collects every string value in a parsed JSON body, so the
/// "no credential material anywhere" assertions scan the whole payload
/// rather than a hand-picked list of fields - a future field that leaks a
/// hash or token would still be caught.
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

describe('GET /users/me/export', () => {
  it('rejects an anonymous caller with 401', async () => {
    const res = await request(app).get('/api/v1/users/me/export');
    expect(res.status).toBe(401);
  });

  it('returns everything the caller owns: account, recipes, posts, comments, reactions, follows, cookbook saves and collections', async () => {
    const owner = await registerUser(app, { password: PASSWORD });
    const other = await registerUser(app);

    const recipe = await createRecipe(app, owner.accessToken);
    const post = await createPost(app, owner.accessToken, recipe.id);
    const ownComment = await createComment(app, owner.accessToken, post.id, 'My own comment');

    // A comment and reaction the owner leaves on someone else's post, to
    // prove comments/reactions are gathered by author, not by post owner.
    const otherRecipe = await createRecipe(app, other.accessToken);
    const otherPost = await createPost(app, other.accessToken, otherRecipe.id);
    const commentOnOther = await createComment(app, owner.accessToken, otherPost.id, 'On someone else post');
    await request(app)
      .put(`/api/v1/posts/${otherPost.id}/reactions`)
      .set(...authHeader(owner.accessToken))
      .send({ emoji: '🔥' });

    // Follows: owner follows other, and other follows owner back.
    await request(app).post(`/api/v1/users/${other.id}/follow`).set(...authHeader(owner.accessToken));
    await request(app).post(`/api/v1/users/${owner.id}/follow`).set(...authHeader(other.accessToken));

    // Cookbook save + a collection containing that saved recipe.
    await request(app).post(`/api/v1/recipes/${otherRecipe.id}/save`).set(...authHeader(owner.accessToken));
    const collection = await createCollection(app, owner.accessToken, { name: 'Favourites' });
    await request(app)
      .post(`/api/v1/users/me/collections/${collection.id}/recipes`)
      .set(...authHeader(owner.accessToken))
      .send({ recipeId: otherRecipe.id });

    const res = await request(app).get('/api/v1/users/me/export').set(...authHeader(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(owner.id);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.body;
    expect(body.format).toBe('melo.user-data-export.v1');
    expect(typeof body.exportedAt).toBe('string');

    expect(body.account).toMatchObject({
      id: owner.id,
      username: owner.username,
      email: owner.email,
      deletionRequestedAt: null,
    });

    expect(body.recipes.items.map((r: { id: string }) => r.id)).toContain(recipe.id);
    const exportedRecipe = body.recipes.items.find((r: { id: string }) => r.id === recipe.id);
    expect(exportedRecipe.imageUrl).toEqual(expect.stringMatching(/^https?:\/\//));
    expect(exportedRecipe.ingredients.length).toBeGreaterThan(0);

    expect(body.posts.items.map((p: { id: string }) => p.id)).toContain(post.id);
    const exportedPost = body.posts.items.find((p: { id: string }) => p.id === post.id);
    expect(exportedPost.images[0].url).toEqual(expect.stringMatching(/^https?:\/\//));

    const commentIds = body.comments.items.map((c: { id: string }) => c.id);
    expect(commentIds).toContain(ownComment.id);
    expect(commentIds).toContain(commentOnOther.id);

    expect(body.reactions.items).toEqual([
      expect.objectContaining({ postId: otherPost.id, emoji: '🔥' }),
    ]);

    expect(body.follows.following.items.map((u: { id: string }) => u.id)).toEqual([other.id]);
    expect(body.follows.followers.items.map((u: { id: string }) => u.id)).toEqual([other.id]);
    // Only id and username for the other party, never their email.
    expect(Object.keys(body.follows.following.items[0]).sort()).toEqual(['id', 'username']);

    expect(body.cookbookSaves.items.map((s: { recipeId: string }) => s.recipeId)).toContain(otherRecipe.id);

    expect(body.collections.items.map((c: { id: string }) => c.id)).toContain(collection.id);
    const exportedCollection = body.collections.items.find((c: { id: string }) => c.id === collection.id);
    expect(exportedCollection.recipes.items.map((r: { recipeId: string }) => r.recipeId)).toEqual([
      otherRecipe.id,
    ]);
  });

  it('never includes password hashes or token material anywhere in the payload', async () => {
    const owner = await registerUser(app, { password: PASSWORD });
    const recipe = await createRecipe(app, owner.accessToken);
    await createPost(app, owner.accessToken, recipe.id);

    const res = await request(app).get('/api/v1/users/me/export').set(...authHeader(owner.accessToken));
    expect(res.status).toBe(200);

    // Scan every string in the serialised payload rather than named fields,
    // so a future field that accidentally carries a hash or token is caught
    // even if no test author remembered to name it.
    const strings = collectStrings(res.body);
    const serialised = JSON.stringify(res.body);

    // A bcrypt hash always starts with one of these prefixes and is ~60 chars.
    expect(strings.some((s) => /^\$2[aby]\$\d{2}\$/.test(s))).toBe(false);
    // The access/refresh tokens issued to this very user must not appear.
    expect(serialised).not.toContain(owner.accessToken);
    expect(serialised).not.toContain(owner.refreshToken);
    expect(serialised.toLowerCase()).not.toContain('passwordhash');
    expect(serialised.toLowerCase()).not.toContain('refreshtoken');
  });

  it("never includes another user's private data", async () => {
    const owner = await registerUser(app, { password: PASSWORD });
    const other = await registerUser(app, { password: PASSWORD });

    await request(app).post(`/api/v1/users/${owner.id}/follow`).set(...authHeader(other.accessToken));

    const res = await request(app).get('/api/v1/users/me/export').set(...authHeader(owner.accessToken));
    expect(res.status).toBe(200);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(other.email);

    // The follower entry exposes only id/username for the other party.
    expect(res.body.follows.followers.items).toEqual([
      { id: other.id, username: other.username },
    ]);
  });

  it('still works for a pending-deletion account', async () => {
    const user = await registerUser(app, { password: PASSWORD });
    const recipe = await createRecipe(app, user.accessToken);
    await createPost(app, user.accessToken, recipe.id);

    await request(app)
      .delete('/api/v1/users/me')
      .set(...authHeader(user.accessToken))
      .send({ password: PASSWORD });

    const res = await request(app).get('/api/v1/users/me/export').set(...authHeader(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.account.deletionRequestedAt).not.toBeNull();
    expect(res.body.recipes.items.map((r: { id: string }) => r.id)).toContain(recipe.id);
  });
});
