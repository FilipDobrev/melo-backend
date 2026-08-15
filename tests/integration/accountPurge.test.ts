import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers/testApp';
import { authHeader, createPost, createRecipe, registerUser } from './helpers/factories';
import { prisma } from '../../src/lib/prisma';
import { env } from '../../src/config/env';
import { purgeEligibleUsers, purgeUser } from '../../src/services/accountPurge.service';

const PASSWORD = 'CorrectHorse1!';

/** Backdates a user's deletionRequestedAt past the grace period, as if the
 * grace period had genuinely elapsed - the HTTP API has no way to fabricate
 * that passage of time, so this writes the row directly, the same technique
 * contract.auth.test.ts uses to backdate a refresh token's expiry. */
async function requestAndBackdateDeletion(userId: string, accessToken: string): Promise<void> {
  const res = await request(app)
    .delete('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ password: PASSWORD });
  expect(res.status).toBe(204);

  const cutoff = new Date(
    Date.now() - (env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000 + 60_000),
  );
  await prisma.user.update({ where: { id: userId }, data: { deletionRequestedAt: cutoff } });
}

describe('account purge', () => {
  it('does nothing when no account is past its grace period', async () => {
    const user = await registerUser(app, { password: PASSWORD });

    const results = await purgeEligibleUsers();

    expect(results).toEqual([]);
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row).not.toBeNull();
  });

  it('reassigns a recipe another user depends on, deletes an unreferenced recipe, and deletes the user', async () => {
    const victim = await registerUser(app, { password: PASSWORD });
    const other = await registerUser(app);

    // `other` cooks victim's recipe and posts about it - a post is not
    // required to be about the poster's own recipe, so this is legitimate.
    const sharedRecipe = await createRecipe(app, victim.accessToken);
    const dependentPost = await createPost(app, other.accessToken, sharedRecipe.id);

    // A second recipe nobody else's post depends on.
    const unreferencedRecipe = await createRecipe(app, victim.accessToken);

    await requestAndBackdateDeletion(victim.id, victim.accessToken);

    const results = await purgeEligibleUsers();

    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe(victim.id);
    expect(results[0]?.reassignedRecipeIds).toEqual([sharedRecipe.id]);

    // The user row, and everything that belonged only to them, is gone.
    const victimRow = await prisma.user.findUnique({ where: { id: victim.id } });
    expect(victimRow).toBeNull();
    const unreferencedRow = await prisma.recipe.findUnique({ where: { id: unreferencedRecipe.id } });
    expect(unreferencedRow).toBeNull();

    // The shared recipe survives, reassigned away from the deleted user...
    const sharedRow = await prisma.recipe.findUnique({ where: { id: sharedRecipe.id } });
    expect(sharedRow).not.toBeNull();
    expect(sharedRow?.ownerId).not.toBe(victim.id);
    // ...to the reserved tombstone account, created idempotently.
    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: sharedRow!.ownerId } });
    expect(tombstone.username).toBe('deleted-user');
    expect(tombstone.email).toBe('deleted-accounts@melo.invalid');

    // `other`'s post, which depends on that recipe, was never touched.
    const postRow = await prisma.post.findUnique({ where: { id: dependentPost.id } });
    expect(postRow).not.toBeNull();
    const postDetailRes = await request(app).get(`/api/v1/posts/${dependentPost.id}`);
    expect(postDetailRes.status).toBe(200);
  });

  it('re-running the purge, and purging a second user, reuses the same tombstone account', async () => {
    const first = await registerUser(app, { password: PASSWORD });
    await requestAndBackdateDeletion(first.id, first.accessToken);
    await purgeUser(first.id);

    const second = await registerUser(app, { password: PASSWORD });
    const recipe = await createRecipe(app, second.accessToken);
    const other = await registerUser(app);
    await createPost(app, other.accessToken, recipe.id);
    await requestAndBackdateDeletion(second.id, second.accessToken);
    await purgeUser(second.id);

    const tombstones = await prisma.user.findMany({ where: { username: 'deleted-user' } });
    expect(tombstones).toHaveLength(1);
  });
});
