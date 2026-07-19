const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planDay } = require("../../src/lib/brain/planner.js");
const { buildPool } = require("../../src/lib/brain/pool.js");
const { isExcluded } = require("../../src/lib/brain/exclusions.js");
const { makeRng } = require("../helpers/seededRng.js");

// A library spanning several allergen classes so random exclusions actually bite.
function food(id, kcal, p, f, c) { return { id, name: id, category: "other", kcal, protein: p, fat: f, carb: c }; }
const F = {
  chicken: food("Chicken Breast", 165, 31, 3.6, 0),
  beef: food("Lean Beef", 250, 26, 15, 0),
  shrimp: food("Shrimp", 99, 24, 0.3, 0),
  salmon: food("Salmon", 208, 20, 13, 0),
  tofu: food("Firm Tofu", 144, 15, 8, 3),
  peanuts: food("Peanuts", 567, 26, 49, 16),
  cheese: food("Cheddar Cheese", 403, 25, 33, 1),
  rice: food("White Rice", 130, 2.7, 0.3, 28),
  bread: food("Wheat Bread", 265, 9, 3, 49),
  broccoli: food("Broccoli", 34, 2.8, 0.4, 7),
  egg: food("Egg", 143, 13, 10, 1),
};
function ing(fd, g, role) { return { foodId: fd.id, baseGrams: g, scalable: true, role, food: fd }; }
function rec(id, ings) {
  const t = ings.reduce((s, i) => { const k = i.baseGrams / 100; return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k }; }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name: id, slotType: "meal", mealCategory: null, ingredients: ings, ...t };
}
const RECIPES = [
  rec("Chicken & Rice", [ing(F.chicken, 150, "protein"), ing(F.rice, 150, "carb")]),
  rec("Beef & Broccoli", [ing(F.beef, 150, "protein"), ing(F.broccoli, 150, "veg")]),
  rec("Shrimp Rice", [ing(F.shrimp, 150, "protein"), ing(F.rice, 150, "carb")]),
  rec("Salmon & Rice", [ing(F.salmon, 150, "protein"), ing(F.rice, 150, "carb")]),
  rec("Tofu Scramble", [ing(F.tofu, 200, "protein"), ing(F.egg, 50, "protein")]),
  rec("Peanut Chicken", [ing(F.chicken, 150, "protein"), ing(F.peanuts, 40, "fat"), ing(F.rice, 120, "carb")]),
  rec("Cheesy Beef", [ing(F.beef, 150, "protein"), ing(F.cheese, 50, "fat"), ing(F.bread, 60, "carb")]),
  rec("Chicken Sandwich", [ing(F.chicken, 150, "protein"), ing(F.bread, 80, "carb")]),
  rec("Egg Fried Rice", [ing(F.egg, 100, "protein"), ing(F.rice, 180, "carb")]),
  rec("Tofu & Broccoli", [ing(F.tofu, 200, "protein"), ing(F.broccoli, 150, "veg")]),
];
const LIBRARY = { recipes: RECIPES, foods: Object.values(F) };
const TARGET = { kcal: 1800, proteinLo: 150, proteinHi: 170, fatLo: 40, fatHi: 90, carbLo: 120, carbHi: 220 };
const CONFIG = { meals: 3, snacks: 0 };
const EXCLUSION_POOL = ["shellfish", "fish", "peanuts", "dairy", "gluten", "eggs"];
const STYLES = [null, "none", "vegan", "vegetarian"];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function randomProfile(rng) {
  const n = Math.floor(rng() * 3); // 0-2 exclusion terms
  const excludedFoods = [];
  for (let i = 0; i < n; i++) { const t = pick(rng, EXCLUSION_POOL); if (!excludedFoods.includes(t)) excludedFoods.push(t); }
  return { dietaryStyle: pick(rng, STYLES), excludedFoods };
}

test("property: 1000+ fuzzed profiles/picks — NO excluded item ever surfaces AND every plate number is tool-sourced", async () => {
  const rng = makeRng(1337);
  const N = 1000;
  let cases = 0;
  let slotsChecked = 0;
  for (let n = 0; n < N; n++) {
    const profile = randomProfile(rng);
    const pool = buildPool(profile, LIBRARY);
    // The "model" proposes RANDOM ids from the FULL library — excluded ones
    // included. The code layer (pool + tool boundary + verifier) must let none through.
    const proposeDayFn = async ({ slotTargets }) => ({ slots: slotTargets.map((st) => ({ ...st, recipeId: pick(rng, RECIPES).id })) });
    const res = await planDay({ profile, target: TARGET, mealConfig: CONFIG, library: LIBRARY }, { enabled: true, depth: "fast", proposeDayFn });

    for (const s of res.day) {
      // INVARIANT 1 — never an excluded/unknown item.
      assert.ok(pool.recipes.has(s.recipeId), `case ${n}: ${s.recipeId} not in the filtered pool`);
      assert.equal(pool.excludedIds.has(s.recipeId), false, `case ${n}: an excluded id surfaced`);
      assert.equal(isExcluded(pool.recipes.get(s.recipeId), profile), false, `case ${n}: an excluded recipe surfaced`);
      // INVARIANT 2 — every plate number carries provenance (originated in a tool).
      assert.ok(s.prov && typeof s.prov.formulaId === "string", `case ${n}: a plate number lacks provenance`);
      assert.ok(s.macros && typeof s.macros.kcal === "number", `case ${n}: slot has no computed MacroVector`);
      slotsChecked++;
    }
    cases++;
  }
  assert.equal(cases, N);
  assert.ok(slotsChecked > 0, "some slots resolved across the fuzz set (the invariants weren't vacuous throughout)");
});
