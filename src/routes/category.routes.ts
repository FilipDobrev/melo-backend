import { Router } from 'express';
import * as categoryController from '../controllers/category.controller';
import { asyncHandler } from '../middleware/asyncHandler';

/** Category routes: read-only listing. Mounted at /categories. */
export const categoryRouter = Router();

// No POST: categories are a seeded, fixed list. Users assign but never create them.
categoryRouter.get('/', asyncHandler(categoryController.listCategories));
