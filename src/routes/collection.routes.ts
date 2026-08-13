import { Router } from 'express';
import { authed } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import * as collectionController from '../controllers/collection.controller';
import {
  addCollectionRecipeSchema,
  collectionIdParamsSchema,
  collectionRecipeParamsSchema,
  createCollectionSchema,
  listCollectionRecipesQuerySchema,
  updateCollectionSchema,
} from '../dto/collection.dto';

/// Mounted on userRouter -> /users/me/collections
export const collectionRouter = Router();

collectionRouter.get('/me/collections', ...authed(collectionController.list));

collectionRouter.post(
  '/me/collections',
  validate({ body: createCollectionSchema }),
  ...authed(collectionController.create),
);

collectionRouter.patch(
  '/me/collections/:collectionId',
  validate({ params: collectionIdParamsSchema, body: updateCollectionSchema }),
  ...authed(collectionController.rename),
);

collectionRouter.delete(
  '/me/collections/:collectionId',
  validate({ params: collectionIdParamsSchema }),
  ...authed(collectionController.remove),
);

collectionRouter.get(
  '/me/collections/:collectionId/recipes',
  validate({ params: collectionIdParamsSchema, query: listCollectionRecipesQuerySchema }),
  ...authed(collectionController.listRecipes),
);

collectionRouter.post(
  '/me/collections/:collectionId/recipes',
  validate({ params: collectionIdParamsSchema, body: addCollectionRecipeSchema }),
  ...authed(collectionController.addRecipe),
);

collectionRouter.delete(
  '/me/collections/:collectionId/recipes/:recipeId',
  validate({ params: collectionRecipeParamsSchema }),
  ...authed(collectionController.removeRecipe),
);
