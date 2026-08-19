import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

/** Any subset of the caller's own profile fields; omitted fields are left unchanged. */
export const updateMeSchema = z.object({
  username: z.string().trim().min(3).max(30).optional(),
  // Must be a storage key obtained from POST /users/me/avatar/upload-url,
  // under the caller's own avatars/<userId>/ prefix. Ownership of the key,
  // and that it was actually uploaded, can only be checked once the
  // caller's id is known, so that happens in user.service.ts's updateMe
  // rather than here. Older rows may still hold a legacy absolute URL
  // written before this restriction (see resolveProfileImage), but new
  // writes can no longer produce that form.
  profileImage: z.string().trim().min(1).max(500).nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Requests a presigned URL to upload a new avatar; `contentLength` is the exact byte size of the upload. */
export const avatarUploadUrlSchema = z.object({
  contentType: z.string().trim().min(1),
  contentLength: z.coerce.number().int().positive(),
});
export type AvatarUploadUrlInput = z.infer<typeof avatarUploadUrlSchema>;

/** Body for DELETE /users/me: password re-verification before scheduling deletion. */
export const deleteMeSchema = z.object({
  password: z.string().min(1),
});
export type DeleteMeInput = z.infer<typeof deleteMeSchema>;

export const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

/** `search`, when omitted, lists all users; when present, filters by it. */
export const searchUsersQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
