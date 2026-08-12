import { Unit } from '@prisma/client';
import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

const categorySlugSchema = z.string().trim().min(1).max(50);

export const ingredientInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().finite().positive(),
  unit: z.nativeEnum(Unit),
});
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

export const createRecipeSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(2000),
  instructions: z.string().trim().min(1).max(10000),
  ingredients: z.array(ingredientInputSchema).min(1),
  categorySlugs: z.array(categorySlugSchema).default([]),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

/// Any subset of the create fields. When `ingredients` or `categorySlugs`
/// is present the whole set is replaced, so each is validated the same way
/// as on create (min 1 ingredient; an empty categorySlugs array clears them).
export const updateRecipeSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  instructions: z.string().trim().min(1).max(10000).optional(),
  ingredients: z.array(ingredientInputSchema).min(1).optional(),
  categorySlugs: z.array(categorySlugSchema).optional(),
});
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

export const recipeIdParamsSchema = z.object({
  recipeId: z.string().uuid(),
});
export type RecipeIdParams = z.infer<typeof recipeIdParamsSchema>;

/// categorySlugs is a comma-separated list of slugs in the query string.
/// A recipe matches if it has ANY of the given categories (not all of them).
export const listRecipesQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  categorySlugs: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((slug) => slug.trim())
            .filter((slug) => slug.length > 0)
        : undefined,
    ),
});
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
