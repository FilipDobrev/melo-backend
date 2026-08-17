import { describe, expect, it } from 'vitest';
import {
  derivePortionsForFood,
  groupPortionsByFood,
  normalizeGramWeight,
  parseModifierMeasure,
  parsePortionRows,
  selectPortionRow,
  type PortionRow,
} from '../portions';
import type { CsvRow } from '../types';

// Every row below is copied verbatim (fdc_id, seq_num, amount, modifier,
// gram_weight) from the real SR Legacy 2018-04 food_portion.csv, not
// invented, per the lesson this fix is for: measure_unit_id is 9999
// ("undetermined") on all 14,449 rows, so the old measure_unit.csv join
// silently produced null for everything.
function portion(overrides: Partial<PortionRow>): PortionRow {
  return { fdcId: '1', seqNum: 1, amount: 1, modifier: 'cup', gramWeight: 100, ...overrides };
}

describe('parseModifierMeasure', () => {
  it('recognises the plain, unqualified measures', () => {
    expect(parseModifierMeasure('cup')).toEqual({ measure: 'cup', qualified: false });
    expect(parseModifierMeasure('tbsp')).toEqual({ measure: 'tbsp', qualified: false });
    expect(parseModifierMeasure('tablespoon')).toEqual({ measure: 'tbsp', qualified: false });
    expect(parseModifierMeasure('tsp')).toEqual({ measure: 'tsp', qualified: false });
    expect(parseModifierMeasure('teaspoon')).toEqual({ measure: 'tsp', qualified: false });
    expect(parseModifierMeasure('fl oz')).toEqual({ measure: 'flOz', qualified: false });
  });

  it('is case-insensitive', () => {
    expect(parseModifierMeasure('Cup')).toEqual({ measure: 'cup', qualified: false });
  });

  it('recognises a qualified modifier as the same measure', () => {
    expect(parseModifierMeasure('cup (8 fl oz)')).toEqual({ measure: 'cup', qualified: true });
    expect(parseModifierMeasure('cup, chopped')).toEqual({ measure: 'cup', qualified: true });
  });

  it('does not confuse tbsp and tsp with each other', () => {
    expect(parseModifierMeasure('tbsp, chopped')?.measure).toBe('tbsp');
    expect(parseModifierMeasure('tsp, chopped')?.measure).toBe('tsp');
    expect(parseModifierMeasure('tablespoons')?.measure).toBe('tbsp');
  });

  it('does not match a word that merely starts with a measure name', () => {
    // Real SR modifier for a different food entirely - would false-match "cup" under a naive
    // startsWith with no word-boundary check.
    expect(parseModifierMeasure('cupcake')).toBeNull();
  });

  it('returns null for modifiers that are not a recognised measure', () => {
    expect(parseModifierMeasure('oz')).toBeNull();
    expect(parseModifierMeasure('piece')).toBeNull();
    expect(parseModifierMeasure('serving')).toBeNull();
  });
});

describe('normalizeGramWeight', () => {
  it('passes the gram weight through unchanged when amount is 1', () => {
    expect(normalizeGramWeight(15, 1)).toBe(15); // real row: fdc_id 167684, "tbsp"
  });

  it('divides by amount to get the weight of a single unit', () => {
    // Real row: fdc_id 167565, seq_num 7, "tbsp", amount 2, gram_weight 25.
    expect(normalizeGramWeight(25, 2)).toBe(12.5);
  });

  it('returns null rather than dividing by zero when amount is 0', () => {
    // Real row: fdc_id 168789, "cup", amount 0, gram_weight 142.
    expect(normalizeGramWeight(142, 0)).toBeNull();
  });

  it('returns null for a non-positive or non-finite gram weight', () => {
    expect(normalizeGramWeight(0, 1)).toBeNull();
    expect(normalizeGramWeight(-5, 1)).toBeNull();
    expect(normalizeGramWeight(NaN, 1)).toBeNull();
  });
});

describe('selectPortionRow', () => {
  it('prefers the unqualified row over qualified rows', () => {
    // Real rows for fdc_id 168167: "cup, drained" (seq 1) and plain "cup" (seq 2).
    const rows = [
      portion({ seqNum: 1, modifier: 'cup, drained', gramWeight: 150 }),
      portion({ seqNum: 2, modifier: 'cup', gramWeight: 214 }),
    ].map((row) => ({ qualified: row.modifier.trim() !== 'cup', seqNum: row.seqNum }));
    expect(selectPortionRow(rows)).toEqual({ qualified: false, seqNum: 2 });
  });

  it('falls back to the lowest seq_num when every candidate is qualified', () => {
    const rows = [
      { qualified: true, seqNum: 5 },
      { qualified: true, seqNum: 2 },
    ];
    expect(selectPortionRow(rows)).toBe(rows[1]);
  });

  it('falls back to the lowest seq_num when several rows are unqualified', () => {
    const rows = [
      { qualified: false, seqNum: 4 },
      { qualified: false, seqNum: 1 },
    ];
    expect(selectPortionRow(rows)).toBe(rows[1]);
  });

  it('returns undefined for an empty list', () => {
    expect(selectPortionRow([])).toBeUndefined();
  });
});

describe('derivePortionsForFood', () => {
  it('picks cup/tbsp/tsp/piece independently, prefers the unqualified row, and leaves the rest null', () => {
    const rows: PortionRow[] = [
      portion({ modifier: 'cup', seqNum: 2, gramWeight: 214 }), // fdc_id 168167 (real)
      portion({ modifier: 'cup, drained', seqNum: 1, gramWeight: 150 }), // fdc_id 168167 (real)
      portion({ modifier: 'tbsp', seqNum: 7, amount: 2, gramWeight: 25 }), // fdc_id 167565 (real) -> 12.5 g/tbsp
    ];

    const result = derivePortionsForFood(rows);

    expect(result.gramsPerCup).toBe(214);
    expect(result.gramsPerTablespoon).toBe(12.5);
    expect(result.gramsPerTeaspoon).toBeNull();
    expect(result.gramsPerPiece).toBeNull();
    expect(result.densityGPerMl).toBeNull();
  });

  it('treats "cup (8 fl oz)" as a qualified cup row, not an fl-oz row', () => {
    // Real row: fdc_id 168123, "cup (8 fl oz)", amount 1, gram_weight 240.
    const rows: PortionRow[] = [portion({ modifier: 'cup (8 fl oz)', gramWeight: 240 })];
    const result = derivePortionsForFood(rows);
    expect(result.gramsPerCup).toBe(240);
    expect(result.densityGPerMl).toBeNull();
  });

  it('handles an amount of 0.5 correctly', () => {
    // Real row: fdc_id 167573, "cup", amount 0.5, gram_weight 107 -> 214 g/cup.
    const rows: PortionRow[] = [portion({ modifier: 'cup', amount: 0.5, gramWeight: 107 })];
    expect(derivePortionsForFood(rows).gramsPerCup).toBe(214);
  });

  it('skips a row with amount 0 rather than dividing by zero', () => {
    // Real row: fdc_id 168789, "cup", amount 0, gram_weight 142.
    const rows: PortionRow[] = [portion({ modifier: 'cup', amount: 0, gramWeight: 142 })];
    expect(derivePortionsForFood(rows).gramsPerCup).toBeNull();
  });

  it('derives densityGPerMl from an explicit fl-oz row', () => {
    // Real row: fdc_id 167697, "fl oz", amount 1, gram_weight 30.6.
    const rows: PortionRow[] = [portion({ modifier: 'fl oz', gramWeight: 30.6 })];
    const density = derivePortionsForFood(rows).densityGPerMl;
    expect(density).not.toBeNull();
    expect(density).toBeCloseTo(30.6 / 29.5735, 6);
  });

  it('derives gramsPerPiece only from the piece/slice/unit allowlist', () => {
    const rows: PortionRow[] = [
      portion({ modifier: 'piece', gramWeight: 118 }), // real: fdc_id 167528
      // A free-text "1 medium" under a non-allowlisted modifier must not be treated as a piece.
      portion({ modifier: 'serving', gramWeight: 150 }),
    ];
    expect(derivePortionsForFood(rows).gramsPerPiece).toBe(118);
  });

  it('returns every measure as null when there are no usable portion rows for the food', () => {
    expect(derivePortionsForFood([])).toEqual({
      gramsPerCup: null,
      gramsPerTablespoon: null,
      gramsPerTeaspoon: null,
      gramsPerPiece: null,
      densityGPerMl: null,
    });
  });
});

describe('parsePortionRows + groupPortionsByFood', () => {
  it('parses raw CSV rows and groups them by fdc_id', () => {
    const portionRows: CsvRow[] = [
      { fdc_id: '1', seq_num: '1', amount: '1', modifier: 'cup', gram_weight: '128' },
      { fdc_id: '1', seq_num: '2', amount: '1', modifier: 'tbsp', gram_weight: '15' },
      { fdc_id: '2', seq_num: '1', amount: '1', modifier: 'cup', gram_weight: '200' },
    ];

    const parsed = parsePortionRows(portionRows);
    expect(parsed).toHaveLength(3);

    const grouped = groupPortionsByFood(parsed);
    expect(grouped.get('1')).toHaveLength(2);
    expect(grouped.get('2')).toHaveLength(1);
    expect(grouped.get('3')).toBeUndefined();
  });
});
