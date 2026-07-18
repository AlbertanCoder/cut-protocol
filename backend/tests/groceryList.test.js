const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildGroceryList, classifyStoreSection, convertToPurchaseQuantity } = require("../src/lib/groceryList.js");

// Fixtures mirror the {status,anchor:{ingredients},adjusters} shape
// buildGroceryList() expects (see routes/plans.js's planToGroceryListInput()
// adapter for how cut-protocol's real Plan/PlanSlot data gets reshaped into
// this same contract).

function solvedMeal({ recipeId = "r1", name = "Test dish", ingredients, adjusters = [] }) {
  return {
    status: "solved",
    anchor: { recipeId, name, scale: 1, ingredients, steps: ["Cook it.", "Serve."] },
    adjusters,
    achieved: { kcal: 500, p: 40, f: 15, c: 50 },
    delta: { kcal: 0, p: 0, f: 0, c: 0 },
    score: 1,
  };
}

// ---------------------------------------------------------------------
// convertToPurchaseQuantity — yield conversion, honest fallback
// ---------------------------------------------------------------------

test("convertToPurchaseQuantity: known yield converts cooked grams to raw purchase grams", () => {
  // groceryYields.js: "chicken breast" -> 0.71 (cooked / raw)
  const result = convertToPurchaseQuantity("Chicken breast, cooked, skinless", 213, "cooked");
  assert.equal(result.isConverted, true);
  assert.equal(result.yieldFactor, 0.71);
  assert.equal(result.grams, 300); // 213 / 0.71
  assert.equal(result.form, "raw");
});

test("convertToPurchaseQuantity: known dry-grain yield converts cooked grams to dry purchase grams", () => {
  // groceryYields.js: "white rice" -> 3.0 (cooked / dry)
  const result = convertToPurchaseQuantity("White rice, cooked", 300, "cooked");
  assert.equal(result.isConverted, true);
  assert.equal(result.yieldFactor, 3.0);
  assert.equal(result.grams, 100); // 300 / 3.0
  assert.equal(result.form, "dry");
});

test("convertToPurchaseQuantity: unknown yield falls back HONESTLY to as-prepared grams, never silently guessed as a purchase quantity", () => {
  const result = convertToPurchaseQuantity("Mystery Casserole Mix", 250, "cooked");
  assert.equal(result.isConverted, false);
  assert.equal(result.yieldFactor, null);
  assert.equal(result.grams, 250); // unchanged - never fabricates a conversion
  assert.match(result.form, /as-prepared/i);
  assert.match(result.form, /not.*purchase/i);
});

test("convertToPurchaseQuantity: an already-raw/dry ingredient needs no conversion and is not mislabeled", () => {
  const raw = convertToPurchaseQuantity("Almonds", 30, "raw");
  assert.equal(raw.isConverted, false);
  assert.equal(raw.grams, 30);
  assert.equal(raw.form, "raw");

  const dry = convertToPurchaseQuantity("Quinoa", 80, "dry");
  assert.equal(dry.isConverted, false);
  assert.equal(dry.grams, 80);
  assert.equal(dry.form, "dry");
});

test("convertToPurchaseQuantity: state unrecorded (cut-protocol's PlanSlot has no state field) is honestly labeled, not guessed", () => {
  const result = convertToPurchaseQuantity("Chicken breast, cooked, skinless", 150, undefined);
  assert.equal(result.isConverted, false);
  assert.equal(result.grams, 150);
  assert.match(result.form, /state unrecorded/i);
  assert.match(result.form, /not.*purchase/i);
});

// ---------------------------------------------------------------------
// classifyStoreSection
// ---------------------------------------------------------------------

test("classifyStoreSection: protein", () => {
  assert.equal(classifyStoreSection("Chicken breast, cooked, skinless"), "protein");
  assert.equal(classifyStoreSection("Salmon fillet"), "protein");
  assert.equal(classifyStoreSection("Large eggs"), "protein");
});

test("classifyStoreSection: dairy", () => {
  assert.equal(classifyStoreSection("Greek yogurt, plain, nonfat"), "dairy");
  assert.equal(classifyStoreSection("Cheddar cheese, shredded"), "dairy");
});

test("classifyStoreSection: produce", () => {
  assert.equal(classifyStoreSection("Banana"), "produce");
  assert.equal(classifyStoreSection("Fresh spinach"), "produce");
  assert.equal(classifyStoreSection("Yellow onion"), "produce");
});

test("classifyStoreSection: pantry/dry goods", () => {
  assert.equal(classifyStoreSection("White rice, cooked"), "pantry");
  assert.equal(classifyStoreSection("Rolled oats"), "pantry");
  assert.equal(classifyStoreSection("Olive oil"), "pantry");
});

test("classifyStoreSection: spices", () => {
  assert.equal(classifyStoreSection("Ground cumin"), "spices");
  assert.equal(classifyStoreSection("Salt"), "spices");
});

test("classifyStoreSection: falls back to 'other' honestly rather than guessing a category", () => {
  assert.equal(classifyStoreSection("Sriracha Mayo Blend XJ-9"), "other");
});

test("classifyStoreSection: plural ingredient names still match their singular keyword (regression guard)", () => {
  assert.equal(classifyStoreSection("Potatoes"), "produce");
  assert.equal(classifyStoreSection("Carrots"), "produce");
  assert.equal(classifyStoreSection("Onions"), "produce");
  assert.equal(classifyStoreSection("Almonds"), "pantry");
  assert.equal(classifyStoreSection("Eggs"), "protein");
});

// Phase 7 fix for the previously-documented limitation: fresh peppers are
// produce; bare "pepper" (black pepper, flakes) stays a spice.
test("classifyStoreSection: fresh peppers are produce, ground/black pepper stays a spice (Phase 7 fix)", () => {
  assert.equal(classifyStoreSection("Bell peppers"), "produce");
  assert.equal(classifyStoreSection("Jalapeno"), "produce");
  assert.equal(classifyStoreSection("Black pepper, ground"), "spices");
  assert.equal(classifyStoreSection("Red pepper flakes"), "spices");
});

// Phase 7 fix: a dairy word with a plant/legume qualifier is not dairy.
// One-word "Buttermilk" has no qualifier and stays dairy.
test("classifyStoreSection: butter beans / peanut butter / plant milks are not dairy; buttermilk is (Phase 7 fix)", () => {
  assert.equal(classifyStoreSection("Butter Beans"), "pantry");
  assert.equal(classifyStoreSection("Peanut Butter"), "pantry");
  assert.equal(classifyStoreSection("Almond Milk"), "pantry");
  assert.equal(classifyStoreSection("Buttermilk"), "dairy");
  assert.equal(classifyStoreSection("Butter"), "dairy");
});

// ---------------------------------------------------------------------
// buildGroceryList — aggregation across multiple meals
// ---------------------------------------------------------------------

test("buildGroceryList: sums the same ingredient across multiple meals in a day plan", () => {
  const dayPlan = {
    meals: [
      solvedMeal({
        recipeId: "r1", name: "Chicken rice bowl",
        ingredients: [
          { name: "Chicken breast, cooked, skinless", grams: 150, state: "cooked", fdcId: 1 },
          { name: "White rice, cooked", grams: 200, state: "cooked", fdcId: 2 },
        ],
      }),
      solvedMeal({
        recipeId: "r2", name: "Chicken stir fry",
        ingredients: [
          { name: "Chicken breast, cooked, skinless", grams: 100, state: "cooked", fdcId: 1 },
          { name: "Broccoli", grams: 80, state: "cooked", fdcId: 3 },
        ],
      }),
    ],
  };
  const list = buildGroceryList(dayPlan);
  const chicken = list.items.find((i) => i.name === "Chicken breast, cooked, skinless");
  assert.ok(chicken, "expected an aggregated chicken breast line item");
  assert.equal(chicken.preparedGrams, 250); // 150 + 100
  assert.equal(chicken.occurrences, 2);
  assert.equal(chicken.purchase.isConverted, true);
  assert.ok(Math.abs(chicken.purchase.grams - 250 / 0.71) < 0.5);
});

test("buildGroceryList: aggregates adjusters too, not just anchor ingredients", () => {
  const dayPlan = {
    meals: [
      solvedMeal({
        ingredients: [{ name: "Salmon fillet", grams: 120, state: "cooked", fdcId: 1 }],
        adjusters: [{ id: "almonds", name: "Almonds", grams: 20, state: "raw" }],
      }),
    ],
  };
  const list = buildGroceryList(dayPlan);
  const almonds = list.items.find((i) => i.name === "Almonds");
  assert.ok(almonds);
  assert.equal(almonds.preparedGrams, 20);
  assert.equal(almonds.purchase.isConverted, false);
});

test("buildGroceryList: only sums SOLVED meals, never fabricates from an infeasible/unassigned slot", () => {
  const dayPlan = {
    meals: [
      solvedMeal({ ingredients: [{ name: "Banana", grams: 100, state: "raw", fdcId: 1 }] }),
      { status: "infeasible", bindingMacro: "p", poolTrace: [], suggestions: ["widen tolerance"], bestAttempt: null },
    ],
  };
  const list = buildGroceryList(dayPlan);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].name, "Banana");
});

test("buildGroceryList: groups items by store section", () => {
  const dayPlan = {
    meals: [
      solvedMeal({
        ingredients: [
          { name: "Chicken breast, cooked, skinless", grams: 150, state: "cooked", fdcId: 1 },
          { name: "White rice, cooked", grams: 200, state: "cooked", fdcId: 2 },
          { name: "Fresh spinach", grams: 60, state: "raw", fdcId: 3 },
        ],
        adjusters: [{ id: "olive-oil", name: "Olive oil", grams: 10, state: "raw" }],
      }),
    ],
  };
  const list = buildGroceryList(dayPlan);
  assert.ok(list.bySection.protein.some((i) => i.name === "Chicken breast, cooked, skinless"));
  assert.ok(list.bySection.pantry.some((i) => i.name === "White rice, cooked" || i.name === "Olive oil"));
  assert.ok(list.bySection.produce.some((i) => i.name === "Fresh spinach"));
  const sectionCounts = Object.values(list.bySection).reduce((sum, arr) => sum + arr.length, 0);
  assert.equal(sectionCounts, list.items.length);
});

test("buildGroceryList: cost estimate is present, labeled, and rough - never a fabricated precise-looking number", () => {
  const dayPlan = {
    meals: [solvedMeal({ ingredients: [{ name: "Banana", grams: 100, state: "raw", fdcId: 1 }] })],
  };
  const list = buildGroceryList(dayPlan);
  const banana = list.items.find((i) => i.name === "Banana");
  assert.ok(banana.cost);
  assert.equal(banana.cost.isEstimate, true);
  assert.ok(typeof banana.cost.note === "string" && banana.cost.note.length > 0);
  assert.equal(list.totalEstimatedCostCad, banana.cost.amountCad);
});

test("buildGroceryList: an ingredient with no price match reports cost: null honestly, never a $0 or invented figure", () => {
  const dayPlan = {
    meals: [solvedMeal({ ingredients: [{ name: "Sriracha Mayo Blend XJ-9", grams: 50, state: "raw", fdcId: 1 }] })],
  };
  const list = buildGroceryList(dayPlan);
  const item = list.items[0];
  assert.equal(item.cost, null);
});

test("buildGroceryList: works against a week-plan (variety mode) result shape - sums across all days", () => {
  const weekResult = {
    mode: "variety",
    days: [
      { meals: [solvedMeal({ ingredients: [{ name: "Chicken breast, cooked, skinless", grams: 150, state: "cooked", fdcId: 1 }] })] },
      { meals: [solvedMeal({ ingredients: [{ name: "Chicken breast, cooked, skinless", grams: 150, state: "cooked", fdcId: 1 }] })] },
    ],
  };
  const list = buildGroceryList(weekResult);
  const chicken = list.items.find((i) => i.name === "Chicken breast, cooked, skinless");
  assert.equal(chicken.preparedGrams, 300); // 150 x 2 days
  assert.equal(chicken.occurrences, 2);
});

test("buildGroceryList: works against a week-plan batch mode result shape (days[].meals same as variety)", () => {
  const weekResult = {
    mode: "batch",
    days: [
      { dayIndex: 0, meals: [solvedMeal({ ingredients: [{ name: "White rice, cooked", grams: 200, state: "cooked", fdcId: 1 }] })] },
      { dayIndex: 1, meals: [solvedMeal({ ingredients: [{ name: "White rice, cooked", grams: 210, state: "cooked", fdcId: 1 }] })] },
    ],
  };
  const list = buildGroceryList(weekResult);
  const rice = list.items.find((i) => i.name === "White rice, cooked");
  assert.equal(rice.preparedGrams, 410);
  assert.ok(Math.abs(rice.purchase.grams - 410 / 3.0) < 0.5);
});

test("buildGroceryList: an empty/no-solved plan returns an empty, non-crashing list", () => {
  const list = buildGroceryList({ meals: [{ status: "infeasible", bestAttempt: null }] });
  assert.equal(list.items.length, 0);
  assert.equal(list.totalEstimatedCostCad, null);
});

// Note: recomp-v2's original test file has one additional integration test
// exercising buildGroceryList() against a REAL planDay()/mealSolver.js
// output. That solver was deliberately NOT ported into cut-protocol this
// pass (see docs note in plans.js's planToGroceryListInput()) - cut-protocol
// keeps its own existing weeklyPlanner.js solver - so that specific
// integration test doesn't have anything to run against here and was
// dropped rather than faked. Every unit-level test above (which is what
// actually exercises this ported module's own logic) was kept.
