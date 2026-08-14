import { Router } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import { optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { uploadUrlRateLimiter } from '../middleware/rateLimit';
import * as userController from '../controllers/user.controller';
import {
  avatarUploadUrlSchema,
  searchUsersQuerySchema,
  updateMeSchema,
  userIdParamsSchema,
  type AvatarUploadUrlInput,
} from '../dto/user.dto';
import { collectionRouter } from './collection.routes';
import { cookbookListRouter } from './cookbook.routes';
import { followRouter } from './follow.routes';
import { userPostRouter } from './post.routes';
import { userRecipeRouter } from './recipe.routes';

export const userRouter = Router();

/// Sub-routers owned by the follow, cookbook, post and recipe slices.
/// Mounted before /:userId so their literal paths win the match.
userRouter.use(collectionRouter);
userRouter.use(cookbookListRouter);
userRouter.use(followRouter);
userRouter.use(userPostRouter);
userRouter.use(userRecipeRouter);

userRouter.get('/me', ...authed(userController.getMe));
userRouter.patch('/me', validate({ body: updateMeSchema }), ...authed(userController.updateMe));

/// Literal path, so it must be registered before `/:userId`, or express
/// would swallow it as a userId lookup instead. Mirrors the images/upload-url
/// routes on postRouter/recipeRouter.
userRouter.post<ParamsDictionary, unknown, AvatarUploadUrlInput>(
  '/me/avatar/upload-url',
  uploadUrlRateLimiter,
  validate({ body: avatarUploadUrlSchema }),
  ...authed(userController.createAvatarUploadUrl),
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
