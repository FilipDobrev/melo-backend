// Mount on BOTH recipeRouter (for the /:recipeId/save endpoints, resolving
// to /recipes/:recipeId/save) and userRouter (for /me/cookbook, resolving
// to /users/me/cookbook). Each parent only exercises the paths relevant to
// its own prefix; the other path is simply unused dead weight on that base.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as cookbookController from '../controllers/cookbook.controller';
import { recipeIdParamsSchema, listCookbookQuerySchema } from '../dto/cookbook.dto';

export const cookbookRouter = Router({ mergeParams: true });

cookbookRouter.post(
  '/:recipeId/save',
  requireAuth,
  validate({ params: recipeIdParamsSchema }),
  asyncHandler(cookbookController.save),
);

cookbookRouter.delete(
  '/:recipeId/save',
  requireAuth,
  validate({ params: recipeIdParamsSchema }),
  asyncHandler(cookbookController.remove),
);

cookbookRouter.get(
  '/me/cookbook',
  requireAuth,
  validate({ query: listCookbookQuerySchema }),
  asyncHandler(cookbookController.listCookbook),
);
