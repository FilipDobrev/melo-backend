import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { DEFAULT_PAGE_SIZE } from '../lib/pagination';

const COMMENT_SELECT = {
  id: true,
  postId: true,
  content: true,
  createdAt: true,
  author: { select: { id: true, username: true, profileImage: true } },
} satisfies Prisma.CommentSelect;

export type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

export interface CreateCommentData {
  postId: string;
  authorId: string;
  content: string;
}

export function create(data: CreateCommentData, db: Db = prisma): Promise<CommentRow> {
  return db.comment.create({ data, select: COMMENT_SELECT });
}

export interface ListCommentsParams {
  postId: string;
  cursor?: string;
  limit?: number;
}

/// Fetches limit + 1 rows so the caller can derive the next cursor without
/// an extra count query. See src/lib/pagination.ts.
export function list(
  { postId, cursor, limit = DEFAULT_PAGE_SIZE }: ListCommentsParams,
  db: Db = prisma,
): Promise<CommentRow[]> {
  return db.comment.findMany({
    where: { postId },
    select: COMMENT_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

export interface CommentOwnershipRow {
  id: string;
  postId: string;
  authorId: string;
}

export function findById(commentId: string, db: Db = prisma): Promise<CommentOwnershipRow | null> {
  return db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, authorId: true },
  });
}

export function remove(commentId: string, db: Db = prisma): Promise<{ id: string }> {
  return db.comment.delete({ where: { id: commentId }, select: { id: true } });
}
