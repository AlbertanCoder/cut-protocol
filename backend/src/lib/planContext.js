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
const { reconcileTarget } = require("./profileTarget.js");
const { recipeExcludedByStyle, matchesExclusionTerm, foodMatchesExclusionTerm, recipeExceedsKetoCeiling, additionalIngredientNames } = require("./dietaryFilter.js");

// The pool carries the diet style it was admitted under (solver-core-3).
// "Pool membership = compliance" is this codebase's invariant, but membership is
// decided at 1× while the solver ships PORTIONS — and its two-factor scaling can
// double a side's carbs. Stamping the style onto each recipe lets the post-scale
// keto ceiling in weeklyPlanner.enforceScaledCarbCeiling() re-check the shipped
// portion without every call site having to thread a profile down. Pure: the
// input rows are never mutated, and a null style stamps nothing.
function stampDietGuard(recipes, dietaryStyle) {
  if (!dietaryStyle) return recipes;
  return recipes.map((r) => (r.dietGuardStyle === dietaryStyle ? r : { ...r, dietGuardStyle: dietaryStyle }));
}

function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return stampDietGuard(recipePool.filter((recipe) => {
    // Shared keto ceiling — single-sourced in dietaryFilter so the library
    // listing (recipes.js) can never diverge from the solver pool (M8).
    if (recipeExceedsKetoCeiling(recipe, dietaryStyle)) return false;
    // Carry the WHOLE Food row, not just its name. Stripping to { name } here is
    // what made the persisted allergen metadata inert on the only path that
    // matters: fdcCategory / allergenTags / mayContain were written to the DB and
    // then thrown away one function before the matcher, so the four-probe union
    // degraded to a one-probe name check on every generated plan.
    const flatIngredients = recipe.ingredients.map((i) => i.food);
    // Defence-in-depth: fold in any "Add'l ingredients:" the importer left in the
    // step text but never turned into ingredient rows, so an allergen declared
    // only in prose (e.g. mayonnaise -> egg) can't slip past the filter.
    const addl = additionalIngredientNames(recipe.steps);
    // The recipe's own NAME is evidence and was read by nothing. A dish is
    // routinely named after an ingredient its rows omit — "Egg Drop Soup" has no
    // egg row, "Roasted Eggplant With Tahini, Pine Nuts" has no tahini row, and
    // "Cubano pork belly" carries only its marinade — so those reached egg-,
    // sesame- and pork-excluded plans respectively. Treating the title as one
    // more name to match is add-only: it can raise an exclusion, never clear one.
    const checkIngredients = [
      ...flatIngredients,
      ...addl.map((name) => ({ name })),
      { name: recipe.name || "" },
    ];
    if (recipeExcludedByStyle({ ingredients: checkIngredients }, dietaryStyle)) return false;
    // foodMatchesExclusionTerm, not matchesExclusionTerm: the former consults the
    // metadata probes as well as the name, and is the function the add-only union
    // was actually built for. Rows synthesised from prose/title carry only a name,
    // which it handles — absent metadata simply contributes no evidence.
    if (excludedFoods.length && checkIngredients.some((ing) => excludedFoods.some((term) => foodMatchesExclusionTerm(ing, term)))) return false;
    return true;
  }), dietaryStyle);
}

async function planContext(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("no profile set up yet"), { status: 404 });
  const weightNowKg = await getWeightNowKg(userId, profile);
  // adaptive-tdee-2: reconcile the cached Profile.targetKcal against the live
  // resolver before solving. This is the highest-stakes reader of that number —
  // a stale target here is a whole WEEK of meal plans built to the wrong
  // calorie goal, and the drift is invisible because the plan looks internally
  // consistent. The resolver is authoritative; the row is a cache.
  const reconciled = await reconcileTarget(userId, { profile, reason: "planContext" });
  const dailyTarget = computeMacros(profile, weightNowKg, reconciled.target);
  const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
  const rawRecipePool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const recipePool = filterRecipePool(rawRecipePool, profile);
  // T (v2): the user's SOFT taste ratings, as a Map for the solver's bias. A
  // soft re-rank only — hard diet/allergy filtering already happened above.
  const ratingRows = await prisma.recipeRating.findMany({ where: { userId }, select: { recipeId: true, rating: true } });
  const ratings = new Map(ratingRows.map((r) => [r.recipeId, r.rating]));
  return { profile, dailyTarget, mealConfig, recipePool, rawPoolCount: rawRecipePool.length, ratings };
}

// The generation filters the Phase 4 UI sends. Cuisine/protein/budget are
// soft biases; maxPrepMin is a hard cap; allowBatchRepeats relaxes the
// variety rule; proteinPriority (recomposition mode) makes the solver defend
// the protein floor instead of trading it off — see mealSolver.js's scoreDay/
// scoreWeek/diagnoseFromResult. Allergies/diet are NOT here — they come from
// the profile and are enforced in filterRecipePool, always.
function parseFilters(body) {
  const f = body?.filters || {};
  return {
    cuisines: Array.isArray(f.cuisines) ? f.cuisines.filter((c) => typeof c === "string").slice(0, 8) : [],
    protein: typeof f.protein === "string" && f.protein ? f.protein : null,
    budget: ["cheap", "moderate", "premium"].includes(f.budget) ? f.budget : null,
    maxPrepMin: Number.isInteger(f.maxPrepMin) && f.maxPrepMin > 0 ? f.maxPrepMin : null,
    allowBatchRepeats: f.allowBatchRepeats === true,
    proteinPriority: f.proteinPriority === true,
  };
}

module.exports = { planContext, filterRecipePool, parseFilters, stampDietGuard };
