import type { Category } from '@prisma/client';
import * as categoryService from '../services/category.service';
import type { TypedResponse, UnauthorizedRequest } from '../types/http';

export async function listCategories(
  _req: UnauthorizedRequest,
  res: TypedResponse<Category[]>,
): Promise<void> {
  const categories = await categoryService.listCategories();
  res.json(categories);
}
