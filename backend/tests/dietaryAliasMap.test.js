// Free-text exclusion terms — finding dietary-safety-5 (P1).
//
// The bug: a term that wasn't one of the ~18 CATEGORY_SYNONYMS keys fell
// straight through to `name.toLowerCase().includes(term)`. That silently
// under-excludes exactly the people most at risk — the ones who type the thing
// they actually react to instead of the checkbox label:
//
//   "lactose"     did not exclude "Milk, whole, 3.25% milkfat"
//   "wheat"       did not exclude "Semolina flour" or "Seitan"
//   "prawn"       did not exclude "Shrimp, cooked"
//   "groundnut"   did not exclude "Peanut butter"
//
// All four measured against the live matcher on 2026-07-23 before this fix.
//
// The two rules this suite pins:
//   1. A recognised alias resolves to the WHOLE category, and additionally
//      keeps its own literal text as a probe (union, never replacement).
//   2. An UNRECOGNISED term is never dropped. It still filters as a literal
//      substring — fail-safe, over-exclude — and is flagged to the UI as
//      "matching on text only" so the user can see the difference.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  matchesExclusionTerm,
  resolveExclusionTerm,
  describeExclusionTerms,
  applyDietaryFilters,
  FREE_TEXT_ALIASES,
  CATEGORY_SYNONYMS,
  SYNONYM_KEY_FAMILY,
} = require("../src/lib/dietaryFilter.js");

// ── 1. the measured leaks ────────────────────────────────────────────────

test("THE REPORTED LEAKS: lactose excludes whole milk, wheat excludes semolina", () => {
  assert.ok(matchesExclusionTerm("Milk, whole, 3.25% milkfat", "lactose"), "'lactose' must exclude whole milk");
  assert.ok(matchesExclusionTerm("Semolina flour", "wheat"), "'wheat' must exclude semolina");
  assert.ok(matchesExclusionTerm("Seitan, prepared", "wheat"), "'wheat' must exclude seitan (it is wheat gluten)");
  assert.ok(matchesExclusionTerm("Spelt berries", "wheat"));
  assert.ok(matchesExclusionTerm("Farro, pearled", "wheat"));
  assert.ok(matchesExclusionTerm("Durum flour", "wheat"));
});

test("symptom / protein / regional names all reach their category", () => {
  const cases = [
    // dairy
    ["Milk, whole", "lactose"], ["Cheese, cheddar", "casein"], ["Yogurt, plain", "whey"],
    ["Butter, salted", "milk protein"], ["Ice creams, vanilla", "milkfat"],
    // gluten
    ["Barley, pearled", "celiac"], ["Rye bread", "coeliac"], ["Bulgur, dry", "wheat"],
    ["Triticale flour", "gluten intolerance"],
    // egg
    ["Eggs, whole, raw", "albumen"], ["Mayonnaise, regular", "albumen"],
    // peanut (legume) — must NOT be the tree-nut category
    ["Peanut butter, smooth", "groundnut"], ["Peanuts, roasted", "arachis"],
    // shellfish
    ["Shrimp, cooked", "prawn"], ["Crab, blue, cooked", "crustacean"],
    ["Mussels, blue, raw", "mollusc"],
    // soy / sesame / fish
    ["Tofu, firm", "soya"], ["Tahini paste", "sesame seeds"], ["Anchovy fillets", "finfish"],
  ];
  for (const [name, term] of cases) {
    assert.ok(matchesExclusionTerm(name, term), `"${term}" must exclude "${name}"`);
  }
});

test("peanut and tree-nut aliases stay on opposite sides of the line", () => {
  // A peanut allergy is not a tree-nut allergy and vice versa — the codebase
  // separates them deliberately, and the alias map must not collapse them.
  assert.equal(resolveExclusionTerm("groundnut").synonymKey, "peanuts");
  assert.equal(resolveExclusionTerm("almond").synonymKey, "tree nuts");
  assert.ok(!matchesExclusionTerm("Almonds, raw", "groundnut"), "a peanut term must not exclude almonds");
  assert.ok(!matchesExclusionTerm("Peanuts, dry roasted", "almond"), "a tree-nut term must not exclude plain peanuts");
  // Documented pre-existing over-match, NOT introduced by the alias map: the
  // "tree nuts" category carries the phrase "nut butter", and "peanut butter"
  // contains that phrase as a substring, so peanut butter is excluded for a
  // tree-nut allergy. Over-exclusion in the safe direction (commercial peanut
  // butter routinely carries a tree-nut trace statement), and it predates this
  // change — pinned here so the behaviour is a decision, not a surprise.
  assert.ok(matchesExclusionTerm("Peanut butter, smooth", "tree nuts"));
});

// ── 2. the union rule ────────────────────────────────────────────────────

test("an alias UNIONS its category with its own literal text — it never replaces it", () => {
  // "lactose" = the dairy category, PLUS anything that literally says lactose.
  assert.ok(matchesExclusionTerm("Lactose, purified", "lactose"), "the literal term must still match");
  assert.ok(matchesExclusionTerm("Cheese, gouda", "lactose"), "and the category must match too");
  // Same for a term whose literal text appears in a food the category misses.
  assert.ok(matchesExclusionTerm("Hydrolysed wheat protein", "wheat"));
});

test("aliases can only widen: everything the old literal match caught is still caught", () => {
  // Before the alias map, "prawn" was a substring match. Those hits must all
  // survive — an alias that swapped literal matching for category matching
  // would be a silent regression in the unsafe direction.
  for (const name of ["Prawn crackers", "King prawns, raw", "Prawn cocktail crisps"]) {
    assert.ok(matchesExclusionTerm(name, "prawn"), `${name} must still match the literal term`);
  }
});

// ── 3. unrecognised free text: fail-safe, and honest about it ────────────

test("an unrecognised term still filters (literal substring), and is flagged as text-only", () => {
  const r = resolveExclusionTerm("dragonfruit");
  assert.equal(r.recognised, false);
  assert.equal(r.kind, "literal");
  assert.equal(r.note, "not a recognised allergen — matching on text only");
  assert.ok(matchesExclusionTerm("Dragonfruit, raw", "dragonfruit"), "an unrecognised term must still exclude — never dropped");
  assert.ok(!matchesExclusionTerm("Apple, raw", "dragonfruit"));
});

test("describeExclusionTerms gives the UI the three cases it must render differently", () => {
  const described = describeExclusionTerms(["dairy", "lactose", "my weird trigger food", "  ", null]);
  assert.equal(described.length, 3, "blank and null terms are dropped, not rendered");

  const [category, alias, literal] = described;
  assert.deepEqual(
    { kind: category.kind, recognised: category.recognised, synonymKey: category.synonymKey },
    { kind: "category", recognised: true, synonymKey: "dairy" },
  );
  assert.deepEqual(
    { kind: alias.kind, recognised: alias.recognised, synonymKey: alias.synonymKey, family: alias.family },
    { kind: "alias", recognised: true, synonymKey: "dairy", family: "dairy" },
  );
  assert.equal(alias.note, 'matched as the "dairy" allergen category');
  assert.deepEqual(
    { kind: literal.kind, recognised: literal.recognised, note: literal.note },
    { kind: "literal", recognised: false, note: "not a recognised allergen — matching on text only" },
  );
});

test("the existing scoped free-text behaviour is preserved: 'soy protein' still permits soybean oil", () => {
  // This account's original rule. "soy protein" is its own CATEGORY_SYNONYMS
  // key precisely so it does NOT expand to the whole soy category.
  assert.equal(resolveExclusionTerm("soy protein").kind, "category");
  assert.ok(!matchesExclusionTerm("Soybean oil", "soy protein"));
  assert.ok(matchesExclusionTerm("Textured vegetable protein", "soy protein"));
});

test("a non-string term never throws (it 500-bricked every recipe screen once)", () => {
  for (const junk of [null, undefined, 42, {}, [], true]) {
    assert.doesNotThrow(() => matchesExclusionTerm("Cheddar cheese", junk));
    assert.doesNotThrow(() => resolveExclusionTerm(junk));
  }
  assert.equal(matchesExclusionTerm("Cheddar cheese", null), false);
});

// ── 4. table integrity ───────────────────────────────────────────────────

test("every alias points at a real CATEGORY_SYNONYMS key", () => {
  const dangling = Object.entries(FREE_TEXT_ALIASES).filter(([, key]) => !CATEGORY_SYNONYMS[key]);
  assert.deepEqual(dangling, [], `alias targets with no category: ${dangling.map(([a, k]) => `${a}->${k}`).join(", ")}`);
});

test("no alias shadows a real category key (a category must never be reinterpreted)", () => {
  const shadowed = Object.keys(FREE_TEXT_ALIASES).filter((a) => CATEGORY_SYNONYMS[a]);
  assert.deepEqual(shadowed, [], `these aliases collide with category keys: ${shadowed.join(", ")}`);
});

test("every category key that can receive an alias declares an allergen family", () => {
  const targets = new Set(Object.values(FREE_TEXT_ALIASES));
  const familyless = [...targets].filter((k) => !SYNONYM_KEY_FAMILY[k]);
  assert.deepEqual(familyless, [], `alias targets with no family (allergen tags can never match them): ${familyless.join(", ")}`);
});

// ── 4b. TERM NORMALISATION (Stage 1, 2026-07-24) ─────────────────────────
// The alias MAP was fine; the LOOKUP was not. resolveExclusionTerm() normalised
// with trim().toLowerCase() and nothing else, so a term only resolved if the
// user typed the exact dictionary spelling. Measured against the real
// 889-recipe pool, every phrasing below removed 0 recipes.
//
// The tell that this was an accident rather than a policy: `lactose
// intolerance` and `coeliac` WERE aliases; `lactose-intolerant` and `gluten
// free` were not. (Full free-text coverage lives in allergenTaxonomy.test.js —
// this section pins the contract at the resolver boundary this file owns.)

test("NORMALISATION: the exact-match path is tried first, so nothing can regress", () => {
  // Every term that resolved before must resolve identically, with the same
  // `kind` — normalisation is an added fallback, never a replacement.
  assert.equal(resolveExclusionTerm("dairy").kind, "category");
  assert.equal(resolveExclusionTerm("lactose").kind, "alias");
  assert.equal(resolveExclusionTerm("lactose").synonymKey, "dairy");
  assert.equal(resolveExclusionTerm("soy protein").kind, "category");
  // The literal probe still uses the RAW text, so the resolver is idempotent:
  // exclusionEvidence() re-resolves from `key` and must land in the same place.
  const r = resolveExclusionTerm("Cow's Milk");
  assert.equal(r.key, "cow's milk");
  assert.equal(resolveExclusionTerm(r.key).synonymKey, r.synonymKey);
});

test("NORMALISATION: punctuation, possessives and hyphens no longer defeat a lookup", () => {
  for (const typed of ["cow's milk", "cows milk", "Cow’s milk", "dairy!", "dairy.", "dairy-free", "dairy free", "  DAIRY  "]) {
    assert.equal(resolveExclusionTerm(typed).synonymKey, "dairy", `"${typed}" must reach the dairy category`);
    assert.equal(matchesExclusionTerm("Cottage Cheese", typed), true, `"${typed}" must exclude cottage cheese`);
  }
});

test("NORMALISATION: intent affixes are peeled — a constraint and a diagnosis mean the allergen", () => {
  const cases = [
    ["gluten free", "gluten"], ["gluten-free", "gluten"], ["no gluten", "gluten"],
    ["wheat allergy", "gluten"], ["celiac disease", "gluten"],
    ["lactose free", "dairy"], ["lactose-intolerant", "dairy"], ["no dairy", "dairy"],
    ["milk allergy", "dairy"], ["dairies", "dairy"],
    ["nut allergy", "tree nuts"], ["shellfish allergy", "shellfish"],
    ["soy allergy", "soy"], ["peanut allergy", "peanuts"],
  ];
  for (const [typed, expected] of cases) {
    const r = resolveExclusionTerm(typed);
    assert.equal(r.recognised, true, `"${typed}" must be recognised`);
    assert.equal(r.synonymKey, expected, `"${typed}" → ${r.synonymKey}, expected ${expected}`);
  }
});

test("NORMALISATION: a normalised match reports the category it landed in", () => {
  const [described] = describeExclusionTerms(["cow's milk"]);
  assert.equal(described.kind, "alias");
  assert.equal(described.recognised, true);
  assert.equal(described.synonymKey, "dairy");
  assert.equal(described.note, 'matched as the "dairy" allergen category');
  assert.equal(described.normalisedKey, "cows milk", "the UI can show WHAT we understood it as");
});

test("NORMALISATION: it cannot fabricate a match out of nothing", () => {
  // Peeling affixes must not turn an empty or wrapper-only term into an
  // allergen. "free"/"no" alone are not the dairy category.
  for (const junk of ["free", "no", "allergy", "-", "!!!", "   "]) {
    const r = resolveExclusionTerm(junk);
    assert.ok(r.kind === "literal" || r.kind === "empty", `"${junk}" resolved to ${r.kind}/${r.synonymKey}`);
  }
  assert.equal(matchesExclusionTerm("Cottage Cheese", "free"), false);
});

// ── 5. end-to-end through the real filter entry point ────────────────────

test("a free-text 'lactose' profile actually loses the dairy from its pool", () => {
  const pool = [
    { name: "Milk, whole, 3.25% milkfat", carb: 5 },
    { name: "Cheese, cheddar", carb: 1 },
    { name: "Almond milk, unsweetened", carb: 1 },
    { name: "Rice, white, cooked", carb: 28 },
  ];
  const kept = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["lactose"] });
  assert.deepEqual(kept.map((f) => f.name), ["Almond milk, unsweetened", "Rice, white, cooked"],
    "plant milk stays — the plant-qualifier guards still apply through the alias");
});
