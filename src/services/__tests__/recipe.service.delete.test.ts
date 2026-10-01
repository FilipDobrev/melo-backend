import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({ env: { PORT: 4000 } }));
vi.mock('../storage.service', () => ({
  isOwnedKey: vi.fn(),
  deleteObjectsInBackground: vi.fn(),
  publicUrlFor: (key: string) => `https://cdn.test/${key}`,
}));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../repositories/recipe.repository', () => ({
  findRecipeOwner: vi.fn(),
  deleteRecipe: vi.fn(),
}));
vi.mock('../../repositories/post.repository', () => ({
  findImageKeysByRecipe: vi.fn(),
}));

import * as postRepository from '../../repositories/post.repository';
import * as recipeRepository from '../../repositories/recipe.repository';
import { deleteRecipe } from '../recipe.service';
import { deleteObjectsInBackground, isOwnedKey } from '../storage.service';

const OWNER = 'owner-1';
const RECIPE_ID = 'recipe-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recipeRepository.findRecipeOwner).mockResolvedValue({ id: RECIPE_ID, ownerId: OWNER, imageKey: null });
  vi.mocked(isOwnedKey).mockReturnValue(false);
  vi.mocked(postRepository.findImageKeysByRecipe).mockResolvedValue([]);
});

describe('deleteRecipe storage cleanup', () => {
  it('schedules deletion of the cascaded posts image keys and the recipe own image', async () => {
    const recipeKey = `recipes/${OWNER}/photo.jpg`;
    vi.mocked(recipeRepository.findRecipeOwner).mockResolvedValue({ id: RECIPE_ID, ownerId: OWNER, imageKey: recipeKey });
    vi.mocked(isOwnedKey).mockReturnValue(true);
    vi.mocked(postRepository.findImageKeysByRecipe).mockResolvedValue(['posts/a/1.jpg', 'posts/b/2.jpg']);

    await deleteRecipe(RECIPE_ID, OWNER);

    expect(deleteObjectsInBackground).toHaveBeenCalledWith(
      ['posts/a/1.jpg', 'posts/b/2.jpg', recipeKey],
      expect.objectContaining({ recipeId: RECIPE_ID }),
    );
  });

  it('reads the post image keys before the recipe row is deleted', async () => {
    await deleteRecipe(RECIPE_ID, OWNER);

    const [readOrder] = vi.mocked(postRepository.findImageKeysByRecipe).mock.invocationCallOrder;
    const [deleteOrder] = vi.mocked(recipeRepository.deleteRecipe).mock.invocationCallOrder;
    expect(readOrder).toBeDefined();
    expect(deleteOrder).toBeDefined();
    expect(readOrder as number).toBeLessThan(deleteOrder as number);
  });

  it('does not delete a preset recipe image or call storage when there is nothing to delete', async () => {
    vi.mocked(recipeRepository.findRecipeOwner).mockResolvedValue({ id: RECIPE_ID, ownerId: OWNER, imageKey: 'preset:meal' });

    await deleteRecipe(RECIPE_ID, OWNER);

    expect(deleteObjectsInBackground).not.toHaveBeenCalled();
  });
});
