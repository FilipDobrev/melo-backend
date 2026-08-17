import type { CsvRow, PortionMeasures } from './types';

export const REQUIRED_PORTION_COLUMNS = ['fdc_id', 'seq_num', 'amount', 'modifier', 'gram_weight'];

/** 1 US fluid ounce, exactly, per NIST Handbook 44. */
const ML_PER_US_FLUID_OUNCE = 29.5735;

/** One food_portion.csv row, with numeric columns parsed. */
export interface PortionRow {
  fdcId: string;
  seqNum: number;
  amount: number;
  modifier: string;
  gramWeight: number;
}

export type Measure = 'cup' | 'tbsp' | 'tsp' | 'flOz';

export interface ModifierMatch {
  measure: Measure;
  /** False only for the bare measure word with no qualifier suffix, e.g. exactly "cup" or "tbsp". */
  qualified: boolean;
}

/**
 * SR Legacy's food_portion.csv sets `measure_unit_id` to 9999
 * ("undetermined") on every single row - verified against the full 2018-04
 * SR Legacy release: all 14,449 rows. `measure_unit.csv` does have proper
 * names (1000 cup, 1001 tablespoon, 1002 teaspoon, ...) but SR Legacy never
 * references them, so joining on that id yields nothing useful. The actual
 * household measure lives as free text in `modifier`, e.g. "cup",
 * "cup, chopped", "cup (8 fl oz)", "tbsp", "fl oz".
 *
 * Matched at the start of the modifier, case-insensitively, on a whole-word
 * boundary (the next character must be end-of-string, space, comma, or an
 * opening paren) - so "cupcake" would never match "cup". tbsp/tablespoon and
 * tsp/teaspoon are listed as separate, unambiguous entries rather than
 * derived from one another, so a naive substring check can't confuse them
 * ("tbsp" is not a substring match for "tsp" here, nor vice versa - each is
 * checked as its own whole word). "tablespoons" and "teaspoons" are the only
 * plurals that occur in the data and are listed explicitly for the same
 * reason.
 */
const MODIFIER_PREFIXES: ReadonlyArray<{ prefix: string; measure: Measure }> = [
  { prefix: 'tablespoons', measure: 'tbsp' },
  { prefix: 'tablespoon', measure: 'tbsp' },
  { prefix: 'tbsp', measure: 'tbsp' },
  { prefix: 'teaspoons', measure: 'tsp' },
  { prefix: 'teaspoon', measure: 'tsp' },
  { prefix: 'tsp', measure: 'tsp' },
  { prefix: 'fl oz', measure: 'flOz' },
  { prefix: 'cup', measure: 'cup' },
];

const WORD_BOUNDARY_CHARS = new Set([' ', ',', '(']);

/** Recognises which measure (if any) a food_portion.csv `modifier` value describes. */
export function parseModifierMeasure(modifier: string): ModifierMatch | null {
  const normalized = modifier.trim().toLowerCase();
  for (const { prefix, measure } of MODIFIER_PREFIXES) {
    if (normalized === prefix) return { measure, qualified: false };
    if (normalized.startsWith(prefix) && WORD_BOUNDARY_CHARS.has(normalized[prefix.length] ?? '')) {
      return { measure, qualified: true };
    }
  }
  return null;
}

/**
 * SR modifiers that denote exactly one countable item, and nothing else.
 * Deliberately conservative: SR Legacy also has "serving", "bar", "steak",
 * "fillet", "roast", "jar", "package (1.76 oz)" and similar, which describe
 * a unit of that specific food but not a fixed, comparable "piece" - a wrong
 * piece weight is worse than none, so those are left unmatched and
 * gramsPerPiece stays null for them.
 */
const PIECE_MODIFIERS = new Set(['piece', 'slice', 'unit']);

/**
 * food_portion.amount is "how many of this measure", e.g. amount=2 with
 * modifier "2 tbsp" and gram_weight = the weight of both tablespoons
 * together. We normalise to the weight of a single unit by dividing.
 *
 * amount is occasionally 0 in the source data (18 rows across all of SR
 * Legacy, 7 of them for a cup/tbsp/tsp/fl-oz modifier); we treat that as
 * "not usable" rather than dividing by zero, since a zero-quantity portion
 * carries no weight information.
 */
export function normalizeGramWeight(gramWeight: number, amount: number): number | null {
  if (!Number.isFinite(gramWeight) || gramWeight <= 0) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return gramWeight / amount;
}

interface Candidate {
  seqNum: number;
  amount: number;
  gramWeight: number;
  qualified: boolean;
}

/**
 * A food frequently has several portion rows for the same measure (a cup of
 * "whole", "sliced", "chopped", "ground" ...). We deterministically pick
 * one:
 *
 *   1. Prefer the row with no qualifier (the plain, unqualified "cup" or
 *      "tbsp", not "cup, chopped").
 *   2. Otherwise, the row with the lowest seq_num (USDA's own ordering,
 *      which lists the most typical / commonly-used portion first).
 *
 * This is an arbitrary tie-break in the sense that USDA does not mark one
 * portion as canonical - a cup of chopped vs. whole vs. shredded genuinely
 * differ - but it is documented and reproducible, which is what matters for
 * an idempotent import.
 */
export function selectPortionRow<T extends { qualified: boolean; seqNum: number }>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  const unqualified = rows.filter((row) => !row.qualified);
  const pool = unqualified.length > 0 ? unqualified : rows;
  return pool.reduce((lowest, row) => (row.seqNum < lowest.seqNum ? row : lowest));
}

function candidatesForMeasure(rows: PortionRow[], measure: Measure): Candidate[] {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const match = parseModifierMeasure(row.modifier);
    if (match === null || match.measure !== measure) continue;
    candidates.push({ seqNum: row.seqNum, amount: row.amount, gramWeight: row.gramWeight, qualified: match.qualified });
  }
  return candidates;
}

function pieceCandidates(rows: PortionRow[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (!PIECE_MODIFIERS.has(row.modifier.trim().toLowerCase())) continue;
    candidates.push({ seqNum: row.seqNum, amount: row.amount, gramWeight: row.gramWeight, qualified: false });
  }
  return candidates;
}

/**
 * Derives gramsPerCup / gramsPerTablespoon / gramsPerTeaspoon / gramsPerPiece
 * / densityGPerMl for one food from its (already filtered to that food)
 * portion rows.
 *
 * densityGPerMl comes from an explicit "fl oz" row when one exists: 1 US
 * fluid ounce is 29.5735 mL, so density = (gram_weight / amount) / 29.5735.
 * This is the right source for milk, juice and oils - a true volume-to-weight
 * relationship - and is preferred over guessing density from a cup weight
 * (which src/services/nutrition.ts still falls back to for products with no
 * fl-oz row and no explicit density, e.g. hand-entered ones).
 */
export function derivePortionsForFood(rows: PortionRow[]): PortionMeasures {
  const cup = selectPortionRow(candidatesForMeasure(rows, 'cup'));
  const tbsp = selectPortionRow(candidatesForMeasure(rows, 'tbsp'));
  const tsp = selectPortionRow(candidatesForMeasure(rows, 'tsp'));
  const flOz = selectPortionRow(candidatesForMeasure(rows, 'flOz'));
  const piece = selectPortionRow(pieceCandidates(rows));

  const flOzGramsPerUnit = flOz ? normalizeGramWeight(flOz.gramWeight, flOz.amount) : null;

  return {
    gramsPerCup: cup ? normalizeGramWeight(cup.gramWeight, cup.amount) : null,
    gramsPerTablespoon: tbsp ? normalizeGramWeight(tbsp.gramWeight, tbsp.amount) : null,
    gramsPerTeaspoon: tsp ? normalizeGramWeight(tsp.gramWeight, tsp.amount) : null,
    gramsPerPiece: piece ? normalizeGramWeight(piece.gramWeight, piece.amount) : null,
    densityGPerMl: flOzGramsPerUnit !== null ? flOzGramsPerUnit / ML_PER_US_FLUID_OUNCE : null,
  };
}

/** Parses raw food_portion.csv rows into typed PortionRows. */
export function parsePortionRows(portionRows: CsvRow[]): PortionRow[] {
  return portionRows.map((row) => ({
    fdcId: row.fdc_id ?? '',
    seqNum: Number(row.seq_num ?? '0') || 0,
    amount: Number(row.amount ?? '0'),
    modifier: row.modifier ?? '',
    gramWeight: Number(row.gram_weight ?? '0'),
  }));
}

/** Groups parsed portion rows by fdc_id for O(1) lookup while streaming food.csv. */
export function groupPortionsByFood(rows: PortionRow[]): Map<string, PortionRow[]> {
  const byFood = new Map<string, PortionRow[]>();
  for (const row of rows) {
    const existing = byFood.get(row.fdcId);
    if (existing) {
      existing.push(row);
    } else {
      byFood.set(row.fdcId, [row]);
    }
  }
  return byFood;
}
