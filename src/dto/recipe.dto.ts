import { Unit } from '@prisma/client';
import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

/** Requests a presigned URL to upload a recipe image; `contentLength` is the exact byte size of the upload. */
export const createRecipeUploadUrlSchema = z.object({
  contentType: z.string().trim().min(1),
  contentLength: z.coerce.number().int().positive(),
});
export type CreateRecipeUploadUrlInput = z.infer<typeof createRecipeUploadUrlSchema>;

const categorySlugSchema = z.string().trim().min(1).max(50);

/** One recipe ingredient: a product reference plus a quantity in a specific {@link Unit}. */
export const ingredientInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().finite().positive(),
  unit: z.nativeEnum(Unit),
});
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

// Actual acceptance (known preset vs. caller's own upload prefix) happens in
// recipeImage.ts's validateRecipeImageKey, which needs the caller's id and
// so cannot run at the schema layer. This only enforces a non-empty string.
const imageKeySchema = z.string().trim().min(1).max(500);

/** `imageKey` may be omitted; not every recipe has a photo. */
export const createRecipeSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(2000),
  instructions: z.string().trim().min(1).max(10000),
  ingredients: z.array(ingredientInputSchema).min(1),
  categorySlugs: z.array(categorySlugSchema).default([]),
  imageKey: imageKeySchema.optional(),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

/**
 * Any subset of the create fields. When `ingredients` or `categorySlugs`
 * is present the whole set is replaced, so each is validated the same way
 * as on create (min 1 ingredient; an empty categorySlugs array clears them).
 */
export const updateRecipeSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  instructions: z.string().trim().min(1).max(10000).optional(),
  ingredients: z.array(ingredientInputSchema).min(1).optional(),
  categorySlugs: z.array(categorySlugSchema).optional(),
  imageKey: imageKeySchema.optional(),
});
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

export const recipeIdParamsSchema = z.object({
  recipeId: z.string().uuid(),
});
export type RecipeIdParams = z.infer<typeof recipeIdParamsSchema>;

export const recipeSortSchema = z.enum(['newest', 'oldest', 'popular']).default('newest');
export type RecipeSort = z.infer<typeof recipeSortSchema>;

/**
 * `categorySlugs` is a comma-separated list of slugs in the query string
 * (not a repeated `?categorySlugs=a&categorySlugs=b` param, unlike
 * cookbook.dto.ts's version). A recipe matches if it has ANY of the given
 * categories (not all of them).
 */
export const listRecipesQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  sort: recipeSortSchema,
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
