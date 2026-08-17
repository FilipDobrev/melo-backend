import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';
import { DEFAULT_PAGE_SIZE } from '../lib/pagination';

/**
 * Shared select shape for anywhere a post "card" is rendered (detail, feed,
 * user posts list). Keeping it in one place means the feed query and the
 * single-post query stay in sync, and both fetch everything the client
 * needs in a single round trip (recipe nutrition included via the nested
 * ingredient/product select, no per-post follow-up query).
 */
export const POST_CARD_SELECT = {
  id: true,
  caption: true,
  createdAt: true,
  ownerId: true,
  owner: { select: { id: true, username: true, profileImage: true } },
  images: {
    select: { id: true, storageKey: true },
    orderBy: { position: 'asc' },
  },
  recipe: {
    select: {
      id: true,
      title: true,
      ingredients: {
        select: {
          quantity: true,
          unit: true,
          product: {
            select: {
              name: true,
              caloriesPer100g: true,
              proteinPer100g: true,
              carbsPer100g: true,
              fatPer100g: true,
              sugarPer100g: true,
              densityGPerMl: true,
              gramsPerPiece: true,
              gramsPerCup: true,
              gramsPerTablespoon: true,
              gramsPerTeaspoon: true,
            },
          },
        },
      },
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.PostSelect;

export type PostCardRow = Prisma.PostGetPayload<{ select: typeof POST_CARD_SELECT }>;

export interface CreatePostImageData {
  storageKey: string;
  position: number;
}

export interface CreatePostData {
  ownerId: string;
  caption?: string;
  recipeId: string;
  images: CreatePostImageData[];
}

/**
 * A nested create (post + images) executes as a single atomic write, so no
 * explicit transaction is needed here.
 */
export function createPost(data: CreatePostData, db: Db = prisma): Promise<PostCardRow> {
  return db.post.create({
    data: {
      ownerId: data.ownerId,
      caption: data.caption,
      recipeId: data.recipeId,
      images: { create: data.images },
    },
    select: POST_CARD_SELECT,
  });
}

/**
 * `findFirst` rather than `findUnique`: a pending-deletion owner's posts must
 * 404 for everyone, so `id` is combined with a non-unique owner filter.
 */
export function findDetailById(postId: string, db: Db = prisma): Promise<PostCardRow | null> {
  return db.post.findFirst({
    where: { id: postId, owner: { deletionRequestedAt: null } },
    select: POST_CARD_SELECT,
  });
}

/** Used to authorize post mutations: caller compares the returned `ownerId`
 * against the requester before allowing update/delete. */
export interface PostOwnerRow {
  ownerId: string;
}

export function findOwnerId(postId: string, db: Db = prisma): Promise<PostOwnerRow | null> {
  return db.post.findUnique({ where: { id: postId }, select: { ownerId: true } });
}

/** A missing post raises P2025, which the error middleware maps to 404. */
export function deletePost(postId: string, db: Db = prisma): Promise<{ id: string }> {
  return db.post.delete({ where: { id: postId }, select: { id: true } });
}

/**
 * True when a recipe with this id exists. Checked before attaching a
 * recipe to a post so we can return 404 instead of a raw FK violation.
 */
export async function recipeExists(recipeId: string, db: Db = prisma): Promise<boolean> {
  const recipe = await db.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  return recipe !== null;
}

export interface ListPostsParams {
  ownerId: string;
  cursor?: string;
  limit?: number;
}

/**
 * Fetches limit + 1 rows so the caller can derive the next cursor without
 * an extra count query. See src/lib/pagination.ts.
 */
export function listByOwner(
  { ownerId, cursor, limit = DEFAULT_PAGE_SIZE }: ListPostsParams,
  db: Db = prisma,
): Promise<PostCardRow[]> {
  return db.post.findMany({
    // A pending-deletion owner's posts are hidden from this listing too.
    where: { ownerId, owner: { deletionRequestedAt: null } },
    select: POST_CARD_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

/** Row shape returned by findImageWithPost. */
export interface PostImageWithPostRow {
  id: string;
  postId: string;
  post: { ownerId: string; _count: { images: number } };
}

/**
 * Single query that carries everything needed to authorize and validate an
 * image deletion: the owning post's owner and its remaining image count.
 */
export function findImageWithPost(
  imageId: string,
  db: Db = prisma,
): Promise<PostImageWithPostRow | null> {
  return db.postImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      postId: true,
      post: { select: { ownerId: true, _count: { select: { images: true } } } },
    },
  });
}

/** A missing image raises P2025, which the error middleware maps to 404. */
export function deleteImage(imageId: string, db: Db = prisma): Promise<{ id: string }> {
  return db.postImage.delete({ where: { id: imageId }, select: { id: true } });
}

export interface UpdatePostFields {
  caption?: string | null;
  recipeId?: string;
}

/**
 * Prisma ignores `undefined` fields in an update (treated as "not
 * provided"), which is what lets the caller pass both fields through
 * unconditionally and rely on only the ones actually present taking effect.
 */
export async function updatePostFields(postId: string, data: UpdatePostFields, db: Db = prisma): Promise<void> {
  await db.post.update({ where: { id: postId }, data });
}

export function deletePostImages(postId: string, db: Db = prisma): Promise<Prisma.BatchPayload> {
  return db.postImage.deleteMany({ where: { postId } });
}

export function createPostImages(
  postId: string,
  images: CreatePostImageData[],
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.postImage.createMany({
    data: images.map((image) => ({ postId, storageKey: image.storageKey, position: image.position })),
  });
}
