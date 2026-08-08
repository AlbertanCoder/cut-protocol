// Recipe Brain — the RECIPE SPEC: the contract every sourcing channel builds to.
//
// WHAT THIS IS. The solver brain knows WHEN a day misses (dayTolerance) and the
// portion brain knows HOW MUCH of a dish to serve (scaleRecipe/solvePortions).
// What neither can do is change WHAT EXISTS: when the pool physically cannot
// reach a target — the July 2026 fleet audit measured the two walls precisely
// (protein density: pools whose recipes carry ~3–4 g P/100 kcal against slots
// needing ~6–8; fat fraction: a pool median of 0.44 of energy from fat against
// targets needing ~0.23) — the only honest fixes are "say so" or "source a
// recipe that fits". A RecipeSpec is the second option made precise: one plain
// object that states, with provenance, exactly what a recipe must satisfy to
// close a specific gap. Channels (library scan, durable cache, web import, AI
// generation) consume the SAME spec, so "what we asked for" can never drift
// between the free path and the paid one.
//
// LAWS.
//   • Everything here is DERIVED from the caller's target + profile + filters.
//     Nothing user-specific is hardcoded (constitution rule 3) and no number is
//     invented: every derived field carries the formula in `prov`.
//   • The spec NEVER weakens a wall. dietaryStyle/excludedFoods ride along for
//     the channels' prompts and screens, but enforcement stays where it lives
//     today: planContext.filterRecipePool and the verify gates. A spec is a
//     description of the gap, not an authority over safety.
//   • The spec's guidance numbers (density floor, fat fraction) are AIMS for
//     sourcing, not a new pass/fail ruler. The rulers stay single-sourced in
//     weeklyPlanner (slot fit) and mealSolver (day tolerance).
const {
  KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT, estimateSlotTarget,
} = require("../weeklyPlanner.js");
const { hashInputs } = require("../brain/cache.js");
const { normTerms, KCAL_BUCKET, PROTEIN_BUCKET } = require("../brain/slotCache.js");

// Bump when the spec fingerprint's INPUTS change meaning — an old key must
// never be reinterpreted under new semantics. (Same rule as slotCache's
// FINGERPRINT_VERSION; this is a distinct keyspace because a spec binds the
// matrix caps that slot-v1 never saw.)
const SPEC_VERSION = "spec-v2";

// Day-level fat-energy ceiling used as a sourcing AIM. Evidence (fleet §2,
// verified citations: Helms 2014, Iraki 2019, ISSN 2017): cut-phase fat
// prescriptions are floors + wide %-kcal ranges; no cited source supports a
// tight upper band, and ≤35% of calories is the widest defensible ceiling.
// Used only to steer generation/import toward leaner candidates — never to
// pass/fail a plan (that ruler lives in mealSolver and is the owner's call).
const FAT_ENERGY_FRAC_CEILING = 0.35;

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

function posNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Slot share of a day band: the fat/carb bands computeMacros() emits are
// day-level; a slot inherits its kcal share of them. Guidance only.
function slotBand(dayLo, dayHi, share) {
  if (!Number.isFinite(dayLo) || !Number.isFinite(dayHi) || !(dayHi > 0)) return null;
  return { lo: round1(dayLo * share), hi: round1(dayHi * share) };
}

/**
 * buildSpec({ target, dailyTarget, filters, profile, emphasis }) -> RecipeSpec
 *
 * target:      { slotType, kcalTarget, proteinTarget } — weeklyPlanner's slot
 *              shape, the same object the solver and router already pass around.
 * dailyTarget: computeMacros() output (kcal, proteinLo/Hi, fatLo/Hi, carbLo/Hi,
 *              keto) — optional; without it the spec simply carries no fat/carb
 *              guidance (absent is absent, never fabricated).
 * filters:     planContext.parseFilters() shape — the user's matrix dials.
 * profile:     the authoritative Profile row (walls + soft prefs).
 * emphasis:    optional { fat: "lower"|"raise", carb: "lower"|"raise" } from a
 *              day-level diagnosis — lets a gap-fill request say "this day is
 *              drowning in fat, source lean" without inventing a new ruler.
 */
function buildSpec({ target = {}, dailyTarget = null, filters = {}, profile = {}, emphasis = null } = {}) {
  const slotType = target.slotType === "snack" ? "snack" : "meal";
  const kcalTarget = posNum(target.kcalTarget);
  const proteinTarget = posNum(target.proteinTarget);
  if (!kcalTarget || !proteinTarget) {
    throw new Error("buildSpec: target.kcalTarget and target.proteinTarget are required positive numbers");
  }

  // ── derived guidance (the pool-physics numbers, from the target alone) ────
  // Density a recipe must carry to land this slot AT target: g protein per
  // 100 kcal. The tolerance-corner floor is the weakest density that can still
  // pass the slot gate (protein at its allowed shortfall over kcal at its
  // allowed overshoot) — a candidate below the floor cannot pass at ANY
  // portion, so channels can reject it before spending anything on it.
  const densityMid = (proteinTarget / kcalTarget) * 100;
  const densityFloor = ((proteinTarget * (1 - PROTEIN_TOLERANCE_PCT)) / (kcalTarget * (1 + KCAL_TOLERANCE_PCT))) * 100;

  const share = dailyTarget && Number.isFinite(dailyTarget.kcal) && dailyTarget.kcal > 0
    ? kcalTarget / dailyTarget.kcal
    : null;
  const fatTargetG = share != null && dailyTarget ? slotBand(dailyTarget.fatLo, dailyTarget.fatHi, share) : null;
  const carbTargetG = share != null && dailyTarget ? slotBand(dailyTarget.carbLo, dailyTarget.carbHi, share) : null;
  const keto = dailyTarget ? Boolean(dailyTarget.keto) : false;

  // Fat-energy fraction the slot should AIM under: the slot band's own ceiling
  // expressed as a fraction of slot calories, clamped to the evidence ceiling.
  const fatEnergyFracMax = fatTargetG
    ? round2(Math.min((fatTargetG.hi * 9) / kcalTarget, FAT_ENERGY_FRAC_CEILING))
    : FAT_ENERGY_FRAC_CEILING;

  // ── the matrix (dials), profile-backed where the filter is unset ──────────
  const caps = {
    maxCostCad: posNum(filters.maxCostCad),
    maxPrepMin: posNum(filters.maxPrepMin) ?? posNum(profile.maxPrepMin),
    maxComplexity: Number.isInteger(filters.maxComplexity) ? filters.maxComplexity
      : Number.isInteger(profile.maxComplexity) ? profile.maxComplexity : null,
    minTaste: Number.isFinite(Number(filters.minTaste)) ? Number(filters.minTaste) : null,
  };
  const cuisines = Array.isArray(filters.cuisines) && filters.cuisines.length
    ? filters.cuisines.filter((c) => typeof c === "string" && c.trim())
    : Array.isArray(profile.cuisinePreferences)
      ? profile.cuisinePreferences.filter((c) => typeof c === "string" && c.trim())
      : [];
  const soft = {
    cuisines,
    protein: typeof filters.protein === "string" && filters.protein ? filters.protein : null,
    budget: filters.budget || profile.budgetTier || null,
    allowBatchRepeats: filters.allowBatchRepeats === true,
  };

  // ── walls (carried for prompts/screens; enforced upstream, always) ────────
  const walls = {
    dietaryStyle: profile.dietaryStyle && profile.dietaryStyle !== "none" ? profile.dietaryStyle : null,
    excludedFoods: Array.isArray(profile.excludedFoods) ? [...profile.excludedFoods] : [],
  };

  return {
    version: SPEC_VERSION,
    slotType,
    kcalTarget: Math.round(kcalTarget),
    proteinTarget: Math.round(proteinTarget),
    fatTargetG,
    carbTargetG,
    keto,
    proteinDensityMid: round2(densityMid),
    proteinDensityFloor: round2(densityFloor),
    fatEnergyFracMax,
    caps,
    soft,
    walls,
    emphasis: emphasis && typeof emphasis === "object" ? { fat: emphasis.fat ?? null, carb: emphasis.carb ?? null } : null,
    prov: {
      derivedFrom: {
        target: { slotType, kcalTarget, proteinTarget },
        dayKcal: dailyTarget?.kcal ?? null,
        slotShare: share != null ? round2(share) : null,
      },
      formulas: {
        proteinDensityMid: "proteinTarget / kcalTarget * 100",
        proteinDensityFloor: `proteinTarget*(1-${PROTEIN_TOLERANCE_PCT}) / (kcalTarget*(1+${KCAL_TOLERANCE_PCT})) * 100`,
        fatTargetG: "day fat band × slot kcal share (guidance, not a ruler)",
        fatEnergyFracMax: `min(slot fat-band ceiling ×9 / slot kcal, ${FAT_ENERGY_FRAC_CEILING})`,
      },
    },
  };
}

/**
 * A recipe below the density floor cannot pass the slot gate at any legal
 * portion — scaling changes grams, never the protein-per-kcal ratio of the
 * dish as a whole (both bundles move within the same 0.5–2 box, so the
 * blended density can shift only between the bundles' own densities; a recipe
 * whose EVERY bundle sits below the floor is structurally out). This cheap
 * necessary-condition screen uses the whole-recipe density: conservative in
 * the direction of keeping candidates (a recipe passing here can still fail
 * the real fit gate, which always runs).
 */
function densityOf(recipe) {
  const kcal = Number(recipe?.kcal) || 0;
  const protein = Number(recipe?.protein) || 0;
  return kcal > 0 ? (protein / kcal) * 100 : 0;
}

function meetsDensityFloor(recipe, spec) {
  // Bundle-aware: the dual-scale solver can up-weight the protein bundle, so
  // the reachable density ceiling is the PROTEIN BUNDLE's own density (at
  // proteinScale 2× vs sides 0.5×, the mix approaches it). Fall back to the
  // whole-recipe density when roles are absent.
  const floor = spec.proteinDensityFloor;
  if (!Number.isFinite(floor) || floor <= 0) return true;
  const ings = Array.isArray(recipe?.ingredients) ? recipe.ingredients : null;
  if (ings && ings.length) {
    let bestBundleDensity = 0;
    let bk = 0; let bp = 0; // protein-role bundle totals
    for (const i of ings) {
      const f = i.food || {};
      const g = (Number(i.baseGrams) || 0) / 100;
      const kcal = (Number(f.kcal) || 0) * g;
      const protein = (Number(f.protein) || 0) * g;
      if (i.role === "protein" && i.scalable !== false) { bk += kcal; bp += protein; }
    }
    if (bk > 0) bestBundleDensity = (bp / bk) * 100;
    // Blended reachable ceiling ≈ max(bundle density, whole-recipe density).
    return Math.max(bestBundleDensity, densityOf(recipe)) >= floor;
  }
  return densityOf(recipe) >= floor;
}

/**
 * specFingerprint(spec) -> hex string — the durable-cache key.
 *
 * Binds every input that changes what a valid recipe for this spec looks like,
 * INCLUDING the matrix caps slot-v1 never keyed (a $4-max request and an
 * unlimited-budget request must not share a bucket — the recipes that satisfy
 * them differ). Same bucketing rationale as slotCache: the bucket decides
 * where to LOOK; the fit + pool screens decide what is SERVED.
 */
function specFingerprint(spec) {
  const bucket = (v, size) => (Number.isFinite(v) ? Math.round(v / size) * size : null);
  return hashInputs({
    v: spec.version || SPEC_VERSION,
    slotType: spec.slotType === "snack" ? "snack" : "meal",
    kcal: bucket(spec.kcalTarget, KCAL_BUCKET),
    protein: bucket(spec.proteinTarget, PROTEIN_BUCKET),
    keto: Boolean(spec.keto),
    dietaryStyle: spec.walls?.dietaryStyle ? String(spec.walls.dietaryStyle).toLowerCase() : null,
    excluded: normTerms(spec.walls?.excludedFoods),
    cuisines: normTerms(spec.soft?.cuisines),
    protein_pref: spec.soft?.protein ? String(spec.soft.protein).toLowerCase() : null,
    caps: {
      cost: bucket(spec.caps?.maxCostCad, 0.5),
      prep: bucket(spec.caps?.maxPrepMin, 5),
      complexity: spec.caps?.maxComplexity ?? null,
      taste: Number.isFinite(spec.caps?.minTaste) ? Math.round(spec.caps.minTaste * 20) / 20 : null,
    },
  });
}

/**
 * gapSpecsFromDay({ candidate, dailyTarget, mealConfig, filters, profile })
 *   -> [{ spec, slot: {slotType, slotIndex}, reason }]
 *
 * The synergy entry point: read a solved day CANDIDATE (mealSolver's shape —
 * slots with recipeId/kcal/protein/warning) and turn every slot that missed
 * into a spec the channels can fill. Day-level fat/carb pressure becomes
 * `emphasis`, so a day that's fat-heavy asks its gap slots for lean recipes.
 *
 * Deliberately reads the solver's OWN warnings rather than re-judging slots
 * with new math — one ruler, owned by the solver (honesty rule: this module
 * must never disagree with the plan screen about what missed).
 */
function gapSpecsFromDay({ candidate, dailyTarget, mealConfig, filters = {}, profile = {} } = {}) {
  if (!candidate || !Array.isArray(candidate.slots)) return [];
  const out = [];

  // Day-level pressure → emphasis for every gap spec in this day.
  let emphasis = null;
  const score = candidate.score || {};
  const totals = score.totals || null;
  if (totals && dailyTarget) {
    const fatHi = Number(dailyTarget.fatHi);
    const fatLo = Number(dailyTarget.fatLo);
    const carbHi = Number(dailyTarget.carbHi);
    const fat = Number(totals.fat);
    const carb = Number(totals.carb);
    const e = {};
    if (Number.isFinite(fatHi) && fat > fatHi) e.fat = "lower";
    else if (Number.isFinite(fatLo) && fat < fatLo) e.fat = "raise";
    if (Number.isFinite(carbHi) && carb > carbHi) e.carb = "lower";
    if (e.fat || e.carb) emphasis = e;
  }

  for (const slot of candidate.slots) {
    const missed = slot.recipeId == null || (typeof slot.warning === "string" && slot.warning.length > 0);
    if (!missed) continue;
    const slotType = slot.slotType === "snack" ? "snack" : "meal";
    const target = estimateSlotTarget(dailyTarget, mealConfig, slotType);
    out.push({
      slot: { slotType, slotIndex: slot.slotIndex ?? null },
      reason: slot.recipeId == null ? "unfilled" : slot.warning,
      spec: buildSpec({
        target: { slotType, kcalTarget: target.kcalTarget, proteinTarget: target.proteinTarget },
        dailyTarget, filters, profile, emphasis,
      }),
    });
  }
  return out;
}

module.exports = {
  buildSpec, specFingerprint, gapSpecsFromDay,
  densityOf, meetsDensityFloor,
  SPEC_VERSION, FAT_ENERGY_FRAC_CEILING,
};
