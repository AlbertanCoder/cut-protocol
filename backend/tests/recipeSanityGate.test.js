// recipeSanityGate.test.js — the plausibility gate, locked against the
// measured library corruption it exists to catch (docs/AUDIT.md §5.2).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sanityCheckRecipe, BOUNDS } = require("../src/lib/recipeSanityGate");
const { macroTotals } = require("../src/lib/nutritionCore");

const FOODS = new Map([
  [1, { kcal: 118, protein: 8.3, fat: 0.4, carb: 21.1, fiber: 8.3, category: "pantry" }],  // split peas cooked
  [2, { kcal: 177, protein: 24.1, fat: 8.2, carb: 0, fiber: 0, category: "protein" }],     // chicken thigh
  [3, { kcal: 130, protein: 2.7, fat: 0.3, carb: 28.2, fiber: 0.4, category: "pantry" }],  // rice
  [4, { kcal: 23, protein: 3.2, fat: 0.6, carb: 2.7, fiber: 1.6, category: "spices" }],    // basil, fresh
  [5, { kcal: 15, protein: 0.7, fat: 0.1, carb: 3.6, fiber: 0.5, category: "produce" }],   // cucumber
]);

function check(ingredients) {
  const { totals } = macroTotals(ingredients, FOODS);
  const named = ingredients.map((i) => ({ ...i, name: `food#${i.foodId}` }));
  return sanityCheckRecipe({ name: "fixture", ingredients: named }, { totals, foodsById: FOODS });
}

test("THE known corruption shape: 10,000 g of peas in one serving FAILS twice over", () => {
  const r = check([{ foodId: 1, grams: 10000 }]);
  assert.equal(r.ok, false);
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes("implausible-ingredient-grams"), "grams bound must fire");
  assert.ok(codes.includes("kcal-above-ceiling"), "11,800 kcal/serving must fail the recipe ceiling");
});

test("a normal plate passes clean", () => {
  const r = check([{ foodId: 2, grams: 165 }, { foodId: 3, grams: 200 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("300 g of basil against 100 g of cucumber — the measured absurdity — fails on the seasoning bound", () => {
  const r = check([{ foodId: 4, grams: 300 }, { foodId: 5, grams: 100 }]);
  assert.equal(r.ok, false);
  const hit = r.issues.find((i) => i.code === "implausible-ingredient-grams");
  assert.ok(hit, "seasoning fail bound must fire at 300 g");
  assert.match(hit.message, /seasoning/);
});

test("a hearty single-food portion warns without failing — the gate catches data errors, not appetites", () => {
  const r = check([{ foodId: 3, grams: 700 }]); // 910 kcal of rice — big, legal
  assert.equal(r.ok, true, "700 g of rice is a warn, not a fail");
  assert.ok(r.issues.some((i) => i.code === "suspicious-ingredient-grams" && i.severity === "warn"));
});

test("bounds are PER RECIPE, so OMAD never conflicts: two 1,200 kcal recipes both pass; the 2,400 kcal day is the slot's business", () => {
  const dish = [{ foodId: 2, grams: 500 }, { foodId: 3, grams: 380 }]; // ≈ 1,379 kcal
  const r = check(dish);
  const kcalIssues = r.issues.filter((i) => i.code.startsWith("kcal"));
  assert.deepEqual(kcalIssues, [], "a big single dish inside the 1,400 ceiling is legal");
});

test("kcal floor: a 40 kcal 'recipe' is a garnish, not a meal candidate", () => {
  const r = check([{ foodId: 5, grams: 250 }]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "kcal-below-floor"));
});

test("protein ceiling fires past 100 g/serving", () => {
  const r = check([{ foodId: 2, grams: 450 }]); // 108 g protein, 797 kcal
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "protein-above-ceiling"));
});

test("zero and negative grams are refused outright", () => {
  const r = check([{ foodId: 2, grams: 0 }, { foodId: 3, grams: -5 }]);
  assert.equal(r.ok, false);
  assert.equal(r.issues.filter((i) => i.code === "zero-or-negative-grams").length, 2);
});

test("seasoning bounds fire on REAL food names, not only on the synthetic 'spices' category (review finding)", () => {
  // No production Food row carries category "spices" — the original
  // category-only check was dead code and 300 g of real basil sailed
  // through. Detection now also keys off the store-section classifier.
  const basil = new Map([[9, { kcal: 23, protein: 3.2, fat: 0.6, carb: 2.7, fiber: 1.6, category: "fruit-veg" }]]);
  const r = sanityCheckRecipe(
    { name: "real-name fixture", ingredients: [{ name: "Basil, fresh", grams: 300, foodId: 9 }] },
    { totals: null, foodsById: basil }
  );
  assert.equal(r.ok, false);
  const hit = r.issues.find((i) => i.code === "implausible-ingredient-grams");
  assert.ok(hit, "300 g of 'Basil, fresh' must fail the seasoning bound by NAME");
  assert.match(hit.message, /seasoning/);
});

test("the bounds object is exported and carries the directive's numbers", () => {
  assert.equal(BOUNDS.kcalMinPerServing, 150);
  assert.equal(BOUNDS.kcalMaxPerServing, 1400);
  assert.equal(BOUNDS.proteinMaxGPerServing, 100);
});
