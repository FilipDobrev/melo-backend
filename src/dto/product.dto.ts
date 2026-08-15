import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

/** Nutrition values are per 100 g and must be finite, non-negative numbers. */
const nutritionValueSchema = z.number().finite().min(0);

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(100),
  caloriesPer100g: nutritionValueSchema,
  proteinPer100g: nutritionValueSchema,
  carbsPer100g: nutritionValueSchema,
  fatPer100g: nutritionValueSchema,
  densityGPerMl: nutritionValueSchema.nullable().optional(),
  gramsPerPiece: nutritionValueSchema.nullable().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const productIdParamsSchema = z.object({
  productId: z.string().uuid(),
});
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;

/** `search`, when omitted, lists all products; when present, filters by it. */
export const listProductsQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
