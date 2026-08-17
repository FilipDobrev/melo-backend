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
    sugarPer100g: 5,
    densityGPerMl: null,
    gramsPerPiece: null,
    gramsPerCup: null,
    gramsPerTablespoon: null,
    gramsPerTeaspoon: null,
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

  it('converts millilitres and litres unchanged for a liquid with a real density (no regression)', () => {
    const water = product({ name: 'Water', densityGPerMl: 1.0 });
    expect(toGrams(250, Unit.MILLILITRE, water)).toBe(250);
    expect(toGrams(1, Unit.LITRE, water)).toBe(1000);

    const oliveOil = product({ name: 'Olive oil', densityGPerMl: 0.91 });
    expect(toGrams(500, Unit.MILLILITRE, oliveOil)).toBeCloseTo(500 * 0.91, 5);
  });

  it('uses gramsPerCup exactly for CUP when set', () => {
    const flour = product({ name: 'All-purpose flour', gramsPerCup: 125 });
    expect(toGrams(2, Unit.CUP, flour)).toBe(250);
  });

  it('falls back to gramsPerCup / 16 for TABLESPOON when no tablespoon weight exists', () => {
    const flour = product({ name: 'All-purpose flour', gramsPerCup: 128 });
    expect(toGrams(1, Unit.TABLESPOON, flour)).toBeCloseTo(128 / 16, 5);
  });

  it('prefers gramsPerTablespoon over gramsPerCup for TABLESPOON when both are set', () => {
    const flour = product({ name: 'All-purpose flour', gramsPerCup: 128, gramsPerTablespoon: 8 });
    expect(toGrams(1, Unit.TABLESPOON, flour)).toBe(8);
  });

  it('falls back through tablespoon then cup for TEASPOON', () => {
    const withTablespoon = product({ name: 'Sugar', gramsPerTablespoon: 12 });
    expect(toGrams(1, Unit.TEASPOON, withTablespoon)).toBeCloseTo(12 / 3, 5);

    const withCupOnly = product({ name: 'Sugar', gramsPerCup: 200 });
    expect(toGrams(1, Unit.TEASPOON, withCupOnly)).toBeCloseTo(200 / 48, 5);

    const withTeaspoon = product({ name: 'Sugar', gramsPerTablespoon: 12, gramsPerTeaspoon: 5 });
    expect(toGrams(1, Unit.TEASPOON, withTeaspoon)).toBe(5);
  });

  it('derives a density from gramsPerCup for MILLILITRE when no density is set', () => {
    const flour = product({ name: 'All-purpose flour', gramsPerCup: 120, densityGPerMl: null });
    expect(toGrams(240, Unit.MILLILITRE, flour)).toBeCloseTo(120, 5);
    expect(toGrams(1, Unit.LITRE, flour)).toBeCloseTo((120 / 240) * 1000, 5);
  });

  it('the almonds regression: 200 mL of almonds must not come out as 200 g', () => {
    // Whole almonds: ~143 g/cup (USDA), so density derives to 143/240 ≈ 0.596 g/mL.
    const almonds = product({ name: 'Almonds', gramsPerCup: 143 });
    const grams = toGrams(200, Unit.MILLILITRE, almonds);
    expect(grams).not.toBe(200);
    expect(grams).toBeCloseTo((143 / 240) * 200, 5);
    expect(grams).toBeLessThan(150);
  });

  it('throws a BadRequestError for every volume unit when the product has no volume info at all', () => {
    const almonds = product({ name: 'Almonds' });
    for (const unit of [Unit.CUP, Unit.TABLESPOON, Unit.TEASPOON, Unit.MILLILITRE, Unit.LITRE]) {
      expect(() => toGrams(1, unit, almonds)).toThrow(BadRequestError);
    }
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
    expect(recipeNutrition([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0 });
  });

  it('sums a realistic multi-ingredient recipe', () => {
    const chicken = product({
      name: 'Chicken breast, raw',
      caloriesPer100g: 165,
      proteinPer100g: 31,
      carbsPer100g: 0,
      fatPer100g: 3.6,
      sugarPer100g: 0,
    });
    const egg = product({
      name: 'Egg',
      caloriesPer100g: 143,
      proteinPer100g: 12.6,
      carbsPer100g: 0.7,
      fatPer100g: 9.5,
      sugarPer100g: 0.4,
      gramsPerPiece: 50,
    });
    const rice = product({
      name: 'White rice, cooked',
      caloriesPer100g: 130,
      proteinPer100g: 2.7,
      carbsPer100g: 28.2,
      fatPer100g: 0.3,
      sugarPer100g: 0.1,
    });

    const nutrition = recipeNutrition([
      { quantity: 200, unit: Unit.GRAM, product: chicken },
      { quantity: 2, unit: Unit.PIECE, product: egg },
      { quantity: 150, unit: Unit.GRAM, product: rice },
    ]);

    // chicken 200g -> 330/62/0/7.2/0, egg 100g -> 143/12.6/0.7/9.5/0.4, rice 150g -> 195/4.05/42.3/0.45/0.15
    expect(nutrition.calories).toBeCloseTo(668, 1);
    expect(nutrition.protein).toBeCloseTo(78.6, 1);
    expect(nutrition.carbs).toBeCloseTo(43, 1);
    expect(nutrition.fat).toBeCloseTo(17.2, 1);
    expect(nutrition.sugar).toBeCloseTo(0.55, 1);
  });

  it('follows sugar through volume conversion using the product density', () => {
    // Honey: sugarPer100g 82, density 1.42 g/mL. 2 tbsp = 30 mL -> 42.6 g -> 34.932 g sugar.
    const honey = product({ name: 'Honey', sugarPer100g: 82, densityGPerMl: 1.42 });
    const nutrition = recipeNutrition([{ quantity: 2, unit: Unit.TABLESPOON, product: honey }]);
    expect(nutrition.sugar).toBeCloseTo(34.9, 1);
  });

  it('follows sugar through per-piece conversion using gramsPerPiece', () => {
    // Banana: sugarPer100g 12.2, gramsPerPiece 118. 2 pieces = 236g -> 28.792 g sugar.
    const banana = product({ name: 'Banana', sugarPer100g: 12.2, gramsPerPiece: 118 });
    const nutrition = recipeNutrition([{ quantity: 2, unit: Unit.PIECE, product: banana }]);
    expect(nutrition.sugar).toBeCloseTo(28.8, 1);
  });
});
