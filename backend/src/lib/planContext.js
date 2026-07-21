// Shared plan CONTEXT builder — the single source of the solver's recipe pool.
// Extracted from routes/plans.js (Stage 1, v2) so the brain's chat planner and
// every /plans route build the SAME exclusion-filtered pool. The M8 invariant
// (the recipe LISTING and the solver POOL can never diverge) depends on this
// staying single-sourced: exclusions are computed HERE, in code, from the
// authoritative profile only — never from LLM output, memory, or free text
// (LAW 2). No behavior change from the in-route originals; verbatim move.
const { prisma } = require("./prisma.js");
const { computeMacros } = require("./bmrEngine.js");
const { getWeightNowKg } = require("./weightNow.js");
const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling } = require("./dietaryFilter.js");

function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return recipePool.filter((recipe) => {
    // Shared keto ceiling — single-sourced in dietaryFilter so the library
    // listing (recipes.js) can never diverge from the solver pool (M8).
    if (recipeExceedsKetoCeiling(recipe, dietaryStyle)) return false;
    const flatIngredients = recipe.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flatIngredients }, dietaryStyle)) return false;
    if (excludedFoods.length && flatIngredients.some((ing) => excludedFoods.some((term) => matchesExclusionTerm(ing.name, term)))) return false;
    return true;
  });
}

async function planContext(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("no profile set up yet"), { status: 404 });
  const weightNowKg = await getWeightNowKg(userId, profile);
  const dailyTarget = computeMacros(profile, weightNowKg, profile.targetKcal);
  const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
  const rawRecipePool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const recipePool = filterRecipePool(rawRecipePool, profile);
  return { profile, dailyTarget, mealConfig, recipePool, rawPoolCount: rawRecipePool.length };
}

// The generation filters the Phase 4 UI sends. Cuisine/protein/budget are
// soft biases; maxPrepMin is a hard cap; allowBatchRepeats relaxes the
// variety rule. Allergies/diet are NOT here — they come from the profile
// and are enforced in filterRecipePool, always.
function parseFilters(body) {
  const f = body?.filters || {};
  return {
    cuisines: Array.isArray(f.cuisines) ? f.cuisines.filter((c) => typeof c === "string").slice(0, 8) : [],
    protein: typeof f.protein === "string" && f.protein ? f.protein : null,
    budget: ["cheap", "moderate", "premium"].includes(f.budget) ? f.budget : null,
    maxPrepMin: Number.isInteger(f.maxPrepMin) && f.maxPrepMin > 0 ? f.maxPrepMin : null,
    allowBatchRepeats: f.allowBatchRepeats === true,
  };
}

module.exports = { planContext, filterRecipePool, parseFilters };
