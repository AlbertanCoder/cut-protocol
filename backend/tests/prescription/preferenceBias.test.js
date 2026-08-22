// preferenceBias — the soft taste multiplier the fleet showed was missing
// (2026-08-20: mediterranean got Tex-Mex, picky eaters got a world tour,
// spice lovers got nothing hot in two days).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPreferenceBias } = require("../../src/lib/prescription/preferenceBias.js");

const dish = (over = {}) => ({ name: "Grilled Chicken Plate", cuisine: null, ingredients: [{}, {}, {}, {}], ...over });

test("no preferences expressed → no bias function at all", () => {
  assert.equal(buildPreferenceBias({}), null);
  assert.equal(buildPreferenceBias({ cuisinePreferences: [], mealPreferencesNote: "" }), null);
  assert.equal(buildPreferenceBias(null), null);
});

test("explicit cuisine preference boosts matches, penalises other TAGGED cuisines, leaves untagged neutral", () => {
  const bias = buildPreferenceBias({ cuisinePreferences: ["mexican", "thai"] });
  assert.ok(bias(dish({ cuisine: "mexican" })) > 1, "preferred cuisine pulls");
  assert.ok(bias(dish({ cuisine: "chinese" })) < 1, "non-preferred tagged cuisine yields");
  assert.equal(bias(dish({ cuisine: null })), 1, "untagged recipes (most of the pool) stay neutral");
});

test("a mediterranean DIETARY STYLE implies a softer mediterranean pull — explicit prefs override it", () => {
  const implied = buildPreferenceBias({ dietaryStyle: "mediterranean" });
  assert.ok(implied, "the style alone is a preference signal");
  const med = implied(dish({ cuisine: "mediterranean" }));
  const tex = implied(dish({ cuisine: "tex-mex" }));
  assert.ok(med > 1 && tex < 1, `mediterranean pulls (${med}) and tex-mex yields (${tex})`);

  const explicit = buildPreferenceBias({ dietaryStyle: "mediterranean", cuisinePreferences: ["indian"] });
  assert.ok(explicit(dish({ cuisine: "indian" })) > explicit(dish({ cuisine: "mediterranean" })), "an explicit pick beats the implied one");
});

test("a plain/picky note steers toward short ingredient lists and away from heat", () => {
  const bias = buildPreferenceBias({ mealPreferencesNote: "picky eater — plain, familiar food only" });
  assert.ok(bias(dish({ ingredients: new Array(12).fill({}) })) < 1, "12-row dishes yield");
  assert.ok(bias(dish({ ingredients: new Array(4).fill({}) })) > 1, "4-row dishes pull");
  assert.ok(bias(dish({ name: "Jamaican Curry Shrimp" })) < 1, "spicy names yield for plain eaters");
});

test("a spicy note pulls spicy-named dishes", () => {
  const bias = buildPreferenceBias({ mealPreferencesNote: "I love spicy food" });
  assert.ok(bias(dish({ name: "Chipotle Chicken Bowl" })) > 1);
  assert.equal(bias(dish()), 1, "everything else stays neutral");
});

test("it is a multiplier, never a veto — nothing reaches zero", () => {
  const bias = buildPreferenceBias({ cuisinePreferences: ["mexican"], mealPreferencesNote: "plain picky" });
  const worst = bias(dish({ cuisine: "thai", name: "Spicy Sichuan Hotpot", ingredients: new Array(14).fill({}) }));
  assert.ok(worst > 0, `worst case must stay positive, got ${worst}`);
});

test("'I dislike fish' in the note steers away from fish dishes through the allergen vocabulary", () => {
  // ~20 fleet reviews: the only way to keep fish off the plate was to lie
  // and call it an allergy. The note carries it now — softly, not a veto.
  const bias = buildPreferenceBias({ mealPreferencesNote: "I dislike fish" });
  assert.ok(bias, "a dislike alone is a preference signal");
  const haddock = bias(dish({ name: "Smoked Haddock & Pea Rice Bowl", ingredients: [{ food: { name: "Smoked Haddock" } }, { food: { name: "White rice, cooked" } }] }));
  assert.ok(haddock < 0.5, `haddock must yield hard for a fish-disliker, got ${haddock}`);
  const chicken = bias(dish({ name: "Grilled Chicken Plate", ingredients: [{ food: { name: "Chicken breast, cooked, skinless" } }] }));
  assert.equal(chicken, 1, "non-fish dishes stay neutral");
  assert.ok(haddock > 0, "a dislike is never a veto");
});

test("dislike parsing reads verbs, not stray words", () => {
  assert.equal(buildPreferenceBias({ mealPreferencesNote: "fish is fine actually" }), null, "no dislike verb, no signal");
  const b = buildPreferenceBias({ mealPreferencesNote: "hates mushrooms, no onions" });
  const shroom = b(dish({ name: "Creamy Mushroom Skillet", ingredients: [{ food: { name: "Mushrooms, white, raw" } }] }));
  assert.ok(shroom < 0.5, `mushroom dish must yield, got ${shroom}`);
});

test("partitionByPreference: dislikes and plainness hold for every preferred dish; untagged cuisine stays in", () => {
  const { partitionByPreference } = require("../../src/lib/prescription/preferenceBias.js");
  const pool = [
    { name: "Grilled Chicken Plate", cuisine: "american", ingredients: [{ food: { name: "Chicken breast, cooked, skinless" } }] },
    { name: "Smoked Haddock & Pea Rice Bowl", cuisine: null, ingredients: [{ food: { name: "Smoked Haddock" } }] },
    { name: "Jamaican Curry Shrimp", cuisine: null, ingredients: new Array(12).fill({ food: { name: "Shrimp" } }) },
    { name: "Steak & Potato", cuisine: null, ingredients: [{ food: { name: "Sirloin steak, cooked, lean" } }] },
  ];
  // Fish-disliker: the haddock bowl leaves; everything else stays.
  const fish = partitionByPreference(pool, { mealPreferencesNote: "you dislike fish" });
  assert.deepEqual(fish.preferred.map((r) => r.name), ["Grilled Chicken Plate", "Jamaican Curry Shrimp", "Steak & Potato"], "prawns/shrimp are shellfish, not fish — only the true fish dish leaves");
  // Picky: the 12-ingredient curry leaves.
  const plain = partitionByPreference(pool, { mealPreferencesNote: "picky eater — plain, familiar food only" });
  assert.ok(!plain.preferred.some((r) => r.name.includes("Curry")), "fussy dishes leave a plain eater's pool");
  // Explicit cuisine: tagged mismatches leave, untagged stay.
  const med = partitionByPreference(pool, { cuisinePreferences: ["mediterranean"] });
  assert.ok(!med.preferred.some((r) => r.cuisine === "american"), "tagged-mismatching cuisine leaves");
  assert.ok(med.preferred.some((r) => r.name === "Steak & Potato"), "untagged rows are not a mismatch");
  // No preferences: the pool passes through untouched.
  const none = partitionByPreference(pool, {});
  assert.equal(none.preferred.length, pool.length);
});

test("the solver honors a dislike outright when the pool can afford it", () => {
  const { solvePrescriptionDay } = require("../../src/lib/prescription/daySolver.js");
  const { makeRng } = require("../../src/lib/prescription/rng.js");
  const FOOD = {
    chicken: { id: "f1", name: "Chicken breast, cooked, skinless", kcal: 165, protein: 31, fat: 3.6, carb: 0, fiber: 0 },
    rice: { id: "f2", name: "White rice, cooked", kcal: 130, protein: 2.7, fat: 0.3, carb: 28, fiber: 0.4 },
    fish: { id: "f3", name: "White Fish", kcal: 92, protein: 16.8, fat: 2.3, carb: 0, fiber: 0 },
    oil: { id: "f4", name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0, fiber: 0 },
  };
  const dish = (id, name, protFood) => ({
    id, name, slotType: "meal", mealCategory: null, kcal: 500, protein: 40, fat: 12, carb: 45,
    ingredients: [
      { foodId: protFood.id, baseGrams: 200, scalable: true, role: "protein", food: protFood },
      { foodId: FOOD.rice.id, baseGrams: 150, scalable: true, role: "carb", food: FOOD.rice },
      { foodId: FOOD.oil.id, baseGrams: 8, scalable: true, role: "fat", food: FOOD.oil },
    ],
  });
  // Plenty of chicken dishes, plenty of fish dishes — a fish-disliker's day
  // must come out all-chicken, because the pool can afford it.
  const pool = [];
  for (let i = 0; i < 14; i++) pool.push(dish(`c${i}`, `Chicken Plate ${i}`, FOOD.chicken));
  for (let i = 0; i < 14; i++) pool.push(dish(`f${i}`, `White Fish Plate ${i}`, FOOD.fish));
  const solved = solvePrescriptionDay({
    pool,
    targets: { kcal: 1600, proteinG: { lo: 110, hi: 140 }, fatG: { lo: 40, hi: 60 }, netCarbG: { lo: 100, hi: 160 } },
    mealConfig: { meals: 3, snacks: 0 },
    profile: { mealPreferencesNote: "you dislike fish", excludedFoods: [] },
    rng: makeRng(7),
    bias: null,
  });
  const names = solved.slots.flatMap((s) => s.dishes.map((d) => d.recipeName));
  assert.ok(names.length >= 3, `a day was built: ${names.join(", ")}`);
  assert.ok(names.every((n) => !n.includes("Fish")), `no fish for a fish-disliker when chicken can carry the day: ${names.join(", ")}`);
});
