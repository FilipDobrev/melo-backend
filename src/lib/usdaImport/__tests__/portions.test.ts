import { describe, expect, it } from 'vitest';
import {
  derivePortionsForFood,
  groupPortionsByFood,
  joinPortionRows,
  normalizeGramWeight,
  selectPortionRow,
  type JoinedPortionRow,
} from '../portions';
import type { CsvRow } from '../types';

function portion(overrides: Partial<JoinedPortionRow>): JoinedPortionRow {
  return { fdcId: '1', seqNum: 1, amount: 1, measureUnitName: 'cup', modifier: '', gramWeight: 100, ...overrides };
}

describe('normalizeGramWeight', () => {
  it('passes the gram weight through unchanged when amount is 1', () => {
    expect(normalizeGramWeight(240, 1)).toBe(240);
  });

  it('divides by amount to get the weight of a single unit (e.g. "2 tbsp" -> per-tbsp weight)', () => {
    // gram_weight for a "2 tbsp" portion is the weight of both tablespoons together.
    expect(normalizeGramWeight(30, 2)).toBe(15);
  });

  it('returns null rather than dividing by zero when amount is 0', () => {
    expect(normalizeGramWeight(100, 0)).toBeNull();
  });

  it('returns null for a non-positive or non-finite gram weight', () => {
    expect(normalizeGramWeight(0, 1)).toBeNull();
    expect(normalizeGramWeight(-5, 1)).toBeNull();
    expect(normalizeGramWeight(NaN, 1)).toBeNull();
  });
});

describe('selectPortionRow', () => {
  it('prefers the row with no modifier over rows with a modifier', () => {
    const rows = [
      portion({ seqNum: 1, modifier: 'chopped' }),
      portion({ seqNum: 2, modifier: '' }),
      portion({ seqNum: 3, modifier: 'sliced' }),
    ];
    expect(selectPortionRow(rows)).toBe(rows[1]);
  });

  it('falls back to the lowest seq_num when every candidate has a modifier', () => {
    const rows = [portion({ seqNum: 5, modifier: 'sliced' }), portion({ seqNum: 2, modifier: 'chopped' })];
    expect(selectPortionRow(rows)).toBe(rows[1]);
  });

  it('falls back to the lowest seq_num when several rows have no modifier', () => {
    const rows = [portion({ seqNum: 4, modifier: '' }), portion({ seqNum: 1, modifier: '' })];
    expect(selectPortionRow(rows)).toBe(rows[1]);
  });

  it('returns undefined for an empty list', () => {
    expect(selectPortionRow([])).toBeUndefined();
  });
});

describe('derivePortionsForFood', () => {
  it('picks cup/tablespoon/teaspoon/piece independently and leaves the rest null', () => {
    const rows: JoinedPortionRow[] = [
      portion({ measureUnitName: 'cup', seqNum: 1, modifier: '', gramWeight: 128, amount: 1 }),
      portion({ measureUnitName: 'cup', seqNum: 2, modifier: 'sifted', gramWeight: 100, amount: 1 }),
      // "2 tbsp" -> normalises to 8 g per tbsp.
      portion({ measureUnitName: 'tablespoon', seqNum: 3, modifier: '', gramWeight: 16, amount: 2 }),
    ];

    const result = derivePortionsForFood(rows);

    expect(result.gramsPerCup).toBe(128);
    expect(result.gramsPerTablespoon).toBe(8);
    expect(result.gramsPerTeaspoon).toBeNull();
    expect(result.gramsPerPiece).toBeNull();
  });

  it('derives gramsPerPiece only from a measure_unit named exactly "piece"', () => {
    const rows: JoinedPortionRow[] = [
      portion({ measureUnitName: 'piece', seqNum: 1, modifier: '', gramWeight: 118, amount: 1 }),
      // A free-text "1 medium" under a different unit must not be treated as a piece.
      portion({ measureUnitName: 'serving', seqNum: 2, modifier: 'medium', gramWeight: 150, amount: 1 }),
    ];

    expect(derivePortionsForFood(rows).gramsPerPiece).toBe(118);
  });

  it('returns every measure as null when there are no portion rows for the food', () => {
    expect(derivePortionsForFood([])).toEqual({
      gramsPerCup: null,
      gramsPerTablespoon: null,
      gramsPerTeaspoon: null,
      gramsPerPiece: null,
    });
  });
});

describe('joinPortionRows + groupPortionsByFood', () => {
  it('joins by measure_unit_id, drops rows with an unknown unit, and groups by fdc_id', () => {
    const portionRows: CsvRow[] = [
      { fdc_id: '1', seq_num: '1', amount: '1', measure_unit_id: '10', modifier: '', gram_weight: '128' },
      { fdc_id: '1', seq_num: '2', amount: '1', measure_unit_id: '999', modifier: '', gram_weight: '50' }, // unknown unit
      { fdc_id: '2', seq_num: '1', amount: '1', measure_unit_id: '10', modifier: '', gram_weight: '200' },
    ];
    const measureUnitsById = new Map([['10', 'cup']]);

    const joined = joinPortionRows(portionRows, measureUnitsById);
    expect(joined).toHaveLength(2);

    const grouped = groupPortionsByFood(joined);
    expect(grouped.get('1')).toHaveLength(1);
    expect(grouped.get('2')).toHaveLength(1);
    expect(grouped.get('3')).toBeUndefined();
  });
});
