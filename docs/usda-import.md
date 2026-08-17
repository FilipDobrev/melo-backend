# Importing USDA FoodData Central (SR Legacy) into `Product`

Replaces the 27 hand-seeded products with a real ingredient database: about
7,800 generic foods from USDA's "SR Legacy" dataset, each with calories,
protein, fat, carbs, sugar (per 100 g) and household measures (cup,
tablespoon, teaspoon, and a countable "piece" where USDA records one).

Source: USDA FoodData Central, US Public Domain 1.0 licence (no attribution
required, though this import is tagged with its source in the database -
see "How it's stored" below). SR Legacy was frozen in 2019 and will not be
updated again, which is fine for whole-food composition data.

## 1. Download the data

1. Go to <https://fdc.nal.usda.gov/download-datasets/>.
2. Find **"SR Legacy"** (not "Foundation Foods", "FNDDS", or "Branded
   Foods" - those are different datasets with different columns).
3. Download the **CSV** format (not JSON). It's a ~6.7 MB zip.

You can pass the import script either that `.zip` file directly, or a
directory you've already extracted it into - it looks for the CSVs
recursively either way, so USDA's nested folder name doesn't matter.

## 2. Dry run first

```bash
npm run products:import-usda -- /path/to/FoodData_Central_sr_legacy_food_csv_*.zip --dry-run
```

This parses and validates everything and prints exactly what would happen -
rows read, products that would be created/updated, rows skipped, and how
many foods are missing each nutrient or measure - **without writing
anything to the database**. Run this first and read the summary before
importing for real.

## 3. Import for real

```bash
npm run products:import-usda -- /path/to/FoodData_Central_sr_legacy_food_csv_*.zip
```

Writes in batches of 500 (chunked upsert transactions, not one round trip
per row). Takes a couple of minutes for the full ~7,800-food dataset.

The import is **idempotent**: it upserts on `(source, externalId)`, so
running it again (e.g. after USDA fixes a typo and you re-download) updates
existing rows in place instead of duplicating them. It only ever touches
rows with `source = "usda-sr-legacy"` - it can never affect your 27
hand-seeded `source = "seed"` products or any product a user created
manually (`source = "manual"`), because the upsert key it writes is always
`usda-sr-legacy` plus the USDA `fdc_id`, never taken from existing data.

## 4. What you'll see in the summary

```
Rows read from food.csv:  7793
Products created: 7793
Products updated: 0
Rows skipped: 0

Missing nutrient data (stored as 0), by nutrient:
  calories: 12
  protein:  12
  fat:      12
  carbs:    340
  sugar:    2891

Missing measures (left null), by measure:
  gramsPerCup:        4102
  gramsPerTablespoon: 6210
  gramsPerTeaspoon:   6580
  gramsPerPiece:      6890
```

(Numbers above are illustrative, not a guarantee - the real counts depend on
the SR Legacy release you download.)

A missing nutrient is stored as `0`, never left null - the `Product` schema
requires calories/protein/fat/carbs to be non-null. Sugar is the nutrient
you'll see missing most often: SR Legacy genuinely does not carry sugar
figures for a large share of foods (mostly meats, fats and some prepared
dishes), not a bug in this script.

A missing measure (cup/tablespoon/teaspoon/piece) is left `null`, meaning
the app will refuse to convert that unit for that product (see
`src/services/nutrition.ts`) rather than guess a wrong weight.

## How it's stored

Each SR Legacy food becomes one `Product` row:

| Product field | Source |
|---|---|
| `name` | `food.csv` → `description` |
| `source` | always `"usda-sr-legacy"` |
| `externalId` | `food.csv` → `fdc_id`, as a string |
| `caloriesPer100g` | `food_nutrient.csv` amount for nutrient_nbr 208, unit KCAL |
| `proteinPer100g` | nutrient_nbr 203, unit G |
| `fatPer100g` | nutrient_nbr 204, unit G |
| `carbsPer100g` | nutrient_nbr 205, unit G ("Carbohydrate, by difference") |
| `sugarPer100g` | nutrient_nbr 269, unit G ("Total sugars") |
| `gramsPerCup` / `gramsPerTablespoon` / `gramsPerTeaspoon` | `food_portion.csv` joined to `measure_unit.csv`, see below |
| `gramsPerPiece` | `food_portion.csv` rows whose measure unit is exactly "piece" |

Nutrients are resolved by `(nutrient_nbr, unit_name)` from `nutrient.csv`
at import time, never by a hardcoded row id - those ids are specific to one
dataset release. The energy nutrient in particular has both a KCAL row and
a kJ row under different `nutrient_nbr`s; picking the wrong one would
silently inflate every calorie figure roughly fourfold, so the script
asserts each of the five nutrients resolves before importing anything, and
fails loudly (naming which one) if it can't.

### Which portion row wins

A food often has several rows in `food_portion.csv` for the same measure
(e.g. "1 cup whole", "1 cup sliced", "1 cup chopped" for almonds). The
script picks one, deterministically:

1. Prefer the row with **no modifier** (the plain "1 cup").
2. Otherwise, the row with the **lowest `seq_num`** (USDA's own ordering,
   which lists the most typical portion first).

`gramsPerPiece` is derived **only** from rows whose `measure_unit.name` is
exactly `"piece"`. SR Legacy also describes countable items in free text
under other units (e.g. "1 medium", "1 fruit" as a *description* on a
non-piece row) - those are deliberately not parsed into `gramsPerPiece`,
because a word like "medium" is not a fixed gram weight we can trust the
way an explicit "piece" measure unit is. That means many foods a human
would call countable still get `gramsPerPiece = null`; that's the
documented trade-off, not a bug.

`food_portion.amount` is sometimes more than 1 (e.g. a row meaning "2
tablespoons" with `gram_weight` = the weight of both). The script divides
`gram_weight` by `amount` to normalise to the weight of a single unit
before storing it.

## Undoing an import

USDA rows are the only ones tagged `source = "usda-sr-legacy"`, so removing
them is a single scoped delete:

```sql
DELETE FROM "Product" WHERE source = 'usda-sr-legacy';
```

or, via Prisma:

```bash
npx prisma db execute --stdin <<< "DELETE FROM \"Product\" WHERE source = 'usda-sr-legacy';"
```

This never touches `source = 'seed'` or `source = 'manual'` rows. Recipes
that reference a deleted USDA product will fail to delete it instead
(`onDelete: Restrict` on `RecipeIngredient.product`) - remove or reassign
those ingredients first if you need to fully undo an import that's already
in use.

## Notes on search at this scale

`GET /products?search=` does a case-insensitive `contains` scan with no
supporting index (see `src/repositories/product.repository.ts`). At ~7,800
rows this is a full sequential scan on every search request.

Measured directly: with 7,800 synthetic rows loaded and `EXPLAIN ANALYZE`
run against the exact query the repository issues (`name ILIKE '%term%'
ORDER BY "createdAt" DESC, id DESC LIMIT 21`), Postgres does a `Seq Scan`
over all 7,800 rows and returns in **~5 ms execution time** (plus ~1.4 ms
planning). `Product` is a narrow table - a handful of floats and one text
column - so scanning it end to end is cheap even though it's not indexed.

This is not pathological today, but it is `O(rows)`: it will start to
matter if the table grows another order of magnitude (e.g. adding
Foundation Foods or Branded Foods on top of SR Legacy), or under heavy
concurrent search traffic where many sequential scans compete for the same
buffer cache. At that point a trigram (`pg_trgm`) GIN index on `name`, or
Postgres full-text search, would be the fix. Out of scope for this import;
not changed here.
