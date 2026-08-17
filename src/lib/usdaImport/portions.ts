import type { CsvRow, PortionMeasures } from './types';

export const REQUIRED_PORTION_COLUMNS = ['fdc_id', 'seq_num', 'amount', 'measure_unit_id', 'modifier', 'gram_weight'];
export const REQUIRED_MEASURE_UNIT_COLUMNS = ['id', 'name'];

/** One food_portion.csv row, already joined to its measure_unit name. */
export interface JoinedPortionRow {
  fdcId: string;
  seqNum: number;
  amount: number;
  measureUnitName: string;
  modifier: string;
  gramWeight: number;
}

/**
 * food_portion.amount is "how many of this measure", e.g. amount=2 with
 * modifier "2 tbsp" and gram_weight = the weight of both tablespoons
 * together. We normalise to the weight of a single unit by dividing.
 *
 * amount is occasionally 0 or blank in the source data (a handful of rows
 * across all of SR Legacy); we treat that as "not usable" rather than
 * dividing by zero, since a zero-quantity portion carries no weight
 * information.
 */
export function normalizeGramWeight(gramWeight: number, amount: number): number | null {
  if (!Number.isFinite(gramWeight) || gramWeight <= 0) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return gramWeight / amount;
}

/**
 * A food frequently has several portion rows for the same measure (a cup of
 * "whole", "sliced", "chopped", "ground" ...). We deterministically pick one:
 *
 *   1. Prefer the row with no modifier text (the plain, unqualified "1 cup").
 *   2. Otherwise, the row with the lowest seq_num (USDA's own ordering,
 *      which lists the most typical / commonly-used portion first).
 *
 * This is an arbitrary tie-break in the sense that USDA does not mark one
 * portion as canonical, but it is documented and reproducible, which is
 * what matters for an idempotent import.
 */
export function selectPortionRow<T extends { modifier: string; seqNum: number }>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  const unmodified = rows.filter((row) => row.modifier.trim() === '');
  const pool = unmodified.length > 0 ? unmodified : rows;
  return pool.reduce((lowest, row) => (row.seqNum < lowest.seqNum ? row : lowest));
}

/**
 * Derives gramsPerCup / gramsPerTablespoon / gramsPerTeaspoon / gramsPerPiece
 * for one food from its (already filtered to that food) portion rows.
 *
 * gramsPerPiece rule: we only treat a portion as "a piece" when
 * measure_unit.name is exactly "piece". SR Legacy also describes countable
 * items through free-text portion_description/modifier values like "1
 * medium" or "1 fruit" under other measure units (or no measure unit at
 * all); we deliberately do not try to parse those, because "medium" is not
 * a fixed gram weight we can trust the way an explicit "piece" unit is.
 * That means gramsPerPiece comes out null for many countable foods that a
 * human would recognise as countable - a null we leave rather than invent.
 */
export function derivePortionsForFood(rows: JoinedPortionRow[]): PortionMeasures {
  const byUnit = (unitName: string): JoinedPortionRow[] =>
    rows.filter((row) => row.measureUnitName.toLowerCase() === unitName);

  const cup = selectPortionRow(byUnit('cup'));
  const tablespoon = selectPortionRow(byUnit('tablespoon'));
  const teaspoon = selectPortionRow(byUnit('teaspoon'));
  const piece = selectPortionRow(byUnit('piece'));

  return {
    gramsPerCup: cup ? normalizeGramWeight(cup.gramWeight, cup.amount) : null,
    gramsPerTablespoon: tablespoon ? normalizeGramWeight(tablespoon.gramWeight, tablespoon.amount) : null,
    gramsPerTeaspoon: teaspoon ? normalizeGramWeight(teaspoon.gramWeight, teaspoon.amount) : null,
    gramsPerPiece: piece ? normalizeGramWeight(piece.gramWeight, piece.amount) : null,
  };
}

/** Joins raw food_portion.csv rows to measure_unit.csv by id, dropping rows whose unit id is unknown. */
export function joinPortionRows(portionRows: CsvRow[], measureUnitsById: Map<string, string>): JoinedPortionRow[] {
  const joined: JoinedPortionRow[] = [];
  for (const row of portionRows) {
    const unitName = measureUnitsById.get(row.measure_unit_id ?? '');
    if (unitName === undefined) continue;
    joined.push({
      fdcId: row.fdc_id ?? '',
      seqNum: Number(row.seq_num ?? '0') || 0,
      amount: Number(row.amount ?? '0'),
      measureUnitName: unitName,
      modifier: row.modifier ?? '',
      gramWeight: Number(row.gram_weight ?? '0'),
    });
  }
  return joined;
}

/** Groups joined portion rows by fdc_id for O(1) lookup while streaming food.csv. */
export function groupPortionsByFood(rows: JoinedPortionRow[]): Map<string, JoinedPortionRow[]> {
  const byFood = new Map<string, JoinedPortionRow[]>();
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
