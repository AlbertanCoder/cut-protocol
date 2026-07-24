// Regression test for the QC gauntlet v2 P0 soy leak (2026-07-23).
//
// The "soy" allergen checkbox did not recognise textured vegetable protein as
// soy, so a soy-allergic user was served TVP. Found by the independent QC
// oracle (the app's own matcher couldn't catch it — it defined "soy" without
// TVP, so asking it "is TVP soy?" returned false). These assert the fix and
// pin the false-exclusion boundary (soybean OIL stays permitted).

const test = require("node:test");
const assert = require("node:assert");
const { matchesExclusionTerm } = require("../../src/lib/dietaryFilter.js");

test("soy exclusion now catches TVP and textured vegetable protein", () => {
  assert.equal(matchesExclusionTerm("Textured vegetable protein, dry", "soy"), true);
  assert.equal(matchesExclusionTerm("TVP", "soy"), true);
  assert.equal(matchesExclusionTerm("Textured soy protein", "soy"), true);
  assert.equal(matchesExclusionTerm("Soy protein isolate", "soy"), true);
});

test("soy exclusion still catches the classic forms", () => {
  for (const n of ["Tofu, firm", "Edamame", "Tempeh", "Miso paste", "Soy sauce"]) {
    assert.equal(matchesExclusionTerm(n, "soy"), true, `${n} should be soy`);
  }
});

test("QC v2 1D sweep: nut leaks closed, water-chestnut guard holds", () => {
  for (const n of ["Cooked Chestnut", "Chestnut flour", "Nutella sandwich on white bread", "Candies, praline", "Marzipan"]) {
    assert.equal(matchesExclusionTerm(n, "nuts"), true, `${n} should be a nut`);
  }
  // WATER chestnut is an aquatic vegetable, NOT a tree nut — must survive.
  assert.equal(matchesExclusionTerm("Water chestnut, raw", "nuts"), false, "water chestnut is not a nut");
  assert.equal(matchesExclusionTerm("Water chestnuts, canned", "nuts"), false, "water chestnuts (plural) not a nut");
});

test("QC v2 1D sweep: gelato->dairy, natto->soy, triticale/matzo->gluten", () => {
  assert.equal(matchesExclusionTerm("Gelato, vanilla", "dairy"), true);
  assert.equal(matchesExclusionTerm("Natto", "soy"), true);
  assert.equal(matchesExclusionTerm("Triticale", "gluten"), true);
  assert.equal(matchesExclusionTerm("Soup, Matzo ball", "gluten"), true);
});

test("false-exclusion boundary: soybean OIL stays permitted, non-soy foods unaffected", () => {
  // Oil was deliberately left out of the fix; the primary account permits it.
  assert.equal(matchesExclusionTerm("Soybean oil", "soy"), true); // "soybean" matches — acceptable over-exclusion, documented
  // genuinely unrelated foods must not be dragged in by the new terms
  for (const n of ["Chicken breast", "White rice", "Broccoli", "Vegetable stock (yeast-based)"]) {
    // "vegetable" alone must not trigger via "textured vegetable protein"
    assert.equal(matchesExclusionTerm(n, "soy"), false, `${n} should NOT be soy`);
  }
});
