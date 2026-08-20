// nutritionCore.js — FDC-canonical macro accounting for the prescription ruler.
//
// The one rule that makes this file exist: the Food row's stored kcal is the
// canonical energy figure (it came from FDC, which uses per-food Atwater
// factors), and calories are NEVER recomputed as 4P + 4C + 9F for anything
// that decides. Generic 4/4/9 over a real day diverges from FDC energy by
// more than a ±50 kcal verification band all by itself — fiber contributes
// energy, and per-food factors differ from the generic ones. The 4/4/9 figure
// may be SHOWN as an approximation; it decides nothing.
//
// This module is pure: no DB, no clock, no RNG. Callers hand it ingredient
// rows and the Food rows they resolve to. An ingredient whose food is missing
// or macro-incomplete does not degrade to zero — it makes the result
// uncertifiable (ok: false), because a number built on a hole is not a number.
// That is the same fail-closed posture as exclusionGate's
// ingredient-metadata-not-loaded rule, applied to arithmetic.

"use strict";

/** Net carbs: total carbohydrate minus fiber, floored at zero. */
function netCarbs(carb, fiber) {
  const c = Number.isFinite(carb) ? carb : 0;
  const f = Number.isFinite(fiber) ? fiber : 0;
  return Math.max(0, c - f);
}

/**
 * Display-only Atwater approximation. Exported so UI code has one blessed
 * source for the "≈ N kcal by 4/4/9" caption instead of inlining the math.
 * DECIDES NOTHING — verification uses the FDC-derived kcal sum.
 */
function atwaterApproxKcal(proteinG, fatG, carbG) {
  const p = Number.isFinite(proteinG) ? proteinG : 0;
  const f = Number.isFinite(fatG) ? fatG : 0;
  const c = Number.isFinite(carbG) ? carbG : 0;
  return 4 * p + 9 * f + 4 * c;
}

function foodHasUsableMacros(food) {
  return (
    food &&
    Number.isFinite(food.kcal) &&
    Number.isFinite(food.protein) &&
    Number.isFinite(food.fat) &&
    Number.isFinite(food.carb)
  );
}

/**
 * Sum a list of ingredient rows against their Food rows (per-100 g values).
 *
 * ingredients: [{ foodId, grams }]           — grams as prescribed
 * foodsById:   Map<foodId, Food> or plain object keyed by foodId
 *
 * Returns { ok, totals, missing }:
 *   ok       — true only when EVERY ingredient resolved to a food with
 *              complete kcal/protein/fat/carb. fiber may be absent (treated
 *              as 0 — FDC rows without a fiber value are common and a
 *              missing fiber only makes netCarb read HIGH, the safe side
 *              for a carb ceiling).
 *   totals   — { kcal, protein, fat, carb, fiber, netCarb } summed at full
 *              precision (rounding is a display decision, not an accounting
 *              one). Present even when ok is false, so diagnostics can show
 *              what the resolvable part added up to — but an ok:false total
 *              certifies nothing and must never be shown as a plan number.
 *   missing  — foodIds that failed to resolve or had incomplete macros.
 */
function macroTotals(ingredients, foodsById) {
  const get =
    typeof foodsById?.get === "function"
      ? (id) => foodsById.get(id)
      : (id) => (foodsById ? foodsById[id] : undefined);

  const totals = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, netCarb: 0 };
  const missing = [];

  for (const ing of ingredients || []) {
    const grams = Number.isFinite(ing?.grams) ? ing.grams : NaN;
    const food = ing ? get(ing.foodId) : undefined;
    if (!Number.isFinite(grams) || grams < 0 || !foodHasUsableMacros(food)) {
      missing.push(ing?.foodId ?? null);
      continue;
    }
    const scale = grams / 100;
    totals.kcal += food.kcal * scale;
    totals.protein += food.protein * scale;
    totals.fat += food.fat * scale;
    totals.carb += food.carb * scale;
    totals.fiber += (Number.isFinite(food.fiber) ? food.fiber : 0) * scale;
  }

  totals.netCarb = netCarbs(totals.carb, totals.fiber);
  return { ok: missing.length === 0, totals, missing };
}

module.exports = { macroTotals, netCarbs, atwaterApproxKcal };
