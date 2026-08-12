import type { Prisma, Product } from '@prisma/client';
import { type Db, prisma } from '../lib/prisma';

export interface ProductListParams {
  search?: string;
  cursor?: string;
  limit: number;
}

export async function findManyProducts(params: ProductListParams, db: Db = prisma): Promise<Product[]> {
  const where: Prisma.ProductWhereInput = params.search
    ? { name: { contains: params.search, mode: 'insensitive' } }
    : {};

  return db.product.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export async function findProductById(id: string, db: Db = prisma): Promise<Product | null> {
  return db.product.findUnique({ where: { id } });
}

export async function findProductByName(name: string, db: Db = prisma): Promise<Product | null> {
  return db.product.findUnique({ where: { name } });
}

export async function findProductsByIds(ids: string[], db: Db = prisma): Promise<Product[]> {
  if (ids.length === 0) return [];
  return db.product.findMany({ where: { id: { in: ids } } });
}

export async function createProduct(data: Prisma.ProductCreateInput, db: Db = prisma): Promise<Product> {
  return db.product.create({ data });
}
