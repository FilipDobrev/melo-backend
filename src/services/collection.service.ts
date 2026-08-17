import { ForbiddenError, NotFoundError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { toPage, type Page } from '../lib/pagination';
import * as collectionRepository from '../repositories/collection.repository';
import type { CollectionSummary } from '../repositories/collection.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import { toSavedRecipeCard, type SavedRecipeCard } from './cookbook.service';

/**
 * Loads the collection and asserts the caller owns it. Every collection endpoint runs this
 * first, so ownership is never assumed from the URL.
 * @throws {NotFoundError} if the collection does not exist.
 * @throws {ForbiddenError} if it exists but belongs to another user.
 */
async function assertOwnership(collectionId: string, userId: string): Promise<void> {
  const owner = await collectionRepository.findOwnerId(collectionId);
  if (!owner) throw new NotFoundError('Collection not found');
  if (owner.userId !== userId) throw new ForbiddenError();
}

export function listCollections(userId: string): Promise<CollectionSummary[]> {
  return collectionRepository.listByUser(userId);
}

/**
 * A duplicate name is rejected by the DB's unique constraint (Prisma P2002), mapped to a 409 by
 * the error middleware.
 *
 * When `recipeId` is given, the recipe is added to the new collection (and saved to the caller's
 * cookbook if not saved already) in the same transaction as the create - "create a collection
 * from this recipe" is one atomic call, so an unknown recipe or a duplicate name leaves no
 * collection behind.
 * @throws {NotFoundError} if `recipeId` is given but does not exist.
 */
export async function createCollection(
  userId: string,
  name: string,
  recipeId?: string,
): Promise<CollectionSummary> {
  if (recipeId === undefined) {
    return collectionRepository.createCollection(userId, name);
  }

  const recipeFound = await cookbookRepository.recipeExists(recipeId);
  if (!recipeFound) throw new NotFoundError('Recipe not found');

  return prisma.$transaction(async (tx) => {
    const collection = await collectionRepository.createCollection(userId, name, tx);
    await cookbookRepository.ensureSave(userId, recipeId, tx);
    await collectionRepository.addRecipe(collection.id, recipeId, tx);
    return { ...collection, recipeCount: 1 };
  });
}

/** @throws {NotFoundError} | {ForbiddenError} see {@link assertOwnership}. */
export async function renameCollection(
  collectionId: string,
  userId: string,
  name: string,
): Promise<CollectionSummary> {
  await assertOwnership(collectionId, userId);
  return collectionRepository.renameCollection(collectionId, name);
}

/** @throws {NotFoundError} | {ForbiddenError} see {@link assertOwnership}. */
export async function deleteCollection(collectionId: string, userId: string): Promise<void> {
  await assertOwnership(collectionId, userId);
  await collectionRepository.deleteCollection(collectionId);
}

/**
 * A collection is a view over the cookbook, so adding a recipe also saves it. Both writes share
 * a transaction to keep that invariant true.
 * @throws {NotFoundError} if the collection or the recipe does not exist.
 * @throws {ForbiddenError} if the collection belongs to another user.
 */
export async function addRecipe(
  collectionId: string,
  userId: string,
  recipeId: string,
): Promise<void> {
  await assertOwnership(collectionId, userId);

  const recipeFound = await cookbookRepository.recipeExists(recipeId);
  if (!recipeFound) throw new NotFoundError('Recipe not found');

  await prisma.$transaction(async (tx) => {
    await cookbookRepository.ensureSave(userId, recipeId, tx);
    await collectionRepository.addRecipe(collectionId, recipeId, tx);
  });
}

/**
 * Removing from a collection leaves the cookbook save in place; the recipe is still saved, just
 * not filed under this collection.
 * @throws {NotFoundError} | {ForbiddenError} see {@link assertOwnership}.
 */
export async function removeRecipe(
  collectionId: string,
  userId: string,
  recipeId: string,
): Promise<void> {
  await assertOwnership(collectionId, userId);
  await collectionRepository.removeRecipe(collectionId, recipeId);
}

/** @throws {NotFoundError} | {ForbiddenError} see {@link assertOwnership}. */
export async function listRecipes(
  collectionId: string,
  userId: string,
  cursor: string | undefined,
  limit: number,
): Promise<Page<SavedRecipeCard>> {
  await assertOwnership(collectionId, userId);
  const rows = await collectionRepository.listRecipes(collectionId, cursor, limit);
  const page = toPage(rows, limit);
  return { items: page.items.map(toSavedRecipeCard), nextCursor: page.nextCursor };
}
