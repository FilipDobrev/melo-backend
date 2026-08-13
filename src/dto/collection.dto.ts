import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

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

export const listCollectionRecipesQuerySchema = cursorPaginationSchema;
export type ListCollectionRecipesQuery = z.infer<typeof listCollectionRecipesQuerySchema>;
