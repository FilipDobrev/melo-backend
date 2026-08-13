import { describe, expect, it, vi } from 'vitest';

// storage.service.ts (imported transitively via recipeImage.ts, for
// publicUrlFor) reads S3 config from env.ts at module load time. Mocking it
// here keeps this test deterministic regardless of which other test files
// share its module registry, the same way auth.service.test.ts does.
vi.mock('../../config/env', () => ({
  env: { S3_BUCKET: 'melo-images', S3_REGION: 'us-east-1', PORT: 4000 },
}));

import { BadRequestError } from '../../lib/errors';
import { resolveRecipeImageUrl, validateRecipeImageKey } from '../recipeImage';

describe('resolveRecipeImageUrl', () => {
  it('resolves a preset key to the static preset route', () => {
    expect(resolveRecipeImageUrl('preset:salad')).toBe('http://localhost:4000/static/recipe-presets/salad.svg');
  });

  it('resolves an uploaded key through publicUrlFor', () => {
    expect(resolveRecipeImageUrl('recipes/owner-1/photo.jpg')).toContain('recipes/owner-1/photo.jpg');
  });

  it('resolves null to the default preset', () => {
    expect(resolveRecipeImageUrl(null)).toBe('http://localhost:4000/static/recipe-presets/default.svg');
  });

  it('falls back to the default preset for an unknown preset slug', () => {
    expect(resolveRecipeImageUrl('preset:not-a-real-slug')).toBe('http://localhost:4000/static/recipe-presets/default.svg');
  });
});

describe('validateRecipeImageKey', () => {
  it('accepts a known preset', () => {
    expect(() => validateRecipeImageKey('preset:breakfast', 'owner-1')).not.toThrow();
  });

  it('rejects an unknown preset slug', () => {
    expect(() => validateRecipeImageKey('preset:not-a-real-slug', 'owner-1')).toThrow(BadRequestError);
  });

  it('accepts an uploaded key under the caller\'s own prefix', () => {
    expect(() => validateRecipeImageKey('recipes/owner-1/photo.jpg', 'owner-1')).not.toThrow();
  });

  it("rejects another user's uploaded key", () => {
    expect(() => validateRecipeImageKey('recipes/owner-2/photo.jpg', 'owner-1')).toThrow(BadRequestError);
  });
});
