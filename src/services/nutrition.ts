import { Unit } from '@prisma/client';
import { BadRequestError } from '../lib/errors';

const ML_PER_LITRE = 1000;
const ML_PER_CUP = 240;
const ML_PER_TABLESPOON = 15;
const ML_PER_TEASPOON = 5;

export interface NutritionPer100g {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sugarPer100g: number;
  densityGPerMl: number | null;
  gramsPerPiece: number | null;
  gramsPerCup: number | null;
  gramsPerTablespoon: number | null;
  gramsPerTeaspoon: number | null;
}

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
}

export interface IngredientAmount {
  quantity: number;
  unit: Unit;
  product: NutritionPer100g & { name: string };
}

/**
 * Converts an ingredient amount to grams.
 *
 * GRAM and KILOGRAM are exact conversions. PIECE requires gramsPerPiece.
 *
 * Volume units (CUP, TABLESPOON, TEASPOON, MILLILITRE, LITRE) resolve to a
 * gram weight in this order, falling through to the next rule only when the
 * previous one is unavailable, and refusing outright when none apply. A
 * single density is the wrong model for solids - a cup of whole almonds,
 * sliced almonds and flour all weigh different amounts per cup - so we
 * prefer USDA-style measured household weights and only fall back to
 * density (the correct model for true liquids) when no measured weight is
 * recorded:
 *   - CUP: gramsPerCup. Else densityGPerMl * 240 mL. Else refuse.
 *   - TABLESPOON: gramsPerTablespoon. Else gramsPerCup / 16. Else
 *     densityGPerMl * 15 mL. Else refuse.
 *   - TEASPOON: gramsPerTeaspoon. Else gramsPerTablespoon / 3. Else
 *     gramsPerCup / 48. Else densityGPerMl * 5 mL. Else refuse.
 *   - MILLILITRE / LITRE: densityGPerMl. Else a density derived from
 *     gramsPerCup / 240. Else refuse.
 *
 * Refusing means throwing BadRequestError, exactly like the PIECE branch
 * does for a missing gramsPerPiece: a 400 saying a product cannot be
 * measured this way is correct, a confidently wrong gram figure is not.
 *
 * @throws {BadRequestError} if quantity is negative or non-finite, if the unit is PIECE but the
 * product has no gramsPerPiece, if the unit is a volume unit the product cannot be converted for,
 * or if the unit is otherwise unrecognized.
 */
export function toGrams(quantity: number, unit: Unit, product: NutritionPer100g & { name: string }): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new BadRequestError(`Invalid quantity for product "${product.name}"`);
  }

  if (unit === Unit.GRAM) return quantity;
  if (unit === Unit.KILOGRAM) return quantity * 1000;

  if (unit === Unit.PIECE) {
    if (product.gramsPerPiece === null) {
      throw new BadRequestError(`Product "${product.name}" cannot be measured in pieces`);
    }
    return quantity * product.gramsPerPiece;
  }

  if (isVolumeUnit(unit)) {
    const gramsPerUnit = resolveGramsPerVolumeUnit(unit, product);
    if (gramsPerUnit === null) {
      throw new BadRequestError(`Product "${product.name}" cannot be measured by ${unit}`);
    }
    return quantity * gramsPerUnit;
  }

  throw new BadRequestError(`Unsupported unit "${unit}"`);
}

function isVolumeUnit(unit: Unit): boolean {
  return (
    unit === Unit.CUP ||
    unit === Unit.TABLESPOON ||
    unit === Unit.TEASPOON ||
    unit === Unit.MILLILITRE ||
    unit === Unit.LITRE
  );
}

/** Implements the fallback chain documented on {@link toGrams}. Returns null when nothing applies. */
function resolveGramsPerVolumeUnit(unit: Unit, product: NutritionPer100g): number | null {
  switch (unit) {
    case Unit.CUP:
      if (product.gramsPerCup !== null) return product.gramsPerCup;
      if (product.densityGPerMl !== null) return product.densityGPerMl * ML_PER_CUP;
      return null;
    case Unit.TABLESPOON:
      if (product.gramsPerTablespoon !== null) return product.gramsPerTablespoon;
      if (product.gramsPerCup !== null) return product.gramsPerCup / 16;
      if (product.densityGPerMl !== null) return product.densityGPerMl * ML_PER_TABLESPOON;
      return null;
    case Unit.TEASPOON:
      if (product.gramsPerTeaspoon !== null) return product.gramsPerTeaspoon;
      if (product.gramsPerTablespoon !== null) return product.gramsPerTablespoon / 3;
      if (product.gramsPerCup !== null) return product.gramsPerCup / 48;
      if (product.densityGPerMl !== null) return product.densityGPerMl * ML_PER_TEASPOON;
      return null;
    case Unit.MILLILITRE:
      return resolveDensity(product);
    case Unit.LITRE: {
      const density = resolveDensity(product);
      return density === null ? null : density * ML_PER_LITRE;
    }
    default:
      return null;
  }
}

/** densityGPerMl if set, else a density derived from gramsPerCup. Null when neither is known. */
function resolveDensity(product: NutritionPer100g): number | null {
  if (product.densityGPerMl !== null) return product.densityGPerMl;
  if (product.gramsPerCup !== null) return product.gramsPerCup / ML_PER_CUP;
  return null;
}

/** @throws {BadRequestError} see {@link toGrams}. */
export function ingredientNutrition(ingredient: IngredientAmount): Nutrition {
  const grams = toGrams(ingredient.quantity, ingredient.unit, ingredient.product);
  const factor = grams / 100;
  const { product } = ingredient;
  return {
    calories: product.caloriesPer100g * factor,
    protein: product.proteinPer100g * factor,
    carbs: product.carbsPer100g * factor,
    fat: product.fatPer100g * factor,
    sugar: product.sugarPer100g * factor,
  };
}

/**
 * Sums nutrition across every ingredient, rounding once at the end rather than per-ingredient
 * so intermediate rounding error cannot accumulate.
 * @throws {BadRequestError} see {@link toGrams}.
 */
export function recipeNutrition(ingredients: IngredientAmount[]): Nutrition {
  const total = ingredients.reduce<Nutrition>(
    (acc, ingredient) => {
      const value = ingredientNutrition(ingredient);
      return {
        calories: acc.calories + value.calories,
        protein: acc.protein + value.protein,
        carbs: acc.carbs + value.carbs,
        fat: acc.fat + value.fat,
        sugar: acc.sugar + value.sugar,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0 },
  );

  return round(total);
}

function round(nutrition: Nutrition): Nutrition {
  return {
    calories: Math.round(nutrition.calories * 10) / 10,
    protein: Math.round(nutrition.protein * 10) / 10,
    carbs: Math.round(nutrition.carbs * 10) / 10,
    fat: Math.round(nutrition.fat * 10) / 10,
    sugar: Math.round(nutrition.sugar * 10) / 10,
  };
}
