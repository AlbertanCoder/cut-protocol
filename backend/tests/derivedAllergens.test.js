// derivedAllergens.test.js — the directive's §12 derived-ingredient table,
// asserted against the LIVE filter (CUT_PROTOCOL_DIRECTIVE.md
// test_derived_allergens, mapped to JS per docs/BLOCKERS.md B1).
//
// The failures this class of test guards live in the derivatives: soy sauce
// is wheat-brewed, oyster sauce is a mollusc AND wheat-thickened, tamari is
// soy always and gluten-ambiguous unless the label says otherwise. Every row
// here was probed against the shipped filter on 2026-08-19 before the
// tamari/shoyu/ponzu gluten keywords were added (docs/AUDIT.md §5.4).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesExclusionTerm } = require("../src/lib/dietaryFilter");

test("soy sauce trips gluten AND soy — one food, two walls", () => {
  assert.equal(matchesExclusionTerm("Soy Sauce", "soy"), true);
  assert.equal(matchesExclusionTerm("Soy Sauce", "gluten"), true);
});

test("oyster sauce trips shellfish (mollusc) AND gluten (wheat-thickened)", () => {
  assert.equal(matchesExclusionTerm("Oyster Sauce", "shellfish"), true);
  assert.equal(matchesExclusionTerm("Oyster Sauce", "gluten"), true);
});

test("tamari always trips soy", () => {
  assert.equal(matchesExclusionTerm("Tamari", "soy"), true);
  assert.equal(matchesExclusionTerm("Gluten-Free Tamari", "soy"), true,
    "a gluten claim says nothing about soy — tamari IS soy");
});

test("tamari is denied-as-ambiguous for gluten unless the name carries the regulated GF claim", () => {
  assert.equal(matchesExclusionTerm("Tamari", "gluten"), true,
    "trace-wheat tamari exists; unlabelled tamari is denied for a gluten profile");
  assert.equal(matchesExclusionTerm("Tamari Sauce", "gluten"), true);
  assert.equal(matchesExclusionTerm("Gluten-Free Tamari", "gluten"), false,
    "the regulated free-from claim in the product's own name clears the gluten probe");
});

test("shoyu and ponzu are wheat-brewed soy sauce — both walls, like their parent", () => {
  for (const n of ["Shoyu Chicken", "Ponzu Sauce"]) {
    assert.equal(matchesExclusionTerm(n, "soy"), true, `${n} must trip soy`);
    assert.equal(matchesExclusionTerm(n, "gluten"), true, `${n} must trip gluten`);
  }
});

test("coconut aminos trip NOTHING — the rescue must not be a leak", () => {
  for (const term of ["soy", "gluten", "tree nuts"]) {
    assert.equal(matchesExclusionTerm("Coconut Aminos", term), false,
      `coconut aminos must stay clean for ${term} — it is the §3.3.3 rescue ingredient`);
  }
});

test("seitan is pure wheat gluten; malt vinegar is barley — both trip gluten", () => {
  assert.equal(matchesExclusionTerm("Seitan Stir-Fry", "gluten"), true);
  assert.equal(matchesExclusionTerm("Malt Vinegar", "gluten"), true);
});

test("rice paper — the wheat-wrap rescue — stays clean for gluten", () => {
  assert.equal(matchesExclusionTerm("Rice Paper Wraps", "gluten"), false);
});

test("surimi is fish-based and frequently carries crustacean extract — denied under BOTH", () => {
  assert.equal(matchesExclusionTerm("Surimi Sticks", "fish"), true);
  assert.equal(matchesExclusionTerm("Surimi Sticks", "shellfish"), true);
});

test("fish sauce and worcestershire are FISH (anchovy), modelled separately from shellfish", () => {
  assert.equal(matchesExclusionTerm("Fish Sauce", "fish"), true);
  assert.equal(matchesExclusionTerm("Worcestershire Sauce", "fish"), true);
});

test("a colloquial 'shellfish' exclusion denies the whole umbrella — crustaceans and molluscs", () => {
  for (const n of ["Shrimp Paste", "Crab Cakes", "Lobster Bisque"]) {
    assert.equal(matchesExclusionTerm(n, "shellfish"), true, `${n} (crustacean) must be denied`);
  }
  for (const n of ["Oyster Sauce", "Grilled Squid", "Steamed Mussels", "Clam Chowder"]) {
    assert.equal(matchesExclusionTerm(n, "shellfish"), true, `${n} (mollusc) must be denied`);
  }
});
