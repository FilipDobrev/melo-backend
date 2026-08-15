import { BadRequestError, NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as followRepository from '../repositories/follow.repository';
import type { UserSummary } from '../repositories/follow.repository';

function toUserSummary(user: UserSummary): UserSummary {
  return { ...user, profileImage: resolveProfileImage(user.profileImage) };
}

/**
 * @throws {BadRequestError} if the caller targets themselves.
 * @throws {NotFoundError} if the target user does not exist.
 * @throws A duplicate follow is rejected by the DB's unique constraint (Prisma P2002 -> 409),
 * avoiding a read-then-write race.
 */
export async function followUser(currentUserId: string, targetUserId: string): Promise<void> {
  if (currentUserId === targetUserId) {
    throw new BadRequestError('You cannot follow yourself');
  }
  const targetExists = await followRepository.userExists(targetUserId);
  if (!targetExists) {
    throw new NotFoundError('User not found');
  }
  await followRepository.createFollow(currentUserId, targetUserId);
}

/** @throws A missing follow row raises Prisma P2025, mapped to 404 by the error middleware. */
export async function unfollowUser(currentUserId: string, targetUserId: string): Promise<void> {
  await followRepository.deleteFollow(currentUserId, targetUserId);
}

export async function listFollowers(
  targetUserId: string,
  cursor: string | undefined,
  limit: number,
): Promise<Page<UserSummary>> {
  const rows = await followRepository.listFollowers(targetUserId, cursor, limit);
  const page = toPage(rows, limit);
  return { items: page.items.map(toUserSummary), nextCursor: page.nextCursor };
}

export async function listFollowing(
  targetUserId: string,
  cursor: string | undefined,
  limit: number,
): Promise<Page<UserSummary>> {
  const rows = await followRepository.listFollowing(targetUserId, cursor, limit);
  const page = toPage(rows, limit);
  return { items: page.items.map(toUserSummary), nextCursor: page.nextCursor };
}
