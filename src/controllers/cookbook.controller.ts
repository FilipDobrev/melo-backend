import * as cookbookService from '../services/cookbook.service';
import type { SavedRecipeCard } from '../services/cookbook.service';
import type { ListCookbookQuery } from '../dto/cookbook.dto';
import type { Page } from '../lib/pagination';
import type { AuthorizedRequest, RecipeIdParams, TypedResponse } from '../types/http';

export async function save(
  req: AuthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { recipeId } = req.params;
  await cookbookService.saveRecipe(req.userId, recipeId);
  res.status(204).send();
}

export async function remove(
  req: AuthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { recipeId } = req.params;
  await cookbookService.removeSavedRecipe(req.userId, recipeId);
  res.status(204).send();
}

export async function listCookbook(
  req: AuthorizedRequest<void, ListCookbookQuery>,
  res: TypedResponse<Page<SavedRecipeCard>>,
): Promise<void> {
  const { cursor, limit, categorySlugs } = req.query;
  const page = await cookbookService.listCookbook(req.userId, cursor, limit, categorySlugs);
  res.status(200).json(page);
}
