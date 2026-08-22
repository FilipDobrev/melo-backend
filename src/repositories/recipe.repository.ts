import type { Prisma, Recipe, Unit } from '@prisma/client';
import { type Db, prisma } from '../lib/prisma';

const ownerSummarySelect = {
  id: true,
  username: true,
  profileImage: true,
} satisfies Prisma.UserSelect;

/**
 * The product fields a recipe ingredient's response actually needs: enough
 * to render and edit the ingredient (id for re-submitting productId,
 * nutrition fields, source/externalId as on the standalone product
 * response). Deliberately excludes createdAt/updatedAt - a product's own
 * row timestamps have no use when it's just embedded in someone else's
 * recipe, so they're dropped rather than shipped for every ingredient.
 */
const ingredientProductSelect = {
  id: true,
  name: true,
  source: true,
  externalId: true,
  caloriesPer100g: true,
  proteinPer100g: true,
  carbsPer100g: true,
  fatPer100g: true,
  sugarPer100g: true,
  densityGPerMl: true,
  gramsPerPiece: true,
  gramsPerCup: true,
  gramsPerTablespoon: true,
  gramsPerTeaspoon: true,
} satisfies Prisma.ProductSelect;

/**
 * Full shape used for the single-recipe detail response: owner summary,
 * ingredients joined with their product, assigned categories, and whether
 * the given viewer has saved it. `savedBy` is always filtered by a viewer
 * id (an empty string when the caller is anonymous, which never matches a
 * real user id) so the query shape - and therefore its type - never varies.
 */
export const recipeDetailInclude = {
  owner: { select: ownerSummarySelect },
  ingredients: { include: { product: { select: ingredientProductSelect } } },
  categories: { include: { category: true } },
  savedBy: { select: { id: true } },
} satisfies Prisma.RecipeInclude;

export type RecipeDetailRow = Prisma.RecipeGetPayload<{ include: typeof recipeDetailInclude }>;

/**
 * Lean shape used for list views: no ingredients/nutrition, to avoid
 * pulling product data for every row on a page.
 */
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

/**
 * `id` is always the last key so the ordering is total, which is what makes
 * the id cursor a stable page boundary. Popularity is the number of
 * cookbook saves, and still paginates correctly under an aggregate ordering
 * because the trailing `id` tiebreaker holds even when `savedBy._count` ties.
 */
function orderFor(sort: RecipeSort): Prisma.RecipeOrderByWithRelationInput[] {
  if (sort === 'oldest') return [{ createdAt: 'asc' }, { id: 'asc' }];
  if (sort === 'popular') return [{ savedBy: { _count: 'desc' } }, { id: 'desc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

/**
 * Fetches limit + 1 rows so the caller can derive the next cursor without an
 * extra count query (see src/lib/pagination.ts). Recipes matching ANY of the
 * given categorySlugs are returned (not all).
 */
export async function findManyRecipes(params: RecipeListParams, db: Db = prisma): Promise<RecipeSummaryRow[]> {
  const where: Prisma.RecipeWhereInput = {
    // A pending-deletion owner's recipes are excluded from every listing,
    // global and per-owner alike.
    owner: { deletionRequestedAt: null },
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

/** `viewerId` is always passed (empty string for anonymous callers) so the
 * `savedBy` filter - and the resulting query shape - never varies. Include
 * shape here mirrors recipeDetailInclude/RecipeDetailRow but is written out
 * separately to add the viewer-scoped `savedBy` where clause. */
/**
 * `findFirst` rather than `findUnique`: a pending-deletion owner's recipes
 * must 404 for everyone, so `id` is combined with a non-unique owner filter.
 */
export async function findRecipeDetail(
  id: string,
  viewerId: string,
  db: Db = prisma,
): Promise<RecipeDetailRow | null> {
  return db.recipe.findFirst({
    where: { id, owner: { deletionRequestedAt: null } },
    include: {
      owner: { select: ownerSummarySelect },
      ingredients: { include: { product: { select: ingredientProductSelect } } },
      categories: { include: { category: true } },
      savedBy: { where: { userId: viewerId }, select: { id: true } },
    },
  });
}

/** Used to authorize recipe mutations: caller compares the returned
 * `ownerId` against the requester before allowing update/delete. */
export async function findRecipeOwner(id: string, db: Db = prisma): Promise<Pick<Recipe, 'id' | 'ownerId'> | null> {
  return db.recipe.findUnique({ where: { id }, select: { id: true, ownerId: true } });
}

export interface CreateRecipeFields {
  ownerId: string;
  title: string;
  description: string;
  instructions: string;
  imageKey?: string;
  servings?: number;
}

export async function createRecipe(data: CreateRecipeFields, db: Db = prisma): Promise<Recipe> {
  return db.recipe.create({ data });
}

export interface UpdateRecipeFields {
  title?: string;
  description?: string;
  instructions?: string;
  imageKey?: string;
  servings?: number;
}

/** A missing recipe raises P2025, which the error middleware maps to 404. */
export async function updateRecipeFields(id: string, data: UpdateRecipeFields, db: Db = prisma): Promise<void> {
  await db.recipe.update({ where: { id }, data });
}

/** A missing recipe raises P2025, which the error middleware maps to 404. */
export async function deleteRecipe(id: string, db: Db = prisma): Promise<void> {
  await db.recipe.delete({ where: { id } });
}

export interface RecipeIngredientInput {
  productId: string;
  quantity: number;
  unit: Unit;
}

/** Used when replacing a recipe's ingredient list (paired with
 * deleteRecipeIngredients by the caller); skips the write entirely for an
 * empty list rather than issuing a no-op createMany. */
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

/** Used when replacing a recipe's category assignments (paired with
 * deleteRecipeCategories by the caller); skips the write entirely for an
 * empty list rather than issuing a no-op createMany. */
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

/** Row shape needed to purge a user's storage objects after reassignment:
 * just the recipe id to reassign. */
export interface RecipeNeedingReassignment {
  id: string;
}

/**
 * Recipes owned by `userId` that a DIFFERENT user's post depends on
 * (`Post.recipeId` -> `Recipe`, `Recipe.ownerId` -> `User` both cascade), so
 * deleting `userId` would otherwise silently destroy someone else's post.
 * Used by the purge script to find recipes that must be reassigned to the
 * tombstone account instead of being deleted along with the user.
 */
export function findRecipesNeedingReassignment(
  userId: string,
  db: Db = prisma,
): Promise<RecipeNeedingReassignment[]> {
  return db.recipe.findMany({
    where: { ownerId: userId, posts: { some: { ownerId: { not: userId } } } },
    select: { id: true },
  });
}

/**
 * Transfers ownership of the given recipes to the purge tombstone account
 * and clears their `imageKey` in the same `updateMany` statement (a single
 * SQL `UPDATE`, so both changes commit or fail together). The image is
 * cleared because the underlying object is about to be deleted from storage
 * along with the rest of the departing user's objects - see
 * {@link import('../services/accountPurge.service').purgeUser} for why the
 * picture doesn't survive reassignment while the recipe data does.
 * `resolveRecipeImageUrl` treats a null `imageKey` as "use the default
 * preset", so the recipe keeps rendering with a placeholder image.
 */
export function reassignRecipes(
  recipeIds: string[],
  newOwnerId: string,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.recipe.updateMany({
    where: { id: { in: recipeIds } },
    data: { ownerId: newOwnerId, imageKey: null },
  });
}
