// runSolve — take a generated profile, derive its targets through the REAL
// engine (no mocks), build the pool the same way routes/plans.js does, solve a
// full week, and return the solver's own outputs together with the inputs.
//
// This deliberately uses the exact call sequence POST /plans/generate uses:
//   computeEnergy -> deriveTarget -> computeMacros                 (the target)
//   filterRecipePool -> applyPrepFilter -> applyFilterStack        (the pool)
//   generateBestWeekPlan                                           (the solve)
// so what the gauntlet grades is the shipping product, not a reimplementation.
//
// K2c FIX (2026-08-01). applyFilterStack was missing from that sequence. It is
// the route's third and last pool-narrowing stage (routes/plans.js:277) and it
// enforces the Stage-3 optional hard caps maxCostCad / maxComplexity / minTaste.
// Omitting it does not skip a nicety — it means the harness and the product
// solve a DIFFERENT problem for any caller that sets one of those caps, so any
// day-paired comparison between this instrument and the route is invalid there.
// (mealSolver.js:47-50 makes the call a pass-through when all three are null, so
// for a caller that sets none of them — genProfile.mjs today — this is a no-op
// by construction. The point is that it no longer DEPENDS on that being true.)
// Measured on the 250-persona fleet, where caps ARE set: the stack narrows the
// pool for 32 personas, worst p039 152 -> 38 recipes (-75.0%), -4.18% of pooled
// recipe-slots. See docs/surgery/CAMPAIGN/solver-brain/A1/rig/poolGap.mjs, which
// re-measures it on demand rather than asking anyone to trust this comment.

import bmrPkg from "../../src/lib/bmrEngine.js";
import solverPkg from "../../src/lib/mealSolver.js";
import contextPkg from "../../src/lib/planContext.js";

// Determinism + ground-rule #1: the deterministic solver is the product being
// graded and it is FREE. The LLM critic must never fire inside the harness.
process.env.BRAIN = "off";

const { computeEnergy, deriveTarget, computeMacros, effectiveFloor } = bmrPkg;
const { generateBestWeekPlan, applyPrepFilter, applyFilterStack, buildBias } = solverPkg;
const { filterRecipePool } = contextPkg;

/**
 * @param gen      one object from genProfile()
 * @param rawPool  recipes with { ingredients: { food } } included (loaded once, shared)
 * @param rng      a seeded PRNG function (so the solve is reproducible)
 */
export async function runSolve(gen, rawPool, rng) {
  const { profile, weightKg, mealConfig, dietProfile, filters } = gen;

  // ── targets, through the real engine ──────────────────────────────────
  const energy = computeEnergy(profile, weightKg);
  const derived = deriveTarget(profile, energy.tdee, energy.rmr);
  const floor = effectiveFloor(profile, energy.rmr);
  const target = computeMacros(profile, weightKg, derived.target, floor);

  // ── pool, the same THREE-stage narrowing the route applies ────────────
  // `stackExplain` rides along in counts because classifyBinding (mealSolver.js:
  // 1085) reads it to name a cost/complexity cap as the binding constraint —
  // without it a cap that empties the pool gets reported as a prep-filter cut.
  const afterDiet = filterRecipePool(rawPool, dietProfile);
  const afterPrep = applyPrepFilter(afterDiet, filters.maxPrepMin ?? undefined);
  const { survivors: pool, explain: stackExplain } = applyFilterStack(afterPrep, filters, filters.ratings ?? null);
  const counts = {
    raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: afterPrep.length,
    afterStack: pool.length, stackExplain,
  };

  // ── solve one week ────────────────────────────────────────────────────
  const t0 = performance.now();
  let weekResult, crash = null;
  try {
    weekResult = await generateBestWeekPlan(target, mealConfig, pool, {
      rng,
      bias: buildBias(filters, null),
      allowBatchRepeats: false,
      filters,
      counts,
    });
  } catch (e) {
    crash = { message: String(e && e.message || e), stack: e && e.stack ? String(e.stack).split("\n").slice(0, 4).join(" | ") : null };
  }
  const solveMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    seed: gen.seed,
    corner: gen.corner,
    inputs: { profile, weightKg, mealConfig, dietProfile, filters },
    energy: { tdee: energy.tdee, rmr: energy.rmr },
    derived: { rate: derived.rate, deficit: derived.deficit, raw: derived.raw, target: derived.target, floor, floored: derived.floored },
    target, // full macro target object (kcal + protein/fat/carb bands)
    counts,
    solveMs,
    crash,
    // The solver's OWN reported plan. The oracle must re-derive everything below
    // from raw Food rows rather than trust these numbers.
    slots: crash ? [] : weekResult.slots,
    diagnosis: crash ? null : (weekResult.diagnosis ?? null),
    score: crash ? null : (weekResult.score ?? null),
    // The filtered pool the solver actually had, so the oracle can compute
    // feasibility bounds against the SAME availability the solver faced. mc.mjs
    // passes this to the oracle then drops it — it is never stored in results.
    _pool: pool,
  };
}
