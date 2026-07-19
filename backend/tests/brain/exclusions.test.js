const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isExcluded, explainExclusion, isCheckableName } = require("../../src/lib/brain/exclusions.js");

// Fixtures mirror the loaded shape: a recipe's ingredients carry `food` (with a
// name), matching the DB include the solver uses.
function food(name, over = {}) {
  return { id: name, name, category: "other", kcal: 100, protein: 5, fat: 2, carb: 10, fiber: 0, ...over };
}
function recipe(name, ingredients, over = {}) {
  return {
    id: name, name, slotType: "meal", mealCategory: null, cuisine: null,
    kcal: 400, protein: 30, fat: 12, carb: 40,
    ingredients: ingredients.map((f) => ({ foodId: f.id, baseGrams: 100, scalable: true, role: null, food: f })),
    ...over,
  };
}

const CHICKEN = food("Chicken Breast", { category: "protein", protein: 31, fat: 3.6, carb: 0 });
const TOFU = food("Firm Tofu", { category: "protein", protein: 15, fat: 8, carb: 3 });
const RICE = food("White Rice", { category: "carb", protein: 2.7, fat: 0.3, carb: 28 });
const SHRIMP = food("Shrimp", { category: "protein", protein: 24, fat: 0.3, carb: 0 });
const CURRY_PASTE = food("Thai Red Curry Paste"); // shellfish-hidden (kapi) per dietaryFilter

test("reuses dietaryFilter's maps: shellfish exclusion catches a shrimp ingredient (transitive)", () => {
  const r = recipe("Shrimp Fried Rice", [SHRIMP, RICE]);
  const e = explainExclusion(r, { excludedFoods: ["shellfish"] });
  assert.equal(e.excluded, true);
  assert.equal(e.reason, "excluded-food:shellfish");
  assert.equal(e.failClosed, false);
});

test("reuses the compound-term maps: 'curry paste' is caught for a shellfish exclusion (no species word)", () => {
  const r = recipe("Thai Curry", [CHICKEN, CURRY_PASTE, RICE]);
  assert.equal(isExcluded(r, { excludedFoods: ["shellfish"] }), true);
});

test("dietary style is transitive over ingredients: vegan excludes a chicken recipe, allows an all-plant one", () => {
  const meaty = recipe("Chicken & Rice", [CHICKEN, RICE]);
  const plant = recipe("Tofu & Rice", [TOFU, RICE]);
  assert.equal(isExcluded(meaty, { dietaryStyle: "vegan" }), true);
  assert.equal(isExcluded(plant, { dietaryStyle: "vegan" }), false);
});

test("FAIL-CLOSED: a recipe with an unresolvable ingredient (no food, no name) is excluded and flagged", () => {
  const r = recipe("Mystery Dish", [CHICKEN]);
  r.ingredients.push({ foodId: "x", baseGrams: 50, scalable: true, role: null, food: null }); // no name anywhere
  const e = explainExclusion(r, { dietaryStyle: "none", excludedFoods: [] });
  assert.equal(e.excluded, true, "cannot prove it safe -> excluded");
  assert.equal(e.failClosed, true, "flagged as a fail-closed exclusion for logging");
  assert.equal(e.reason, "unresolvable-ingredient");
});

test("FAIL-CLOSED: a food with a blank/absent name is excluded", () => {
  assert.equal(isExcluded({ id: "f", name: "" }, {}), true);
  assert.equal(explainExclusion({ id: "f", name: 42 }, {}).failClosed, true);
  assert.equal(isCheckableName("  "), false);
  assert.equal(isCheckableName("Chicken"), true);
});

test("flat food: free-text excludedFoods term matches by name (kiwi)", () => {
  assert.equal(isExcluded(food("Kiwi"), { excludedFoods: ["kiwi"] }), true);
  assert.equal(isExcluded(food("White Rice"), { excludedFoods: ["kiwi"] }), false);
});

test("authoritative-only: with an empty profile, nothing is excluded (no free-text/LLM path can add one)", () => {
  const r = recipe("Chicken & Rice", [CHICKEN, RICE]);
  assert.equal(isExcluded(r, {}), false);
  assert.equal(isExcluded(r, { dietaryStyle: "none", excludedFoods: [] }), false);
});

test("isExcluded is exactly explainExclusion().excluded", () => {
  const r = recipe("Shrimp & Rice", [SHRIMP, RICE]);
  const p = { excludedFoods: ["shellfish"] };
  assert.equal(isExcluded(r, p), explainExclusion(r, p).excluded);
});
