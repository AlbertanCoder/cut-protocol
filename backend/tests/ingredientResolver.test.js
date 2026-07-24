const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveIngredient, matchExistingFood, usdaCandidateAcceptable,
  normalizeTokens, stripDescriptors, allergenRootsOf, sameAllergenRoots,
  ALIASES, ALIAS_ROOT_EXCEPTIONS, DESCRIPTOR_TOKENS, DESCRIPTOR_PHRASES,
  ALLERGEN_ROOTS,
} = require("../src/lib/ingredientResolver.js");

// ---------------------------------------------------------------------------
// Fleet finding food-data-1 (P0). The old resolver scored name similarity with
// a 0.6 threshold, which made similarity("almond butter", "Butter") === 1.0 and
// silently rewrote a nut butter into the DAIRY row. These tests exist to make
// that class of substitution un-shippable. Everything here is pure/in-memory —
// no Prisma, no network, no dev.db.
// ---------------------------------------------------------------------------

let nextId = 1;
const f = (name, over = {}) => ({
  id: nextId++, name, category: "pantry",
  kcal: 100, protein: 5, fat: 2, carb: 15, fiber: 0, source: "usda", ...over,
});

// A pool deliberately stocked with the collision pairs that break people.
const POOL = [
  f("Butter"),
  f("Milk"),
  f("Cream"),
  f("Cheese"),
  f("Egg"),
  f("Wheat flour"),
  f("Rice wine"),
  f("Chicken breast, raw"),
  f("Chicken breast, cooked, skinless"),
  f("Almonds"),
  f("Peanuts"),
  f("Shrimp"),
  f("Eggplant"),
  f("Lettuce"),
  f("Rolled oats"),
  f("Soy sauce"),
  f("Chickpeas"),
  f("Cashews"),
  f("Walnuts"),
  f("Salmon"),
  f("Heavy cream"),
  f("Olive oil"),
  f("Bell pepper, raw"),
  f("Green onions"),
  f("Zucchini"),
];

const match = (q, pool = POOL) => matchExistingFood(q, pool);
const resolvedName = (q, pool = POOL) => {
  const r = match(q, pool);
  return r.status === "resolved" ? r.food.name : null;
};

// ---------------------------------------------------------------------------
// The dead code stays dead
// ---------------------------------------------------------------------------

test("the fuzzy matcher and its threshold are gone, not hidden behind a flag", () => {
  const mod = require("../src/lib/ingredientResolver.js");
  assert.equal(mod.similarity, undefined);
  assert.equal(mod.MATCH_THRESHOLD, undefined);
  const src = require("node:fs").readFileSync(require.resolve("../src/lib/ingredientResolver.js"), "utf8");
  assert.equal(/function\s+similarity\s*\(/.test(src), false, "similarity() must not exist");
  assert.equal(/MATCH_THRESHOLD\s*=/.test(src), false, "MATCH_THRESHOLD must not exist");
});

// ---------------------------------------------------------------------------
// THE ADVERSARIAL SET — every one of these was resolvable under the old code
// ---------------------------------------------------------------------------

test("nut/seed butters never resolve to the dairy row (the original bug)", () => {
  for (const q of ["almond butter", "peanut butter", "cashew butter", "sunflower seed butter", "Almond Butter"]) {
    const r = match(q);
    assert.equal(r.status, "needs_review", `${q} must not resolve`);
    assert.equal(r.food, null);
    assert.notEqual(resolvedName(q), "Butter");
  }
});

test("plant milks never resolve to dairy milk", () => {
  for (const q of ["coconut milk", "oat milk", "soy milk", "almond milk", "cashew milk", "rice milk"]) {
    const r = match(q);
    assert.equal(r.status, "needs_review", `${q} must not resolve`);
    assert.notEqual(resolvedName(q), "Milk");
  }
});

test("cream of tartar is not Cream", () => {
  const r = match("cream of tartar");
  assert.equal(r.status, "needs_review");
  assert.notEqual(resolvedName("cream of tartar"), "Cream");
  assert.notEqual(resolvedName("cream of tartar"), "Heavy cream");
});

test("egg plant / eggplant never resolve to Egg", () => {
  assert.notEqual(resolvedName("egg plant"), "Egg");
  assert.equal(match("egg plant").status, "needs_review");
  // "eggplant" is a real row, so it resolves — to ITSELF, never to Egg.
  assert.equal(resolvedName("eggplant"), "Eggplant");
  assert.notEqual(resolvedName("eggplant"), "Egg");
});

test("butter lettuce is not Butter (and not Lettuce)", () => {
  const r = match("butter lettuce");
  assert.equal(r.status, "needs_review");
  assert.notEqual(resolvedName("butter lettuce"), "Butter");
  assert.notEqual(resolvedName("butter lettuce"), "Lettuce");
});

test("chickpea flour is not Wheat flour", () => {
  const r = match("chickpea flour");
  assert.equal(r.status, "needs_review");
  assert.notEqual(resolvedName("chickpea flour"), "Wheat flour");
});

test("rice vinegar is not Rice wine", () => {
  const r = match("rice vinegar");
  assert.equal(r.status, "needs_review");
  assert.notEqual(resolvedName("rice vinegar"), "Rice wine");
});

test("containment is direction-safe both ways", () => {
  // long query -> short candidate
  assert.equal(match("almond butter").status, "needs_review");
  // short query -> long candidate (a user asking for butter must not get almond butter)
  const pool = [f("Almond butter"), f("Peanut butter"), f("Almond milk")];
  assert.equal(match("butter", pool).status, "needs_review");
  assert.equal(match("milk", pool).status, "needs_review");
  assert.equal(match("almond", pool).status, "needs_review");
});

// ---------------------------------------------------------------------------
// The ladder still has to WORK
// ---------------------------------------------------------------------------

test("tier 1 — a genuine exact match resolves", () => {
  const r = match("Butter");
  assert.equal(r.status, "resolved");
  assert.equal(r.confidence, "exact");
  assert.equal(r.food.name, "Butter");
});

test("tier 1 — exact match is case- and punctuation-insensitive", () => {
  assert.equal(resolvedName("  ROLLED   oats "), "Rolled oats");
  assert.equal(resolvedName("bell pepper (raw)"), "Bell pepper, raw");
});

test("tier 2 — curated alias resolves", () => {
  const r = match("aubergine");
  assert.equal(r.status, "resolved");
  assert.equal(r.confidence, "alias");
  assert.equal(r.food.name, "Eggplant");

  assert.equal(resolvedName("courgette"), "Zucchini");
  assert.equal(resolvedName("prawns"), "Shrimp");
  assert.equal(resolvedName("scallions"), "Green onions");
});

test("tier 3 — descriptor containment resolves and reports what it added", () => {
  const r = match("chicken breast");
  assert.equal(r.status, "resolved");
  assert.equal(r.confidence, "containment");
  assert.equal(r.food.name, "Chicken breast, raw");
  assert.deepEqual(r.extras, ["raw"]);
});

test("tier 3 — prefers the candidate that adds the fewest descriptors", () => {
  // "Chicken breast, raw" (1 extra) must beat "Chicken breast, cooked, skinless" (2)
  assert.equal(resolvedName("chicken breast"), "Chicken breast, raw");
});

test("tier 3 — a non-descriptor extra token blocks the match", () => {
  const pool = [f("Butter beans"), f("Butter, whipped"), f("Peanut butter cups")];
  assert.equal(match("butter", pool).status, "needs_review", "'beans' and 'cups' are food words, not descriptors");
});

test("descriptors may not include dehydration/concentration/fat-adding words", () => {
  // Phase 2 shipped a bug where "Milk" carried MILK POWDER data. Never again.
  for (const banned of ["dried", "dehydrated", "powdered", "powder", "dry", "concentrate",
    "concentrated", "condensed", "evaporated", "instant", "fried", "breaded", "battered",
    "buttered", "creamed", "oil", "butter", "salt", "sugar", "nuts", "meat", "milk", "cheese"]) {
    assert.equal(DESCRIPTOR_TOKENS.has(banned), false, `"${banned}" must never be a descriptor`);
  }
  const pool = [f("Milk, dried"), f("Milk, powdered"), f("Coconut milk, sweetened condensed")];
  assert.equal(match("milk", pool).status, "needs_review");
});

// ---------------------------------------------------------------------------
// Unresolved behaviour — the honest path
// ---------------------------------------------------------------------------

test("an unresolvable query returns needs_review with the original text intact, and does not throw", () => {
  const r = match("Grandma's leftover mystery stew");
  assert.equal(r.status, "needs_review");
  assert.equal(r.food, null);
  assert.equal(r.query, "Grandma's leftover mystery stew", "original text must survive verbatim");
  assert.equal(r.confidence, null);
  assert.ok(typeof r.reason === "string" && r.reason.length > 0);
  assert.ok(Array.isArray(r.candidates));
});

test("degenerate inputs do not throw", () => {
  for (const q of ["", "   ", "!!!", null, undefined, "123"]) {
    const r = match(q);
    assert.equal(r.status, "needs_review");
    assert.equal(r.food, null);
  }
});

test("needs_review carries display-only suggestions, and suggestions never resolve", () => {
  const r = match("almond butter");
  assert.equal(r.status, "needs_review");
  assert.ok(r.candidates.length > 0, "a human needs something to pick from");
  assert.ok(r.candidates.every((c) => typeof c.name === "string"));
  // The shortlist may legitimately contain "Butter" — but only as a SUGGESTION.
  // The resolved food is still null. That is the entire distinction.
  assert.equal(r.food, null);
});

// ---------------------------------------------------------------------------
// PROPERTY GUARD — no cross-allergen resolution, in either direction
// ---------------------------------------------------------------------------

const ROOT_PROBES = ["milk", "butter", "cream", "cheese", "egg", "wheat", "soy",
  "peanut", "almond", "cashew", "walnut", "shrimp", "fish"];

test("property: a query without an allergen root never resolves to a food with it", () => {
  const pool = ROOT_PROBES.map((r) => f(r[0].toUpperCase() + r.slice(1)));
  const queries = [
    "coconut milk", "oat milk", "soy milk", "almond milk", "rice milk", "hemp milk",
    "almond butter", "peanut butter", "cashew butter", "butter lettuce", "butter beans",
    "cream of tartar", "coconut cream", "ice cream cone",
    "cashew cheese", "nutritional yeast cheese sauce",
    "egg plant", "eggplant", "flax egg",
    "wheat grass juice", "buckwheat groats",
    "soy free mayo", "peanut free spread",
    "almond extract free vanilla", "walnut free pesto",
    "shrimp free stock", "fish free sauce",
    "chickpea flour", "rice vinegar", "coconut aminos",
  ];
  for (const q of queries) {
    const r = matchExistingFood(q, pool);
    if (r.status !== "resolved") continue;
    const qRoots = allergenRootsOf(ALIASES.get(q.toLowerCase()) || q);
    const cRoots = allergenRootsOf(r.food.name);
    for (const root of cRoots) {
      assert.ok(qRoots.has(root),
        `"${q}" resolved to "${r.food.name}" which introduces the allergen root "${root}"`);
    }
    for (const root of qRoots) {
      assert.ok(cRoots.has(root),
        `"${q}" resolved to "${r.food.name}" which DROPS the allergen root "${root}"`);
    }
  }
});

test("property: a bare allergen query never resolves to a compound food carrying an extra root", () => {
  const pool = [
    f("Almond butter"), f("Peanut butter"), f("Cashew cream"), f("Walnut milk"),
    f("Cream cheese"), f("Egg noodles"), f("Wheat germ"), f("Soy milk"),
    f("Shrimp paste"), f("Fish sauce"), f("Buttermilk"), f("Cheesecake"),
  ];
  for (const root of ROOT_PROBES) {
    const r = matchExistingFood(root, pool);
    if (r.status !== "resolved") continue;
    assert.ok(sameAllergenRoots(root, r.food.name),
      `bare query "${root}" resolved to "${r.food.name}" across allergen roots`);
  }
});

test("property: exhaustive cross-product — no query resolves to a food whose root set differs", () => {
  const pool = [];
  for (const r of ALLERGEN_ROOTS) pool.push(f(r[0].toUpperCase() + r.slice(1)));
  const prefixes = ["coconut", "oat", "rice", "hemp", "chickpea", "cashew", "almond",
    "butter", "cream", "egg", "soy", "sunflower", "pea", "flax"];
  const suffixes = ["milk", "butter", "cream", "cheese", "flour", "oil", "sauce",
    "paste", "lettuce", "plant", "wine", "vinegar"];
  let checked = 0;
  for (const p of prefixes) {
    for (const s of suffixes) {
      const q = `${p} ${s}`;
      const r = matchExistingFood(q, pool);
      checked++;
      if (r.status !== "resolved") continue;
      assert.ok(sameAllergenRoots(q, r.food.name),
        `"${q}" resolved to "${r.food.name}" across allergen roots`);
    }
  }
  assert.ok(checked === prefixes.length * suffixes.length);
});

test("allergen roots are whole-token with plural tolerance, never substring", () => {
  assert.deepEqual([...allergenRootsOf("Almonds")], ["almond"]);
  assert.deepEqual([...allergenRootsOf("Eggs")], ["egg"]);
  assert.deepEqual([...allergenRootsOf("Butternut squash")], [], "'butternut' is not butter");
  assert.deepEqual([...allergenRootsOf("Eggplant")], [], "'eggplant' is not egg");
  assert.ok(allergenRootsOf("Buttermilk").has("milk"), "compound dairy word still declares its root");
  assert.equal(allergenRootsOf("Buttermilk").has("butter"), false);
});

// ---------------------------------------------------------------------------
// Table hygiene — the guards that keep the bug from creeping back
// ---------------------------------------------------------------------------

test("no descriptor token or phrase word is an allergen root", () => {
  for (const t of DESCRIPTOR_TOKENS) {
    assert.equal(allergenRootsOf(t).size, 0, `descriptor "${t}" carries an allergen root`);
  }
  for (const p of DESCRIPTOR_PHRASES) {
    assert.equal(allergenRootsOf(p.join(" ")).size, 0, `descriptor phrase "${p.join(" ")}" carries an allergen root`);
  }
});

test("every alias that changes allergen roots is explicitly sanctioned", () => {
  for (const [alias, canonical] of ALIASES) {
    if (sameAllergenRoots(alias, canonical)) continue;
    assert.ok(ALIAS_ROOT_EXCEPTIONS[alias],
      `alias "${alias}" -> "${canonical}" changes allergen roots with no documented justification`);
    // A sanctioned alias may ADD an allergen root; it may never REMOVE one.
    const before = allergenRootsOf(alias);
    const after = allergenRootsOf(canonical);
    for (const root of before) {
      assert.ok(after.has(root), `alias "${alias}" DROPS allergen root "${root}" — never allowed`);
    }
  }
});

test("declared root equivalences collapse to one allergen, and only for true synonyms", () => {
  assert.ok(sameAllergenRoots("prawns", "Shrimp"), "prawn and shrimp are the same crustacean");
  assert.ok(sameAllergenRoots("soya sauce", "Soy sauce"));
  assert.ok(sameAllergenRoots("groundnuts", "Peanuts"));
  // Equivalence must NOT bleed across real allergen boundaries.
  assert.equal(sameAllergenRoots("shrimp", "Fish"), false);
  assert.equal(sameAllergenRoots("almond", "Cashew"), false);
  assert.equal(sameAllergenRoots("peanut", "Almond"), false);
  assert.equal(sameAllergenRoots("butter", "Milk"), false);
});

test("alias keys and values are already normalised (the lookup is exact)", () => {
  for (const [alias, canonical] of ALIASES) {
    assert.equal(alias, normalizeTokens(alias).join(" "));
    assert.equal(canonical, normalizeTokens(canonical).join(" "));
  }
});

test("stripDescriptors keeps substantive words and drops noise", () => {
  assert.deepEqual(stripDescriptors(normalizeTokens("Chicken breast, raw")), ["chicken", "breast"]);
  assert.deepEqual(stripDescriptors(normalizeTokens("Nuts, almonds, without salt added")), ["nuts", "almonds"]);
  assert.deepEqual(stripDescriptors(normalizeTokens("raw fresh whole")), []);
});

// ---------------------------------------------------------------------------
// USDA tier
// ---------------------------------------------------------------------------

test("usdaCandidateAcceptable rejects every cross-food rename", () => {
  const bad = [
    ["almond butter", "Butter, salted"],
    ["peanut butter", "Butter, without salt"],
    ["coconut milk", "Milk, whole, 3.25% milkfat"],
    ["oat milk", "Milk, nonfat"],
    ["cream of tartar", "Cream, heavy whipping"],
    ["egg plant", "Egg, whole, raw, fresh"],
    ["eggplant", "Egg, whole, raw, fresh"],
    ["butter lettuce", "Butter, salted"],
    ["chickpea flour", "Wheat flour, white, all-purpose"],
    ["rice vinegar", "Rice wine, sake"],
    ["flour", "Wheat flour, white, all-purpose"],
  ];
  for (const [q, name] of bad) {
    assert.equal(usdaCandidateAcceptable(q, name), false, `"${q}" must not accept USDA "${name}"`);
  }
});

test("usdaCandidateAcceptable still accepts real, honest USDA hits", () => {
  const good = [
    ["chicken breast", "Chicken, broilers or fryers, breast, meat only, raw"],
    ["almond butter", "Nuts, almond butter, plain, without salt added"],
    ["rolled oats", "Oats, rolled, dry"],
    ["olive oil", "Oil, olive, salad or cooking"],
    ["prawns", "Shrimp, mixed species, raw"],
  ];
  for (const [q, name] of good) {
    assert.equal(usdaCandidateAcceptable(q, name), true, `"${q}" should accept USDA "${name}"`);
  }
});

// ---------------------------------------------------------------------------
// resolveIngredient() end-to-end, with injected fakes (no DB, no network)
// ---------------------------------------------------------------------------

function fakeDeps({ foods = POOL, hits = [], created = [] } = {}) {
  return {
    listFoodsImpl: async () => foods,
    searchFoodsImpl: async () => hits,
    createFoodImpl: async (data) => { const row = { id: 9000 + created.length, ...data }; created.push(row); return row; },
    loadOverridesImpl: () => ({}),
    _created: created,
  };
}

test("resolveIngredient: exact match resolves and is not flagged", async () => {
  const deps = fakeDeps();
  const r = await resolveIngredient("Butter", deps);
  assert.equal(r.matched, "existing");
  assert.equal(r.status, "resolved");
  assert.equal(r.needsReview, false);
  assert.equal(r.food.name, "Butter");
  assert.equal(deps._created.length, 0);
});

test("resolveIngredient: almond butter falls through to a VERBATIM zero-macro placeholder", async () => {
  const deps = fakeDeps();
  const r = await resolveIngredient("almond butter", deps);
  assert.equal(r.matched, "placeholder");
  assert.equal(r.status, "needs_review");
  assert.equal(r.needsReview, true);
  assert.equal(r.food.name, "almond butter", "the user's words, untouched");
  assert.equal(r.query, "almond butter");
  assert.equal(r.food.kcal, 0);
  assert.equal(r.food.protein, 0);
  assert.equal(r.food.fat, 0);
  assert.equal(r.food.carb, 0);
  assert.equal(r.food.source, "manual-placeholder");
  assert.ok(r.candidates.length > 0);
});

test("resolveIngredient: a USDA hit that renames the food is refused, placeholder wins", async () => {
  const usdaButter = {
    fdcId: 173410, name: "Butter, salted", category: "fats-nuts-oils",
    per100g: { kcal: 717, protein: 0.85, fat: 81.1, carb: 0.06, fiber: 0 },
  };
  const deps = fakeDeps({ hits: [usdaButter] });
  const r = await resolveIngredient("almond butter", deps);
  assert.equal(r.matched, "placeholder");
  assert.equal(r.food.name, "almond butter");
  assert.notEqual(r.food.name, "Butter, salted");
  assert.equal(r.food.fat, 0, "must not inherit butter's fat");
});

test("resolveIngredient: an honest USDA hit resolves and is tagged usda", async () => {
  const usdaAlmondButter = {
    fdcId: 174300, name: "Nuts, almond butter, plain, without salt added",
    category: "fats-nuts-oils",
    per100g: { kcal: 614, protein: 20.8, fat: 55.5, carb: 18.8, fiber: 10.3 },
  };
  const deps = fakeDeps({ hits: [usdaAlmondButter] });
  const r = await resolveIngredient("almond butter", deps);
  assert.equal(r.matched, "usda");
  assert.equal(r.status, "resolved");
  assert.equal(r.needsReview, false);
  assert.equal(r.food.name, "Nuts, almond butter, plain, without salt added");
});

test("resolveIngredient: a USDA outage still yields a placeholder, never a guess", async () => {
  const deps = fakeDeps();
  deps.searchFoodsImpl = async () => { throw new Error("ENOTFOUND api.nal.usda.gov"); };
  const r = await resolveIngredient("almond butter", deps);
  assert.equal(r.matched, "placeholder");
  assert.equal(r.needsReview, true);
  assert.equal(r.food.name, "almond butter");
});

test("resolveIngredient: reusing an existing placeholder row stays flagged for review", async () => {
  const pool = [...POOL, f("almond butter", { source: "manual-placeholder", kcal: 0, protein: 0, fat: 0, carb: 0 })];
  const deps = fakeDeps({ foods: pool });
  const r = await resolveIngredient("almond butter", deps);
  assert.equal(r.matched, "placeholder", "reuses the row instead of duplicating it");
  assert.equal(r.status, "needs_review", "a zero-macro placeholder is never 'resolved'");
  assert.equal(r.needsReview, true);
  assert.equal(deps._created.length, 0);
});

test("INVARIANT: needsReview <=> matched === 'placeholder'", async () => {
  // RecipesTab.jsx renders its red "no macro data" warning off
  // `placeholderMacros: matched === "placeholder"`, which both callers compute.
  // That existing UI only stays honest while this equivalence holds — if a
  // future edit lets a needs_review result carry matched "existing"/"usda",
  // the warning silently stops firing and the guess looks like a fact.
  const withPlaceholderRow = [...POOL, f("mystery paste", { source: "manual-placeholder", kcal: 0, protein: 0, fat: 0, carb: 0 })];
  const cases = [
    ["Butter", POOL], ["chicken breast", POOL], ["aubergine", POOL],
    ["almond butter", POOL], ["butter lettuce", POOL], ["total nonsense 42", POOL],
    ["mystery paste", withPlaceholderRow], ["", POOL],
  ];
  for (const [q, pool] of cases) {
    const r = await resolveIngredient(q, fakeDeps({ foods: pool }));
    assert.equal(r.needsReview, r.matched === "placeholder", `"${q}": needsReview=${r.needsReview} matched=${r.matched}`);
    assert.equal(r.needsReview, r.status === "needs_review");
  }
});

test("resolveIngredient: callers can always read food.id, resolved or not", async () => {
  const deps = fakeDeps();
  for (const q of ["Butter", "almond butter", "chicken breast", "total nonsense 42"]) {
    const r = await resolveIngredient(q, deps);
    assert.ok(r.food && r.food.id != null, `${q} must still hand back a usable Food row`);
    assert.ok(["existing", "usda", "placeholder"].includes(r.matched));
    assert.ok(["resolved", "needs_review"].includes(r.status));
  }
});
