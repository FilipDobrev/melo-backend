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
