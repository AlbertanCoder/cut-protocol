// softScore.js — Brain v3 Stage G. Multi-constraint scoring: turns the Stage-E
// SOFT ConstraintSet into deterministic penalty terms so the planner can PREFER
// days that respect the user's prep-time / batch prefs — WITHOUT ever letting a
// soft pref override a HARD constraint (that's the verifier's job, upstream).
//
// LLM-proposed weights are clamped to [wMin,wMax] then applied by pure
// arithmetic — raw model weights are never used unclamped (LAW 1-adjacent).
// A soft constraint with NO per-recipe data to evaluate (budget, complexity —
// the schema has no cost/complexity column) is reported in noSignal[]: honestly
// skipped, never silently scored as "passed" (LAW 7).

const DEFAULT_SOFT_WEIGHTS = { time: 0.4, batch: 0.3, budget: 0.2, complexity: 0.1 };
const SOFT_WEIGHT_BOUNDS = { min: 0, max: 1 };

const cap = (x) => Math.min(1, Math.max(0, x));

function clampSoftWeights(proposed) {
  const w = { ...DEFAULT_SOFT_WEIGHTS };
  if (proposed && typeof proposed === "object") {
    for (const k of Object.keys(DEFAULT_SOFT_WEIGHTS)) {
      const v = Number(proposed[k]);
      if (Number.isFinite(v)) w[k] = Math.min(SOFT_WEIGHT_BOUNDS.max, Math.max(SOFT_WEIGHT_BOUNDS.min, v));
    }
  }
  return w;
}

// Fraction of repeated picks: 0 = all distinct, →1 = all identical.
function varietyPenalty(slots) {
  const ids = (slots || []).map((s) => s.recipeId).filter(Boolean);
  if (ids.length === 0) return 0;
  return 1 - new Set(ids).size / ids.length;
}

/**
 * scoreSoftConstraints(day, cs, ctx, opts) -> { cost, score, terms, weights, noSignal, prov }
 * day: { slots:[{ recipeId }] }.
 * cs:  a Stage-E ConstraintSet (compileConstraints output).
 * ctx: { recipeById: (id) => recipe|null } — used to read recipe.prepTimeMin.
 * Lower cost = better. Only ACTIVE soft constraints contribute; the ones with no
 * per-recipe data are listed in noSignal (never scored).
 */
function scoreSoftConstraints(day = {}, cs = {}, ctx = {}, opts = {}) {
  const slots = day.slots || [];
  const recipeById = typeof ctx.recipeById === "function" ? ctx.recipeById : () => null;
  const soft = cs.soft || {};
  const w = clampSoftWeights(opts.weights);
  const terms = {};
  const noSignal = [];

  // TIME — evaluable: recipe.prepTimeMin vs the profile's max prep.
  const maxPrep = soft.time?.value?.maxPrepMin;
  if (maxPrep != null) {
    const preps = slots
      .map((s) => recipeById(s.recipeId))
      .map((r) => (r && r.prepTimeMin != null && Number.isFinite(Number(r.prepTimeMin)) ? Number(r.prepTimeMin) : null))
      .filter((p) => p != null);
    if (preps.length === 0) noSignal.push("time");
    else terms.time = w.time * cap(preps.filter((p) => p > maxPrep).length / preps.length);
  }

  // BATCH — evaluable from the picks themselves: when batch-cooking is NOT
  // allowed, repeated recipes are penalised (they'd need re-cooking).
  if (soft.batch?.value?.allow === false) {
    terms.batch = w.batch * cap(varietyPenalty(slots));
  }

  // BUDGET / COMPLEXITY — no per-recipe cost or complexity column exists yet
  // (a later stage adds them). Report honestly rather than score a phantom pass.
  if (soft.budget?.value?.tier != null) noSignal.push("budget");
  if (soft.complexity?.value?.max != null) noSignal.push("complexity");

  const cost = Object.values(terms).reduce((a, b) => a + b, 0);
  return {
    cost,
    score: Math.max(0, 1 - cost),
    terms,
    weights: w,
    noSignal,
    prov: { formulaId: "scoreSoftConstraints", inputs: { active: Object.keys(terms), noSignal, weights: w }, value: cost },
  };
}

// Combine the base objective (scorer.scorePlan) with the soft-constraint penalty
// into one comparable cost. Kept separate from scorePlan so the hard-target
// scoring stays byte-identical and the soft layer is purely additive.
function totalCost(base = {}, soft = {}) {
  return (base.cost || 0) + (soft.cost || 0);
}

module.exports = { scoreSoftConstraints, clampSoftWeights, totalCost, DEFAULT_SOFT_WEIGHTS, SOFT_WEIGHT_BOUNDS };
