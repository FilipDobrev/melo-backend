import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import * as authController from '../controllers/auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from '../dto/auth.dto';

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

authRouter.post(
  '/logout',
  requireAuth,
  validate({ body: logoutSchema }),
  asyncHandler(authController.logout),
);
