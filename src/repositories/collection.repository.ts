import { prisma, type Db } from '../lib/prisma';
import type { SavedRecipeSummary } from './cookbook.repository';

/** Row shape for a collection as it appears in a user's collection list. */
export interface CollectionSummary {
  id: string;
  name: string;
  createdAt: Date;
  recipeCount: number;
}

/**
 * Collections are few per user, so this returns the whole list rather than
 * a page. The count comes from the join table in the same query.
 */
export async function listByUser(userId: string, db: Db = prisma): Promise<CollectionSummary[]> {
  const rows = await db.collection.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, createdAt: true, _count: { select: { recipes: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    recipeCount: row._count.recipes,
  }));
}

/**
 * Relies on `@@unique([userId, name])`; a duplicate name raises P2002,
 * which the error middleware maps to 409.
 */
export async function createCollection(
  userId: string,
  name: string,
  db: Db = prisma,
): Promise<CollectionSummary> {
  const row = await db.collection.create({
    data: { userId, name },
    select: { id: true, name: true, createdAt: true },
  });
  return { ...row, recipeCount: 0 };
}

/** Used to authorize collection mutations: caller compares the returned
 * `userId` against the requester before allowing rename/delete/add/remove. */
export async function findOwnerId(
  collectionId: string,
  db: Db = prisma,
): Promise<{ userId: string } | null> {
  return db.collection.findUnique({ where: { id: collectionId }, select: { userId: true } });
}

/**
 * Relies on `@@unique([userId, name])`; a duplicate name raises P2002,
 * which the error middleware maps to 409. A missing collection raises
 * P2025, mapped to 404.
 */
export async function renameCollection(
  collectionId: string,
  name: string,
  db: Db = prisma,
): Promise<CollectionSummary> {
  const row = await db.collection.update({
    where: { id: collectionId },
    data: { name },
    select: { id: true, name: true, createdAt: true, _count: { select: { recipes: true } } },
  });
  return { id: row.id, name: row.name, createdAt: row.createdAt, recipeCount: row._count.recipes };
}

/** A missing collection raises P2025, which the error middleware maps to 404. */
export async function deleteCollection(collectionId: string, db: Db = prisma): Promise<void> {
  await db.collection.delete({ where: { id: collectionId } });
}

/**
 * Relies on `@@unique([collectionId, recipeId])`; adding a recipe already in
 * the collection raises P2002, which the error middleware maps to 409.
 */
export async function addRecipe(
  collectionId: string,
  recipeId: string,
  db: Db = prisma,
): Promise<void> {
  await db.collectionRecipe.create({ data: { collectionId, recipeId } });
}

/**
 * Deletes via the compound unique key; a missing row raises P2025, which
 * the error middleware maps to 404.
 */
export async function removeRecipe(
  collectionId: string,
  recipeId: string,
  db: Db = prisma,
): Promise<void> {
  await db.collectionRecipe.delete({
    where: { collectionId_recipeId: { collectionId, recipeId } },
  });
}

/** Select shape backing SavedRecipeSummary; mirrors cookbook.repository.ts's
 * savedRecipeSelect (kept local rather than imported/shared). */
const savedRecipeSelect = {
  id: true,
  title: true,
  description: true,
  createdAt: true,
  imageKey: true,
  owner: { select: { id: true, username: true, profileImage: true } },
  categories: { select: { category: { select: { slug: true, name: true } } } },
} as const;

/** recipeId is unique within one collection, so it doubles as the cursor. */
export async function listRecipes(
  collectionId: string,
  cursor: string | undefined,
  limit: number,
  db: Db = prisma,
): Promise<SavedRecipeSummary[]> {
  const rows = await db.collectionRecipe.findMany({
    where: { collectionId },
    orderBy: [{ addedAt: 'desc' }, { recipeId: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { collectionId_recipeId: { collectionId, recipeId: cursor } }, skip: 1 } : {}),
    select: { recipe: { select: savedRecipeSelect } },
  });
  return rows.map((row) => ({
    ...row.recipe,
    categories: row.recipe.categories.map((entry) => entry.category),
  }));
}
