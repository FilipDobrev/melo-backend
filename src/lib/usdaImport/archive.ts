import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

/** The five CSVs the importer reads out of the SR Legacy download. */
export const REQUIRED_FILES = ['food.csv', 'nutrient.csv', 'food_nutrient.csv', 'food_portion.csv', 'measure_unit.csv'] as const;
export type RequiredFile = (typeof REQUIRED_FILES)[number];

/**
 * Resolves the input path (a .zip, or an already-extracted directory) to
 * the raw bytes of each required CSV.
 *
 * USDA's zip extracts into a nested folder (e.g.
 * "FoodData_Central_sr_legacy_food_csv_2018-04/food.csv"), so this matches
 * files by basename anywhere in the archive/directory tree rather than
 * assuming they sit at the top level.
 *
 * @throws {Error} naming the path and what's wrong, if the path does not
 * exist, is neither a zip nor a directory, or is missing one of the
 * required files.
 */
export function loadUsdaArchive(inputPath: string): Record<RequiredFile, Buffer> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `No such file or directory: ${inputPath}. Pass the path to the downloaded SR Legacy .zip, or to the directory you extracted it into.`,
    );
  }

  const stat = fs.statSync(inputPath);
  const filesByBasename = stat.isDirectory()
    ? collectFromDirectory(inputPath)
    : collectFromZip(inputPath);

  const missing = REQUIRED_FILES.filter((name) => !filesByBasename.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${inputPath} is missing expected file(s): ${missing.join(', ')}. ` +
        'Make sure you downloaded "SR Legacy" in CSV format (not JSON) from https://fdc.nal.usda.gov/download-datasets/, ' +
        'and pass either the .zip file itself or the folder you extracted it into.',
    );
  }

  const result = {} as Record<RequiredFile, Buffer>;
  for (const name of REQUIRED_FILES) {
    result[name] = filesByBasename.get(name)!;
  }
  return result;
}

function collectFromDirectory(dir: string): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (isRequiredBasename(entry.name) && !found.has(entry.name)) {
        found.set(entry.name, fs.readFileSync(fullPath));
      }
    }
  }
  return found;
}

function collectFromZip(zipPath: string): Map<string, Buffer> {
  if (path.extname(zipPath).toLowerCase() !== '.zip') {
    throw new Error(
      `${zipPath} is neither a .zip file nor a directory. Pass the downloaded SR Legacy .zip, or the folder you extracted it into.`,
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch (error) {
    throw new Error(`Could not open ${zipPath} as a zip archive: ${(error as Error).message}`);
  }

  const found = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const basename = path.basename(entry.entryName);
    if (isRequiredBasename(basename) && !found.has(basename)) {
      found.set(basename, entry.getData());
    }
  }
  return found;
}

function isRequiredBasename(name: string): name is RequiredFile {
  return (REQUIRED_FILES as readonly string[]).includes(name);
}
