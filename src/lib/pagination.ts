import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * Cursor pagination keyed on id. Callers order by (createdAt desc, id desc)
 * and pass the last seen id back as `cursor`. `cursor` must be a UUID;
 * `limit` is coerced from the query string and clamped to
 * {@link MAX_PAGE_SIZE}, defaulting to {@link DEFAULT_PAGE_SIZE}.
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

/** A page of results plus the cursor to request the next one, or `null` at the end. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Repositories fetch `limit + 1` rows; this trims the extra row and derives
 * the cursor from it, so there is no extra count query.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last ? last.id : null };
}
