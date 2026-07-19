const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scaleRecipe } = require("../../src/lib/weeklyPlanner.js");
const { solvePortions } = require("../../src/lib/brain/optimizer.js");

// Golden lock: the optimizer's k=2 solve must reproduce the legacy 2-factor
// solver (weeklyPlanner.scaleRecipe) BYTE-FOR-BYTE on the two scale factors.
// Recipes here have NO fixed (non-scalable) ingredients, so the bundle target
// equals the recipe target and both the Cramer and uniform-fallback branches
// line up exactly with scaleRecipe.

const round2 = (n) => Math.round(n * 100) / 100;
function food(id, kcal, protein, fat, carb) { return { id, name: id, kcal, protein, fat, carb }; }
function bundle(ings) {
  return ings.reduce(
    (s, i) => { const f = i.baseGrams / 100; return { kcal: s.kcal + i.food.kcal * f, protein: s.protein + i.food.protein * f, fat: s.fat + i.food.fat * f, carb: s.carb + i.food.carb * f }; },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}
// Recipe with two scalable ingredients: one protein-role, one non-protein.
function recipe2(proteinIng, restIng) {
  const ingredients = [proteinIng, restIng];
  const t = bundle(ingredients);
  return { id: "r", name: "r", ingredients, kcal: t.kcal, protein: t.protein, fat: t.fat, carb: t.carb };
}
function ing(food, grams, role) { return { foodId: food.id, baseGrams: grams, scalable: true, role, food }; }

// Build the same protein/rest bundles scaleRecipe builds internally.
function bundlesOf(recipe) {
  const scal = recipe.ingredients.filter((i) => i.scalable);
  return [bundle(scal.filter((i) => i.role === "protein")), bundle(scal.filter((i) => i.role !== "protein"))];
}

function assertParity(recipe, kcalTarget, proteinTarget, label) {
  const legacy = scaleRecipe(recipe, kcalTarget, proteinTarget);
  const [pb, rb] = bundlesOf(recipe);
  const { scales } = solvePortions([pb, rb], { kcal: kcalTarget, protein: proteinTarget });
  assert.equal(round2(scales[0]), legacy.proteinScale, `${label}: proteinScale parity`);
  assert.equal(round2(scales[1]), legacy.sidesScale, `${label}: sidesScale parity`);
}

const CHICKEN = food("chicken", 165, 31, 3.6, 0);
const RICE = food("rice", 130, 2.7, 0.3, 28);
const OATS = food("oats", 389, 17, 7, 66);
const BROCCOLI = food("broccoli", 34, 2.8, 0.4, 7);

test("k=2 == scaleRecipe: non-degenerate Cramer solve across a range of targets", () => {
  const r = recipe2(ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb"));
  for (const [kcal, protein] of [[600, 45], [500, 40], [700, 55], [450, 38], [800, 60]]) {
    assertParity(r, kcal, protein, `chicken+rice ${kcal}/${protein}`);
  }
});

test("k=2 == scaleRecipe: targets that clamp to the [0.5, 2] bounds", () => {
  const r = recipe2(ing(CHICKEN, 150, "protein"), ing(OATS, 80, "carb"));
  for (const [kcal, protein] of [[200, 10], [2000, 200], [150, 5], [3000, 300]]) {
    assertParity(r, kcal, protein, `clamp ${kcal}/${protein}`);
  }
});

test("k=2 == scaleRecipe: degenerate (no protein-role ingredient) uniform fallback", () => {
  // Two non-protein ingredients -> scaleRecipe takes its single-uniform-scale
  // branch; the optimizer's noProteinBundle branch must match it exactly.
  const r = recipe2(ing(RICE, 150, "carb"), ing(BROCCOLI, 150, "veg"));
  for (const [kcal, protein] of [[500, 20], [300, 10], [900, 40]]) {
    assertParity(r, kcal, protein, `degenerate ${kcal}/${protein}`);
  }
});

test("solvePortions is deterministic — identical inputs, identical output", () => {
  const cands = [{ kcal: 300, protein: 25, fat: 5, carb: 20 }, { kcal: 250, protein: 3, fat: 2, carb: 45 }, { kcal: 120, protein: 20, fat: 1, carb: 4 }];
  const a = solvePortions(cands, { kcal: 700, protein: 55 });
  const b = solvePortions(cands, { kcal: 700, protein: 55 });
  assert.deepEqual(a.scales, b.scales, "general-path k=3 solve is reproducible");
  assert.ok(a.scales.every((x) => x >= 0.5 && x <= 2), "scales respect the box bounds");
});
