import { Router } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { validate } from '../middleware/validate';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as postController from '../controllers/post.controller';
import {
  createUploadUrlSchema,
  createPostSchema,
  postIdParamsSchema,
  postImageParamsSchema,
  userPostsParamsSchema,
  listPostsQuerySchema,
  type CreateUploadUrlInput,
  type CreatePostInput,
  type PostIdParams,
  type PostImageParams,
  type UserPostsParams,
} from '../dto/post.dto';
import { putReactionSchema, type PutReactionInput } from '../dto/reaction.dto';

export const postRouter = Router();

postRouter.post<ParamsDictionary, unknown, CreateUploadUrlInput>(
  '/images/upload-url',
  requireAuth,
  validate({ body: createUploadUrlSchema }),
  asyncHandler(postController.createUploadUrl),
);

postRouter.post<ParamsDictionary, unknown, CreatePostInput>(
  '/',
  requireAuth,
  validate({ body: createPostSchema }),
  asyncHandler(postController.createPost),
);

postRouter.get<PostIdParams>(
  '/:postId',
  optionalAuth,
  validate({ params: postIdParamsSchema }),
  asyncHandler(postController.getPost),
);

postRouter.delete<PostIdParams>(
  '/:postId',
  requireAuth,
  validate({ params: postIdParamsSchema }),
  asyncHandler(postController.deletePost),
);

postRouter.delete<PostImageParams>(
  '/:postId/images/:imageId',
  requireAuth,
  validate({ params: postImageParamsSchema }),
  asyncHandler(postController.deletePostImage),
);

postRouter.put<PostIdParams, unknown, PutReactionInput>(
  '/:postId/reactions',
  requireAuth,
  validate({ params: postIdParamsSchema, body: putReactionSchema }),
  asyncHandler(postController.putReaction),
);

postRouter.delete<PostIdParams>(
  '/:postId/reactions',
  requireAuth,
  validate({ params: postIdParamsSchema }),
  asyncHandler(postController.deleteReaction),
);

/// Mounts on userRouter as GET /users/:userId/posts. Exported separately
/// because this module owns posts, not the /users prefix.
export const userPostRouter = Router();

userPostRouter.get<UserPostsParams>(
  '/:userId/posts',
  optionalAuth,
  validate({ params: userPostsParamsSchema, query: listPostsQuerySchema }),
  asyncHandler(postController.listUserPosts),
);
