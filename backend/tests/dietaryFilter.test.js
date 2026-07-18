const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyDietaryFilters, traceExclusions, traceRecipeExclusions, matchesExclusionTerm, recipeExcludedByStyle } = require("../src/lib/dietaryFilter.js");

// Synthetic pool covering everything the vegan/vegetarian/keto/exclusion
// tests below need (meat/fish/egg/dairy/honey/whey vs. plant-based
// survivors, and a carb spread wide enough to exercise the keto threshold).
// Ported from dietaryFilter.test.js's use of recomp-v2's TIER1_FOODS fixture
// — that data file lives in scripts/portedFromRecomp/ (ESM, seed-script-only)
// rather than here, so this is a synthetic equivalent, same spirit as the
// original file's own SYNONYM_TEST_POOL a few tests down ("independent of
// TIER1_FOODS churn").
const SAMPLE_FOOD_POOL = [
  { name: "Chicken breast, cooked, skinless", category: "protein", carb: 0 },
  { name: "Salmon, cooked", category: "protein", carb: 0 },
  { name: "Tuna, canned in water", category: "protein", carb: 0 },
  { name: "Eggs, whole, cooked", category: "protein", carb: 1.1 },
  { name: "Cheese, cheddar", category: "dairy", carb: 2.4 },
  { name: "Greek yogurt, 0%", category: "dairy", carb: 3.6 },
  { name: "Milk, 2%", category: "dairy", carb: 4.8 },
  { name: "Almond milk, unsweetened", category: "dairy", carb: 0.7 },
  { name: "Whey protein powder", category: "protein", carb: 6.3 },
  { name: "Honey", category: "other", carb: 82.4 },
  { name: "White rice, cooked", category: "carb", carb: 28 },
  { name: "Tofu, firm, raw", category: "protein", carb: 2.8 },
  { name: "Broccoli, raw", category: "veg", carb: 6.3 },
];

// Synthetic pool for R1 synonym-map tests - independent of the sample food
// pool above, includes categories (shellfish) it doesn't cover.
const SYNONYM_TEST_POOL = [
  { name: "Couscous, cooked", category: "carb" },
  { name: "Pasta, cooked, enriched, with added salt", category: "carb" },
  { name: "Crackers, cheese, whole grain", category: "dairy" },
  { name: "White rice, cooked", category: "carb" },
  { name: "Shrimp, cooked", category: "protein" },
  { name: "Crab cakes", category: "protein" },
  { name: "Chicken breast, cooked, skinless", category: "protein" },
  { name: "Milk, 2%", category: "dairy" },
  { name: "Almond milk, unsweetened", category: "dairy" },
  { name: "Cheese, cheddar", category: "dairy" },
  { name: "Tofu, firm, raw", category: "protein" },
  { name: "Soy sauce made from soy (tamari)", category: "carb" },
  { name: "Protein powder, soy protein isolate", category: "protein" },
  { name: "Kiwi, raw", category: "fruit" },
  { name: "Blueberries, raw", category: "fruit" },
];

test("none style + no exclusions passes the pool through unchanged", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "none", excludedFoods: [] });
  assert.equal(result.length, SAMPLE_FOOD_POOL.length);
});

test("vegan drops meat, fish, egg, dairy, and honey", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "vegan", excludedFoods: [] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("chicken")));
  assert.ok(!names.some((n) => n.includes("salmon") || n.includes("tuna")));
  assert.ok(!names.some((n) => n.includes("egg")));
  assert.ok(!names.some((n) => n.includes("cheese") || n.includes("yogurt")));
  assert.ok(!names.includes("milk, 2%"), "dairy milk must be excluded from vegan");
  assert.ok(!names.some((n) => n.includes("honey")));
  assert.ok(!names.some((n) => n.includes("whey")), "whey protein powder is dairy-derived, must be excluded from vegan");
  assert.ok(names.some((n) => n.includes("almond milk")), "almond milk is plant-based and must NOT be excluded just because its category is dairy");
});

test("vegetarian keeps eggs and dairy but drops meat and fish", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "vegetarian", excludedFoods: [] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("chicken") || n.includes("beef") || n.includes("salmon")));
  assert.ok(names.some((n) => n.includes("egg")), "eggs are vegetarian-compatible");
  assert.ok(names.some((n) => n.includes("cheese")), "dairy is vegetarian-compatible");
});

test("keto drops high-carb items above the threshold", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "keto", excludedFoods: [] });
  assert.ok(result.every((f) => f.carb <= 15));
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("white rice")));
  assert.ok(!names.some((n) => n.includes("honey")));
  assert.ok(names.some((n) => n.includes("chicken breast")), "zero-carb protein stays available on keto");
});

test("excludedFoods removes any matching item regardless of dietary style", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "none", excludedFoods: ["chicken", "almond"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("chicken")));
  assert.ok(!names.some((n) => n.includes("almond")));
});

test("empty pool in, empty pool out - no crash", () => {
  assert.deepEqual(applyDietaryFilters([], { dietaryStyle: "vegan", excludedFoods: [] }), []);
});

test("vegan filtering leaves at least one protein-category anchor available (regression guard against a vegan pool with zero protein sources)", () => {
  const result = applyDietaryFilters(SAMPLE_FOOD_POOL, { dietaryStyle: "vegan", excludedFoods: [] });
  const proteinSources = result.filter((f) => f.category === "protein");
  assert.ok(proteinSources.length > 0, "vegan pool has no protein anchor (tofu) - solving would always fail honestly instead of solving");
});

// --- category synonym maps ---
// Regression guard for the confirmed bug this module was built to fix:
// naive literal substring match on food.name matches almost nothing for
// "gluten" or "shellfish", because no real food is literally named that -
// only category members are (wheat, shrimp, crab...). A silent
// allergen-safety miss, not a cosmetic gap.

test("gluten exclusion catches category members, not just the literal word 'gluten'", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["gluten"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("couscous")), "couscous is gluten-containing, must be excluded by category");
  assert.ok(!names.some((n) => n.includes("pasta")), "pasta is gluten-containing, must be excluded by category");
  assert.ok(!names.some((n) => n.includes("crackers")), "crackers (wheat-based) must be excluded by category");
  assert.ok(names.some((n) => n.includes("white rice")), "rice is gluten-free and must NOT be excluded");
});

test("shellfish exclusion catches category members (shrimp, crab), not just the literal word 'shellfish'", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["shellfish"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("shrimp")), "shrimp is shellfish, must be excluded by category");
  assert.ok(!names.some((n) => n.includes("crab")), "crab is shellfish, must be excluded by category");
  assert.ok(names.some((n) => n.includes("chicken")), "chicken is not shellfish and must NOT be excluded");
});

// Regression guard for PABLO_REVIEW.md §2.5: a real recipe in the live pool
// ("Spanish seafood rice") contains an ingredient literally named "Frozen
// Seafood mix" - a compound/generic product name that legitimately contains
// shellfish but has no literal species word in it, so it silently passed the
// old shellfish synonym match. Category-scoped (not a blanket
// ambiguous-ingredient rule) to avoid over-excluding unrelated recipes -
// verified against the real 629-recipe pool: the scoped fix newly excludes
// exactly the 2 recipes that actually contain a seafood-mix ingredient,
// vs. 38 recipes (36 of them false positives on curry powder/stock cubes)
// for an earlier non-category-scoped version that was rejected after
// measurement.
test("shellfish exclusion catches compound/generic product names (e.g. 'Frozen Seafood mix'), not just literal species words", () => {
  const pool = [
    { name: "Frozen Seafood mix", category: "protein" },
    { name: "Mixed Seafood Medley", category: "protein" },
    { name: "Surimi sticks", category: "protein" },
    { name: "Grilled seafood platter (fish only)", category: "protein" },
  ];
  const result = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["shellfish"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("frozen seafood mix")), "compound 'seafood mix' product must be excluded under a shellfish allergy");
  assert.ok(!names.some((n) => n.includes("seafood medley")), "compound 'seafood medley' product must be excluded under a shellfish allergy");
  assert.ok(!names.some((n) => n.includes("surimi")), "surimi is a shellfish-adjacent processed product and must be excluded");
});

test("gluten and soy exclusions catch hidden-filler compound products (stock cubes, bouillon, gravy mix)", () => {
  const pool = [
    { name: "Chicken Stock Cube", category: "other" },
    { name: "Beef Bouillon", category: "other" },
    { name: "Instant Gravy Mix", category: "other" },
    { name: "Salt", category: "other" },
  ];
  const glutenResult = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["gluten"] });
  assert.ok(!glutenResult.some((f) => f.name.toLowerCase().includes("stock cube")), "stock cubes commonly contain wheat filler, must be excluded under gluten");
  assert.ok(glutenResult.some((f) => f.name === "Salt"), "unrelated item must survive");

  const soyResult = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["soy"] });
  assert.ok(!soyResult.some((f) => f.name.toLowerCase().includes("bouillon")), "bouillon commonly contains hydrolyzed soy protein, must be excluded under soy");
});

test("compound-ingredient category expansion is scoped, not universal - curry powder is NOT flagged for a shellfish exclusion", () => {
  // Regression guard against the broader (rejected) design this fix
  // considered: treating every generic/compound product name as ambiguous
  // for EVERY active exclusion, regardless of real-world plausibility.
  // Measured against the real pool before shipping and found to newly
  // exclude 38 recipes for shellfish/kiwi/soy-protein, 36 of them via
  // curry powder or five-spice - neither remotely relevant to any of those
  // three allergens. The shipped fix only expands the specific categories
  // (shellfish/gluten/soy/nuts) where a term has a genuine real-world
  // hidden-allergen link.
  const pool = [{ name: "Curry Powder", category: "other" }, { name: "Five Spice Powder", category: "other" }];
  const result = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["shellfish"] });
  assert.equal(result.length, 2, "curry powder and five-spice have no established shellfish link and must not be excluded");
});

test("dairy exclusion catches milk/cheese but still spares plant-based 'milk' items", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["dairy"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n === "milk, 2%"), "dairy milk must be excluded from a dairy allergy list");
  assert.ok(!names.some((n) => n.includes("cheddar")), "cheese is dairy, must be excluded by category");
  assert.ok(names.some((n) => n.includes("almond milk")), "almond milk is plant-based and must NOT be excluded just because 'dairy' was excluded");
});

test("soy exclusion (category term) catches tofu, soy sauce, and soy protein alike", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["soy"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("tofu")), "tofu is soy, must be excluded by category");
  assert.ok(!names.some((n) => n.includes("soy sauce")), "soy sauce is soy, must be excluded by category");
  assert.ok(!names.some((n) => n.includes("soy protein")), "soy protein isolate is soy, must be excluded by category");
});

test("'soy protein' as a custom (non-category-key) term only removes that specific item, not all soy", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["soy protein"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("soy protein")), "the exact 'soy protein' phrase must be excluded");
  assert.ok(names.some((n) => n.includes("tofu")), "tofu does not literally contain 'soy protein' and must survive a phrase-only exclusion");
  assert.ok(names.some((n) => n.includes("soy sauce")), "soy sauce does not literally contain 'soy protein' and must survive a phrase-only exclusion");
});

test("custom term not in any synonym map (kiwi) still falls back to literal substring match", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, { dietaryStyle: "none", excludedFoods: ["kiwi"] });
  const names = result.map((f) => f.name.toLowerCase());
  assert.ok(!names.some((n) => n.includes("kiwi")), "kiwi must be excluded via literal fallback matching");
  assert.ok(names.some((n) => n.includes("blueberries")), "unrelated fruit must not be excluded");
});

test("combined exclusions (gluten + shellfish + kiwi + soy protein) leave zero violating items", () => {
  const result = applyDietaryFilters(SYNONYM_TEST_POOL, {
    dietaryStyle: "none",
    excludedFoods: ["gluten", "shellfish", "kiwi", "soy protein"],
  });
  const names = result.map((f) => f.name.toLowerCase());
  const violatesGluten = names.some((n) => n.includes("couscous") || n.includes("pasta") || n.includes("crackers"));
  const violatesShellfish = names.some((n) => n.includes("shrimp") || n.includes("crab"));
  const violatesKiwi = names.some((n) => n.includes("kiwi"));
  const violatesSoyProtein = names.some((n) => n.includes("soy protein"));
  assert.equal(violatesGluten, false, "gluten violation leaked through");
  assert.equal(violatesShellfish, false, "shellfish violation leaked through");
  assert.equal(violatesKiwi, false, "kiwi violation leaked through");
  assert.equal(violatesSoyProtein, false, "soy protein violation leaked through");
  assert.ok(names.some((n) => n.includes("tofu")), "tofu must survive - only 'soy protein' phrase was excluded, not the whole soy category");
});

test("traceExclusions reports a per-term count so the UI can show 'N excluded for: gluten' - never a silent filter", () => {
  const counts = traceExclusions(SYNONYM_TEST_POOL, ["gluten", "shellfish", "kiwi"]);
  assert.equal(counts.gluten, 3, "couscous + pasta + crackers");
  assert.equal(counts.shellfish, 2, "shrimp + crab");
  assert.equal(counts.kiwi, 1, "kiwi, raw");
});

test("traceExclusions returns an empty object for no exclusions, never undefined/crash", () => {
  assert.deepEqual(traceExclusions(SYNONYM_TEST_POOL, []), {});
  assert.deepEqual(traceExclusions(SYNONYM_TEST_POOL, undefined), {});
});

// --- traceRecipeExclusions ---
// A recipe's top-level .name is its dish title, not an ingredient -
// traceExclusions() alone would check the term against the dish title and
// silently undercount. traceRecipeExclusions() must check ingredients
// instead, same as the recipe pool filtering in plans.js's filterRecipePool().
const SYNONYM_TEST_RECIPES = [
  { name: "Weeknight Pasta Bake", ingredients: [{ name: "Pasta, cooked" }, { name: "Ground Beef" }] },
  { name: "Shrimp Tacos", ingredients: [{ name: "Shrimp, cooked" }, { name: "Iceberg lettuce cups" }] },
  { name: "Grilled Chicken Bowl", ingredients: [{ name: "Chicken breast" }, { name: "White rice, cooked" }] },
  { name: "Crab Cake Sandwich", ingredients: [{ name: "Crab cakes" }, { name: "Bread" }] },
];

test("traceRecipeExclusions counts recipes (not ingredients) matched via ingredient-level lookup, unlike a naive dish-name check", () => {
  const counts = traceRecipeExclusions(SYNONYM_TEST_RECIPES, ["gluten", "shellfish"]);
  assert.equal(counts.gluten, 2, "pasta bake + crab cake sandwich (bread) both contain gluten ingredients");
  assert.equal(counts.shellfish, 2, "shrimp tacos + crab cake sandwich both contain shellfish ingredients");
});

test("traceRecipeExclusions returns an empty object for no exclusions, never undefined/crash", () => {
  assert.deepEqual(traceRecipeExclusions(SYNONYM_TEST_RECIPES, []), {});
  assert.deepEqual(traceRecipeExclusions(SYNONYM_TEST_RECIPES, undefined), {});
  assert.deepEqual(traceRecipeExclusions([], ["gluten"]), { gluten: 0 });
});

test("category synonym matching tolerates plural ingredient names (singular keyword, plural real name)", () => {
  assert.equal(matchesExclusionTerm("Almonds", "nuts"), true);
  assert.equal(matchesExclusionTerm("Crab cakes", "shellfish"), true);
  assert.equal(matchesExclusionTerm("Bananas, dehydrated", "nuts"), false, "unrelated plural must not false-positive");
});

// --- paleo / carnivore (added 2026-07-14) ---

test("paleo excludes grains, legumes, and dairy but allows meat, eggs, and butter/ghee", () => {
  const excluded = (name) => recipeExcludedByStyle({ ingredients: [{ name }] }, "paleo");
  assert.equal(excluded("White rice, cooked"), true, "grain");
  assert.equal(excluded("Black beans, canned"), true, "legume");
  assert.equal(excluded("Cheddar cheese"), true, "dairy");
  assert.equal(excluded("Chicken breast, cooked"), false, "meat is paleo-compatible");
  assert.equal(excluded("Eggs, whole, cooked"), false, "eggs are paleo-compatible");
  assert.equal(excluded("Butter"), false, "butter/ghee is a disclosed paleo-friendly exception");
  assert.equal(excluded("Almond milk, unsweetened"), false, "plant milk isn't dairy");
});

test("carnivore excludes anything that isn't an animal product, including plant-based staples that survive every other style", () => {
  const excluded = (name) => recipeExcludedByStyle({ ingredients: [{ name }] }, "carnivore");
  assert.equal(excluded("Broccoli, raw"), true);
  assert.equal(excluded("White rice, cooked"), true);
  assert.equal(excluded("Black beans, canned"), true);
  assert.equal(excluded("Sirloin steak, cooked"), false);
  assert.equal(excluded("Eggs, whole, cooked"), false);
  assert.equal(excluded("Cheddar cheese"), false, "dairy allowed under mainstream carnivore practice");
});

// Regression guard for the exact bug found+fixed 2026-07-14: recipeExcludedByStyle()/
// adjusterExcludedByStyle() used to hard-return false for any style other than
// vegan/vegetarian, silently no-opping keto/paleo/carnivore at the recipe-pool
// level (routes/plans.js's actual enforcement path) even once excludedByStyle()
// itself knew how to handle them.
test("recipeExcludedByStyle actually delegates for paleo/carnivore, not just vegan/vegetarian (regression guard)", () => {
  assert.equal(recipeExcludedByStyle({ ingredients: [{ name: "White rice, cooked" }] }, "paleo"), true);
  assert.equal(recipeExcludedByStyle({ ingredients: [{ name: "Broccoli, raw" }] }, "carnivore"), true);
  assert.equal(recipeExcludedByStyle({ ingredients: [{ name: "Chicken breast" }] }, "none"), false);
  assert.equal(recipeExcludedByStyle({ ingredients: [{ name: "Chicken breast" }] }, null), false);
});
