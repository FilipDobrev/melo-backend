import type { CreateRecipeInput, CreateRecipeUploadUrlInput, ListRecipesQuery, UpdateRecipeInput } from '../dto/recipe.dto';
import type { CursorPagination, Page } from '../lib/pagination';
import { recordAuditEvent } from '../lib/audit';
import * as recipeService from '../services/recipe.service';
import type { RecipeDetail, RecipeSummary } from '../services/recipe.service';
import { listRecipeImagePresets, type RecipeImagePresetDto } from '../services/recipeImage';
import type { CreateUploadUrlResult } from '../services/storage.service';
import type {
  AuthorizedRequest,
  RecipeIdParams,
  TypedResponse,
  UnauthorizedRequest,
  UserIdParams,
} from '../types/http';

/** Lists recipes, optionally filtered/sorted per query. */
export async function listRecipes(
  req: UnauthorizedRequest<void, ListRecipesQuery>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipes(req.query);
  res.json(page);
}

/** Gets a single recipe. */
export async function getRecipe(
  req: UnauthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.getRecipeDetail(req.params.recipeId, req.userId);
  res.json(recipe);
}

/** Creates a recipe owned by the caller. Responds 201. */
export async function createRecipe(
  req: AuthorizedRequest<CreateRecipeInput>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.createRecipe(req.userId, req.body);
  recordAuditEvent({
    action: 'recipe.created',
    actorId: req.userId,
    resourceType: 'recipe',
    resourceId: recipe.id,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.status(201).json(recipe);
}

/** Updates a recipe owned by the caller. */
export async function updateRecipe(
  req: AuthorizedRequest<UpdateRecipeInput, unknown, RecipeIdParams>,
  res: TypedResponse<RecipeDetail>,
): Promise<void> {
  const recipe = await recipeService.updateRecipe(req.params.recipeId, req.userId, req.body);
  recordAuditEvent({
    action: 'recipe.updated',
    actorId: req.userId,
    resourceType: 'recipe',
    resourceId: recipe.id,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.json(recipe);
}

/** Deletes a recipe owned by the caller. Responds 204. */
export async function deleteRecipe(
  req: AuthorizedRequest<void, unknown, RecipeIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await recipeService.deleteRecipe(req.params.recipeId, req.userId);
  recordAuditEvent({
    action: 'recipe.deleted',
    actorId: req.userId,
    resourceType: 'recipe',
    resourceId: req.params.recipeId,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.status(204).send();
}

/** Requests a presigned URL to upload a recipe image. */
export async function createUploadUrl(
  req: AuthorizedRequest<CreateRecipeUploadUrlInput>,
  res: TypedResponse<CreateUploadUrlResult>,
): Promise<void> {
  const result = await recipeService.createRecipeImageUploadUrl(
    req.userId,
    req.body.contentType,
    req.body.contentLength,
  );
  res.status(200).json(result);
}

/** Lists the built-in recipe image presets. */
export async function listImagePresets(
  _req: UnauthorizedRequest,
  res: TypedResponse<RecipeImagePresetDto[]>,
): Promise<void> {
  res.status(200).json(listRecipeImagePresets());
}

/** Lists a user's recipes. */
export async function listRecipesByUser(
  req: UnauthorizedRequest<void, CursorPagination, UserIdParams>,
  res: TypedResponse<Page<RecipeSummary>>,
): Promise<void> {
  const page = await recipeService.listRecipesByOwner(req.params.userId, req.query);
  res.json(page);
}
