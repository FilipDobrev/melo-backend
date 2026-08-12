import type { Product } from '@prisma/client';
import type { CreateProductInput, ListProductsQuery } from '../dto/product.dto';
import type { Page } from '../lib/pagination';
import * as productService from '../services/product.service';
import type { AuthorizedRequest, ProductIdParams, TypedResponse, UnauthorizedRequest } from '../types/http';

export async function listProducts(
  req: UnauthorizedRequest<void, ListProductsQuery>,
  res: TypedResponse<Page<Product>>,
): Promise<void> {
  const page = await productService.listProducts(req.query);
  res.json(page);
}

export async function getProduct(
  req: UnauthorizedRequest<void, unknown, ProductIdParams>,
  res: TypedResponse<Product>,
): Promise<void> {
  const product = await productService.getProductById(req.params.productId);
  res.json(product);
}

export async function createProduct(
  req: AuthorizedRequest<CreateProductInput>,
  res: TypedResponse<Product>,
): Promise<void> {
  const product = await productService.createProduct(req.body);
  res.status(201).json(product);
}
