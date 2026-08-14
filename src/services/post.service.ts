import { NotFoundError, ForbiddenError, BadRequestError } from '../lib/errors';
import type { CursorPagination, Page } from '../lib/pagination';
import { toPage } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { resolveProfileImage } from '../lib/profileImage';
import * as postRepository from '../repositories/post.repository';
import type { PostCardRow } from '../repositories/post.repository';
import * as cookbookRepository from '../repositories/cookbook.repository';
import * as reactionRepository from '../repositories/reaction.repository';
import { EMPTY_REACTION_SUMMARY, type ReactionSummary } from '../repositories/reaction.repository';
import { publicUrlFor, verifyUploadedImage } from './storage.service';
import { recipeNutrition, type Nutrition } from './nutrition';

export interface AuthorSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

export interface PostImageDto {
  id: string;
  url: string;
  // The raw storage key, not just the resolved url. A client editing a post
  // has to re-send the keys of images it wants to keep (PATCH replaces the
  // image set wholesale), and has no other way to get them. This discloses
  // nothing new: publicUrlFor builds `url` by prefixing this same key with
  // the storage base url, so the key is already the tail of `url`.
  storageKey: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  nutrition: Nutrition;
  isSaved: boolean;
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

export function toPostResponse(
  row: PostCardRow,
  reactions: ReactionSummary,
  isSaved: boolean,
): PostResponse {
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

/// Rejects any key that is not under the caller's own upload prefix, so a
/// user cannot attach an image someone else uploaded to their own post.
export function validateImageKeyOwnership(imageKeys: string[], ownerId: string): void {
  const invalidKey = imageKeys.find((key) => !key.startsWith(`posts/${ownerId}/`));
  if (invalidKey) {
    throw new BadRequestError('Image keys must belong to the caller');
  }
}

export async function createPost(input: CreatePostInput): Promise<PostResponse> {
  validateImageKeyOwnership(input.imageKeys, input.ownerId);
  // Up to 10 images per post (see createPostSchema), so verify them
  // concurrently rather than paying HeadObject+GetObject latency per key.
  await Promise.all(input.imageKeys.map((key) => verifyUploadedImage(key)));

  const recipeFound = await postRepository.recipeExists(input.recipeId);
  if (!recipeFound) throw new NotFoundError('Recipe not found');

  const row = await postRepository.createPost({
    ownerId: input.ownerId,
    caption: input.caption,
    recipeId: input.recipeId,
    images: input.imageKeys.map((storageKey, position) => ({ storageKey, position })),
  });

  // The owner may have saved this recipe (to their own cookbook) before
  // posting it, so this is resolved via the same bulk lookup rather than
  // assumed false.
  const savedRecipeIds = await cookbookRepository.findSavedRecipeIds(input.ownerId, [row.recipe.id]);
  return toPostResponse(row, EMPTY_REACTION_SUMMARY, savedRecipeIds.has(row.recipe.id));
}

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

export async function updatePost(postId: string, viewerId: string, input: UpdatePostInput): Promise<PostResponse> {
  const existing = await postRepository.findOwnerId(postId);
  if (!existing) throw new NotFoundError('Post not found');
  if (existing.ownerId !== viewerId) throw new ForbiddenError();

  if (input.recipeId !== undefined) {
    const recipeFound = await postRepository.recipeExists(input.recipeId);
    if (!recipeFound) throw new NotFoundError('Recipe not found');
  }

  if (input.imageKeys !== undefined) {
    validateImageKeyOwnership(input.imageKeys, viewerId);
    // Every key is re-verified against storage, including ones already
    // attached to this post - those really do exist as objects in storage,
    // so they pass naturally. No exemption is made for "existing" keys.
    await Promise.all(input.imageKeys.map((key) => verifyUploadedImage(key)));
  }

  await prisma.$transaction(async (tx) => {
    if (input.imageKeys) {
      // Wholesale replace, the same way updateRecipe replaces ingredients:
      // delete every PostImage row and recreate from imageKeys in order.
      // This reissues each image's id, which is fine because the client
      // refetches the post after an edit. Position comes from array order.
      await postRepository.deletePostImages(postId, tx);
      await postRepository.createPostImages(
        postId,
        input.imageKeys.map((storageKey, position) => ({ storageKey, position })),
        tx,
      );
    }

    if (input.caption !== undefined || input.recipeId !== undefined) {
      await postRepository.updatePostFields(postId, { caption: input.caption, recipeId: input.recipeId }, tx);
    }
  });

  return getPostDetail(postId, viewerId);
}

export async function deletePost(postId: string, userId: string): Promise<void> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');
  if (post.ownerId !== userId) throw new ForbiddenError();

  await postRepository.deletePost(postId);
}

export async function deletePostImage(postId: string, imageId: string, userId: string): Promise<void> {
  const image = await postRepository.findImageWithPost(imageId);
  if (!image || image.postId !== postId) throw new NotFoundError('Image not found');
  if (image.post.ownerId !== userId) throw new ForbiddenError();
  if (image.post._count.images <= 1) {
    throw new BadRequestError('A post must keep at least one image');
  }

  await postRepository.deleteImage(imageId);
}

/// Shared by any listing endpoint (user posts, feed) that renders
/// PostCardRow[] and needs reaction summaries attached in bulk.
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
