import type { User } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { DEFAULT_PAGE_SIZE } from '../lib/pagination';

export interface CreateUserData {
  username: string;
  email: string;
  passwordHash: string;
}

export interface UpdateUserData {
  username?: string;
  profileImage?: string | null;
}

export interface PublicProfileCounts {
  id: string;
  username: string;
  profileImage: string | null;
  createdAt: Date;
  _count: { followers: number; following: number };
}

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

export function update(id: string, data: UpdateUserData, db: Db = prisma): Promise<User> {
  return db.user.update({ where: { id }, data });
}

export function findPublicProfileCounts(
  id: string,
  db: Db = prisma,
): Promise<PublicProfileCounts | null> {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      profileImage: true,
      createdAt: true,
      _count: { select: { followers: true, following: true } },
    },
  });
}

/// True when `followerId` already follows `followingId`. Uses the
/// (followerId, followingId) unique index, so this is a single index lookup.
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

export interface PublicUserRow {
  id: string;
  username: string;
  profileImage: string | null;
  createdAt: Date;
}

/// Fetches limit + 1 rows so the caller can derive the next cursor without
/// an extra count query. See src/lib/pagination.ts.
export function search(
  { search: term, cursor, limit = DEFAULT_PAGE_SIZE }: SearchUsersParams,
  db: Db = prisma,
): Promise<PublicUserRow[]> {
  return db.user.findMany({
    where: term ? { username: { contains: term, mode: 'insensitive' } } : undefined,
    select: { id: true, username: true, profileImage: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}
