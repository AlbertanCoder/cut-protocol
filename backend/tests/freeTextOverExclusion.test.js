// ── dietaryFilter · free-text terms must not match inside other words (H5) ──
//
// The over-exclusion mirror of a leak. `matchesExclusionTerm`'s fallback branch
// — the one reached only by terms with NO synonymKey, i.e. unrecognised free
// text a user typed — matched by bare substring:
//
//     "oats"  normalises to "oat"   → matched "G-oat- cheese"
//     "rape"                        → matched "G-rape- juice"
//
// Found by W3-6 while authoring vegan snacks. It is not a cosmetic bug: it hides
// food from people who can eat it, and on an already-thin restricted pool that is
// the difference between getting a plan and getting a refusal. W1-5 measured the
// adjacent case at 57/57 gluten-free pasta recipes hidden from celiacs.
//
// THE FIX ANCHORS THE WORD START, NOT A FULL WORD BOUNDARY. That distinction is
// the whole design: a `\b…\b` rule would have "fixed" this while letting
// "Oatmeal" and "Oat flour" through to someone avoiding oats — trading an
// over-block for a LEAK, which is strictly worse. Prefix-at-word-start keeps
// every compound that matters and drops only the ones that were never the word.
//
// Both directions are asserted here on purpose. H5 exists because only one
// direction was ever tested.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesExclusionTerm, resolveExclusionTerm } = require("../src/lib/dietaryFilter.js");

test("H5: a free-text term does not match inside a longer word", () => {
  // The two cases W3-6 actually hit.
  assert.equal(matchesExclusionTerm("Goat cheese", "oats"), false, '"oat" is inside "goat" — a goat is not an oat');
  assert.equal(matchesExclusionTerm("Grape juice", "rape"), false, '"rape" is inside "grape"');
  assert.equal(matchesExclusionTerm("Scallions", "scallops"), false, "unrelated words that share letters");
});

test("H5: the fix must not become a leak — compounds at a word START still exclude", () => {
  // This is the assertion that rules out the naive \b…\b fix. Someone avoiding
  // oats must not be served oatmeal.
  assert.equal(matchesExclusionTerm("Oatmeal", "oats"), true, "oatmeal is oats");
  assert.equal(matchesExclusionTerm("Oat flour", "oats"), true, "oat flour is oats");
  assert.equal(matchesExclusionTerm("Oats, rolled", "oats"), true, "the exact word");
  assert.equal(matchesExclusionTerm("Rapeseed oil", "rape"), true, "rapeseed starts with rape");
});

test("H5: multi-word free-text phrases keep substring matching", () => {
  // Deliberate: "soy protein" is meant to catch the specific ingredient without
  // expanding to the whole soy category, and a phrase is specific enough not to
  // collide the way a bare word does.
  assert.equal(matchesExclusionTerm("Textured soy protein", "soy protein"), true);
  assert.equal(matchesExclusionTerm("Soup, stock cube, chicken", "stock cube"), true);
});

test("H5: the change is confined to the free-text branch — category terms are untouched", () => {
  // The guard on scope. These terms resolve to a synonymKey and therefore never
  // reach the fallback; if any of them regressed, the fix leaked into the
  // category path, which is where real allergens live.
  for (const term of ["butter", "nut", "sesame", "dairy", "peanuts", "corn"]) {
    assert.notEqual(resolveExclusionTerm(term).synonymKey, null,
      `${term} must resolve to a category — otherwise this test proves nothing`);
  }
  assert.equal(matchesExclusionTerm("Buttermilk", "butter"), true, "buttermilk IS dairy");
  assert.equal(matchesExclusionTerm("Peanut butter", "nut"), true, "tree-nut category behaviour unchanged");
  assert.equal(matchesExclusionTerm("Salad, contains sesame", "sesame"), true, "sesame category unchanged");
});

test("H5: unrecognised terms are still unrecognised — the fallback is reached at all", () => {
  // If "oats" ever gains a synonymKey, the tests above stop exercising the
  // branch they were written for and would pass for the wrong reason.
  assert.equal(resolveExclusionTerm("oats").synonymKey, null, "oats is free text, not a category");
  assert.equal(resolveExclusionTerm("oats").normalisedKey, "oat", "…and normalises to the singular that caused the collision");
});
