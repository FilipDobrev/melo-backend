import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

/** Requests a presigned URL to upload a post image; `contentLength` is the exact byte size of the upload. */
export const createUploadUrlSchema = z.object({
  contentType: z.string().trim().min(1),
  contentLength: z.coerce.number().int().positive(),
});
export type CreateUploadUrlInput = z.infer<typeof createUploadUrlSchema>;

/** `imageKeys` must be storage keys already obtained from `createUploadUrlSchema`'s endpoint, 1 to 10 of them. */
export const createPostSchema = z.object({
  caption: z.string().trim().max(2000).optional(),
  // A post always documents cooking a recipe, so the link is required.
  recipeId: z.string().uuid(),
  imageKeys: z.array(z.string().trim().min(1)).min(1).max(10),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

/**
 * Any subset of the create fields. `caption` uses `.nullable().optional()`
 * so the service can tell "key absent, leave untouched" (undefined) apart
 * from "key present as null, clear it" (null) - see updatePostSchema's
 * consumer in post.service.ts. Concretely: omitting `caption` from the JSON
 * body leaves the existing caption alone, while sending `"caption": null`
 * clears it. `recipeId` stays required on the post itself; here it is only
 * optional because the caller may not want to change it. `imageKeys`, when
 * present, replaces the whole set wholesale rather than merging.
 */
export const updatePostSchema = z.object({
  caption: z.string().trim().max(2000).nullable().optional(),
  recipeId: z.string().uuid().optional(),
  imageKeys: z.array(z.string().trim().min(1)).min(1).max(10).optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const postIdParamsSchema = z.object({
  postId: z.string().uuid(),
});
export type PostIdParams = z.infer<typeof postIdParamsSchema>;

/** Identifies a single image within a post, e.g. for deleting it. */
export const postImageParamsSchema = z.object({
  postId: z.string().uuid(),
  imageId: z.string().uuid(),
});
export type PostImageParams = z.infer<typeof postImageParamsSchema>;

export const userPostsParamsSchema = z.object({
  userId: z.string().uuid(),
});
export type UserPostsParams = z.infer<typeof userPostsParamsSchema>;

export const listPostsQuerySchema = cursorPaginationSchema;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
