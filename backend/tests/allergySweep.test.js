// Tier-1 close-out (audit C1): per-allergy regression sweep over the REAL
// recipe pool — the exhaustive check the audit demanded ("per-allergy
// regression tests that sweep the full food table like the Phase 4 audit
// did"). Unlike the synthetic pools in dietaryFilter.test.js (kept
// deliberately fixture-independent), this suite MUST track the real corpus:
// its whole job is to prove that no ingredient name that actually ships can
// reach a plate against a declared allergy, and to catch drift the moment
// seed data or synonym lists change.
//
// Ground truth: the family ORACLES below are maintained independently of
// CATEGORY_SYNONYMS on purpose — they mirror the vegan-side keyword lists
// (hardened by Phase 4's 854-name audit) classified per allergy family.
// C1's root cause was exactly this two-list drift: the style lists knew
// species the allergy lists didn't. If someone extends the style lists
// without extending the allergy lists, the oracle test here goes red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesExclusionTerm } = require("../src/lib/dietaryFilter.js");

// Real corpus: every unique ingredient name in the shipped recipe library +
// the tier-1 food seed (dynamic import — the data files are ESM).
const corpusPromise = Promise.all([
  import("../src/lib/portedFromRecomp/recipeLibrary.mjs"),
  import("../src/lib/portedFromRecomp/foodLibrary.mjs"),
]).then(([{ RECIPES }, { TIER1_FOODS }]) => {
  const names = new Set();
  for (const r of RECIPES) for (const ing of r.ingredients || []) names.add(ing.name);
  for (const f of TIER1_FOODS) names.add(f.name);
  return [...names];
});

// Family oracles: what each allergy category MUST catch.
const ORACLES = {
  fish: [
    "salmon", "tuna", "fish", "cod", "tilapia", "halibut", "trout", "mackerel",
    "sardine", "pilchard", "anchovy", "anchovies", "herring", "kipper",
    "haddock", "sole", "plaice", "bass", "snapper", "bream", "monkfish",
    "swordfish", "mahi", "pollock", "perch", "pike", "carp", "eel", "hake",
    "sprat", "whitebait", "barramundi", "grouper", "turbot", "flounder",
    "mullet", "catfish", "skate", "dogfish", "pomfret", "milkfish",
    "tilefish", "wahoo", "marlin", "caviar", "roe", "surimi",
    "fish sauce", "dashi", "bonito",
  ],
  shellfish: [
    "shrimp", "scallop", "prawn", "crab", "lobster", "mussel", "clam",
    "oyster", "crayfish", "crawfish", "squid", "calamari", "octopus",
    "cuttlefish", "conch", "whelk", "cockle", "oyster sauce", "shrimp paste",
  ],
  dairy: [
    "cheese", "yogurt", "yoghurt", "whey", "casein", "ghee", "skyr", "kefir",
    "quark", "curd", "buttermilk", "custard", "milk powder",
    "mozzarella", "cheddar", "parmesan", "feta", "ricotta", "brie", "gouda",
    "halloumi", "mascarpone", "paneer", "stilton", "gorgonzola", "camembert",
    "gruyere", "gruyère", "edam", "emmental", "manchego", "pecorino",
    "provolone", "burrata", "queso", "creme fraiche", "crème fraîche",
    "dulce de leche", "white chocolate", "milk chocolate",
  ],
  eggs: ["egg", "eggs", "mayonnaise", "custard", "aioli", "aïoli", "meringue", "hollandaise"],
};

// Same word/phrase semantics the filter itself uses: word-boundary with s/es
// plural tolerance for single words, substring for fixed phrases.
function oracleHits(name, kw) {
  if (kw.includes(" ")) return name.toLowerCase().includes(kw);
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "(?:es|s)?\\b", "i").test(name);
}

test("every family-oracle keyword is caught by its allergy category (no two-list drift)", () => {
  for (const [cat, kws] of Object.entries(ORACLES)) {
    const missed = kws.filter((kw) => !matchesExclusionTerm(kw, cat));
    assert.deepEqual(missed, [], `${cat} allergy category fails to catch oracle keywords: ${missed.join(", ")}`);
  }
});

test("real-corpus sweep: no oracle-flagged ingredient name survives its allergy filter", async () => {
  const names = await corpusPromise;
  assert.ok(names.length > 900, `corpus unexpectedly small (${names.length}) — seed data moved?`);
  for (const [cat, kws] of Object.entries(ORACLES)) {
    const leaks = names.filter((n) => kws.some((kw) => oracleHits(n, kw)) && !matchesExclusionTerm(n, cat));
    assert.deepEqual(leaks, [], `${cat}: allergen ingredient(s) would reach the plate: ${leaks.join(" · ")}`);
  }
});

test("regression: the last live leak — White Chocolate Chips under a dairy allergy", async () => {
  const names = await corpusPromise;
  assert.ok(names.includes("White Chocolate Chips"), "fixture guard: corpus no longer contains White Chocolate Chips — update this test's subject");
  assert.ok(matchesExclusionTerm("White Chocolate Chips", "dairy"), "white chocolate is cocoa butter + milk solids; it must be excluded under dairy");
});

test("safe foods still survive the expanded lists (over-exclusion has limits)", () => {
  // Plant foods a dairy-allergic person can eat — the compound guards.
  assert.ok(!matchesExclusionTerm("Almond milk, unsweetened", "dairy"), "almond milk is not dairy");
  assert.ok(!matchesExclusionTerm("Coconut cream", "dairy"), "coconut cream is not dairy");
  assert.ok(!matchesExclusionTerm("Peanut Butter", "dairy"), "peanut butter is not dairy");
  assert.ok(!matchesExclusionTerm("Cream of tartar", "dairy"), "cream of tartar is not dairy");
  // The soy-protein scope: oil stays permitted (the original account's rule).
  assert.ok(!matchesExclusionTerm("Soybean oil", "soy protein"), "'soy protein' must not exclude soybean oil");
  // Category expansion stays scoped (Stage-C design decision).
  assert.ok(!matchesExclusionTerm("Curry Powder", "shellfish"), "curry powder has no shellfish link");
  assert.ok(!matchesExclusionTerm("Curry Powder", "fish"), "curry powder has no fish link");
  // New fish terms must not swallow unrelated words ("bass" is word-bounded).
  assert.ok(!matchesExclusionTerm("Basil, fresh", "fish"), "basil must not match 'bass'");
});

test("new dairy carriers are excluded as intended (butter/cream confections, yogurt breads)", () => {
  for (const name of ["Toffee Popcorn", "Caramel Sauce", "Naan Bread", "Burrata"]) {
    assert.ok(matchesExclusionTerm(name, "dairy"), `${name} carries dairy by standard recipe and must be excluded`);
  }
});
