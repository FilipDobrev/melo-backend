import * as collectionService from '../services/collection.service';
import type { CollectionSummary } from '../repositories/collection.repository';
import type { SavedRecipeCard } from '../services/cookbook.service';
import type {
  AddCollectionRecipeInput,
  CreateCollectionInput,
  ListCollectionRecipesQuery,
  UpdateCollectionInput,
} from '../dto/collection.dto';
import type { Page } from '../lib/pagination';
import type {
  AuthorizedRequest,
  CollectionIdParams,
  CollectionRecipeParams,
  TypedResponse,
} from '../types/http';

export async function list(
  req: AuthorizedRequest,
  res: TypedResponse<CollectionSummary[]>,
): Promise<void> {
  const collections = await collectionService.listCollections(req.userId);
  res.status(200).json(collections);
}

export async function create(
  req: AuthorizedRequest<CreateCollectionInput>,
  res: TypedResponse<CollectionSummary>,
): Promise<void> {
  const collection = await collectionService.createCollection(req.userId, req.body.name);
  res.status(201).json(collection);
}

export async function rename(
  req: AuthorizedRequest<UpdateCollectionInput, unknown, CollectionIdParams>,
  res: TypedResponse<CollectionSummary>,
): Promise<void> {
  const collection = await collectionService.renameCollection(
    req.params.collectionId,
    req.userId,
    req.body.name,
  );
  res.status(200).json(collection);
}

export async function remove(
  req: AuthorizedRequest<void, unknown, CollectionIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await collectionService.deleteCollection(req.params.collectionId, req.userId);
  res.status(204).send();
}

export async function listRecipes(
  req: AuthorizedRequest<void, ListCollectionRecipesQuery, CollectionIdParams>,
  res: TypedResponse<Page<SavedRecipeCard>>,
): Promise<void> {
  const { cursor, limit } = req.query;
  const page = await collectionService.listRecipes(req.params.collectionId, req.userId, cursor, limit);
  res.status(200).json(page);
}

export async function addRecipe(
  req: AuthorizedRequest<AddCollectionRecipeInput, unknown, CollectionIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await collectionService.addRecipe(req.params.collectionId, req.userId, req.body.recipeId);
  res.status(204).send();
}

export async function removeRecipe(
  req: AuthorizedRequest<void, unknown, CollectionRecipeParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { collectionId, recipeId } = req.params;
  await collectionService.removeRecipe(collectionId, req.userId, recipeId);
  res.status(204).send();
}
