import { Unit } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { BadRequestError } from '../../lib/errors';
import { recipeNutrition, toGrams, type NutritionPer100g } from '../nutrition';

function product(overrides: Partial<NutritionPer100g> & { name?: string } = {}) {
  return {
    name: 'Test product',
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbsPer100g: 10,
    fatPer100g: 10,
    densityGPerMl: null,
    gramsPerPiece: null,
    ...overrides,
  };
}

describe('toGrams', () => {
  it('passes grams through unchanged', () => {
    expect(toGrams(250, Unit.GRAM, product())).toBe(250);
  });

  it('converts kilograms to grams', () => {
    expect(toGrams(2, Unit.KILOGRAM, product())).toBe(2000);
  });

  it('converts volume using the product density when set', () => {
    const oliveOil = product({ name: 'Olive oil', densityGPerMl: 0.91 });
    // 1 tbsp = 15 mL
    expect(toGrams(2, Unit.TABLESPOON, oliveOil)).toBeCloseTo(2 * 15 * 0.91, 5);
  });

  it('falls back to water density when the product has no density', () => {
    const water = product({ name: 'Water', densityGPerMl: null });
    expect(toGrams(250, Unit.MILLILITRE, water)).toBe(250);
    expect(toGrams(1, Unit.LITRE, water)).toBe(1000);
  });

  it('converts pieces using gramsPerPiece', () => {
    const egg = product({ name: 'Egg', gramsPerPiece: 50 });
    expect(toGrams(3, Unit.PIECE, egg)).toBe(150);
  });

  it('throws a BadRequestError for PIECE when gramsPerPiece is not set', () => {
    const rice = product({ name: 'Rice', gramsPerPiece: null });
    expect(() => toGrams(1, Unit.PIECE, rice)).toThrow(BadRequestError);
  });
});

describe('recipeNutrition', () => {
  it('returns zeros for an empty ingredient list', () => {
    expect(recipeNutrition([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('sums a realistic multi-ingredient recipe', () => {
    const chicken = product({
      name: 'Chicken breast, raw',
      caloriesPer100g: 165,
      proteinPer100g: 31,
      carbsPer100g: 0,
      fatPer100g: 3.6,
    });
    const egg = product({
      name: 'Egg',
      caloriesPer100g: 143,
      proteinPer100g: 12.6,
      carbsPer100g: 0.7,
      fatPer100g: 9.5,
      gramsPerPiece: 50,
    });
    const rice = product({
      name: 'White rice, cooked',
      caloriesPer100g: 130,
      proteinPer100g: 2.7,
      carbsPer100g: 28.2,
      fatPer100g: 0.3,
    });

    const nutrition = recipeNutrition([
      { quantity: 200, unit: Unit.GRAM, product: chicken },
      { quantity: 2, unit: Unit.PIECE, product: egg },
      { quantity: 150, unit: Unit.GRAM, product: rice },
    ]);

    // chicken 200g -> 330/62/0/7.2, egg 100g -> 143/12.6/0.7/9.5, rice 150g -> 195/4.05/42.3/0.45
    expect(nutrition.calories).toBeCloseTo(668, 1);
    expect(nutrition.protein).toBeCloseTo(78.6, 1);
    expect(nutrition.carbs).toBeCloseTo(43, 1);
    expect(nutrition.fat).toBeCloseTo(17.2, 1);
  });
});
