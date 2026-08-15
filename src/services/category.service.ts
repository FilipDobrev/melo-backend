import type { Category } from '@prisma/client';
import * as categoryRepository from '../repositories/category.repository';

/** Returns every category, unpaginated - the category list is small and rarely changes. */
export async function listCategories(): Promise<Category[]> {
  return categoryRepository.findAllCategories();
}
