import type { User } from '@prisma/client';
import { ConflictError, NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import * as userRepository from '../repositories/user.repository';
import type { SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';

export interface MeUser {
  id: string;
  username: string;
  email: string;
  profileImage: string | null;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  username: string;
  profileImage: string | null;
  createdAt: Date;
}

export interface PublicProfile extends PublicUser {
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
}

/// Never expose passwordHash. Only the account owner sees their own email.
export function toMeUser(user: User): MeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    profileImage: user.profileImage,
    createdAt: user.createdAt,
  };
}

export function toPublicUser(user: userRepository.PublicUserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    profileImage: user.profileImage,
    createdAt: user.createdAt,
  };
}

export async function getMe(userId: string): Promise<MeUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  return toMeUser(user);
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<MeUser> {
  if (input.username) {
    const existing = await userRepository.findByUsername(input.username);
    if (existing && existing.id !== userId) {
      throw new ConflictError('Username is already taken');
    }
  }

  const updated = await userRepository.update(userId, {
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.profileImage !== undefined ? { profileImage: input.profileImage } : {}),
  });
  return toMeUser(updated);
}

export async function getPublicProfile(userId: string, viewerId?: string): Promise<PublicProfile> {
  const profile = await userRepository.findPublicProfileCounts(userId);
  if (!profile) throw new NotFoundError('User not found');

  const isFollowing =
    viewerId && viewerId !== userId ? await userRepository.isFollowing(viewerId, userId) : undefined;

  return {
    id: profile.id,
    username: profile.username,
    profileImage: profile.profileImage,
    createdAt: profile.createdAt,
    followerCount: profile._count.followers,
    followingCount: profile._count.following,
    ...(isFollowing !== undefined ? { isFollowing } : {}),
  };
}

export async function searchUsers(query: SearchUsersQuery): Promise<Page<PublicUser>> {
  const rows = await userRepository.search({
    search: query.search,
    cursor: query.cursor,
    limit: query.limit,
  });
  const page = toPage(rows, query.limit);
  return { items: page.items.map(toPublicUser), nextCursor: page.nextCursor };
}
