import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/// Fixed, seeded category list. Users assign categories to recipes but
/// never create new ones, so this is the single source of truth for slugs.
const categories: Array<{ slug: string; name: string }> = [
  { slug: 'breakfast', name: 'Breakfast' },
  { slug: 'lunch', name: 'Lunch' },
  { slug: 'dinner', name: 'Dinner' },
  { slug: 'dessert', name: 'Dessert' },
  { slug: 'snack', name: 'Snack' },
  { slug: 'appetizer', name: 'Appetizer' },
  { slug: 'soup', name: 'Soup' },
  { slug: 'salad', name: 'Salad' },
  { slug: 'vegan', name: 'Vegan' },
  { slug: 'vegetarian', name: 'Vegetarian' },
  { slug: 'gluten-free', name: 'Gluten-Free' },
  { slug: 'high-protein', name: 'High-Protein' },
  { slug: 'low-carb', name: 'Low-Carb' },
  { slug: 'quick-easy', name: 'Quick & Easy' },
  { slug: 'baking', name: 'Baking' },
  { slug: 'drink', name: 'Drink' },
  { slug: 'seafood', name: 'Seafood' },
  { slug: 'pasta', name: 'Pasta' },
  // Cuisines
  { slug: 'greek', name: 'Greek' },
  { slug: 'asian', name: 'Asian' },
  { slug: 'chinese', name: 'Chinese' },
  { slug: 'japanese', name: 'Japanese' },
  { slug: 'italian', name: 'Italian' },
  { slug: 'indian', name: 'Indian' },
  { slug: 'thai', name: 'Thai' },
  { slug: 'mexican', name: 'Mexican' },
  { slug: 'mediterranean', name: 'Mediterranean' },
  { slug: 'korean', name: 'Korean' },
  { slug: 'french', name: 'French' },
  { slug: 'spanish', name: 'Spanish' },
  { slug: 'middle-eastern', name: 'Middle Eastern' },
  // Diets
  { slug: 'keto', name: 'Keto' },
  { slug: 'pescatarian', name: 'Pescatarian' },
  { slug: 'paleo', name: 'Paleo' },
  { slug: 'dairy-free', name: 'Dairy-Free' },
];

/// Nutrition is per 100 g, taken from typical USDA reference values.
/// densityGPerMl is set for liquids and semi-liquids so volume units
/// (mL, L, cup, tbsp, tsp) convert correctly; gramsPerPiece is set for
/// countable items so the PIECE unit works. Both are omitted (undefined ->
/// null) when the product cannot be measured that way.
interface ProductSeed {
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sugarPer100g: number;
  densityGPerMl?: number;
  gramsPerPiece?: number;
}

const products: ProductSeed[] = [
  { name: 'Chicken breast, raw', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, sugarPer100g: 0 },
  { name: 'Egg', caloriesPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, sugarPer100g: 0.4, gramsPerPiece: 50 },
  { name: 'Whole milk', caloriesPer100g: 61, proteinPer100g: 3.2, carbsPer100g: 4.8, fatPer100g: 3.3, sugarPer100g: 5.1, densityGPerMl: 1.03 },
  { name: 'Olive oil', caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100, sugarPer100g: 0, densityGPerMl: 0.91 },
  { name: 'White rice, cooked', caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28.2, fatPer100g: 0.3, sugarPer100g: 0.1 },
  { name: 'Rolled oats', caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66.3, fatPer100g: 6.9, sugarPer100g: 0.99 },
  { name: 'Banana', caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 22.8, fatPer100g: 0.3, sugarPer100g: 12.2, gramsPerPiece: 118 },
  { name: 'Apple', caloriesPer100g: 52, proteinPer100g: 0.3, carbsPer100g: 13.8, fatPer100g: 0.2, sugarPer100g: 10.4, gramsPerPiece: 182 },
  { name: 'Broccoli', caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 6.6, fatPer100g: 0.4, sugarPer100g: 1.7 },
  { name: 'Salmon fillet', caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, sugarPer100g: 0 },
  { name: 'Ground beef 80/20', caloriesPer100g: 254, proteinPer100g: 17, carbsPer100g: 0, fatPer100g: 20, sugarPer100g: 0 },
  { name: 'Cheddar cheese', caloriesPer100g: 403, proteinPer100g: 25, carbsPer100g: 1.3, fatPer100g: 33, sugarPer100g: 0.5 },
  { name: 'Butter', caloriesPer100g: 717, proteinPer100g: 0.9, carbsPer100g: 0.1, fatPer100g: 81.1, sugarPer100g: 0.1, densityGPerMl: 0.911 },
  { name: 'All-purpose flour', caloriesPer100g: 364, proteinPer100g: 10.3, carbsPer100g: 76.3, fatPer100g: 1, sugarPer100g: 0.3 },
  { name: 'Granulated sugar', caloriesPer100g: 387, proteinPer100g: 0, carbsPer100g: 100, fatPer100g: 0, sugarPer100g: 100 },
  { name: 'Water', caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, sugarPer100g: 0, densityGPerMl: 1.0 },
  { name: 'Tomato', caloriesPer100g: 18, proteinPer100g: 0.9, carbsPer100g: 3.9, fatPer100g: 0.2, sugarPer100g: 2.6, gramsPerPiece: 123 },
  { name: 'Onion', caloriesPer100g: 40, proteinPer100g: 1.1, carbsPer100g: 9.3, fatPer100g: 0.1, sugarPer100g: 4.2, gramsPerPiece: 110 },
  { name: 'Garlic', caloriesPer100g: 149, proteinPer100g: 6.4, carbsPer100g: 33.1, fatPer100g: 0.5, sugarPer100g: 1, gramsPerPiece: 3 },
  { name: 'White bread, slice', caloriesPer100g: 265, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3.2, sugarPer100g: 5, gramsPerPiece: 30 },
  { name: 'Spaghetti, dry', caloriesPer100g: 371, proteinPer100g: 13, carbsPer100g: 74.7, fatPer100g: 1.5, sugarPer100g: 2.7 },
  { name: 'Black beans, cooked', caloriesPer100g: 132, proteinPer100g: 8.9, carbsPer100g: 23.7, fatPer100g: 0.5, sugarPer100g: 0.3 },
  { name: 'Greek yogurt, plain', caloriesPer100g: 59, proteinPer100g: 10, carbsPer100g: 3.6, fatPer100g: 0.4, sugarPer100g: 3.6, densityGPerMl: 1.03 },
  { name: 'Avocado', caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 8.5, fatPer100g: 14.7, sugarPer100g: 0.7, gramsPerPiece: 200 },
  { name: 'Honey', caloriesPer100g: 304, proteinPer100g: 0.3, carbsPer100g: 82.4, fatPer100g: 0, sugarPer100g: 82, densityGPerMl: 1.42 },
  { name: 'Almonds', caloriesPer100g: 579, proteinPer100g: 21.2, carbsPer100g: 21.6, fatPer100g: 49.9, sugarPer100g: 4.2 },
  { name: 'Potato', caloriesPer100g: 77, proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0.1, sugarPer100g: 0.8, gramsPerPiece: 173 },
];

const SEED_SOURCE = 'seed';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
  }

  // Seeded products are identified by (source, externalId) so a later bulk
  // import from an external dataset never collides with them.
  for (const product of products) {
    await prisma.product.upsert({
      where: { source_externalId: { source: SEED_SOURCE, externalId: slugify(product.name) } },
      update: {
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g,
        carbsPer100g: product.carbsPer100g,
        fatPer100g: product.fatPer100g,
        sugarPer100g: product.sugarPer100g,
        densityGPerMl: product.densityGPerMl ?? null,
        gramsPerPiece: product.gramsPerPiece ?? null,
      },
      create: {
        name: product.name,
        source: SEED_SOURCE,
        externalId: slugify(product.name),
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g,
        carbsPer100g: product.carbsPer100g,
        fatPer100g: product.fatPer100g,
        sugarPer100g: product.sugarPer100g,
        densityGPerMl: product.densityGPerMl ?? null,
        gramsPerPiece: product.gramsPerPiece ?? null,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${categories.length} categories and ${products.length} products.`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
