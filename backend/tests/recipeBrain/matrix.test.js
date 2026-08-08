const { test } = require("node:test");
const assert = require("node:assert/strict");

const { compileMatrix, matrixFromSpec, judge, rankPool, BIAS_MAX } = require("../../src/lib/recipeBrain/matrix.js");
const { buildSpec } = require("../../src/lib/recipeBrain/spec.js");

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE BRAIN — the adherence matrix. Composition only: these tests assert
// that the matrix GATES with recipeCost's five-filter caps and ORDERS with
// mealSolver's soft biases — and that soft matches can never buy a candidate
// past a failed cap. Pure, zero network, zero DB.
// ─────────────────────────────────────────────────────────────────────────────

const food = (name, kcal, protein, fat, carb, over = {}) => ({ name, category: "other", kcal, protein, fat, carb, fiber: 0, ...over });
const ing = (f, baseGrams, role, scalable = true) => ({ foodId: f.name, baseGrams, role, scalable, food: f });
const recipe = (id, name, ings, over = {}) => {
  const t = ings.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name, slotType: "meal", mealCategory: null, source: "curated", steps: ["Cook it."], cuisine: null, prepTimeMin: 20, ingredients: ings, ...t, ...over };
};

const CHICKEN = food("Chicken breast", 165, 31, 3.6, 0);
const RICE = food("White rice", 130, 2.7, 0.3, 28);

const CHEAP_MEX = recipe("r-mex", "Chicken Burrito Bowl", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")], { cuisine: "mexican", prepTimeMin: 20 });
const SLOW_DISH = recipe("r-slow", "Braised Chicken", [ing(CHICKEN, 180, "protein"), ing(RICE, 120, "carb")], { cuisine: "western-comfort", prepTimeMin: 95 });

test("compileMatrix: filters win, profile back-fills, junk is nulled", () => {
  const m = compileMatrix(
    { cuisines: ["mexican"], maxCostCad: "6", maxComplexity: 4, minTaste: 0.4 },
    { cuisinePreferences: ["italian"], maxPrepMin: 30, budgetTier: "cheap" }
  );
  assert.deepEqual(m.cuisines, ["mexican"]);
  assert.equal(m.maxCostCad, 6);
  assert.equal(m.maxPrepMin, 30);
  assert.equal(m.budget, "cheap");
  const empty = compileMatrix({}, {});
  assert.equal(empty.maxCostCad, null);
  assert.deepEqual(empty.cuisines, []);
});

test("matrixFromSpec round-trips the dials buildSpec compiled", () => {
  const spec = buildSpec({
    target: { slotType: "meal", kcalTarget: 620, proteinTarget: 45 },
    filters: { cuisines: ["mexican"], maxPrepMin: 45, budget: "cheap" },
    profile: {},
  });
  const m = matrixFromSpec(spec);
  assert.deepEqual(m.cuisines, ["mexican"]);
  assert.equal(m.maxPrepMin, 45);
  assert.equal(m.budget, "cheap");
});

test("a set cap gates: the 95-minute dish fails a 45-minute matrix and names TIME as binding", () => {
  const m = compileMatrix({ maxPrepMin: 45 }, {});
  const slow = judge(SLOW_DISH, m);
  const fast = judge(CHEAP_MEX, m);
  assert.equal(slow.passes, false);
  assert.equal(slow.gate.bindingConstraint, "time");
  assert.equal(fast.passes, true);
});

test("an unset cap gates nothing (both pass with no dials)", () => {
  const m = compileMatrix({}, {});
  assert.equal(judge(SLOW_DISH, m).passes, true);
  assert.equal(judge(CHEAP_MEX, m).passes, true);
});

test("soft prefs order candidates but cannot buy rank past a failed cap", () => {
  const m = compileMatrix({ cuisines: ["mexican"], maxPrepMin: 45 }, {});
  const mex = judge(CHEAP_MEX, m);
  const slow = judge(SLOW_DISH, m); // cuisine miss AND cap fail
  assert.ok(mex.adherence > 0);
  assert.equal(slow.passes, false, "no bias multiplier can un-fail a cap");
  assert.ok(mex.bias > slow.bias, "cuisine match biases up, miss biases down");
  assert.ok(mex.bias / BIAS_MAX <= 1);
});

test("rankPool orders cap-passers by adherence and explains an emptied pool with the measured binding cap", () => {
  const pool = [CHEAP_MEX, SLOW_DISH];
  const open = rankPool(pool, compileMatrix({ cuisines: ["mexican"] }, {}));
  assert.equal(open.ordered.length, 2);
  assert.equal(open.ordered[0].recipe.id, "r-mex", "the cuisine match outranks");

  const strangled = rankPool(pool, compileMatrix({ maxPrepMin: 10 }, {}));
  assert.equal(strangled.ordered.length, 0);
  assert.equal(strangled.explain.ok, false);
  assert.equal(strangled.explain.bindingConstraint, "time", "the empty pool is EXPLAINED, not shrugged at");
  assert.match(strangled.explain.message, /TIME/);
});

test("thumbs ratings re-rank identical candidates without excluding the disliked one", () => {
  const twinA = { ...CHEAP_MEX, id: "r-a", name: "Bowl A" };
  const twinB = { ...CHEAP_MEX, id: "r-b", name: "Bowl B" };
  const ratings = new Map([["r-b", 1], ["r-a", -1]]);
  const { ordered } = rankPool([twinA, twinB], compileMatrix({}, {}), { ratings });
  assert.equal(ordered.length, 2, "a thumbs-down is soft — the recipe stays in the pool");
  assert.equal(ordered[0].recipe.id, "r-b", "the liked twin wins the tie");
});

test("rank determinism: equal adherence breaks ties by id, not by insertion luck", () => {
  const twinA = { ...CHEAP_MEX, id: "r-zz", name: "Bowl Z" };
  const twinB = { ...CHEAP_MEX, id: "r-aa", name: "Bowl A" };
  const r1 = rankPool([twinA, twinB], compileMatrix({}, {}));
  const r2 = rankPool([twinB, twinA], compileMatrix({}, {}));
  assert.deepEqual(r1.ordered.map((x) => x.recipe.id), r2.ordered.map((x) => x.recipe.id));
});
