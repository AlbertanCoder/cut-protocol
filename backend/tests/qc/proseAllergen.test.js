// QC customer #7 — an allergen declared in a recipe's STEP text ("Add'l
// ingredients: mayonnaise, siracha") but absent from its structured ingredient
// rows slipped past the allergen filter. filterRecipePool now folds those
// declared names in. Pins the parser + the defence-in-depth exclusion.
const test = require("node:test");
const assert = require("node:assert");
const { additionalIngredientNames } = require("../../src/lib/dietaryFilter.js");
const { filterRecipePool } = require("../../src/lib/planContext.js");

test("additionalIngredientNames pulls the importer's dropped ingredients", () => {
  assert.deepEqual(
    additionalIngredientNames(["Add'l ingredients: mayonnaise, siracha", "Cook the rice."]),
    ["mayonnaise", "siracha"]
  );
  assert.deepEqual(additionalIngredientNames(["Just cook it."]), []);
  assert.deepEqual(additionalIngredientNames("Addl ingredients: parmesan and cream"), ["parmesan", "cream"]);
});

test("a prose-only allergen is excluded for the matching allergy", () => {
  const recipe = {
    id: "r1", name: "Beef Bowl", slotType: "meal", carb: 30, kcal: 600,
    steps: ["Add'l ingredients: mayonnaise", "Cook the beef and rice."],
    ingredients: [{ food: { name: "Ground Beef" } }, { food: { name: "Rice" } }],
  };
  // no exclusion -> kept
  assert.equal(filterRecipePool([recipe], { dietaryStyle: null, excludedFoods: [] }).length, 1);
  // egg allergy -> the prose mayonnaise (egg) now excludes it
  assert.equal(filterRecipePool([recipe], { dietaryStyle: null, excludedFoods: ["eggs"] }).length, 0);
});

test("a recipe without the prose pattern is unaffected (golden-safe)", () => {
  const recipe = {
    id: "r2", name: "Chicken & Rice", slotType: "meal", carb: 40, kcal: 500,
    steps: ["Grill the chicken.", "Serve over rice."],
    ingredients: [{ food: { name: "Chicken Breast" } }, { food: { name: "Rice" } }],
  };
  assert.equal(filterRecipePool([recipe], { dietaryStyle: null, excludedFoods: ["eggs", "dairy"] }).length, 1);
});
