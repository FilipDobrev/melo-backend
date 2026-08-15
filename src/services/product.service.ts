import type { Product } from '@prisma/client';
import type { CreateProductInput, ListProductsQuery } from '../dto/product.dto';
import { ConflictError, NotFoundError } from '../lib/errors';
import { type Page, toPage } from '../lib/pagination';
import * as productRepository from '../repositories/product.repository';

export async function listProducts(query: ListProductsQuery): Promise<Page<Product>> {
  const rows = await productRepository.findManyProducts({
    search: query.search,
    cursor: query.cursor,
    limit: query.limit,
  });
  return toPage(rows, query.limit);
}

/** @throws {NotFoundError} if the product does not exist. */
export async function getProductById(productId: string): Promise<Product> {
  const product = await productRepository.findProductById(productId);
  if (!product) throw new NotFoundError('Product not found');
  return product;
}

/** @throws {ConflictError} if a product with this name already exists. */
export async function createProduct(input: CreateProductInput): Promise<Product> {
  const existing = await productRepository.findProductByName(input.name);
  if (existing) throw new ConflictError(`Product "${input.name}" already exists`);

  return productRepository.createProduct({
    name: input.name,
    caloriesPer100g: input.caloriesPer100g,
    proteinPer100g: input.proteinPer100g,
    carbsPer100g: input.carbsPer100g,
    fatPer100g: input.fatPer100g,
    densityGPerMl: input.densityGPerMl ?? null,
    gramsPerPiece: input.gramsPerPiece ?? null,
  });
}
