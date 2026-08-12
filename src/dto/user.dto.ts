import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const updateMeSchema = z.object({
  username: z.string().trim().min(3).max(30).optional(),
  profileImage: z.string().trim().url().nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export const searchUsersQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
