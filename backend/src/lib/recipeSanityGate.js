// recipeSanityGate.js — per-recipe plausibility bounds for pool admission.
//
// The gap this closes, measured in AUDIT.md §5.2/§6: no production write path
// checks whether a recipe's grams are PLAUSIBLE. validateRecipe() checks
// macro DRIFT (stored vs computed), which a 10,000 g split-pea row passes
// perfectly — the arithmetic is self-consistent, the food is imaginary.
// Per-ingredient caps existed only on the AI-draft path (MAX_GRAMS = 5000 in
// aiRecipeClient) and the URL importer (> 1e6 rejected); seeded, library and
// hand-edited recipes hit neither. Real casualties in the shipped library:
// Split Pea Soup at 9,282 kcal/serving, Tahini Lentils at 11,825, Sesame
// Cucumber Salad calling for 300 g basil against 100 g cucumber.
//
// Directive bounds (CUT_PROTOCOL_DIRECTIVE.md §3.1): a single recipe lands
// between 150 and 1,400 kcal per serving, protein ≤ 100 g. The unit matters:
// bounds are PER RECIPE, and a meal slot may hold several recipes (OMAD is
// one slot, several dishes), so these never conflict with big meal structures.
//
// This module is pure and advisory-by-construction: it returns issues, it
// rejects nothing itself. Callers (pool admission in the recipe phase, the
// LLM-candidate gate) decide what a "fail" does. Severity contract:
//   fail — do not admit this recipe to a solve pool; log the reason
//   warn — admissible, but surface it for curation

"use strict";

const BOUNDS = {
  kcalMinPerServing: 150,
  kcalMaxPerServing: 1400,
  proteinMaxGPerServing: 100,
  // A single ingredient row, per serving. 600 g is a plate-sized portion of
  // one food (a big potato serving is ~400 g); past 1,500 g one ingredient in
  // one serving is not food, it is a data error — the known-bad rows are 6×
  // past it. Deliberately generous: this gate exists to catch corrupt data,
  // not to police hearty portions. Tighten only with measurements in hand.
  ingredientWarnG: 600,
  ingredientFailG: 1500,
  // Herbs, spices and other seasoning-shaped foods read implausible far
  // earlier — 300 g of basil is the measured example. Applied only when the
  // food's category says seasoning, never guessed from the name.
  seasoningWarnG: 50,
  seasoningFailG: 250,
};

const SEASONING_CATEGORIES = new Set(["spices"]);

function issue(code, severity, message, extra) {
  return { code, severity, message, ...extra };
}

/**
 * sanityCheckRecipe(recipe, opts) → { ok, issues }
 *
 * recipe: {
 *   name,
 *   ingredients: [{ name, grams, foodId }],   — grams PER SERVING (scale 1)
 * }
 * opts: {
 *   totals:    { kcal, protein } per serving — pass nutritionCore.macroTotals
 *              output so kcal is FDC-derived, never 4/4/9,
 *   foodsById: optional Map/object of Food rows, used only to read
 *              food.category for the seasoning bounds,
 *   enforceKcalFloor: default true. The 150-kcal floor is an ADMISSION
 *              quality rule (a 40-kcal "meal" is a garnish, keep it out of
 *              the pool at candidate time); the runtime plan fence passes
 *              false, because a small side dish already in the library harms
 *              nobody — it is the ceilings and gram bounds that catch
 *              corrupt data.
 * }
 *
 * ok is false when any issue has severity "fail". Issues are returned in
 * full either way — a pool-admission log that says only "failed" teaches
 * the ontology nothing.
 */
function sanityCheckRecipe(recipe, opts = {}) {
  const issues = [];
  const totals = opts.totals || null;
  const get =
    typeof opts.foodsById?.get === "function"
      ? (id) => opts.foodsById.get(id)
      : (id) => (opts.foodsById ? opts.foodsById[id] : undefined);

  for (const ing of recipe?.ingredients || []) {
    const grams = Number.isFinite(ing?.grams) ? ing.grams : NaN;
    const label = ing?.name || String(ing?.foodId ?? "unnamed ingredient");
    if (!Number.isFinite(grams) || grams <= 0) {
      issues.push(
        issue("zero-or-negative-grams", "fail",
          `${label}: ${ing?.grams} g is not a real amount`, { ingredient: label })
      );
      continue;
    }
    const food = ing.foodId != null ? get(ing.foodId) : undefined;
    const seasoning = food && SEASONING_CATEGORIES.has(food.category);
    const failAt = seasoning ? BOUNDS.seasoningFailG : BOUNDS.ingredientFailG;
    const warnAt = seasoning ? BOUNDS.seasoningWarnG : BOUNDS.ingredientWarnG;
    if (grams > failAt) {
      issues.push(
        issue("implausible-ingredient-grams", "fail",
          `${label}: ${grams} g per serving is past the ${failAt} g plausibility bound` +
          (seasoning ? " for a seasoning" : ""), { ingredient: label, grams })
      );
    } else if (grams > warnAt) {
      issues.push(
        issue("suspicious-ingredient-grams", "warn",
          `${label}: ${grams} g per serving is a lot` +
          (seasoning ? " for a seasoning" : "") + " — worth a human look",
          { ingredient: label, grams })
      );
    }
  }

  const enforceKcalFloor = opts.enforceKcalFloor !== false;
  if (totals && Number.isFinite(totals.kcal)) {
    if (enforceKcalFloor && totals.kcal < BOUNDS.kcalMinPerServing) {
      issues.push(
        issue("kcal-below-floor", "fail",
          `${Math.round(totals.kcal)} kcal/serving is below the ${BOUNDS.kcalMinPerServing} kcal recipe floor`)
      );
    } else if (totals.kcal > BOUNDS.kcalMaxPerServing) {
      issues.push(
        issue("kcal-above-ceiling", "fail",
          `${Math.round(totals.kcal)} kcal/serving is past the ${BOUNDS.kcalMaxPerServing} kcal recipe ceiling`)
      );
    }
    if (Number.isFinite(totals.protein) && totals.protein > BOUNDS.proteinMaxGPerServing) {
      issues.push(
        issue("protein-above-ceiling", "fail",
          `${Math.round(totals.protein)} g protein/serving is past the ${BOUNDS.proteinMaxGPerServing} g recipe ceiling`)
      );
    }
  }

  return { ok: !issues.some((i) => i.severity === "fail"), issues };
}

module.exports = { sanityCheckRecipe, BOUNDS };
