import { publicUrlFor } from '../services/storage.service';

/**
 * A user's `profileImage` column holds one of two forms:
 *
 *   - a raw storage key for an uploaded avatar, always under
 *     `avatars/<ownerId>/` (mirrors posts/<ownerId>/ in storage.service.ts).
 *     Resolved via `publicUrlFor`.
 *   - TRANSITIONAL: a plain http(s) URL, written directly by the current
 *     frontend before avatar uploads existed. Returned unchanged. Delete
 *     this branch, and this comment, once the frontend is rebuilt to only
 *     ever send keys obtained from POST /users/me/avatar/upload-url.
 */
const LEGACY_URL_PATTERN = /^https?:\/\//i;

/**
 * Resolves a stored `profileImage` value to a URL the client can load.
 * `null` means "no avatar chosen" and resolves to `null`.
 *
 * Used everywhere a user (or an author/owner summary embedding one) is
 * serialised, so the branch lives here once instead of being repeated at
 * every call site.
 */
export function resolveProfileImage(profileImage: string | null): string | null {
  if (profileImage === null) return null;
  if (LEGACY_URL_PATTERN.test(profileImage)) return profileImage;
  return publicUrlFor(profileImage);
}
