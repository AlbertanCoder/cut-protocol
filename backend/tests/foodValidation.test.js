const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateFood, checkAtwater, checkNameShape, computeRecipeMacros,
  validateRecipe, nameKey, findDuplicateGroups,
} = require("../src/lib/foodValidation.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");
const { CATEGORY_SLUGS } = require("../src/lib/foodCategories.js");

const food = (over) => ({
  name: "Test food", category: "pantry", kcal: 100, protein: 5, fat: 2, carb: 15.5,
  fiber: 0, source: "manual", ...over,
});

test("clean foods pass: water, oil, chicken breast", () => {
  assert.equal(validateFood(food({ name: "Water", kcal: 0, protein: 0, fat: 0, carb: 0, category: "drinks" })).ok, true);
  assert.equal(validateFood(food({ name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0, category: "fats-nuts-oils" })).ok, true);
  assert.equal(validateFood(food({ name: "Chicken breast, cooked, skinless", kcal: 165, protein: 31, fat: 3.6, carb: 0, category: "protein" })).ok, true);
});

test("the pack's canonical failures are caught", () => {
  // Water at 19 kcal with protein
  const water = validateFood(food({ name: "Water", kcal: 19, protein: 2.6, fat: 0.2, carb: 3.13, category: "drinks" }));
  assert.equal(water.ok, false);
  assert.ok(water.issues.some((i) => i.code === "name-shape"));

  // Almonds showing 0 kcal (macros present)
  const almonds = validateFood(food({ name: "Almonds", kcal: 0, protein: 26.2, fat: 50.2, carb: 16.2, fiber: 9.27, category: "fats-nuts-oils" }));
  assert.equal(almonds.ok, false);
  assert.ok(almonds.issues.some((i) => i.code === "zero-kcal"));

  // Porridge oats carrying oil data (internally consistent — only the name betrays it)
  const oats = validateFood(food({ name: "Porridge oats", kcal: 884, protein: 0, fat: 100, carb: 0, category: "grains" }));
  assert.equal(oats.ok, false);
  assert.ok(oats.issues.some((i) => i.code === "name-shape"));
});

test("atwater: fiber-adjusted model, high-fiber band, hard failures", () => {
  // Ground cloves: correct USDA data that naive 4/4/9 rejects
  const cloves = food({ name: "Spices, cloves, ground", kcal: 274, protein: 6, fat: 13, carb: 65.5, fiber: 33.9 });
  assert.equal(checkAtwater(cloves).ok, true);
  // A genuinely wrong energy value still fails
  assert.equal(checkAtwater(food({ kcal: 400, protein: 5, fat: 2, carb: 15.5 })).ok, false);
});

test("alcohol exemption comes from the overrides file, never silently", () => {
  const wine = food({ name: "White Wine", kcal: 82, protein: 0.07, fat: 0, carb: 2.6, category: "drinks" });
  assert.equal(validateFood(wine).ok, false, "without exemptions wine fails Atwater");
  assert.equal(validateFood(wine, { exemptions: loadFoodOverrides() }).ok, true, "overrides document the alcohol exception");
});

test("negative and absurd values are rejected", () => {
  assert.ok(validateFood(food({ carb: -0.5 })).issues.some((i) => i.code === "negative"));
  assert.ok(validateFood(food({ kcal: 1200, fat: 100, protein: 0, carb: 0 })).issues.some((i) => i.code === "absurd"));
  assert.ok(validateFood(food({ protein: 60, fat: 40, carb: 20, kcal: 780 })).issues.some((i) => i.code === "absurd"));
});

test("name-shape does not false-positive on stocks, canned-in-water, or salts-in-names", () => {
  assert.equal(checkNameShape(food({ name: "Beef Stock", kcal: 13, protein: 1.97, fat: 0.09, carb: 1.2 })).length, 0);
  assert.equal(checkNameShape(food({ name: "Fish, tuna, light, canned in water, drained solids", kcal: 90, protein: 19, fat: 0.9, carb: 0.1 })).length, 0);
  assert.equal(checkNameShape(food({ name: "Pasta, cooked, enriched, with added salt", kcal: 157, protein: 5.8, fat: 0.9, carb: 30.6 })).length, 0);
  // ...but a bare "Salt" with butter macros is caught
  assert.ok(checkNameShape(food({ name: "Salt", kcal: 717, protein: 0.85, fat: 81.1, carb: 0.06 })).length > 0);
});

test("placeholders are always flagged", () => {
  const p = validateFood(food({ source: "manual-placeholder", kcal: 0, protein: 0, fat: 0, carb: 0 }));
  assert.ok(p.issues.some((i) => i.code === "placeholder"));
});

test("recipe macros recompute from ingredients and drift is caught", () => {
  const ingredients = [
    { baseGrams: 200, food: { kcal: 165, protein: 31, fat: 3.6, carb: 0 } },
    { baseGrams: 100, food: { kcal: 130, protein: 2.7, fat: 0.3, carb: 28 } },
  ];
  const t = computeRecipeMacros(ingredients);
  assert.equal(Math.round(t.kcal), 460);
  assert.equal(Math.round(t.protein), 65);

  const ok = validateRecipe({ name: "ok", kcal: t.kcal, protein: t.protein, fat: t.fat, carb: t.carb, ingredients });
  assert.equal(ok.ok, true);
  const drifted = validateRecipe({ name: "drifted", kcal: t.kcal * 2, protein: t.protein, fat: t.fat, carb: t.carb, ingredients });
  assert.ok(drifted.issues.some((i) => i.code === "macro-drift"));
});

test("duplicate grouping folds case, plurals, and punctuation", () => {
  const rows = [
    { name: "White Wine" }, { name: "white wine" },
    { name: "Pine Nuts" }, { name: "Pine nuts" },
    { name: "Coriander Seeds" }, { name: "coriander seeds" },
    { name: "Egg" }, { name: "Eggs" },
    { name: "Lemon" }, { name: "Lemons" },
    { name: "Chicken Breast" }, { name: "chicken breasts" },
    { name: "Lemon Juice" }, { name: "Lemon juice, raw" }, // different foods — must NOT merge
  ];
  const groups = findDuplicateGroups(rows);
  assert.equal(groups.length, 6);
  assert.ok(!groups.some(([key]) => key.includes("juice")));
  assert.equal(nameKey("Coriander Seeds"), nameKey("coriander seeds"));
});

test("every curated override with values passes its own validation", () => {
  const overrides = loadFoodOverrides();
  for (const [key, entry] of Object.entries(overrides)) {
    if (typeof entry.kcal !== "number") continue; // exemption-only entries
    const candidate = {
      name: key, kcal: entry.kcal, protein: entry.protein, fat: entry.fat,
      carb: entry.carb, fiber: entry.fiber ?? 0,
      category: entry.category || "pantry",
      source: entry.fdcId ? "usda" : "manual",
    };
    const { ok, issues } = validateFood(candidate, { exemptions: overrides, validCategories: CATEGORY_SLUGS });
    assert.equal(ok, true, `override "${key}" fails its own validation: ${JSON.stringify(issues)}`);
  }
});
