// prescription day solver — structure is hard, bands are verified
// post-rounding, the allergen re-scan is belt-and-braces, and latency has
// three orders of magnitude of headroom.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRng } = require("../helpers/seededRng.js");
const { solvePrescriptionDay } = require("../../src/lib/prescription/daySolver.js");

// ── synthetic, plausibly-shaped pool ────────────────────────────────────────
let fid = 0;
const food = (name, kcal, protein, fat, carb, fiber = 0) => ({ id: `f${++fid}`, name, category: "other", kcal, protein, fat, carb, fiber, source: "manual", dataQuality: null });
const CHICKEN = food("Chicken breast", 165, 31, 3.6, 0);
const BEEF = food("Lean beef", 172, 26, 7, 0);
const SALMON = food("Salmon", 206, 22, 12.4, 0);
const TOFU = food("Firm tofu", 144, 16, 9, 3, 1);
const EGGS = food("Eggs", 155, 13, 11, 1.1);
const YOGURT = food("Greek yogurt", 59, 10, 0.4, 3.6);
const RICE = food("White rice", 130, 2.7, 0.3, 28, 0.4);
const POTATO = food("Potato", 93, 2.5, 0.1, 21, 2.2);
const BEANS = food("Black beans", 132, 8.9, 0.5, 24, 8.7);
const OIL = food("Olive oil", 884, 0, 100, 0);
const BROCCOLI = food("Broccoli", 34, 2.8, 0.4, 7, 2.6);
const BERRIES = food("Berries", 57, 0.7, 0.3, 14, 2.4);

let rid = 0;
function recipe(name, slotType, ings) {
  const ingredients = ings.map(([f, grams, role, scalable = true]) => ({ foodId: f.id, baseGrams: grams, scalable, role, food: f }));
  let kcal = 0, protein = 0;
  for (const i of ingredients) { kcal += i.food.kcal * i.baseGrams / 100; protein += i.food.protein * i.baseGrams / 100; }
  return { id: `r${++rid}`, name, slotType, mealCategory: null, cuisine: null, steps: [], kcal, protein, fat: 0, carb: 0, ingredients };
}

const POOL = [
  recipe("Chicken rice plate", "meal", [[CHICKEN, 200, "protein"], [RICE, 180, "carb"], [OIL, 10, "fat"], [BROCCOLI, 120, "veg"]]),
  recipe("Beef and beans", "meal", [[BEEF, 200, "protein"], [BEANS, 150, "carb"], [RICE, 120, "carb"], [OIL, 8, "fat"]]),
  recipe("Salmon potato tray", "meal", [[SALMON, 180, "protein"], [POTATO, 250, "carb"], [OIL, 10, "fat"], [BROCCOLI, 100, "veg"]]),
  recipe("Tofu stir-fry", "meal", [[TOFU, 250, "protein"], [RICE, 160, "carb"], [OIL, 10, "fat"], [BROCCOLI, 150, "veg"]]),
  recipe("Egg potato skillet", "meal", [[EGGS, 180, "protein"], [POTATO, 220, "carb"], [OIL, 8, "fat"]]),
  recipe("Beef rice bowl", "meal", [[BEEF, 220, "protein"], [RICE, 200, "carb"], [OIL, 8, "fat"], [BROCCOLI, 100, "veg"]]),
  recipe("Yogurt berry cup", "snack", [[YOGURT, 200, "protein"], [BERRIES, 100, "carb"]]),
  recipe("Eggs and greens", "snack", [[EGGS, 110, "protein"], [BROCCOLI, 80, "veg"]]),
  recipe("Yogurt bowl big", "snack", [[YOGURT, 250, "protein"], [BERRIES, 80, "carb"], [OIL, 3, "fat"]]),
];

const TARGETS = { kcal: 2150, proteinG: { lo: 200, hi: 220 }, fatG: { lo: 60, hi: 70 }, netCarbG: { lo: 135, hi: 160 }, floorKcal: 2000 };

test("meal structure is HARD: OMAD yields exactly one slot; 3+1 yields four", () => {
  const omad = solvePrescriptionDay({ pool: POOL, targets: { kcal: 900, proteinG: 60, fatG: 30, netCarbG: 80 }, mealConfig: { meals: 1, snacks: 0 }, rng: makeRng(7) });
  assert.equal(omad.slots.length, 1, "OMAD is ONE slot");
  assert.ok(omad.slots[0].dishes.length >= 1, "which may hold several dishes");
  const day = solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(7) });
  assert.equal(day.slots.length, 4);
  assert.equal(day.slots.filter((s) => s.slotType === "meal").length, 3);
  assert.equal(day.slots.filter((s) => s.slotType === "snack").length, 1);
});

test("a P0-shaped day lands inside every directive band, POST-rounding", () => {
  const out = solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(42) });
  assert.equal(out.ok, true, `diagnosis: ${out.diagnosis} — read ${JSON.stringify(out.verdict.read)}`);
  // and every shipped gram is food-scale: 5 g steps ≥20 g, 1 g dense items
  for (const s of out.slots) {
    for (const d of s.dishes) {
      for (const i of d.ingredients) {
        assert.ok(i.grams >= 1, `${i.name} shipped at ${i.grams} g`);
        const dense = [OIL.id].includes(i.foodId);
        if (!dense && i.grams >= 20) assert.equal(i.grams % 5, 0, `${i.name} ${i.grams} g is not on the 5 g grid`);
      }
    }
  }
});

test("the verdict is computed from the ROUNDED grams — recompute independently and agree", () => {
  const out = solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(42) });
  const foods = new Map([CHICKEN, BEEF, SALMON, TOFU, EGGS, YOGURT, RICE, POTATO, BEANS, OIL, BROCCOLI, BERRIES].map((f) => [f.id, f]));
  let kcal = 0;
  for (const s of out.slots) for (const d of s.dishes) for (const i of d.ingredients) kcal += foods.get(i.foodId).kcal * i.grams / 100;
  assert.ok(Math.abs(kcal - out.totals.kcal) < 1e-6, "no hidden arithmetic between grams and verdict");
});

test("belt and braces: a leak in the pool is caught at assembly, ok=false, scan line says FAIL", () => {
  // Simulate an upstream gate failure: a recipe whose title names an allergen
  // sits in a pool handed to the solver for an egg-allergic profile.
  const poisoned = [...POOL];
  const out = solvePrescriptionDay({
    pool: poisoned, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 },
    profile: { excludedFoods: ["eggs"] }, rng: makeRng(11),
  });
  if (out.slots.some((s) => s.dishes.some((d) => /Egg/i.test(d.recipeName)))) {
    assert.equal(out.ok, false, "an egg dish reaching an egg allergy must fail the day");
    assert.match(out.scanLine, /^allergen_scan: FAIL/);
  } else {
    // Selection may simply not have drawn the egg dishes — force the check:
    const forced = solvePrescriptionDay({
      pool: poisoned.filter((r) => /Egg/i.test(r.name)), targets: { kcal: 600, proteinG: 40, fatG: 25, netCarbG: 40 },
      mealConfig: { meals: 1, snacks: 0 }, profile: { excludedFoods: ["eggs"] }, rng: makeRng(11),
    });
    assert.equal(forced.ok, false);
    assert.match(forced.scanLine, /^allergen_scan: FAIL/);
  }
});

test("a clean day ships the machine-written PASS line with the profile named", () => {
  const out = solvePrescriptionDay({
    pool: POOL.filter((r) => !/Egg/i.test(r.name)), targets: TARGETS, mealConfig: { meals: 3, snacks: 1 },
    profile: { excludedFoods: ["gluten", "soy", "shellfish", "kiwi"] }, rng: makeRng(42),
  });
  assert.match(out.scanLine, /^allergen_scan: PASS \(profile: gluten, soy, shellfish, kiwi\) — 0 hits across \d+ ingredients$/);
});

test("variety: recipes in the 3-day window are not reused", () => {
  const recent = new Set([POOL[0].id, POOL[1].id, POOL[2].id]);
  const out = solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(5), recentIds: recent });
  for (const s of out.slots) for (const d of s.dishes) assert.ok(!recent.has(d.recipeId), `${d.recipeName} repeated inside the 3-day window`);
});

test("no repeat within one day when alternatives exist", () => {
  const out = solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(9) });
  const ids = out.slots.flatMap((s) => s.dishes.map((d) => d.recipeId));
  assert.equal(new Set(ids).size, ids.length);
});

test("latency: 50 seeded day-solves fit comfortably inside the P50 budget", () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) {
    solvePrescriptionDay({ pool: POOL, targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(i + 1) });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Directive budget is P50 < 2,000 ms PER DAY; assert the whole batch of 50
  // fits in one budget — catches only pathology, never timing noise.
  assert.ok(ms < 2000, `50 solves took ${ms.toFixed(1)} ms`);
});

test("FAIL CLOSED: a recipe carrying a macro-incomplete food is ineligible — NaN never reaches a plate (review finding)", () => {
  const brokenFood = { id: "fx", name: "Corrupt row", category: "other", kcal: null, protein: 26, fat: 7, carb: 0, fiber: 0, source: "manual", dataQuality: null };
  const broken = recipe("Corrupt Beef Plate", "meal", [[brokenFood, 200, "protein"], [RICE, 180, "carb"]]);
  const out = solvePrescriptionDay({ pool: [broken, ...POOL], targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(13) });
  for (const s of out.slots) for (const d of s.dishes) {
    assert.notEqual(d.recipeName, "Corrupt Beef Plate", "the null-kcal recipe must never be served");
  }
  assert.ok(Number.isFinite(out.totals.kcal), "day totals must stay finite");
});

test("an empty pool is an honest failure, never a crash", () => {
  const out = solvePrescriptionDay({ pool: [], targets: TARGETS, mealConfig: { meals: 3, snacks: 1 }, rng: makeRng(1) });
  assert.equal(out.ok, false);
  assert.match(out.diagnosis, /pool/i);
});
