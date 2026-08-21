// The dietary styles form a LATTICE, and this file asserts it.
//
// WHY IT EXISTS. Until 2026-07-29 `excludedByStyle` gave vegetarian its own,
// shorter keyword list — `MEAT_FISH_KEYWORDS` alone — while vegan consulted that
// list PLUS `ANIMAL_DERIVED_EXTRA_KEYWORDS` plus four dairy probes. Vegetarian was
// therefore a strict subset of vegan by construction, and every vegan-only term
// was invisible to it. The cost, measured on the real corpus:
//
//   * three curry pastes IN LIVE USE as recipe ingredients reached vegetarian
//     plans and grocery lists, while THIS SAME FILE excluded them for vegan, for
//     a fish allergy and for a shellfish allergy;
//   * 33 of 46 gelatin carriers (marshmallows) reached vegetarian pools, and two
//     live recipes emitted "Miniature Marshmallows" onto a vegetarian grocery list;
//   * 15 foods were excluded for a fish or shellfish allergy and admitted to a
//     vegetarian pool — including `Shellfish, NFS`, `Soup, bouillabaisse`,
//     `Paella, NFS`, `Soup, bisque`, `Kimchi` and `Olive tapenade`.
//
// None of that was caught by a test, because every existing dietary test asserts
// individual foods against individual styles. The bug was not in any one verdict —
// it was in the RELATIONSHIP between two styles, which nothing asserted.
//
// These are containment properties, not examples. Adding a keyword to one style
// and not the other now fails here.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  adjusterExcludedByStyle,
  matchesExclusionTerm,
} = require("../src/lib/dietaryFilter.js");

const excl = (name, style) => adjusterExcludedByStyle({ name }, style);

// Every real offender from the 2026-07-29 measurement, plus the guard cases that
// must NOT be swept up with them. If a future change closes the leaks by
// over-excluding, the second group fails.
const MARINE_OR_SLAUGHTER = [
  "Thai Red Curry Paste", "Red Curry Paste", "Thai Green Curry Paste",
  "Shellfish, NFS", "Shellfish and noodles with tomato-based sauce",
  "Soup, bouillabaisse", "Paella, NFS", "Soup, bisque",
  "Shellfish mixture and vegetables including carrots, broccoli, and/or dark-green leafy; no potatoes, soy-based sauce",
  "Cabbage, kimchi", "Kimchi", "Olive tapenade",
  "Miniature Marshmallows", "Candies, marshmallows", "Christmas pudding",
  "Gelatin", "Lard", "Beef suet", "Worcestershire sauce", "Bonito flakes",
];

// Plant foods and lacto-ovo foods that must stay AVAILABLE to a vegetarian.
//
// Every name below is a REAL row in the live food table or a real recipe title. That
// rule is not decoration: an earlier revision of this list carried five invented
// spellings ("Soy yogurt", "Tomato bisque", "Jackfruit", "Cheddar",
// "Eggs, Grade A, Large") whose real corpus forms are "SILK Raspberry soy yogurt",
// "Soup, tomato bisque, canned, condensed", "Jackfruit, raw" and "Cheese, Cheddar".
// Fake names cannot catch a real regression — that is exactly how the "Egg Plants"
// spelling slipped through and why COMPOUND_FALSE_FRIENDS was rewritten.
const VEGETARIAN_MUST_KEEP = [
  "Butter Beans", "Peanut Butter", "Almond Milk", "Sesame butter, creamy",
  "Egg Plants", "Water chestnut", "Coconut Cream", "Cream Of Tartar",
  "Soup, tomato bisque, canned, condensed", "Butternut squash bisque",
  "Paella Rice", "Jackfruit, raw", "SILK Raspberry soy yogurt",
  // lacto-ovo: permitted for vegetarian, excluded for vegan
  "Eggs, Grade A, Large", "Cheese, Cheddar", "Greek yogurt, 0%", "Butter", "Honey",
  // Egg-based confections. `nougat` is whipped EGG WHITE and allergenTaxonomy.js:133
  // files it under `eggs` — it was briefly listed as a gelatin confection, which hid
  // these from vegetarians. Real corpus rows.
  "Candies, TOBLERONE, milk chocolate with honey and almond nougat",
  "Candies, nougat, with almonds", "Chocolate candy, nougat filled",
  // DISH-NAME false positives. These carry a keyword the allergen taxonomy holds for
  // good reason (traditional paella/kimchi/pho/tapenade really do carry marine
  // ingredients) while stating their own plant identity. A real recipe and real rows.
  "Roast fennel and aubergine paella", "Paella, vegetarian",
  "Vegan kimchi", "Vegetarian pho", "Vegan tapenade",
];

// `carnivore` is defined as `!isVeganAnimalProduct(name)`, so it is the INVERSE of the
// set the two tests above widen. Every keyword added to make vegetarian stricter makes
// carnivore looser, and nothing used to measure that: adding `nougat` and `gummy` put
// five candy rows INTO a carnivore pool, and the allergen-vocabulary widening put
// noodles, rice and olives there. This arm exists so that coupling can never again move
// without a test noticing.
// hasWord()/hasWordOrPlural() share ONE compiled RegExp per word across every call, so
// that a 14,148-name sweep compiles each pattern once instead of once per name. That is
// only sound while the patterns stay non-global: `.test()` advances `lastIndex` under `g`
// or `y`, and a shared stateful regex would then return alternating answers for the same
// input. This is the test that catches it — a `g` added to wordRe() fails here and
// nowhere else in the suite, because every other test calls each pattern once.
test("repeated matching is stateless — a shared compiled pattern cannot drift", () => {
  const cases = [
    ["Almonds", "almond"], ["Tahina", "sesame"], ["Miniature Marshmallows", "shellfish"],
    ["Vegan kimchi", "fish"], ["Cheese, Cheddar", "dairy"], ["Corn Tortillas", "gluten"],
  ];
  for (const [name, term] of cases) {
    const first = matchesExclusionTerm(name, term);
    for (let i = 0; i < 25; i++) {
      assert.equal(
        matchesExclusionTerm(name, term), first,
        `matchesExclusionTerm(${JSON.stringify(name)}, ${JSON.stringify(term)}) changed answer on ` +
          `call ${i + 2} (first said ${first}). A cached RegExp carrying the g or y flag keeps ` +
          `lastIndex between .test() calls — the compiled-pattern cache in dietaryFilter.js ` +
          `requires the "i" flag alone.`
      );
    }
  }
  // Same property through the style predicates, which reach the same cache.
  for (const style of ["vegetarian", "vegan", "carnivore"]) {
    for (const name of ["Thai Red Curry Paste", "Butter Beans", "Paella, NFS"]) {
      const first = excl(name, style);
      for (let i = 0; i < 10; i++) assert.equal(excl(name, style), first, `${style}/${name} drifted`);
    }
  }
});

// Unambiguous: a food with no animal content at all must never reach a carnivore pool.
const CARNIVORE_MUST_EXCLUDE = ["Butter Beans", "Almond Milk", "Egg Plants", "Paella Rice"];

test("carnivore excludes plant-only foods", () => {
  for (const name of CARNIVORE_MUST_EXCLUDE) {
    assert.equal(
      excl(name, "carnivore"), true,
      `"${name}" reached a CARNIVORE pool. carnivore is !isVeganAnimalProduct, so every ` +
        `widening of the vegan/vegetarian keyword sets narrows this one — check whether a ` +
        `keyword was just added to SLAUGHTER_OR_MARINE_KEYWORDS or the allergen vocabulary.`
    );
  }
});

// KNOWN OPEN DEFECT, asserted as-is so it cannot change silently.
//
// `carnivore` is `!isVeganAnimalProduct(name)` — "admit anything containing an animal
// product." That predicate cannot express "meat only", so a MIXED dish is admitted on
// its animal component while its plant bulk goes unseen. `Paella, NFS` is admitted for
// its shellfish; the rice is invisible.
//
// This is not a regression introduced by widening the marine vocabulary, but that
// widening did FLIP these rows: before, "Paella, NFS" was excluded from carnivore only
// because the filter did not recognise it as animal-derived at all — right answer,
// wrong reason. Now it is admitted for a reason that is true but incomplete. Both states
// are defective; neither is fixable without deciding what `carnivore` should key off
// (flesh + dairy, rather than the negation of the vegan set). That is a product
// decision, so this test pins current behaviour rather than asserting a preference.
const CARNIVORE_ADMITS_MIXED_DISHES = [
  "Paella, NFS", "Shellfish and noodles with tomato-based sauce",
  "Olive tapenade", "Candy, gummy", "Candies, nougat, with almonds",
];

test("KNOWN GAP: carnivore admits mixed dishes on their animal component alone", () => {
  for (const name of CARNIVORE_ADMITS_MIXED_DISHES) {
    assert.equal(
      excl(name, "carnivore"), false,
      `"${name}" is now EXCLUDED from carnivore. If that was deliberate — i.e. carnivore ` +
        `was rebased onto a flesh+dairy predicate — delete this test; it exists only to ` +
        `record the gap, not to defend it.`
    );
  }
});

test("vegetarian excludes everything a fish or shellfish allergy excludes", () => {
  for (const name of MARINE_OR_SLAUGHTER) {
    const allergen = matchesExclusionTerm(name, "fish") || matchesExclusionTerm(name, "shellfish");
    if (!allergen) continue; // covered by the slaughter case below, not this property
    assert.equal(
      excl(name, "vegetarian"), true,
      `"${name}" is excluded for a fish/shellfish allergy but admitted to a vegetarian pool. ` +
        `vegetarian must be a SUPERSET of the marine allergen vocabulary, not a shorter list.`
    );
  }
});

test("vegetarian excludes every slaughter- or marine-derived food", () => {
  for (const name of MARINE_OR_SLAUGHTER) {
    assert.equal(excl(name, "vegetarian"), true, `"${name}" reached a vegetarian pool`);
  }
});

test("vegan excludes everything vegetarian excludes (vegan ⊇ vegetarian)", () => {
  for (const name of [...MARINE_OR_SLAUGHTER, ...VEGETARIAN_MUST_KEEP]) {
    if (!excl(name, "vegetarian")) continue;
    assert.equal(
      excl(name, "vegan"), true,
      `"${name}" is excluded for vegetarian but admitted for vegan — the lattice is inverted.`
    );
  }
});

test("the lacto-ovo split does not over-exclude: plant and dairy/egg foods stay available to vegetarians", () => {
  for (const name of VEGETARIAN_MUST_KEEP) {
    assert.equal(
      excl(name, "vegetarian"), false,
      `"${name}" was excluded for vegetarian. Closing a leak by over-excluding is not a fix — ` +
        `a vegetarian pool that loses butter beans and cheddar is broken in the other direction.`
    );
  }
});

test("lacto-ovo foods ARE excluded for vegan (the split kept both sides)", () => {
  for (const name of ["Eggs, Grade A, Large", "Cheddar", "Greek yogurt, 0%", "Butter", "Honey"]) {
    assert.equal(excl(name, "vegan"), true, `"${name}" must be excluded for vegan`);
  }
});

// AUD-9-01. `matchesExclusionTerm("Tahini","sesame")` was true and
// `("Tahina","sesame")` was false, so two recipes naming "tahina sauce" in their
// own steps reached a sesame-allergic pool. The gate reads step prose by design.
test("sesame matches every transliteration present in the corpus", () => {
  for (const spelling of ["Tahini", "Tahina", "Tehina", "tahina sauce", "Serve with tahina cream sauce"]) {
    assert.equal(
      matchesExclusionTerm(spelling, "sesame"), true,
      `"${spelling}" did not match the sesame vocabulary. A spelling the corpus actually uses ` +
        `is not optional — it is the difference between an exclusion and an allergen on a plate.`
    );
  }
});

// ── Pescatarian (B13, 2026-08-20) ───────────────────────────────────────────
// The style is vegetarian's rule with the marine side restored, so its lattice
// position is: pescatarian-excludes ⊂ vegetarian-excludes, and the difference
// is EXACTLY the marine vocabulary. Asserted from both directions, on the same
// real-corpus names as the rest of this file.

test("everything pescatarian excludes, vegetarian excludes too (pescatarian ⊂ vegetarian)", () => {
  for (const name of [...MARINE_OR_SLAUGHTER, ...VEGETARIAN_MUST_KEEP]) {
    if (!excl(name, "pescatarian")) continue;
    assert.equal(
      excl(name, "vegetarian"), true,
      `"${name}" is excluded for pescatarian but admitted for vegetarian — the lattice is inverted.`
    );
  }
});

test("pescatarian PERMITS the marine foods vegetarian excludes — that is the whole point of the style", () => {
  for (const name of [
    "Thai Red Curry Paste", "Red Curry Paste", "Thai Green Curry Paste",
    "Shellfish, NFS", "Soup, bouillabaisse", "Paella, NFS", "Soup, bisque",
    "Worcestershire sauce", "Bonito flakes", "Kimchi", "Olive tapenade",
  ]) {
    assert.equal(
      excl(name, "pescatarian"), false,
      `"${name}" is marine-derived and must stay AVAILABLE to a pescatarian — ` +
        `if this fails, a marine term landed on the LAND side of the B13 partition.`
    );
  }
});

test("pescatarian still excludes land slaughter and land-animal derivatives", () => {
  for (const name of [
    "Chicken breast, cooked, skinless", "Ground Beef", "Bacon", "Turkey sausages",
    "Gelatin", "Lard", "Beef suet", "Miniature Marshmallows", "Christmas pudding",
    "Whale, muktuk", "Escargot",
  ]) {
    assert.equal(excl(name, "pescatarian"), true, `"${name}" reached a pescatarian pool`);
  }
});

test("pescatarian keeps everything vegetarian keeps (dairy, eggs, plants)", () => {
  for (const name of VEGETARIAN_MUST_KEEP) {
    assert.equal(
      excl(name, "pescatarian"), false,
      `"${name}" was excluded for pescatarian — over-exclusion on the lacto-ovo/plant side.`
    );
  }
});
