import { Router } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import * as recipeController from '../controllers/recipe.controller';
import {
  createRecipeSchema,
  createRecipeUploadUrlSchema,
  listRecipesQuerySchema,
  recipeIdParamsSchema,
  updateRecipeSchema,
  type CreateRecipeUploadUrlInput,
} from '../dto/recipe.dto';
import { userIdParamsSchema } from '../dto/user.dto';
import { cursorPaginationSchema } from '../lib/pagination';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import { optionalAuth } from '../middleware/auth';
import { uploadUrlRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { cookbookSaveRouter } from './cookbook.routes';

export const recipeRouter = Router();

/// Cookbook save/unsave lives on the recipe path; owned by the cookbook slice.
recipeRouter.use(cookbookSaveRouter);

recipeRouter.get(
  '/',
  validate({ query: listRecipesQuerySchema }),
  optionalAuth,
  asyncHandler(recipeController.listRecipes),
);

/// Literal paths must be registered before `/:recipeId`, or express would
/// swallow them as a recipe id lookup instead.
recipeRouter.post<ParamsDictionary, unknown, CreateRecipeUploadUrlInput>(
  '/images/upload-url',
  uploadUrlRateLimiter,
  validate({ body: createRecipeUploadUrlSchema }),
  ...authed(recipeController.createUploadUrl),
);

recipeRouter.get(
  '/image-presets',
  asyncHandler(recipeController.listImagePresets),
);

recipeRouter.get(
  '/:recipeId',
  validate({ params: recipeIdParamsSchema }),
  optionalAuth,
  asyncHandler(recipeController.getRecipe),
);

recipeRouter.post(
  '/',
  validate({ body: createRecipeSchema }),
  ...authed(recipeController.createRecipe),
);

recipeRouter.patch(
  '/:recipeId',
  validate({ params: recipeIdParamsSchema, body: updateRecipeSchema }),
  ...authed(recipeController.updateRecipe),
);

recipeRouter.delete(
  '/:recipeId',
  validate({ params: recipeIdParamsSchema }),
  ...authed(recipeController.deleteRecipe),
);

/// Mounts on userRouter as GET /users/:userId/recipes. Not wired here -
/// the owner of user.routes.ts mounts this router.
export const userRecipeRouter = Router();

userRecipeRouter.get(
  '/:userId/recipes',
  validate({ params: userIdParamsSchema, query: cursorPaginationSchema }),
  optionalAuth,
  asyncHandler(recipeController.listRecipesByUser),
);
