// Recipe Brain — the ADHERENCE MATRIX: one façade over the dials the app
// already has, so every sourcing channel judges candidates the same way.
//
// NOTHING NEW IS INVENTED HERE. The five-filter system (allergy wall upstream;
// cost/time/complexity/taste caps + rank) lives in recipeCost.scoreRecipe/
// explainPool; the soft biases (cuisine ×3/×0.7, protein mention, budget tier,
// thumbs ratings) live in mealSolver.buildBias. This module only COMPOSES them
// into a single verdict per candidate — because a recipe brain that scored
// adherence with its own math would inevitably drift from the plan screen's,
// and then "the brain said it fits" and "the plan says it doesn't" would both
// be true. One matrix, one meaning, everywhere (M8's invariant, extended to
// sourcing).
//
// COMPOSITION LAW (inherited from recipeCost.js, restated because every
// channel routes through here):
//   • allergy/diet/macro walls are UPSTREAM and hard. A candidate reaching the
//     matrix is already wall-screened; the matrix cannot re-admit or weaken.
//   • caps are enforced only when SET; a cap that cannot be evaluated is
//     reported in `unevaluable`, never assumed passed.
//   • an emptied pool is EXPLAINED (binding constraint named, measured by
//     lifting one cap at a time), never papered over.
const { scoreRecipe, explainPool, buildCostCache } = require("../recipeCost.js");
const { buildBias } = require("../mealSolver.js");

/**
 * compileMatrix(filters, profile) -> the matrix in parseFilters vocabulary.
 * Filters win; profile soft prefs back-fill the dials the request left unset
 * (same precedence planContext-consuming routes already apply). Pure.
 */
function compileMatrix(filters = {}, profile = {}) {
  const posNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    // optional HARD caps (null = not set = not enforced)
    maxCostCad: posNum(filters.maxCostCad),
    maxPrepMin: posNum(filters.maxPrepMin) ?? posNum(profile.maxPrepMin),
    maxComplexity: Number.isInteger(filters.maxComplexity) ? filters.maxComplexity
      : Number.isInteger(profile.maxComplexity) ? profile.maxComplexity : null,
    minTaste: Number.isFinite(Number(filters.minTaste)) ? Number(filters.minTaste) : null,
    // SOFT biases (shape mealSolver.buildBias consumes)
    cuisines: Array.isArray(filters.cuisines) && filters.cuisines.length
      ? filters.cuisines
      : Array.isArray(profile.cuisinePreferences) ? profile.cuisinePreferences : [],
    protein: filters.protein ?? null,
    budget: filters.budget ?? profile.budgetTier ?? null,
    allowBatchRepeats: filters.allowBatchRepeats === true,
    proteinPriority: filters.proteinPriority === true,
  };
}

/** matrixFromSpec(spec) — the same dials, read back out of a RecipeSpec. */
function matrixFromSpec(spec = {}) {
  return {
    maxCostCad: spec.caps?.maxCostCad ?? null,
    maxPrepMin: spec.caps?.maxPrepMin ?? null,
    maxComplexity: spec.caps?.maxComplexity ?? null,
    minTaste: spec.caps?.minTaste ?? null,
    cuisines: spec.soft?.cuisines ?? [],
    protein: spec.soft?.protein ?? null,
    budget: spec.soft?.budget ?? null,
    allowBatchRepeats: spec.soft?.allowBatchRepeats === true,
    proteinPriority: false,
  };
}

// scoreRecipe prefs from a matrix (rename maxPrepMin -> maxTimeMin, thread
// ratings through for the taste term).
function capPrefs(matrix, ratings) {
  return {
    maxCostCad: matrix.maxCostCad,
    maxTimeMin: matrix.maxPrepMin,
    maxComplexity: matrix.maxComplexity,
    minTaste: matrix.minTaste,
    ratings: ratings ?? null,
  };
}

/**
 * judge(recipe, matrix, { ratings, costCache }) -> {
 *   gate,        // recipeCost.scoreRecipe result: caps verdict + rank + why
 *   bias,        // mealSolver.buildBias multiplier (soft prefs)
 *   adherence,   // gate.rank × normalised bias — the ONE ordering number
 *   passes,      // gate.passesHardCaps
 * }
 *
 * The bias multiplier is normalised into (0..1] by its own possible maximum so
 * a candidate can never BUY rank with soft-pref matches while failing a cap —
 * caps gate, bias orders. Deterministic and pure.
 */
const BIAS_MAX = 3 * 2.5 * 1.8 * 1.6; // ceiling of buildBias's stacked multipliers

// buildBias reads ratings from filters.ratings (a Map) and returns null when no
// soft pref is active — null means "no preference", i.e. every candidate weighs 1.
function biasFnFor(matrix, costCache, ratings) {
  const fn = buildBias({ ...matrix, ratings: ratings instanceof Map ? ratings : undefined }, costCache);
  return fn || (() => 1);
}

function judge(recipe, matrix, { ratings = null, costCache = null } = {}) {
  const gate = scoreRecipe(recipe, capPrefs(matrix, ratings));
  const bias = biasFnFor(matrix, costCache || buildCostCache([recipe]), ratings)(recipe);
  const adherence = Math.round(gate.rank * Math.min(1, bias / BIAS_MAX) * 10000) / 10000;
  return { gate, bias, adherence, passes: gate.passesHardCaps };
}

/**
 * rankPool(pool, matrix, { ratings }) -> {
 *   ordered,     // cap-passing candidates, best adherence first
 *   explain,     // recipeCost.explainPool result — the honest-fail evidence
 * }
 *
 * `explain` is computed on the SAME pool with the SAME caps, so when zero
 * candidates survive, the caller has the measured binding constraint in hand
 * and can say "your $3 cap removes 41 recipes" instead of "nothing found".
 */
function rankPool(pool = [], matrix = {}, { ratings = null } = {}) {
  const costCache = buildCostCache(pool);
  const explain = explainPool(pool, capPrefs(matrix, ratings));
  const biasFn = biasFnFor(matrix, costCache, ratings);
  const ordered = explain.scored
    .filter((x) => x.s.passesHardCaps)
    .map((x) => {
      const bias = biasFn(x.recipe);
      return { recipe: x.recipe, gate: x.s, bias, adherence: Math.round(x.s.rank * Math.min(1, bias / BIAS_MAX) * 10000) / 10000 };
    })
    .sort((a, b) => b.adherence - a.adherence || String(a.recipe.id).localeCompare(String(b.recipe.id)));
  return { ordered, explain };
}

module.exports = { compileMatrix, matrixFromSpec, judge, rankPool, BIAS_MAX };
