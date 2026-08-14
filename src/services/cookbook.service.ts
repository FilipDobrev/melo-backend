import { NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as cookbookRepository from '../repositories/cookbook.repository';
import type { SavedRecipeSummary } from '../repositories/cookbook.repository';
import { resolveRecipeImageUrl } from './recipeImage';

/// The client only needs the resolved URL, never the raw storage
/// convention, so `imageKey` is dropped in favor of `imageUrl` here.
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

export async function saveRecipe(currentUserId: string, recipeId: string): Promise<void> {
  const exists = await cookbookRepository.recipeExists(recipeId);
  if (!exists) {
    throw new NotFoundError('Recipe not found');
  }
  // Duplicate saves are rejected by the DB unique constraint (P2002 -> 409),
  // avoiding a read-then-write race.
  await cookbookRepository.createSave(currentUserId, recipeId);
}

export async function removeSavedRecipe(currentUserId: string, recipeId: string): Promise<void> {
  // A missing row raises P2025 -> 404, handled by the error middleware.
  await cookbookRepository.deleteSave(currentUserId, recipeId);
}

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
