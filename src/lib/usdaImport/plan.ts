import { parseUsdaCsv } from './csv';
import { requiredNutrientCsvColumns, resolveNutrientIds } from './nutrients';
import { mapFoodToProduct, REQUIRED_FOOD_COLUMNS, REQUIRED_FOOD_NUTRIENT_COLUMNS, resolveFoodNutrients } from './mapProduct';
import {
  derivePortionsForFood,
  groupPortionsByFood,
  joinPortionRows,
  REQUIRED_MEASURE_UNIT_COLUMNS,
  REQUIRED_PORTION_COLUMNS,
} from './portions';
import type { RequiredFile } from './archive';
import type { ImportSummary, NutrientKey, UsdaProductRecord } from './types';

/** SR Legacy's own data_type tag. We only ever expect this value in food.csv, but we assert it rather than assume. */
const SR_LEGACY_DATA_TYPE = 'sr_legacy_food';

export interface ImportPlan {
  records: UsdaProductRecord[];
  summary: Omit<ImportSummary, 'created' | 'updated'>;
}

/**
 * Parses the five CSVs and builds the full set of Product rows to import,
 * with no database access - safe to call for both --dry-run and a real run,
 * and directly testable against small synthetic CSV fixtures.
 *
 * @throws {Error} if a required column is missing from any file, or if a
 * required nutrient cannot be resolved. See {@link parseUsdaCsv} and
 * {@link resolveNutrientIds}.
 */
export function buildImportPlan(files: Record<RequiredFile, Buffer>): ImportPlan {
  const nutrientRows = parseUsdaCsv(files['nutrient.csv'], 'nutrient.csv', requiredNutrientCsvColumns());
  const nutrientIds = resolveNutrientIds(nutrientRows);

  const measureUnitRows = parseUsdaCsv(files['measure_unit.csv'], 'measure_unit.csv', REQUIRED_MEASURE_UNIT_COLUMNS);
  const measureUnitsById = new Map(measureUnitRows.map((row) => [row.id ?? '', (row.name ?? '').toLowerCase()]));

  const portionRows = parseUsdaCsv(files['food_portion.csv'], 'food_portion.csv', REQUIRED_PORTION_COLUMNS);
  const portionsByFood = groupPortionsByFood(joinPortionRows(portionRows, measureUnitsById));

  const wantedNutrientIds = new Set(Object.values(nutrientIds));
  const foodNutrientRows = parseUsdaCsv(files['food_nutrient.csv'], 'food_nutrient.csv', REQUIRED_FOOD_NUTRIENT_COLUMNS);
  const amountsByFoodAndNutrient = new Map<string, number>();
  for (const row of foodNutrientRows) {
    const nutrientId = row.nutrient_id ?? '';
    if (!wantedNutrientIds.has(nutrientId)) continue;
    const amount = Number(row.amount ?? '');
    if (!Number.isFinite(amount)) continue;
    amountsByFoodAndNutrient.set(`${row.fdc_id ?? ''}:${nutrientId}`, amount);
  }

  const foodRows = parseUsdaCsv(files['food.csv'], 'food.csv', REQUIRED_FOOD_COLUMNS);

  const records: UsdaProductRecord[] = [];
  const skippedReasons: string[] = [];
  const missingNutrientCounts: Record<NutrientKey, number> = { calories: 0, protein: 0, fat: 0, carbs: 0, sugar: 0 };
  const missingPortionCounts = { gramsPerCup: 0, gramsPerTablespoon: 0, gramsPerTeaspoon: 0, gramsPerPiece: 0 };

  for (const foodRow of foodRows) {
    const fdcId = foodRow.fdc_id ?? '';
    const description = (foodRow.description ?? '').trim();

    if (foodRow.data_type !== SR_LEGACY_DATA_TYPE) {
      skippedReasons.push(`fdc_id ${fdcId || '(blank)'}: data_type "${foodRow.data_type}" is not "${SR_LEGACY_DATA_TYPE}"`);
      continue;
    }
    if (fdcId === '') {
      skippedReasons.push('a food.csv row has a blank fdc_id');
      continue;
    }
    if (description === '') {
      skippedReasons.push(`fdc_id ${fdcId}: blank description`);
      continue;
    }

    const nutrients = resolveFoodNutrients(fdcId, nutrientIds, amountsByFoodAndNutrient);
    for (const key of nutrients.missing) missingNutrientCounts[key] += 1;

    const portions = derivePortionsForFood(portionsByFood.get(fdcId) ?? []);
    if (portions.gramsPerCup === null) missingPortionCounts.gramsPerCup += 1;
    if (portions.gramsPerTablespoon === null) missingPortionCounts.gramsPerTablespoon += 1;
    if (portions.gramsPerTeaspoon === null) missingPortionCounts.gramsPerTeaspoon += 1;
    if (portions.gramsPerPiece === null) missingPortionCounts.gramsPerPiece += 1;

    records.push(mapFoodToProduct(foodRow, nutrients, portions));
  }

  return {
    records,
    summary: {
      rowsRead: foodRows.length,
      skipped: skippedReasons.length,
      skippedReasons,
      missingNutrientCounts,
      missingPortionCounts,
    },
  };
}
