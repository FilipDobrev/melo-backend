import { getUserId } from '../middleware/auth';
import type { CreateCommentInput, ListCommentsQuery } from '../dto/comment.dto';
import type { Page } from '../lib/pagination';
import * as commentService from '../services/comment.service';
import type { CommentResponse } from '../services/comment.service';
import type { PostCommentParams, PostIdParams, TypedRequest, TypedResponse } from '../types/http';

export async function createComment(
  req: TypedRequest<CreateCommentInput, unknown, PostIdParams>,
  res: TypedResponse<CommentResponse>,
): Promise<void> {
  const comment = await commentService.createComment(req.params.postId, getUserId(req), req.body.content);
  res.status(201).json(comment);
}

export async function listComments(
  req: TypedRequest<void, ListCommentsQuery, PostIdParams>,
  res: TypedResponse<Page<CommentResponse>>,
): Promise<void> {
  const page = await commentService.listComments(req.params.postId, {
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.status(200).json(page);
}

export async function deleteComment(
  req: TypedRequest<void, unknown, PostCommentParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await commentService.deleteComment(req.params.postId, req.params.commentId, getUserId(req));
  res.status(204).end();
}
