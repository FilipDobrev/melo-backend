import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { createProductSchema, listProductsQuerySchema, productIdParamsSchema } from '../dto/product.dto';
import { asyncHandler, authed } from '../middleware/asyncHandler';
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
  validate({ body: createProductSchema }),
  ...authed(productController.createProduct),
);
