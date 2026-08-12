import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { cursorPaginationSchema } from '../lib/pagination';
import * as feedController from '../controllers/feed.controller';

export const feedRouter = Router();

feedRouter.get('/', requireAuth, validate({ query: cursorPaginationSchema }), asyncHandler(feedController.getFeed));
