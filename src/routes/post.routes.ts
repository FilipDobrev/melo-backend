import { Router } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { validate } from '../middleware/validate';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import { uploadUrlRateLimiter } from '../middleware/rateLimit';
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
  uploadUrlRateLimiter,
  validate({ body: createUploadUrlSchema }),
  ...authed(postController.createUploadUrl),
);

postRouter.post<ParamsDictionary, unknown, CreatePostInput>(
  '/',
  validate({ body: createPostSchema }),
  ...authed(postController.createPost),
);

postRouter.get<PostIdParams>(
  '/:postId',
  optionalAuth,
  validate({ params: postIdParamsSchema }),
  asyncHandler(postController.getPost),
);

postRouter.delete<PostIdParams>(
  '/:postId',
  validate({ params: postIdParamsSchema }),
  ...authed(postController.deletePost),
);

postRouter.delete<PostImageParams>(
  '/:postId/images/:imageId',
  validate({ params: postImageParamsSchema }),
  ...authed(postController.deletePostImage),
);

postRouter.put<PostIdParams, unknown, PutReactionInput>(
  '/:postId/reactions',
  validate({ params: postIdParamsSchema, body: putReactionSchema }),
  ...authed(postController.putReaction),
);

postRouter.delete<PostIdParams>(
  '/:postId/reactions',
  validate({ params: postIdParamsSchema }),
  ...authed(postController.deleteReaction),
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
