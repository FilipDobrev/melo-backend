import { env } from '../config/env';
import { BadRequestError } from '../lib/errors';
import { publicUrlFor } from './storage.service';

/// A recipe's `imageKey` column holds one of exactly two forms:
///
///   - `preset:<slug>`  - one of the built-in images below. Resolved to a
///     URL under this API's own `/static/recipe-presets` route (see
///     app.ts), because presets are app assets, not user content in S3.
///   - a raw storage key for a user-uploaded image, always under
///     `recipes/<ownerId>/` (mirrors posts/<ownerId>/ in storage.service.ts).
///     Resolved via `publicUrlFor`, same as post images.
///
/// `null` means "no image chosen" and resolves to the default preset.
/// This is the only place that convention is encoded.

export interface RecipeImagePreset {
  slug: string;
  label: string;
  filename: string;
}

const DEFAULT_PRESET: RecipeImagePreset = { slug: 'default', label: 'Default', filename: 'default.svg' };

/// Filenames are explicit per preset (not derived from the slug) so the
/// placeholder SVGs can be swapped for real JPEGs later by editing one field.
export const RECIPE_IMAGE_PRESETS: RecipeImagePreset[] = [
  DEFAULT_PRESET,
  { slug: 'breakfast', label: 'Breakfast', filename: 'breakfast.svg' },
  { slug: 'meal', label: 'Meal', filename: 'meal.svg' },
  { slug: 'salad', label: 'Salad', filename: 'salad.svg' },
  { slug: 'dessert', label: 'Dessert', filename: 'dessert.svg' },
  { slug: 'pastry', label: 'Pastry', filename: 'pastry.svg' },
  { slug: 'spread', label: 'Spread', filename: 'spread.svg' },
];

const PRESET_PREFIX = 'preset:';

const presetsBySlug = new Map(RECIPE_IMAGE_PRESETS.map((preset) => [preset.slug, preset]));

function presetUrl(preset: RecipeImagePreset): string {
  const baseUrl = env.API_PUBLIC_BASE_URL || `http://localhost:${env.PORT}`;
  const relativePath = `/static/recipe-presets/${preset.filename}`;
  // Ensure exactly one slash between base and path
  return baseUrl.endsWith('/') ? baseUrl + relativePath.slice(1) : baseUrl + relativePath;
}

export interface RecipeImagePresetDto {
  slug: string;
  label: string;
  url: string;
}

export function listRecipeImagePresets(): RecipeImagePresetDto[] {
  return RECIPE_IMAGE_PRESETS.map((preset) => ({ slug: preset.slug, label: preset.label, url: presetUrl(preset) }));
}

/// Maps a stored `imageKey` to a fetchable URL. Null (never chosen) and any
/// unrecognized preset slug both fall back to the default preset, so a
/// resolver call can never fail - only validation (below) rejects input.
export function resolveRecipeImageUrl(imageKey: string | null): string {
  if (imageKey === null) {
    return presetUrl(DEFAULT_PRESET);
  }
  if (imageKey.startsWith(PRESET_PREFIX)) {
    const slug = imageKey.slice(PRESET_PREFIX.length);
    const preset = presetsBySlug.get(slug) ?? DEFAULT_PRESET;
    return presetUrl(preset);
  }
  return publicUrlFor(imageKey);
}

/// True for a built-in preset reference, which is an app asset (not an
/// uploaded object) and must never be checked against storage.
export function isRecipeImagePreset(imageKey: string): boolean {
  return imageKey.startsWith(PRESET_PREFIX);
}

/// Rejects any caller-supplied imageKey that is not a known preset or a key
/// under the caller's own recipe upload prefix, so a user can never point
/// their recipe at another user's uploaded object. Mirrors
/// validateImageKeyOwnership in post.service.ts.
export function validateRecipeImageKey(imageKey: string, ownerId: string): void {
  if (imageKey.startsWith(PRESET_PREFIX)) {
    const slug = imageKey.slice(PRESET_PREFIX.length);
    if (!presetsBySlug.has(slug)) {
      throw new BadRequestError(`Unknown image preset "${slug}"`);
    }
    return;
  }
  if (!imageKey.startsWith(`recipes/${ownerId}/`)) {
    throw new BadRequestError('Image key must be a known preset or belong to the caller');
  }
}
