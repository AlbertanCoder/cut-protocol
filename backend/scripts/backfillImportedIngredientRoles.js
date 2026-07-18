// One-time data backfill: every RecipeIngredient imported from recomp-v2
// (source: "themealdb-import", via seedRecipesFromRecomp.mjs) was seeded
// with role: null, because recomp-v2's recipe data has no per-ingredient
// role field to carry over. That silently defeats weeklyPlanner.js's
// scaleRecipe() - it filters ingredients for role === "protein" to scale
// protein separately from the rest of the dish (the whole reason this
// solver exists over a single-factor scale, per its own header comment:
// "single-factor scaling was landing 15-25g/day under the protein floor").
// With role universally null, all 602 imported recipes (96% of the pool)
// were silently falling back to naive uniform scaling instead.
//
// Fix: backfill role from each ingredient's already-categorized Food row
// (Food.category was set at seed time by the same seed script). Recipes
// with no protein-category ingredient at all (~31% of imports - genuine
// sides/desserts/etc.) correctly keep role: null and correctly keep using
// the uniform-scale fallback - that's not a bug, that's the intended
// behavior for a recipe with nothing protein-role-separable.
require("dotenv/config");
const { prisma } = require("../src/lib/prisma.js");

const CATEGORY_TO_ROLE = { protein: "protein", carb: "carb", veg: "veg", fat: "fat" };
// dairy/other have no matching role bucket in the schema (role is
// "protein"|"carb"|"veg"|"fat"|null) - left null, matching the existing
// convention for informational-only role data.

async function main() {
  const rows = await prisma.recipeIngredient.findMany({
    where: { recipe: { source: "themealdb-import" } },
    include: { food: true },
  });

  let updated = 0;
  for (const row of rows) {
    const role = CATEGORY_TO_ROLE[row.food.category] ?? null;
    if (role === row.role) continue; // already correct (e.g. already null and staying null)
    await prisma.recipeIngredient.update({ where: { id: row.id }, data: { role } });
    updated++;
  }
  console.log(`Backfilled role on ${updated} of ${rows.length} imported ingredient rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
