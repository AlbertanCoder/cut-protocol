const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkFeasibility } = require("../../src/lib/brain/feasibility.js");
const { scorePlan, clampWeights } = require("../../src/lib/brain/scorer.js");
const { verifyPlan } = require("../../src/lib/brain/verifier.js");
const { buildPool } = require("../../src/lib/brain/pool.js");
const { makeTools } = require("../../src/lib/brain/tools.js");

function food(id, kcal, protein, fat, carb) { return { id, name: id, category: "other", kcal, protein, fat, carb }; }
function ing(f, g, role) { return { foodId: f.id, baseGrams: g, scalable: true, role, food: f }; }
const CHICKEN = food("chicken", 165, 31, 3.6, 0);
const RICE = food("rice", 130, 2.7, 0.3, 28);
const CR = { id: "cr", name: "Chicken & Rice", slotType: "meal", mealCategory: null, kcal: 442, protein: 50, fat: 6, carb: 42, ingredients: [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")] };
const RICEBOWL = { id: "rb", name: "Rice Bowl", slotType: "meal", mealCategory: null, kcal: 400, protein: 5, fat: 5, carb: 80, ingredients: [ing(RICE, 300, "carb")] };

// ── feasibility ──
test("checkFeasibility: empty pool → infeasible, names empty-pool, zero cost", () => {
  const f = checkFeasibility(buildPool({}, { recipes: [], foods: [] }), { kcal: 2000, proteinLo: 150, proteinHi: 170 });
  assert.equal(f.feasible, false);
  assert.equal(f.bindingConstraint, "empty-pool");
});
test("checkFeasibility: protein-density unreachable → names protein-density", () => {
  const f = checkFeasibility(buildPool({}, { recipes: [RICEBOWL], foods: [] }), { kcal: 2000, proteinLo: 250, proteinHi: 270 });
  assert.equal(f.feasible, false);
  assert.equal(f.bindingConstraint, "protein-density");
});
test("checkFeasibility: reachable target → feasible", () => {
  const f = checkFeasibility(buildPool({}, { recipes: [CR], foods: [] }), { kcal: 2000, proteinLo: 150, proteinHi: 170 });
  assert.equal(f.feasible, true);
});

// ── scorer ──
test("scorer: proposed weights are clamped to [0,1] — a raw model weight never gets through", () => {
  const w = clampWeights({ protein: 99, kcal: -5, variety: 0.5 });
  assert.equal(w.protein, 1);
  assert.equal(w.kcal, 0);
  assert.equal(w.variety, 0.5);
});
test("scorer: on-target day scores ~1, a protein-short day scores lower", () => {
  const target = { kcal: 2000, proteinLo: 150, proteinHi: 170, fatLo: 40, fatHi: 80, carbLo: 150, carbHi: 260 };
  const good = scorePlan({ slots: [], totals: { kcal: 2000, protein: 160, fat: 60, carb: 200 } }, target);
  const short = scorePlan({ slots: [], totals: { kcal: 2000, protein: 90, fat: 60, carb: 200 } }, target);
  assert.ok(good.score > 0.95 && good.score > short.score);
});

// ── verifier (the gate) ──
function poolTools() {
  const pool = buildPool({}, { recipes: [CR], foods: [CHICKEN, RICE] });
  return { pool, tools: makeTools(pool) };
}
test("verifier: passes a slot whose macros came from the tool layer", () => {
  const { pool, tools } = poolTools();
  const scaled = tools.scaleRecipe({ recipeId: "cr", kcalTarget: 600, proteinTarget: 45 });
  const v = verifyPlan({ slots: [{ recipeId: "cr", kcalTarget: 600, proteinTarget: 45, macros: scaled.value, prov: scaled.prov }] }, { pool, profile: {}, tools });
  assert.equal(v.ok, true, JSON.stringify(v.rejections));
});
test("verifier: REJECTS a smuggled macro number (model tried to set kcal/protein)", () => {
  const { pool, tools } = poolTools();
  const v = verifyPlan({ slots: [{ recipeId: "cr", kcalTarget: 600, proteinTarget: 45, macros: { kcal: 5, protein_g: 999, carb_g: 0, fat_g: 0 }, prov: { formulaId: "x", inputs: {}, value: 5 } }] }, { pool, profile: {}, tools });
  assert.equal(v.ok, false);
  assert.ok(v.rejections.some((r) => r.code === "macro-mismatch"));
});
test("verifier: REJECTS an untraceable number (no prov)", () => {
  const { pool, tools } = poolTools();
  const scaled = tools.scaleRecipe({ recipeId: "cr", kcalTarget: 600, proteinTarget: 45 });
  const v = verifyPlan({ slots: [{ recipeId: "cr", kcalTarget: 600, proteinTarget: 45, macros: scaled.value }] }, { pool, profile: {}, tools });
  assert.equal(v.ok, false);
  assert.ok(v.rejections.some((r) => r.code === "untraceable-number"));
});
test("verifier: REJECTS an unknown/excluded recipe id (structural)", () => {
  const { pool, tools } = poolTools();
  const v = verifyPlan({ slots: [{ recipeId: "ghost", kcalTarget: 600, proteinTarget: 45 }] }, { pool, profile: {}, tools });
  assert.equal(v.ok, false);
  assert.ok(v.rejections.some((r) => r.code === "unknown-or-excluded-recipe"));
});
