const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateWeekPlan, DEFAULT_REPEAT_CAP } = require("../src/lib/weeklyPlanner.js");
const { generateDayCandidates, alternatesForSlot, scoreDay, diagnose, applyPrepFilter, buildBias } = require("../src/lib/mealSolver.js");
const { recipeExcludedByStyle, matchesExclusionTerm } = require("../src/lib/dietaryFilter.js");
const { toPurchaseUnits } = require("../src/lib/purchaseUnits.js");
const { classifyCuisine } = require("../src/lib/recipeCuisine.js");
const { computeRecipeCost } = require("../src/lib/recipeCost.js");

// ── T (v2): taste-rating bias ────────────────────────────────────────────

test("T: buildBias returns null with no filters AND no ratings (byte-identical to before)", () => {
  assert.equal(buildBias({}), null);
  assert.equal(buildBias({ ratings: new Map() }), null, "an empty ratings map adds no term");
  assert.equal(buildBias({ ratings: { liked: 1 } }), null, "a non-Map ratings value is ignored (fail-safe)");
});

test("T: taste ratings boost liked recipes and dampen disliked, leaving neutral at 1", () => {
  const ratings = new Map([["liked", 1], ["disliked", -1]]);
  const bias = buildBias({ ratings });
  assert.equal(typeof bias, "function");
  assert.equal(bias({ id: "neutral" }), 1, "an unrated recipe is unweighted");
  assert.ok(bias({ id: "liked" }) > 1, "liked recipe boosted above 1");
  assert.ok(bias({ id: "disliked" }) < 1 && bias({ id: "disliked" }) > 0, "disliked dampened but never fully excluded");
  assert.ok(bias({ id: "liked" }) > bias({ id: "disliked" }));
});

test("T: taste bias composes with cuisine bias (multiplicative, still soft)", () => {
  const ratings = new Map([["x", 1]]);
  const bias = buildBias({ cuisines: ["thai"], ratings });
  // liked + on-cuisine → boosted twice; disliked cuisine miss handled separately
  assert.ok(bias({ id: "x", cuisine: "thai" }) > bias({ id: "y", cuisine: "thai" }), "a liked on-cuisine recipe beats an unrated on-cuisine one");
});

// ── synthetic fixture pool ───────────────────────────────────────────────

const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  beef: { name: "Lean Beef", kcal: 217, protein: 26, fat: 12, carb: 0 },
  turkey: { name: "Ground Turkey", kcal: 150, protein: 19, fat: 8, carb: 0 },
  salmon: { name: "Salmon", kcal: 208, protein: 20.4, fat: 13.4, carb: 0 },
  shrimp: { name: "Shrimp", kcal: 85, protein: 20, fat: 0.5, carb: 0 },
  pork: { name: "Pork Loin", kcal: 242, protein: 27, fat: 14, carb: 0 },
  tofu: { name: "Tofu, firm", kcal: 144, protein: 15.5, fat: 8.7, carb: 2.8 },
  seitan: { name: "Seitan", kcal: 141, protein: 25, fat: 2, carb: 4 },
  lentils: { name: "Lentils, cooked", kcal: 116, protein: 9, fat: 0.4, carb: 20 },
  chickpeas: { name: "Chickpeas, cooked", kcal: 139, protein: 7, fat: 3.1, carb: 20 },
  beans: { name: "Black Beans", kcal: 132, protein: 8.9, fat: 0.5, carb: 24 },
  egg: { name: "Eggs", kcal: 143, protein: 12.6, fat: 9.5, carb: 0.7 },
  yogurt: { name: "Greek Yogurt", kcal: 59, protein: 10, fat: 0.4, carb: 3.6 },
  cheese: { name: "Cheddar Cheese", kcal: 408, protein: 23.3, fat: 34, carb: 2.4 },
  rice: { name: "White Rice, cooked", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  quinoa: { name: "Quinoa, cooked", kcal: 120, protein: 4.4, fat: 1.9, carb: 21 },
  pasta: { name: "Pasta, cooked", kcal: 157, protein: 5.8, fat: 0.9, carb: 31 },
  potato: { name: "Potato", kcal: 87, protein: 1.9, fat: 0.1, carb: 20 },
  oats: { name: "Oats", kcal: 379, protein: 13.2, fat: 6.5, carb: 67.7 },
  broccoli: { name: "Broccoli", kcal: 34, protein: 2.8, fat: 0.4, carb: 7 },
  spinach: { name: "Spinach", kcal: 23, protein: 2.9, fat: 0.4, carb: 3.6 },
  oil: { name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 },
  almonds: { name: "Almonds", kcal: 603, protein: 26.2, fat: 50.2, carb: 16.2 },
  peanutButter: { name: "Peanut Butter", kcal: 619, protein: 24, fat: 49.4, carb: 22.7 },
  banana: { name: "Banana", kcal: 89, protein: 1.1, fat: 0.3, carb: 23 },
  wine: { name: "White Wine", kcal: 82, protein: 0.1, fat: 0, carb: 2.6 },
};

let seq = 0;
function recipe(name, parts, over = {}) {
  seq++;
  const ingredients = parts.map(([food, grams, role, scalable = true]) => ({
    foodId: `f-${food.name}`, baseGrams: grams, role, scalable, food,
  }));
  const totals = ingredients.reduce(
    (s, i) => {
      const k = i.baseGrams / 100;
      return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  return {
    id: `r-${seq}-${name}`, name, slotType: "meal", cuisine: null, prepTimeMin: 30,
    mealCategory: null, ingredients, ...totals, ...over,
  };
}

function buildPool() {
  const meals = [
    // omnivore mains
    recipe("Chicken Rice Bowl", [[F.chicken, 180, "protein"], [F.rice, 200, "carb"], [F.broccoli, 120, "veg"], [F.oil, 8, "fat", false]]),
    recipe("Beef Potato Plate", [[F.beef, 170, "protein"], [F.potato, 250, "carb"], [F.spinach, 80, "veg"], [F.oil, 8, "fat", false]]),
    recipe("Turkey Quinoa Skillet", [[F.turkey, 190, "protein"], [F.quinoa, 200, "carb"], [F.broccoli, 100, "veg"]]),
    recipe("Salmon Rice Dinner", [[F.salmon, 160, "protein"], [F.rice, 180, "carb"], [F.spinach, 90, "veg"]], { prepTimeMin: 25 }),
    recipe("Chicken Pasta", [[F.chicken, 160, "protein"], [F.pasta, 220, "carb"], [F.spinach, 70, "veg"]], { prepTimeMin: 35 }),
    recipe("Turkey Egg Hash", [[F.turkey, 150, "protein"], [F.potato, 220, "carb"], [F.egg, 60, "protein"]], { prepTimeMin: 20 }),
    recipe("Beef Quinoa Bowl", [[F.beef, 160, "protein"], [F.quinoa, 190, "carb"], [F.broccoli, 110, "veg"]]),
    recipe("Chicken Potato Roast", [[F.chicken, 190, "protein"], [F.potato, 260, "carb"], [F.spinach, 60, "veg"]], { prepTimeMin: 55 }),
    // vegan mains (also vegetarian-safe)
    recipe("Tofu Stir-fry", [[F.tofu, 250, "protein"], [F.rice, 190, "carb"], [F.broccoli, 130, "veg"], [F.oil, 10, "fat", false]], { prepTimeMin: 20 }),
    recipe("Seitan Rice Plate", [[F.seitan, 180, "protein"], [F.rice, 200, "carb"], [F.spinach, 90, "veg"]]),
    recipe("Lentil Potato Curry", [[F.lentils, 280, "protein"], [F.potato, 220, "carb"], [F.spinach, 100, "veg"], [F.oil, 10, "fat", false]]),
    recipe("Chickpea Quinoa Bowl", [[F.chickpeas, 240, "protein"], [F.quinoa, 190, "carb"], [F.broccoli, 110, "veg"]]),
    recipe("Bean Rice Skillet", [[F.beans, 260, "protein"], [F.rice, 180, "carb"], [F.spinach, 90, "veg"]]),
    recipe("Tofu Quinoa Power Plate", [[F.tofu, 260, "protein"], [F.quinoa, 180, "carb"], [F.broccoli, 120, "veg"]]),
    recipe("Seitan Pasta", [[F.seitan, 170, "protein"], [F.pasta, 210, "carb"], [F.spinach, 80, "veg"]]),
    recipe("Lentil Pasta Bowl", [[F.lentils, 260, "protein"], [F.pasta, 190, "carb"], [F.broccoli, 100, "veg"]]),
    // vegetarian (dairy/egg)
    recipe("Egg Cheese Scramble Plate", [[F.egg, 180, "protein"], [F.potato, 200, "carb"], [F.cheese, 40, "fat", false]], { prepTimeMin: 15 }),
    recipe("Paneer-style Cheese Quinoa", [[F.cheese, 90, "protein"], [F.quinoa, 210, "carb"], [F.spinach, 110, "veg"]]),
    // keto-eligible mains (whole-recipe carbs under the 30 g ceiling)
    recipe("Chicken Broccoli Skillet", [[F.chicken, 220, "protein"], [F.broccoli, 200, "veg"], [F.oil, 20, "fat"]], { prepTimeMin: 20 }),
    recipe("Salmon Spinach Plate", [[F.salmon, 200, "protein"], [F.spinach, 150, "veg"], [F.oil, 18, "fat"]], { prepTimeMin: 20 }),
    recipe("Beef Egg Scramble", [[F.beef, 180, "protein"], [F.egg, 120, "protein"], [F.spinach, 100, "veg"], [F.oil, 12, "fat"]]),
    recipe("Cheesy Chicken Bake", [[F.chicken, 200, "protein"], [F.cheese, 60, "fat"], [F.broccoli, 150, "veg"]]),
    recipe("Turkey Spinach Saute", [[F.turkey, 220, "protein"], [F.spinach, 140, "veg"], [F.oil, 16, "fat"]]),
    recipe("Salmon Egg Power Bowl", [[F.salmon, 170, "protein"], [F.egg, 110, "protein"], [F.broccoli, 120, "veg"]]),
    recipe("Beef Broccoli Wok", [[F.beef, 210, "protein"], [F.broccoli, 190, "veg"], [F.oil, 15, "fat"]]),
    recipe("Chicken Caesar-less Salad", [[F.chicken, 210, "protein"], [F.spinach, 160, "veg"], [F.cheese, 35, "fat"], [F.oil, 12, "fat"]]),
    recipe("Turkey Cheese Skillet", [[F.turkey, 210, "protein"], [F.cheese, 50, "fat"], [F.broccoli, 160, "veg"]]),
    recipe("Egg Cheese Omelette Stack", [[F.egg, 200, "protein"], [F.cheese, 45, "fat"], [F.spinach, 90, "veg"]], { prepTimeMin: 15 }),
    recipe("Salmon Cheese Melt", [[F.salmon, 180, "protein"], [F.cheese, 40, "fat"], [F.broccoli, 130, "veg"]]),
    recipe("Steak and Greens", [[F.beef, 230, "protein"], [F.spinach, 130, "veg"], [F.oil, 14, "fat"]], { prepTimeMin: 25 }),
    // leak-test recipes (allergens / haram)
    recipe("Shrimp Fried Rice", [[F.shrimp, 200, "protein"], [F.rice, 210, "carb"], [F.egg, 50, "protein"]]),
    recipe("Shrimp Pasta", [[F.shrimp, 190, "protein"], [F.pasta, 200, "carb"], [F.spinach, 70, "veg"]]),
    recipe("Peanut Chicken Satay", [[F.chicken, 170, "protein"], [F.peanutButter, 40, "fat", false], [F.rice, 180, "carb"]]),
    recipe("Pork Wine Braise", [[F.pork, 190, "protein"], [F.wine, 100, "other", false], [F.potato, 220, "carb"]]),
  ];
  const snacks = [
    recipe("Greek Yogurt Cup", [[F.yogurt, 250, "protein"], [F.banana, 90, "carb"]], { slotType: "snack", prepTimeMin: 2 }),
    recipe("Almond Banana Snack", [[F.almonds, 35, "fat"], [F.banana, 110, "carb"]], { slotType: "snack", prepTimeMin: 2 }),
    recipe("Overnight Oats", [[F.oats, 60, "carb"], [F.yogurt, 150, "protein"]], { slotType: "snack", prepTimeMin: 5 }),
    recipe("PB Banana Toast", [[F.peanutButter, 30, "fat"], [F.banana, 100, "carb"], [F.oats, 40, "carb"]], { slotType: "snack", prepTimeMin: 5 }),
    recipe("Tofu Bites", [[F.tofu, 180, "protein"], [F.oil, 6, "fat", false]], { slotType: "snack", prepTimeMin: 10 }),
    recipe("Banana Oat Bowl", [[F.oats, 55, "carb"], [F.banana, 120, "carb"]], { slotType: "snack", prepTimeMin: 3 }),
  ];
  return [...meals, ...snacks];
}

// The same hard-filter contract routes/plans.js applies.
function filterPool(pool, profile) {
  const style = profile.dietaryStyle || null;
  const excluded = profile.excludedFoods || [];
  return pool.filter((r) => {
    if (style === "keto" && r.carb > 30) return false;
    const flat = r.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flat }, style)) return false;
    if (excluded.length && flat.some((ing) => excluded.some((t) => matchesExclusionTerm(ing.name, t)))) return false;
    return true;
  });
}

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const dayTotals = (slots) => {
  const byDay = new Map();
  for (const s of slots) {
    const t = byDay.get(s.dayOfWeek) || { kcal: 0, protein: 0 };
    t.kcal += s.kcal;
    t.protein += s.protein;
    byDay.set(s.dayOfWeek, t);
  }
  return byDay;
};

// ── the 5-profile matrix the Phase 4 spec demands ────────────────────────

const PROFILES = [
  { tag: "omnivore M heavy", diet: { dietaryStyle: null, excludedFoods: [] }, target: { kcal: 2800, proteinLo: 180, proteinHi: 200, fatLo: 70, fatHi: 90, carbLo: 240, carbHi: 300 }, meals: 3, snacks: 1 },
  { tag: "vegan F light", diet: { dietaryStyle: "vegan", excludedFoods: [] }, target: { kcal: 1700, proteinLo: 85, proteinHi: 100, fatLo: 40, fatHi: 55, carbLo: 160, carbHi: 210 }, meals: 2, snacks: 1 },
  // 3 meals/day over 12 keto-eligible fixture meals (×cap 2 = 24 servings
  // for 21 slots). At 2 meals/day the 0.5–2× scale cap can't stretch these
  // ~600 kcal bases to ~1,200 kcal slots — which is the spec's bound doing
  // its job, not a solver bug.
  { tag: "keto M", diet: { dietaryStyle: "keto", excludedFoods: [] }, target: { kcal: 2200, proteinLo: 150, proteinHi: 170, fatLo: 120, fatHi: 150, carbLo: 20, carbHi: 50 }, meals: 3, snacks: 0 },
  { tag: "halal M", diet: { dietaryStyle: "halal", excludedFoods: [] }, target: { kcal: 2400, proteinLo: 150, proteinHi: 170, fatLo: 60, fatHi: 80, carbLo: 200, carbHi: 260 }, meals: 3, snacks: 1 },
  { tag: "vegetarian + shellfish/peanut allergy F", diet: { dietaryStyle: "vegetarian", excludedFoods: ["shellfish", "peanuts"] }, target: { kcal: 1900, proteinLo: 95, proteinHi: 110, fatLo: 45, fatHi: 60, carbLo: 180, carbHi: 230 }, meals: 3, snacks: 1 },
];

for (const p of PROFILES) {
  test(`week solve — ${p.tag}: days near target, ZERO allergen/style leaks`, async () => {
    const pool = filterPool(buildPool(), p.diet);
    assert.ok(pool.length >= 8, `${p.tag}: filtered pool too thin (${pool.length}) for a meaningful test`);
    const slots = await generateWeekPlan(p.target, { meals: p.meals, snacks: p.snacks }, pool, { rng: seeded(42) });

    // ZERO-TOLERANCE allergy/style check on every shipped ingredient.
    for (const s of slots) {
      for (const ing of s.ingredients) {
        for (const term of p.diet.excludedFoods) {
          assert.ok(!matchesExclusionTerm(ing.name, term), `${p.tag}: LEAK — "${ing.name}" matches excluded "${term}"`);
        }
        if (p.diet.dietaryStyle) {
          assert.ok(
            !recipeExcludedByStyle({ ingredients: [{ name: ing.name }] }, p.diet.dietaryStyle),
            `${p.tag}: LEAK — "${ing.name}" violates ${p.diet.dietaryStyle}`
          );
        }
      }
    }

    // Day-level tolerance: ≥6 of 7 days within 15% kcal and no worse than
    // 15% protein short (the solver's own gates + carry-forward should hold
    // this; one rough day is allowed and must carry a warning).
    let good = 0;
    for (const [, t] of dayTotals(slots)) {
      const kcalOk = Math.abs(t.kcal - p.target.kcal) / p.target.kcal <= 0.15;
      const pMid = (p.target.proteinLo + p.target.proteinHi) / 2;
      const proteinOk = (pMid - t.protein) / pMid <= 0.15;
      if (kcalOk && proteinOk) good++;
    }
    assert.ok(good >= 6, `${p.tag}: only ${good}/7 days inside tolerance`);
  });
}

// ── day candidates ───────────────────────────────────────────────────────

test("day candidates: 3 distinct scored complete days, honest match %", async () => {
  const p = PROFILES[0];
  const pool = filterPool(buildPool(), p.diet);
  const { candidates, diagnosis } = await generateDayCandidates({
    dailyTarget: p.target, mealConfig: { meals: 3, snacks: 1 }, recipePool: pool, rng: seeded(7),
  });
  assert.ok(candidates.length >= 3, `wanted 3+ candidates, got ${candidates.length}`);
  const sigs = new Set(candidates.map((c) => c.slots.map((s) => s.recipeId).join("|")));
  assert.equal(sigs.size, candidates.length, "candidates must be distinct");
  assert.ok(candidates[0].score.matchPct >= 85, `best candidate only ${candidates[0].score.matchPct}%`);
  assert.ok(candidates[0].score.totals.kcal > 0);
  assert.equal(diagnosis, null, "healthy pool needs no diagnosis");
  // sorted best-first
  for (let i = 1; i < candidates.length; i++) {
    assert.ok(candidates[i - 1].score.matchPct >= candidates[i].score.matchPct);
  }
});

test("scoring: perfect day = 100, 10% kcal error costs ~5.5 points", () => {
  const target = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 50, fatHi: 70, carbLo: 180, carbHi: 220 };
  const perfect = scoreDay(target, [{ kcal: 2000, protein: 150, fat: 60, carb: 200 }]);
  assert.equal(perfect.matchPct, 100);
  const off = scoreDay(target, [{ kcal: 2200, protein: 150, fat: 60, carb: 200 }]);
  assert.equal(off.matchPct, 95, "0.10 kcal err × 0.55 weight = 5.5 points off");
  const proteinShort = scoreDay(target, [{ kcal: 2000, protein: 75, fat: 60, carb: 200 }]);
  assert.ok(proteinShort.matchPct <= 85, "half the protein must hurt the score hard");
});

// ── variety rules ────────────────────────────────────────────────────────

test("variety: default cap 2/week; batch-cooking raises it", async () => {
  const p = PROFILES[0];
  const pool = filterPool(buildPool(), p.diet);
  const slots = await generateWeekPlan(p.target, { meals: 3, snacks: 1 }, pool, { rng: seeded(3) });
  const counts = new Map();
  for (const s of slots) if (s.recipeId) counts.set(s.recipeId, (counts.get(s.recipeId) || 0) + 1);
  for (const [id, n] of counts) assert.ok(n <= DEFAULT_REPEAT_CAP, `${id} served ${n}× against a cap of ${DEFAULT_REPEAT_CAP}`);

  // Thin pool + batch mode: allowed to exceed 2.
  const thin = pool.slice(0, 6);
  const batchSlots = await generateWeekPlan(p.target, { meals: 3, snacks: 0 }, thin, { rng: seeded(3), allowBatchRepeats: true });
  const batchCounts = new Map();
  for (const s of batchSlots) if (s.recipeId) batchCounts.set(s.recipeId, (batchCounts.get(s.recipeId) || 0) + 1);
  assert.ok([...batchCounts.values()].some((n) => n > 2), "batch mode should actually use the headroom on a thin pool");
});

test("variety: no recipe twice in the same day (healthy pool)", async () => {
  const p = PROFILES[0];
  const pool = filterPool(buildPool(), p.diet);
  const slots = await generateWeekPlan(p.target, { meals: 3, snacks: 1 }, pool, { rng: seeded(11) });
  for (let day = 0; day < 7; day++) {
    const ids = slots.filter((s) => s.dayOfWeek === day && s.recipeId).map((s) => s.recipeId);
    assert.equal(new Set(ids).size, ids.length, `day ${day} repeats a recipe`);
  }
});

// ── filters ──────────────────────────────────────────────────────────────

test("max prep time is a hard cap; unknown prep passes", () => {
  const pool = buildPool();
  const withUnknown = [...pool, { ...pool[0], id: "r-x", name: "Unknown Prep Dish", prepTimeMin: null }];
  const capped = applyPrepFilter(withUnknown, 20);
  assert.ok(capped.every((r) => r.prepTimeMin == null || r.prepTimeMin <= 20));
  assert.ok(capped.some((r) => r.prepTimeMin == null), "unknown prep must not be excluded");
  assert.ok(capped.length < withUnknown.length, "the cap must actually remove something");
});

test("alternates: 3 distinct, never the current recipe", async () => {
  const p = PROFILES[0];
  const pool = filterPool(buildPool(), p.diet);
  const current = pool[0];
  const alts = await alternatesForSlot({
    slotTarget: { dayOfWeek: 2, slotType: "meal", slotIndex: 0, kcalTarget: 700, proteinTarget: 45 },
    recipePool: pool, existingSlots: [], excludeRecipeIds: [current.id], rng: seeded(5),
  });
  assert.ok(alts.length >= 3, `wanted 3 alternates, got ${alts.length}`);
  assert.equal(new Set(alts.map((a) => a.recipeId)).size, alts.length, "alternates must be distinct");
  assert.ok(alts.every((a) => a.recipeId !== current.id), "current recipe must not reappear");
  assert.ok(alts.every((a) => Number.isFinite(a.matchPct)));
});

// ── honesty: diagnosis ───────────────────────────────────────────────────

test("diagnosis names the binding constraint and NEVER suggests loosening allergies", () => {
  const target = PROFILES[0].target;
  const empty = diagnose({ counts: { raw: 600, afterDiet: 0, afterPrep: 0 }, filters: {}, dailyTarget: target, mealConfig: { meals: 3, snacks: 1 }, pool: [] });
  assert.equal(empty.feasible, false);
  assert.ok(empty.suggestions.some((s) => /AI/i.test(s)));

  const pool = buildPool().slice(0, 8);
  const prepBound = diagnose({
    counts: { raw: 600, afterDiet: 40, afterPrep: 6 },
    filters: { maxPrepMin: 15 }, dailyTarget: target, mealConfig: { meals: 3, snacks: 1 }, pool,
  });
  assert.ok(prepBound.reasons.some((r) => /prep/i.test(r)), "prep cap must be named");
  for (const s of [...empty.suggestions, ...prepBound.suggestions]) {
    assert.ok(!/allerg/i.test(s), `diagnosis must never suggest loosening allergies: "${s}"`);
  }
});

// ── purchase units ───────────────────────────────────────────────────────

test("purchase units: packs, cans, pieces — grams stay the ground truth", () => {
  assert.equal(toPurchaseUnits("Turkey sausages", 780).display, "2 packs (≈12 sausages)");
  assert.equal(toPurchaseUnits("Cucumber", 850).display, "3 large cucumbers");
  assert.equal(toPurchaseUnits("Black Beans", 460).display, "2 cans (drained)");
  assert.equal(toPurchaseUnits("Eggs", 550).display, "1 dozen (≈12 eggs)");
  assert.equal(toPurchaseUnits("White Rice, cooked", 940), null, "bulk dry goods stay grams+cups");
  assert.equal(toPurchaseUnits("Dragonfruit Essence", 100), null, "no rule → no invented unit");
});

// ── cuisine + cost ───────────────────────────────────────────────────────

test("cuisine classifier: distinctive names route correctly, rest fall back honestly", () => {
  assert.equal(classifyCuisine("Beef Tacos").cuisine, "mexican");
  assert.equal(classifyCuisine("Thai Green Curry").cuisine, "asian");
  assert.equal(classifyCuisine("Chicken Tikka Masala").cuisine, "indian");
  assert.equal(classifyCuisine("Curried Chickpeas with Spinach").cuisine, "indian", "Phase 7: 'curried' routes indian, not fallback");
  assert.equal(classifyCuisine("Algerian Kefta (Meatballs)").cuisine, "middle-eastern");
  assert.equal(classifyCuisine("Spaghetti Bolognese").cuisine, "italian");
  assert.equal(classifyCuisine("Shepherd's Pie").cuisine, "british-irish");
  const fb = classifyCuisine("Mystery Nonsense Dish");
  assert.equal(fb.confidence, "fallback");
  assert.equal(fb.cuisine, "western-comfort");
});

test("recipe cost: coverage-aware tiers, never a fabricated total", () => {
  const cheap = recipe("Lentil Rice Budget Bowl", [[F.lentils, 250, "protein"], [F.rice, 200, "carb"]]);
  const c = computeRecipeCost(cheap);
  assert.equal(c.tier, "cheap");
  const rich = recipe("Triple Salmon Feast", [[F.salmon, 450, "protein"], [F.oil, 20, "fat"]]);
  assert.equal(computeRecipeCost(rich).tier, "premium");
  const unknown = recipe("Alien Fruit Medley", [[{ name: "Zorblat Fruit", kcal: 50, protein: 1, fat: 0, carb: 12 }, 300, "carb"]]);
  assert.equal(computeRecipeCost(unknown).tier, "unknown");
});
