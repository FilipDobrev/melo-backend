# Importing USDA FoodData Central (SR Legacy) into `Product`

Replaces the 27 hand-seeded products with a real ingredient database: about
7,800 generic foods from USDA's "SR Legacy" dataset, each with calories,
protein, fat, carbs, sugar (per 100 g) and, **for roughly a third of them**,
a household measure (cup, tablespoon, teaspoon, a liquid density, or a
countable "piece") - see "Realistic expectations on measures" below before
you assume every food should have one.

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

This is the **real** output from running this importer against the actual
2018-04 SR Legacy CSV release (`FoodData_Central_sr_legacy_food_csv_2018-04.zip`),
not a synthetic estimate:

```
Rows read from food.csv:  7793
Products created: 7793
Products updated: 0
Rows skipped: 0

Missing nutrient data (stored as 0), by nutrient:
  calories: 0
  protein:  0
  fat:      0
  carbs:    0
  sugar:    1786

Missing measures (left null), by measure:
  gramsPerCup:        5241
  gramsPerTablespoon: 7097
  gramsPerTeaspoon:   7592
  gramsPerPiece:      7460
  densityGPerMl:      7347
```

That means, out of 7,793 foods: **2,552 have `gramsPerCup`, 696 have
`gramsPerTablespoon`, 201 have `gramsPerTeaspoon`, 446 have `densityGPerMl`,
and 333 have `gramsPerPiece`** - 2,883 foods (37%) have at least one cup/
tablespoon/teaspoon measure. See "Realistic expectations on measures" below
for why most foods have none of these.

A missing nutrient is stored as `0`, never left null - the `Product` schema
requires calories/protein/fat/carbs to be non-null. Sugar is the nutrient
you'll see missing most often: SR Legacy genuinely does not carry sugar
figures for a large share of foods (mostly meats, fats and some prepared
dishes), not a bug in this script.

A missing measure (cup/tablespoon/teaspoon/piece/density) is left `null`,
meaning the app will refuse to convert that unit for that product (see
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
| `gramsPerCup` / `gramsPerTablespoon` / `gramsPerTeaspoon` | `food_portion.csv` → `modifier` text, see below |
| `densityGPerMl` | `food_portion.csv` rows whose `modifier` is "fl oz", see below |
| `gramsPerPiece` | `food_portion.csv` rows whose `modifier` is exactly "piece", "slice" or "unit" |

Nutrients are resolved by `(nutrient_nbr, unit_name)` from `nutrient.csv`
at import time, never by a hardcoded row id - those ids are specific to one
dataset release. The energy nutrient in particular has both a KCAL row and
a kJ row under different `nutrient_nbr`s; picking the wrong one would
silently inflate every calorie figure roughly fourfold, so the script
asserts each of the five nutrients resolves before importing anything, and
fails loudly (naming which one) if it can't.

### The `measure_unit_id` trap - and how measures are actually recognised

`food_portion.csv` has a `measure_unit_id` column, and there's a
`measure_unit.csv` with proper names (`1000` cup, `1001` tablespoon, `1002`
teaspoon, ...) that it looks like you're supposed to join it to. **Don't.**
Verified against the full 2018-04 SR Legacy release: **every one of the
14,449 rows in `food_portion.csv` has `measure_unit_id = 9999`
("undetermined")**. SR Legacy never fills in the real unit id; joining to
`measure_unit.csv` silently returns nothing for every food, which is
exactly the bug this import used to have (7,793 foods, every measure null,
no error - just silently wrong).

The actual household measure is free text in the `modifier` column, e.g.
`cup`, `cup, chopped`, `cup (8 fl oz)`, `tbsp`, `fl oz`. `src/lib/usdaImport/portions.ts`
recognises a measure at the *start* of `modifier`, case-insensitively, with
a word-boundary check (so "cupcake" can never match "cup"): `cup`, `tbsp` /
`tablespoon(s)`, `tsp` / `teaspoon(s)`, `fl oz`. tbsp and tsp are matched as
distinct, separate entries - never derived from one another - so there's no
risk of a substring check confusing them.

### Which portion row wins

A food often has several rows in `food_portion.csv` for the same measure
(e.g. "cup", "cup, sliced", "cup, chopped" for almonds - these are
genuinely different weights, USDA does not mark one as canonical). The
script picks one, deterministically:

1. Prefer the **unqualified** modifier - exactly `cup` / `tbsp` /
   `tablespoon` / `tsp` / `teaspoon` / `fl oz`, with nothing appended.
2. Otherwise, the row with the **lowest `seq_num`** (USDA's own ordering,
   which lists the most typical portion first).

`gramsPerPiece` is derived from a small, deliberately conservative
allowlist of modifiers that denote exactly one countable item and nothing
else: **`piece`, `slice`, `unit`** (exact match, no qualifier). SR Legacy
also has modifiers like `serving`, `bar`, `steak`, `fillet`, `roast`,
`jar`, `package (1.76 oz)` that describe "one of something" for that
specific food but aren't a fixed, comparable unit - those are deliberately
excluded. That means many foods a human would call countable still get
`gramsPerPiece = null` (only 333 of 7,793 foods have it); a wrong piece
weight is worse than none.

`densityGPerMl` is derived from an explicit, unqualified `fl oz` row when
one exists: 1 US fluid ounce is exactly 29.5735 mL, so
`densityGPerMl = (gram_weight / amount) / 29.5735`. This gives a true
volume-to-weight relationship - the right source for milk, juice and oils -
and is preferred over guessing density from a cup weight (`gramsPerCup`
mixed with "cup (8 fl oz)"-style modifiers is not reliable enough to
derive density from at import time; `src/services/nutrition.ts` still has
a `gramsPerCup`-based density fallback for products with no `fl oz` row at
all, e.g. hand-entered ones).

`food_portion.amount` is sometimes more than 1 (e.g. a row meaning "2
tablespoons" with `gram_weight` = the weight of both), and is occasionally
`0` (7 of the 2,869 `cup`-prefixed rows in SR Legacy 2018-04). The script
divides `gram_weight` by `amount` to normalise to the weight of a single
unit, and treats an `amount` of zero, negative, or non-finite as "not
usable" rather than dividing by zero - that food's measure is left `null`
instead.

### Realistic expectations on measures

**Most SR Legacy foods have no cup/tablespoon/teaspoon measure at all.**
Of 7,793 foods, only 2,883 (37%) have any of the three, because SR Legacy
simply doesn't record a household-volume portion for most raw meats,
whole cuts, and many prepared dishes - it's not something this import can
recover, the data isn't there. Don't be surprised that `GET /products`
mostly returns `gramsPerCup: null` etc.; that null is correct, not a bug.

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
