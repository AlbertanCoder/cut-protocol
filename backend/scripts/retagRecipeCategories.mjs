// Re-tag every recipe's Recipe.mealCategory from the shared, unit-tested
// classifier (src/lib/recipeClassification.js) — DRY RUN BY DEFAULT.
//
// WHY: ~602 recipes were bulk-imported as slotType:"meal" with mealCategory
// left null, so ~128 desserts (Churros, Krispy Kreme Donut, cheesecakes…)
// are eligible to fill a lunch/dinner slot. This script sets mealCategory so
// weeklyPlanner.js's eligibleRecipes() can exclude them from main meal slots.
// Full analysis: docs/audit/04-recipe-curation-report.md.
//
// SUPERSEDES the inline classifier in scripts/curateRecipeCategories.js:
// that older script's keyword tables lived in the script itself and could
// only see name+ingredients (DB rows carry no source tags). This script uses
// the extracted module AND recovers TheMealDB's own "dessert"/"breakfast"
// tags by looking each recipe up by name in recipeLibrary.mjs — which lifts
// dessert recall from ~100 to ~128 on the imported pool.
//
// SAFE BY DESIGN:
//   * Dry run unless BOTH --apply and --confirm are passed.
//   * Refuses to write until the mealCategory column exists (probes for it).
//   * Only ever FILLS a NULL mealCategory. It never overwrites an existing
//     non-null value — so human decisions (scripts/applyAmbiguousOverrides.js)
//     and any prior tagging are preserved. Disagreements between an existing
//     value and the classifier are REPORTED, never silently changed.
//   * Skips recipes the classifier flags needsReview (ambiguous) — those are
//     left for a human, same "don't guess" discipline as the classifier.
//   * Idempotent: re-running after an apply changes nothing.
//
// USAGE (run from backend/ on a machine with a real DB):
//   node scripts/retagRecipeCategories.mjs                    # dry run (default)
//   node scripts/retagRecipeCategories.mjs --apply            # refuses (needs --confirm)
//   node scripts/retagRecipeCategories.mjs --apply --confirm  # writes NULL mealCategory rows
//   node scripts/retagRecipeCategories.mjs --apply --confirm --overwrite
//                       # ALSO overwrites existing non-null values with the
//                       # classifier's verdict (use only to re-baseline after
//                       # reviewing the reported disagreements)

import "dotenv/config";
import { createRequire } from "module";
import prismaPkg from "../src/lib/prisma.js";
import { RECIPES } from "../src/lib/portedFromRecomp/recipeLibrary.mjs";

const require = createRequire(import.meta.url);
const { classifyRecipe } = require("../src/lib/recipeClassification.js");
const { prisma } = prismaPkg;

function summarize(label, rows) {
  const byCat = {};
  for (const r of rows) byCat[r.newCategory] = (byCat[r.newCategory] || 0) + 1;
  console.log(`\n=== ${label} ===`);
  console.table(byCat);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm");
  const overwrite = process.argv.includes("--overwrite");

  // Source-tag recovery: DB rows do not carry TheMealDB's tags, so look them
  // up by name from the seed library. Recipes not in the library (curated /
  // AI-generated) simply get name+ingredient+macro classification.
  const tagsByName = new Map();
  for (const r of RECIPES) tagsByName.set(r.name, r.tags || []);

  const recipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
  });
  console.log(`Loaded ${recipes.length} recipes from the DB.`);
  console.log(`Source-tag library: ${tagsByName.size} names available for tag lookup.`);

  const classified = recipes.map((r) => {
    const result = classifyRecipe({
      name: r.name,
      ingredients: r.ingredients, // { food: { name }, role } — accepted natively
      kcal: r.kcal,
      protein: r.protein,
      carb: r.carb,
      fat: r.fat,
      sourceTags: tagsByName.get(r.name), // undefined for non-imported recipes
    });
    return { recipe: r, ...result, newCategory: result.mealCategory };
  });

  // Overall classification breakdown (what everything WOULD be).
  const catCounts = {};
  for (const c of classified) catCounts[c.category] = (catCounts[c.category] || 0) + 1;
  console.log("\n=== Classification of the full pool ===");
  console.table(catCounts);

  const excluded = classified.filter((c) => !c.mealSlotEligible);
  console.log(`Would be EXCLUDED from main-meal slots: ${excluded.length} (dessert/beverage/bread-side/condiment).`);

  // Partition the write set.
  const review = classified.filter((c) => c.needsReview);
  const confident = classified.filter((c) => !c.needsReview);

  const toFill = confident.filter((c) => c.recipe.mealCategory == null && c.newCategory != null);
  const disagreements = confident.filter(
    (c) => c.recipe.mealCategory != null && c.recipe.mealCategory !== c.newCategory
  );
  const alreadyCorrect = confident.filter((c) => c.recipe.mealCategory != null && c.recipe.mealCategory === c.newCategory);

  console.log(`\nCurrently null mealCategory: ${classified.filter((c) => c.recipe.mealCategory == null).length}`);
  console.log(`Already tagged (non-null): ${classified.filter((c) => c.recipe.mealCategory != null).length}`);
  console.log(`  - of those, already matching the classifier: ${alreadyCorrect.length}`);
  console.log(`  - of those, DISAGREEING with the classifier: ${disagreements.length}`);

  summarize("WOULD FILL (null → category)", toFill.filter((c) => c.newCategory != null));

  const toFillTagged = toFill.filter((c) => c.newCategory != null);
  console.log(`\n${toFillTagged.length} recipes have a null mealCategory that would be set:`);
  for (const c of toFillTagged.slice(0, 40)) {
    console.log(`   SET mealCategory='${c.newCategory}'  ·  ${c.recipe.name}  (${c.reason})`);
  }
  if (toFillTagged.length > 40) console.log(`   … and ${toFillTagged.length - 40} more.`);

  if (disagreements.length) {
    console.log(`\n=== DISAGREEMENTS (existing value ≠ classifier) — NOT changed unless --overwrite ===`);
    for (const c of disagreements) {
      console.log(`   "${c.recipe.name}": DB='${c.recipe.mealCategory}' vs classifier='${c.newCategory ?? "null"}'  (${c.reason})`);
    }
  }

  console.log(`\n=== FLAGGED needsReview (${review.length}) — never auto-written ===`);
  for (const c of review) console.log(`   - ${c.recipe.name}  [DB mealCategory=${c.recipe.mealCategory ?? "null"}]  ${c.reason}`);

  // ---- write path ----
  if (!apply) {
    console.log("\nDry run complete. No writes. Pass --apply --confirm to fill null mealCategory values.");
    return;
  }
  if (!confirmed) {
    console.log("\n--apply passed without --confirm. Refusing to write. Re-run with both flags if you mean it.");
    return;
  }
  try {
    await prisma.recipe.findFirst({ select: { mealCategory: true } });
  } catch {
    console.log("\nRefusing to write: Recipe.mealCategory does not exist in this DB yet.");
    console.log("Run `npx prisma migrate deploy` (migration 20260717192648_add_recipe_meal_category) first.");
    return;
  }

  const writeSet = overwrite
    ? confident.filter((c) => c.recipe.mealCategory !== c.newCategory)
    : toFill;

  let written = 0;
  for (const c of writeSet) {
    await prisma.recipe.update({ where: { id: c.recipe.id }, data: { mealCategory: c.newCategory } });
    written++;
  }
  console.log(`\nWrote mealCategory to ${written} recipes${overwrite ? " (overwrite mode)" : " (null-fill only)"}.`);
  console.log(`Left ${review.length} needsReview recipes untouched.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
