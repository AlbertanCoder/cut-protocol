const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregatePortions,
  portionsFromRecipeIngredients,
  portionsFromPlanSlotIngredients,
  summarizeCoverage,
  readFoodNutrient,
  pctOfTarget,
} = require("../src/lib/microAggregation.js");
const { getNutrient } = require("../src/lib/nutrients.js");

// A deliberately small nutrient set for legible fixtures — iron/vitaminC come
// from Food.micros (JSON path), fiber comes from Food.fiber (sourceField
// path), so together they exercise both read paths.
const IRON = getNutrient("iron");
const VITAMIN_C = getNutrient("vitaminC");
const FIBER = getNutrient("fiber");
const TEST_NUTRIENTS = [IRON, VITAMIN_C, FIBER];

// ── fixtures ──────────────────────────────────────────────────────────────
// foodA: full profile, including a REAL zero (vitaminC: 0 — beef-like).
const foodA = { id: "f1", name: "Food A", micros: { iron: 10, vitaminC: 0 }, fiber: 2 };
// foodB: no micronutrient data at all (honest absence at the whole-food level).
const foodB = { id: "f2", name: "Food B", micros: null, fiber: 0 };
// foodC: has iron, but its profile simply doesn't report vitaminC.
const foodC = { id: "f3", name: "Food C", micros: { iron: 5 }, fiber: 5 };
// foodD: no fiber column value at all (undefined) — exercises the
// sourceField "unknown" path independent of the micros JSON.
const foodD = { id: "f4", name: "Food D", micros: { iron: 1, vitaminC: 1 }, fiber: undefined };

// ---------------------------------------------------------------------
// readFoodNutrient — the single-value read primitive
// ---------------------------------------------------------------------

test("readFoodNutrient: a present numeric key (including a real 0) is known", () => {
  assert.deepEqual(readFoodNutrient(foodA, VITAMIN_C), { known: true, amountPer100g: 0 });
  assert.deepEqual(readFoodNutrient(foodA, IRON), { known: true, amountPer100g: 10 });
});

test("readFoodNutrient: micros:null means unknown, not zero", () => {
  assert.deepEqual(readFoodNutrient(foodB, IRON), { known: false, amountPer100g: 0 });
});

test("readFoodNutrient: micros present but missing this key means unknown", () => {
  assert.deepEqual(readFoodNutrient(foodC, VITAMIN_C), { known: false, amountPer100g: 0 });
});

test("readFoodNutrient: sourceField (fiber) reads Food.fiber, independent of micros", () => {
  // foodB has micros:null but a real fiber value of 0 — still "known".
  assert.deepEqual(readFoodNutrient(foodB, FIBER), { known: true, amountPer100g: 0 });
  assert.deepEqual(readFoodNutrient(foodA, FIBER), { known: true, amountPer100g: 2 });
});

test("readFoodNutrient: sourceField with an undefined column is unknown", () => {
  assert.deepEqual(readFoodNutrient(foodD, FIBER), { known: false, amountPer100g: 0 });
});

test("readFoodNutrient: a null/undefined food is unknown for every nutrient, never throws", () => {
  assert.deepEqual(readFoodNutrient(null, IRON), { known: false, amountPer100g: 0 });
  assert.deepEqual(readFoodNutrient(undefined, FIBER), { known: false, amountPer100g: 0 });
});

// ---------------------------------------------------------------------
// aggregatePortions — the core rollup
// ---------------------------------------------------------------------

test("aggregatePortions: unit-correct gram scaling, full coverage", () => {
  const result = aggregatePortions(
    [{ grams: 200, food: foodA }, { grams: 100, food: foodC }],
    { nutrients: TEST_NUTRIENTS }
  );
  // iron: 10mg/100g * 200g + 5mg/100g * 100g = 20 + 5 = 25mg, both known.
  assert.equal(result.nutrients.iron.amount, 25);
  assert.equal(result.nutrients.iron.coverageFraction, 1);
  assert.equal(result.nutrients.iron.complete, true);
  assert.equal(result.totalGrams, 300);
});

test("aggregatePortions: a real known zero stays zero, not null, even under partial coverage", () => {
  const result = aggregatePortions(
    [{ grams: 200, food: foodA }, { grams: 100, food: foodC }],
    { nutrients: TEST_NUTRIENTS }
  );
  // vitaminC: foodA contributes a real 0 (known); foodC doesn't report it (unknown).
  const vitC = result.nutrients.vitaminC;
  assert.equal(vitC.amount, 0); // known real zero — must NOT be null
  assert.equal(vitC.knownGrams, 200);
  assert.equal(vitC.coverageFraction, round(200 / 300));
  assert.equal(vitC.complete, false);
  assert.equal(vitC.missingPortions, 1);
});

test("aggregatePortions: zero known data anywhere yields null, never a fabricated 0", () => {
  const result = aggregatePortions([{ grams: 150, food: foodB }], { nutrients: TEST_NUTRIENTS });
  assert.equal(result.nutrients.iron.amount, null);
  assert.equal(result.nutrients.vitaminC.amount, null);
  assert.equal(result.nutrients.iron.coverageFraction, 0);
  assert.equal(result.totalGrams, 150); // the unknown food's mass still counts toward the day's total
});

test("aggregatePortions: fiber (sourceField) aggregates independently of the micros JSON", () => {
  const result = aggregatePortions(
    [{ grams: 200, food: foodA }, { grams: 100, food: foodB }],
    { nutrients: TEST_NUTRIENTS }
  );
  // foodA fiber 2g/100g*200g=4, foodB fiber 0g/100g*100g=0 (both known, foodB's
  // micros:null does NOT block its fiber column from being read).
  assert.equal(result.nutrients.fiber.amount, 4);
  assert.equal(result.nutrients.fiber.coverageFraction, 1);
});

test("aggregatePortions: a portion with no resolvable food counts its mass but contributes no known nutrients", () => {
  const result = aggregatePortions(
    [{ grams: 100, food: foodA }, { grams: 50, food: null }],
    { nutrients: TEST_NUTRIENTS }
  );
  assert.equal(result.totalGrams, 150);
  assert.equal(result.nutrients.iron.knownGrams, 100);
  assert.equal(result.nutrients.iron.coverageFraction, round(100 / 150));
  assert.equal(result.wholeFoodsWithoutMicros, 1);
  assert.equal(result.wholeFoodsWithMicros, 1);
});

test("aggregatePortions: non-positive or non-numeric grams are ignored, not treated as zero-weight data", () => {
  const result = aggregatePortions(
    [{ grams: 0, food: foodA }, { grams: -5, food: foodA }, { grams: NaN, food: foodA }, { grams: 100, food: foodA }],
    { nutrients: TEST_NUTRIENTS }
  );
  assert.equal(result.portionCount, 1);
  assert.equal(result.totalGrams, 100);
});

test("aggregatePortions: empty portion list is honestly empty, not zero", () => {
  const result = aggregatePortions([], { nutrients: TEST_NUTRIENTS });
  assert.equal(result.totalGrams, 0);
  for (const key of Object.keys(result.nutrients)) {
    assert.equal(result.nutrients[key].amount, null);
    assert.equal(result.nutrients[key].coverageFraction, 0);
  }
});

// ---------------------------------------------------------------------
// targetPct — unit-correct comparison against the registry's reference target
// ---------------------------------------------------------------------

test("pctOfTarget: computes percent-of-target in the nutrient's own canonical unit", () => {
  // iron target is 18mg (minimum); 25mg known -> ~138.89%
  assert.equal(pctOfTarget(25, "mg", IRON.target), round((25 / 18) * 100, 2));
});

test("pctOfTarget: null when there is no known amount (never divides a fabricated number)", () => {
  assert.equal(pctOfTarget(null, "mg", IRON.target), null);
});

test("pctOfTarget: null when the nutrient itself has no established target", () => {
  const sugars = getNutrient("sugarsTotal");
  assert.equal(sugars.target.amount, null);
  assert.equal(pctOfTarget(40, "g", sugars.target), null);
});

test("aggregatePortions: targetPct flows through end to end and is unit-correct", () => {
  const result = aggregatePortions([{ grams: 200, food: foodA }, { grams: 100, food: foodC }], { nutrients: TEST_NUTRIENTS });
  assert.equal(result.nutrients.iron.targetPct, round((25 / 18) * 100, 2));
});

// ---------------------------------------------------------------------
// Adapters — recipe ingredients / plan-slot ingredients -> portions
// ---------------------------------------------------------------------

test("portionsFromRecipeIngredients: uses baseGrams as-is (Recipe's cached macros are computed the same way)", () => {
  const portions = portionsFromRecipeIngredients([
    { baseGrams: 150, food: foodA },
    { baseGrams: 50, food: foodC },
  ]);
  const result = aggregatePortions(portions, { nutrients: TEST_NUTRIENTS });
  // iron: 10*1.5 + 5*0.5 = 15 + 2.5 = 17.5
  assert.equal(result.nutrients.iron.amount, 17.5);
  assert.equal(result.totalGrams, 200);
});

test("portionsFromPlanSlotIngredients: resolves foodId -> Food via the provided map", () => {
  const foodsById = new Map([["f1", foodA], ["f3", foodC]]);
  const portions = portionsFromPlanSlotIngredients(
    [{ foodId: "f1", name: "Food A", grams: 200, role: "protein" }, { foodId: "f3", name: "Food C", grams: 100, role: "veg" }],
    foodsById
  );
  const result = aggregatePortions(portions, { nutrients: TEST_NUTRIENTS });
  assert.equal(result.nutrients.iron.amount, 25);
});

test("portionsFromPlanSlotIngredients: a foodId absent from the map resolves to an honestly-unknown portion, never throws", () => {
  const foodsById = new Map([["f1", foodA]]);
  const portions = portionsFromPlanSlotIngredients(
    [{ foodId: "f1", grams: 100, name: "Food A" }, { foodId: "stale-id", grams: 50, name: "Deleted Food" }],
    foodsById
  );
  const result = aggregatePortions(portions, { nutrients: TEST_NUTRIENTS });
  assert.equal(result.totalGrams, 150);
  assert.equal(result.nutrients.iron.knownGrams, 100);
  assert.ok(result.nutrients.iron.coverageFraction < 1);
});

test("portionsFromPlanSlotIngredients: handles an empty/missing ingredients array", () => {
  assert.deepEqual(portionsFromPlanSlotIngredients(undefined, new Map()), []);
  assert.deepEqual(portionsFromPlanSlotIngredients([], new Map()), []);
});

// ---------------------------------------------------------------------
// summarizeCoverage
// ---------------------------------------------------------------------

test("summarizeCoverage: buckets nutrients into fully-known / partial / no-data", () => {
  // foodA covers iron+vitaminC+fiber fully; foodC lacks vitaminC.
  const result = aggregatePortions([{ grams: 100, food: foodA }, { grams: 100, food: foodC }], { nutrients: TEST_NUTRIENTS });
  const summary = summarizeCoverage(result);
  assert.equal(summary.totalNutrients, 3);
  assert.equal(summary.fullyKnown, 2); // iron, fiber
  assert.equal(summary.partial, 1); // vitaminC
  assert.equal(summary.noData, 0);
});

test("summarizeCoverage: an entirely-unresolved day reports every nutrient as no-data", () => {
  const result = aggregatePortions([{ grams: 100, food: null }], { nutrients: TEST_NUTRIENTS });
  const summary = summarizeCoverage(result);
  assert.equal(summary.noData, 3);
  assert.equal(summary.fullyKnown, 0);
  assert.equal(summary.partial, 0);
});

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
