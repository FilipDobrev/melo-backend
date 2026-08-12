import type { Request, Response } from 'express';
import type { CreateRecipeInput, ListRecipesQuery, RecipeIdParams, UpdateRecipeInput } from '../dto/recipe.dto';
import type { UserIdParams } from '../dto/user.dto';
import type { CursorPagination } from '../lib/pagination';
import { getUserId } from '../middleware/auth';
import * as recipeService from '../services/recipe.service';

export async function listRecipes(
  req: Request<unknown, unknown, unknown, ListRecipesQuery>,
  res: Response,
): Promise<void> {
  const page = await recipeService.listRecipes(req.query);
  res.json(page);
}

export async function getRecipe(req: Request<RecipeIdParams>, res: Response): Promise<void> {
  const recipe = await recipeService.getRecipeDetail(req.params.recipeId, req.user?.id);
  res.json(recipe);
}

export async function createRecipe(
  req: Request<unknown, unknown, CreateRecipeInput>,
  res: Response,
): Promise<void> {
  const recipe = await recipeService.createRecipe(getUserId(req), req.body);
  res.status(201).json(recipe);
}

export async function updateRecipe(
  req: Request<RecipeIdParams, unknown, UpdateRecipeInput>,
  res: Response,
): Promise<void> {
  const recipe = await recipeService.updateRecipe(req.params.recipeId, getUserId(req), req.body);
  res.json(recipe);
}

export async function deleteRecipe(req: Request<RecipeIdParams>, res: Response): Promise<void> {
  await recipeService.deleteRecipe(req.params.recipeId, getUserId(req));
  res.status(204).send();
}

export async function listRecipesByUser(
  req: Request<UserIdParams, unknown, unknown, CursorPagination>,
  res: Response,
): Promise<void> {
  const page = await recipeService.listRecipesByOwner(req.params.userId, req.query);
  res.json(page);
}
