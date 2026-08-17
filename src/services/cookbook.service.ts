import { NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { resolveProfileImage } from '../lib/profileImage';
import * as collectionRepository from '../repositories/collection.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import type { SavedRecipeSummary } from '../repositories/cookbook.repository';
import { resolveRecipeImageUrl } from './recipeImage';

/**
 * The client only needs the resolved URL, never the raw storage convention, so `imageKey` is
 * dropped in favor of `imageUrl` here.
 */
export interface SavedRecipeCard extends Omit<SavedRecipeSummary, 'imageKey'> {
  imageUrl: string;
}

export function toSavedRecipeCard(recipe: SavedRecipeSummary): SavedRecipeCard {
  const { imageKey, owner, ...rest } = recipe;
  return {
    ...rest,
    owner: { ...owner, profileImage: resolveProfileImage(owner.profileImage) },
    imageUrl: resolveRecipeImageUrl(imageKey),
  };
}

/**
 * @throws {NotFoundError} if the recipe does not exist.
 * @throws A duplicate save is rejected by the DB's unique constraint (Prisma P2002 -> 409),
 * avoiding a read-then-write race.
 */
export async function saveRecipe(currentUserId: string, recipeId: string): Promise<void> {
  const exists = await cookbookRepository.recipeExists(recipeId);
  if (!exists) {
    throw new NotFoundError('Recipe not found');
  }
  await cookbookRepository.createSave(currentUserId, recipeId);
}

/**
 * Unsaving a recipe also removes it from every one of the caller's collections in the same
 * transaction, since a collection can never reference a recipe that isn't in the cookbook (see
 * the Collection model doc comment in schema.prisma). This information is not recoverable: a
 * later re-save does not restore the old collection memberships.
 * @throws A missing save row raises Prisma P2025, mapped to 404 by the error middleware; the
 * transaction rolls back, so the caller's collections are left untouched in that case.
 */
export async function removeSavedRecipe(currentUserId: string, recipeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await cookbookRepository.deleteSave(currentUserId, recipeId, tx);
    await collectionRepository.removeRecipeFromAllCollections(currentUserId, recipeId, tx);
  });
}

/** Lists the recipes a user has saved, optionally filtered to a set of category slugs. */
export async function listCookbook(
  currentUserId: string,
  cursor: string | undefined,
  limit: number,
  categorySlugs: string[] | undefined,
): Promise<Page<SavedRecipeCard>> {
  const rows = await cookbookRepository.listSavedRecipes(currentUserId, cursor, limit, categorySlugs);
  const page = toPage(rows, limit);
  return { items: page.items.map(toSavedRecipeCard), nextCursor: page.nextCursor };
}
