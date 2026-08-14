import { BadRequestError, NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as followRepository from '../repositories/follow.repository';
import type { UserSummary } from '../repositories/follow.repository';

function toUserSummary(user: UserSummary): UserSummary {
  return { ...user, profileImage: resolveProfileImage(user.profileImage) };
}

export async function followUser(currentUserId: string, targetUserId: string): Promise<void> {
  if (currentUserId === targetUserId) {
    throw new BadRequestError('You cannot follow yourself');
  }
  const targetExists = await followRepository.userExists(targetUserId);
  if (!targetExists) {
    throw new NotFoundError('User not found');
  }
  // Duplicate follows are rejected by the DB unique constraint (P2002 -> 409),
  // avoiding a read-then-write race.
  await followRepository.createFollow(currentUserId, targetUserId);
}

export async function unfollowUser(currentUserId: string, targetUserId: string): Promise<void> {
  // A missing row raises P2025 -> 404, handled by the error middleware.
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
