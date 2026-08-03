// A1/rig/personas.mjs — THE persona loader for the rig. Extracted from
// runRig.mjs so runRig, poolGap and any future instrument load the fleet
// through ONE function and cannot drift apart by hand-rolling the mapping.
//
// K2c FIX. The `filters` object handed to the solver is now built by the
// product's own planContext.parseFilters — the same call routes/plans.js:264
// makes on the request body — instead of by a hand-rolled literal. The
// hand-rolled version never copied the Stage-3 optional hard caps
// (maxCostCad / maxComplexity / minTaste) out of personas.jsonl, so
// mealSolver.applyFilterStack could only ever be a pass-through
// (mealSolver.js:47-50 returns the pool untouched when all three are null) even
// once the rig started calling it. Using parseFilters means there is no second
// vocabulary to keep in sync: a cap the route learns to honour, the rig honours
// on the same day.
//
// The switch is a STRICT SUPERSET — verified, not asserted. poolGap.mjs
// compares parseFilters' output against rigLegacyFilters() field by field
// across all 250 personas and fails the run if anything but the three cap
// fields moved.
//
// IMPORTANT — DB ISOLATION. planContext.js requires prisma at module load, so
// parseFilters is required LAZILY inside loadPersonas(). Importing this module
// must never open a database; callers run prepareAgentDb() first.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { REPO } from "./dbcopy.mjs";

const require = createRequire(import.meta.url);

export const PERSONAS_PATH = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");

/**
 * runRig.loadPersonas' filter literal EXACTLY as it stood before the K2c fix.
 * Kept so the defect can be re-measured on demand rather than described. It is
 * the "before" arm of poolGap.mjs; nothing else should call it.
 */
export function rigLegacyFilters(p) {
  return {
    cuisines: p.filters?.cuisines || [], protein: null,
    budget: p.filters?.budget ?? null, maxPrepMin: p.filters?.maxPrepMin ?? null,
    allowBatchRepeats: false, proteinPriority: !!p.filters?.proteinPriority,
  };
}

/**
 * Load the 250-persona fleet in the shape every rig instrument consumes.
 * @param {object} [opts]
 * @param {string} [opts.file]  override the personas.jsonl path
 * @returns {Array} customers, each carrying `_raw` (the source row) so an
 *                  instrument can re-derive anything this mapping dropped.
 */
export function loadPersonas(opts = {}) {
  // Lazy: see the DB-isolation note above.
  const { parseFilters } = require(path.resolve(REPO, "backend/src/lib/planContext.js"));
  const file = opts.file ? path.resolve(opts.file) : PERSONAS_PATH;
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  return rows.map((p) => {
    const pr = p.profile;
    // The route validates the request body; the rig's personas.jsonl IS that
    // body's `filters`. Same parser, same coercions, same rejections.
    const filters = parseFilters({ filters: p.filters || {} });
    const profile = {
      sex: pr.sex, age: pr.age, heightCm: pr.heightCm,
      bodyFatPct: pr.bodyFatPct ?? 0,
      occupationKey: pr.occupationKey, activityOverride: null,
      sessionsPerWeek: pr.sessionsPerWeek, trainingStyle: pr.trainingStyle,
      minutesPerSession: pr.minutesPerSession,
      rateLbPerWeek: pr.rateLbPerWeek, floorKcal: pr.floorKcal ?? null,
      excludedFormulas: [],
      unitPref: pr.unitPref, startWeightKg: pr.startWeightKg, goalWeightKg: pr.goalWeightKg,
      rateAcknowledged: true,
      dietaryStyle: pr.dietaryStyle && pr.dietaryStyle !== "none" ? pr.dietaryStyle : null,
      mealsPerDay: pr.mealsPerDay, snacksPerDay: pr.snacksPerDay,
      excludedFoods: pr.excludedFoods || [],
      cuisinePreferences: filters.cuisines,
      maxPrepMin: filters.maxPrepMin,
      budgetTier: filters.budget,
      // K2c: was hard-coded null, which silently disagreed with the persona's
      // own maxComplexity for the 17 personas that set one.
      allowBatch: false, maxComplexity: filters.maxComplexity, adaptiveTdee: true,
      proteinPriorityMode: !!filters.proteinPriority,
    };
    return {
      id: p.id, idx: p.idx, tier: p.tier,
      // BRIEF.md's denominator rule: IMPOSSIBLE personas are engineered to be
      // unsatisfiable — correct output is a refusal. A3 owns auditing that tier;
      // until A3 says otherwise this is the split every agent uses.
      satisfiable: p.tier !== "IMPOSSIBLE",
      profile, weightKg: pr.startWeightKg,
      mealConfig: { meals: pr.mealsPerDay, snacks: pr.snacksPerDay },
      dietProfile: { dietaryStyle: profile.dietaryStyle, excludedFoods: profile.excludedFoods },
      filters,
      horizonKey: p.horizon || "week",
      _raw: p,
    };
  });
}
