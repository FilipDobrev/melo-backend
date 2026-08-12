import { Unit } from '@prisma/client';
import { BadRequestError } from '../lib/errors';

/// Volume units expressed in millilitres. US customary measures.
const MILLILITRES_PER_UNIT: Partial<Record<Unit, number>> = {
  [Unit.MILLILITRE]: 1,
  [Unit.LITRE]: 1000,
  [Unit.CUP]: 240,
  [Unit.TABLESPOON]: 15,
  [Unit.TEASPOON]: 5,
};

export interface NutritionPer100g {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  densityGPerMl: number | null;
  gramsPerPiece: number | null;
}

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface IngredientAmount {
  quantity: number;
  unit: Unit;
  product: NutritionPer100g & { name: string };
}

/// Converts an ingredient amount to grams. Volume conversion assumes the
/// density of water when the product does not define one, which is accurate
/// for liquids and a documented approximation elsewhere.
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

  const millilitres = MILLILITRES_PER_UNIT[unit];
  if (millilitres === undefined) {
    throw new BadRequestError(`Unsupported unit "${unit}"`);
  }
  const density = product.densityGPerMl ?? 1;
  return quantity * millilitres * density;
}

export function ingredientNutrition(ingredient: IngredientAmount): Nutrition {
  const grams = toGrams(ingredient.quantity, ingredient.unit, ingredient.product);
  const factor = grams / 100;
  const { product } = ingredient;
  return {
    calories: product.caloriesPer100g * factor,
    protein: product.proteinPer100g * factor,
    carbs: product.carbsPer100g * factor,
    fat: product.fatPer100g * factor,
  };
}

export function recipeNutrition(ingredients: IngredientAmount[]): Nutrition {
  const total = ingredients.reduce<Nutrition>(
    (acc, ingredient) => {
      const value = ingredientNutrition(ingredient);
      return {
        calories: acc.calories + value.calories,
        protein: acc.protein + value.protein,
        carbs: acc.carbs + value.carbs,
        fat: acc.fat + value.fat,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return round(total);
}

function round(nutrition: Nutrition): Nutrition {
  return {
    calories: Math.round(nutrition.calories * 10) / 10,
    protein: Math.round(nutrition.protein * 10) / 10,
    carbs: Math.round(nutrition.carbs * 10) / 10,
    fat: Math.round(nutrition.fat * 10) / 10,
  };
}
