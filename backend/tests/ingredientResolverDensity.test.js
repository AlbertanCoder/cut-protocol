const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveIngredient, matchExistingFood, usdaCandidateAcceptable,
  DESCRIPTOR_TOKENS, DENSITY_TOKENS, AMBIGUOUS_DENSITY_TOKEN,
} = require("../src/lib/ingredientResolver.js");
const {
  isQuarantined, macroTrustIssue, hasUsableMacros, assertUsableMacros,
  recipeDataConfidence, validateRecipe, validateFood, QUARANTINE_SOURCE,
} = require("../src/lib/foodValidation.js");

// ---------------------------------------------------------------------------
// Fleet finding food-data-2. Two holes, one root cause: the app's only content
// check on a food row is fiber-adjusted Atwater, and DEHYDRATION IS ATWATER-
// CONSISTENT. "Milk, dry, whole" at 496 kcal/100g satisfies 4/4/9 exactly as
// well as milk's 61 does. So the 4/4/9 gate cannot tell a food from its own
// dried, powdered, concentrated or breaded form — only the NAME can, and until
// this pass nothing compared them on the live-lookup side.
//
//   (C) usdaCandidateAcceptable() minted new rows from those records.
//   (D) matchExistingFood() served the 470 rows a prior repair had already
//       CONFESSED were carrying another food's macros, at confidence "exact".
//
// Everything here is pure/in-memory — no Prisma, no network, no dev.db.
// ---------------------------------------------------------------------------

let nextId = 1;
const f = (name, over = {}) => ({
  id: nextId++, name, category: "pantry",
  kcal: 100, protein: 5, fat: 2, carb: 15, fiber: 0, source: "usda-verified", ...over,
});

// ===========================================================================
// (C) the density ban on the USDA tier
// ===========================================================================

test("DENSITY_TOKENS and DESCRIPTOR_TOKENS must never intersect", () => {
  // DESCRIPTOR_TOKENS is the tier-3 ALLOWLIST — words that provably do NOT move
  // macro density. DENSITY_TOKENS is the USDA-tier DENY list — words that
  // provably do. A word on both lists would mean the two tiers disagree about
  // the same food, which is how a "fixed" bug reopens on the other side.
  const both = [...DENSITY_TOKENS].filter((t) => DESCRIPTOR_TOKENS.has(t));
  assert.deepEqual(both, [], `these words are on both lists: ${both.join(", ")}`);
  assert.equal(DESCRIPTOR_TOKENS.has(AMBIGUOUS_DENSITY_TOKEN), false);
});

test("the headline bug: `milk` must not accept USDA 'Milk, dry, whole'", () => {
  // 61 kcal/100g vs 496 — 8.1x. CLAUDE.md records this exact swap as fixed in
  // Phase 2; it reopened on the live-lookup side because that tier never had
  // the ban applied to it.
  assert.equal(usdaCandidateAcceptable("milk", "Milk, dry, whole"), false);
});

test("every live-verified density swap is refused", () => {
  const bad = [
    ["milk", "Milk, dry, whole"],                 // 61 -> 496   (8.1x)
    ["milk", "Milk, condensed, sweetened"],       // 61 -> 321
    ["milk", "Milk, dry, nonfat, instant"],
    ["egg", "Egg, whole, dried"],                 // 143 -> 594  (4.2x)
    ["garlic", "Garlic powder"],                  // 149 -> 331
    ["beef", "Beef, dried, cured"],
    ["tomato", "Tomato powder"],                  // 18 -> 302   (16.8x)
    ["carrot", "Carrot, dehydrated"],             // 41 -> 341
    ["onion", "Onions, dehydrated flakes"],
    ["potato", "Potato flour, dried"],
    ["banana", "Bananas, dehydrated, or banana powder"],
    ["apple", "Apple juice, from concentrate"],
    ["vanilla", "Vanilla extract"],
    ["chicken breast", "Chicken breast, breaded, fried"],
    ["salmon", "Fish, salmon, chinook, smoked"],
    ["corn", "Corn, sweet, yellow, creamed"],
    ["cream", "Cream, evaporated"],
  ];
  for (const [q, name] of bad) {
    assert.equal(usdaCandidateAcceptable(q, name), false, `"${q}" must not accept USDA "${name}"`);
  }
});

test("a query that ASKS for the dried form still gets it", () => {
  // The ban is on what the CANDIDATE adds, not on the word itself. Someone who
  // typed "dried oregano" wants dried oregano's 265 kcal.
  const good = [
    ["dried oregano", "Spices, oregano, dried"],
    ["smoked paprika", "Spices, paprika, smoked"],
    ["garlic powder", "Garlic powder"],
    ["vanilla extract", "Vanilla extract"],
    ["condensed milk", "Milk, condensed"],
  ];
  for (const [q, name] of good) {
    assert.equal(usdaCandidateAcceptable(q, name), true, `"${q}" should accept USDA "${name}"`);
  }
});

test("'dry' is banned only for the generic one-word request", () => {
  // It is the one genuinely ambiguous word in FDC's vocabulary: dehydrated for
  // a natively wet food, merely uncooked for a natively dry staple. A bare
  // one-word query has said nothing about form, so its only honest reading is
  // the ordinary retail form.
  assert.equal(usdaCandidateAcceptable("milk", "Milk, dry, whole"), false);
  // ...but a query that already named a form has chosen one. (This case is
  // asserted true in ingredientResolver.test.js and must keep passing.)
  assert.equal(usdaCandidateAcceptable("rolled oats", "Oats, rolled, dry"), true);
});

test("the density ban does not disturb the honest USDA hits", () => {
  // Re-asserted here so a future edit to DENSITY_TOKENS fails loudly rather
  // than quietly narrowing what the USDA tier can still resolve.
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

test("the Atwater gate passes the dried record — which is why the name rule has to catch it", () => {
  // Milk powder's own numbers are perfectly self-consistent. This is the whole
  // argument for the ban: no arithmetic check can see this class of error.
  const milkPowder = { name: "Milk, dry, whole", category: "dairy", kcal: 496, protein: 26.3, fat: 26.7, carb: 38.4, fiber: 0, source: "usda" };
  assert.equal(validateFood(milkPowder, { nameIsSourceDescription: true }).ok, true,
    "milk powder is internally consistent — only usdaCandidateAcceptable() stands between it and a row named 'milk'");
});

test("resolveIngredient: a dried USDA hit is refused end-to-end, placeholder wins", async () => {
  const created = [];
  const deps = {
    listFoodsImpl: async () => [f("Butter"), f("Cheese")],
    searchFoodsImpl: async () => ([{
      fdcId: 170873, name: "Milk, dry, whole", category: "dairy",
      per100g: { kcal: 496, protein: 26.3, fat: 26.7, carb: 38.4, fiber: 0 },
    }]),
    createFoodImpl: async (data) => { const row = { id: 9000 + created.length, ...data }; created.push(row); return row; },
    loadOverridesImpl: () => ({}),
  };
  const r = await resolveIngredient("milk", deps);
  assert.equal(r.matched, "placeholder");
  assert.equal(r.needsReview, true);
  assert.equal(r.food.name, "milk", "the user's word, untouched");
  assert.equal(r.food.kcal, 0, "must not inherit milk powder's 496");
});

// ===========================================================================
// (D) matchExistingFood must not serve a row that confessed
// ===========================================================================

// The real shape of a corrupted row: name kept, confession kept, false
// usda-verified claim stripped, fdcId nulled — and the wrong numbers left in
// the columns the app reads.
const cleared = (name, over = {}) => f(name, {
  source: "manual", fdcId: null,
  dataQuality: `exception:provenance-cleared — carried fdcId 169999 ("Something Else"), whose description does not denote this food; this row's macros are that record's values verbatim and are therefore NOT this food's numbers; no FDC record matches this name unambiguously, so no replacement was guessed`,
  ...over,
});

test("an exact name match on a quarantined row is refused, not resolved", () => {
  const pool = [f("Butter"), cleared("Flour", { source: QUARANTINE_SOURCE, kcal: 357, protein: 0.3 })];
  const r = matchExistingFood("Flour", pool);
  assert.equal(r.status, "needs_review");
  assert.equal(r.confidence, null);
  assert.equal(r.food, null);
  assert.ok(r.untrustedMatch, "the caller is told a row exists but is not usable");
  assert.equal(r.untrustedMatch.food.name, "Flour");
  assert.match(r.reason, /quarantined/);
});

test("a provenance-cleared row is refused even before the migration runs", () => {
  // isQuarantined() reads the confession as well as the source column, so the
  // app is honest from the moment this code ships — not from the moment
  // someone remembers to run quarantineCorruptFoods.mjs.
  const pool = [cleared("Rice", { kcal: 416 })];
  const r = matchExistingFood("Rice", pool);
  assert.equal(r.status, "needs_review");
  assert.equal(r.food, null);
});

test("containment and alias tiers refuse quarantined rows too, not just tier 1", () => {
  const containment = matchExistingFood("chicken breast", [cleared("Chicken breast, raw", { kcal: 263 })]);
  assert.equal(containment.status, "needs_review");
  assert.ok(containment.untrustedMatch);

  const alias = matchExistingFood("aubergine", [cleared("Eggplant")]);
  assert.equal(alias.status, "needs_review");
  assert.ok(alias.untrustedMatch);
});

test("a trusted row is still preferred over a quarantined one of the same name", () => {
  const good = f("Tomato", { kcal: 18 });
  const bad = cleared("Tomato", { kcal: 302 });
  for (const pool of [[good, bad], [bad, good]]) {
    const r = matchExistingFood("Tomato", pool);
    assert.equal(r.status, "resolved");
    assert.equal(r.food.kcal, 18, "the quarantined 302 must never win, whatever the row order");
  }
});

test("DOCUMENTED exceptions are NOT quarantined — only unverified provenance is", () => {
  // ~500 healthy rows carry an `exception:` dataQuality: alcohol's 7 kcal/g,
  // USDA's own per-food Atwater factors, curated overrides, high-fiber
  // botanicals. A blanket "starts with exception:" rule would condemn all of
  // them. Each of these must still resolve normally.
  const healthy = [
    "exception:atwater-exempt — ethanol carries 7 kcal/g and appears in no macro",
    "exception:alcohol-energy — documented physical exception",
    "exception:usda-source-model — USDA computed energy with food-specific factors",
    "exception:curated-override — macros come from data/foodOverrides.json",
  ];
  for (const dq of healthy) {
    const row = f("Red wine", { dataQuality: dq });
    assert.equal(isQuarantined(row), false, dq);
    assert.equal(hasUsableMacros(row), true, dq);
    const r = matchExistingFood("Red wine", [row]);
    assert.equal(r.status, "resolved", `"${dq}" must still resolve`);
  }
});

test("resolveIngredient hands back the quarantined row FLAGGED, without minting a duplicate", async () => {
  const created = [];
  const row = cleared("Flour", { source: QUARANTINE_SOURCE, kcal: 357 });
  const deps = {
    listFoodsImpl: async () => [row],
    searchFoodsImpl: async () => [],
    createFoodImpl: async (data) => { const r = { id: 9000 + created.length, ...data }; created.push(r); return r; },
    loadOverridesImpl: () => ({}),
  };
  const r = await resolveIngredient("Flour", deps);
  assert.equal(created.length, 0, "a second row named 'Flour' would hide which one is broken");
  assert.equal(r.food.id, row.id);
  assert.equal(r.matched, "placeholder");
  assert.equal(r.status, "needs_review");
  assert.equal(r.needsReview, true);
  assert.equal(r.confidence, null);
});

test("INVARIANT HOLDS for quarantined rows: needsReview <=> matched === 'placeholder'", async () => {
  // RecipesTab renders its red "no macro data" warning off
  // `placeholderMacros: matched === "placeholder"`, and recipeGeneration blocks
  // drafts on the same flag. Reporting a quarantined row under a NEW `matched`
  // value would have switched both off for the one case that most needs them.
  const deps = (foods) => ({
    listFoodsImpl: async () => foods,
    searchFoodsImpl: async () => [],
    createFoodImpl: async (data) => ({ id: 9999, ...data }),
    loadOverridesImpl: () => ({}),
  });
  const cases = [
    ["Flour", [cleared("Flour", { source: QUARANTINE_SOURCE })]],
    ["Rice", [cleared("Rice")]],
    ["Butter", [f("Butter")]],
    ["total nonsense 42", [f("Butter")]],
  ];
  for (const [q, pool] of cases) {
    const r = await resolveIngredient(q, deps(pool));
    assert.equal(r.needsReview, r.matched === "placeholder", `"${q}": needsReview=${r.needsReview} matched=${r.matched}`);
    assert.equal(r.needsReview, r.status === "needs_review");
    assert.ok(["existing", "usda", "placeholder"].includes(r.matched), `"${q}" widened the matched contract`);
    assert.ok(r.food && r.food.id != null, `"${q}" must still hand back a usable row`);
  }
});

// ===========================================================================
// the foodValidation seam other modules consume
// ===========================================================================

test("isQuarantined / macroTrustIssue / assertUsableMacros", () => {
  const bad = f("Mayonnaise", { source: QUARANTINE_SOURCE, kcal: 263 });
  assert.equal(isQuarantined(bad), true);
  assert.equal(hasUsableMacros(bad), false);
  assert.equal(macroTrustIssue(bad).code, "quarantined");
  assert.match(macroTrustIssue(bad).detail, /another food's numbers/);
  assert.throws(() => assertUsableMacros(bad), (e) => e.code === "quarantined" && e.status === 422);

  const placeholder = f("mystery paste", { source: "manual-placeholder", kcal: 0 });
  assert.equal(macroTrustIssue(placeholder).code, "placeholder");

  const unverifiable = f("Rye", { dataQuality: "exception:unverifiable-fdcid — claimed FDC id 999 is not in the datasets" });
  assert.equal(macroTrustIssue(unverifiable).code, "unverified-provenance");

  const good = f("Butter");
  assert.equal(macroTrustIssue(good), null);
  assert.equal(assertUsableMacros(good), good);
});

test("a recipe with a quarantined ingredient says 'incomplete', not a confident number", () => {
  const recipe = {
    name: "Tomato pasta", kcal: 500, protein: 20, fat: 10, carb: 80,
    ingredients: [
      { baseGrams: 100, food: f("Pasta", { kcal: 350 }) },
      { baseGrams: 100, food: f("Tomato", { source: QUARANTINE_SOURCE, kcal: 302 }) },
    ],
  };
  const conf = recipeDataConfidence(recipe);
  assert.equal(conf.complete, false);
  assert.equal(conf.unusable.length, 1);
  assert.equal(conf.unusable[0].name, "Tomato");
  assert.match(conf.reason, /incomplete/i);
  assert.doesNotMatch(conf.reason, /\d{3}/, "the honest answer names the ingredient, it does not quote a total");

  const issues = validateRecipe(recipe).issues.map((i) => i.code);
  assert.ok(issues.includes("untrusted-ingredients"));

  const clean = { ...recipe, ingredients: [{ baseGrams: 100, food: f("Pasta", { kcal: 350 }) }], kcal: 350, protein: 5, fat: 2, carb: 15 };
  assert.equal(recipeDataConfidence(clean).complete, true);
  assert.equal(recipeDataConfidence(clean).reason, null);
});

test("quarantine does not block repair: validateFood still judges the numbers alone", () => {
  // The quarantine flag lives outside validateFood on purpose. That function
  // gates writes, and an admin fixing a quarantined row's macros must not be
  // refused by the very flag they are clearing.
  const row = { name: "Tomato", category: "produce", kcal: 18, protein: 0.9, fat: 0.2, carb: 3.9, fiber: 1.2, source: QUARANTINE_SOURCE };
  assert.equal(validateFood(row).ok, true);
});
