// ── dietaryFilter · gluten-free pasta must be visible to a celiac (H3) ──────
//
// `pasta` and `noodle` are gluten synonyms because their DEFAULT is wheat —
// the same reason `flour`, `tortilla` and `cereal` are. Those three got the
// gluten-free-grain adjacency guard in the Stage-2 sweep; the pasta nouns
// never did. Measured by W1-5 on the real 910-recipe library and reproduced
// here before fixing:
//
//     57 of 57 "High-Protein … with Lentil/Chickpea Pasta" recipes were
//     excluded from a celiac. 53 of them carry no gluten at all. Eight food
//     rows went with them — "Lentil pasta, dry", "Chickpea pasta, dry",
//     "Rice noodles", …
//
// That is the over-exclusion mirror of a leak, the same class b28bd17 fixed
// for free text: it deletes exactly the foods the user is supposed to eat, and
// on an already-thin restricted pool that is the difference between getting a
// plan and getting a refusal. The recipes involved are the library's best
// high-protein assets, hidden from the people who most need them. The celiac
// recipe pool goes 466 → 525 (+12.7%).
//
// WHY THE GUARD USES A SMALLER GRAIN LIST THAN `flour` DOES — this is the
// design decision, and the tests below pin it. "X flour" means flour milled
// FROM x; the qualifier IS the base, which is what makes bare adjacency safe
// there. "X noodles" carries no such promise: "Peanut noodles" and "Chestnut
// noodles" are wheat noodles in a sauce made of the thing, and "Potato
// noodles" (gnocchi, Schupfnudeln) are potato bound with WHEAT flour. Reusing
// GLUTEN_FREE_GRAINS wholesale was built and measured: it clears all four,
// trading H3's over-block for a LEAK, which is strictly worse. Both candidates
// recover the identical 8 food rows and 59 recipes on today's real data, so
// the narrow one costs nothing and closes four named leak paths.
//
// SCOPE, and it was measured rather than assumed. `gluten`'s synonym list also
// carries ~20 pasta SHAPE words (`penne`, `spaghetti`, `vermicelli`, `orzo`,
// `udon`, …), which stay unguarded — so "Red lentil penne pasta" and the real
// row "Vermicelli Rice Noodles" are still hidden. Extending the guard to ten of
// them was built and measured against the real library: it recovers 0 further
// food rows and 0 further recipes on top of this fix. That is new matching
// surface for no gain, so it is deliberately left out and recorded here instead
// of being quietly bundled in.
//
// Both directions are asserted. H5 existed precisely because only one
// direction was ever tested.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  matchesExclusionTerm,
  foodMatchesExclusionTerm,
  WORD_GUARDS,
  CATEGORY_SYNONYMS,
} = require("../src/lib/dietaryFilter.js");

test("H3: gluten-free pasta and noodles are visible to a celiac", () => {
  // The two real food rows the 57 recipes are built on.
  assert.equal(matchesExclusionTerm("Lentil pasta, dry", "gluten"), false);
  assert.equal(matchesExclusionTerm("Chickpea pasta, dry", "gluten"), false);
  // The real noodle rows.
  assert.equal(matchesExclusionTerm("Rice Noodles", "gluten"), false);
  assert.equal(matchesExclusionTerm("Flat Rice Noodles", "gluten"), false);
  assert.equal(matchesExclusionTerm("Brown Rice Noodle", "gluten"), false, "singular, as the row is actually spelled");
  assert.equal(matchesExclusionTerm("Rice noodles, cooked", "gluten"), false);
  assert.equal(matchesExclusionTerm("Long rice noodles, made from mung beans, cooked", "gluten"), false);
  // FDC's inverted comma form, the second shape the guard must recognise.
  assert.equal(matchesExclusionTerm("Noodles, rice, cooked", "gluten"), false);
  assert.equal(matchesExclusionTerm("Pasta, corn, dry", "gluten"), false);
  // Pulses sold as pasta that a FLOUR list never needed to name.
  assert.equal(matchesExclusionTerm("Edamame pasta", "gluten"), false);
  assert.equal(matchesExclusionTerm("Black bean pasta", "gluten"), false);
});

test("H3: THE LEAK GUARD — a qualifier that is an accompaniment, not a base, still excludes", () => {
  // This is the assertion that rules out the naive fix (reusing
  // GLUTEN_FREE_GRAINS, which contains peanut/almond/coconut/chestnut/potato).
  // Every one of these is a wheat product with a plant name attached, and a
  // celiac served any of them is a safety failure, not an inconvenience.
  assert.equal(matchesExclusionTerm("Peanut noodles", "gluten"), true, "peanut SAUCE on wheat noodles");
  assert.equal(matchesExclusionTerm("Chestnut noodles", "gluten"), true);
  assert.equal(matchesExclusionTerm("Almond pasta salad", "gluten"), true);
  assert.equal(matchesExclusionTerm("Potato noodles", "gluten"), true, "gnocchi/Schupfnudeln are potato bound with wheat flour");
  assert.equal(matchesExclusionTerm("Coconut noodles", "gluten"), true);
  // Soba: legally as little as 30% buckwheat, normally cut with wheat flour.
  // Standard celiac guidance is "avoid unless labelled gluten-free" — the same
  // reasoning the `cereal` guard uses for barley-malted corn flakes.
  assert.equal(matchesExclusionTerm("Soba noodles", "gluten"), true);
  assert.equal(matchesExclusionTerm("Buckwheat noodles", "gluten"), true, "names no wheat, would clear on bare adjacency");
  assert.equal(matchesExclusionTerm("Noodles, japanese, soba, dry", "gluten"), true, "the real row");
});

test("H3: ordinary wheat pasta is untouched — no real exclusion was narrowed", () => {
  assert.equal(matchesExclusionTerm("Pasta, dry", "gluten"), true, "the bare noun still means wheat");
  assert.equal(matchesExclusionTerm("Pasta, whole-wheat, dry", "gluten"), true);
  assert.equal(matchesExclusionTerm("Egg noodles", "gluten"), true);
  assert.equal(matchesExclusionTerm("Ramen noodles", "gluten"), true);
  assert.equal(matchesExclusionTerm("Chicken noodle soup", "gluten"), true);
  assert.equal(matchesExclusionTerm("Pasta primavera", "gluten"), true);
  assert.equal(matchesExclusionTerm("Pasta salad with chicken", "gluten"), true);
  // A GF grain merely PRESENT is not adjacency — the real row is a wheat-pasta
  // side dish, and the loose form would have cleared it.
  assert.equal(matchesExclusionTerm("Flavored rice and pasta mixture", "gluten"), true);
  // Naming a gluten grain overrides the guard outright, in either shape.
  assert.equal(matchesExclusionTerm("Rice and wheat pasta blend", "gluten"), true);
  assert.equal(matchesExclusionTerm("Pasta, corn and semolina, dry", "gluten"), true);
  assert.equal(matchesExclusionTerm("Seitan noodles with rice", "gluten"), true);
});

test("H3: the neighbouring guards did not move", () => {
  // `flour`/`tortilla`/`cereal` keep the WIDER list on purpose — "peanut flour"
  // and "almond flour" really are milled from the named thing. If these flip,
  // the narrower pasta list leaked sideways into the flour guard.
  assert.equal(matchesExclusionTerm("Peanut flour", "gluten"), false);
  assert.equal(matchesExclusionTerm("Almond flour", "gluten"), false);
  assert.equal(matchesExclusionTerm("Potato flour", "gluten"), false);
  assert.equal(matchesExclusionTerm("Corn Tortilla", "gluten"), false);
  assert.equal(matchesExclusionTerm("Rice Flour", "gluten"), false);
  assert.equal(matchesExclusionTerm("Wheat flour, white, tortilla mix", "gluten"), true);
  // And nothing here is allowed to touch another allergen category.
  assert.equal(matchesExclusionTerm("Egg noodles", "eggs"), true);
  assert.equal(matchesExclusionTerm("Peanut noodles", "peanuts"), true);
  assert.equal(matchesExclusionTerm("Lentil pasta, dry", "peanuts"), false);
});

test("H3: the plural synonym cannot bypass the singular's guard", () => {
  // CATEGORY_SYNONYMS.gluten carries "noodle" AND "noodles", and WORD_GUARDS is
  // keyed by the exact synonym string. This is exactly how "Tortillas,
  // ready-to-bake or -fry, corn" stayed excluded after the corn guard landed.
  assert.ok(CATEGORY_SYNONYMS.gluten.includes("noodle") && CATEGORY_SYNONYMS.gluten.includes("noodles"),
    "both spellings must be listed, or this test proves nothing");
  assert.ok(WORD_GUARDS.noodle && WORD_GUARDS.noodles, "the singular→plural mirror must have covered 'noodles'");
  assert.ok(WORD_GUARDS.pasta, "and 'pasta' must be guarded at all");
  assert.equal(matchesExclusionTerm("Rice noodles, dry", "gluten"), false, "the plural spelling clears too");
});

test("H3: the object-aware path agrees — a shelf label cannot re-hide a cleared row", () => {
  // The name guard and the coarse USDA-category probe are separate; "Cereal
  // Grains and Pasta" is declared gluten evidence, so a row cleared by name
  // would come straight back if the category probe were not already leashed.
  const row = { name: "Rice noodles, dry", fdcCategory: "Cereal Grains and Pasta" };
  assert.equal(foodMatchesExclusionTerm(row, "gluten"), false);
  // …and the leash is a NAME claim, not a blanket. A declared allergen tag is
  // the product telling us something its name did not, and it still wins.
  assert.equal(foodMatchesExclusionTerm({ ...row, allergenTags: ["gluten"] }, "gluten"), true,
    "a declared gluten tag outranks the name guard");
  assert.equal(foodMatchesExclusionTerm({ name: "Pasta, dry", fdcCategory: "Cereal Grains and Pasta" }, "gluten"), true);
});
