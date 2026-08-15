import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const recipeIdParamsSchema = z.object({
  recipeId: z.string().uuid(),
});
export type RecipeIdParams = z.infer<typeof recipeIdParamsSchema>;

/**
 * `categorySlugs` arrives as a single comma-separated query string (or
 * already as an array, e.g. `?categorySlugs=a&categorySlugs=b`); normalise
 * to a slug array. The transform is idempotent so re-parsing an
 * already-parsed query (done in the controller to recover a precise type
 * without an `as` assertion) is safe. Omitting the param, or sending an
 * empty string, means "no category filter" rather than "match nothing".
 */
export const listCookbookQuerySchema = cursorPaginationSchema.extend({
  categorySlugs: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const parts = Array.isArray(value) ? value : value.split(',');
      const slugs = parts.map((slug) => slug.trim()).filter(Boolean);
      return slugs.length > 0 ? slugs : undefined;
    }),
});
export type ListCookbookQuery = z.infer<typeof listCookbookQuerySchema>;
