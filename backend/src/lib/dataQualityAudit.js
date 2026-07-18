// Runtime data-quality audit — the Phase 2 guardrail wired into server
// startup. Same rules as scripts/auditFoodData.mjs (both defer to
// foodValidation.js); this one returns a compact summary instead of a full
// report file.
const { prisma } = require("./prisma.js");
const { validateFood, validateRecipe, findDuplicateGroups } = require("./foodValidation.js");
const { CATEGORY_SLUGS } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

async function runDataQualityAudit() {
  const exemptions = loadFoodOverrides();
  const foods = await prisma.food.findMany();
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });

  const foodFailures = [];
  for (const f of foods) {
    const { ok, issues } = validateFood(f, { exemptions, validCategories: CATEGORY_SLUGS });
    if (!ok) foodFailures.push({ name: f.name, issues: issues.map((i) => i.code) });
  }
  const duplicateGroups = findDuplicateGroups(foods).length;
  const recipeFailures = [];
  for (const r of recipes) {
    const { ok, issues } = validateRecipe(r);
    if (!ok) recipeFailures.push({ name: r.name, issues: issues.map((i) => i.code) });
  }

  return {
    foods: foods.length,
    recipes: recipes.length,
    foodFailures,
    recipeFailures,
    duplicateGroups,
    clean: foodFailures.length === 0 && recipeFailures.length === 0 && duplicateGroups === 0,
  };
}

module.exports = { runDataQualityAudit };
