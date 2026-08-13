import type { CreateUploadUrlInput, CreatePostInput, ListPostsQuery } from '../dto/post.dto';
import type { PutReactionInput } from '../dto/reaction.dto';
import type { Page } from '../lib/pagination';
import * as postService from '../services/post.service';
import type { PostResponse } from '../services/post.service';
import * as reactionService from '../services/reaction.service';
import type { ReactionSummary } from '../repositories/reaction.repository';
import * as storageService from '../services/storage.service';
import type { CreateUploadUrlResult } from '../services/storage.service';
import type {
  AuthorizedRequest,
  PostIdParams,
  PostImageParams,
  TypedResponse,
  UnauthorizedRequest,
  UserIdParams,
} from '../types/http';

export async function createUploadUrl(
  req: AuthorizedRequest<CreateUploadUrlInput>,
  res: TypedResponse<CreateUploadUrlResult>,
): Promise<void> {
  const result = await storageService.createUploadUrl({
    userId: req.userId,
    contentType: req.body.contentType,
    contentLength: req.body.contentLength,
    folder: 'posts',
  });
  res.status(200).json(result);
}

export async function createPost(
  req: AuthorizedRequest<CreatePostInput>,
  res: TypedResponse<PostResponse>,
): Promise<void> {
  const post = await postService.createPost({
    ownerId: req.userId,
    caption: req.body.caption,
    recipeId: req.body.recipeId,
    imageKeys: req.body.imageKeys,
  });
  res.status(201).json(post);
}

export async function getPost(
  req: UnauthorizedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<PostResponse>,
): Promise<void> {
  const post = await postService.getPostDetail(req.params.postId, req.userId ?? null);
  res.status(200).json(post);
}

export async function deletePost(
  req: AuthorizedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await postService.deletePost(req.params.postId, req.userId);
  res.status(204).end();
}

export async function deletePostImage(
  req: AuthorizedRequest<void, unknown, PostImageParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await postService.deletePostImage(req.params.postId, req.params.imageId, req.userId);
  res.status(204).end();
}

export async function putReaction(
  req: AuthorizedRequest<PutReactionInput, unknown, PostIdParams>,
  res: TypedResponse<ReactionSummary>,
): Promise<void> {
  const reactions = await reactionService.upsertReaction(req.params.postId, req.userId, req.body.emoji);
  res.status(200).json(reactions);
}

export async function deleteReaction(
  req: AuthorizedRequest<void, unknown, PostIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await reactionService.removeReaction(req.params.postId, req.userId);
  res.status(204).end();
}

export async function listUserPosts(
  req: UnauthorizedRequest<void, ListPostsQuery, UserIdParams>,
  res: TypedResponse<Page<PostResponse>>,
): Promise<void> {
  const page = await postService.listUserPosts(req.params.userId, req.userId ?? null, {
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.status(200).json(page);
}
