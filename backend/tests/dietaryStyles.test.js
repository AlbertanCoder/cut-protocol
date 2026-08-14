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

// ── live-cloud regression, 2026-08-13 ──────────────────────────────────────
// The two tests above assert gelatin with the US singular spelling ONLY, which
// is exactly the string halal/kosher could already match. Measured against the
// live cloud library (14,151 foods / 910 recipes) with the repo's own
// exclusionGate: the corpus spells it "Gelatine Leafs" and "Gelatins, dry
// powder, unsweetened", and BOTH reached a halal pool and a kosher pool — taking
// "Peanut Butter Cheesecake" (250 g of gelatine) and "Raspberry mousse" (100 g)
// with them. vegan/vegetarian caught the same rows all along, because
// MEAT_FISH_KEYWORDS carries "gelatine" and the halal/kosher branch did not.
// Every name below is a VERBATIM live row name, not a name written from memory
// — writing them from memory is how the original gap survived its own test.
test("halal/kosher: gelatin's British spelling and plural are the live corpus spellings", () => {
  for (const style of ["halal", "kosher"]) {
    assert.equal(recipeExcludedByStyle(recipe("Gelatine Leafs", "Caster Sugar"), style), true, `${style}: "Gelatine Leafs"`);
    assert.equal(recipeExcludedByStyle(recipe("Gelatins, dry powder, unsweetened"), style), true, `${style}: FDC plural`);
    assert.equal(recipeExcludedByStyle(recipe("Gelatine"), style), true, `${style}: bare British spelling`);
    // unchanged behaviour, kept so the widening cannot silently drop it
    assert.equal(recipeExcludedByStyle(recipe("Unflavoured Gelatin", "Sugar"), style), true, `${style}: US spelling still out`);
    // "Gelato" is ice cream, not gelatin — the word-boundary form must not reach
    // it, or halal loses a dessert for no reason (live rows: "Gelato, vanilla").
    assert.equal(recipeExcludedByStyle(recipe("Gelato, vanilla"), "halal"), false, "gelato is not gelatin");
  }
});

test("allergy checkboxes: peanuts and tree nuts are separate allergies", () => {
  assert.equal(matchesExclusionTerm("Peanut Butter", "peanuts"), true);
  assert.equal(matchesExclusionTerm("Almonds", "peanuts"), false, "almond is not a peanut");
  assert.equal(matchesExclusionTerm("Almonds", "tree nuts"), true);
  assert.equal(matchesExclusionTerm("Peanuts", "tree nuts"), false, "peanut is a legume, not a tree nut");
  assert.equal(matchesExclusionTerm("Walnut Halves", "tree nuts"), true);
});

test("REGRESSION: plural and regional species names never pass vegan/vegetarian", () => {
  // Live Phase 4 verification caught "Raw King Prawns", "Sardines", and
  // "Pilchards" reaching a vegan account: style keywords matched exact
  // singular words only. Plural-aware matching + the widened species list
  // must hold this forever.
  for (const name of ["Raw King Prawns", "Sardines", "Pilchards", "Squid Rings", "Goat Shoulder", "Pepperoni Slices", "Anchovies", "Natural Yoghurt", "Mussels", "Sea Bass Fillets"]) {
    assert.equal(recipeExcludedByStyle(recipe(name), "vegan"), true, `vegan must exclude "${name}"`);
  }
  for (const name of ["Raw King Prawns", "Sardines", "Pilchards", "Goat Shoulder"]) {
    assert.equal(recipeExcludedByStyle(recipe(name), "vegetarian"), true, `vegetarian must exclude "${name}"`);
  }
  // ...and plant foods with tricky names stay in.
  for (const name of ["Tofu, firm", "Butter Beans", "Coconut Milk", "Almond milk, unsweetened", "Jackfruit"]) {
    assert.equal(recipeExcludedByStyle(recipe(name), "vegan"), false, `vegan must NOT exclude "${name}"`);
  }
});

test("allergy checkboxes: fish, sesame, kiwi, eggs", () => {
  assert.equal(matchesExclusionTerm("Smoked Haddock", "fish"), true);
  assert.equal(matchesExclusionTerm("Worcestershire Sauce", "fish"), true, "hidden anchovy carrier");
  assert.equal(matchesExclusionTerm("Chicken Breast", "fish"), false);
  assert.equal(matchesExclusionTerm("Tahini", "sesame"), true);
  assert.equal(matchesExclusionTerm("Kiwifruit", "kiwi"), true);
  assert.equal(matchesExclusionTerm("Mayonnaise", "eggs"), true);
});
