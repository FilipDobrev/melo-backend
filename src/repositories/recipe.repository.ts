import type { Prisma, Recipe, Unit } from '@prisma/client';
import { type Db, prisma } from '../lib/prisma';

const ownerSummarySelect = {
  id: true,
  username: true,
  profileImage: true,
} satisfies Prisma.UserSelect;

/// Full shape used for the single-recipe detail response: owner summary,
/// ingredients joined with their product, assigned categories, and whether
/// the given viewer has saved it. `savedBy` is always filtered by a viewer
/// id (an empty string when the caller is anonymous, which never matches a
/// real user id) so the query shape - and therefore its type - never varies.
export const recipeDetailInclude = {
  owner: { select: ownerSummarySelect },
  ingredients: { include: { product: true } },
  categories: { include: { category: true } },
  savedBy: { select: { id: true } },
} satisfies Prisma.RecipeInclude;

export type RecipeDetailRow = Prisma.RecipeGetPayload<{ include: typeof recipeDetailInclude }>;

/// Lean shape used for list views: no ingredients/nutrition, to avoid
/// pulling product data for every row on a page.
const recipeSummaryInclude = {
  owner: { select: ownerSummarySelect },
  categories: { include: { category: true } },
} satisfies Prisma.RecipeInclude;

export type RecipeSummaryRow = Prisma.RecipeGetPayload<{ include: typeof recipeSummaryInclude }>;

export type RecipeSort = 'newest' | 'oldest' | 'popular';

export interface RecipeListParams {
  search?: string;
  categorySlugs?: string[];
  ownerId?: string;
  sort?: RecipeSort;
  cursor?: string;
  limit: number;
}

/// `id` is always the last key so the ordering is total, which is what makes
/// the id cursor a stable page boundary. Popularity is the number of
/// cookbook saves.
function orderFor(sort: RecipeSort): Prisma.RecipeOrderByWithRelationInput[] {
  if (sort === 'oldest') return [{ createdAt: 'asc' }, { id: 'asc' }];
  if (sort === 'popular') return [{ savedBy: { _count: 'desc' } }, { id: 'desc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

/// Recipes matching ANY of the given categorySlugs are returned (not all).
export async function findManyRecipes(params: RecipeListParams, db: Db = prisma): Promise<RecipeSummaryRow[]> {
  const where: Prisma.RecipeWhereInput = {
    ...(params.ownerId ? { ownerId: params.ownerId } : {}),
    ...(params.search ? { title: { contains: params.search, mode: 'insensitive' } } : {}),
    ...(params.categorySlugs && params.categorySlugs.length > 0
      ? { categories: { some: { category: { slug: { in: params.categorySlugs } } } } }
      : {}),
  };

  return db.recipe.findMany({
    where,
    include: recipeSummaryInclude,
    orderBy: orderFor(params.sort ?? 'newest'),
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export async function findRecipeDetail(
  id: string,
  viewerId: string,
  db: Db = prisma,
): Promise<RecipeDetailRow | null> {
  return db.recipe.findUnique({
    where: { id },
    include: {
      owner: { select: ownerSummarySelect },
      ingredients: { include: { product: true } },
      categories: { include: { category: true } },
      savedBy: { where: { userId: viewerId }, select: { id: true } },
    },
  });
}

export async function findRecipeOwner(id: string, db: Db = prisma): Promise<Pick<Recipe, 'id' | 'ownerId'> | null> {
  return db.recipe.findUnique({ where: { id }, select: { id: true, ownerId: true } });
}

export interface CreateRecipeFields {
  ownerId: string;
  title: string;
  description: string;
  instructions: string;
}

export async function createRecipe(data: CreateRecipeFields, db: Db = prisma): Promise<Recipe> {
  return db.recipe.create({ data });
}

export interface UpdateRecipeFields {
  title?: string;
  description?: string;
  instructions?: string;
}

export async function updateRecipeFields(id: string, data: UpdateRecipeFields, db: Db = prisma): Promise<void> {
  await db.recipe.update({ where: { id }, data });
}

export async function deleteRecipe(id: string, db: Db = prisma): Promise<void> {
  await db.recipe.delete({ where: { id } });
}

export interface RecipeIngredientInput {
  productId: string;
  quantity: number;
  unit: Unit;
}

export async function createRecipeIngredients(
  recipeId: string,
  ingredients: RecipeIngredientInput[],
  db: Db = prisma,
): Promise<void> {
  if (ingredients.length === 0) return;
  await db.recipeIngredient.createMany({
    data: ingredients.map((ingredient) => ({
      recipeId,
      productId: ingredient.productId,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
  });
}

export async function deleteRecipeIngredients(recipeId: string, db: Db = prisma): Promise<void> {
  await db.recipeIngredient.deleteMany({ where: { recipeId } });
}

export async function createRecipeCategories(
  recipeId: string,
  categoryIds: string[],
  db: Db = prisma,
): Promise<void> {
  if (categoryIds.length === 0) return;
  await db.recipeCategory.createMany({
    data: categoryIds.map((categoryId) => ({ recipeId, categoryId })),
  });
}

export async function deleteRecipeCategories(recipeId: string, db: Db = prisma): Promise<void> {
  await db.recipeCategory.deleteMany({ where: { recipeId } });
}
