import type { CsvRow, NutrientKey, PortionMeasures, ResolvedNutrients, UsdaProductRecord } from './types';

export const USDA_SOURCE = 'usda-sr-legacy';
export const REQUIRED_FOOD_COLUMNS = ['fdc_id', 'data_type', 'description'];
export const REQUIRED_FOOD_NUTRIENT_COLUMNS = ['fdc_id', 'nutrient_id', 'amount'];

/**
 * Looks up the five nutrient amounts for one food from the pre-filtered
 * (fdc_id, nutrient_id) -> amount map. A nutrient absent from
 * food_nutrient.csv for this food is stored as 0 and counted as missing -
 * SR Legacy genuinely lacks sugar data for a large share of foods, and 0 is
 * a defensible default for "not measured" in a per-100g nutrition column
 * that must be non-null, but callers must be able to report how many rows
 * that happened for.
 */
export function resolveFoodNutrients(
  fdcId: string,
  nutrientIds: Record<NutrientKey, string>,
  amountsByFoodAndNutrient: Map<string, number>,
): ResolvedNutrients {
  const keys: NutrientKey[] = ['calories', 'protein', 'fat', 'carbs', 'sugar'];
  const values = {} as Record<NutrientKey, number>;
  const missing: NutrientKey[] = [];

  for (const key of keys) {
    const nutrientId = nutrientIds[key];
    const amount = amountsByFoodAndNutrient.get(`${fdcId}:${nutrientId}`);
    if (amount === undefined) {
      values[key] = 0;
      missing.push(key);
    } else {
      values[key] = amount;
    }
  }

  return { values, missing };
}

/** Maps one food.csv row plus its resolved nutrients and portions to the shape written to `Product`. */
export function mapFoodToProduct(
  foodRow: CsvRow,
  nutrients: ResolvedNutrients,
  portions: PortionMeasures,
): UsdaProductRecord {
  return {
    name: foodRow.description ?? '',
    source: USDA_SOURCE,
    externalId: foodRow.fdc_id ?? '',
    caloriesPer100g: nutrients.values.calories,
    proteinPer100g: nutrients.values.protein,
    carbsPer100g: nutrients.values.carbs,
    fatPer100g: nutrients.values.fat,
    sugarPer100g: nutrients.values.sugar,
    gramsPerCup: portions.gramsPerCup,
    gramsPerTablespoon: portions.gramsPerTablespoon,
    gramsPerTeaspoon: portions.gramsPerTeaspoon,
    gramsPerPiece: portions.gramsPerPiece,
  };
}
