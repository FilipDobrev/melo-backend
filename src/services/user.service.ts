import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { env } from '../config/env';
import { BadRequestError, ConflictError, NotFoundError, UnauthenticatedError } from '../lib/errors';
import { toPage, type Page } from '../lib/pagination';
import { resolveProfileImage } from '../lib/profileImage';
import * as userRepository from '../repositories/user.repository';
import * as refreshTokenRepository from '../repositories/refreshToken.repository';
import type { SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';
import { isReservedUsername } from './accountPurge.service';
import * as storageService from './storage.service';
import type { CreateUploadUrlResult } from './storage.service';

export interface MeUser {
  id: string;
  username: string;
  email: string;
  profileImage: string | null;
  createdAt: Date;
  /** When the caller requested account deletion; null for an active account. */
  deletionRequestedAt: Date | null;
  /** The date the purge script becomes eligible to permanently delete this
   * account, so the client can show "deleted on <date> unless you cancel".
   * Null for an active account. */
  purgeAt: Date | null;
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
    deletionRequestedAt: user.deletionRequestedAt,
    purgeAt: user.deletionRequestedAt ? purgeDateFor(user.deletionRequestedAt) : null,
  };
}

/** The purge script treats a request older than this as eligible for good. */
function purgeDateFor(deletionRequestedAt: Date): Date {
  return new Date(
    deletionRequestedAt.getTime() + env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );
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

/**
 * Requests account deletion: starts the grace period and logs the account
 * out everywhere. Nothing is destroyed yet - scripts/purge-deleted-users.ts
 * does that once the grace period elapses.
 * @throws {NotFoundError} if the user does not exist.
 * @throws {UnauthenticatedError} if `password` does not match the account's
 * password hash. A valid access token alone is deliberately not enough here:
 * tokens can be stolen and still work for up to their TTL, so destroying an
 * account requires proving the password one more time.
 */
export async function deleteMe(userId: string, password: string): Promise<void> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) throw new UnauthenticatedError('Incorrect password');

  await userRepository.setDeletionRequested(userId, new Date());
  await refreshTokenRepository.revokeAllActiveForUser(userId);
}

/**
 * Cancels a pending deletion, restoring the account to normal. Only valid
 * while still inside the grace period - once it has elapsed the account is
 * either already purged (a 404, since the row is gone) or about to be, so
 * cancelling is no longer honoured.
 * @throws {NotFoundError} if the user does not exist.
 * @throws {ConflictError} if the account is not pending deletion, or its
 * grace period has already elapsed.
 */
export async function restoreMe(userId: string): Promise<void> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  if (!user.deletionRequestedAt) {
    throw new ConflictError('Account is not pending deletion');
  }
  if (purgeDateFor(user.deletionRequestedAt) <= new Date()) {
    throw new ConflictError('The grace period for this account has already elapsed');
  }

  await userRepository.clearDeletionRequested(userId);
}

/**
 * Rejects a storage key that does not belong to the caller's own avatar upload prefix, so a
 * user cannot point their avatar at another user's uploaded object. Mirrors
 * validateImageKeyOwnership in post.service.ts.
 * @throws {BadRequestError} if the key falls outside `avatars/<ownerId>/`.
 */
function validateAvatarKeyOwnership(storageKey: string, ownerId: string): void {
  if (!storageKey.startsWith(`avatars/${ownerId}/`)) {
    throw new BadRequestError('Avatar image key must belong to the caller');
  }
}

/**
 * @throws {ConflictError} if the new username is already taken by another user, or is the
 * reserved tombstone username (see {@link isReservedUsername}).
 * @throws {BadRequestError} if profileImage fails ownership validation (see
 * {@link validateAvatarKeyOwnership}) or storage verification (`verifyUploadedImage`).
 */
export async function updateMe(userId: string, input: UpdateMeInput): Promise<MeUser> {
  if (input.username) {
    // Reserved for the account purge's tombstone user (see
    // accountPurge.service.ts) - rejected with the same message an ordinary
    // taken username gets, so this doesn't advertise that the name is special.
    if (isReservedUsername(input.username)) {
      throw new ConflictError('Username is already taken');
    }
    const existing = await userRepository.findByUsername(input.username);
    if (existing && existing.id !== userId) {
      throw new ConflictError('Username is already taken');
    }
  }

  // Every write now goes through the same checks the storage-key form
  // already ran: the key must belong to the caller's own avatar prefix, and
  // the uploaded object must pass storage verification. The frontend now
  // only ever sends a key from POST /users/me/avatar/upload-url, which is
  // what made it safe to stop also accepting a bare http(s) URL here -
  // that legacy form let a caller point their avatar at any host, leaking
  // every viewer's IP to it and letting the image change after moderation.
  // Existing rows written before this change still hold a plain URL; those
  // are left alone and still resolved on read by resolveProfileImage.
  if (input.profileImage !== undefined && input.profileImage !== null) {
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
