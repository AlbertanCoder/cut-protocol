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
const {
  matchesExclusionTerm,
  foodMatchesExclusionTerm,
  adjusterExcludedByStyle,
  expandCompoundTokens,
  COMPOUND_TOKENS,
  COMPOUND_FALSE_FRIENDS,
} = require("../src/lib/dietaryFilter.js");

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
    // Compound/generic carrier: Thai curry paste standardly contains fish
    // sauce and/or shrimp paste (see dietaryFilter.js's curry-paste note).
    "curry paste",
  ],
  shellfish: [
    "shrimp", "scallop", "prawn", "crab", "lobster", "mussel", "clam",
    "oyster", "crayfish", "crawfish", "squid", "calamari", "octopus",
    "cuttlefish", "conch", "whelk", "cockle", "oyster sauce", "shrimp paste",
    // Compound/generic carrier with no species word: Thai curry paste is made
    // with shrimp paste (kapi). This app's own vegan filter already treats it
    // as animal-derived; the shellfish allergy must too.
    "curry paste",
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

// Compound/generic-ingredient allergy gap (patch 02 / PABLO_REVIEW §2.5):
// generic blended-product names that carry an allergen with no species/category
// word in the name defeat literal category matching. This sweep asserts every
// such term the audit named is now treated as containing its allergen, erring
// toward over-exclusion (the safe direction for a declared allergy).
test("compound/generic product names are caught by their allergen category (patch 02 sweep)", () => {
  // [ingredient name, allergy category] — each MUST be excluded.
  const mustCatch = [
    ["Frozen Seafood mix", "shellfish"],   // the confirmed live leak
    ["Mixed Seafood Medley", "shellfish"],
    ["Seafood stock", "shellfish"],
    ["Surimi sticks", "shellfish"],
    ["Thai Red Curry Paste", "shellfish"], // shrimp paste (kapi) — the newly-closed gap
    ["Red Curry Paste", "shellfish"],
    ["Thai Green Curry Paste", "shellfish"],
    ["Thai Red Curry Paste", "fish"],      // fish sauce / shrimp paste
    ["Green Curry Paste", "fish"],
    ["Chicken Stock Cube", "gluten"],      // hidden wheat filler
    ["Beef Bouillon", "gluten"],
    ["Instant Gravy Mix", "gluten"],
    ["Chicken Stock Cube", "soy"],         // hidden hydrolyzed-soy filler
    ["Beef Bouillon", "soy"],
    ["Mixed Nuts", "tree nuts"],
    ["Trail Mix", "tree nuts"],
    ["Mixed Nuts", "nuts"],
  ];
  for (const [name, cat] of mustCatch) {
    assert.ok(matchesExclusionTerm(name, cat), `"${name}" must be excluded under a ${cat} allergy (compound/generic carrier)`);
  }
});

// The over-exclusion must stay SCOPED — the audit measured that treating every
// blended/compound product as ambiguous for every allergen newly excluded 38
// recipes (36 via curry POWDER / five-spice, which carry no established
// allergen). Curry PASTE is caught (shrimp paste); curry POWDER is not.
test("compound expansion stays scoped: curry POWDER / spice blends are NOT flagged for shellfish or fish", () => {
  for (const name of ["Curry Powder", "Jamaican Curry Powder", "Five Spice Powder", "Madras Curry Powder"]) {
    assert.ok(!matchesExclusionTerm(name, "shellfish"), `${name} has no established shellfish link — must stay available`);
    assert.ok(!matchesExclusionTerm(name, "fish"), `${name} has no established fish link — must stay available`);
  }
});

// Real-corpus proof the leak is closed: no ingredient literally containing
// "curry paste" survives a shellfish or fish exclusion in the shipped pool.
test("real-corpus sweep: every 'curry paste' ingredient is excluded under shellfish AND fish", async () => {
  const names = await corpusPromise;
  const pastes = names.filter((n) => /curry paste/i.test(n));
  assert.ok(pastes.length >= 3, `fixture guard: expected ≥3 curry-paste ingredient names in the corpus, found ${pastes.length} (${pastes.join(", ")})`);
  for (const n of pastes) {
    assert.ok(matchesExclusionTerm(n, "shellfish"), `"${n}" must be excluded under a shellfish allergy (contains shrimp paste)`);
    assert.ok(matchesExclusionTerm(n, "fish"), `"${n}" must be excluded under a fish allergy (contains fish sauce/shrimp paste)`);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// WAVE 2 (2026-07-23) — compound tokens, the add-only invariant, and the
// metadata union. Findings dietary-safety-2 / -4 / -5.
// ═════════════════════════════════════════════════════════════════════════
//
// Every keyword in this file is word-boundary anchored, which is what keeps
// "bass" out of "Basil". The price is that a PREPARED-DISH name written as one
// word hides its allergen from every list. Measured on the live matcher before
// the fix: "Cheeseburger" passed a dairy exclusion, "Eggnog" passed an egg
// exclusion, "Fishcake" passed a fish exclusion.

test("COMPOUND TOKENS: the P0 prepared-dish leaks are closed", () => {
  // [name, allergy] — each was MEASURED passing its exclusion on 2026-07-23.
  const mustCatch = [
    ["Cheeseburger", "dairy"],            // the reported P0
    ["Cheeseburger, fast food", "dairy"],
    ["Eggnog", "eggs"],                   // the reported P0
    ["Eggnog", "egg"],
    ["Eggnog, non-alcoholic", "dairy"],   // eggnog is egg AND milk
    ["Buttermilk", "dairy"],              // the reported P0 (already covered; pinned)
    ["Fishcake", "fish"],                 // the reported P0
    ["Fishcakes, frozen", "fish"],
    ["Milkshake, chocolate", "dairy"],
    ["Butterscotch sauce", "dairy"],
    ["Buttercream frosting", "dairy"],
    ["Coffee creamer, powdered", "dairy"],
    ["Cheesecake, plain", "dairy"],
    ["Philly cheesesteak", "dairy"],
    ["Chicken alfredo", "dairy"],
    ["Beef stroganoff", "dairy"],
    ["Caffe latte", "dairy"],
    ["Spaghetti carbonara", "eggs"],
    ["Mushroom omelette", "eggs"],
    ["Quiche lorraine", "eggs"],
    ["Frittata, vegetable", "eggs"],
    ["Mayo, light", "eggs"],
    ["Fishsticks, breaded", "fish"],
    ["Fish fingers", "fish"],
    ["Tunafish salad", "fish"],
    ["Caesar salad", "fish"],             // anchovy in the dressing
    ["Caesar salad", "dairy"],            // parmesan
    ["Crabcakes, Maryland", "shellfish"],
    ["Crabsticks", "shellfish"],
    ["Shortbread fingers", "gluten"],
    ["Gingerbread men", "gluten"],
    ["Flatbread, plain", "gluten"],
    ["Cornbread, prepared", "gluten"],
    ["Breadsticks, crisp", "gluten"],
    ["Sourdough loaf", "gluten"],
    ["Doughnuts, glazed", "gluten"],
    ["Donuts, cake type", "gluten"],
    ["Wholewheat pasta", "gluten"],
    ["Biscotti, almond", "gluten"],
    ["Croutons, seasoned", "gluten"],
  ];
  const leaks = mustCatch.filter(([name, cat]) => !matchesExclusionTerm(name, cat));
  assert.deepEqual(leaks, [], `compound-name allergen(s) would reach the plate: ${leaks.map(([n, c]) => `${n}/${c}`).join(" · ")}`);
});

// The other half of the fix, and the reason the dictionary is CURATED rather
// than an unbounded splitter: a splitter finds "ham" inside "graham", "nut"
// inside "doughnut" and "butternut", "milk" inside "milkfish" (which is a
// FISH). Each of these would quietly shrink a pool for no medical reason.
test("COMPOUND TOKENS: graham/hamburger-style false positives do NOT fire", () => {
  const violations = [];
  for (const { name, mustNotMatch, mustNotStyle, why } of COMPOUND_FALSE_FRIENDS) {
    for (const term of mustNotMatch) {
      if (matchesExclusionTerm(name, term)) violations.push(`"${name}" wrongly excluded for ${term} (${why})`);
    }
    for (const style of mustNotStyle || []) {
      if (adjusterExcludedByStyle({ name }, style)) violations.push(`"${name}" wrongly excluded by ${style} (${why})`);
    }
  }
  assert.deepEqual(violations, [], violations.join(" · "));
  // Spot-pinned individually so a failure names the case, not just the count.
  assert.ok(!matchesExclusionTerm("Graham crackers", "peanuts"), "'ham' inside 'graham' is not pork or peanut");
  assert.ok(!adjusterExcludedByStyle({ name: "Hamburger, plain" }, "halal"), "a hamburger is beef, not ham");
  assert.ok(!matchesExclusionTerm("Eggplant, raw", "eggs"), "aubergine is a vegetable");
  assert.ok(!matchesExclusionTerm("Nutmeg, ground", "tree nuts"), "nutmeg is a seed spice");
  assert.ok(!matchesExclusionTerm("Butternut squash, raw", "dairy"), "butternut is not butter");
  assert.ok(!matchesExclusionTerm("Doughnuts, glazed", "tree nuts"), "'nut' inside 'doughnut' is not a nut");
  assert.ok(!matchesExclusionTerm("Milkfish, raw", "dairy"), "milkfish is a fish, not dairy");
  assert.ok(matchesExclusionTerm("Milkfish, raw", "fish"), "...but it IS a fish");
  assert.ok(!matchesExclusionTerm("Water chestnut, canned", "tree nuts"), "an aquatic vegetable");
});

test("COMPOUND TOKENS: expansion is add-only — the raw name is never edited away", () => {
  // The mechanism, pinned directly: expandCompoundTokens() APPENDS. If it ever
  // rewrote or replaced, every existing word-boundary match could silently
  // change meaning.
  for (const name of ["Cheeseburger", "Plain rice", "Eggnog, non-alcoholic", ""]) {
    assert.ok(expandCompoundTokens(name).startsWith(name), `"${name}" must survive verbatim at the head of the expansion`);
  }
  assert.equal(expandCompoundTokens("Plain rice"), "Plain rice", "a name with no compound is returned untouched");
  assert.match(expandCompoundTokens("Cheeseburger"), /^Cheeseburger .*cheese/);
  // Junk in, no throw.
  for (const junk of [null, undefined, 42, {}]) assert.doesNotThrow(() => expandCompoundTokens(junk));
});

test("COMPOUND TOKENS: every dictionary entry actually changes an outcome (no dead weight)", () => {
  // A compound that expands to tokens no category can match is either a typo or
  // an entry someone added "just in case" — both rot the dictionary.
  const inert = Object.entries(COMPOUND_TOKENS).filter(([compound]) => expandCompoundTokens(compound) === compound);
  assert.deepEqual(inert, [], `these compounds expand to nothing: ${inert.map(([c]) => c).join(", ")}`);
});

// ── the add-only invariant, swept over the REAL corpus ───────────────────
// tests/allergenMetadata.test.js proves the invariant on hand-picked fixtures.
// This proves it on every name that actually ships: for every corpus name and
// every allergy family, a name-based exclusion must survive metadata that is
// absent, empty, or actively contradictory.
const CONTRADICTORY_METADATA = [
  {},
  { fdcCategory: null, allergenTags: null, mayContain: null },
  { allergenTags: [], mayContain: [] },
  { fdcCategory: "Vegetables and Vegetable Products", allergenTags: [] },
  { fdcCategory: "Fruits and Fruit Juices", allergenTags: ["en:celery"], mayContain: [] },
];

test("real-corpus sweep: metadata can never CLEAR a name-based exclusion (add-only invariant)", async () => {
  const names = await corpusPromise;
  const violations = [];
  for (const cat of Object.keys(ORACLES)) {
    for (const name of names) {
      if (!matchesExclusionTerm(name, cat)) continue;
      for (const meta of CONTRADICTORY_METADATA) {
        if (!foodMatchesExclusionTerm({ name, ...meta }, cat)) {
          violations.push(`${cat}: "${name}" un-excluded by ${JSON.stringify(meta)}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `ADD-ONLY VIOLATION — metadata cleared an exclusion: ${violations.slice(0, 5).join(" · ")}`);
});

test("real-corpus sweep: metadata is ADDITIVE — a declared tag excludes names the keywords miss", async () => {
  const names = await corpusPromise;
  // Take corpus names that are NOT dairy by name, attach a milk declaration,
  // and assert every one of them becomes excluded. This is the dietary-safety-4
  // shape: branded products whose names say nothing.
  const notDairyByName = names.filter((n) => !matchesExclusionTerm(n, "dairy")).slice(0, 200);
  assert.ok(notDairyByName.length > 50, `fixture guard: expected plenty of non-dairy names, found ${notDairyByName.length}`);
  const missed = notDairyByName.filter((n) => !foodMatchesExclusionTerm({ name: n, allergenTags: ["en:milk"] }, "dairy"));
  assert.deepEqual(missed, [], `a declared milk allergen tag failed to exclude: ${missed.slice(0, 5).join(" · ")}`);
});

// ── two leaks the 14k sweep found while verifying the above ──────────────
// Both measured against the REAL Food table with scripts/qc/sweep14k.mjs on
// 2026-07-23 (18 of the 25 leak candidates it reported). Neither is one of the
// three assigned findings; both are the same class and live in this file.
test("REGRESSION (14k sweep): plural 'chestnuts' is a tree nut — the guard was singular-only", () => {
  // hasWord() is exact; the tree-nut guard used it, so every plural FDC row
  // leaked. Same plural-blindness as the Phase 4 "Prawns" finding.
  for (const n of [
    "Chestnuts",
    "Nuts, chestnuts, japanese, boiled and steamed",
    "Nuts, chestnuts, chinese, roasted",
    "Nuts, chestnuts, european, raw, peeled",
  ]) {
    assert.ok(matchesExclusionTerm(n, "tree nuts"), `${n} must be excluded under a tree-nut allergy`);
    assert.ok(matchesExclusionTerm(n, "nuts"), `${n} must be excluded under a nut allergy`);
  }
  // ...and the water-chestnut exemption survives the plural form.
  assert.ok(!matchesExclusionTerm("Water chestnuts, canned, drained", "tree nuts"), "water chestnut is an aquatic vegetable");
  assert.ok(!matchesExclusionTerm("Water chestnut", "tree nuts"));
});

test("REGRESSION (14k sweep): 'lactose free' infant formula is still cow's-milk protein", () => {
  // Lactose intolerance and milk ALLERGY are different conditions. A
  // lactose-free product is still milk-derived, which is what an allergy
  // reacts to. Three real FDC rows reached a dairy allergy this way.
  for (const n of [
    "Infant formula, ABBOTT NUTRITION, SIMILAC, SENSITIVE (LACTOSE FREE) ready-to-feed, with ARA and DHA",
    "Milk, lactose free, whole",
  ]) {
    assert.ok(matchesExclusionTerm(n, "dairy"), `${n} must be excluded under a dairy allergy`);
  }
});

// ── free-text alias map, swept ───────────────────────────────────────────
test("real-corpus sweep: a free-text symptom/protein term excludes the same rows as its category", async () => {
  const names = await corpusPromise;
  // An alias must be at least as exclusive as the category it resolves to —
  // that is the whole promise of dietary-safety-5. (It may be MORE exclusive:
  // the literal term is applied on top.)
  const ALIAS_PAIRS = [
    ["lactose", "dairy"], ["casein", "dairy"], ["whey", "dairy"],
    ["wheat", "gluten"], ["semolina", "gluten"], ["seitan", "gluten"],
    ["albumen", "eggs"], ["groundnut", "peanuts"], ["arachis", "peanuts"],
    ["crustacean", "shellfish"], ["prawn", "shellfish"],
  ];
  const violations = [];
  for (const [alias, category] of ALIAS_PAIRS) {
    for (const name of names) {
      if (matchesExclusionTerm(name, category) && !matchesExclusionTerm(name, alias)) {
        violations.push(`"${alias}" missed "${name}" which "${category}" catches`);
      }
    }
  }
  assert.deepEqual(violations, [], `free-text alias under-excluded: ${violations.slice(0, 5).join(" · ")}`);
});
