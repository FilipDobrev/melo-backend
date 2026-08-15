import { prisma, type Db } from '../lib/prisma';
import { DEFAULT_PAGE_SIZE } from '../lib/pagination';
import { POST_CARD_SELECT, type PostCardRow } from './post.repository';

export interface ListFeedParams {
  followerId: string;
  cursor?: string;
  limit?: number;
}

/**
 * Single query: posts authored by anyone the caller follows, plus the
 * caller's own posts, newest first. The `owner.followers.some` filter is a
 * semi-join on the Follow table, so this stays one query regardless of page
 * size - no per-post lookups. Fetches limit + 1 rows for cursor derivation
 * (see src/lib/pagination.ts), and reuses POST_CARD_SELECT so the feed and
 * single-post queries can't drift apart.
 */
export function listFeed(
  { followerId, cursor, limit = DEFAULT_PAGE_SIZE }: ListFeedParams,
  db: Db = prisma,
): Promise<PostCardRow[]> {
  return db.post.findMany({
    where: { OR: [{ owner: { followers: { some: { followerId } } } }, { ownerId: followerId }] },
    select: POST_CARD_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}
