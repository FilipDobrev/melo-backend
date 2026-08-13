import { ForbiddenError, NotFoundError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { toPage, type Page } from '../lib/pagination';
import * as collectionRepository from '../repositories/collection.repository';
import type { CollectionSummary } from '../repositories/collection.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import { toSavedRecipeCard, type SavedRecipeCard } from './cookbook.service';

/// Loads the collection and asserts the caller owns it. Every collection
/// endpoint runs this first, so ownership is never assumed from the URL.
async function assertOwnership(collectionId: string, userId: string): Promise<void> {
  const owner = await collectionRepository.findOwnerId(collectionId);
  if (!owner) throw new NotFoundError('Collection not found');
  if (owner.userId !== userId) throw new ForbiddenError();
}

export function listCollections(userId: string): Promise<CollectionSummary[]> {
  return collectionRepository.listByUser(userId);
}

export function createCollection(userId: string, name: string): Promise<CollectionSummary> {
  // A duplicate name is rejected by the unique constraint (P2002 -> 409).
  return collectionRepository.createCollection(userId, name);
}

export async function renameCollection(
  collectionId: string,
  userId: string,
  name: string,
): Promise<CollectionSummary> {
  await assertOwnership(collectionId, userId);
  return collectionRepository.renameCollection(collectionId, name);
}

export async function deleteCollection(collectionId: string, userId: string): Promise<void> {
  await assertOwnership(collectionId, userId);
  await collectionRepository.deleteCollection(collectionId);
}

/// A collection is a view over the cookbook, so adding a recipe also saves
/// it. Both writes share a transaction to keep that invariant true.
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

/// Removing from a collection leaves the cookbook save in place; the recipe
/// is still saved, just not filed under this collection.
export async function removeRecipe(
  collectionId: string,
  userId: string,
  recipeId: string,
): Promise<void> {
  await assertOwnership(collectionId, userId);
  await collectionRepository.removeRecipe(collectionId, recipeId);
}

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
