// ── L1 · the leaf ships under its commoner name (T-2 sweep, 2026-08-02) ────
//
// `allergenTaxonomy.js`'s cilantro entry records the original incident in its own
// note: "a customer typed 'cilantro' and was served 'Coriander Leaves', the same
// plant under its other name (campaign persona p002)."
//
// The fix for that added `coriander leaf`, `coriander leaves` and `fresh
// coriander` — and stopped. The corpus writes the fresh leaf as bare
// **`Coriander`**, in 54 recipes, more than every explicit leaf spelling in the
// library combined. So the row the aversion is actually about went on shipping.
//
// Measured by the T-2 leak sweep on the real library: all 13 cilantro personas
// exposed, 198 offers across 44 recipes — including p002, the persona the note
// is about. This is a third species of failure, distinct from T-1 (absence of
// metadata read as safety) and T-3 (documented knowledge that never became
// code): **a fix applied to the spelling that was reported, while the commoner
// spelling of the same food kept shipping.**
//
// THE SEED IS NOT THE AVERSION and must stay visible. The taxonomy note is
// explicit: "ground coriander is a different flavour compound and is not what
// the aversion is to". The corpus separates them cleanly by energy — leaf rows
// are 23 kcal, seed rows 298 — but a NAME matcher cannot read kcal, so the guard
// keys on the seed words the seed rows actually use, and a leaf marker always
// wins outright.
//
// What these tests would catch: losing the bare-name match (the leak returns);
// over-correcting so the seed forms get swallowed (3 + 2 real recipes lose an
// ingredient they are entitled to); and a seed word elsewhere in a string
// standing down a row that names the leaf.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesExclusionTerm } = require("../src/lib/dietaryFilter.js");
const { ALLERGEN_BY_KEY } = require("../src/lib/allergenTaxonomy.js");

test("L1: the bare name is the leaf, and it is excluded", () => {
  // The leak itself. 54 recipes in the real library carry this exact row.
  assert.equal(matchesExclusionTerm("Coriander", "cilantro"), true);
});

test("L1: every leaf spelling in the corpus is excluded", () => {
  for (const name of [
    "Cilantro",
    "Cilantro Leaves",
    "Coriander Leaves",
    "Coriander (cilantro) leaves, raw",
    "Cilantro, raw",
    "Fresh coriander, chopped",
    // Dried LEAF — still the leaf compound, and the seed veto must not reach it.
    "Spices, coriander leaf, dried",
  ]) {
    assert.equal(matchesExclusionTerm(name, "cilantro"), true, `${name} is the leaf`);
  }
});

test("L1: the SEED stays visible — it is a different compound, not the aversion", () => {
  // Over-correcting here would be its own defect: these are 3 and 2 real recipes
  // whose users are entitled to the spice.
  assert.equal(matchesExclusionTerm("Ground Coriander", "cilantro"), false);
  assert.equal(matchesExclusionTerm("Coriander Seeds", "cilantro"), false);
  assert.equal(matchesExclusionTerm("Coriander Seed", "cilantro"), false);
  assert.equal(matchesExclusionTerm("Coriander powder", "cilantro"), false);
  // A seed blend, not a leaf: the library's sazon row.
  assert.equal(matchesExclusionTerm("Seasoning mix, dry, sazon, coriander & annatto", "cilantro"), false);
});

test("L1: a leaf marker beats a seed word in the same string", () => {
  // Ordering matters. If the seed veto were checked first, a row naming the leaf
  // could be stood down by an unrelated seed mention — the leak in a new costume.
  assert.equal(matchesExclusionTerm("Coriander leaf, with coriander seeds", "cilantro"), true);
  assert.equal(matchesExclusionTerm("Fresh coriander and ground coriander salad", "cilantro"), true);
});

test("L1: unrelated foods are untouched", () => {
  assert.equal(matchesExclusionTerm("Chicken breast, cooked", "cilantro"), false);
  assert.equal(matchesExclusionTerm("Parsley, fresh", "cilantro"), false);
  assert.equal(matchesExclusionTerm("Cumin, ground", "cilantro"), false);
});

test("L1: the bare keyword is declared in the taxonomy, not hidden in the matcher", () => {
  // The vocabulary belongs in the taxonomy; the matcher only guards it. If
  // someone removes the keyword, the guard alone must not silently keep the
  // behaviour alive somewhere else.
  const kws = ALLERGEN_BY_KEY.cilantro.nameKeywords;
  assert.ok(kws.includes("coriander"), "bare 'coriander' must be a declared cilantro keyword");
  assert.ok(kws.includes("coriander leaves"), "the explicit leaf spellings stay");
});
