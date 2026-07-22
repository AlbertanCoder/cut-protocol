// ── Micronutrient aggregation ───────────────────────────────────────────
// Rolls per-100g food micronutrients (Food.micros, see nutrients.js for the
// contract) up through recipe ingredients and today's planned portions to a
// daily total. Pure functions only — no Prisma here — so the math is fully
// unit-testable without a database (see tests/microAggregation.test.js).
// Route-level glue that resolves foodIds -> Food rows lives in
// routes/micronutrients.js.
//
// THE CENTRAL RULE (constitution: "null means honest absence, never zero"):
// a nutrient with ZERO contributing grams of known data returns `amount:
// null`, not 0. A nutrient with SOME contributing grams returns the sum of
// what IS known, plus `coverageFraction` so callers can say "based on 70% of
// today's food weight" instead of presenting a partial sum as if it were
// complete. Never silently upgrade "unknown" to "0" or "known" to "100%".
"use strict";

const { NUTRIENT_LIST, convertUnit } = require("./nutrients.js");

const round = (n, dp = 4) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

// Reads one nutrient's per-100g amount off a food. Two distinct "unknown"
// cases, both returned the same way to the caller (known: false) but worth
// naming here:
//   1. food.micros is null/undefined/not-an-object — this food has NO
//      micronutrient profile at all (an honest absence, per schema.prisma).
//   2. food.micros IS an object, but this particular key is missing from
//      it — this food's profile just doesn't report this nutrient.
// `sourceField` nutrients (currently only fiber) bypass micros entirely and
// read a scalar Food column instead — see nutrients.js's header comment on
// why fiber has its own column rather than living in the micros JSON.
function readFoodNutrient(food, def) {
  if (def.sourceField) {
    const v = food ? food[def.sourceField] : undefined;
    return typeof v === "number" && Number.isFinite(v)
      ? { known: true, amountPer100g: v }
      : { known: false, amountPer100g: 0 };
  }
  const micros = food ? food.micros : null;
  if (!micros || typeof micros !== "object") return { known: false, amountPer100g: 0 };
  const v = micros[def.key];
  return typeof v === "number" && Number.isFinite(v)
    ? { known: true, amountPer100g: v }
    : { known: false, amountPer100g: 0 };
}

// targetPct — unit-correct even if a future nutrient's target is expressed
// in a different (but compatible, i.e. mass) unit than its canonical amount
// unit. Throws rather than silently mis-scaling if the units are outright
// incompatible (guards against a future non-mass nutrient sneaking in).
function pctOfTarget(amountInCanonicalUnit, canonicalUnit, target) {
  if (amountInCanonicalUnit == null || !target || target.amount == null) return null;
  const targetInCanonicalUnit = convertUnit(target.amount, target.unit, canonicalUnit);
  if (targetInCanonicalUnit === 0) return null;
  return round((amountInCanonicalUnit / targetInCanonicalUnit) * 100, 2);
}

/**
 * Aggregate a flat list of portions into daily/recipe/slot micronutrient
 * totals. A "portion" is `{ grams, food }` where `food` is a Food-shaped
 * object (needs `.micros`, and `.fiber` for the fiber sourceField) — pass
 * `food: null`/`undefined` for a portion whose food couldn't be resolved
 * (e.g. a stale foodId); it still counts toward totalGrams as a genuinely
 * unknown contribution, exactly like a food with `micros: null` would.
 *
 * @param {Array<{grams:number, food:object|null}>} portions
 * @param {{nutrients?: Array}} opts — override the nutrient set (tests use
 *   this to keep fixtures small); defaults to the full registry.
 */
function aggregatePortions(portions, opts = {}) {
  const nutrientDefs = opts.nutrients || NUTRIENT_LIST;

  const acc = {};
  for (const def of nutrientDefs) acc[def.key] = { amount: 0, knownGrams: 0, missingPortions: 0 };

  let totalGrams = 0;
  let portionCount = 0;
  let wholeFoodsWithMicros = 0;
  let wholeFoodsWithoutMicros = 0;

  for (const portion of portions || []) {
    const grams = Number(portion && portion.grams);
    if (!Number.isFinite(grams) || grams <= 0) continue;
    const food = portion.food || null;

    totalGrams += grams;
    portionCount += 1;
    const hasMicrosProfile = !!(food && food.micros && typeof food.micros === "object");
    if (hasMicrosProfile) wholeFoodsWithMicros += 1; else wholeFoodsWithoutMicros += 1;

    for (const def of nutrientDefs) {
      const { known, amountPer100g } = readFoodNutrient(food, def);
      const bucket = acc[def.key];
      if (known) {
        bucket.amount += (amountPer100g * grams) / 100;
        bucket.knownGrams += grams;
      } else {
        bucket.missingPortions += 1;
      }
    }
  }

  const nutrients = {};
  for (const def of nutrientDefs) {
    const bucket = acc[def.key];
    const hasAnyData = bucket.knownGrams > 0;
    const coverageFraction = totalGrams > 0 ? round(bucket.knownGrams / totalGrams) : 0;
    const amount = hasAnyData ? round(bucket.amount) : null; // null, never 0, when totally unknown
    nutrients[def.key] = {
      key: def.key,
      name: def.name,
      unit: def.unit,
      group: def.group,
      amount,
      knownGrams: bucket.knownGrams,
      totalGrams,
      coverageFraction,
      complete: totalGrams > 0 && bucket.knownGrams === totalGrams,
      missingPortions: bucket.missingPortions,
      portionCount,
      target: def.target,
      targetPct: amount != null ? pctOfTarget(amount, def.unit, def.target) : null,
    };
  }

  return {
    totalGrams,
    portionCount,
    wholeFoodsWithMicros,
    wholeFoodsWithoutMicros,
    nutrients,
  };
}

// Recipe ingredients (RecipeIngredient rows, each with `.food` included) at
// scale=1 — Recipe's cached per-serving macros are computed from these SAME
// baseGrams (see schema.prisma's comment on Recipe.kcal), so this yields
// PER-SERVING micronutrient totals with no extra scaling math needed.
function portionsFromRecipeIngredients(ingredients) {
  return (ingredients || []).map((ing) => ({ grams: ing.baseGrams, food: ing.food }));
}

// PlanSlot.ingredients is the schema's declared ground truth for actual
// grams-per-food in a solved slot ([{foodId, name, grams, role}], already
// scale-resolved — see schema.prisma). foodsById must map foodId -> Food
// (with .micros/.fiber); a foodId missing from the map resolves to `food:
// null`, which aggregatePortions treats as a genuinely unknown contribution
// rather than throwing.
function portionsFromPlanSlotIngredients(slotIngredients, foodsById) {
  return (slotIngredients || []).map((ing) => ({
    grams: ing.grams,
    food: foodsById ? foodsById.get(ing.foodId) || null : null,
  }));
}

// One-line-able coverage summary across every tracked nutrient, for a UI
// sentence like "6 of 8 nutrients fully known, 2 partial — nothing hidden."
// Never claims completeness a nutrient doesn't have.
function summarizeCoverage(aggregateResult) {
  const rows = Object.values(aggregateResult.nutrients);
  let fullyKnown = 0, partial = 0, noData = 0;
  for (const r of rows) {
    if (r.amount == null) noData += 1;
    else if (r.complete) fullyKnown += 1;
    else partial += 1;
  }
  return { totalNutrients: rows.length, fullyKnown, partial, noData };
}

module.exports = {
  aggregatePortions,
  portionsFromRecipeIngredients,
  portionsFromPlanSlotIngredients,
  summarizeCoverage,
  // exposed for targeted unit testing
  readFoodNutrient,
  pctOfTarget,
};
