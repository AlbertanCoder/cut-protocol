const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DIETARY_STYLES, recipeExcludedByStyle, matchesExclusionTerm } = require("../src/lib/dietaryFilter.js");

const recipe = (...names) => ({ ingredients: names.map((name) => ({ name })) });

test("the Phase 3 style menu is complete", () => {
  assert.deepEqual(
    [...DIETARY_STYLES].sort(),
    ["carnivore", "halal", "keto", "kosher", "mediterranean", "none", "paleo", "vegan", "vegetarian"].sort()
  );
});

test("mediterranean: processed meat out, fish/olive oil/whole foods in", () => {
  assert.equal(recipeExcludedByStyle(recipe("Bacon", "Eggs"), "mediterranean"), true);
  assert.equal(recipeExcludedByStyle(recipe("Pepperoni", "Pizza Dough"), "mediterranean"), true);
  assert.equal(recipeExcludedByStyle(recipe("Salmon", "Olive Oil", "Tomatoes", "Feta"), "mediterranean"), false);
});

test("halal: pork in all cured forms + alcohol + gelatin out", () => {
  assert.equal(recipeExcludedByStyle(recipe("Pork Tenderloin"), "halal"), true);
  assert.equal(recipeExcludedByStyle(recipe("Prosciutto", "Melon"), "halal"), true);
  assert.equal(recipeExcludedByStyle(recipe("Chicken Breast", "White Wine"), "halal"), true);
  assert.equal(recipeExcludedByStyle(recipe("Gelatin", "Sugar"), "halal"), true);
  assert.equal(recipeExcludedByStyle(recipe("Chicken Breast", "Rice", "Yogurt"), "halal"), false);
});

test("kosher: pork + shellfish out; meat+dairy combination out; fish+dairy fine", () => {
  assert.equal(recipeExcludedByStyle(recipe("Bacon"), "kosher"), true);
  assert.equal(recipeExcludedByStyle(recipe("Shrimp", "Garlic"), "kosher"), true);
  assert.equal(recipeExcludedByStyle(recipe("Beef Mince", "Cheddar Cheese", "Tortilla"), "kosher"), true, "meat + dairy");
  assert.equal(recipeExcludedByStyle(recipe("Chicken Breast", "Butter"), "kosher"), true, "meat + butter");
  assert.equal(recipeExcludedByStyle(recipe("Salmon", "Cream", "Dill"), "kosher"), false, "fish + dairy is permitted");
  assert.equal(recipeExcludedByStyle(recipe("Beef Mince", "Butter Beans", "Tomatoes"), "kosher"), false, "butter beans are beans, not dairy");
  assert.equal(recipeExcludedByStyle(recipe("Chicken Breast", "Rice"), "kosher"), false);
});

test("allergy checkboxes: peanuts and tree nuts are separate allergies", () => {
  assert.equal(matchesExclusionTerm("Peanut Butter", "peanuts"), true);
  assert.equal(matchesExclusionTerm("Almonds", "peanuts"), false, "almond is not a peanut");
  assert.equal(matchesExclusionTerm("Almonds", "tree nuts"), true);
  assert.equal(matchesExclusionTerm("Peanuts", "tree nuts"), false, "peanut is a legume, not a tree nut");
  assert.equal(matchesExclusionTerm("Walnut Halves", "tree nuts"), true);
});

test("allergy checkboxes: fish, sesame, kiwi, eggs", () => {
  assert.equal(matchesExclusionTerm("Smoked Haddock", "fish"), true);
  assert.equal(matchesExclusionTerm("Worcestershire Sauce", "fish"), true, "hidden anchovy carrier");
  assert.equal(matchesExclusionTerm("Chicken Breast", "fish"), false);
  assert.equal(matchesExclusionTerm("Tahini", "sesame"), true);
  assert.equal(matchesExclusionTerm("Kiwifruit", "kiwi"), true);
  assert.equal(matchesExclusionTerm("Mayonnaise", "eggs"), true);
});
