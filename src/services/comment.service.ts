import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { CursorPagination, Page } from '../lib/pagination';
import { toPage } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as commentRepository from '../repositories/comment.repository';
import type { CommentRow } from '../repositories/comment.repository';
import * as postRepository from '../repositories/post.repository';
import type { AuthorSummary } from './post.service';

export interface CommentResponse {
  id: string;
  postId: string;
  content: string;
  createdAt: Date;
  author: AuthorSummary;
}

function toCommentResponse(row: CommentRow): CommentResponse {
  return {
    id: row.id,
    postId: row.postId,
    content: row.content,
    createdAt: row.createdAt,
    author: { ...row.author, profileImage: resolveProfileImage(row.author.profileImage) },
  };
}

export async function createComment(
  postId: string,
  authorId: string,
  content: string,
): Promise<CommentResponse> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');

  const row = await commentRepository.create({ postId, authorId, content });
  return toCommentResponse(row);
}

export async function listComments(
  postId: string,
  pagination: CursorPagination,
): Promise<Page<CommentResponse>> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');

  const rows = await commentRepository.list({
    postId,
    cursor: pagination.cursor,
    limit: pagination.limit,
  });
  const page = toPage(rows, pagination.limit);
  return { items: page.items.map(toCommentResponse), nextCursor: page.nextCursor };
}

/// A comment may be deleted by whoever wrote it, or by the post owner
/// moderating their own post.
export async function deleteComment(postId: string, commentId: string, userId: string): Promise<void> {
  const comment = await commentRepository.findById(commentId);
  if (!comment || comment.postId !== postId) throw new NotFoundError('Comment not found');

  if (comment.authorId !== userId) {
    const post = await postRepository.findOwnerId(postId);
    if (!post || post.ownerId !== userId) throw new ForbiddenError();
  }

  await commentRepository.remove(commentId);
}
