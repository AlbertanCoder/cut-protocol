// runSolve — take a generated profile, derive its targets through the REAL
// engine (no mocks), build the pool the same way routes/plans.js does, solve a
// full week, and return the solver's own outputs together with the inputs.
//
// This deliberately uses the exact call sequence POST /plans/generate uses:
//   computeEnergy -> deriveTarget -> computeMacros    (the target)
//   filterRecipePool -> applyPrepFilter               (the pool)
//   generateBestWeekPlan                              (the solve)
// so what the gauntlet grades is the shipping product, not a reimplementation.

import bmrPkg from "../../src/lib/bmrEngine.js";
import solverPkg from "../../src/lib/mealSolver.js";
import contextPkg from "../../src/lib/planContext.js";

// Determinism + ground-rule #1: the deterministic solver is the product being
// graded and it is FREE. The LLM critic must never fire inside the harness.
process.env.BRAIN = "off";

const { computeEnergy, deriveTarget, computeMacros, effectiveFloor } = bmrPkg;
const { generateBestWeekPlan, applyPrepFilter, buildBias } = solverPkg;
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
  const target = computeMacros(profile, weightKg, derived.target);

  // ── pool, the same two-stage narrowing the route applies ──────────────
  const afterDiet = filterRecipePool(rawPool, dietProfile);
  const pool = applyPrepFilter(afterDiet, filters.maxPrepMin ?? undefined);
  const counts = { raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: pool.length };

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
