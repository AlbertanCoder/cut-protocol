// ── Cross-reactive allergens: prose the code can read (T-3) ──────────────
//
// `allergenTaxonomy.js`'s lupin entry has always said:
//
//     "EU-declarable. Cross-reacts strongly with peanut; common in gluten-free
//      bakery flour blends."
//
// That is a real clinical fact, written in a `note` field, which nothing
// consumed. Measured on the real DB by the 2026-07-31 fleet and reproduced
// before this fix: `foodMatchesExclusionTerm(lupin, "peanuts") === false` — a
// peanut-allergic user was not protected from lupin, while the control term
// "lupin" matched fine. Three lupin rows are in the library today. They are
// currently unreferenced by any recipe, which is why this was filed P1-latent
// rather than P0 — but lupin flour lives in exactly the gluten-free bakery
// blends a careful eater reaches for, so the moment one is imported it is live.
//
// The mechanism is `crossReactsInto` plus one consumer in `matchesExclusionTerm`.
//
// WHY DIRECTIONAL. Cross-reactivity is a claim about one direction. Mirroring it
// automatically would delete peanut foods from everyone who excluded lupin, for
// no clinical reason. The taxonomy's own `mango` entry makes the same argument
// from the other side — it documents a deliberate refusal to fold cashew and
// pistachio into "mango" because that "would silently delete two whole species".
// A rule that should protect both ways has to say so twice, with its own
// evidence. These tests pin the direction so a later edit cannot quietly mirror
// it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesExclusionTerm, CATEGORY_SYNONYMS } = require("../src/lib/dietaryFilter.js");
const { CROSS_REACTANTS, ALLERGEN_BY_KEY } = require("../src/lib/allergenTaxonomy.js");

test("T-3: a peanut exclusion now carries lupin with it", () => {
  assert.equal(matchesExclusionTerm("Lupins, mature seeds, raw", "peanuts"), true,
    "the real DB row — a peanut-allergic user must not be served this");
  assert.equal(matchesExclusionTerm("Lupin flour", "peanuts"), true,
    "the gluten-free bakery blend case the taxonomy note calls out");
  assert.equal(matchesExclusionTerm("Lupini beans, pickled", "peanuts"), true,
    "synonym form");
});

test("T-3: the relation is DIRECTIONAL — excluding lupin does not exclude peanut", () => {
  // The failure mode of a careless fix: mirroring the relation and deleting
  // peanut foods from people who have no peanut allergy.
  assert.equal(matchesExclusionTerm("Peanut butter", "lupin"), false);
  assert.equal(matchesExclusionTerm("Peanuts, roasted, salted", "lupin"), false);
  assert.equal(matchesExclusionTerm("Satay sauce", "lupin"), false);
});

test("T-3: no collateral — the peanut category itself is unchanged", () => {
  assert.equal(matchesExclusionTerm("Peanut butter", "peanuts"), true, "direct");
  assert.equal(matchesExclusionTerm("Satay sauce", "peanuts"), true, "an existing synonym");
  assert.equal(matchesExclusionTerm("Almond butter", "peanuts"), false, "a different nut");
  assert.equal(matchesExclusionTerm("Chicken breast, cooked", "peanuts"), false, "unrelated food");
  assert.equal(matchesExclusionTerm("Lupins, mature seeds, raw", "lupin"), true, "lupin still matches itself");
});

test("T-3: the index is built from the taxonomy, not hardcoded in the filter", () => {
  // If someone deletes crossReactsInto from the entry, the behaviour must go
  // with it rather than surviving as a magic string somewhere in the matcher.
  assert.deepEqual(CROSS_REACTANTS.peanuts, ["lupin"]);
  assert.deepEqual(ALLERGEN_BY_KEY.lupin.crossReactsInto, ["peanuts"]);
  // And the target has to be a real category, or the consumer silently no-ops.
  assert.ok(Array.isArray(CATEGORY_SYNONYMS.lupin) && CATEGORY_SYNONYMS.lupin.length,
    "lupin must be a resolvable category for the cross-reaction to have anything to match");
});

test("T-3: every declared cross-reaction resolves — no dangling targets", () => {
  // A guard for whatever gets added next: a crossReactsInto pointing at a
  // category that does not exist would fail open and silently protect nobody.
  for (const [excluded, extras] of Object.entries(CROSS_REACTANTS)) {
    assert.ok(CATEGORY_SYNONYMS[excluded], `${excluded} is not a known category key`);
    for (const e of extras) {
      assert.ok(CATEGORY_SYNONYMS[e], `${excluded} -> ${e}: "${e}" is not a known category key`);
    }
  }
});
