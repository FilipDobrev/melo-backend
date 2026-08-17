import type { CsvRow, NutrientKey } from './types';

/**
 * The five nutrients we import, identified by (nutrient_nbr, unit_name) -
 * the stable USDA-assigned pair - never by the `id` column, which is a
 * row id specific to this dataset release and not something to hardcode.
 *
 * nutrient_nbr 208 is Energy in KCAL; USDA also carries Energy in kJ under a
 * different nbr (268), which we must never match, since kJ is roughly 4x
 * kcal and would silently inflate every calorie figure in the import.
 */
const NUTRIENT_SPECS: Array<{ key: NutrientKey; nbr: string; unit: string; label: string }> = [
  { key: 'calories', nbr: '208', unit: 'KCAL', label: 'Energy' },
  { key: 'protein', nbr: '203', unit: 'G', label: 'Protein' },
  { key: 'fat', nbr: '204', unit: 'G', label: 'Total lipid (fat)' },
  { key: 'carbs', nbr: '205', unit: 'G', label: 'Carbohydrate, by difference' },
  { key: 'sugar', nbr: '269', unit: 'G', label: 'Total sugars' },
];

const REQUIRED_NUTRIENT_COLUMNS = ['id', 'name', 'unit_name', 'nutrient_nbr'];

export function requiredNutrientCsvColumns(): string[] {
  return REQUIRED_NUTRIENT_COLUMNS;
}

/**
 * Resolves each of the five nutrients we need to its `id` in nutrient.csv.
 *
 * @throws {Error} listing exactly which nutrient(s) could not be resolved -
 * by design, never falls back to a guess or a zero. A caller must not
 * proceed with an import if a nutrient we need cannot be identified.
 */
export function resolveNutrientIds(nutrientRows: CsvRow[]): Record<NutrientKey, string> {
  const result = {} as Record<NutrientKey, string>;
  const unresolved: string[] = [];

  for (const spec of NUTRIENT_SPECS) {
    const match = nutrientRows.find(
      (row) => row.nutrient_nbr === spec.nbr && row.unit_name === spec.unit,
    );
    if (!match || !match.id) {
      unresolved.push(`${spec.label} (nutrient_nbr=${spec.nbr}, unit_name=${spec.unit})`);
      continue;
    }
    result[spec.key] = match.id;
  }

  if (unresolved.length > 0) {
    throw new Error(
      `Could not resolve required nutrient(s) from nutrient.csv: ${unresolved.join('; ')}. ` +
        'The archive may be the wrong dataset, or USDA renumbered a nutrient. Aborting rather than importing with a missing or wrong nutrient.',
    );
  }

  return result;
}
