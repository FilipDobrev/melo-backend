import { prisma, type Db } from '../lib/prisma';

/** Minimal identity fields for rendering a user in a follower/following list. */
export interface UserSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

const userSummarySelect = { id: true, username: true, profileImage: true } as const;

/**
 * Excludes pending-deletion users, so following (and 404s from
 * followUser/unfollowUser's existence check) treats them as gone, same as
 * every other surface.
 */
export async function userExists(userId: string, db: Db = prisma): Promise<boolean> {
  const user = await db.user.findFirst({
    where: { id: userId, deletionRequestedAt: null },
    select: { id: true },
  });
  return user !== null;
}

/**
 * Relies on the `@@unique([followerId, followingId])` constraint; a
 * duplicate call raises P2002, which the error middleware maps to 409.
 */
export async function createFollow(
  followerId: string,
  followingId: string,
  db: Db = prisma,
): Promise<void> {
  await db.follow.create({ data: { followerId, followingId } });
}

/**
 * Deletes via the compound unique key; a missing row raises P2025, which
 * the error middleware maps to 404.
 */
export async function deleteFollow(
  followerId: string,
  followingId: string,
  db: Db = prisma,
): Promise<void> {
  await db.follow.delete({
    where: { followerId_followingId: { followerId, followingId } },
  });
}

/**
 * Followers of `userId`. followerId is unique within this filtered set
 * (per the compound unique constraint), so it doubles as the page cursor.
 */
export async function listFollowers(
  userId: string,
  cursor: string | undefined,
  limit: number,
  db: Db = prisma,
): Promise<UserSummary[]> {
  const rows = await db.follow.findMany({
    // A pending-deletion follower must not appear in someone else's list.
    where: { followingId: userId, follower: { deletionRequestedAt: null } },
    orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
    take: limit + 1,
    ...(cursor
      ? { cursor: { followerId_followingId: { followerId: cursor, followingId: userId } }, skip: 1 }
      : {}),
    select: { follower: { select: userSummarySelect } },
  });
  return rows.map((row) => row.follower);
}

/**
 * Users that `userId` follows. followingId is unique within this filtered
 * set, so it doubles as the page cursor.
 */
export async function listFollowing(
  userId: string,
  cursor: string | undefined,
  limit: number,
  db: Db = prisma,
): Promise<UserSummary[]> {
  const rows = await db.follow.findMany({
    // A pending-deletion followee must not appear in someone else's list.
    where: { followerId: userId, following: { deletionRequestedAt: null } },
    orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
    take: limit + 1,
    ...(cursor
      ? { cursor: { followerId_followingId: { followerId: userId, followingId: cursor } }, skip: 1 }
      : {}),
    select: { following: { select: userSummarySelect } },
  });
  return rows.map((row) => row.following);
}
