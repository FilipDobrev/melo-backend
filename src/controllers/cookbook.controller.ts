import { getUserId } from '../middleware/auth';
import * as cookbookService from '../services/cookbook.service';
import type { SavedRecipeSummary } from '../repositories/cookbook.repository';
import type { ListCookbookQuery } from '../dto/cookbook.dto';
import type { Page } from '../lib/pagination';
import type { RecipeIdParams, TypedRequest, TypedResponse } from '../types/http';

export async function save(
  req: TypedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { recipeId } = req.params;
  await cookbookService.saveRecipe(getUserId(req), recipeId);
  res.status(204).send();
}

export async function remove(
  req: TypedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { recipeId } = req.params;
  await cookbookService.removeSavedRecipe(getUserId(req), recipeId);
  res.status(204).send();
}

export async function listCookbook(
  req: TypedRequest<void, ListCookbookQuery>,
  res: TypedResponse<Page<SavedRecipeSummary>>,
): Promise<void> {
  const { cursor, limit, categorySlugs } = req.query;
  const page = await cookbookService.listCookbook(getUserId(req), cursor, limit, categorySlugs);
  res.status(200).json(page);
}
