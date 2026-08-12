import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as commentController from '../controllers/comment.controller';
import { postIdParamsSchema, type PostIdParams } from '../dto/post.dto';
import {
  createCommentSchema,
  commentIdParamsSchema,
  listCommentsQuerySchema,
  type CreateCommentInput,
  type CommentIdParams,
} from '../dto/comment.dto';

/// Mounted at /posts by routes/index.ts, so paths below are relative to
/// /posts/:postId/comments.
export const commentRouter = Router();

commentRouter.post<PostIdParams, unknown, CreateCommentInput>(
  '/:postId/comments',
  requireAuth,
  validate({ params: postIdParamsSchema, body: createCommentSchema }),
  asyncHandler(commentController.createComment),
);

commentRouter.get<PostIdParams>(
  '/:postId/comments',
  optionalAuth,
  validate({ params: postIdParamsSchema, query: listCommentsQuerySchema }),
  asyncHandler(commentController.listComments),
);

commentRouter.delete<CommentIdParams>(
  '/:postId/comments/:commentId',
  requireAuth,
  validate({ params: commentIdParamsSchema }),
  asyncHandler(commentController.deleteComment),
);
