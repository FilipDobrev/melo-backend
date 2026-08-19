import { publicUrlFor } from '../services/storage.service';

/**
 * A user's `profileImage` column holds one of two forms:
 *
 *   - a raw storage key for an uploaded avatar, always under
 *     `avatars/<ownerId>/` (mirrors posts/<ownerId>/ in storage.service.ts).
 *     Resolved via `publicUrlFor`.
 *   - LEGACY: a plain http(s) URL. The write path (user.service.ts's
 *     updateMe) no longer produces this form - it now only accepts a
 *     storage key, verified as belonging to the caller - but rows written
 *     before that change still hold a URL, so this branch stays here on the
 *     read path indefinitely. Returned unchanged. Removing it would break
 *     the avatar of every account that still has one of these rows.
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
