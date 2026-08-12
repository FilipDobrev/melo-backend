import type { Request, Response } from 'express';
import type { CreateProductInput, ListProductsQuery, ProductIdParams } from '../dto/product.dto';
import * as productService from '../services/product.service';

export async function listProducts(
  req: Request<unknown, unknown, unknown, ListProductsQuery>,
  res: Response,
): Promise<void> {
  const page = await productService.listProducts(req.query);
  res.json(page);
}

export async function getProduct(req: Request<ProductIdParams>, res: Response): Promise<void> {
  const product = await productService.getProductById(req.params.productId);
  res.json(product);
}

export async function createProduct(
  req: Request<unknown, unknown, CreateProductInput>,
  res: Response,
): Promise<void> {
  const product = await productService.createProduct(req.body);
  res.status(201).json(product);
}
