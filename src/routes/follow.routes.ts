// Mount on userRouter: apiRouter.use('/users', userRouter) already prefixes
// with /users, and this router defines paths relative to that root, e.g.
// userRouter.use(followRouter) so /:userId/follow etc. resolve correctly.
import { Router } from 'express';
import { asyncHandler, authed } from '../middleware/asyncHandler';
import { optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as followController from '../controllers/follow.controller';
import { followParamsSchema, listFollowQuerySchema } from '../dto/follow.dto';

export const followRouter = Router({ mergeParams: true });

followRouter.post(
  '/:userId/follow',
  validate({ params: followParamsSchema }),
  ...authed(followController.follow),
);

followRouter.delete(
  '/:userId/follow',
  validate({ params: followParamsSchema }),
  ...authed(followController.unfollow),
);

followRouter.get(
  '/:userId/followers',
  optionalAuth,
  validate({ params: followParamsSchema, query: listFollowQuerySchema }),
  asyncHandler(followController.listFollowers),
);

followRouter.get(
  '/:userId/following',
  optionalAuth,
  validate({ params: followParamsSchema, query: listFollowQuerySchema }),
  asyncHandler(followController.listFollowing),
);
