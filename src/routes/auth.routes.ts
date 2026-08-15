import { Router } from 'express';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import { authRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import * as authController from '../controllers/auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from '../dto/auth.dto';

/** Auth routes: register, login, refresh, logout. Mounted at /auth. */
export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

authRouter.post('/refresh', validate({ body: refreshSchema }), asyncHandler(authController.refresh));

authRouter.post('/logout', validate({ body: logoutSchema }), ...authed(authController.logout));
