import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({ env: {} }));
vi.mock('../storage.service', () => ({
  isOwnedKey: vi.fn(),
  promoteUpload: vi.fn(),
  deleteObjectsInBackground: vi.fn(),
  publicUrlFor: (key: string) => `https://cdn.test/${key}`,
}));
vi.mock('../../lib/prisma', () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: object) => Promise<unknown>) => fn({})) },
}));
vi.mock('../../repositories/post.repository', () => ({
  findOwnerId: vi.fn(),
  recipeExists: vi.fn(),
  findImageKeys: vi.fn(),
  findImageWithPost: vi.fn(),
  deleteImage: vi.fn(),
  deletePost: vi.fn(),
  deletePostImages: vi.fn(),
  createPostImages: vi.fn(),
  updatePostFields: vi.fn(),
  findDetailById: vi.fn(),
}));
vi.mock('../../repositories/reaction.repository', () => ({
  EMPTY_REACTION_SUMMARY: { total: 0, byEmoji: {}, mine: null },
  summariesForPosts: vi.fn(async () => new Map()),
}));
vi.mock('../../repositories/cookbook.repository', () => ({
  findSavedRecipeIds: vi.fn(async () => new Set()),
}));

import { BadRequestError } from '../../lib/errors';
import * as postRepository from '../../repositories/post.repository';
import { deleteObjectsInBackground, promoteUpload } from '../storage.service';
import { deletePost, deletePostImage, updatePost } from '../post.service';

const OWNER = 'owner-1';
const POST_ID = 'post-1';

const detailRow = {
  id: POST_ID,
  caption: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ownerId: OWNER,
  owner: { id: OWNER, username: 'chef', profileImage: null },
  images: [],
  recipe: { id: 'recipe-1', title: 'Omelette', servings: 1, imageKey: null, ingredients: [] },
  _count: { comments: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postRepository.findOwnerId).mockResolvedValue({ ownerId: OWNER });
  vi.mocked(postRepository.findDetailById).mockResolvedValue(detailRow);
  vi.mocked(promoteUpload).mockImplementation(async (key) => key.replace('uploads/', 'posts/'));
});

describe('updatePost image handling', () => {
  it('keeps current keys, promotes new uploads, and deletes the dropped keys afterwards', async () => {
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([
      `posts/${OWNER}/keep.jpg`,
      `posts/${OWNER}/drop.jpg`,
    ]);

    await updatePost(POST_ID, OWNER, {
      imageKeys: [`uploads/${OWNER}/new.jpg`, `posts/${OWNER}/keep.jpg`],
    });

    expect(promoteUpload).toHaveBeenCalledTimes(1);
    expect(promoteUpload).toHaveBeenCalledWith(`uploads/${OWNER}/new.jpg`, OWNER, 'posts');
    expect(postRepository.createPostImages).toHaveBeenCalledWith(
      POST_ID,
      [
        { storageKey: `posts/${OWNER}/new.jpg`, position: 0 },
        { storageKey: `posts/${OWNER}/keep.jpg`, position: 1 },
      ],
      expect.anything(),
    );
    expect(deleteObjectsInBackground).toHaveBeenCalledWith(
      [`posts/${OWNER}/drop.jpg`],
      expect.objectContaining({ postId: POST_ID }),
    );
  });

  it('rejects a key that is neither current nor a valid upload, and changes nothing', async () => {
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([`posts/${OWNER}/keep.jpg`]);
    vi.mocked(promoteUpload).mockRejectedValue(new BadRequestError('Image key must belong to the caller'));

    await expect(updatePost(POST_ID, OWNER, { imageKeys: ['posts/someone-else/x.jpg'] })).rejects.toBeInstanceOf(
      BadRequestError,
    );

    expect(postRepository.deletePostImages).not.toHaveBeenCalled();
  });

  it('cleans up copies that were promoted when a sibling key fails', async () => {
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([]);
    vi.mocked(promoteUpload).mockImplementation(async (key) => {
      if (key.endsWith('bad.jpg')) throw new BadRequestError('Image was never uploaded to storage');
      return key.replace('uploads/', 'posts/');
    });

    await expect(
      updatePost(POST_ID, OWNER, { imageKeys: [`uploads/${OWNER}/ok.jpg`, `uploads/${OWNER}/bad.jpg`] }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(deleteObjectsInBackground).toHaveBeenCalledWith([`posts/${OWNER}/ok.jpg`], expect.anything());
  });

  it('does not touch storage when imageKeys is absent', async () => {
    await updatePost(POST_ID, OWNER, { caption: 'new caption' });

    expect(postRepository.findImageKeys).not.toHaveBeenCalled();
    expect(promoteUpload).not.toHaveBeenCalled();
    expect(deleteObjectsInBackground).not.toHaveBeenCalled();
  });
});

describe('post deletion cleanup', () => {
  it('deletes every image object after the post row is deleted', async () => {
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([`posts/${OWNER}/a.jpg`, `posts/${OWNER}/b.jpg`]);

    await deletePost(POST_ID, OWNER);

    expect(postRepository.deletePost).toHaveBeenCalledWith(POST_ID);
    expect(deleteObjectsInBackground).toHaveBeenCalledWith(
      [`posts/${OWNER}/a.jpg`, `posts/${OWNER}/b.jpg`],
      expect.anything(),
    );
  });

  it('deletes the removed image object when a single image is deleted', async () => {
    vi.mocked(postRepository.findImageWithPost).mockResolvedValue({
      id: 'img-1',
      postId: POST_ID,
      storageKey: `posts/${OWNER}/a.jpg`,
      post: { ownerId: OWNER, _count: { images: 2 } },
    });

    await deletePostImage(POST_ID, 'img-1', OWNER);

    expect(deleteObjectsInBackground).toHaveBeenCalledWith([`posts/${OWNER}/a.jpg`], expect.anything());
  });

  it('allows deleting the last remaining image', async () => {
    vi.mocked(postRepository.findImageWithPost).mockResolvedValue({
      id: 'img-1',
      postId: POST_ID,
      storageKey: `posts/${OWNER}/a.jpg`,
      post: { ownerId: OWNER, _count: { images: 1 } },
    });

    await deletePostImage(POST_ID, 'img-1', OWNER);

    expect(postRepository.deleteImage).toHaveBeenCalledWith('img-1');
  });

  it('never deletes the recipe image when a post without images is deleted', async () => {
    const recipeKey = `recipes/${OWNER}/recipe-photo.jpg`;
    vi.mocked(postRepository.findDetailById).mockResolvedValue({
      ...detailRow,
      recipe: { ...detailRow.recipe, imageKey: recipeKey },
    });
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([]);

    await deletePost(POST_ID, OWNER);

    const deletedKeys = vi.mocked(deleteObjectsInBackground).mock.calls.flatMap(([keys]) => keys);
    expect(deletedKeys).not.toContain(recipeKey);
    expect(deletedKeys).toEqual([]);
  });
});

describe('updatePost with zero images', () => {
  it('removes every current image, schedules their storage deletion, and promotes nothing', async () => {
    vi.mocked(postRepository.findImageKeys).mockResolvedValue([`posts/${OWNER}/a.jpg`]);

    await updatePost(POST_ID, OWNER, { imageKeys: [] });

    expect(promoteUpload).not.toHaveBeenCalled();
    expect(postRepository.deletePostImages).toHaveBeenCalledWith(POST_ID, expect.anything());
    expect(postRepository.createPostImages).toHaveBeenCalledWith(POST_ID, [], expect.anything());
    expect(deleteObjectsInBackground).toHaveBeenCalledWith(
      [`posts/${OWNER}/a.jpg`],
      expect.objectContaining({ postId: POST_ID }),
    );
  });
});
