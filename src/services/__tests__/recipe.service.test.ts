import { Unit } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { RecipeDetailRow, RecipeSummaryRow } from '../../repositories/recipe.repository';
import { findMissingCategorySlug, findMissingProductId, toRecipeDetail, toRecipeSummary } from '../recipe.service';

const now = new Date('2026-01-01T00:00:00Z');

function buildProduct(overrides: Partial<RecipeDetailRow['ingredients'][number]['product']> = {}) {
  return {
    id: 'product-1',
    name: 'Chicken breast, raw',
    source: 'seed',
    externalId: 'chicken-breast-raw',
    caloriesPer100g: 165,
    proteinPer100g: 31,
    carbsPer100g: 0,
    fatPer100g: 3.6,
    densityGPerMl: null,
    gramsPerPiece: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildRecipeDetail(overrides: Partial<RecipeDetailRow> = {}): RecipeDetailRow {
  return {
    id: 'recipe-1',
    ownerId: 'owner-1',
    title: 'Grilled chicken and rice',
    description: 'A simple high-protein meal.',
    instructions: 'Grill the chicken. Cook the rice. Combine.',
    createdAt: now,
    updatedAt: now,
    owner: { id: 'owner-1', username: 'chef', profileImage: null },
    ingredients: [
      {
        id: 'ingredient-1',
        recipeId: 'recipe-1',
        productId: 'product-1',
        quantity: 200,
        unit: Unit.GRAM,
        product: buildProduct(),
      },
      {
        id: 'ingredient-2',
        recipeId: 'recipe-1',
        productId: 'product-2',
        quantity: 150,
        unit: Unit.GRAM,
        product: buildProduct({
          id: 'product-2',
          name: 'White rice, cooked',
          caloriesPer100g: 130,
          proteinPer100g: 2.7,
          carbsPer100g: 28.2,
          fatPer100g: 0.3,
        }),
      },
    ],
    categories: [{ recipeId: 'recipe-1', categoryId: 'category-1', category: { id: 'category-1', slug: 'dinner', name: 'Dinner' } }],
    savedBy: [],
    ...overrides,
  };
}

describe('findMissingProductId', () => {
  it('returns undefined when every requested id was found', () => {
    expect(findMissingProductId(['a', 'b'], [{ id: 'a' }, { id: 'b' }])).toBeUndefined();
  });

  it('returns the first requested id that was not found', () => {
    expect(findMissingProductId(['a', 'b', 'c'], [{ id: 'a' }])).toBe('b');
  });
});

describe('findMissingCategorySlug', () => {
  it('returns undefined when every requested slug was found', () => {
    expect(findMissingCategorySlug(['dinner'], [{ slug: 'dinner' }])).toBeUndefined();
  });

  it('returns the first requested slug that was not found', () => {
    expect(findMissingCategorySlug(['dinner', 'made-up'], [{ slug: 'dinner' }])).toBe('made-up');
  });
});

describe('toRecipeDetail', () => {
  it('computes nutrition totals from the joined ingredients', () => {
    const detail = toRecipeDetail(buildRecipeDetail());

    // chicken 200g -> 330/62/0/7.2, rice 150g -> 195/4.05/42.3/0.45
    expect(detail.nutrition.calories).toBeCloseTo(525, 1);
    expect(detail.nutrition.protein).toBeCloseTo(66.05, 1);
    expect(detail.nutrition.carbs).toBeCloseTo(42.3, 1);
    expect(detail.nutrition.fat).toBeCloseTo(7.65, 1);
  });

  it('reports isSaved false when savedBy is empty', () => {
    const detail = toRecipeDetail(buildRecipeDetail({ savedBy: [] }));
    expect(detail.isSaved).toBe(false);
  });

  it('reports isSaved true when the viewer has a save row', () => {
    const detail = toRecipeDetail(buildRecipeDetail({ savedBy: [{ id: 'save-1' }] }));
    expect(detail.isSaved).toBe(true);
  });

  it('maps categories and owner through to the response', () => {
    const detail = toRecipeDetail(buildRecipeDetail());
    expect(detail.categories).toEqual([{ slug: 'dinner', name: 'Dinner' }]);
    expect(detail.owner).toEqual({ id: 'owner-1', username: 'chef', profileImage: null });
  });
});

describe('toRecipeSummary', () => {
  it('maps a list row without ingredients or nutrition', () => {
    const row: RecipeSummaryRow = {
      id: 'recipe-1',
      ownerId: 'owner-1',
      title: 'Grilled chicken and rice',
      description: 'A simple high-protein meal.',
      instructions: 'Grill the chicken. Cook the rice. Combine.',
      createdAt: now,
      updatedAt: now,
      owner: { id: 'owner-1', username: 'chef', profileImage: null },
      categories: [{ recipeId: 'recipe-1', categoryId: 'category-1', category: { id: 'category-1', slug: 'dinner', name: 'Dinner' } }],
    };

    const summary = toRecipeSummary(row);
    expect(summary).toEqual({
      id: 'recipe-1',
      title: 'Grilled chicken and rice',
      description: 'A simple high-protein meal.',
      createdAt: now,
      updatedAt: now,
      owner: { id: 'owner-1', username: 'chef', profileImage: null },
      categories: [{ slug: 'dinner', name: 'Dinner' }],
    });
  });
});
