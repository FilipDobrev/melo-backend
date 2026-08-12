import { prisma, type Db } from '../lib/prisma';

export interface UserSummary {
  id: string;
  username: string;
  profileImage: string | null;
}

const userSummarySelect = { id: true, username: true, profileImage: true } as const;

export async function userExists(userId: string, db: Db = prisma): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user !== null;
}

/// Relies on the `@@unique([followerId, followingId])` constraint; a
/// duplicate call raises P2002, which the error middleware maps to 409.
export async function createFollow(
  followerId: string,
  followingId: string,
  db: Db = prisma,
): Promise<void> {
  await db.follow.create({ data: { followerId, followingId } });
}

/// Deletes via the compound unique key; a missing row raises P2025, which
/// the error middleware maps to 404.
export async function deleteFollow(
  followerId: string,
  followingId: string,
  db: Db = prisma,
): Promise<void> {
  await db.follow.delete({
    where: { followerId_followingId: { followerId, followingId } },
  });
}

/// Followers of `userId`. followerId is unique within this filtered set
/// (per the compound unique constraint), so it doubles as the page cursor.
export async function listFollowers(
  userId: string,
  cursor: string | undefined,
  limit: number,
  db: Db = prisma,
): Promise<UserSummary[]> {
  const rows = await db.follow.findMany({
    where: { followingId: userId },
    orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
    take: limit + 1,
    ...(cursor
      ? { cursor: { followerId_followingId: { followerId: cursor, followingId: userId } }, skip: 1 }
      : {}),
    select: { follower: { select: userSummarySelect } },
  });
  return rows.map((row) => row.follower);
}

/// Users that `userId` follows. followingId is unique within this filtered
/// set, so it doubles as the page cursor.
export async function listFollowing(
  userId: string,
  cursor: string | undefined,
  limit: number,
  db: Db = prisma,
): Promise<UserSummary[]> {
  const rows = await db.follow.findMany({
    where: { followerId: userId },
    orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
    take: limit + 1,
    ...(cursor
      ? { cursor: { followerId_followingId: { followerId: userId, followingId: cursor } }, skip: 1 }
      : {}),
    select: { following: { select: userSummarySelect } },
  });
  return rows.map((row) => row.following);
}
