// Recipe Brain — the TWEAK ENGINE: make a sourced recipe FIT the spec.
//
// This is the "adjust it to match your macros" half of the recipe brain. Two
// deterministic moves, tried in order, with a guard that makes the second one
// safe to attempt on every candidate:
//
//   1. TWO-FACTOR PORTIONING — weeklyPlanner.scaleRecipe, unchanged, via the
//      same enforceScaledCarbCeiling the solver ships through. This is the
//      portion brain doing what it already does; the tweak engine adds nothing.
//
//   2. GUARDED ROLE REPARTITION — when the spec carries fat/carb guidance and
//      the two-factor result misses it, re-solve portions over the recipe's
//      ROLE BUNDLES (protein / carb / veg / fat / other) against the full
//      4-axis target using brain/optimizer.solvePortions (the deterministic
//      k-bundle least-squares that already exists), then ACCEPT THE RESULT
//      ONLY IF IT MEASURABLY IMPROVES the deviation without breaking the slot
//      gate. The July 2026 fleet lab measured exactly this shape (variant H):
//      per-day re-scale with an accept-only-if-better guard took filled-day
//      pass 9.8%→26.0% with zero regressions, while the SAME move unguarded
//      destroyed oracle scores — the guard is not a nicety, it is the finding.
//
// SAFETY INVARIANTS (structural, not promised):
//   • scaling only — this module NEVER adds, removes, or substitutes an
//     ingredient, so it cannot introduce an allergen or evade a wall. A future
//     ingredient-swap move belongs behind the full verify gate, not here.
//   • every scale stays inside weeklyPlanner.SCALE_BOUNDS (0.5–2), the same
//     box the M9 server-side portion validation enforces per ingredient.
//   • keto's post-scale carb ceiling is re-checked on the REAL recomputed
//     totals via the solver's own enforceScaledCarbCeiling. A repartition that
//     breaches it is rejected, not trimmed into something unverified.
//   • the slot gate (kcal/protein tolerances) is the solver's, imported — a
//     tweak that "improves fat" by breaking calories is refused by the guard.
const {
  scaleRecipe, enforceScaledCarbCeiling, practicalGrams,
  SCALE_BOUNDS, KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT,
} = require("../weeklyPlanner.js");
const { recipeExceedsKetoCeiling } = require("../dietaryFilter.js");
const { solvePortions } = require("../brain/optimizer.js");

// Residual weights for the guard's quality measure: kcal and protein are the
// load-bearing axes (the slot gate), fat/carb matter here precisely because
// this engine exists to service them — but at HALF weight and less, so a fat
// improvement can never pay for a calorie miss. Normalised per-axis by the
// target so grams and kilocalories are comparable.
const QUALITY_WEIGHTS = { kcal: 1, protein: 1, fat: 0.5, carb: 0.35 };
const ACCEPT_EPS = 1e-6; // strict improvement, no coin-flip swaps

const round2 = (v) => Math.round(v * 100) / 100;

// ── verdict: how far a scaled result sits from the spec ─────────────────────
// kcal/protein judged exactly like the slot gate (same constants, same
// asymmetric protein). fat/carb judged against the spec's slot-share bands
// when present — absent bands contribute nothing (absent is absent).
function verdict(scaled, spec) {
  const kcalOff = spec.kcalTarget > 0 ? Math.abs(scaled.kcal - spec.kcalTarget) / spec.kcalTarget : 0;
  const proteinShort = spec.proteinTarget > 0 ? Math.max(0, (spec.proteinTarget - scaled.protein) / spec.proteinTarget) : 0;
  const bandMiss = (v, band) => {
    if (!band || !Number.isFinite(band.lo) || !Number.isFinite(band.hi)) return 0;
    const mid = (band.lo + band.hi) / 2;
    if (!(mid > 0)) return 0;
    if (v < band.lo) return (band.lo - v) / mid;
    if (v > band.hi) return (v - band.hi) / mid;
    return 0;
  };
  const fatMiss = bandMiss(scaled.fat, spec.fatTargetG);
  const carbMiss = bandMiss(scaled.carb, spec.carbTargetG);
  const slotOk = kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT;
  const quality =
    QUALITY_WEIGHTS.kcal * kcalOff +
    QUALITY_WEIGHTS.protein * proteinShort +
    QUALITY_WEIGHTS.fat * fatMiss +
    QUALITY_WEIGHTS.carb * carbMiss;
  return { kcalOff, proteinShort, fatMiss, carbMiss, slotOk, quality: round2(quality * 1000) / 1000 };
}

// ── role bundles ────────────────────────────────────────────────────────────
// Fixed (non-scalable) ingredients stay at 1× always. Scalable ingredients
// group by role; null/dairy/other pool together so the bundle count stays
// small and every bundle is macro-meaningful. Order is FIXED (protein first)
// for determinism and because solvePortions' k=2 legacy parity expects the
// protein bundle at index 0.
const BUNDLE_ORDER = ["protein", "carb", "veg", "fat", "other"];
const bundleKey = (role) => (BUNDLE_ORDER.includes(role) ? role : "other");

function roleBundles(recipe) {
  const fixed = [];
  const byKey = new Map();
  for (const ing of recipe.ingredients || []) {
    if (ing.scalable === false) { fixed.push(ing); continue; }
    const key = bundleKey(ing.role);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ing);
  }
  const macrosOf = (ings) => ings.reduce((s, i) => {
    const k = (Number(i.baseGrams) || 0) / 100;
    const f = i.food || {};
    return {
      kcal: s.kcal + (Number(f.kcal) || 0) * k,
      protein: s.protein + (Number(f.protein) || 0) * k,
      fat: s.fat + (Number(f.fat) || 0) * k,
      carb: s.carb + (Number(f.carb) || 0) * k,
    };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  const bundles = BUNDLE_ORDER
    .filter((key) => byKey.has(key))
    .map((key) => ({ key, ingredients: byKey.get(key), macros: macrosOf(byKey.get(key)) }));
  return { fixed, fixedMacros: macrosOf(fixed), bundles };
}

// Materialise per-bundle scales into shipped grams + totals recomputed FROM
// those grams — same practical-rounding discipline as weeklyPlanner.applyScales
// (grams from raw factors, labels rounded, totals from the rounded grams).
function applyBundleScales(recipe, bundles, scales) {
  const scaleOf = new Map(bundles.map((b, i) => [b.key, scales[i]]));
  const resolved = [];
  for (const ing of recipe.ingredients || []) {
    const s = ing.scalable === false ? 1 : scaleOf.get(bundleKey(ing.role)) ?? 1;
    resolved.push({ foodId: ing.foodId, name: ing.food?.name, role: ing.role, grams: practicalGrams(ing.baseGrams * s) });
  }
  const byId = new Map((recipe.ingredients || []).map((i) => [i.foodId, i.food]));
  const totals = resolved.reduce((sum, r) => {
    const food = byId.get(r.foodId) || {};
    const k = r.grams / 100;
    return {
      kcal: sum.kcal + (Number(food.kcal) || 0) * k,
      protein: sum.protein + (Number(food.protein) || 0) * k,
      fat: sum.fat + (Number(food.fat) || 0) * k,
      carb: sum.carb + (Number(food.carb) || 0) * k,
    };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });

  // Honest label mapping for the two-column PlanSlot schema: proteinScale is
  // the protein bundle's real scale; sidesScale is the grams-weighted mean of
  // the others — a LABEL for display, while `ingredients[].grams` (which the
  // schema stores verbatim) remain the ground truth. Flagged in provenance so
  // no caller mistakes the label for the math.
  const proteinScale = scaleOf.get("protein") ?? 1;
  let g = 0; let gw = 0;
  for (const b of bundles) {
    if (b.key === "protein") continue;
    const grams = b.ingredients.reduce((s, i) => s + (Number(i.baseGrams) || 0), 0);
    g += grams; gw += grams * (scaleOf.get(b.key) ?? 1);
  }
  const sidesScale = g > 0 ? gw / g : 1;

  return {
    proteinScale: round2(proteinScale),
    sidesScale: round2(sidesScale),
    ingredients: resolved,
    ...totals,
    roleScales: Object.fromEntries(bundles.map((b, i) => [b.key, round2(scales[i])])),
    scaleLabelNote: "sidesScale is a grams-weighted display label; per-ingredient grams are ground truth",
  };
}

/**
 * refit(recipe, spec, deps?) -> {
 *   scaled,            // the result to ship (two-factor or repartition)
 *   method,            // "two-factor" | "repartition"
 *   accepted,          // true when repartition beat two-factor AND held the gates
 *   verdicts: { twoFactor, repartition? },   // both measured, both reported
 *   prov,
 * }
 *
 * Never throws for an expected shape; returns null only when the recipe cannot
 * be scaled at all (no ingredients). deps are test seams; real callers pass
 * nothing.
 */
function refit(recipe, spec, deps = {}) {
  const {
    scaleRecipeImpl = scaleRecipe,
    enforceCeilingImpl = enforceScaledCarbCeiling,
    solvePortionsImpl = solvePortions,
  } = deps;
  if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) return null;
  const dietStyle = recipe.dietGuardStyle || (spec.keto ? spec.walls?.dietaryStyle : null) || null;

  // ── move 1: the portion brain, exactly as the solver runs it ──────────────
  const two = enforceCeilingImpl(recipe, scaleRecipeImpl(recipe, spec.kcalTarget, spec.proteinTarget), dietStyle);
  if (!two) {
    return {
      scaled: null, method: "two-factor", accepted: false,
      verdicts: { twoFactor: null },
      prov: { reason: "breaches the diet's carb ceiling at every servable portion" },
    };
  }
  const vTwo = verdict(two, spec);

  // ── move 2 gate: only when the spec actually carries fat/carb guidance the
  // two-factor result missed — repartition exists to serve those axes, not to
  // second-guess a result that is already as close as the recipe can get.
  const wantsRepartition = (spec.fatTargetG || spec.carbTargetG) && (vTwo.fatMiss > 0 || vTwo.carbMiss > 0);
  if (!wantsRepartition) {
    return { scaled: two, method: "two-factor", accepted: false, verdicts: { twoFactor: vTwo }, prov: { note: "no fat/carb guidance missed; two-factor stands" } };
  }

  const { fixedMacros, bundles } = roleBundles(recipe);
  if (bundles.length < 2) {
    return { scaled: two, method: "two-factor", accepted: false, verdicts: { twoFactor: vTwo }, prov: { note: "fewer than 2 scalable role bundles; repartition has no degrees of freedom" } };
  }

  // 4-axis target NET OF FIXED ingredients (the optimizer scales bundles; fixed
  // rows contribute constants). Fat/carb targets are band midpoints — the
  // optimizer aims, the verdict + guard judge.
  const mid = (band) => (band ? (band.lo + band.hi) / 2 : null);
  const target = {
    kcal: spec.kcalTarget - fixedMacros.kcal,
    protein: spec.proteinTarget - fixedMacros.protein,
    ...(spec.fatTargetG ? { fat: Math.max(0, mid(spec.fatTargetG) - fixedMacros.fat) } : {}),
    ...(spec.carbTargetG ? { carb: Math.max(0, mid(spec.carbTargetG) - fixedMacros.carb) } : {}),
  };

  const solved = solvePortionsImpl(bundles.map((b) => b.macros), target, {
    bounds: SCALE_BOUNDS,
    weights: QUALITY_WEIGHTS,
  });
  const rep = applyBundleScales(recipe, bundles, solved.scales);

  // Keto/diet ceiling on the REAL recomputed totals. Move 1's repair walk is
  // two-factor machinery and does not apply to role scales — so here a breach
  // is a REJECTION, never a half-repaired portion (ship-smaller-but-still-over
  // is the dishonest option; so is repairing with math the result didn't use).
  const ceilingOk = !recipeExceedsKetoCeiling({ carb: rep.carb, kcal: rep.kcal }, dietStyle);
  const vRep = ceilingOk ? verdict(rep, spec) : null;

  // ── THE GUARD (the fleet's finding, verbatim in spirit): accept only if the
  // repartition (a) still passes the slot gate the solver will re-judge, and
  // (b) STRICTLY improves the measured quality. Anything else keeps move 1.
  const accepted = Boolean(ceilingOk && vRep && vRep.slotOk && vRep.quality < vTwo.quality - ACCEPT_EPS);

  return {
    scaled: accepted ? rep : two,
    method: accepted ? "repartition" : "two-factor",
    accepted,
    verdicts: { twoFactor: vTwo, repartition: vRep },
    prov: {
      guard: "accept only if slotOk && quality strictly improves (fleet variant-H)",
      bundles: bundles.map((b) => b.key),
      scales: accepted ? rep.roleScales : null,
      rejectedBecause: accepted ? null
        : !ceilingOk ? "diet carb ceiling"
        : !vRep?.slotOk ? "would break the slot kcal/protein gate"
        : "did not strictly improve quality",
    },
  };
}

module.exports = { refit, verdict, roleBundles, applyBundleScales, QUALITY_WEIGHTS, BUNDLE_ORDER };
