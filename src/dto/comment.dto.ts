import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** Identifies a comment scoped to its parent post - a commentId alone is not enough to authorize deletion. */
export const commentIdParamsSchema = z.object({
  postId: z.string().uuid(),
  commentId: z.string().uuid(),
});
export type CommentIdParams = z.infer<typeof commentIdParamsSchema>;

export const listCommentsQuerySchema = cursorPaginationSchema;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
