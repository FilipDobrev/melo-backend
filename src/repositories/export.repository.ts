import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma';

/**
 * Per-section cap for GET /users/me/export. Every query below fetches
 * `EXPORT_ITEM_CAP + 1` rows so the service can detect (and flag, never
 * silently drop) an account with more rows than this in a single section.
 * This bounds the worst-case response size for a pathological account
 * without paginating - which would defeat the point of a single-request
 * export - and without streaming, which this app's scale does not need.
 * See export.service.ts for how the extra row is trimmed and reported.
 */
export const EXPORT_ITEM_CAP = 5000;

const exportRecipeInclude = {
  ingredients: {
    select: {
      quantity: true,
      unit: true,
      product: { select: { id: true, name: true } },
    },
  },
  categories: { select: { category: { select: { slug: true, name: true } } } },
} satisfies Prisma.RecipeInclude;

export type ExportRecipeRow = Prisma.RecipeGetPayload<{ include: typeof exportRecipeInclude }>;

/** Recipes owned by the caller, with ingredients and categories. */
export function findRecipes(userId: string, db: Db = prisma): Promise<ExportRecipeRow[]> {
  return db.recipe.findMany({
    where: { ownerId: userId },
    include: exportRecipeInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
}

const exportPostSelect = {
  id: true,
  recipeId: true,
  caption: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: { id: true, storageKey: true, position: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.PostSelect;

export type ExportPostRow = Prisma.PostGetPayload<{ select: typeof exportPostSelect }>;

/** Posts owned by the caller, with their images. */
export function findPosts(userId: string, db: Db = prisma): Promise<ExportPostRow[]> {
  return db.post.findMany({
    where: { ownerId: userId },
    select: exportPostSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
}

export interface ExportCommentRow {
  id: string;
  postId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Comments the caller authored, on any post (their own or someone else's). */
export function findComments(userId: string, db: Db = prisma): Promise<ExportCommentRow[]> {
  return db.comment.findMany({
    where: { authorId: userId },
    select: { id: true, postId: true, content: true, createdAt: true, updatedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
}

export interface ExportReactionRow {
  id: string;
  postId: string;
  emoji: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Reactions the caller left, on any post. */
export function findReactions(userId: string, db: Db = prisma): Promise<ExportReactionRow[]> {
  return db.reaction.findMany({
    where: { userId },
    select: { id: true, postId: true, emoji: true, createdAt: true, updatedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
}

/** Minimal identity for the other party in a follow relationship - id and
 * username only, never email or any other field of theirs. */
export interface ExportFollowUserRow {
  id: string;
  username: string;
}

/** Users the caller follows. */
export async function findFollowing(userId: string, db: Db = prisma): Promise<ExportFollowUserRow[]> {
  const rows = await db.follow.findMany({
    where: { followerId: userId },
    select: { following: { select: { id: true, username: true } } },
    orderBy: [{ createdAt: 'asc' }, { followingId: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
  return rows.map((row) => row.following);
}

/** Users who follow the caller. */
export async function findFollowers(userId: string, db: Db = prisma): Promise<ExportFollowUserRow[]> {
  const rows = await db.follow.findMany({
    where: { followingId: userId },
    select: { follower: { select: { id: true, username: true } } },
    orderBy: [{ createdAt: 'asc' }, { followerId: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
  return rows.map((row) => row.follower);
}

export interface ExportCookbookSaveRow {
  recipeId: string;
  recipeTitle: string;
  savedAt: Date;
}

/** Recipes the caller has saved to their cookbook. `recipeTitle` is public
 * data (the recipe's own title), included so the export is readable without
 * cross-referencing the recipes section for someone else's recipe. */
export async function findCookbookSaves(userId: string, db: Db = prisma): Promise<ExportCookbookSaveRow[]> {
  const rows = await db.cookbookSave.findMany({
    where: { userId },
    select: { recipeId: true, createdAt: true, recipe: { select: { title: true } } },
    orderBy: [{ createdAt: 'asc' }, { recipeId: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
  return rows.map((row) => ({ recipeId: row.recipeId, recipeTitle: row.recipe.title, savedAt: row.createdAt }));
}

const exportCollectionInclude = {
  recipes: {
    select: { recipeId: true, addedAt: true, recipe: { select: { title: true } } },
    orderBy: [{ addedAt: 'asc' }, { recipeId: 'asc' }],
    // Capped per-collection too, independently of the top-level collection cap,
    // so one collection with an enormous recipe list cannot blow past the cap
    // while a handful of small collections around it look untouched.
    take: EXPORT_ITEM_CAP + 1,
  },
} satisfies Prisma.CollectionInclude;

export type ExportCollectionRow = Prisma.CollectionGetPayload<{ include: typeof exportCollectionInclude }>;

/** The caller's collections, each with its recipe entries. */
export function findCollections(userId: string, db: Db = prisma): Promise<ExportCollectionRow[]> {
  return db.collection.findMany({
    where: { userId },
    include: exportCollectionInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPORT_ITEM_CAP + 1,
  });
}
