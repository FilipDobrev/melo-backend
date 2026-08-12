import { getUserId } from '../middleware/auth';
import type { CreateUploadUrlInput, CreatePostInput, ListPostsQuery } from '../dto/post.dto';
import type { PutReactionInput } from '../dto/reaction.dto';
import type { Page } from '../lib/pagination';
import * as postService from '../services/post.service';
import type { PostResponse } from '../services/post.service';
import * as reactionService from '../services/reaction.service';
import type { ReactionSummary } from '../repositories/reaction.repository';
import * as storageService from '../services/storage.service';
import type { CreateUploadUrlResult } from '../services/storage.service';
import type { PostIdParams, PostImageParams, TypedRequest, TypedResponse, UserIdParams } from '../types/http';

export async function createUploadUrl(
  req: TypedRequest<CreateUploadUrlInput>,
  res: TypedResponse<CreateUploadUrlResult>,
): Promise<void> {
  const result = await storageService.createUploadUrl({
    userId: getUserId(req),
    contentType: req.body.contentType,
    contentLength: req.body.contentLength,
  });
  res.status(200).json(result);
}

export async function createPost(
  req: TypedRequest<CreatePostInput>,
  res: TypedResponse<PostResponse>,
): Promise<void> {
  const post = await postService.createPost({
    ownerId: getUserId(req),
    caption: req.body.caption,
    recipeId: req.body.recipeId,
    imageKeys: req.body.imageKeys,
  });
  res.status(201).json(post);
}

export async function getPost(
  req: TypedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<PostResponse>,
): Promise<void> {
  const post = await postService.getPostDetail(req.params.postId, req.user?.id ?? null);
  res.status(200).json(post);
}

export async function deletePost(
  req: TypedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await postService.deletePost(req.params.postId, getUserId(req));
  res.status(204).end();
}

export async function deletePostImage(
  req: TypedRequest<void, unknown, PostImageParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await postService.deletePostImage(req.params.postId, req.params.imageId, getUserId(req));
  res.status(204).end();
}

export async function putReaction(
  req: TypedRequest<PutReactionInput, unknown, PostIdParams>,
  res: TypedResponse<ReactionSummary>,
): Promise<void> {
  const reactions = await reactionService.upsertReaction(req.params.postId, getUserId(req), req.body.emoji);
  res.status(200).json(reactions);
}

export async function deleteReaction(
  req: TypedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await reactionService.removeReaction(req.params.postId, getUserId(req));
  res.status(204).end();
}

export async function listUserPosts(
  req: TypedRequest<void, ListPostsQuery, UserIdParams>,
  res: TypedResponse<Page<PostResponse>>,
): Promise<void> {
  const page = await postService.listUserPosts(req.params.userId, req.user?.id ?? null, {
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.status(200).json(page);
}
