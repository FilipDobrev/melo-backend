import type { Request, Response } from 'express';
import * as categoryService from '../services/category.service';

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await categoryService.listCategories();
  res.json(categories);
}
