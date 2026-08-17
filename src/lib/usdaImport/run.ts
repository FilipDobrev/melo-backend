import type { PrismaClient } from '@prisma/client';
import { loadUsdaArchive } from './archive';
import { buildImportPlan } from './plan';
import { USDA_SOURCE } from './mapProduct';
import type { ImportSummary, UsdaProductRecord } from './types';

/**
 * Rows per database transaction. Chosen so each transaction is large enough
 * to avoid per-row round-trip overhead (the thing we're avoiding: ~7,800
 * individual round trips) while staying well under Postgres's default
 * statement/parameter limits and keeping any single transaction short - a
 * failure mid-import only has to redo up to one chunk's worth of work when
 * the script is re-run, because the whole import is idempotent anyway.
 */
export const CHUNK_SIZE = 500;

export interface RunImportOptions {
  inputPath: string;
  dryRun: boolean;
  /** Called after each chunk so the CLI can print progress. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Loads the archive, builds the full import plan, diffs it against what's
 * already in the `Product` table under source="usda-sr-legacy", and (unless
 * dryRun) writes it in chunked upsert transactions.
 *
 * Only ever reads/writes rows with source="usda-sr-legacy" - it can never
 * touch source="seed" rows because the unique key it upserts on is
 * (source, externalId) and source is hardcoded here, not taken from input.
 */
export async function runImport(prisma: PrismaClient, options: RunImportOptions): Promise<ImportSummary> {
  const files = loadUsdaArchive(options.inputPath);
  const plan = buildImportPlan(files);

  const existing = await prisma.product.findMany({
    where: { source: USDA_SOURCE },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((row) => row.externalId));

  const created = plan.records.filter((record) => !existingIds.has(record.externalId)).length;
  const updated = plan.records.length - created;

  if (!options.dryRun) {
    await writeChunked(prisma, plan.records, options.onProgress);
  }

  return { ...plan.summary, created, updated };
}

async function writeChunked(
  prisma: PrismaClient,
  records: UsdaProductRecord[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (let start = 0; start < records.length; start += CHUNK_SIZE) {
    const chunk = records.slice(start, start + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((record) =>
        prisma.product.upsert({
          where: { source_externalId: { source: record.source, externalId: record.externalId } },
          update: {
            name: record.name,
            caloriesPer100g: record.caloriesPer100g,
            proteinPer100g: record.proteinPer100g,
            carbsPer100g: record.carbsPer100g,
            fatPer100g: record.fatPer100g,
            sugarPer100g: record.sugarPer100g,
            gramsPerCup: record.gramsPerCup,
            gramsPerTablespoon: record.gramsPerTablespoon,
            gramsPerTeaspoon: record.gramsPerTeaspoon,
            gramsPerPiece: record.gramsPerPiece,
          },
          create: record,
        }),
      ),
    );
    onProgress?.(Math.min(start + CHUNK_SIZE, records.length), records.length);
  }
}
