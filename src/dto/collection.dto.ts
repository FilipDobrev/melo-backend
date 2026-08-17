import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** When given, the recipe is added to the new collection as part of creating it. */
  recipeId: z.string().uuid().optional(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

/** `name` is always required here - unlike updatePostSchema there is no partial-update case. */
export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const collectionIdParamsSchema = z.object({
  collectionId: z.string().uuid(),
});
export type CollectionIdParams = z.infer<typeof collectionIdParamsSchema>;

export const collectionRecipeParamsSchema = z.object({
  collectionId: z.string().uuid(),
  recipeId: z.string().uuid(),
});
export type CollectionRecipeParams = z.infer<typeof collectionRecipeParamsSchema>;

export const addCollectionRecipeSchema = z.object({
  recipeId: z.string().uuid(),
});
export type AddCollectionRecipeInput = z.infer<typeof addCollectionRecipeSchema>;

/** Paginated listing of the recipes saved in a single collection. */
export const listCollectionRecipesQuerySchema = cursorPaginationSchema;
export type ListCollectionRecipesQuery = z.infer<typeof listCollectionRecipesQuerySchema>;
