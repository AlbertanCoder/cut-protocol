// solver-core-3 — THE KETO CARB CEILING IS CHECKED ON THE PORTION THAT SHIPS,
// NOT ONLY ON THE 1× RECIPE.
//
// Commit a0d0d24 moved keto from an absolute base-gram ceiling to a carb-ENERGY
// FRACTION, on the reasoning that a fraction is scale-invariant. That is true
// for UNIFORM scaling — and this solver does not scale uniformly. scaleRecipe()
// solves TWO factors (protein-role ingredients vs everything else), so a slot
// that wants calories without protein pushes sidesScale to 2× while proteinScale
// falls to 0.5×. The sides carry the carbs. The fraction moves.
//
// Measured on the fixture below: a dish that is 6.6% carbs by calories at 1×
// ships at 11.3% once portioned — over the ceiling, on a plate the app called
// keto. The ceiling is therefore re-checked after scaling; a portion that can
// be trimmed back inside it is trimmed, and one that cannot is refused.
//
// Pure fixtures only — no DB, no clock, no network. The threshold is never
// hardcoded here: every assertion goes through dietaryFilter's own
// recipeExceedsKetoCeiling(), so a future change to the line moves this test
// with it instead of leaving it asserting a stale number.
process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { scaleRecipe, enforceScaledCarbCeiling, generateWeekPlan, SCALE_BOUNDS } = require("../src/lib/weeklyPlanner.js");
const { filterRecipePool } = require("../src/lib/planContext.js");
const { recipeExceedsKetoCeiling } = require("../src/lib/dietaryFilter.js");

// ── fixtures ──────────────────────────────────────────────────────────────

const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  beef: { name: "Lean Beef", kcal: 217, protein: 26, fat: 12, carb: 0 },
  squash: { name: "Butternut Squash", kcal: 45, protein: 1, fat: 0.1, carb: 12 },
  broccoli: { name: "Broccoli", kcal: 34, protein: 2.8, fat: 0.4, carb: 7 },
  oil: { name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 },
  cream: { name: "Heavy Cream", kcal: 340, protein: 2, fat: 36, carb: 3 },
};

let seq = 0;
function recipe(name, parts, over = {}) {
  seq++;
  const ingredients = parts.map(([food, grams, role, scalable = true]) => ({
    foodId: `f-${food.name}`, baseGrams: grams, role, scalable, food,
  }));
  const totals = ingredients.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id: `r${seq}-${name}`, name, slotType: "meal", cuisine: null, prepTimeMin: 25, mealCategory: null, steps: [], ingredients, ...totals, ...over };
}

// Keto-LEGAL at 1× (carb energy fraction ~0.066), but its carbs all sit in the
// scalable non-protein bundle — exactly the shape the two-factor solve stretches.
const SQUASH_DISH = recipe("Chicken, Squash & Oil", [
  [F.chicken, 250, "protein"], [F.squash, 100, "carb"], [F.oil, 30, "fat"],
]);

const overFrac = (t) => recipeExceedsKetoCeiling({ carb: t.carb, kcal: t.kcal }, "keto");

// ── 1. the bug, stated as a fact ──────────────────────────────────────────

test("the fixture really is keto-legal at 1× (otherwise everything below is vacuous)", () => {
  assert.equal(overFrac(SQUASH_DISH), false, "the 1× dish must pass the pool's own ceiling check");
});

test("the solver's two-factor scaling CAN push a keto-legal dish over the ceiling", () => {
  // A slot that wants a lot of calories but little protein: proteinScale falls,
  // sidesScale hits its 2× cap, and the carbs double.
  const raw = scaleRecipe(SQUASH_DISH, 900, 45);
  assert.equal(raw.sidesScale, SCALE_BOUNDS.max, "the fixture must actually drive the sides to 2×");
  assert.ok(raw.proteinScale < 1, "…while the protein bundle shrinks");
  assert.equal(overFrac(raw), true,
    "the fixture no longer demonstrates the breach — pick a dish whose carbs ride on the scalable non-protein bundle");
});

// ── 2. the guard ──────────────────────────────────────────────────────────

test("enforceScaledCarbCeiling trims the portion back inside the ceiling rather than shipping it over", () => {
  const raw = scaleRecipe(SQUASH_DISH, 900, 45);
  const guarded = enforceScaledCarbCeiling(SQUASH_DISH, raw, "keto");
  assert.ok(guarded, "this dish CAN be trimmed back inside the ceiling, so it must not be refused outright");
  assert.equal(overFrac(guarded), false, "the shipped portion is inside the ceiling");
  assert.ok(guarded.sidesScale < raw.sidesScale, "and it got there by trimming the carb-carrying side");
  assert.ok(guarded.sidesScale >= SCALE_BOUNDS.min, "never below the spec's 0.5× portion floor");
  // The macros are recomputed from the trimmed grams, not estimated.
  const fromGrams = guarded.ingredients.reduce((s, ing) => {
    const food = SQUASH_DISH.ingredients.find((i) => i.foodId === ing.foodId).food;
    return s + food.carb * (ing.grams / 100);
  }, 0);
  assert.ok(Math.abs(fromGrams - guarded.carb) < 1e-9, "shipped carbs must equal what the shipped grams actually contain");
});

test("a dish that cannot be portioned inside the ceiling is REFUSED, not shipped smaller-but-still-over", () => {
  // Carbs live in a NON-scalable ingredient, so trimming the sides cannot help;
  // shrinking everything else only makes the fraction worse.
  const stuck = recipe("Fixed-Carb Plate", [
    [F.chicken, 200, "protein"], [F.squash, 400, "carb", false],
  ]);
  const raw = scaleRecipe(stuck, 700, 30);
  assert.equal(enforceScaledCarbCeiling(stuck, raw, "keto"), null,
    "there is no legal portion of this dish — the honest answer is to refuse it");
});

test("the guard is inert for every non-keto style and for an unguarded pool", () => {
  const raw = scaleRecipe(SQUASH_DISH, 900, 45);
  for (const style of [null, undefined, "vegan", "paleo", "halal", "vegetarian"]) {
    assert.deepEqual(enforceScaledCarbCeiling(SQUASH_DISH, raw, style), raw, `style ${style} must not be touched`);
  }
});

// ── 3. end to end: nothing over the ceiling reaches a keto plate ──────────

test("REGRESSION: no slot in a keto week ships a portion over the carb ceiling", async () => {
  const rawPool = [
    SQUASH_DISH,
    recipe("Beef & Broccoli", [[F.beef, 200, "protein"], [F.broccoli, 180, "veg"], [F.oil, 20, "fat"]]),
    recipe("Creamed Chicken", [[F.chicken, 220, "protein"], [F.cream, 120, "other"], [F.broccoli, 120, "veg"]]),
    recipe("Squash & Beef Skillet", [[F.beef, 180, "protein"], [F.squash, 130, "carb"], [F.oil, 25, "fat"]]),
    recipe("Oil-Braised Chicken", [[F.chicken, 260, "protein"], [F.oil, 35, "fat"], [F.broccoli, 90, "veg"]]),
    recipe("Cream & Broccoli Beef", [[F.beef, 190, "protein"], [F.cream, 100, "other"], [F.broccoli, 150, "veg"]]),
  ];
  // The pool goes through the SAME builder production uses, so the guard is
  // exercised the way it actually reaches the solver.
  const pool = filterRecipePool(rawPool, { dietaryStyle: "keto", excludedFoods: [] });
  assert.ok(pool.length >= 4, `keto pool too thin for a meaningful sweep (${pool.length})`);
  for (const r of pool) assert.equal(r.dietGuardStyle, "keto", "the pool must carry the style it was admitted under");

  const target = { kcal: 2200, proteinLo: 150, proteinHi: 170, fatLo: 130, fatHi: 165, carbLo: 20, carbHi: 30, keto: true };
  let checked = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const rng = (() => { let s = seed * 7919; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
    const slots = await generateWeekPlan(target, { meals: 3, snacks: 0 }, pool, { rng, allowBatchRepeats: true });
    for (const s of slots) {
      if (!s.recipeId) { assert.ok(s.warning, "an unfilled slot must still say why"); continue; }
      checked++;
      assert.equal(overFrac(s), false,
        `seed ${seed}: slot shipped ${s.carb.toFixed(1)} g carb in ${s.kcal.toFixed(0)} kcal ` +
        `(${((s.carb * 4) / s.kcal * 100).toFixed(1)}% of calories) — over the keto ceiling on a keto plan`);
    }
  }
  assert.ok(checked > 150, `sweep only checked ${checked} slots — it would have passed vacuously`);
});

test("when NOTHING can be portioned legally the slot is empty and names keto as the cause", async () => {
  // Every dish carries its carbs in a non-scalable ingredient, so no portion of
  // any of them is legal — the constitution's "unsolvable + why" case.
  const stuckPool = [1, 2, 3].map((n) => recipe(`Stuck ${n}`, [
    [F.chicken, 180 + n * 10, "protein"], [F.squash, 380 + n * 20, "carb", false],
  ]));
  const pool = filterRecipePool(stuckPool, { dietaryStyle: "keto", excludedFoods: [] })
    // The 1× rows are over the ceiling too, so admit them by hand — the point
    // here is the POST-SCALE refusal path, not pool entry.
    .concat(stuckPool.map((r) => ({ ...r, dietGuardStyle: "keto" })));
  const target = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 120, fatHi: 150, carbLo: 20, carbHi: 30, keto: true };
  const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
  const slots = await generateWeekPlan(target, { meals: 3, snacks: 0 }, pool, { rng });

  assert.ok(slots.every((s) => !s.recipeId), "no dish here has a legal portion, so no slot may be filled");
  const warned = slots.filter((s) => /keto carb ceiling/i.test(s.warning || ""));
  assert.ok(warned.length > 0, `no slot named the keto ceiling:\n${slots.slice(0, 3).map((s) => s.warning).join("\n")}`);
  assert.match(warned[0].warning, /once scaled to the slot's size/);
});

test("an unguarded (non-keto) pool solves exactly as before — the guard adds nothing to that path", async () => {
  const rawPool = [
    recipe("Chicken & Squash A", [[F.chicken, 200, "protein"], [F.squash, 200, "carb"]]),
    recipe("Chicken & Squash B", [[F.chicken, 240, "protein"], [F.squash, 160, "carb"]]),
    recipe("Beef & Squash", [[F.beef, 190, "protein"], [F.squash, 220, "carb"]]),
    recipe("Beef & Broccoli", [[F.beef, 210, "protein"], [F.broccoli, 200, "veg"]]),
  ];
  const target = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 55, fatHi: 75, carbLo: 150, carbHi: 220 };
  const cfg = { meals: 3, snacks: 0 };
  const mkRng = (seed) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };

  const plain = await generateWeekPlan(target, cfg, rawPool, { rng: mkRng(42) });
  // Same pool, but stamped for a style with no scale-sensitive rule at all.
  const stamped = filterRecipePool(rawPool, { dietaryStyle: "halal", excludedFoods: [] });
  const guarded = await generateWeekPlan(target, cfg, stamped, { rng: mkRng(42) });
  assert.deepEqual(guarded, plain, "stamping a non-keto style changed the solve — the guard must be inert there");
});

// ── 4. the stamp itself ───────────────────────────────────────────────────

test("filterRecipePool stamps the guard without mutating the caller's rows", () => {
  const rawPool = [recipe("Keto Plate", [[F.chicken, 200, "protein"], [F.broccoli, 120, "veg"], [F.oil, 20, "fat"]])];
  const before = JSON.parse(JSON.stringify(rawPool.map((r) => ({ id: r.id, guard: r.dietGuardStyle ?? null }))));
  const out = filterRecipePool(rawPool, { dietaryStyle: "keto", excludedFoods: [] });
  assert.equal(out[0].dietGuardStyle, "keto");
  assert.deepEqual(rawPool.map((r) => ({ id: r.id, guard: r.dietGuardStyle ?? null })), before,
    "the input rows must not be mutated — other callers share them");
  // No style, no stamp: an unrestricted profile gets the pool back untouched.
  const none = filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: [] });
  assert.equal(none[0].dietGuardStyle, undefined);
});
