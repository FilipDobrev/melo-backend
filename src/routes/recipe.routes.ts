import { Router } from 'express';
import * as recipeController from '../controllers/recipe.controller';
import {
  createRecipeSchema,
  listRecipesQuerySchema,
  recipeIdParamsSchema,
  updateRecipeSchema,
} from '../dto/recipe.dto';
import { userIdParamsSchema } from '../dto/user.dto';
import { cursorPaginationSchema } from '../lib/pagination';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requireAuth } from '../middleware/auth';
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

recipeRouter.get(
  '/:recipeId',
  validate({ params: recipeIdParamsSchema }),
  optionalAuth,
  asyncHandler(recipeController.getRecipe),
);

recipeRouter.post(
  '/',
  requireAuth,
  validate({ body: createRecipeSchema }),
  asyncHandler(recipeController.createRecipe),
);

recipeRouter.patch(
  '/:recipeId',
  requireAuth,
  validate({ params: recipeIdParamsSchema, body: updateRecipeSchema }),
  asyncHandler(recipeController.updateRecipe),
);

recipeRouter.delete(
  '/:recipeId',
  requireAuth,
  validate({ params: recipeIdParamsSchema }),
  asyncHandler(recipeController.deleteRecipe),
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
