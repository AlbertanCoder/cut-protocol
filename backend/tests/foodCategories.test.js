const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CATEGORIES, CATEGORY_SLUGS, CATEGORY_LABEL, classifyFood } = require("../src/lib/foodCategories.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");

test("seven grocery-store categories, each with a label", () => {
  assert.equal(CATEGORIES.length, 7);
  for (const slug of CATEGORY_SLUGS) assert.ok(CATEGORY_LABEL[slug], `label missing for ${slug}`);
});

const expect = (name, category) =>
  assert.equal(classifyFood(name).category, category, `"${name}" should be ${category}, got ${classifyFood(name).category}`);

test("the pack's example: walnuts are fats, not carbs", () => {
  expect("Walnuts", "fats-nuts-oils");
});

test("proteins", () => {
  expect("Chicken breast, cooked, skinless", "protein");
  expect("Salmon, cooked", "protein");
  expect("Tofu, firm, raw", "protein");
  expect("Black Pudding", "protein");
});

test("dairy & eggs", () => {
  expect("Cheese, cheddar", "dairy-eggs");
  expect("Greek yogurt, 0%", "dairy-eggs");
  expect("Eggs, whole, cooked", "dairy-eggs");
  expect("Almond milk, unsweetened, plain, refrigerated", "dairy-eggs");
});

test("fruit & veg, including the y→ies plural fix", () => {
  expect("Blueberries, raw", "fruit-veg");
  expect("Strawberries", "fruit-veg");
  expect("Broccoli, raw", "fruit-veg");
  expect("Potato, baked with skin", "fruit-veg");
  expect("Avocado", "fruit-veg");
  expect("Bok Choy", "fruit-veg");
});

test("grains & carbs", () => {
  expect("White rice, cooked", "grains");
  expect("Porridge oats", "grains");
  expect("Pasta, cooked, enriched, with added salt", "grains");
  expect("Corn Tortillas", "grains");
});

test("fats, nuts & oils", () => {
  expect("Olive Oil", "fats-nuts-oils");
  expect("Almonds", "fats-nuts-oils");
  expect("Butter", "fats-nuts-oils");
  expect("Seeds, pumpkin seeds (pepitas), raw", "fats-nuts-oils");
});

test("pantry: spices, sauces, canned and dried produce forms", () => {
  expect("Spices, cinnamon, ground", "pantry");
  expect("Soy Sauce", "pantry");
  expect("Canned tomatoes", "pantry");
  expect("Tomato powder", "pantry");
  expect("Honey", "pantry");
  expect("Yeast", "pantry");
  expect("Bay Leaves", "pantry");
});

test("drinks — but stock, broth, and cooking-juice stay out", () => {
  expect("Water", "drinks");
  expect("Coffee", "drinks");
  expect("White Wine", "drinks");
  assert.notEqual(classifyFood("Beef Stock").category, "drinks");
  assert.notEqual(classifyFood("Lemon juice, raw").category, "drinks");
});

test("blockers: plant milks are not fats, buttermilk is dairy, rice vinegar is not a grain", () => {
  expect("Almond milk, unsweetened", "dairy-eggs");
  expect("Buttermilk", "dairy-eggs");
  assert.notEqual(classifyFood("Rice Vinegar").category, "grains");
});

test("every classification lands in a valid slug, never outside the scheme", () => {
  const names = ["Water", "Xylophone food", "Beef", "Random Unmatched Thing", "Cumin"];
  for (const n of names) assert.ok(CATEGORY_SLUGS.includes(classifyFood(n).category));
});

test("override categories in the curated file are valid slugs", () => {
  for (const [key, entry] of Object.entries(loadFoodOverrides())) {
    if (entry.category) assert.ok(CATEGORY_SLUGS.includes(entry.category), `override "${key}" has invalid category "${entry.category}"`);
  }
});
