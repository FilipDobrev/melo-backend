import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as cookbookController from '../controllers/cookbook.controller';
import { recipeIdParamsSchema, listCookbookQuerySchema } from '../dto/cookbook.dto';

/// Mounted on recipeRouter -> /recipes/:recipeId/save
export const cookbookSaveRouter = Router({ mergeParams: true });

cookbookSaveRouter.post(
  '/:recipeId/save',
  requireAuth,
  validate({ params: recipeIdParamsSchema }),
  asyncHandler(cookbookController.save),
);

cookbookSaveRouter.delete(
  '/:recipeId/save',
  requireAuth,
  validate({ params: recipeIdParamsSchema }),
  asyncHandler(cookbookController.remove),
);

/// Mounted on userRouter -> /users/me/cookbook
export const cookbookListRouter = Router();

cookbookListRouter.get(
  '/me/cookbook',
  requireAuth,
  validate({ query: listCookbookQuerySchema }),
  asyncHandler(cookbookController.listCookbook),
);
