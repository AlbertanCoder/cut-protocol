// allergenSubstitutions.test.js — the rescue table, cross-checked against
// the REAL filter so a proposed substitution can never itself be a leak.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SUBSTITUTIONS, substitutionsFor } = require("../src/lib/allergenSubstitutions");
const { matchesExclusionTerm } = require("../src/lib/dietaryFilter");

test("the founding case: soy + wheat allergy, loves Chinese food — soy sauce becomes coconut aminos, NOT tamari", () => {
  const offers = substitutionsFor("soy sauce", ["soy", "gluten"]);
  assert.ok(offers.length >= 1, "the cuisine must be rescued, not gutted");
  assert.ok(offers.some((o) => o.use === "coconut aminos"));
  assert.ok(!offers.some((o) => /tamari/i.test(o.use)),
    "GF tamari is still soy — offering it to a soy allergy is a leak proposal");
});

test("gluten-only exclusion gets BOTH soy-sauce rescues — GF tamari is legal when soy is not excluded", () => {
  const offers = substitutionsFor("soy sauce", ["gluten"]);
  assert.ok(offers.some((o) => o.use === "coconut aminos"));
  assert.ok(offers.some((o) => o.use === "gluten-free tamari"));
});

test("shellfish profile on oyster sauce: the mushroom rescue is offered — unless the profile also excludes what it still carries", () => {
  assert.ok(substitutionsFor("oyster sauce", ["shellfish"]).length >= 1);
  assert.deepEqual(substitutionsFor("oyster sauce", ["shellfish", "soy"]), [],
    "commercial mushroom stir-fry sauce is soy-based; a shellfish+soy profile gets no false rescue");
});

test("an ingredient the profile does not exclude yields no offers — substitution is need-driven", () => {
  assert.deepEqual(substitutionsFor("soy sauce", ["kiwi"]), []);
  assert.deepEqual(substitutionsFor("olive oil", ["soy", "gluten"]), []);
});

test("PROPERTY: every offered rescue passes the real filter for everything it claims not to trip", () => {
  const CHECKABLE = ["soy", "gluten", "shellfish", "fish", "dairy", "eggs", "peanuts", "tree nuts", "sesame"];
  for (const s of SUBSTITUTIONS) {
    for (const term of CHECKABLE) {
      if (s.stillTrips.includes(term)) continue; // declared residue — callers filter on it
      if (term === "tree nuts" && /coconut/i.test(s.use)) {
        // Coconut's tree-nut status is a repo-level decision (currently clean);
        // assert the CURRENT behaviour so a future flip is a loud choice.
        assert.equal(matchesExclusionTerm(s.use, term), false,
          `${s.use}: coconut flipped to tree-nut — revisit every coconut rescue`);
        continue;
      }
      assert.equal(matchesExclusionTerm(s.use, term), false,
        `"${s.use}" (rescue for ${s.label}) trips ${term} in the real filter but does not declare it in stillTrips`);
    }
  }
});

test("PROPERTY: everything a rescue DOES declare in stillTrips, the real filter agrees on where it can see it", () => {
  // The declaration is the contract the offer-filter runs on. Where the
  // filter can already see the residue from the name alone, they must agree
  // (gluten-free tamari IS soy and the filter knows it). Residues the name
  // cannot reveal (mushroom sauce's soy base) are exactly why stillTrips
  // exists as curated knowledge on top of the name filter.
  const visible = SUBSTITUTIONS.filter((s) => /tamari/i.test(s.use));
  assert.ok(visible.length >= 1);
  for (const s of visible) {
    assert.ok(s.stillTrips.includes("soy"));
    assert.equal(matchesExclusionTerm(s.use, "soy"), true,
      `${s.use} must trip soy in the real filter — the declaration and the filter agree`);
  }
});
