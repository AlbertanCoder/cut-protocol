// preferenceBias — the soft taste multiplier the fleet showed was missing
// (2026-08-20: mediterranean got Tex-Mex, picky eaters got a world tour,
// spice lovers got nothing hot in two days).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPreferenceBias } = require("../../src/lib/prescription/preferenceBias.js");

const dish = (over = {}) => ({ name: "Grilled Chicken Plate", cuisine: null, ingredients: [{}, {}, {}, {}], ...over });

test("no preferences expressed → no bias function at all", () => {
  assert.equal(buildPreferenceBias({}), null);
  assert.equal(buildPreferenceBias({ cuisinePreferences: [], mealPreferencesNote: "" }), null);
  assert.equal(buildPreferenceBias(null), null);
});

test("explicit cuisine preference boosts matches, penalises other TAGGED cuisines, leaves untagged neutral", () => {
  const bias = buildPreferenceBias({ cuisinePreferences: ["mexican", "thai"] });
  assert.ok(bias(dish({ cuisine: "mexican" })) > 1, "preferred cuisine pulls");
  assert.ok(bias(dish({ cuisine: "chinese" })) < 1, "non-preferred tagged cuisine yields");
  assert.equal(bias(dish({ cuisine: null })), 1, "untagged recipes (most of the pool) stay neutral");
});

test("a mediterranean DIETARY STYLE implies a softer mediterranean pull — explicit prefs override it", () => {
  const implied = buildPreferenceBias({ dietaryStyle: "mediterranean" });
  assert.ok(implied, "the style alone is a preference signal");
  const med = implied(dish({ cuisine: "mediterranean" }));
  const tex = implied(dish({ cuisine: "tex-mex" }));
  assert.ok(med > 1 && tex < 1, `mediterranean pulls (${med}) and tex-mex yields (${tex})`);

  const explicit = buildPreferenceBias({ dietaryStyle: "mediterranean", cuisinePreferences: ["indian"] });
  assert.ok(explicit(dish({ cuisine: "indian" })) > explicit(dish({ cuisine: "mediterranean" })), "an explicit pick beats the implied one");
});

test("a plain/picky note steers toward short ingredient lists and away from heat", () => {
  const bias = buildPreferenceBias({ mealPreferencesNote: "picky eater — plain, familiar food only" });
  assert.ok(bias(dish({ ingredients: new Array(12).fill({}) })) < 1, "12-row dishes yield");
  assert.ok(bias(dish({ ingredients: new Array(4).fill({}) })) > 1, "4-row dishes pull");
  assert.ok(bias(dish({ name: "Jamaican Curry Shrimp" })) < 1, "spicy names yield for plain eaters");
});

test("a spicy note pulls spicy-named dishes", () => {
  const bias = buildPreferenceBias({ mealPreferencesNote: "I love spicy food" });
  assert.ok(bias(dish({ name: "Chipotle Chicken Bowl" })) > 1);
  assert.equal(bias(dish()), 1, "everything else stays neutral");
});

test("it is a multiplier, never a veto — nothing reaches zero", () => {
  const bias = buildPreferenceBias({ cuisinePreferences: ["mexican"], mealPreferencesNote: "plain picky" });
  const worst = bias(dish({ cuisine: "thai", name: "Spicy Sichuan Hotpot", ingredients: new Array(14).fill({}) }));
  assert.ok(worst > 0, `worst case must stay positive, got ${worst}`);
});

test("'I dislike fish' in the note steers away from fish dishes through the allergen vocabulary", () => {
  // ~20 fleet reviews: the only way to keep fish off the plate was to lie
  // and call it an allergy. The note carries it now — softly, not a veto.
  const bias = buildPreferenceBias({ mealPreferencesNote: "I dislike fish" });
  assert.ok(bias, "a dislike alone is a preference signal");
  const haddock = bias(dish({ name: "Smoked Haddock & Pea Rice Bowl", ingredients: [{ food: { name: "Smoked Haddock" } }, { food: { name: "White rice, cooked" } }] }));
  assert.ok(haddock < 0.5, `haddock must yield hard for a fish-disliker, got ${haddock}`);
  const chicken = bias(dish({ name: "Grilled Chicken Plate", ingredients: [{ food: { name: "Chicken breast, cooked, skinless" } }] }));
  assert.equal(chicken, 1, "non-fish dishes stay neutral");
  assert.ok(haddock > 0, "a dislike is never a veto");
});

test("dislike parsing reads verbs, not stray words", () => {
  assert.equal(buildPreferenceBias({ mealPreferencesNote: "fish is fine actually" }), null, "no dislike verb, no signal");
  const b = buildPreferenceBias({ mealPreferencesNote: "hates mushrooms, no onions" });
  const shroom = b(dish({ name: "Creamy Mushroom Skillet", ingredients: [{ food: { name: "Mushrooms, white, raw" } }] }));
  assert.ok(shroom < 0.5, `mushroom dish must yield, got ${shroom}`);
});
