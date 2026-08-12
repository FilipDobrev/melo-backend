import type { Request, Response } from 'express';
import { getUserId } from '../middleware/auth';
import type { CreateUploadUrlInput, CreatePostInput, PostIdParams, PostImageParams, ListPostsQuery, UserPostsParams } from '../dto/post.dto';
import type { PutReactionInput } from '../dto/reaction.dto';
import * as postService from '../services/post.service';
import * as reactionService from '../services/reaction.service';
import * as storageService from '../services/storage.service';

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateUploadUrlInput;
  const result = await storageService.createUploadUrl({
    userId: getUserId(req),
    contentType: body.contentType,
    contentLength: body.contentLength,
  });
  res.status(200).json(result);
}

export async function createPost(req: Request, res: Response): Promise<void> {
  const body = req.body as CreatePostInput;
  const post = await postService.createPost({
    ownerId: getUserId(req),
    caption: body.caption,
    recipeId: body.recipeId,
    imageKeys: body.imageKeys,
  });
  res.status(201).json(post);
}

export async function getPost(req: Request, res: Response): Promise<void> {
  const { postId } = req.params as unknown as PostIdParams;
  const post = await postService.getPostDetail(postId, req.user?.id ?? null);
  res.status(200).json(post);
}

export async function deletePost(req: Request, res: Response): Promise<void> {
  const { postId } = req.params as unknown as PostIdParams;
  await postService.deletePost(postId, getUserId(req));
  res.status(204).end();
}

export async function deletePostImage(req: Request, res: Response): Promise<void> {
  const { postId, imageId } = req.params as unknown as PostImageParams;
  await postService.deletePostImage(postId, imageId, getUserId(req));
  res.status(204).end();
}

export async function putReaction(req: Request, res: Response): Promise<void> {
  const { postId } = req.params as unknown as PostIdParams;
  const { emoji } = req.body as PutReactionInput;
  const reactions = await reactionService.upsertReaction(postId, getUserId(req), emoji);
  res.status(200).json(reactions);
}

export async function deleteReaction(req: Request, res: Response): Promise<void> {
  const { postId } = req.params as unknown as PostIdParams;
  await reactionService.removeReaction(postId, getUserId(req));
  res.status(204).end();
}

export async function listUserPosts(req: Request, res: Response): Promise<void> {
  const { userId } = req.params as unknown as UserPostsParams;
  const { cursor, limit } = req.query as unknown as ListPostsQuery;
  const page = await postService.listUserPosts(userId, req.user?.id ?? null, { cursor, limit });
  res.status(200).json(page);
}
