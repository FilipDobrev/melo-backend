import type { User } from '@prisma/client';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as userRepository from '../repositories/user.repository';
import type { SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';
import * as storageService from './storage.service';
import type { CreateUploadUrlResult } from './storage.service';

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

/** Never expose passwordHash. Only the account owner sees their own email. */
export function toMeUser(user: User): MeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    profileImage: resolveProfileImage(user.profileImage),
    createdAt: user.createdAt,
  };
}

export function toPublicUser(user: userRepository.PublicUserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    profileImage: resolveProfileImage(user.profileImage),
    createdAt: user.createdAt,
  };
}

/** @throws {NotFoundError} if the user does not exist. */
export async function getMe(userId: string): Promise<MeUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  return toMeUser(user);
}

const LEGACY_PROFILE_IMAGE_URL_PATTERN = /^https?:\/\//i;

/**
 * Rejects a storage key that does not belong to the caller's own avatar upload prefix, so a
 * user cannot point their avatar at another user's uploaded object. Mirrors
 * validateImageKeyOwnership in post.service.ts.
 * TRANSITIONAL: a plain http(s) URL skips this check entirely (see updateMe below) - delete this
 * comment once that form is removed.
 * @throws {BadRequestError} if the key falls outside `avatars/<ownerId>/`.
 */
function validateAvatarKeyOwnership(storageKey: string, ownerId: string): void {
  if (!storageKey.startsWith(`avatars/${ownerId}/`)) {
    throw new BadRequestError('Avatar image key must belong to the caller');
  }
}

/**
 * @throws {ConflictError} if the new username is already taken by another user.
 * @throws {BadRequestError} if a non-legacy-URL profileImage fails ownership validation (see
 * {@link validateAvatarKeyOwnership}) or storage verification (`verifyUploadedImage`).
 */
export async function updateMe(userId: string, input: UpdateMeInput): Promise<MeUser> {
  if (input.username) {
    const existing = await userRepository.findByUsername(input.username);
    if (existing && existing.id !== userId) {
      throw new ConflictError('Username is already taken');
    }
  }

  // TRANSITIONAL: the current frontend still sends a plain http(s) URL
  // directly, so that form is accepted unchecked. Only the storage-key form
  // is verified as belonging to the caller. Delete this branch, and go back
  // to always validating, once the frontend only ever sends keys.
  if (
    input.profileImage !== undefined &&
    input.profileImage !== null &&
    !LEGACY_PROFILE_IMAGE_URL_PATTERN.test(input.profileImage)
  ) {
    validateAvatarKeyOwnership(input.profileImage, userId);
    await storageService.verifyUploadedImage(input.profileImage);
  }

  const updated = await userRepository.update(userId, {
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.profileImage !== undefined ? { profileImage: input.profileImage } : {}),
  });
  return toMeUser(updated);
}

/**
 * @param viewerId When present and different from `userId`, includes `isFollowing`.
 * @throws {NotFoundError} if the user does not exist.
 */
export async function getPublicProfile(userId: string, viewerId?: string): Promise<PublicProfile> {
  const profile = await userRepository.findPublicProfileCounts(userId);
  if (!profile) throw new NotFoundError('User not found');

  const isFollowing =
    viewerId && viewerId !== userId ? await userRepository.isFollowing(viewerId, userId) : undefined;

  return {
    id: profile.id,
    username: profile.username,
    profileImage: resolveProfileImage(profile.profileImage),
    createdAt: profile.createdAt,
    followerCount: profile._count.followers,
    followingCount: profile._count.following,
    ...(isFollowing !== undefined ? { isFollowing } : {}),
  };
}

export function createAvatarUploadUrl(
  userId: string,
  contentType: string,
  contentLength: number,
): Promise<CreateUploadUrlResult> {
  return storageService.createUploadUrl({ userId, contentType, contentLength, folder: 'avatars' });
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
