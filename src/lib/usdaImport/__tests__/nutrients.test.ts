import { describe, expect, it } from 'vitest';
import { resolveNutrientIds } from '../nutrients';
import type { CsvRow } from '../types';

function nutrientRow(overrides: Partial<CsvRow>): CsvRow {
  return { id: '', name: '', unit_name: '', nutrient_nbr: '', rank: '', ...overrides };
}

const fullNutrientTable: CsvRow[] = [
  nutrientRow({ id: '1008', name: 'Energy', unit_name: 'KCAL', nutrient_nbr: '208' }),
  // The kJ energy row must never be picked - same concept, wrong unit, ~4x the value.
  nutrientRow({ id: '1062', name: 'Energy', unit_name: 'kJ', nutrient_nbr: '268' }),
  nutrientRow({ id: '1003', name: 'Protein', unit_name: 'G', nutrient_nbr: '203' }),
  nutrientRow({ id: '1004', name: 'Total lipid (fat)', unit_name: 'G', nutrient_nbr: '204' }),
  nutrientRow({ id: '1005', name: 'Carbohydrate, by difference', unit_name: 'G', nutrient_nbr: '205' }),
  nutrientRow({ id: '2000', name: 'Sugars, total', unit_name: 'G', nutrient_nbr: '269' }),
];

describe('resolveNutrientIds', () => {
  it('resolves each nutrient by nutrient_nbr and unit_name, not by id', () => {
    const ids = resolveNutrientIds(fullNutrientTable);

    expect(ids.calories).toBe('1008');
    expect(ids.protein).toBe('1003');
    expect(ids.fat).toBe('1004');
    expect(ids.carbs).toBe('1005');
    expect(ids.sugar).toBe('2000');
  });

  it('never resolves calories to the kJ energy row', () => {
    const ids = resolveNutrientIds(fullNutrientTable);
    expect(ids.calories).not.toBe('1062');
  });

  it('throws naming the missing nutrient when one cannot be resolved', () => {
    const withoutSugar = fullNutrientTable.filter((row) => row.nutrient_nbr !== '269');
    expect(() => resolveNutrientIds(withoutSugar)).toThrow(/Total sugars/);
  });

  it('throws when a nutrient_nbr matches but the unit does not', () => {
    const wrongUnit = fullNutrientTable.map((row) =>
      row.nutrient_nbr === '203' ? { ...row, unit_name: 'MG' } : row,
    );
    expect(() => resolveNutrientIds(wrongUnit)).toThrow(/Protein/);
  });
});
