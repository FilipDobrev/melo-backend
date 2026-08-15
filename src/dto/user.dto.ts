import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

/** Any subset of the caller's own profile fields; omitted fields are left unchanged. */
export const updateMeSchema = z.object({
  username: z.string().trim().min(3).max(30).optional(),
  // Accepts either a storage key (new uploads, see
  // POST /users/me/avatar/upload-url) or, TRANSITIONALLY, a plain http(s)
  // URL - the current frontend still writes the latter directly. Delete the
  // URL form, and this comment, once the frontend is rebuilt to only ever
  // send keys. Which form was sent, and ownership of a key, can only be
  // checked once the caller's id is known, so that happens in
  // user.service.ts's updateMe rather than here.
  profileImage: z.string().trim().min(1).max(500).nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Requests a presigned URL to upload a new avatar; `contentLength` is the exact byte size of the upload. */
export const avatarUploadUrlSchema = z.object({
  contentType: z.string().trim().min(1),
  contentLength: z.coerce.number().int().positive(),
});
export type AvatarUploadUrlInput = z.infer<typeof avatarUploadUrlSchema>;

export const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

/** `search`, when omitted, lists all users; when present, filters by it. */
export const searchUsersQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
