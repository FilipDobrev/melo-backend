import { z } from 'zod';
import { cursorPaginationSchema } from '../lib/pagination';

export const followParamsSchema = z.object({
  userId: z.string().uuid(),
});
export type FollowParams = z.infer<typeof followParamsSchema>;

export const listFollowQuerySchema = cursorPaginationSchema;
export type ListFollowQuery = z.infer<typeof listFollowQuerySchema>;
