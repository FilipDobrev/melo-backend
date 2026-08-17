import { describe, expect, it } from 'vitest';
import { buildImportPlan } from '../plan';
import type { RequiredFile } from '../archive';

const foodCsv = [
  'fdc_id,data_type,description,food_category_id,publication_date',
  '1001,sr_legacy_food,"Apples, raw, with skin",9,2019-04-01',
  '1002,sr_legacy_food,"Soup, chicken, with rice",6,2019-04-01', // no portions, missing sugar
  '1003,survey_fndds_food,"Not SR Legacy",6,2019-04-01', // wrong data_type -> skipped
  '1004,sr_legacy_food,,6,2019-04-01', // blank description -> skipped
].join('\n');

const nutrientCsv = [
  'id,name,unit_name,nutrient_nbr,rank',
  '1008,Energy,KCAL,208,300',
  '1062,Energy,kJ,268,300',
  '1003,Protein,G,203,600',
  '1004,Total lipid (fat),G,204,800',
  '1005,"Carbohydrate, by difference",G,205,1100',
  '2000,"Sugars, total",G,269,1500',
].join('\n');

const foodNutrientCsv = [
  'id,fdc_id,nutrient_id,amount',
  '1,1001,1008,52',
  '2,1001,1003,0.3',
  '3,1001,1004,0.2',
  '4,1001,1005,13.8',
  '5,1001,2000,10.4',
  '6,1002,1008,86',
  '7,1002,1003,4.9',
  '8,1002,1004,2.5',
  '9,1002,1005,8.7',
  // no sugar row for fdc_id 1002 - genuinely absent from SR Legacy for many foods
].join('\n');

// measure_unit_id is 9999 ("undetermined") on every SR Legacy food_portion.csv row - verified
// against the real 2018-04 release - so the file below is unused by the importer but still
// required to exist, matching the real archive.
const measureUnitCsv = ['id,name', '1000,cup', '1001,tablespoon', '1002,teaspoon', '9999,undetermined'].join('\n');

const foodPortionCsv = [
  'id,fdc_id,seq_num,amount,measure_unit_id,portion_description,modifier,gram_weight',
  '1,1001,1,1,9999,,cup,109',
  '2,1001,2,1,9999,,piece,182',
].join('\n');

function fixtureFiles(): Record<RequiredFile, Buffer> {
  return {
    'food.csv': Buffer.from(foodCsv),
    'nutrient.csv': Buffer.from(nutrientCsv),
    'food_nutrient.csv': Buffer.from(foodNutrientCsv),
    'food_portion.csv': Buffer.from(foodPortionCsv),
    'measure_unit.csv': Buffer.from(measureUnitCsv),
  };
}

describe('buildImportPlan', () => {
  it('maps valid SR Legacy rows to products and skips the rest with reasons', () => {
    const plan = buildImportPlan(fixtureFiles());

    expect(plan.records).toHaveLength(2);
    expect(plan.summary.rowsRead).toBe(4);
    expect(plan.summary.skipped).toBe(2);
    expect(plan.summary.skippedReasons.some((r) => r.includes('data_type'))).toBe(true);
    expect(plan.summary.skippedReasons.some((r) => r.includes('blank description'))).toBe(true);
  });

  it('resolves calories from the KCAL row, never the kJ row', () => {
    const plan = buildImportPlan(fixtureFiles());
    const apple = plan.records.find((r) => r.externalId === '1001');
    expect(apple?.caloriesPer100g).toBe(52);
  });

  it('carries cup and piece portions for the food that has them, and nulls for the food that does not', () => {
    const plan = buildImportPlan(fixtureFiles());
    const apple = plan.records.find((r) => r.externalId === '1001');
    const soup = plan.records.find((r) => r.externalId === '1002');

    expect(apple).toMatchObject({ gramsPerCup: 109, gramsPerPiece: 182, gramsPerTablespoon: null, gramsPerTeaspoon: null });
    expect(soup).toMatchObject({ gramsPerCup: null, gramsPerTablespoon: null, gramsPerTeaspoon: null, gramsPerPiece: null });
  });

  it('defaults a missing sugar value to 0 and counts it', () => {
    const plan = buildImportPlan(fixtureFiles());
    const soup = plan.records.find((r) => r.externalId === '1002');

    expect(soup?.sugarPer100g).toBe(0);
    expect(plan.summary.missingNutrientCounts.sugar).toBe(1);
    expect(plan.summary.missingNutrientCounts.calories).toBe(0);
  });

  it('throws when nutrient.csv cannot resolve a required nutrient', () => {
    const files = fixtureFiles();
    files['nutrient.csv'] = Buffer.from(nutrientCsv.split('\n').filter((line) => !line.includes('269')).join('\n'));
    expect(() => buildImportPlan(files)).toThrow(/Total sugars/);
  });

  it('throws naming the file and column when food.csv is missing a required column', () => {
    const files = fixtureFiles();
    files['food.csv'] = Buffer.from('fdc_id,data_type\n1001,sr_legacy_food\n');
    expect(() => buildImportPlan(files)).toThrow(/food\.csv.*description/s);
  });
});
