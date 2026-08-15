import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import * as recipeRepository from '../repositories/recipe.repository';
import * as userRepository from '../repositories/user.repository';
import * as storageService from './storage.service';

/**
 * Fixed, reserved account that inherits recipes a purged user can't take
 * with them (see {@link purgeUser}). The email uses the `.invalid` TLD,
 * reserved by RFC 2606 specifically so it can never resolve or receive mail,
 * and the password hash is a random value nobody knows, generated once when
 * the account is first created - so it can never be logged into either.
 */
const TOMBSTONE_USERNAME = 'deleted-user';
const TOMBSTONE_EMAIL = 'deleted-accounts@melo.invalid';

/**
 * Idempotent: looked up by its fixed email first, and only created if
 * missing. If two purge runs race to create it, the loser's unique
 * constraint violation is treated as "someone else just created it" and the
 * winner's row is looked up and returned instead of failing the purge.
 */
export async function getOrCreateTombstoneUser(db = prisma): Promise<User> {
  const existing = await userRepository.findByEmail(TOMBSTONE_EMAIL, db);
  if (existing) return existing;

  const unusablePassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(unusablePassword, env.BCRYPT_ROUNDS);

  try {
    return await userRepository.create(
      { username: TOMBSTONE_USERNAME, email: TOMBSTONE_EMAIL, passwordHash },
      db,
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const createdByAnotherRun = await userRepository.findByEmail(TOMBSTONE_EMAIL, db);
      if (createdByAnotherRun) return createdByAnotherRun;
    }
    throw err;
  }
}

export interface PurgeResult {
  userId: string;
  reassignedRecipeIds: string[];
  deletedObjectCount: number;
  /** Storage prefixes that failed to fully clean up. Empty on a fully clean
   * purge; non-empty means objects were left behind in the bucket and need
   * manual follow-up - see {@link purgeUser} for why the purge still
   * proceeds rather than aborting. */
  storageErrors: string[];
}

/**
 * Purges one user, in the order that keeps other users' data intact:
 *
 * 1. Reassigns any recipe that a DIFFERENT user's post depends on to the
 *    tombstone account, so those posts survive `Post.recipeId` ->
 *    `Recipe` -> `Recipe.ownerId` -> `User`'s cascade chain. Every other
 *    recipe this user owns is left alone here and removed by the user-row
 *    cascade in step 3.
 * 2. Deletes this user's stored objects under `posts/<userId>/`,
 *    `recipes/<userId>/` and `avatars/<userId>/`, excluding the image keys
 *    of recipes just reassigned in step 1 - those objects are still
 *    referenced by a retained recipe, even though it now belongs to the
 *    tombstone account, because the key itself never moves.
 * 3. Deletes the user row. The schema's cascades remove everything else:
 *    remaining recipes, posts, comments, reactions, follows, cookbook
 *    saves, collections and refresh tokens.
 *
 * A failure deleting one of the three storage prefixes is caught, logged at
 * error level (never swallowed - it comes back on `storageErrors` too, so
 * the caller's success log line always shows it) and does NOT stop the
 * purge: the database deletion still runs. This is deliberate - the
 * database side is what actually satisfies account deletion / GDPR erasure
 * (the account, profile, posts and comments a user asked to have removed),
 * while a handful of orphaned objects in the bucket are a cleanup detail
 * that can be fixed later without holding the account hostage to a storage
 * outage. The alternative (abort on storage failure) would leave a "pending
 * deletion" account stuck forever if the bucket is ever unreachable for the
 * whole grace-period-plus-retry window, which is worse.
 */
export async function purgeUser(userId: string): Promise<PurgeResult> {
  const tombstone = await getOrCreateTombstoneUser();

  const recipesToReassign = await recipeRepository.findRecipesNeedingReassignment(userId);
  if (recipesToReassign.length > 0) {
    await recipeRepository.reassignRecipes(
      recipesToReassign.map((recipe) => recipe.id),
      tombstone.id,
    );
  }
  const keepKeys = new Set(
    recipesToReassign.map((recipe) => recipe.imageKey).filter((key): key is string => key !== null),
  );

  const prefixes: Array<{ prefix: string; keep?: ReadonlySet<string> }> = [
    { prefix: `posts/${userId}/` },
    { prefix: `recipes/${userId}/`, keep: keepKeys },
    { prefix: `avatars/${userId}/` },
  ];

  let deletedObjectCount = 0;
  const storageErrors: string[] = [];
  for (const { prefix, keep } of prefixes) {
    try {
      deletedObjectCount += await storageService.deleteByPrefix(prefix, keep);
    } catch (error) {
      storageErrors.push(prefix);
      logger.error(
        { error, userId, prefix },
        'failed to delete storage objects during account purge; database purge proceeds regardless, orphaned objects need manual cleanup',
      );
    }
  }

  await userRepository.deleteUser(userId);

  return {
    userId,
    reassignedRecipeIds: recipesToReassign.map((recipe) => recipe.id),
    deletedObjectCount,
    storageErrors,
  };
}

/**
 * Finds every user whose grace period has elapsed and purges them one at a
 * time - sequentially, not in parallel, so one user's storage failure (see
 * {@link purgeUser}) can't interleave with another's and so the tombstone
 * account's idempotent creation never races against itself. Safe to re-run:
 * a user that failed to purge is simply found again (its
 * `deletionRequestedAt` is untouched by a failed attempt) and retried on the
 * next run, and a run with nothing eligible does nothing.
 */
export async function purgeEligibleUsers(): Promise<PurgeResult[]> {
  const cutoff = new Date(Date.now() - env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const eligible = await userRepository.findPendingDeletionOlderThan(cutoff);

  const results: PurgeResult[] = [];
  for (const user of eligible) {
    try {
      const result = await purgeUser(user.id);
      logger.info(
        {
          userId: result.userId,
          reassignedRecipeCount: result.reassignedRecipeIds.length,
          deletedObjectCount: result.deletedObjectCount,
          storageErrors: result.storageErrors,
        },
        'purged deleted user',
      );
      results.push(result);
    } catch (error) {
      logger.error({ error, userId: user.id }, 'failed to purge deleted user; will retry next run');
    }
  }
  return results;
}
