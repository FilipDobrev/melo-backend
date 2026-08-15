import type { CreateCommentInput, ListCommentsQuery } from '../dto/comment.dto';
import type { Page } from '../lib/pagination';
import * as commentService from '../services/comment.service';
import type { CommentResponse } from '../services/comment.service';
import type {
  AuthorizedRequest,
  PostCommentParams,
  PostIdParams,
  TypedResponse,
  UnauthorizedRequest,
} from '../types/http';

/** Adds a comment to a post. Responds 201. */
export async function createComment(
  req: AuthorizedRequest<CreateCommentInput, unknown, PostIdParams>,
  res: TypedResponse<CommentResponse>,
): Promise<void> {
  const comment = await commentService.createComment(req.params.postId, req.userId, req.body.content);
  res.status(201).json(comment);
}

/** Lists comments on a post. */
export async function listComments(
  req: UnauthorizedRequest<void, ListCommentsQuery, PostIdParams>,
  res: TypedResponse<Page<CommentResponse>>,
): Promise<void> {
  const page = await commentService.listComments(req.params.postId, {
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.status(200).json(page);
}

/** Deletes a comment. Responds 204. */
export async function deleteComment(
  req: AuthorizedRequest<void, unknown, PostCommentParams>,
  res: TypedResponse<void>,
): Promise<void> {
  await commentService.deleteComment(req.params.postId, req.params.commentId, req.userId);
  res.status(204).end();
}
