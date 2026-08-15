import { prisma, type Db } from '../lib/prisma';

/** Aggregate reaction counts for a single post, plus the viewer's own reaction (if any). */
export interface ReactionSummary {
  total: number;
  byEmoji: Record<string, number>;
  mine: string | null;
}

/** Shared zero-value fallback for posts with no reactions, so callers don't
 * each construct their own empty shape. */
export const EMPTY_REACTION_SUMMARY: ReactionSummary = { total: 0, byEmoji: {}, mine: null };

/**
 * Builds a reaction summary for every post in `postIds` with exactly two
 * queries total (a groupBy and, when authenticated, a viewer lookup) no
 * matter how many posts are being rendered - avoids per-post follow-up
 * queries on the feed and post-list endpoints.
 */
export async function summariesForPosts(
  postIds: string[],
  viewerId: string | null,
  db: Db = prisma,
): Promise<Map<string, ReactionSummary>> {
  const summaries = new Map<string, ReactionSummary>();
  if (postIds.length === 0) return summaries;

  for (const postId of postIds) {
    summaries.set(postId, { total: 0, byEmoji: {}, mine: null });
  }

  const [grouped, mineRows] = await Promise.all([
    db.reaction.groupBy({
      by: ['postId', 'emoji'],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    }),
    viewerId
      ? db.reaction.findMany({
          where: { postId: { in: postIds }, userId: viewerId },
          select: { postId: true, emoji: true },
        })
      : Promise.resolve([]),
  ]);

  for (const row of grouped) {
    const summary = summaries.get(row.postId);
    if (!summary) continue;
    summary.byEmoji[row.emoji] = row._count._all;
    summary.total += row._count._all;
  }

  for (const row of mineRows) {
    const summary = summaries.get(row.postId);
    if (summary) summary.mine = row.emoji;
  }

  return summaries;
}

/** Sets (or replaces) the caller's reaction on a post. Upsert rather than
 * create+update because a user can only have one reaction per post at a time. */
export function upsert(
  postId: string,
  userId: string,
  emoji: string,
  db: Db = prisma,
): Promise<{ id: string }> {
  return db.reaction.upsert({
    where: { postId_userId: { postId, userId } },
    update: { emoji },
    create: { postId, userId, emoji },
    select: { id: true },
  });
}

/**
 * deleteMany rather than delete: removing a reaction that no longer exists
 * is not an error, it just means there is nothing to do.
 */
export async function remove(postId: string, userId: string, db: Db = prisma): Promise<void> {
  await db.reaction.deleteMany({ where: { postId, userId } });
}
