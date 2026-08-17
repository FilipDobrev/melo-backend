/** A parsed CSV row: every value is a raw string, exactly as csv-parse hands it back. */
export type CsvRow = Record<string, string>;

export type NutrientKey = 'calories' | 'protein' | 'fat' | 'carbs' | 'sugar';

/** Grams-per-household-measure, derived from food_portion.csv. Null means "no such portion recorded". */
export interface PortionMeasures {
  gramsPerCup: number | null;
  gramsPerTablespoon: number | null;
  gramsPerTeaspoon: number | null;
  gramsPerPiece: number | null;
  densityGPerMl: number | null;
}

/** Per-100g nutrient amounts resolved for one food, plus which of the five were missing from the source data. */
export interface ResolvedNutrients {
  values: Record<NutrientKey, number>;
  missing: NutrientKey[];
}

/** The shape written to `Product` for one USDA SR Legacy food. */
export interface UsdaProductRecord {
  name: string;
  source: 'usda-sr-legacy';
  externalId: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sugarPer100g: number;
  gramsPerCup: number | null;
  gramsPerTablespoon: number | null;
  gramsPerTeaspoon: number | null;
  gramsPerPiece: number | null;
  densityGPerMl: number | null;
}

export interface ImportSummary {
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  skippedReasons: string[];
  missingNutrientCounts: Record<NutrientKey, number>;
  missingPortionCounts: {
    gramsPerCup: number;
    gramsPerTablespoon: number;
    gramsPerTeaspoon: number;
    gramsPerPiece: number;
    densityGPerMl: number;
  };
}
