import { NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import * as cookbookRepository from '../repositories/cookbook.repository';
import type { SavedRecipeSummary } from '../repositories/cookbook.repository';

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
): Promise<Page<SavedRecipeSummary>> {
  const rows = await cookbookRepository.listSavedRecipes(currentUserId, cursor, limit, categorySlugs);
  return toPage(rows, limit);
}
