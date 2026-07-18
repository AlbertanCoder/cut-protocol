// Runtime data-quality audit — the Phase 2 guardrail wired into server
// startup. Same rules as scripts/auditFoodData.mjs (both defer to
// foodValidation.js); this one returns a compact summary instead of a full
// report file.
const { prisma } = require("./prisma.js");
const { validateFood, validateRecipe, findDuplicateGroups } = require("./foodValidation.js");
const { CATEGORY_SLUGS } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

// `injected` ({ foods, recipes }) is for unit testing; at runtime it's omitted
// and the library is read from the DB.
async function runDataQualityAudit(injected) {
  const exemptions = loadFoodOverrides();
  const foods = injected?.foods ?? await prisma.food.findMany();
  const recipes = injected?.recipes ?? await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });

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

  // Stage-C fix (#31): an EMPTY library must never read as "clean". A partial
  // template copy or a wrong-DB misconfiguration produces exactly foods:0 /
  // recipes:0 — the one guardrail that runs every boot has to be able to tell
  // "clean" apart from "uninitialized".
  const empty = foods.length === 0 || recipes.length === 0;
  return {
    foods: foods.length,
    recipes: recipes.length,
    foodFailures,
    recipeFailures,
    duplicateGroups,
    empty,
    clean: !empty && foodFailures.length === 0 && recipeFailures.length === 0 && duplicateGroups === 0,
  };
}

module.exports = { runDataQualityAudit };
