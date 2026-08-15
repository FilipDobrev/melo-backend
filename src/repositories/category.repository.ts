import type { Category } from '@prisma/client';
import { type Db, prisma } from '../lib/prisma';

/** All categories are used to populate filter/select UI, so the full set is
 * returned rather than a page (category count is small and static). */
export async function findAllCategories(db: Db = prisma): Promise<Category[]> {
  return db.category.findMany({ orderBy: { name: 'asc' } });
}

/** Empty `slugs` short-circuits to `[]` rather than issuing an `IN ()` query
 * that would otherwise just return nothing. */
export async function findCategoriesBySlugs(slugs: string[], db: Db = prisma): Promise<Category[]> {
  if (slugs.length === 0) return [];
  return db.category.findMany({ where: { slug: { in: slugs } } });
}
