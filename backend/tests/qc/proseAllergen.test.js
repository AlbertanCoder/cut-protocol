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

// QC gauntlet 2026-07-24 — an allergen cooked in via FREE-FORM step text, not
// the "Add'l ingredients:" pattern and not an ingredient row: "stir in 1 TBSP
// butter", "heat the ghee", "add 1 egg to the soup". A sweep found 20 such
// step-only dairy leaks reaching a dairy-excluded plate. filterRecipePool now
// matches the whole step prose, add-only.
test("an allergen cooked in via free-form step text is excluded (the 20-leak sweep)", () => {
  const butterInSteps = {
    id: "s1", name: "Beef Banh Mi Bowls", slotType: "meal", carb: 40, kcal: 700,
    steps: ["Sear the beef.", "Stir in 1 TBSP butter and the sriracha mayo.", "Serve over rice."],
    ingredients: [{ food: { name: "Ground Beef" } }, { food: { name: "Rice" } }, { food: { name: "Carrot" } }],
  };
  // dairy is in NO ingredient row and NO title — only the steps
  assert.equal(butterInSteps.ingredients.some((i) => /butter/i.test(i.food.name)), false);
  assert.equal(filterRecipePool([butterInSteps], { dietaryStyle: null, excludedFoods: [] }).length, 1, "kept when no exclusion");
  assert.equal(filterRecipePool([butterInSteps], { dietaryStyle: null, excludedFoods: ["dairy"] }).length, 0, "excluded for a dairy allergy");

  const gheeInSteps = {
    id: "s2", name: "Chicken Mandi", slotType: "meal", carb: 50, kcal: 800,
    steps: ["Heat the ghee in a heavy pot.", "Add the rice and chicken."],
    ingredients: [{ food: { name: "Chicken" } }, { food: { name: "Basmati Rice" } }],
  };
  assert.equal(filterRecipePool([gheeInSteps], { dietaryStyle: null, excludedFoods: ["dairy"] }).length, 0, "ghee is dairy");

  const eggInSteps = {
    id: "s3", name: "Hot and Sour Soup", slotType: "meal", carb: 20, kcal: 300,
    steps: ["Simmer the broth.", "Slowly add 1 beaten egg to the soup, stirring."],
    ingredients: [{ food: { name: "Tofu" } }, { food: { name: "Bamboo Shoots" } }],
  };
  assert.equal(filterRecipePool([eggInSteps], { dietaryStyle: null, excludedFoods: ["eggs"] }).length, 0, "egg cooked into the soup");
});

test("over-exclusion is add-only, never clears a real exclusion", () => {
  // A step that mentions dairy in a negation ("without butter") is STILL dropped
  // for a dairy allergy — deliberate over-exclusion, the safe direction. A
  // negation-aware scan was rejected because "add butter, or omit for dairy-free"
  // carries a negation word yet cooks butter in.
  const negation = {
    id: "n1", name: "Plain Rice", slotType: "meal", carb: 45, kcal: 300,
    steps: ["Cook the rice without butter for a dairy-free version."],
    ingredients: [{ food: { name: "Rice" } }],
  };
  assert.equal(filterRecipePool([negation], { dietaryStyle: null, excludedFoods: ["dairy"] }).length, 0,
    "over-excludes on a negation — a lost safe recipe beats a missed real leak");
  // and with no dairy exclusion it is of course kept
  assert.equal(filterRecipePool([negation], { dietaryStyle: null, excludedFoods: ["gluten"] }).length, 1);
});
