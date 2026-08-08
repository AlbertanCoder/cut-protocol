// Recipe Brain — channel 1: the LIBRARY. Free, instant, first.
//
// What this adds over mealRouter's library scan: the MATRIX. The router's scan
// finds the best kcal/protein fit; this channel finds the best kcal/protein fit
// AMONG the candidates that honour the user's dials (cost/time/complexity/
// taste caps) and prefers the ones matching the soft prefs (cuisine, protein,
// budget, ratings) — so a "cheap, fast, Mexican" request served from the
// library actually IS cheap, fast and Mexican when such a recipe exists, and
// says which cap emptied the pool when one doesn't.
//
// Pure and synchronous: pool in, verdict out. The pool MUST already be
// allergy/diet filtered (planContext.filterRecipePool) and slot-eligible
// (weeklyPlanner.eligibleRecipes) — this channel never re-implements walls.
const { rankPool, matrixFromSpec } = require("../matrix.js");
const { meetsDensityFloor } = require("../spec.js");
const { refit } = require("../tweak.js");

// How many matrix-ranked candidates get the (relatively) expensive refit
// treatment before the channel concedes. High enough that a fit exists in any
// healthy pool slice, low enough to stay instant on a 900-recipe library.
const MAX_REFIT_ATTEMPTS = 40;

/**
 * search({ spec, pool, ratings }, deps?) -> {
 *   hit:      { recipe, scaled, tweak, adherence, gate } | null,
 *   closest:  same shape | null,      // best miss, for honest degrade copy
 *   explain,  // matrix.rankPool's explainPool result (binding constraint etc.)
 *   attempts, // how many candidates were actually refit-tested
 *   skippedForDensity, // structurally-unable candidates screened out cheaply
 * }
 */
function search({ spec, pool = [], ratings = null } = {}, deps = {}) {
  const { refitImpl = refit } = deps;
  const matrix = matrixFromSpec(spec);
  const { ordered, explain } = rankPool(pool, matrix, { ratings });

  let hit = null;
  let closest = null;
  let attempts = 0;
  let skippedForDensity = 0;

  for (const cand of ordered) {
    if (attempts >= MAX_REFIT_ATTEMPTS) break;
    // Necessary-condition screen: a recipe whose best bundle sits under the
    // spec's density floor cannot pass the slot gate at any legal portion.
    // Skipping it here costs nothing and is provably safe (spec.js math).
    if (!meetsDensityFloor(cand.recipe, spec)) { skippedForDensity++; continue; }
    attempts++;
    const t = refitImpl(cand.recipe, spec);
    if (!t || !t.scaled) continue;
    const v = t.verdicts[t.method === "repartition" ? "repartition" : "twoFactor"];
    const entry = { recipe: cand.recipe, scaled: t.scaled, tweak: t, adherence: cand.adherence, gate: cand.gate, verdict: v };
    if (v && v.slotOk) { hit = entry; break; }
    if (!closest || (v && closest.verdict && v.quality < closest.verdict.quality)) closest = entry;
  }

  return { hit, closest, explain, attempts, skippedForDensity };
}

module.exports = { search, MAX_REFIT_ATTEMPTS };
