const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rebuildSlotFromClient, filterRecipePool } = require("../src/routes/plans.js");
const { recipeExceedsKetoCeiling } = require("../src/lib/dietaryFilter.js");
const { diagnose } = require("../src/lib/mealSolver.js");

const DAILY = { kcal: 2000, proteinLo: 140, proteinHi: 160 };
const MEALCFG = { meals: 3, snacks: 1 };

// A minimal recipe pool for the server-side rebuild path. baseGrams drive the
// allowed 0.5x-2x portion band.
const CHICKEN = { id: "r1", name: "Chicken & Rice", carb: 60,
  ingredients: [
    { foodId: "f1", role: "protein", scalable: true, baseGrams: 200, food: { name: "Chicken breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 } },
    { foodId: "f2", role: "carb", scalable: true, baseGrams: 150, food: { name: "White rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 } },
    { foodId: "f3", role: "fat", scalable: false, baseGrams: 5, food: { name: "Olive oil", kcal: 884, protein: 0, fat: 100, carb: 0 } },
  ] };
const POOL = [CHICKEN];

test("REGRESSION (Stage C / M9): the server-side rebuild rejects portions outside 0.5x-2x of base grams", () => {
  // A x10 chicken portion (2000 g vs base 200) must be rejected, not stored.
  assert.throws(
    () => rebuildSlotFromClient({ recipeId: "r1", ingredients: [{ foodId: "f1", grams: 2000 }] }, POOL),
    /portion range/,
    "a x10 portion must be rejected"
  );
  // 5000 g of oil under a valid recipe id (the 44,000-kcal attack) must fail.
  assert.throws(
    () => rebuildSlotFromClient({ recipeId: "r1", ingredients: [{ foodId: "f3", grams: 5000 }] }, POOL),
    /portion range/
  );
  // Legitimate in-band portions (base, 0.5x, 2x with rounding) are accepted.
  const okSlot = rebuildSlotFromClient({ recipeId: "r1", proteinScale: 2, sidesScale: 1, ingredients: [
    { foodId: "f1", grams: 400 }, // 2x of 200 — the upper bound
    { foodId: "f2", grams: 75 },  // 0.5x of 150 — the lower bound
    { foodId: "f3", grams: 5 },   // non-scalable, stays at base
  ] }, POOL);
  assert.equal(okSlot.recipeId, "r1");
  assert.ok(okSlot.kcal > 0, "macros recomputed server-side from grams");
  // Scale labels are clamped to the 0.5-2 band even if the client sends junk.
  const clamped = rebuildSlotFromClient({ recipeId: "r1", proteinScale: 20, sidesScale: 0.01, ingredients: [{ foodId: "f1", grams: 200 }] }, POOL);
  assert.ok(clamped.proteinScale <= 2 && clamped.sidesScale >= 0.5, "scale labels clamped, not stored as x20/x0.01");
});

test("REGRESSION (Stage C / M8): keto ceiling hides high-carb recipes in BOTH the pool filter and the shared helper", () => {
  // recipeExceedsKetoCeiling is the single source both plans.js and recipes.js use.
  assert.equal(recipeExceedsKetoCeiling({ carb: 60 }, "keto"), true, "60 g carb recipe exceeds the 30 g keto ceiling");
  assert.equal(recipeExceedsKetoCeiling({ carb: 20 }, "keto"), false);
  assert.equal(recipeExceedsKetoCeiling({ carb: 60 }, "none"), false, "non-keto profile is unaffected");
  // filterRecipePool drops the high-carb recipe for a keto profile.
  const kept = filterRecipePool(POOL, { dietaryStyle: "keto", excludedFoods: [] });
  assert.equal(kept.length, 0, "the 60 g-carb recipe is removed from a keto pool");
  const ketoOk = filterRecipePool([{ ...CHICKEN, carb: 12 }], { dietaryStyle: "keto", excludedFoods: [] });
  assert.equal(ketoOk.length, 1, "a low-carb recipe survives keto");
});

test("REGRESSION (Stage C / M12-adjacent): filterRecipePool applies allergy exclusions to the plan pool", () => {
  const withSquid = [{ id: "s1", name: "Salt & pepper squid", carb: 5,
    ingredients: [{ foodId: "sq", role: "protein", scalable: true, baseGrams: 200, food: { name: "Squid", kcal: 92, protein: 15, fat: 1, carb: 3 } }] }];
  const kept = filterRecipePool([...POOL, ...withSquid], { dietaryStyle: null, excludedFoods: ["shellfish"] });
  assert.ok(!kept.some((r) => /squid/i.test(r.name)), "squid recipe excluded for a shellfish allergy in the plan pool");
  assert.ok(kept.some((r) => r.id === "r1"), "the compliant recipe stays");
});

test("REGRESSION (Stage C / M10): diagnosis names the prep-time cap, not diet, when prep emptied the pool", () => {
  // Diet leaves 50 recipes; a maxPrep cap cut them to 0. The old code always
  // blamed "dietary style + allergy rules exclude every recipe."
  const d = diagnose({ counts: { raw: 100, afterDiet: 50, afterPrep: 0 }, filters: { maxPrepMin: 15 }, dailyTarget: DAILY, mealConfig: MEALCFG, pool: [] });
  assert.ok(d.reasons.some((r) => /max prep/i.test(r)), `should blame the prep cap, got: ${d.reasons.join(" | ")}`);
  assert.ok(!d.reasons.some((r) => /allergy rules exclude every recipe/i.test(r)), "must NOT blame diet/allergy when diet left recipes");
  // But a genuinely diet-emptied pool IS attributed to diet.
  const diet = diagnose({ counts: { raw: 100, afterDiet: 0, afterPrep: 0 }, filters: {}, dailyTarget: DAILY, mealConfig: MEALCFG, pool: [] });
  assert.ok(diet.reasons.some((r) => /allergy rules exclude every recipe/i.test(r)));
});

test("REGRESSION (Stage C / #35): capacity diagnosis uses the active repeat cap and doesn't suggest what's already on", () => {
  const thinPool = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: `Meal ${i}`, slotType: "meal", kcal: 600, protein: 40,
    ingredients: [{ foodId: `f${i}`, role: "protein", scalable: true, baseGrams: 200, food: { name: `Food ${i}`, kcal: 200, protein: 20, fat: 5, carb: 10 } }] }));
  const counts = { raw: 6, afterDiet: 6, afterPrep: 6 };
  const withBatch = diagnose({ counts, filters: { allowBatchRepeats: true }, dailyTarget: DAILY, mealConfig: MEALCFG, pool: thinPool });
  assert.ok(!withBatch.suggestions.some((s) => /allow batch-cooking repeats/i.test(s)), "must not suggest enabling batch repeats when they are already on");
});
