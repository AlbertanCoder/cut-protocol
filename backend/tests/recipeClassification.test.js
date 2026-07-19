// Pure unit tests for the recipe meal-category classifier.
// NO prisma, NO DB, NO I/O — runs anywhere with: node --test tests/recipeClassification.test.js
//
// Covers: obvious desserts, obvious dinners, the ambiguous pie/cake/pudding
// gate, the condiment macro gate, the ingredient/macro dessert pass, source
// tag corroboration, breakfast handling, the naive-substring bugs the roadmap
// warned about (graham→ham, cake→pancake), flexible input shapes, and the
// meal-slot eligibility contract the solver depends on.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyRecipe,
  isMealSlotEligible,
  looksSweetByMacros,
  hasWord,
  NON_MEAL_CATEGORIES,
  MEAL_CATEGORY_VALUES,
} = require("../src/lib/recipeClassification.js");

// small helper
const cat = (recipe) => classifyRecipe(recipe).category;
const meal = (recipe) => classifyRecipe(recipe).mealCategory;
const eligible = (recipe) => classifyRecipe(recipe).mealSlotEligible;

// ---------------------------------------------------------------------------
// Obvious desserts — must be excluded from main meal slots
// ---------------------------------------------------------------------------
test("obvious dessert names classify as dessert and are NOT meal-eligible", () => {
  const desserts = [
    "Key Lime Pie",
    "New York cheesecake",
    "Chocolate Fudge Brownie",
    "Sticky Toffee Pudding",
    "Krispy Kreme Donut",
    "Churros",
    "Jam jam cookies",
    "Vanilla Ice Cream",
    "Raspberry mousse",
    "Portuguese custard tarts",
    "Flan",
    "Lamingtons",
    "Alfajores",
  ];
  for (const name of desserts) {
    const r = classifyRecipe({ name });
    assert.equal(r.category, "dessert", `${name} should be dessert, got ${r.category}`);
    assert.equal(r.mealCategory, "dessert");
    assert.equal(r.mealSlotEligible, false, `${name} must not be eligible for a main meal slot`);
  }
});

test("real overshoot culprits from the live plan are caught (Flan, Postre Chajá, Jam jam cookies)", () => {
  // The three dessert recipes the nutritionist review traced to real
  // calorie/protein overshoot incidents in a generated plan.
  assert.equal(cat({ name: "Flan" }), "dessert");
  assert.equal(cat({ name: "Postre Chajá" }), "dessert");
  assert.equal(cat({ name: "Jam jam cookies" }), "dessert");
});

// ---------------------------------------------------------------------------
// Obvious dinners — must stay proper_meal / meal-eligible
// ---------------------------------------------------------------------------
test("obvious savory main dishes stay proper_meal and meal-eligible", () => {
  const meals = [
    "Grilled Chicken and Rice",
    "Beef Stroganoff",
    "Spaghetti Bolognese",
    "Chicken Tikka Masala",
    "Pan-Seared Salmon with Quinoa",
    "Pork Chops with Roasted Vegetables",
    "Lentil and Vegetable Curry",
    "Shakshuka with Chickpeas and Spinach",
  ];
  for (const name of meals) {
    const r = classifyRecipe({ name });
    // (Shakshuka is breakfast_only — still meal-eligible; the rest proper_meal)
    assert.equal(r.mealSlotEligible, true, `${name} should stay meal-eligible, got ${r.category}`);
    assert.notEqual(r.category, "dessert", `${name} must not be a dessert`);
  }
});

test("mealCategory is null for a proper meal", () => {
  assert.equal(meal({ name: "Beef and Broccoli Stir Fry" }), null);
});

// ---------------------------------------------------------------------------
// Ambiguous head nouns (pie / cake / pudding) — the sweet-vs-savory gate
// ---------------------------------------------------------------------------
test("savory pies are NOT desserts (savory qualifier wins)", () => {
  assert.equal(cat({ name: "Steak and Kidney Pie" }), "proper_meal");
  assert.equal(cat({ name: "Beef and Mustard Pie" }), "proper_meal");
  assert.equal(cat({ name: "Chicken Ham and Leek Pie" }), "proper_meal");
});

test("sweet pies/cakes ARE desserts (sweet qualifier wins)", () => {
  assert.equal(cat({ name: "Apple Pie" }), "dessert");
  assert.equal(cat({ name: "Pumpkin Pie" }), "dessert");
  assert.equal(cat({ name: "Chocolate Cake" }), "dessert");
  assert.equal(cat({ name: "Carrot Cake" }), "dessert");
});

test("truly ambiguous head noun is left proper_meal but flagged for review, never auto-excluded", () => {
  const r = classifyRecipe({ name: "Cumberland Pie" }); // British meat pie, no qualifier in name
  assert.equal(r.category, "proper_meal");
  assert.equal(r.needsReview, true);
  assert.equal(r.mealSlotEligible, true, "ambiguous items are conservatively kept, a human decides");
});

// ---------------------------------------------------------------------------
// Condiment / sauce macro gate
// ---------------------------------------------------------------------------
test("a standalone low-protein sauce is a condiment (macro gate confirms)", () => {
  const r = classifyRecipe({ name: "Creamy Green Sauce", ingredients: ["Herbs", "Oil", "Vinegar"], protein: 2, kcal: 180, carb: 4, fat: 17 });
  assert.equal(r.category, "condiment_or_sauce");
  assert.equal(r.mealSlotEligible, false);
});

test("a full dish named after its sauce is NOT excluded (high protein/kcal)", () => {
  // Falafel Pita with Tahini Sauce: 60g protein, 1582 kcal — a real meal.
  const r = classifyRecipe({ name: "Falafel Pita Sandwich with Tahini Sauce", ingredients: ["Chickpeas", "Pita", "Tahini"], protein: 60, kcal: 1582, carb: 180, fat: 55 });
  assert.equal(r.category, "proper_meal");
  assert.equal(r.mealSlotEligible, true);
  assert.equal(r.needsReview, true, "the odd name still gets a human-review flag");
});

test("sauce name with a protein anchor in the NAME is a proper meal", () => {
  assert.equal(cat({ name: "Chicken in Orange Sauce", protein: 40, kcal: 600, carb: 30, fat: 20 }), "proper_meal");
});

test("condiment gate without macros does not auto-exclude — flags for review instead", () => {
  const r = classifyRecipe({ name: "Mystery Dip" }); // no macros provided
  assert.equal(r.category, "proper_meal");
  assert.equal(r.needsReview, true);
});

// ---------------------------------------------------------------------------
// Ingredient / macro dessert pass (non-English dessert names)
// ---------------------------------------------------------------------------
test("non-English dessert caught by sugar+baking ingredient signature", () => {
  // "Arroz con Leche" (rice pudding) — name has no English dessert keyword.
  const r = classifyRecipe({
    name: "Arroz con Leche",
    ingredients: ["Rice", "Milk", "Sugar", "Condensed Milk", "Cinnamon", "Flour"],
    protein: 8, kcal: 400, carb: 70, fat: 8,
  });
  assert.equal(r.category, "dessert");
});

test("savory dish with a little sugar is NOT flagged dessert (strong-savory veto + plural protein)", () => {
  // Regression: 'Prawns' (plural) must count as a protein source, and a
  // savory stir-fry must never be called a dessert.
  const prawns = classifyRecipe({
    name: "Kung Po Prawns",
    ingredients: ["Prawns", "Sugar", "Cornstarch", "Soy Sauce", "Peanuts"],
    protein: 30, kcal: 500, carb: 40, fat: 20,
  });
  assert.equal(prawns.category, "proper_meal");
  assert.equal(prawns.mealSlotEligible, true);

  const beans = classifyRecipe({
    name: "Sichuan Stir-Fried Long Beans",
    ingredients: ["Long Beans", "Sugar", "Cornstarch", "Chilli"],
    protein: 9, kcal: 300, carb: 45, fat: 8,
  });
  assert.equal(beans.category, "proper_meal");
});

// ---------------------------------------------------------------------------
// The naive-substring bugs the roadmap explicitly warned about
// ---------------------------------------------------------------------------
test("word boundaries: 'cake' does not match inside 'pancake'", () => {
  // Banana Pancakes must be breakfast_only, never dessert-via-'cake'.
  assert.equal(cat({ name: "Banana Pancakes" }), "breakfast_only");
  assert.equal(cat({ name: "Beetroot pancakes" }), "breakfast_only");
});

test("word boundaries: 'ham' does not match inside 'graham' (the Flapper Pie bug)", () => {
  // A graham-cracker-crust dessert must not read as a savory ham dish.
  const r = classifyRecipe({
    name: "Flapper Pie",
    ingredients: ["Graham Cracker Crumbs", "Butter", "Sugar", "Milk", "Egg Yolks", "Vanilla"],
    protein: 8, kcal: 500, carb: 70, fat: 20,
    sourceTags: ["dessert"],
  });
  assert.equal(r.category, "dessert", "graham must not veto the dessert verdict as if it were ham");
});

test("word boundaries: 'lassi' (beverage) does not match inside 'Classic'", () => {
  assert.equal(cat({ name: "Classic Tourtière" }), "proper_meal");
});

// ---------------------------------------------------------------------------
// Source-tag corroboration
// ---------------------------------------------------------------------------
test("source 'dessert' tag upgrades an otherwise-unrecognized sweet", () => {
  // Name + ingredients give no dessert signal, but the source says dessert.
  const r = classifyRecipe({ name: "Kvæfjord Cake", sourceTags: ["any", "dessert"], protein: 10, kcal: 500, carb: 60, fat: 25 });
  assert.equal(r.category, "dessert");
  assert.equal(r.matchedOn, "sourceTag:dessert");
});

test("source 'dessert' tag is vetoed by a strong savory signal (no blind trust)", () => {
  const r = classifyRecipe({
    name: "Beef Wellington",
    ingredients: ["Beef", "Pastry", "Mushrooms"],
    sourceTags: ["dessert"], // contradictory / bad tag
    protein: 45, kcal: 800, carb: 40, fat: 50,
  });
  assert.equal(r.category, "proper_meal");
  assert.equal(r.needsReview, true);
});

test("source 'breakfast' tag → breakfast_only, still meal-eligible", () => {
  const r = classifyRecipe({ name: "Full English Breakfast", sourceTags: ["breakfast"], protein: 30, kcal: 700, carb: 40, fat: 45 });
  assert.equal(r.category, "breakfast_only");
  assert.equal(r.mealSlotEligible, true);
});

test("a specific dessert name beats a (missing) tag — tags never downgrade a name verdict", () => {
  const r = classifyRecipe({ name: "Chocolate Brownie", sourceTags: ["lunch", "dinner"] });
  assert.equal(r.category, "dessert");
});

// ---------------------------------------------------------------------------
// breakfast_only stays meal-eligible (roadmap §1.5 — no time-of-day concept)
// ---------------------------------------------------------------------------
test("breakfast dishes are tagged but remain meal-eligible", () => {
  for (const name of ["Oatmeal Porridge", "Buttermilk Pancakes", "Belgian Waffles"]) {
    const r = classifyRecipe({ name });
    assert.equal(r.category, "breakfast_only");
    assert.equal(r.mealSlotEligible, true, `${name} should stay meal-eligible`);
    assert.ok(!NON_MEAL_CATEGORIES.has(r.mealCategory), "breakfast_only is not in the exclusion set");
  }
});

// ---------------------------------------------------------------------------
// Flexible input shapes (DB rows, seed data, plain strings)
// ---------------------------------------------------------------------------
test("accepts the prisma DB shape: ingredients as {food:{name}, role}", () => {
  const r = classifyRecipe({
    name: "Grandma's Sticky Toffee Pudding",
    ingredients: [
      { food: { name: "Flour" }, role: "carb" },
      { food: { name: "Sugar" }, role: null },
      { food: { name: "Dates" }, role: null },
    ],
    kcal: 600, protein: 6, carb: 90, fat: 25,
  });
  assert.equal(r.category, "dessert");
});

test("accepts the seed shape ({name}) and plain-string ingredients", () => {
  assert.equal(cat({ name: "Pecan Pie", ingredients: [{ name: "Pecans" }, { name: "Sugar" }] }), "dessert");
  assert.equal(cat({ name: "Chocolate Fudge Cake", ingredients: ["Flour", "Sugar", "Cocoa"] }), "dessert");
});

test("role='protein' vetoes the ingredient dessert pass", () => {
  // Sugar+flour present, but a protein-role ingredient means it's a real dish.
  const r = classifyRecipe({
    name: "Sweet-and-Sour Meatballs",
    ingredients: [
      { name: "Ground Beef", role: "protein" },
      { name: "Sugar" },
      { name: "Flour" },
      { name: "Ketchup" },
    ],
    protein: 35, kcal: 600, carb: 50, fat: 25,
  });
  assert.equal(r.category, "proper_meal");
});

test("handles missing/blank name and missing ingredients without throwing", () => {
  assert.equal(cat({ name: "" }), "proper_meal");
  assert.equal(cat({}), "proper_meal");
  assert.doesNotThrow(() => classifyRecipe({ name: "Soup", ingredients: null, kcal: undefined }));
});

// ---------------------------------------------------------------------------
// Pure helpers + module contract
// ---------------------------------------------------------------------------
test("looksSweetByMacros: sweet profile true, savory profile false, missing macros false", () => {
  assert.equal(looksSweetByMacros({ kcal: 400, protein: 3, carb: 80, fat: 5 }), true);
  assert.equal(looksSweetByMacros({ kcal: 500, protein: 45, carb: 30, fat: 20 }), false);
  assert.equal(looksSweetByMacros({}), false);
  assert.equal(looksSweetByMacros({ kcal: 10, protein: 0, carb: 2, fat: 0 }), false); // too low kcal to judge
});

test("hasWord respects boundaries and handles multi-word phrases", () => {
  assert.equal(hasWord("Pancake stack", "cake"), false);
  assert.equal(hasWord("Carrot Cake", "cake"), true);
  assert.equal(hasWord("Graham crust", "ham"), false);
  assert.equal(hasWord("Hot Chocolate Deluxe", "hot chocolate"), true);
});

test("isMealSlotEligible contract matches NON_MEAL_CATEGORIES", () => {
  assert.equal(isMealSlotEligible(null), true);
  assert.equal(isMealSlotEligible("breakfast_only"), true);
  assert.equal(isMealSlotEligible("dessert"), false);
  assert.equal(isMealSlotEligible("condiment_or_sauce"), false);
  for (const c of NON_MEAL_CATEGORIES) assert.equal(isMealSlotEligible(c), false);
});

test("every mealCategory value returned is a valid schema value or null", () => {
  const valid = new Set([null, ...MEAL_CATEGORY_VALUES]);
  for (const name of ["Apple Pie", "Beef Stew", "Lemonade", "Garlic Bread", "Pancakes", "Green Sauce"]) {
    const mc = classifyRecipe({ name, protein: 2, kcal: 150, carb: 10, fat: 5 }).mealCategory;
    assert.ok(valid.has(mc), `${name} produced invalid mealCategory ${mc}`);
  }
});
