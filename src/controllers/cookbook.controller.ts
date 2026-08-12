import type { Request, Response } from 'express';
import { getUserId } from '../middleware/auth';
import * as cookbookService from '../services/cookbook.service';
import { recipeIdParamsSchema, listCookbookQuerySchema } from '../dto/cookbook.dto';
import type { RecipeIdParams, ListCookbookQuery } from '../dto/cookbook.dto';

/// `validate()` already parsed req.params/req.query against these schemas
/// before the handler runs; re-parsing here just recovers the precise type
/// (Express types params/query as loose string dictionaries) without an
/// `as` assertion.
function params(req: Request): RecipeIdParams {
  return recipeIdParamsSchema.parse(req.params);
}
function query(req: Request): ListCookbookQuery {
  return listCookbookQuerySchema.parse(req.query);
}

export async function save(req: Request, res: Response): Promise<void> {
  const currentUserId = getUserId(req);
  const { recipeId } = params(req);
  await cookbookService.saveRecipe(currentUserId, recipeId);
  res.status(204).send();
}

export async function remove(req: Request, res: Response): Promise<void> {
  const currentUserId = getUserId(req);
  const { recipeId } = params(req);
  await cookbookService.removeSavedRecipe(currentUserId, recipeId);
  res.status(204).send();
}

export async function listCookbook(req: Request, res: Response): Promise<void> {
  const currentUserId = getUserId(req);
  const { cursor, limit, categorySlugs } = query(req);
  const page = await cookbookService.listCookbook(currentUserId, cursor, limit, categorySlugs);
  res.status(200).json(page);
}
