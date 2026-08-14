import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const createUploadUrlSchema = z.object({
  contentType: z.string().trim().min(1),
  contentLength: z.coerce.number().int().positive(),
});
export type CreateUploadUrlInput = z.infer<typeof createUploadUrlSchema>;

export const createPostSchema = z.object({
  caption: z.string().trim().max(2000).optional(),
  // A post always documents cooking a recipe, so the link is required.
  recipeId: z.string().uuid(),
  imageKeys: z.array(z.string().trim().min(1)).min(1).max(10),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

/// Any subset of the create fields. `caption` uses `.nullable().optional()`
/// so the service can tell "key absent, leave untouched" (undefined) apart
/// from "key present as null, clear it" (null) - see updatePostSchema's
/// consumer in post.service.ts. `recipeId` stays required on the post
/// itself; here it is only optional because the caller may not want to
/// change it. `imageKeys`, when present, replaces the whole set wholesale.
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
