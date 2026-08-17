import { prisma } from '../src/lib/prisma';
import { runImport } from '../src/lib/usdaImport/run';
import type { ImportSummary } from '../src/lib/usdaImport/types';

/**
 * Imports USDA FoodData Central "SR Legacy" (CSV format) into the Product
 * table. See docs/usda-import.md for where to download the archive and how
 * to run this.
 *
 * Usage:
 *   npm run products:import-usda -- <path-to-zip-or-extracted-dir> [--dry-run]
 */
function parseArgs(argv: string[]): { inputPath: string; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run');
  const inputPath = argv.find((arg) => !arg.startsWith('--'));

  if (!inputPath) {
    throw new Error(
      'Usage: npm run products:import-usda -- <path-to-zip-or-extracted-dir> [--dry-run]\n' +
        'Download "SR Legacy" (CSV format) from https://fdc.nal.usda.gov/download-datasets/ first.',
    );
  }

  return { inputPath, dryRun };
}

function printSummary(summary: ImportSummary, dryRun: boolean): void {
  const lines = [
    '',
    dryRun ? '=== USDA SR Legacy import: DRY RUN (nothing written) ===' : '=== USDA SR Legacy import ===',
    `Rows read from food.csv:  ${summary.rowsRead}`,
    `Products ${dryRun ? 'that would be created' : 'created'}: ${summary.created}`,
    `Products ${dryRun ? 'that would be updated' : 'updated'}: ${summary.updated}`,
    `Rows skipped: ${summary.skipped}`,
    '',
    'Missing nutrient data (stored as 0), by nutrient:',
    `  calories: ${summary.missingNutrientCounts.calories}`,
    `  protein:  ${summary.missingNutrientCounts.protein}`,
    `  fat:      ${summary.missingNutrientCounts.fat}`,
    `  carbs:    ${summary.missingNutrientCounts.carbs}`,
    `  sugar:    ${summary.missingNutrientCounts.sugar}`,
    '',
    'Missing measures (left null), by measure:',
    `  gramsPerCup:        ${summary.missingPortionCounts.gramsPerCup}`,
    `  gramsPerTablespoon: ${summary.missingPortionCounts.gramsPerTablespoon}`,
    `  gramsPerTeaspoon:   ${summary.missingPortionCounts.gramsPerTeaspoon}`,
    `  gramsPerPiece:      ${summary.missingPortionCounts.gramsPerPiece}`,
    `  densityGPerMl:      ${summary.missingPortionCounts.densityGPerMl}`,
  ];

  if (summary.skippedReasons.length > 0) {
    lines.push('', 'First skipped rows (up to 10):');
    for (const reason of summary.skippedReasons.slice(0, 10)) lines.push(`  - ${reason}`);
  }

  // eslint-disable-next-line no-console -- scripts/ is a CLI entry point, not linted src; this is the user-facing report.
  console.log(lines.join('\n'));
}

async function main(): Promise<void> {
  const { inputPath, dryRun } = parseArgs(process.argv.slice(2));

  // eslint-disable-next-line no-console
  console.log(`Reading ${inputPath}${dryRun ? ' (dry run)' : ''}...`);

  const summary = await runImport(prisma, {
    inputPath,
    dryRun,
    onProgress: (done, total) => {
      // eslint-disable-next-line no-console
      console.log(`  wrote ${done}/${total} products...`);
    },
  });

  printSummary(summary, dryRun);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`USDA import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
