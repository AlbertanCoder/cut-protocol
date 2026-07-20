// Stage G — multi-constraint scoring. The Stage-E SOFT ConstraintSet becomes
// deterministic penalty terms; a soft pref never overrides a HARD constraint;
// constraints with no per-recipe data are reported (noSignal), never scored.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreSoftConstraints, clampSoftWeights, totalCost, DEFAULT_SOFT_WEIGHTS } = require("../../src/lib/brain/softScore.js");
const { compileConstraints } = require("../../src/lib/brain/constraints.js");

const TARGET = { kcal: 2000, proteinLo: 150, proteinHi: 180, carbLo: 150, carbHi: 220, fatLo: 50, fatHi: 70 };
const RECIPES = { r1: { prepTimeMin: 10 }, r2: { prepTimeMin: 30 }, r3: { prepTimeMin: 40 }, rX: { prepTimeMin: null } };
const ctx = { recipeById: (id) => RECIPES[id] || null };

test("clampSoftWeights — defaults, and clamps out-of-range proposals to [0,1]", () => {
  assert.deepEqual(clampSoftWeights(), DEFAULT_SOFT_WEIGHTS);
  const w = clampSoftWeights({ time: 5, batch: -3, budget: 0.5 });
  assert.equal(w.time, 1);
  assert.equal(w.batch, 0);
  assert.equal(w.budget, 0.5);
});

test("time — penalises slots whose prep exceeds the profile's max prep", () => {
  const cs = compileConstraints({ maxPrepMin: 20 }, TARGET);
  const day = { slots: [{ recipeId: "r1" }, { recipeId: "r2" }, { recipeId: "r3" }] };
  const r = scoreSoftConstraints(day, cs, ctx);
  // 2 of 3 recipes exceed 20 min -> 0.4 * (2/3)
  assert.ok(Math.abs(r.terms.time - 0.4 * (2 / 3)) < 1e-9);
  assert.ok(r.cost > 0);
  assert.equal(r.noSignal.includes("time"), false);
});

test("time — noSignal when no picked recipe has a prep time", () => {
  const cs = compileConstraints({ maxPrepMin: 20 }, TARGET);
  const day = { slots: [{ recipeId: "rX" }, { recipeId: "missing" }] };
  const r = scoreSoftConstraints(day, cs, ctx);
  assert.ok(r.noSignal.includes("time"));
  assert.equal("time" in r.terms, false);
});

test("batch — repeats penalised only when batch cooking is disallowed", () => {
  const day = { slots: [{ recipeId: "r1" }, { recipeId: "r1" }, { recipeId: "r2" }] };
  const off = scoreSoftConstraints(day, compileConstraints({ allowBatch: false }, TARGET), ctx);
  assert.ok(off.terms.batch > 0); // 0.3 * (1 - 2/3)
  const on = scoreSoftConstraints(day, compileConstraints({ allowBatch: true }, TARGET), ctx);
  assert.equal("batch" in on.terms, false);
});

test("budget & complexity — active but not scorable -> reported in noSignal", () => {
  const cs = compileConstraints({ budgetTier: "cheap", maxComplexity: 2 }, TARGET);
  const r = scoreSoftConstraints({ slots: [{ recipeId: "r1" }] }, cs, ctx);
  assert.ok(r.noSignal.includes("budget"));
  assert.ok(r.noSignal.includes("complexity"));
  assert.equal("budget" in r.terms, false);
  assert.equal("complexity" in r.terms, false);
});

test("no active soft constraints -> the layer is inert (cost 0, no terms)", () => {
  const cs = compileConstraints({}, TARGET); // only carb/fat bands, which softScore doesn't own
  const r = scoreSoftConstraints({ slots: [{ recipeId: "r1" }, { recipeId: "r2" }] }, cs, ctx);
  assert.equal(r.cost, 0);
  assert.deepEqual(r.terms, {});
  assert.deepEqual(r.noSignal, []);
});

test("proposed weights are clamped before use", () => {
  const cs = compileConstraints({ maxPrepMin: 20 }, TARGET);
  const day = { slots: [{ recipeId: "r2" }, { recipeId: "r3" }] }; // both exceed -> penalty 1.0 before weight
  const r = scoreSoftConstraints(day, cs, ctx, { weights: { time: 999 } });
  assert.equal(r.weights.time, 1); // clamped
  assert.ok(Math.abs(r.terms.time - 1) < 1e-9); // 1.0 * (2/2)
});

test("deterministic — identical inputs give identical output", () => {
  const cs = compileConstraints({ maxPrepMin: 25, allowBatch: false }, TARGET);
  const day = { slots: [{ recipeId: "r1" }, { recipeId: "r1" }, { recipeId: "r3" }] };
  assert.deepEqual(scoreSoftConstraints(day, cs, ctx), scoreSoftConstraints(day, cs, ctx));
});

test("totalCost — soft penalty is purely additive on top of the base objective", () => {
  assert.equal(totalCost({ cost: 0.3 }, { cost: 0.12 }), 0.42);
  assert.equal(totalCost({ cost: 0.3 }, {}), 0.3); // no soft signal -> base unchanged
});
