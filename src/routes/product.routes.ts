import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { createProductSchema, listProductsQuerySchema, productIdParamsSchema } from '../dto/product.dto';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const productRouter = Router();

productRouter.get(
  '/',
  validate({ query: listProductsQuerySchema }),
  asyncHandler(productController.listProducts),
);

productRouter.get(
  '/:productId',
  validate({ params: productIdParamsSchema }),
  asyncHandler(productController.getProduct),
);

productRouter.post(
  '/',
  requireAuth,
  validate({ body: createProductSchema }),
  asyncHandler(productController.createProduct),
);
