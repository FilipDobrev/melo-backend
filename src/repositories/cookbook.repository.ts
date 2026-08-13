import {prisma, type Db} from '../lib/prisma';

export interface UserSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

export interface CategorySummary {
  slug: string;
  name: string;
}

export interface SavedRecipeSummary {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
  owner: UserSummary;
  categories: CategorySummary[];
}

const savedRecipeSelect = {
  id: true,
  title: true,
  description: true,
  createdAt: true,
  owner: {select: {id: true, username: true, profileImage: true}},
  categories: {select: {category: {select: {slug: true, name: true}}}},
} as const;

export async function recipeExists(recipeId: string, db: Db = prisma): Promise<boolean> {
  const recipe = await db.recipe.findUnique({where: {id: recipeId}, select: {id: true}});
  return recipe !== null;
}

/// Bulk membership check used to attach `isSaved` to post payloads without
/// a per-post query. Anonymous viewers (userId null on optional-auth paths)
/// never have saves, so we skip the database entirely for them.
export async function findSavedRecipeIds(
  userId: string | null,
  recipeIds: string[],
  db: Db = prisma,
): Promise<Set<string>> {
  if (!userId || recipeIds.length === 0) return new Set();

  const rows = await db.cookbookSave.findMany({
    where: {userId, recipeId: {in: recipeIds}},
    select: {recipeId: true},
  });
  return new Set(rows.map((row) => row.recipeId));
}

/// Relies on `@@unique([userId, recipeId])`; a duplicate save raises P2002,
/// which the error middleware maps to 409. Only references the recipe, it
/// never copies its data or changes ownership.
export async function createSave(userId: string, recipeId: string, db: Db = prisma): Promise<void> {
  await db.cookbookSave.create({data: {userId, recipeId}});
}

/// Idempotent variant used when a save is a side effect rather than the
/// request itself, e.g. adding a recipe to a collection.
export async function ensureSave(userId: string, recipeId: string, db: Db = prisma): Promise<void> {
  await db.cookbookSave.upsert({
    where: {userId_recipeId: {userId, recipeId}},
    update: {},
    create: {userId, recipeId},
  });
}

/// Deletes via the compound unique key; a missing row raises P2025, which
/// the error middleware maps to 404.
export async function deleteSave(userId: string, recipeId: string, db: Db = prisma): Promise<void> {
  await db.cookbookSave.delete({where: {userId_recipeId: {userId, recipeId}}});
}

/// recipeId is unique within this filtered set (per the compound unique
/// constraint), so it doubles as the page cursor.
export async function listSavedRecipes(
  userId: string,
  cursor: string | undefined,
  limit: number,
  categorySlugs: string[] | undefined,
  db: Db = prisma,
): Promise<SavedRecipeSummary[]> {
  const rows = await db.cookbookSave.findMany({
    where: {
      userId,
      ...(categorySlugs && categorySlugs.length > 0
        ? {recipe: {categories: {some: {category: {slug: {in: categorySlugs}}}}}}
        : {}),
    },
    orderBy: [{createdAt: 'desc'}, {recipeId: 'desc'}],
    take: limit + 1,
    ...(cursor ? {cursor: {userId_recipeId: {userId, recipeId: cursor}}, skip: 1} : {}),
    select: {recipe: {select: savedRecipeSelect}},
  });
  return rows.map((row) => ({
    ...row.recipe,
    categories: row.recipe.categories.map((entry) => entry.category),
  }));
}
