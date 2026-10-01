import { NotFoundError, ForbiddenError } from '../lib/errors';
import type { CursorPagination, Page } from '../lib/pagination';
import { toPage } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { resolveProfileImage } from '../lib/profileImage';
import * as postRepository from '../repositories/post.repository';
import type { PostCardRow } from '../repositories/post.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import * as reactionRepository from '../repositories/reaction.repository';
import { EMPTY_REACTION_SUMMARY, type ReactionSummary } from '../repositories/reaction.repository';
import { deleteObjectsInBackground, promoteUpload, publicUrlFor } from './storage.service';
import { recipeNutrition, type Nutrition } from './nutrition';
import { resolveRecipeImageUrl } from './recipeImage';

export interface AuthorSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

export interface PostImageDto {
  id: string;
  url: string;
  /**
   * The raw storage key, not just the resolved url. A client editing a post has to re-send the
   * keys of images it wants to keep (PATCH replaces the image set wholesale), and has no other
   * way to get them. This discloses nothing new: publicUrlFor builds `url` by prefixing this
   * same key with the storage base url, so the key is already the tail of `url`.
   */
  storageKey: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  nutrition: Nutrition;
  isSaved: boolean;
  servings: number;
  /** The recipe's own image (upload or preset); clients show it when the post has no images. */
  imageUrl: string;
}

export interface PostResponse {
  id: string;
  caption: string | null;
  createdAt: Date;
  author: AuthorSummary;
  images: PostImageDto[];
  recipe: RecipeSummary;
  reactions: ReactionSummary;
  commentCount: number;
}

/** Pure mapping from the joined DB row plus pre-fetched reaction/save state to the API response shape. */
export function toPostResponse(
  row: PostCardRow,
  reactions: ReactionSummary,
  isSaved: boolean,
): PostResponse {
  // `images` holds only the post's own photos. Clients fall back to `recipe.imageUrl` when it is
  // empty, and that image belongs to the recipe, so post edits and deletes never touch it.
  return {
    id: row.id,
    caption: row.caption,
    createdAt: row.createdAt,
    author: { ...row.owner, profileImage: resolveProfileImage(row.owner.profileImage) },
    images: row.images.map((image) => ({
      id: image.id,
      url: publicUrlFor(image.storageKey),
      storageKey: image.storageKey,
    })),
    recipe: {
      id: row.recipe.id,
      title: row.recipe.title,
      servings: row.recipe.servings,
      imageUrl: resolveRecipeImageUrl(row.recipe.imageKey),
      nutrition: recipeNutrition(
        row.recipe.ingredients.map((ingredient) => ({
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          product: ingredient.product,
        })),
      ),
      isSaved,
    },
    reactions,
    commentCount: row._count.comments,
  };
}

export interface CreatePostInput {
  ownerId: string;
  caption?: string;
  recipeId: string;
  imageKeys: string[];
}

/**
 * Promotes every upload key to its final `posts/` key concurrently (up to 10 images per post, so
 * this avoids paying the storage round trips one key at a time). If any key fails, the copies
 * that did succeed are deleted again so they do not leak, and the first failure is rethrown.
 * @returns The final keys, in the same order as `uploadKeys`.
 * @throws {BadRequestError} see `promoteUpload`.
 */
async function promoteAllToPosts(uploadKeys: string[], ownerId: string): Promise<string[]> {
  const results = await Promise.allSettled(uploadKeys.map((key) => promoteUpload(key, ownerId, 'posts')));

  const promotedKeys: string[] = [];
  let firstFailure: unknown;
  let hasFailure = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      promotedKeys.push(result.value);
    } else if (!hasFailure) {
      hasFailure = true;
      firstFailure = result.reason;
    }
  }

  if (hasFailure) {
    deleteObjectsInBackground(promotedKeys, { reason: 'post image promotion failed', ownerId });
    throw firstFailure;
  }
  return promotedKeys;
}

/**
 * @throws {BadRequestError} via `promoteUpload` if any image key is not the caller's own upload,
 * was never actually uploaded, or fails the size, type or dimension checks.
 * @throws {NotFoundError} if the recipe does not exist.
 */
export async function createPost(input: CreatePostInput): Promise<PostResponse> {
  // Checked before promoting so a bad recipe id does not leave copies behind in posts/.
  const recipeFound = await postRepository.recipeExists(input.recipeId);
  if (!recipeFound) throw new NotFoundError('Recipe not found');

  const imageKeys = await promoteAllToPosts(input.imageKeys, input.ownerId);

  let row: PostCardRow;
  try {
    row = await postRepository.createPost({
      ownerId: input.ownerId,
      caption: input.caption,
      recipeId: input.recipeId,
      images: imageKeys.map((storageKey, position) => ({ storageKey, position })),
    });
  } catch (err) {
    deleteObjectsInBackground(imageKeys, { reason: 'post creation failed', ownerId: input.ownerId });
    throw err;
  }

  // The owner may have saved this recipe (to their own cookbook) before
  // posting it, so this is resolved via the same bulk lookup rather than
  // assumed false.
  const savedRecipeIds = await cookbookRepository.findSavedRecipeIds(input.ownerId, [row.recipe.id]);
  return toPostResponse(row, EMPTY_REACTION_SUMMARY, savedRecipeIds.has(row.recipe.id));
}

/**
 * @param viewerId Null for an anonymous request; determines whether `reactions` reflects the
 * caller's own reaction and whether `recipe.isSaved` reflects the caller's cookbook.
 * @throws {NotFoundError} if the post does not exist.
 */
export async function getPostDetail(postId: string, viewerId: string | null): Promise<PostResponse> {
  const row = await postRepository.findDetailById(postId);
  if (!row) throw new NotFoundError('Post not found');

  const [summaries, savedRecipeIds] = await Promise.all([
    reactionRepository.summariesForPosts([postId], viewerId),
    cookbookRepository.findSavedRecipeIds(viewerId, [row.recipe.id]),
  ]);
  return toPostResponse(
    row,
    summaries.get(postId) ?? EMPTY_REACTION_SUMMARY,
    savedRecipeIds.has(row.recipe.id),
  );
}

export interface UpdatePostInput {
  caption?: string | null;
  recipeId?: string;
  imageKeys?: string[];
}

/**
 * Keys already attached to the post are kept as-is; any other key must be one of the caller's own
 * fresh uploads and is promoted. Keys dropped from the set are deleted from storage once the
 * database change has committed.
 * @throws {NotFoundError} if the post, or a replacement recipe, does not exist.
 * @throws {ForbiddenError} if the caller does not own the post.
 * @throws {BadRequestError} via `promoteUpload` for a new key that is not the caller's valid upload.
 */
export async function updatePost(postId: string, viewerId: string, input: UpdatePostInput): Promise<PostResponse> {
  const existing = await postRepository.findOwnerId(postId);
  if (!existing) throw new NotFoundError('Post not found');
  if (existing.ownerId !== viewerId) throw new ForbiddenError();

  if (input.recipeId !== undefined) {
    const recipeFound = await postRepository.recipeExists(input.recipeId);
    if (!recipeFound) throw new NotFoundError('Recipe not found');
  }

  let currentKeys: string[] = [];
  let finalKeys: string[] | undefined;
  let promotedKeys: string[] = [];
  if (input.imageKeys !== undefined) {
    currentKeys = await postRepository.findImageKeys(postId);
    const currentKeySet = new Set(currentKeys);
    const newUploadKeys = input.imageKeys.filter((key) => !currentKeySet.has(key));
    promotedKeys = await promoteAllToPosts(newUploadKeys, viewerId);
    const promotedByUploadKey = new Map(newUploadKeys.map((key, index) => [key, promotedKeys[index]]));
    finalKeys = input.imageKeys.map((key) => promotedByUploadKey.get(key) ?? key);
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (finalKeys) {
        // Wholesale replace, the same way updateRecipe replaces ingredients:
        // delete every PostImage row and recreate from the keys in order.
        // This reissues each image's id, which is fine because the client
        // refetches the post after an edit. Position comes from array order.
        await postRepository.deletePostImages(postId, tx);
        await postRepository.createPostImages(
          postId,
          finalKeys.map((storageKey, position) => ({ storageKey, position })),
          tx,
        );
      }

      if (input.caption !== undefined || input.recipeId !== undefined) {
        await postRepository.updatePostFields(postId, { caption: input.caption, recipeId: input.recipeId }, tx);
      }
    });
  } catch (err) {
    deleteObjectsInBackground(promotedKeys, { reason: 'post update failed', postId });
    throw err;
  }

  if (finalKeys) {
    const keptKeys = new Set(finalKeys);
    deleteObjectsInBackground(
      currentKeys.filter((key) => !keptKeys.has(key)),
      { reason: 'post images replaced', postId },
    );
  }

  return getPostDetail(postId, viewerId);
}

/**
 * @throws {NotFoundError} if the post does not exist.
 * @throws {ForbiddenError} if the caller does not own the post.
 */
export async function deletePost(postId: string, userId: string): Promise<void> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');
  if (post.ownerId !== userId) throw new ForbiddenError();

  // Read before the delete: the image rows cascade away with the post.
  const imageKeys = await postRepository.findImageKeys(postId);
  await postRepository.deletePost(postId);
  deleteObjectsInBackground(imageKeys, { reason: 'post deleted', postId });
}

/**
 * @throws {NotFoundError} if the image does not exist under this post.
 * @throws {ForbiddenError} if the caller does not own the post.
 */
export async function deletePostImage(postId: string, imageId: string, userId: string): Promise<void> {
  const image = await postRepository.findImageWithPost(imageId);
  if (!image || image.postId !== postId) throw new NotFoundError('Image not found');
  if (image.post.ownerId !== userId) throw new ForbiddenError();

  await postRepository.deleteImage(imageId);
  deleteObjectsInBackground([image.storageKey], { reason: 'post image deleted', postId, imageId });
}

/**
 * Shared by any listing endpoint (user posts, feed) that renders PostCardRow[] and needs
 * reaction summaries attached in bulk.
 * @param viewerId Null for an anonymous request; see {@link getPostDetail}.
 */
export async function attachReactions(
  rows: PostCardRow[],
  viewerId: string | null,
): Promise<PostResponse[]> {
  const [summaries, savedRecipeIds] = await Promise.all([
    reactionRepository.summariesForPosts(
      rows.map((row) => row.id),
      viewerId,
    ),
    cookbookRepository.findSavedRecipeIds(
      viewerId,
      rows.map((row) => row.recipe.id),
    ),
  ]);
  return rows.map((row) =>
    toPostResponse(
      row,
      summaries.get(row.id) ?? EMPTY_REACTION_SUMMARY,
      savedRecipeIds.has(row.recipe.id),
    ),
  );
}

export async function listUserPosts(
  ownerId: string,
  viewerId: string | null,
  pagination: CursorPagination,
): Promise<Page<PostResponse>> {
  const rows = await postRepository.listByOwner({
    ownerId,
    cursor: pagination.cursor,
    limit: pagination.limit,
  });
  const page = toPage(rows, pagination.limit);
  const items = await attachReactions(page.items, viewerId);
  return { items, nextCursor: page.nextCursor };
}
