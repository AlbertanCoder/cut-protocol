// Regression + drift-guard for the QC persona tree-nut finding (2026-07-23).
//
// The UI's tree-nut checkbox sends the key "tree nuts". That list had drifted
// out of sync with the internal "nuts" list — chestnut and nutella were in
// "nuts" but missing from "tree nuts" — so an anaphylactic tree-nut user was
// served "Cooked Chestnut" (a real recipe ingredient). These assert the fix and
// pin the two lists together so they can never silently diverge again.
const test = require("node:test");
const assert = require("node:assert");
const { matchesExclusionTerm } = require("../../src/lib/dietaryFilter.js");

const CRITICAL = ["Cooked Chestnut", "Chestnut flour", "Nutella", "Almonds", "Walnuts", "Cashew", "Pecan", "Pistachio", "Hazelnut", "Macadamia", "Praline", "Marzipan", "Brazil nut", "Pine nut"];

test("the UI's 'tree nuts' key catches every critical tree nut", () => {
  for (const n of CRITICAL) {
    assert.equal(matchesExclusionTerm(n, "tree nuts"), true, `"${n}" must be caught by 'tree nuts'`);
  }
});

test("water chestnut still survives 'tree nuts' (it is not a nut)", () => {
  assert.equal(matchesExclusionTerm("Water chestnut, raw", "tree nuts"), false);
  assert.equal(matchesExclusionTerm("Water chestnuts, canned", "tree nuts"), false);
});

test("drift guard: 'tree nuts' and 'nuts' agree on every tree-nut term", () => {
  // Whatever one key catches as a tree nut, the other must too — this is the
  // exact divergence that caused the leak.
  const probes = ["Cooked Chestnut", "Nutella", "Almonds", "Praline", "Marzipan", "Gianduja", "Brazil nut", "Pine nut", "Hazelnut", "Cashew"];
  for (const n of probes) {
    assert.equal(
      matchesExclusionTerm(n, "tree nuts"), matchesExclusionTerm(n, "nuts"),
      `"${n}" disagrees between 'tree nuts' and 'nuts' — the lists have drifted again`
    );
  }
});
