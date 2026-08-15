import { Router } from 'express';
import { authed } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import * as cookbookController from '../controllers/cookbook.controller';
import { recipeIdParamsSchema, listCookbookQuerySchema } from '../dto/cookbook.dto';

/** Mounted on recipeRouter -> /recipes/:recipeId/save */
export const cookbookSaveRouter = Router({ mergeParams: true });

cookbookSaveRouter.post(
  '/:recipeId/save',
  validate({ params: recipeIdParamsSchema }),
  ...authed(cookbookController.save),
);

cookbookSaveRouter.delete(
  '/:recipeId/save',
  validate({ params: recipeIdParamsSchema }),
  ...authed(cookbookController.remove),
);

/** Mounted on userRouter -> /users/me/cookbook */
export const cookbookListRouter = Router();

cookbookListRouter.get(
  '/me/cookbook',
  validate({ query: listCookbookQuerySchema }),
  ...authed(cookbookController.listCookbook),
);
