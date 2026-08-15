import { z } from 'zod';

/**
 * New account fields. `password` is capped at 72 characters because bcrypt
 * silently ignores anything past 72 bytes - a longer password would compare
 * equal to its 72-byte prefix, so the cap makes that boundary explicit
 * instead of a surprise at login.
 */
export const registerSchema = z.object({
  username: z.string().trim().min(3).max(30),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Login credentials. `password` has no minimum here - the server never confirms which of email/password was wrong. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Body for exchanging a refresh token for a new access token. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/** Body for revoking a refresh token. */
export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutInput = z.infer<typeof logoutSchema>;
