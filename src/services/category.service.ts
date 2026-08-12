import type { Category } from '@prisma/client';
import * as categoryRepository from '../repositories/category.repository';

export async function listCategories(): Promise<Category[]> {
  return categoryRepository.findAllCategories();
}
