import type { Product, Unit } from '@prisma/client';
import type { CreateRecipeInput, ListRecipesQuery, UpdateRecipeInput } from '../dto/recipe.dto';
import { BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors';
import { type CursorPagination, type Page, toPage } from '../lib/pagination';
import { prisma, type Db } from '../lib/prisma';
import * as categoryRepository from '../repositories/category.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import * as productRepository from '../repositories/product.repository';
import * as recipeRepository from '../repositories/recipe.repository';
import type { RecipeDetailRow, RecipeSummaryRow } from '../repositories/recipe.repository';
import { recipeNutrition, type Nutrition } from './nutrition';

export interface RecipeOwnerSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

export interface RecipeCategorySummary {
  slug: string;
  name: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  owner: RecipeOwnerSummary;
  categories: RecipeCategorySummary[];
}

export interface RecipeDetail extends RecipeSummary {
  instructions: string;
  ingredients: Array<{ id: string; quantity: number; unit: Unit; product: Product }>;
  nutrition: Nutrition;
  isSaved: boolean;
}

/// Finds the first requested id that has no matching row among the ones
/// actually found in the database, so the caller can report which one.
export function findMissingProductId(requestedIds: string[], foundProducts: Array<{ id: string }>): string | undefined {
  const foundIds = new Set(foundProducts.map((product) => product.id));
  return requestedIds.find((id) => !foundIds.has(id));
}

export function findMissingCategorySlug(
  requestedSlugs: string[],
  foundCategories: Array<{ slug: string }>,
): string | undefined {
  const foundSlugs = new Set(foundCategories.map((category) => category.slug));
  return requestedSlugs.find((slug) => !foundSlugs.has(slug));
}

/// Pure mapping from the joined DB row to the API response shape, including
/// the computed nutrition totals. No DB access, so it is directly testable.
export function toRecipeDetail(recipe: RecipeDetailRow): RecipeDetail {
  const nutrition = recipeNutrition(
    recipe.ingredients.map((ingredient) => ({
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      product: ingredient.product,
    })),
  );

  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    instructions: recipe.instructions,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    owner: recipe.owner,
    ingredients: recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      product: ingredient.product,
    })),
    categories: recipe.categories.map((assignment) => ({
      slug: assignment.category.slug,
      name: assignment.category.name,
    })),
    nutrition,
    isSaved: recipe.savedBy.length > 0,
  };
}

export function toRecipeSummary(recipe: RecipeSummaryRow): RecipeSummary {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    owner: recipe.owner,
    categories: recipe.categories.map((assignment) => ({
      slug: assignment.category.slug,
      name: assignment.category.name,
    })),
  };
}

export async function listRecipes(query: ListRecipesQuery): Promise<Page<RecipeSummary>> {
  const rows = await recipeRepository.findManyRecipes({
    search: query.search,
    categorySlugs: query.categorySlugs,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit,
  });
  return toPage(rows.map(toRecipeSummary), query.limit);
}

export async function listRecipesByOwner(ownerId: string, query: CursorPagination): Promise<Page<RecipeSummary>> {
  const rows = await recipeRepository.findManyRecipes({
    ownerId,
    cursor: query.cursor,
    limit: query.limit,
  });
  return toPage(rows.map(toRecipeSummary), query.limit);
}

export async function getRecipeDetail(recipeId: string, viewerId: string | undefined): Promise<RecipeDetail> {
  // An empty string never matches a real user id, so an anonymous viewer
  // always resolves isSaved to false without branching the query shape.
  const recipe = await recipeRepository.findRecipeDetail(recipeId, viewerId ?? '');
  if (!recipe) throw new NotFoundError('Recipe not found');
  return toRecipeDetail(recipe);
}

/// Verifies every referenced productId/categorySlug exists, then inserts
/// the recipe, its ingredients, and its category assignments together.
/// The author's own cookbook save is created in the same transaction, so a
/// newly created recipe always shows up in its author's cookbook - the
/// author can still unsave (and re-save) it afterwards like anyone else.
export async function createRecipe(ownerId: string, input: CreateRecipeInput): Promise<RecipeDetail> {
  return prisma.$transaction(async (tx) => {
    const categoryIds = await resolveCategoryIds(input.categorySlugs, tx);
    await assertProductsExist(input.ingredients, tx);

    const recipe = await recipeRepository.createRecipe(
      { ownerId, title: input.title, description: input.description, instructions: input.instructions },
      tx,
    );
    await recipeRepository.createRecipeIngredients(recipe.id, input.ingredients, tx);
    await recipeRepository.createRecipeCategories(recipe.id, categoryIds, tx);
    await cookbookRepository.ensureSave(ownerId, recipe.id, tx);

    const detail = await recipeRepository.findRecipeDetail(recipe.id, ownerId, tx);
    if (!detail) throw new Error('Recipe vanished inside its own creation transaction');
    return toRecipeDetail(detail);
  });
}

export async function updateRecipe(recipeId: string, viewerId: string, input: UpdateRecipeInput): Promise<RecipeDetail> {
  const existing = await recipeRepository.findRecipeOwner(recipeId);
  if (!existing) throw new NotFoundError('Recipe not found');
  if (existing.ownerId !== viewerId) throw new ForbiddenError();

  return prisma.$transaction(async (tx) => {
    if (input.ingredients) {
      await assertProductsExist(input.ingredients, tx);
      await recipeRepository.deleteRecipeIngredients(recipeId, tx);
      await recipeRepository.createRecipeIngredients(recipeId, input.ingredients, tx);
    }

    if (input.categorySlugs) {
      const categoryIds = await resolveCategoryIds(input.categorySlugs, tx);
      await recipeRepository.deleteRecipeCategories(recipeId, tx);
      await recipeRepository.createRecipeCategories(recipeId, categoryIds, tx);
    }

    const { title, description, instructions } = input;
    if (title !== undefined || description !== undefined || instructions !== undefined) {
      await recipeRepository.updateRecipeFields(recipeId, { title, description, instructions }, tx);
    }

    const detail = await recipeRepository.findRecipeDetail(recipeId, viewerId, tx);
    if (!detail) throw new Error('Recipe vanished inside its own update transaction');
    return toRecipeDetail(detail);
  });
}

export async function deleteRecipe(recipeId: string, viewerId: string): Promise<void> {
  const existing = await recipeRepository.findRecipeOwner(recipeId);
  if (!existing) throw new NotFoundError('Recipe not found');
  if (existing.ownerId !== viewerId) throw new ForbiddenError();
  await recipeRepository.deleteRecipe(recipeId);
}

async function resolveCategoryIds(slugs: string[], db: Db): Promise<string[]> {
  if (slugs.length === 0) return [];
  const categories = await categoryRepository.findCategoriesBySlugs(slugs, db);
  const missingSlug = findMissingCategorySlug(slugs, categories);
  if (missingSlug) throw new BadRequestError(`Unknown category slug "${missingSlug}"`);
  return categories.map((category) => category.id);
}

async function assertProductsExist(
  ingredients: Array<{ productId: string }>,
  db: Db,
): Promise<void> {
  const productIds = [...new Set(ingredients.map((ingredient) => ingredient.productId))];
  const products = await productRepository.findProductsByIds(productIds, db);
  const missingId = findMissingProductId(productIds, products);
  if (missingId) throw new BadRequestError(`Unknown productId "${missingId}"`);
}
