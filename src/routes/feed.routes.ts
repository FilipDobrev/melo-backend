import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authed } from '../middleware/asyncHandler';
import { cursorPaginationSchema } from '../lib/pagination';
import * as feedController from '../controllers/feed.controller';

export const feedRouter = Router();

feedRouter.get('/', validate({ query: cursorPaginationSchema }), ...authed(feedController.getFeed));
