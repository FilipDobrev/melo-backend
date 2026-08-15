import { Router } from 'express';
import { validate } from '../middleware/validate';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import * as commentController from '../controllers/comment.controller';
import { postIdParamsSchema, type PostIdParams } from '../dto/post.dto';
import {
  createCommentSchema,
  commentIdParamsSchema,
  listCommentsQuerySchema,
  type CreateCommentInput,
  type CommentIdParams,
} from '../dto/comment.dto';

/**
 * Mounted at /posts by routes/index.ts, so paths below are relative to
 * /posts/:postId/comments.
 */
export const commentRouter = Router();

commentRouter.post<PostIdParams, unknown, CreateCommentInput>(
  '/:postId/comments',
  validate({ params: postIdParamsSchema, body: createCommentSchema }),
  ...authed(commentController.createComment),
);

commentRouter.get<PostIdParams>(
  '/:postId/comments',
  optionalAuth,
  validate({ params: postIdParamsSchema, query: listCommentsQuerySchema }),
  asyncHandler(commentController.listComments),
);

commentRouter.delete<CommentIdParams>(
  '/:postId/comments/:commentId',
  validate({ params: commentIdParamsSchema }),
  ...authed(commentController.deleteComment),
);
