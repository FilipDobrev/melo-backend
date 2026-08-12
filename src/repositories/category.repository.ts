import type { Category } from '@prisma/client';
import { type Db, prisma } from '../lib/prisma';

export async function findAllCategories(db: Db = prisma): Promise<Category[]> {
  return db.category.findMany({ orderBy: { name: 'asc' } });
}

export async function findCategoriesBySlugs(slugs: string[], db: Db = prisma): Promise<Category[]> {
  if (slugs.length === 0) return [];
  return db.category.findMany({ where: { slug: { in: slugs } } });
}
