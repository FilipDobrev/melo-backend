import { describe, expect, it } from 'vitest';
import { mapFoodToProduct, resolveFoodNutrients, USDA_SOURCE } from '../mapProduct';
import type { CsvRow, NutrientKey } from '../types';

const nutrientIds: Record<NutrientKey, string> = {
  calories: '1008',
  protein: '1003',
  fat: '1004',
  carbs: '1005',
  sugar: '2000',
};

describe('resolveFoodNutrients', () => {
  it('reads each nutrient amount for the food and reports none missing when all are present', () => {
    const amounts = new Map([
      ['123:1008', 165],
      ['123:1003', 31],
      ['123:1004', 3.6],
      ['123:1005', 0],
      ['123:2000', 0],
    ]);

    const result = resolveFoodNutrients('123', nutrientIds, amounts);

    expect(result.values).toEqual({ calories: 165, protein: 31, fat: 3.6, carbs: 0, sugar: 0 });
    expect(result.missing).toEqual([]);
  });

  it('defaults an absent nutrient to 0 and lists it as missing', () => {
    const amounts = new Map([
      ['123:1008', 52],
      ['123:1003', 0.3],
      ['123:1004', 0.2],
      ['123:1005', 13.8],
      // sugar deliberately absent, as SR Legacy is for many foods
    ]);

    const result = resolveFoodNutrients('123', nutrientIds, amounts);

    expect(result.values.sugar).toBe(0);
    expect(result.missing).toEqual(['sugar']);
  });
});

describe('mapFoodToProduct', () => {
  it('maps a sample food row to the Product shape', () => {
    const foodRow: CsvRow = {
      fdc_id: '171705',
      data_type: 'sr_legacy_food',
      description: 'Apples, raw, with skin',
      food_category_id: '9',
      publication_date: '2019-04-01',
    };
    const nutrients = {
      values: { calories: 52, protein: 0.3, fat: 0.2, carbs: 13.8, sugar: 10.4 },
      missing: [] as NutrientKey[],
    };
    const portions = { gramsPerCup: 109, gramsPerTablespoon: null, gramsPerTeaspoon: null, gramsPerPiece: 182 };

    const product = mapFoodToProduct(foodRow, nutrients, portions);

    expect(product).toEqual({
      name: 'Apples, raw, with skin',
      source: USDA_SOURCE,
      externalId: '171705',
      caloriesPer100g: 52,
      proteinPer100g: 0.3,
      carbsPer100g: 13.8,
      fatPer100g: 0.2,
      sugarPer100g: 10.4,
      gramsPerCup: 109,
      gramsPerTablespoon: null,
      gramsPerTeaspoon: null,
      gramsPerPiece: 182,
    });
  });
});
