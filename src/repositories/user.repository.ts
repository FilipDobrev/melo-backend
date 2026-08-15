import type { User } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { DEFAULT_PAGE_SIZE } from '../lib/pagination';

/**
 * Every repository function in this folder takes an optional `db: Db = prisma`
 * as its last parameter. This lets callers run the query on the default
 * client, or pass in an interactive transaction (`prisma.$transaction`) so
 * the call participates in a caller-owned transaction instead of committing
 * on its own. Not repeated on individual functions below.
 */

export interface CreateUserData {
  username: string;
  email: string;
  passwordHash: string;
}

export interface UpdateUserData {
  username?: string;
  profileImage?: string | null;
}

/** Row shape for a public-facing profile: identity fields plus follower/following counts. */
export interface PublicProfileCounts {
  id: string;
  username: string;
  profileImage: string | null;
  createdAt: Date;
  _count: { followers: number; following: number };
}

/** Creates a user record. Relies on the unique constraints on `email` and
 * `username`; a duplicate raises P2002, which the error middleware maps to 409. */
export function create(data: CreateUserData, db: Db = prisma): Promise<User> {
  return db.user.create({ data });
}

export function findById(id: string, db: Db = prisma): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

export function findByEmail(email: string, db: Db = prisma): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export function findByUsername(username: string, db: Db = prisma): Promise<User | null> {
  return db.user.findUnique({ where: { username } });
}

/** Updates a user. Relies on the unique constraint on `username`; a
 * collision raises P2002, which the error middleware maps to 409. */
export function update(id: string, data: UpdateUserData, db: Db = prisma): Promise<User> {
  return db.user.update({ where: { id }, data });
}

/**
 * Final step of a purge: removes the user row and lets the schema's cascades
 * remove everything that still points at it (posts, comments, reactions,
 * follows, cookbook saves, collections, refresh tokens, and any recipe not
 * already reassigned to the tombstone account).
 */
export function deleteUser(id: string, db: Db = prisma): Promise<User> {
  return db.user.delete({ where: { id } });
}

/**
 * Excludes pending-deletion users: their public profile is gone for everyone
 * else the moment deletion is requested, even though the row still exists
 * until the purge. `findFirst` rather than `findUnique` because the filter
 * combines the unique `id` with a non-unique condition; `id` alone still
 * makes this a single-row lookup.
 */
export function findPublicProfileCounts(
  id: string,
  db: Db = prisma,
): Promise<PublicProfileCounts | null> {
  return db.user.findFirst({
    where: { id, deletionRequestedAt: null },
    select: {
      id: true,
      username: true,
      profileImage: true,
      createdAt: true,
      _count: { select: { followers: true, following: true } },
    },
  });
}

/**
 * True when `followerId` already follows `followingId`. Uses the
 * (followerId, followingId) unique index, so this is a single index lookup.
 */
export async function isFollowing(
  followerId: string,
  followingId: string,
  db: Db = prisma,
): Promise<boolean> {
  const follow = await db.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
    select: { id: true },
  });
  return follow !== null;
}

export interface SearchUsersParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

/** Row shape for a user in a search result / public listing context. */
export interface PublicUserRow {
  id: string;
  username: string;
  profileImage: string | null;
  createdAt: Date;
}

/**
 * Fetches limit + 1 rows so the caller can derive the next cursor without
 * an extra count query. See src/lib/pagination.ts.
 */
export function search(
  { search: term, cursor, limit = DEFAULT_PAGE_SIZE }: SearchUsersParams,
  db: Db = prisma,
): Promise<PublicUserRow[]> {
  return db.user.findMany({
    // Pending-deletion users must not surface in discovery.
    where: {
      deletionRequestedAt: null,
      ...(term ? { username: { contains: term, mode: 'insensitive' } } : {}),
    },
    select: { id: true, username: true, profileImage: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

export interface PendingDeletionUser {
  id: string;
}

/** Requesting deletion: stamps the timestamp that starts the grace period. */
export function setDeletionRequested(id: string, requestedAt: Date, db: Db = prisma): Promise<User> {
  return db.user.update({ where: { id }, data: { deletionRequestedAt: requestedAt } });
}

/** Cancelling deletion: returns the account to normal. */
export function clearDeletionRequested(id: string, db: Db = prisma): Promise<User> {
  return db.user.update({ where: { id }, data: { deletionRequestedAt: null } });
}

/** Users whose grace period has elapsed - the purge script's work queue. */
export function findPendingDeletionOlderThan(
  cutoff: Date,
  db: Db = prisma,
): Promise<PendingDeletionUser[]> {
  return db.user.findMany({
    where: { deletionRequestedAt: { lt: cutoff } },
    select: { id: true },
  });
}
