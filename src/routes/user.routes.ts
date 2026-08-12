import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as userController from '../controllers/user.controller';
import { searchUsersQuerySchema, updateMeSchema, userIdParamsSchema } from '../dto/user.dto';

/// Other agents mount follow/followers/following/posts/recipes routes onto
/// this same router; only the routes this slice owns are defined here.
export const userRouter = Router();

userRouter.get('/me', requireAuth, asyncHandler(userController.getMe));
userRouter.patch(
  '/me',
  requireAuth,
  validate({ body: updateMeSchema }),
  asyncHandler(userController.updateMe),
);

userRouter.get(
  '/',
  optionalAuth,
  validate({ query: searchUsersQuerySchema }),
  asyncHandler(userController.searchUsers),
);

userRouter.get(
  '/:userId',
  optionalAuth,
  validate({ params: userIdParamsSchema }),
  asyncHandler(userController.getPublicProfile),
);
