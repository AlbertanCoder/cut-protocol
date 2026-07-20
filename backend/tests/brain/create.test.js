// Stage F — recipe generation under the selection/verification fence. The model
// proposes STRUCTURE ONLY; the deterministic layer owns every number and the
// verifier gates it. These tests are keyless — the LLM is a mock runLoop, and
// the gated orchestrator proves ZERO real calls on the dormant path.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateRecipe, resolveStructure, assembleRecipe, scaleToTarget, verifyGeneratedRecipe, parseStructure } = require("../../src/lib/brain/create.js");
const { macrosFromItems } = require("../../src/lib/brain/tools.js");

const food = (id, name, m) => ({ id, name, category: "x", kcal: m.kcal, protein: m.protein, carb: m.carb, fat: m.fat });
const CHICKEN = food("f1", "Chicken breast", { kcal: 165, protein: 31, carb: 0, fat: 3.6 });
const RICE = food("f2", "White rice cooked", { kcal: 130, protein: 2.7, carb: 28, fat: 0.3 });
const BROCCOLI = food("f3", "Broccoli", { kcal: 34, protein: 2.8, carb: 7, fat: 0.4 });
const PORK = food("f9", "Pork belly", { kcal: 518, protein: 9, carb: 0, fat: 53 });

const POOL = { recipes: new Map(), foods: new Map([["f1", CHICKEN], ["f2", RICE], ["f3", BROCCOLI]]), excludedIds: new Set() };
const PROFILE = { dietaryStyle: "none", excludedFoods: [] };

const mockLoop = (structure) => async () => ({ content: [{ type: "text", text: JSON.stringify(structure) }], calls: [], stop: "end_turn" });

// ---- parse / resolve: the "no invented foods" + LAW-1 strip -----------------

test("parseStructure keeps only foodId/grams/role — model macros are dropped (LAW 1)", () => {
  const s = parseStructure([{ type: "text", text: JSON.stringify({ name: "x", ingredients: [{ foodId: "f1", grams: 200, role: "protein", kcal: 99999, protein: 99999 }] }) }]);
  assert.equal(s.ingredients.length, 1);
  assert.deepEqual(s.ingredients[0], { foodId: "f1", grams: 200, role: "protein" });
  assert.equal("kcal" in s.ingredients[0], false);
});

test("resolveStructure resolves real foods and strips any attached macro", () => {
  const r = resolveStructure({ name: "Bowl", ingredients: [{ foodId: "f1", grams: 200, role: "protein", kcal: 5 }, { foodId: "f2", grams: 150 }] }, POOL, PROFILE);
  assert.equal(r.ok, true);
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.ingredients[0].food, CHICKEN);
  assert.equal("kcal" in r.ingredients[0], false);
});

test("resolveStructure FAILS CLOSED on an invented food — never guesses", () => {
  const r = resolveStructure({ ingredients: [{ foodId: "f1", grams: 200 }, { foodId: "INVENTED_X", grams: 100 }] }, POOL, PROFILE);
  assert.equal(r.ok, false);
  assert.ok(r.rejected.some((x) => x.code === "unknown-food" && x.foodId === "INVENTED_X"));
});

test("resolveStructure re-checks exclusions (defense in depth)", () => {
  const pool = { ...POOL, foods: new Map([...POOL.foods, ["f9", PORK]]) };
  const r = resolveStructure({ ingredients: [{ foodId: "f9", grams: 100 }] }, pool, { dietaryStyle: "none", excludedFoods: ["pork"] });
  assert.equal(r.ok, false);
  assert.ok(r.rejected.some((x) => x.code === "excluded-food"));
});

test("resolveStructure rejects non-positive grams", () => {
  const r = resolveStructure({ ingredients: [{ foodId: "f1", grams: 0 }] }, POOL, PROFILE);
  assert.equal(r.ok, false);
  assert.ok(r.rejected.some((x) => x.code === "bad-grams"));
});

// ---- assemble / scale: authoritative, deterministic -------------------------

test("assembleRecipe computes macros from source only", () => {
  const rec = assembleRecipe(resolveStructure({ name: "x", ingredients: [{ foodId: "f1", grams: 200, role: "protein" }, { foodId: "f2", grams: 150 }] }, POOL, PROFILE));
  // chicken 200g (330,62,0,7.2) + rice 150g (195,4.05,42,0.45)
  assert.ok(Math.abs(rec.kcal - 525) < 0.01);
  assert.ok(Math.abs(rec.protein - 66.05) < 0.01);
  assert.equal(rec.source, "ai-generated");
  assert.equal(rec.prov.formulaId, "macrosFromItems");
});

test("scaleToTarget is deterministic, 5g-rounded, and re-derives macros from source", () => {
  const rec = assembleRecipe(resolveStructure({ ingredients: [{ foodId: "f1", grams: 100, role: "protein" }, { foodId: "f2", grams: 100 }] }, POOL, PROFILE));
  const target = { kcal: 600, protein: 60 };
  const a = scaleToTarget(rec, target);
  const b = scaleToTarget(rec, target);
  assert.deepEqual(a.recipe.ingredients.map((i) => i.grams), b.recipe.ingredients.map((i) => i.grams)); // deterministic
  for (const i of a.recipe.ingredients) assert.equal(i.grams % 5, 0); // practical rounding
  const recomputed = macrosFromItems(a.recipe.ingredients.map((i) => ({ food: i.food, grams: i.grams })));
  assert.ok(Math.abs(a.recipe.kcal - recomputed.kcal) < 0.01); // displayed == from-source
  assert.ok(a.recipe.kcal > rec.kcal); // moved toward the (larger) target
});

// ---- verifier: the gate the model can't overrule ----------------------------

test("verifyGeneratedRecipe passes a clean recipe", () => {
  const scaled = scaleToTarget(assembleRecipe(resolveStructure({ ingredients: [{ foodId: "f1", grams: 200, role: "protein" }, { foodId: "f2", grams: 150 }] }, POOL, PROFILE)), { kcal: 525, protein: 66 });
  assert.equal(verifyGeneratedRecipe(scaled.recipe, { pool: POOL, profile: PROFILE }).ok, true);
});

test("verifyGeneratedRecipe rejects a tampered macro (macro-mismatch)", () => {
  const scaled = scaleToTarget(assembleRecipe(resolveStructure({ ingredients: [{ foodId: "f1", grams: 200, role: "protein" }] }, POOL, PROFILE)), { kcal: 330, protein: 62 });
  const tampered = { ...scaled.recipe, kcal: 100 };
  const v = verifyGeneratedRecipe(tampered, { pool: POOL, profile: PROFILE });
  assert.equal(v.ok, false);
  assert.ok(v.rejections.some((r) => r.code === "macro-mismatch"));
});

test("verifyGeneratedRecipe rejects an ingredient the profile now excludes", () => {
  const rec = assembleRecipe(resolveStructure({ ingredients: [{ foodId: "f1", grams: 200, role: "protein" }] }, POOL, PROFILE));
  const v = verifyGeneratedRecipe(rec, { pool: POOL, profile: { dietaryStyle: "vegan", excludedFoods: [] } });
  assert.equal(v.ok, false);
  assert.ok(v.rejections.some((r) => r.code === "excluded-item"));
});

// ---- gated orchestrator (mock LLM; zero real calls) -------------------------

test("generateRecipe is DORMANT by default — unavailable when the brain is off", async () => {
  const r = await generateRecipe({ profile: PROFILE, pool: POOL, target: { kcal: 500, protein: 50 } });
  assert.equal(r.status, "unavailable");
});

test("generateRecipe (mock LLM) returns a recipe whose macros are authoritative", async () => {
  const runLoop = mockLoop({ name: "Mock bowl", ingredients: [{ foodId: "f1", grams: 200, role: "protein" }, { foodId: "f2", grams: 150 }, { foodId: "f3", grams: 100 }] });
  const r = await generateRecipe({ profile: PROFILE, pool: POOL, target: { kcal: 600, protein: 60 } }, { enabled: true, runLoop });
  assert.equal(r.status, "ok");
  const recomputed = macrosFromItems(r.recipe.ingredients.map((i) => ({ food: i.food, grams: i.grams })));
  assert.ok(Math.abs(r.recipe.kcal - recomputed.kcal) < 0.01);
});

test("generateRecipe never surfaces an invented food — honest-fail instead", async () => {
  const runLoop = mockLoop({ name: "Bad", ingredients: [{ foodId: "INVENTED_X", grams: 200 }] });
  const r = await generateRecipe({ profile: PROFILE, pool: POOL, target: { kcal: 500, protein: 50 }, maxIters: 1 }, { enabled: true, runLoop });
  assert.notEqual(r.status, "ok");
  assert.equal(JSON.stringify(r).includes("INVENTED_X"), false); // never leaks
});

test("generateRecipe ignores a smuggled macro; the returned number is from-source", async () => {
  const runLoop = mockLoop({ name: "Smuggle", ingredients: [{ foodId: "f1", grams: 200, role: "protein", kcal: 99999, protein: 99999 }, { foodId: "f2", grams: 150 }] });
  const r = await generateRecipe({ profile: PROFILE, pool: POOL, target: { kcal: 525, protein: 66 } }, { enabled: true, runLoop });
  assert.equal(r.status, "ok");
  assert.ok(r.recipe.kcal < 2000); // not 99999
  const recomputed = macrosFromItems(r.recipe.ingredients.map((i) => ({ food: i.food, grams: i.grams })));
  assert.ok(Math.abs(r.recipe.kcal - recomputed.kcal) < 0.01);
});

// Regression (pre-turn-on fleet): the verifier must recompute from the POOL, not
// the carried food object — a tampered carried food can't rubber-stamp itself.
test("verifyGeneratedRecipe re-resolves from the pool — a tampered carried food is caught", () => {
  const fake = { id: "f1", name: "Fake protein", kcal: 9999, protein: 9999, carb: 0, fat: 0 };
  const recipe = {
    name: "Tampered", ingredients: [{ foodId: "f1", food: fake, grams: 100, role: "protein" }],
    kcal: 9999, protein: 9999, carb: 0, fat: 0, // stated macros match the FAKE carried food
    prov: { formulaId: "macrosFromItems", inputs: {}, value: {} },
  };
  const v = verifyGeneratedRecipe(recipe, { pool: POOL, profile: PROFILE });
  assert.equal(v.ok, false); // recompute from the real pool chicken (165/31) != 9999
  assert.ok(v.rejections.some((r) => r.code === "macro-mismatch"));
});
