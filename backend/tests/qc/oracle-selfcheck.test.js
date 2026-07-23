// Phase 0.5 — oracle self-validation gate (QC gauntlet v2).
//
// A buggy oracle silently drives every P0/P1 decision, so before trusting any
// verdict we prove: (1) the oracle's inlined policy constants still equal the
// real engine's (drift guard — the price of not importing them); (2) the
// independent allergen matcher gets hand-labeled positives AND false-exclusion
// negatives right; (3) the oracle reproduces known-ground-truth verdicts,
// including a buried allergen deep in an ingredient list. Failing this is
// STOP-AND-SURFACE; the run must not proceed to Phase 1 on failure.

const test = require("node:test");
const assert = require("node:assert");
const { createRequire } = require("node:module");
const req = createRequire(__filename);

const planner = req("../../src/lib/weeklyPlanner.js");
const solver = req("../../src/lib/mealSolver.js");

let O; // the ESM oracle module, loaded once
test.before(async () => { O = await import("../../scripts/qc/oracle.mjs"); });

// ── (1) drift guard: inlined constants must equal the real engine ──────────
test("0.5 drift-guard: oracle constants equal the engine's", () => {
  const c = O.ORACLE_CONSTANTS;
  // SCALE_BOUNDS is an object {min,max} in the engine, not a tuple.
  assert.equal(c.SCALE_LO, planner.SCALE_BOUNDS.min, "SCALE_LO drifted");
  assert.equal(c.SCALE_HI, planner.SCALE_BOUNDS.max, "SCALE_HI drifted");
  assert.equal(c.REPEAT_CAP, planner.DEFAULT_REPEAT_CAP, "REPEAT_CAP drifted");
  assert.equal(c.KCAL_SILENT, solver.DAY_KCAL_TOLERANCE_PCT, "KCAL_SILENT drifted");
  assert.equal(c.PROTEIN_SILENT, solver.DAY_PROTEIN_TOLERANCE_PCT, "PROTEIN_SILENT drifted");
});

// ── (2) allergen matcher: positives AND false-exclusion negatives ──────────
test("0.5 allergen matcher: derived terms hit", () => {
  const A = () => O.AUDIT_ALLERGENS;
  assert.ok(O.hitsAny("Whey protein isolate", A().dairy), "whey should hit dairy");
  assert.ok(O.hitsAny("Casein powder", A().dairy), "casein should hit dairy");
  assert.ok(O.hitsAny("Semolina pasta", A().gluten), "semolina should hit gluten");
  assert.ok(O.hitsAny("Seitan strips", A().gluten), "seitan should hit gluten");
  assert.ok(O.hitsAny("Soy lecithin", A().soy), "lecithin should hit soy");
  assert.ok(O.hitsAny("Edamame beans", A().soy), "edamame should hit soy");
  assert.ok(O.hitsAny("Surimi sticks", A().fish), "surimi should hit fish");
  assert.ok(O.hitsAny("Tahini paste", A().sesame), "tahini should hit sesame");
});
test("0.5 allergen matcher: false-exclusion guards hold", () => {
  const A = () => O.AUDIT_ALLERGENS;
  // Dairy is checked WITH stripDairy=true in production, so the guards are too.
  assert.ok(!O.hitsAny("Coconut milk", A().dairy, true), "coconut milk is NOT dairy");
  assert.ok(!O.hitsAny("Almond milk, unsweetened", A().dairy, true), "almond milk is NOT dairy");
  assert.ok(!O.hitsAny("Butter beans, canned", A().dairy, true), "butter beans are NOT dairy");
  assert.ok(!O.hitsAny("Cocoa butter", A().dairy, true), "cocoa butter is NOT dairy");
  assert.ok(!O.hitsAny("Water chestnut", A().nuts), "water chestnut is NOT a tree nut");
  // The peanut-butter regression: it must NOT read as dairy (via "butter") but
  // MUST still read as peanuts. Dairy stripping is category-scoped.
  assert.ok(!O.hitsAny("Peanut Butter", A().dairy, true), "peanut butter is NOT dairy");
  assert.ok(O.hitsAny("Peanut Butter", A().peanuts), "peanut butter IS peanuts");
  assert.ok(O.hitsAny("Almond butter", A().nuts), "almond butter IS a tree nut");
  assert.ok(!O.hitsAny("Chicken with water chestnut", A().nuts), "homograph must not mask, and chestnut here is water chestnut");
});

// ── fixture factory: a minimal runSolve-shaped result + ctx ────────────────
function macroTarget(kcal = 2000, proteinLo = 150) {
  return { kcal, proteinLo, proteinHi: proteinLo + 10, fatLo: 50, fatHi: 70, carbLo: 100, carbMid: 150, carbHi: 200 };
}
function foods(rows) { return new Map(rows.map((r) => [r.id, r])); }
function makeRes(over = {}) {
  const base = {
    seed: 1, corner: { diet: "none", allergyStack: "none" }, solveMs: 5,
    crash: null, diagnosis: null,
    energy: { tdee: 2500, rmr: 1700 },
    inputs: { profile: { sex: "M", floorKcal: null }, dietProfile: { excludedFoods: [], dietaryStyle: null }, mealConfig: { meals: 3, snacks: 0 } },
    derived: { target: 2000, floored: false },
    target: macroTarget(),
    counts: { raw: 100, afterDiet: 100, afterPrep: 100 },
    _pool: [{ slotType: "meal", kcal: 700, protein: 60 }, { slotType: "meal", kcal: 500, protein: 40 }],
    slots: [],
  };
  return { ...base, ...over, inputs: { ...base.inputs, ...(over.inputs || {}) } };
}
function slot(day, foodsList, over = {}) {
  const kcal = foodsList.reduce((a, f) => a + f.k * f.g / 100, 0);
  const protein = foodsList.reduce((a, f) => a + f.p * f.g / 100, 0);
  return { dayOfWeek: day, slotType: "meal", slotIndex: 0, recipeId: "r1", proteinScale: 1, sidesScale: 1, kcal, protein, ingredients: foodsList.map((f) => ({ foodId: f.id, name: f.name, grams: f.g })), ...over };
}

// ── (3) verdict reproduction on known ground truth ─────────────────────────
test("0.5 verdict: a clean single-day plan yields no P0", () => {
  const fb = foods([{ id: "a", kcal: 200, protein: 30, fat: 5, carb: 5 }, { id: "b", kcal: 150, protein: 10, fat: 2, carb: 20 }]);
  const s = slot(1, [{ id: "a", name: "Chicken breast", k: 200, p: 30, g: 300 }, { id: "b", name: "White rice", k: 150, p: 10, g: 400 }]);
  const res = makeRes({ slots: [s], target: macroTarget(1200, 60) });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.equal(o.allergyLeaks, 0); assert.equal(o.macroDrift, 0); assert.equal(o.crash, false);
});

test("0.5 verdict: a dairy ingredient reaches a dairy-excluded user -> P0 allergy-leak", () => {
  const fb = foods([{ id: "a", kcal: 60, protein: 3, fat: 3, carb: 5 }]);
  const s = slot(1, [{ id: "a", name: "Whey protein powder", k: 60, p: 3, g: 100 }]);
  const res = makeRes({ slots: [s], inputs: { dietProfile: { excludedFoods: ["dairy"], dietaryStyle: null }, profile: { sex: "M", floorKcal: null }, mealConfig: { meals: 3, snacks: 0 } } });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.allergyLeaks >= 1, "whey must be flagged for a dairy-excluded user");
  assert.equal(o.outcome, "unsafe");
});

test("0.5 verdict: BURIED allergen deep in a long ingredient list is caught", () => {
  const rows = [];
  const ings = [];
  for (let i = 0; i < 11; i++) { rows.push({ id: `f${i}`, kcal: 50, protein: 2, fat: 1, carb: 5 }); ings.push({ id: `f${i}`, name: `Filler veg ${i}`, k: 50, p: 2, g: 50 }); }
  ings[9].name = "Caesar dressing (contains anchovy)"; // buried at position 10 of 11
  const fb = foods(rows);
  const s = slot(1, ings);
  const res = makeRes({ slots: [s], inputs: { dietProfile: { excludedFoods: ["fish"], dietaryStyle: null }, profile: { sex: "M", floorKcal: null }, mealConfig: { meals: 3, snacks: 0 } } });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.allergyLeaks >= 1, "anchovy buried at position 10 must still be caught for a fish-excluded user");
});

test("0.5 verdict: target below the floor -> P0 floor-breach", () => {
  const fb = foods([{ id: "a", kcal: 100, protein: 10, fat: 2, carb: 5 }]);
  const s = slot(1, [{ id: "a", name: "Egg white", k: 100, p: 10, g: 100 }]);
  // RMR 1700 -> floor = round(1700*0.95)=1615; target 1400 breaches it.
  const res = makeRes({ slots: [s], derived: { target: 1400, floored: true } });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.findings.some((f) => f.kind === "kcal-floor-breach"), "1400 < 1615 floor must breach");
});

test("0.5 verdict: portion scale beyond 2x -> P0 portion-bound", () => {
  const fb = foods([{ id: "a", kcal: 100, protein: 10, fat: 2, carb: 5 }]);
  const s = slot(1, [{ id: "a", name: "Oats", k: 100, p: 10, g: 100 }], { proteinScale: 3.0 });
  const res = makeRes({ slots: [s] });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.portionViolations >= 1, "scale 3.0 must violate the 0.5-2x bound");
});

test("0.5 verdict: solver macros that disagree with ingredient sums -> P0 macro-drift", () => {
  const fb = foods([{ id: "a", kcal: 100, protein: 10, fat: 2, carb: 5 }]);
  // slot claims 999 kcal but 100g of a 100-kcal/100g food is 100 kcal.
  const s = slot(1, [{ id: "a", name: "Oats", k: 100, p: 10, g: 100 }], { kcal: 999, protein: 999 });
  const res = makeRes({ slots: [s] });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.macroDrift >= 1, "999 vs 100 kcal must register as drift");
});

test("0.5 verdict: chicken on a vegan plan -> P0 diet-style-leak", () => {
  const fb = foods([{ id: "a", kcal: 200, protein: 30, fat: 5, carb: 0 }]);
  const s = slot(1, [{ id: "a", name: "Grilled chicken thigh", k: 200, p: 30, g: 150 }]);
  const res = makeRes({ slots: [s], inputs: { dietProfile: { excludedFoods: [], dietaryStyle: "vegan" }, profile: { sex: "M", floorKcal: null }, mealConfig: { meals: 3, snacks: 0 } } });
  const o = O.oracle(res, { foodById: fb, recipeById: new Map([["r1", { name: "R", slotType: "meal", mealCategory: null }]]) });
  assert.ok(o.findings.some((f) => f.kind === "diet-style-leak"), "chicken on vegan must leak");
});
