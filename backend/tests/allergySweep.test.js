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

// ── documented false friends ─────────────────────────────────────────────────
// This oracle is deliberately independent of the filter, which is what makes it
// worth having — so weakening it to match the code is normally forbidden. This
// is the exception the rule is for: the oracle's own heuristic is WRONG for a
// small, enumerated set of names where an allergen word appears inside a word
// that is not that allergen. "Egg Plants" is aubergine, a vegetable; the oracle
// flags it purely because "Egg" is a word in it.
//
// Rather than special-casing here, this defers to dietaryFilter's
// COMPOUND_FALSE_FRIENDS — the same list the FILTER is held to — so the two can
// never drift apart, and every exemption carries a written `why`. An entry only
// exempts the categories it names in mustNotMatch: nothing is blanket-skipped.
//
// Verified surgical: "Egg Plants"/"Eggplant" are exempt, while "Egg Drop Soup",
// "Eggs, whole, raw" and "Eggnog" are still caught, and the eggplant OMELETTE
// (Tortang Talong) is still excluded at recipe level by its real Egg row.
const canon = (s) => String(s || "").toLowerCase()
  .split(",")[0]                    // drop USDA qualifiers: "Eggplant, raw" -> "Eggplant"
  .replace(/[^a-z0-9]+/g, "")       // "Egg Plants" -> "eggplants"
  .replace(/s$/, "");               // -> "eggplant"

const FALSE_FRIENDS_BY_CATEGORY = (() => {
  const map = new Map();
  for (const entry of COMPOUND_FALSE_FRIENDS || []) {
    for (const cat of entry.mustNotMatch || []) {
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat).add(canon(entry.name));
    }
  }
  return map;
})();

const isDocumentedFalseFriend = (name, cat) =>
  (FALSE_FRIENDS_BY_CATEGORY.get(cat) || new Set()).has(canon(name));

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
    const flagged = names.filter((n) => kws.some((kw) => oracleHits(n, kw)) && !matchesExclusionTerm(n, cat));
    const exempt = flagged.filter((n) => isDocumentedFalseFriend(n, cat));
    const leaks = flagged.filter((n) => !isDocumentedFalseFriend(n, cat));
    // Print every exemption. A silent skip list is how an oracle rots; if this
    // ever grows, it should be noticed in the run output, not discovered later.
    if (exempt.length) console.log(`  [sweep] ${cat}: ${exempt.length} documented false friend(s) exempt: ${exempt.join(" · ")}`);
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

// ═════════════════════════════════════════════════════════════════════════
// STAGE-2 ADVERSARIAL SWEEP (2026-07-24)
// ═════════════════════════════════════════════════════════════════════════
// An adversarial sweep of the real 14,122-food / 889-recipe corpus across all
// ten UI allergy categories, scored in BOTH directions against an oracle
// maintained independently of CATEGORY_SYNONYMS. It found 163 rows that passed
// a filter while genuinely carrying the declared allergen AND 255 rows removed
// while genuinely safe. Both halves are bugs, and they trade against each
// other: a fix that closes a leak by over-blocking is not a fix, and an
// over-block "fix" that swallows a real hit is worse than the over-block.
//
// Every name below is a VERBATIM row from that table (the Egg-Plants lesson: an
// assertion written from memory proves nothing).

test("STAGE-2 LEAKS: gluten inflections the word-boundary matcher could not reach", () => {
  // "bread" and "batter" were both in the list; `\bbread(?:es|s)?\b` cannot
  // match "breaded". 84 rows.
  for (const n of [
    "Fast foods, onion rings, breaded and fried",
    "DENNY'S, fish fillet, battered or breaded, fried",
    "Chicken, thighs, frozen, breaded, reheated",
    "KFC, Fried Chicken, ORIGINAL RECIPE, Breast, meat and skin with breading",
    "Chicken tenders or strips, breaded, from fast food",
  ]) assert.ok(matchesExclusionTerm(n, "gluten"), `breaded/battered must be gluten: ${n}`);
  // …and the two rows whose name states the breading is absent.
  for (const n of [
    "Veal, leg (top round), separable lean and fat, cooked, pan-fried, not breaded",
    "Veal, leg (top round), separable lean only, cooked, pan-fried, not breaded",
  ]) assert.ok(!matchesExclusionTerm(n, "gluten"), `"not breaded" is not breaded: ${n}`);
  // The inflection fix must NOT have been made by loosening the MATCHER: a
  // general -ed suffix would fire "corn" on "corned beef", which the corn
  // taxonomy row explicitly relies on staying clear.
  assert.ok(!matchesExclusionTerm("Corned beef, canned", "corn"), "'corned' is not corn");
});

test("STAGE-2 LEAKS: granola is gluten unless the name says it is absent", () => {
  for (const n of [
    "Snacks, granola bars, hard, plain",
    "Snacks, granola bar, KASHI GOLEAN, chewy, mixed flavors",
    "Breakfast bars, oats, sugar, raisins, coconut (include granola bar)",
    "Yogurt parfait, lowfat, with fruit and granola",
  ]) assert.ok(matchesExclusionTerm(n, "gluten"), `granola must be gluten: ${n}`);
  assert.ok(!matchesExclusionTerm("McDONALD'S, Fruit 'n Yogurt Parfait (without granola)", "gluten"),
    "the name states the granola is absent");
});

test("STAGE-2 LEAKS: the mayonnaise emulsions reach an egg allergy", () => {
  for (const n of [
    "Salad dressing, thousand island, commercial, regular",
    "Salad dressing, ranch dressing, regular",
    "Salad dressing, coleslaw",
    "Coleslaw",
    "Fast foods, fish sandwich, with tartar sauce",
    "Thousand Island dressing, light",
  ]) {
    assert.ok(matchesExclusionTerm(n, "eggs"), `mayonnaise emulsion must be egg: ${n}`);
    assert.ok(matchesExclusionTerm(n, "egg"), `…and the legacy singular key must agree: ${n}`);
  }
  // Ranch is buttermilk as well as mayonnaise.
  assert.ok(matchesExclusionTerm("Ranch dressing", "dairy"), "ranch is a buttermilk dressing");
});

test("STAGE-2 LEAKS: USDA meat ANALOGUES are soy — meat-free DISHES are not", () => {
  const { NON_EVIDENCE_FDC_CATEGORIES } = require("../src/lib/dietaryFilter.js");
  for (const n of [
    "Chicken, meatless", "Bacon, meatless", "Frankfurter, meatless",
    "Sausage, meatless", "Meatballs, meatless", "Luncheon slices, meatless",
    "Swiss steak, with gravy, meatless",
  ]) assert.ok(matchesExclusionTerm(n, "soy"), `a meat analogue is textured soy: ${n}`);
  // FNDDS uses the same word for the meat-free version of an ordinary dish.
  // Excluding these would close 15 leaks by over-blocking 25 rows.
  for (const n of [
    "Lasagna, meatless", "Stuffed tomato, with rice, meatless",
    "Taco or tostada salad, meatless", "Cheese quiche, meatless",
  ]) assert.ok(!matchesExclusionTerm(n, "soy"), `a meat-free dish is not soy: ${n}`);
  // The metadata backstop: the ANALOGUE shelf is evidence, the LEGUME shelf is
  // not — promoting "Legumes and Legume Products" to soy evidence would delete
  // every bean, lentil and chickpea for a soy allergy.
  assert.ok(!NON_EVIDENCE_FDC_CATEGORIES.has("soy and meat-alternative products"));
  assert.ok(NON_EVIDENCE_FDC_CATEGORIES.has("legumes and legume products"));
});

test("STAGE-2 LEAKS: the hidden fish/shellfish carriers", () => {
  for (const n of ["Kimchi", "Cabbage, kimchi"]) {
    assert.ok(matchesExclusionTerm(n, "fish"), `kimchi carries fish sauce: ${n}`);
    assert.ok(matchesExclusionTerm(n, "shellfish"), `kimchi carries jeotgal/salted shrimp: ${n}`);
  }
  assert.ok(matchesExclusionTerm("Olive tapenade", "fish"), "tapenade is anchovy");
  assert.ok(matchesExclusionTerm("Soup, pho, no meat", "fish"), "pho broth is finished with fish sauce");
  assert.ok(matchesExclusionTerm("Seafood paella, Puerto Rican style", "shellfish"));
  assert.ok(matchesExclusionTerm("Paella, NFS", "shellfish"), "NFS paella is paella mixta");
  assert.ok(matchesExclusionTerm("Soup, bisque", "shellfish"), "a bisque is a crustacean-shell soup");
  // …and the correct NON-matches. Over-fixing here is the failure mode.
  assert.ok(!matchesExclusionTerm("Soup, tomato bisque, canned, condensed", "shellfish"),
    "tomato bisque is the vegetable usage");
  assert.ok(!matchesExclusionTerm("Paella Rice", "shellfish"), "paella rice is the raw bomba-rice ingredient");
});

test("STAGE-2 LEAKS: nondairy whipped topping is sodium caseinate", () => {
  for (const n of [
    "Fruit salad, excluding citrus fruits, with nondairy whipped topping",
    "Fruit salad, including citrus fruits, with nondairy whipped topping",
  ]) assert.ok(matchesExclusionTerm(n, "dairy"), `caseinate is a milk protein: ${n}`);
  // An industrial FAT used to make them carries no protein.
  assert.ok(!matchesExclusionTerm("Oil, industrial, palm kernel (hydrogenated) , used for whipped toppings, non-dairy", "dairy"));
});

test("STAGE-2 OVER-BLOCKS: gluten must never delete the foods a celiac eats", () => {
  // The worst over-block in the file: 47 explicitly gluten-free products, every
  // one of them filed under USDA "Baked Products" — so the NAME guard alone was
  // not enough, the coarse shelf probe had to be suppressed too.
  for (const row of [
    { name: "Pasta, gluten-free, corn, dry", fdcCategory: "Cereal Grains and Pasta" },
    { name: "Bread, gluten-free, white, made with rice flour, corn starch, and/or tapioca", fdcCategory: "Baked Products" },
    { name: "Rolls, gluten-free, white, made with rice flour, rice starch, and corn starch", fdcCategory: "Baked Products" },
    { name: "Udi's, Gluten Free, Soft & Delicious White Sandwich Bread", fdcCategory: "Baked Products" },
    { name: "Pretzels, hard, plain, gluten free", fdcCategory: "Baked Products" },
    { name: "Crackers, gluten free, plain", fdcCategory: "Baked Products" },
    { name: "Roll, gluten free", fdcCategory: "Baked Products" },
  ]) {
    assert.ok(!matchesExclusionTerm(row.name, "gluten"), `gluten-free is gluten-free: ${row.name}`);
    assert.ok(!foodMatchesExclusionTerm(row, "gluten"), `…including through its USDA shelf: ${row.name}`);
  }
  // The gluten-free GRAINS filed under the wheat-default nouns.
  for (const row of [
    { name: "Flour, quinoa" }, { name: "Flour, amaranth" }, { name: "Flour, sorghum" },
    { name: "Flour, rice, brown" }, { name: "Flour, potato" },
    { name: "Corn Tortillas", fdcCategory: "Tortillas" },
    { name: "Tortillas, ready-to-bake or -fry, corn", fdcCategory: "Baked Products" },
    { name: "Tortilla, corn, shelf stable" },
    { name: "Cereals, corn grits, white, regular and quick, enriched, dry", fdcCategory: "Breakfast Cereals" },
    { name: "Cereals, QUAKER, hominy grits, white, quick, dry", fdcCategory: "Breakfast Cereals" },
  ]) assert.ok(!foodMatchesExclusionTerm(row, "gluten"), `a gluten-free grain form: ${row.name}`);
  // …and the wheat forms of the very same nouns are STILL excluded.
  for (const n of [
    "Flour, wheat, all-purpose, enriched, bleached", "Flour, 00", "Flour, semolina, fine",
    "Tortillas, ready-to-bake or -fry, flour, refrigerated",
    "Tortillas, ready-to-bake or -fry, whole wheat",
    "Wheat flour, white, tortilla mix, enriched",
    "Corned beef and potatoes in tortilla (Apache)",
    "Cereals ready-to-eat, KELLOGG, KELLOGG'S CORN FLAKES",
  ]) assert.ok(matchesExclusionTerm(n, "gluten"), `still gluten: ${n}`);
});

test("STAGE-2: the free-from veto can never turn an over-block into a LEAK", () => {
  // A whole-string veto is the dangerous half of this work. Three leashes, each
  // with the case it exists to beat. Any of these regressing is a LEAK, which is
  // strictly worse than the over-block the veto was added to fix.
  //
  // (a) PROSE is never a label claim — planContext scans recipe STEP text
  //     through this same matcher.
  assert.ok(matchesExclusionTerm("Cook the rice without butter for a dairy-free version.", "dairy"),
    "the butter is right there in the prose");
  assert.ok(foodMatchesExclusionTerm({ name: "Cook the rice without butter for a dairy-free version." }, "dairy"),
    "…and through the object-aware path too");
  assert.ok(matchesExclusionTerm("Add gluten-free flour and a splash of beer.", "gluten"),
    "the beer is barley");
  assert.ok(matchesExclusionTerm("Stir in the dairy-free cheese and the parmesan.", "dairy"),
    "the parmesan is dairy");
  // (b) a CONDITIONAL claim offers a variant, it does not assert one.
  assert.ok(matchesExclusionTerm("Add butter, or omit for a dairy-free version.", "dairy"));
  // (c) a claim governs its own CLAUSE, never the alternative offered after it.
  assert.ok(matchesExclusionTerm("Serve with gluten-free bread, or regular sourdough if you prefer", "gluten"));
  assert.ok(matchesExclusionTerm("gluten-free pasta or regular spaghetti", "gluten"));
  // …but FDC also uses " or " to list product VARIANTS, where the claim at the
  // end governs everything before it. The split therefore only applies when the
  // claim comes FIRST.
  assert.ok(!foodMatchesExclusionTerm({ name: "Cake or cupcake, gluten free", fdcCategory: "Baked Products" }, "gluten"));
  // …while the real label claims still clear, and only for THEIR category.
  assert.ok(!matchesExclusionTerm("Bread, gluten free", "gluten"));
  assert.ok(matchesExclusionTerm("Pizza, cheese and vegetables, gluten-free thick crust", "dairy"),
    "a gluten claim says nothing about the cheese");
  // "lactose free" is NOT a dairy claim — lactose-free milk is still milk protein.
  assert.ok(matchesExclusionTerm("Infant formula, ABBOTT NUTRITION, SIMILAC, SENSITIVE (LACTOSE FREE)", "dairy"));
});

test("STAGE-2 OVER-BLOCKS: tree nuts must not delete peanut butter or coconut", () => {
  for (const n of [
    "Peanut butter, creamy", "Peanut Butter", "Candies, confectioner's coating, peanut butter",
  ]) assert.ok(!matchesExclusionTerm(n, "tree nuts"), `tree-nut-allergic + peanut-safe is a common profile: ${n}`);
  for (const n of [
    "Nuts, coconut meat, raw", "Nuts, coconut meat, dried (desiccated), not sweetened",
    "Nuts, coconut milk, frozen (liquid expressed from grated meat and water)",
  ]) assert.ok(!matchesExclusionTerm(n, "tree nuts"), `"Nuts," is USDA's shelf prefix over a coconut row: ${n}`);
  // …and the real nuts on the same shelf are still caught.
  for (const n of ["Nuts, almonds, raw", "Nuts, mixed nuts, oil roasted, with salt added", "Almond nut butter"]) {
    assert.ok(matchesExclusionTerm(n, "tree nuts"), `still a tree nut: ${n}`);
  }
  assert.ok(matchesExclusionTerm("Peanut butter, creamy", "peanuts"), "peanut butter is still a peanut");
});

test("STAGE-2 OVER-BLOCKS: dairy must not delete plant yogurt, plant cheese or plant milk", () => {
  for (const row of [
    { name: "Yogurt, almond milk", fdcCategory: "Plant-based yogurt" },
    { name: "Yogurt, soy", fdcCategory: "Plant-based yogurt" },
    { name: "Yogurt, coconut milk", fdcCategory: "Plant-based yogurt" },
    { name: "SILK Plain soy yogurt", fdcCategory: "Legumes and Legume Products" },
    { name: "Vegan cheese" }, { name: "Cashew cheese" }, { name: "Soybean, curd cheese" },
    { name: "Coffee, Latte, with non-dairy milk" }, { name: "Non-dairy milk, NFS" },
    { name: "Oatmeal, instant, plain, made with non-dairy milk, fat added" },
  ]) assert.ok(!foodMatchesExclusionTerm(row, "dairy"), `a plant food a dairy-allergic user can eat: ${row.name}`);
  // The vegan pool gains them too — the same keyword list drove both.
  for (const n of ["Yogurt, soy", "Vegan cheese", "SILK Plain soy yogurt"]) {
    assert.ok(!adjusterExcludedByStyle({ name: n }, "vegan"), `a vegan food must survive a vegan pool: ${n}`);
  }
  // …and real dairy is untouched, including the FDC comma spellings.
  for (const n of ["Yogurt, Greek, plain, nonfat", "Cheese, cheddar", "Yogurt, plain, whole milk", "Goats Cheese"]) {
    assert.ok(matchesExclusionTerm(n, "dairy"), `still dairy: ${n}`);
    assert.ok(adjusterExcludedByStyle({ name: n }, "vegan"), `still not vegan: ${n}`);
  }
  // The undeclared creamers stay excluded — caseinate, per COMPOUND_VETOES' note.
  assert.ok(matchesExclusionTerm("Coffee creamer, liquid", "dairy"));
  assert.ok(matchesExclusionTerm("Frozen coffee drink, with non-dairy milk and whipped cream", "dairy"),
    "the whipped cream is still cream");
});

test("STAGE-2 OVER-BLOCKS: soybean OIL stays permitted, as CATEGORY_SYNONYMS.soy always promised", () => {
  for (const n of [
    "Oil, soybean, salad or cooking", "Oil, vegetable, soybean, refined",
    "Oil, industrial, soy, refined, for woks and light frying", "Soybean oil",
    "Snacks, potato chips, plain, made with partially hydrogenated soybean oil, salted",
    "Salad dressing, mayonnaise, soybean oil, without salt",
  ]) assert.ok(!matchesExclusionTerm(n, "soy"), `refined soybean oil is protein-free: ${n}`);
  // Every other soy form is untouched.
  for (const n of [
    "Soybeans, mature seeds, raw", "Soy sauce", "Tofu, firm", "Soy protein isolate",
    "Soybean, curd cheese", "Flour, soy, defatted", "Soy milk",
  ]) assert.ok(matchesExclusionTerm(n, "soy"), `still soy: ${n}`);
  // The mayonnaise is still an EGG problem, just not a soy one.
  assert.ok(matchesExclusionTerm("Salad dressing, mayonnaise, soybean oil, without salt", "eggs"));
});

test("STAGE-2: a plural keyword can never bypass its singular's guard", () => {
  // "Tortillas, ready-to-bake or -fry, corn" stayed excluded AFTER the corn
  // guard landed, because CATEGORY_SYNONYMS carries both "tortilla" and
  // "tortillas" and WORD_GUARDS is keyed by the exact synonym string.
  const { WORD_GUARDS, CATEGORY_SYNONYMS } = require("../src/lib/dietaryFilter.js");
  const unguarded = [];
  for (const list of Object.values(CATEGORY_SYNONYMS)) {
    for (const w of list) {
      const singular = w.replace(/(?:es|s)$/, "");
      if (w !== singular && WORD_GUARDS[singular] && !WORD_GUARDS[w]) unguarded.push(w);
    }
  }
  assert.deepEqual(unguarded, [], `plural synonyms that skip their singular's guard: ${unguarded.join(", ")}`);
});

test("STAGE-2 (task C): the free-text phrasings that used to be inert now resolve", async () => {
  const { resolveExclusionTerm } = require("../src/lib/dietaryFilter.js");
  const CASES = [
    ["all nuts", "nuts"], ["any nuts", "nuts"], ["anything with dairy", "dairy"],
    ["no dairy products", "dairy"], ["everything with soy", "soy"],
    ["shellfish and fish", "seafood"], ["fish or shellfish", "seafood"],
    ["shrimp paste", "shellfish"], ["surimi", "fish"], ["dashi", "fish"],
    ["panko", "gluten"], ["ponzu", "soy"], ["bean curd", "soy"], ["nougat", "egg"],
  ];
  const wrong = CASES.filter(([typed, key]) => resolveExclusionTerm(typed).synonymKey !== key)
    .map(([typed, key]) => `${typed} -> ${resolveExclusionTerm(typed).synonymKey} (want ${key})`);
  assert.deepEqual(wrong, [], `phrasings that still do not resolve: ${wrong.join(" · ")}`);
  // …and each one now actually removes something from the real pool.
  const names = await corpusPromise;
  const inert = CASES.map(([typed]) => typed).filter((t) => !names.some((n) => matchesExclusionTerm(n, t)));
  assert.deepEqual(inert, [], `recognised terms that still remove nothing: ${inert.join(" · ")}`);
  // The narrow-scope terms are NOT collapsed into their family.
  assert.equal(resolveExclusionTerm("soy protein").synonymKey, "soy protein");
  assert.ok(!matchesExclusionTerm("Soybean oil", "soy protein"));
});
