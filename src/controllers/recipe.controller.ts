import type { CreateRecipeInput, ListRecipesQuery, UpdateRecipeInput } from '../dto/recipe.dto';
import type { CursorPagination, Page } from '../lib/pagination';
import { getUserId } from '../middleware/auth';
import * as recipeService from '../services/recipe.service';
import type { RecipeDetail, RecipeSummary } from '../services/recipe.service';
import type { RecipeIdParams, TypedRequest, TypedResponse, UserIdParams } from '../types/http';

export async function listRecipes(
  req: TypedRequest<void, ListRecipesQuery>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipes(req.query);
  res.json(page);
}

export async function getRecipe(
  req: TypedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.getRecipeDetail(req.params.recipeId, req.user?.id);
  res.json(recipe);
}

export async function createRecipe(
  req: TypedRequest<CreateRecipeInput>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.createRecipe(getUserId(req), req.body);
  res.status(201).json(recipe);
}

export async function updateRecipe(
  req: TypedRequest<UpdateRecipeInput, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.updateRecipe(req.params.recipeId, getUserId(req), req.body);
  res.json(recipe);
}

export async function deleteRecipe(
  req: TypedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await recipeService.deleteRecipe(req.params.recipeId, getUserId(req));
  res.status(204).send();
}

export async function listRecipesByUser(
  req: TypedRequest<void, CursorPagination, UserIdParams>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipesByOwner(req.params.userId, req.query);
  res.json(page);
}
