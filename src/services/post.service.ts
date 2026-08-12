import { NotFoundError, ForbiddenError, BadRequestError } from '../lib/errors';
import type { CursorPagination, Page } from '../lib/pagination';
import { toPage } from '../lib/pagination';
import * as postRepository from '../repositories/post.repository';
import type { PostCardRow } from '../repositories/post.repository';
import * as reactionRepository from '../repositories/reaction.repository';
import { EMPTY_REACTION_SUMMARY, type ReactionSummary } from '../repositories/reaction.repository';
import { publicUrlFor } from './storage.service';
import { recipeNutrition, type Nutrition } from './nutrition';

export interface AuthorSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

export interface PostImageDto {
  id: string;
  url: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  nutrition: Nutrition;
}

export interface PostResponse {
  id: string;
  caption: string | null;
  createdAt: Date;
  author: AuthorSummary;
  images: PostImageDto[];
  recipe: RecipeSummary | null;
  reactions: ReactionSummary;
  commentCount: number;
}

export function toPostResponse(row: PostCardRow, reactions: ReactionSummary): PostResponse {
  return {
    id: row.id,
    caption: row.caption,
    createdAt: row.createdAt,
    author: row.owner,
    images: row.images.map((image) => ({ id: image.id, url: publicUrlFor(image.storageKey) })),
    recipe: row.recipe
      ? {
          id: row.recipe.id,
          title: row.recipe.title,
          nutrition: recipeNutrition(
            row.recipe.ingredients.map((ingredient) => ({
              quantity: ingredient.quantity,
              unit: ingredient.unit,
              product: ingredient.product,
            })),
          ),
        }
      : null,
    reactions,
    commentCount: row._count.comments,
  };
}

export interface CreatePostInput {
  ownerId: string;
  caption?: string;
  recipeId?: string;
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

  if (input.recipeId) {
    const exists = await postRepository.recipeExists(input.recipeId);
    if (!exists) throw new NotFoundError('Recipe not found');
  }

  const row = await postRepository.createPost({
    ownerId: input.ownerId,
    caption: input.caption,
    recipeId: input.recipeId,
    images: input.imageKeys.map((storageKey, position) => ({ storageKey, position })),
  });

  return toPostResponse(row, EMPTY_REACTION_SUMMARY);
}

export async function getPostDetail(postId: string, viewerId: string | null): Promise<PostResponse> {
  const row = await postRepository.findDetailById(postId);
  if (!row) throw new NotFoundError('Post not found');

  const summaries = await reactionRepository.summariesForPosts([postId], viewerId);
  return toPostResponse(row, summaries.get(postId) ?? EMPTY_REACTION_SUMMARY);
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
  const summaries = await reactionRepository.summariesForPosts(
    rows.map((row) => row.id),
    viewerId,
  );
  return rows.map((row) => toPostResponse(row, summaries.get(row.id) ?? EMPTY_REACTION_SUMMARY));
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
