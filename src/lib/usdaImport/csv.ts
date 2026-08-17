import { parse } from 'csv-parse/sync';
import type { CsvRow } from './types';

/**
 * Parses a USDA FoodData Central CSV file and asserts every column we depend
 * on is present in the header row.
 *
 * We validate against `requiredColumns` (a subset of the file's real
 * columns) rather than the full header, because SR Legacy CSVs carry many
 * columns we never read (footnotes, min/max/median, data_points, ...) and
 * pinning the full list would make this brittle for no benefit.
 *
 * @throws {Error} naming the file and the missing column(s) if the header is
 * malformed - never proceeds with a silently-shifted column mapping.
 */
export function parseUsdaCsv(buffer: Buffer, fileLabel: string, requiredColumns: string[]): CsvRow[] {
  let rows: CsvRow[];
  try {
    rows = parse(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  } catch (error) {
    throw new Error(`Failed to parse ${fileLabel} as CSV: ${(error as Error).message}`);
  }

  const header = rows.length > 0 ? Object.keys(rows[0] as CsvRow) : [];
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `${fileLabel} is missing expected column(s): ${missing.join(', ')}. ` +
        `Found columns: ${header.join(', ') || '(no rows)'}. ` +
        'This usually means the archive is not the SR Legacy CSV download, or USDA changed the ' +
        'file format. Re-download "SR Legacy" in CSV format from https://fdc.nal.usda.gov/download-datasets/ and try again.',
    );
  }

  return rows;
}
