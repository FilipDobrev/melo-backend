import type { Unit } from '@prisma/client';
import { NotFoundError } from '../lib/errors';
import * as exportRepository from '../repositories/export.repository';
import * as userRepository from '../repositories/user.repository';
import { publicUrlFor } from './storage.service';
import { resolveRecipeImageUrl } from './recipeImage';

/**
 * Bumped whenever the shape of the export changes, so a consumer that saved
 * an old export (or built tooling against it) can detect drift instead of
 * silently misreading a field that moved or was removed.
 */
const EXPORT_FORMAT = 'melo.user-data-export.v1';

const ITEM_CAP = exportRepository.EXPORT_ITEM_CAP;

/** One capped section of the export: at most {@link EXPORT_ITEM_CAP} items,
 * with `truncated` set (never a silent drop) when the account actually had
 * more than that in this section. */
export interface ExportSection<T> {
  items: T[];
  truncated: boolean;
}

/**
 * Every repository query in this file fetches `EXPORT_ITEM_CAP + 1` rows, so
 * a result longer than the cap means there were more rows than that -
 * trimmed here to exactly the cap and flagged, rather than dropped silently.
 */
function toSection<T>(rows: T[]): ExportSection<T> {
  if (rows.length <= ITEM_CAP) return { items: rows, truncated: false };
  return { items: rows.slice(0, ITEM_CAP), truncated: true };
}

export interface ExportAccount {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  /** Null for an active account; set when deletion was requested. Included
   * because a pending-deletion account is exactly the account most likely
   * to want its export right now. */
  deletionRequestedAt: Date | null;
}

export interface ExportRecipeIngredient {
  productId: string;
  productName: string;
  quantity: number;
  unit: Unit;
}

export interface ExportRecipeCategory {
  slug: string;
  name: string;
}

export interface ExportRecipe {
  id: string;
  title: string;
  description: string;
  instructions: string;
  /** Resolved, fetchable URL - never a raw storage key, so the export is
   * directly usable to retrieve the photo. */
  imageUrl: string;
  createdAt: Date;
  updatedAt: Date;
  ingredients: ExportRecipeIngredient[];
  categories: ExportRecipeCategory[];
}

function toExportRecipe(row: exportRepository.ExportRecipeRow): ExportRecipe {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    imageUrl: resolveRecipeImageUrl(row.imageKey),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ingredients: row.ingredients.map((ingredient) => ({
      productId: ingredient.product.id,
      productName: ingredient.product.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
    categories: row.categories.map((entry) => entry.category),
  };
}

export interface ExportPostImage {
  id: string;
  /** Resolved, fetchable URL - never a raw storage key. */
  url: string;
  position: number;
}

export interface ExportPost {
  id: string;
  recipeId: string;
  caption: string | null;
  createdAt: Date;
  updatedAt: Date;
  images: ExportPostImage[];
}

function toExportPost(row: exportRepository.ExportPostRow): ExportPost {
  return {
    id: row.id,
    recipeId: row.recipeId,
    caption: row.caption,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    images: row.images.map((image) => ({
      id: image.id,
      url: publicUrlFor(image.storageKey),
      position: image.position,
    })),
  };
}

export interface ExportCollectionRecipe {
  recipeId: string;
  recipeTitle: string;
  addedAt: Date;
}

export interface ExportCollection {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  recipes: ExportSection<ExportCollectionRecipe>;
}

function toExportCollection(row: exportRepository.ExportCollectionRow): ExportCollection {
  const recipesSection = toSection(row.recipes);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    recipes: {
      items: recipesSection.items.map((entry) => ({
        recipeId: entry.recipeId,
        recipeTitle: entry.recipe.title,
        addedAt: entry.addedAt,
      })),
      truncated: recipesSection.truncated,
    },
  };
}

export interface UserDataExport {
  format: string;
  /** When this export was generated. Not the same as any row's own timestamp. */
  exportedAt: string;
  account: ExportAccount;
  recipes: ExportSection<ExportRecipe>;
  posts: ExportSection<ExportPost>;
  comments: ExportSection<exportRepository.ExportCommentRow>;
  reactions: ExportSection<exportRepository.ExportReactionRow>;
  follows: {
    /** Users the caller follows: id and username only, never another
     * user's email or any other private field. */
    following: ExportSection<exportRepository.ExportFollowUserRow>;
    /** Users who follow the caller: same minimal shape. */
    followers: ExportSection<exportRepository.ExportFollowUserRow>;
  };
  cookbookSaves: ExportSection<exportRepository.ExportCookbookSaveRow>;
  collections: ExportSection<ExportCollection>;
}

/**
 * Assembles everything the service holds about `userId` for GDPR Article 20
 * data portability, in one synchronous response.
 *
 * Issues 8 queries, run in parallel, one per section (recipes, posts,
 * comments, reactions, following, followers, cookbook saves, collections),
 * plus the initial account lookup - 9 total, regardless of how much data the
 * account has. None of them loop per-row: every section is a single
 * `findMany` (nested relations - ingredients/products, categories, post
 * images, collection recipes - ride along via Prisma's batched `include`,
 * not a query per row), so this scales with the number of *sections*, not
 * the number of *rows*.
 *
 * Deliberately excludes passwordHash and refresh token material - those are
 * credentials, not data about the person - and, for follows, every field of
 * the other party except id and username.
 *
 * @throws {NotFoundError} if the user does not exist.
 */
export async function getUserDataExport(userId: string): Promise<UserDataExport> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const [recipes, posts, comments, reactions, following, followers, cookbookSaves, collections] =
    await Promise.all([
      exportRepository.findRecipes(userId),
      exportRepository.findPosts(userId),
      exportRepository.findComments(userId),
      exportRepository.findReactions(userId),
      exportRepository.findFollowing(userId),
      exportRepository.findFollowers(userId),
      exportRepository.findCookbookSaves(userId),
      exportRepository.findCollections(userId),
    ]);

  const recipesSection = toSection(recipes);
  const postsSection = toSection(posts);
  const collectionsSection = toSection(collections);

  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletionRequestedAt: user.deletionRequestedAt,
    },
    recipes: { items: recipesSection.items.map(toExportRecipe), truncated: recipesSection.truncated },
    posts: { items: postsSection.items.map(toExportPost), truncated: postsSection.truncated },
    comments: toSection(comments),
    reactions: toSection(reactions),
    follows: {
      following: toSection(following),
      followers: toSection(followers),
    },
    cookbookSaves: toSection(cookbookSaves),
    collections: {
      items: collectionsSection.items.map(toExportCollection),
      truncated: collectionsSection.truncated,
    },
  };
}
