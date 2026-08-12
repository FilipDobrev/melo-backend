import type { CreateRecipeInput, ListRecipesQuery, UpdateRecipeInput } from '../dto/recipe.dto';
import type { CursorPagination, Page } from '../lib/pagination';
import * as recipeService from '../services/recipe.service';
import type { RecipeDetail, RecipeSummary } from '../services/recipe.service';
import type {
  AuthorizedRequest,
  RecipeIdParams,
  TypedResponse,
  UnauthorizedRequest,
  UserIdParams,
} from '../types/http';

export async function listRecipes(
  req: UnauthorizedRequest<void, ListRecipesQuery>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipes(req.query);
  res.json(page);
}

export async function getRecipe(
  req: UnauthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.getRecipeDetail(req.params.recipeId, req.userId);
  res.json(recipe);
}

export async function createRecipe(
  req: AuthorizedRequest<CreateRecipeInput>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.createRecipe(req.userId, req.body);
  res.status(201).json(recipe);
}

export async function updateRecipe(
  req: AuthorizedRequest<UpdateRecipeInput, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.updateRecipe(req.params.recipeId, req.userId, req.body);
  res.json(recipe);
}

export async function deleteRecipe(
  req: AuthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await recipeService.deleteRecipe(req.params.recipeId, req.userId);
  res.status(204).send();
}

export async function listRecipesByUser(
  req: UnauthorizedRequest<void, CursorPagination, UserIdParams>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipesByOwner(req.params.userId, req.query);
  res.json(page);
}
