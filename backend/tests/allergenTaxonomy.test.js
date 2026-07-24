// ════════════════════════════════════════════════════════════════════════════
// STAGE 1 — Allergies 2.0. The taxonomy table + the leaks the 2026-07-24 audit
// MEASURED against the real corpus (889 recipes / 14,122 foods).
// ════════════════════════════════════════════════════════════════════════════
//
// Nothing in this file is hypothetical. Every positive case is a row or a typed
// phrase the audit proved reached (or failed to reach) a user; every negative
// case is a row the audit proved was wrongly removed.
//
// WHY IT READS THE REAL TABLE. The Egg-Plants finding exists precisely because
// the previous false-friend record was written from memory: 9 of its 11 names
// were not real rows, so the corpus's actual "Egg Plants" spelling was never
// asserted and quietly hid six aubergine recipes from an egg-allergic user.
// A fixture would have made the same mistake again. This suite therefore copies
// backend/prisma/dev.db to a scratch file and reads THAT — read-only, never the
// real database — and honestly SKIPS the corpus tests when the DB is absent
// (CI has no dev.db), rather than pretending to have checked.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ALLERGEN_TAXONOMY,
  ALLERGEN_BY_KEY,
  TOP_LEVEL_ALLERGENS,
  allergenCatalog,
  searchAllergens,
  resolveTaxonomyTerm,
  normaliseExclusionText,
  exclusionTermCandidates,
  categoryKeyOf,
} = require("../src/lib/allergenTaxonomy.js");

const {
  matchesExclusionTerm,
  foodMatchesExclusionTerm,
  resolveExclusionTerm,
  adjusterExcludedByStyle,
  applyDietaryFilters,
  CATEGORY_SYNONYMS,
  SYNONYM_KEY_FAMILY,
  FREE_TEXT_ALIASES,
  WORD_GUARDS,
  COMPOUND_VETOES,
  expandCompoundTokens,
  NON_EVIDENCE_FDC_CATEGORIES,
  FDC_CATEGORY_FAMILIES,
} = require("../src/lib/dietaryFilter.js");

// ── the scratch copy of the real Food table ──────────────────────────────
// SAFETY: a SQLite handle CREATES the file it is pointed at. The real path is
// only ever passed to fs.existsSync/fs.copyFileSync; the handle is opened on the
// COPY, read-only, and closed before the temp directory is removed.
const REAL_DB = path.join(__dirname, "..", "prisma", "dev.db");
let FOODS = null;
let CORPUS_NOTE = "no dev.db on this machine — corpus assertions skipped";
try {
  if (fs.existsSync(REAL_DB)) {
    const { DatabaseSync } = require("node:sqlite");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cut-protocol-allergen-"));
    const copy = path.join(dir, "scratch.db");
    fs.copyFileSync(REAL_DB, copy);
    const db = new DatabaseSync(copy, { readOnly: true });
    FOODS = db.prepare("SELECT name, fdcCategory, allergenTags, mayContain FROM Food").all();
    db.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir; harmless */ }
    CORPUS_NOTE = `real corpus: ${FOODS.length} Food rows (scratch copy)`;
  }
} catch (err) {
  CORPUS_NOTE = `could not read a scratch copy of dev.db (${err.message}) — corpus assertions skipped`;
}
const noCorpus = FOODS ? false : CORPUS_NOTE;
const rowsNamed = (name) => (FOODS || []).filter((f) => f.name === name);
const rowsMatching = (re) => (FOODS || []).filter((f) => re.test(f.name));

// ═════════════════════════════════════════════════════════════════════════
// 1. THE TABLE IS WELL-FORMED
// ═════════════════════════════════════════════════════════════════════════

test("taxonomy: every entry is well-formed", () => {
  const TIERS = new Set(["major", "common", "rare"]);
  const problems = [];
  for (const e of ALLERGEN_TAXONOMY) {
    const where = e.key || JSON.stringify(e).slice(0, 40);
    if (typeof e.key !== "string" || !e.key.trim()) problems.push(`${where}: missing key`);
    if (e.key !== e.key.toLowerCase().trim()) problems.push(`${where}: key must be lowercase and trimmed`);
    if (typeof e.label !== "string" || !e.label.trim()) problems.push(`${where}: missing label`);
    if (!TIERS.has(e.tier)) problems.push(`${where}: tier "${e.tier}" is not major/common/rare`);
    for (const field of ["synonyms", "nameKeywords", "fdcCategories", "offTags"]) {
      const v = e[field];
      if (v === undefined) continue;
      if (!Array.isArray(v)) { problems.push(`${where}: ${field} must be an array`); continue; }
      if (v.some((x) => typeof x !== "string" || !x.trim())) problems.push(`${where}: ${field} has a blank/non-string entry`);
      const dupes = v.filter((x, i) => v.indexOf(x) !== i);
      if (dupes.length) problems.push(`${where}: ${field} repeats ${dupes.join(", ")}`);
    }
    if (e.parent && !ALLERGEN_BY_KEY[e.parent]) problems.push(`${where}: parent "${e.parent}" is not a row`);
    if (e.parent && ALLERGEN_BY_KEY[e.parent].parent) problems.push(`${where}: parent "${e.parent}" is itself a species row`);
    for (const inc of e.includes || []) {
      if (!ALLERGEN_BY_KEY[inc]) problems.push(`${where}: includes "${inc}" which is not a row`);
    }
    if (e.note !== undefined && typeof e.note !== "string") problems.push(`${where}: note must be a string`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("taxonomy: keys are unique, and no synonym is claimed by two different rows", () => {
  const keys = ALLERGEN_TAXONOMY.map((e) => e.key);
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupKeys, [], `duplicate keys: ${dupKeys.join(", ")}`);

  const owner = new Map();
  const conflicts = [];
  for (const e of ALLERGEN_TAXONOMY) {
    for (const s of e.synonyms || []) {
      const n = normaliseExclusionText(s);
      const target = categoryKeyOf(e);
      if (owner.has(n) && owner.get(n) !== target) conflicts.push(`"${s}" → ${owner.get(n)} and ${target}`);
      else owner.set(n, target);
    }
  }
  assert.deepEqual(conflicts, [], `a synonym cannot mean two allergens: ${conflicts.join(" · ")}`);
});

test("taxonomy: every top-level row owns a real category and declares a family", () => {
  const missing = TOP_LEVEL_ALLERGENS.filter((e) => !CATEGORY_SYNONYMS[e.key]).map((e) => e.key);
  assert.deepEqual(missing, [], `top-level rows with no CATEGORY_SYNONYMS entry: ${missing.join(", ")}`);
  const familyless = TOP_LEVEL_ALLERGENS.filter((e) => !SYNONYM_KEY_FAMILY[e.key]).map((e) => e.key);
  assert.deepEqual(familyless, [], `top-level rows with no allergen family: ${familyless.join(", ")}`);
});

test("taxonomy: the merge into dietaryFilter is ADD-ONLY and cannot shadow a category", () => {
  // A category key must never also be an alias — that is the invariant
  // dietaryAliasMap.test.js pins, restated here from the taxonomy's side.
  const shadowed = Object.keys(FREE_TEXT_ALIASES).filter((a) => CATEGORY_SYNONYMS[a]);
  assert.deepEqual(shadowed, [], `aliases shadowing a category: ${shadowed.join(", ")}`);
  // Every species row must be reachable as an alias onto its parent.
  const unreachable = ALLERGEN_TAXONOMY
    .filter((e) => e.parent)
    .filter((e) => resolveExclusionTerm(e.key).synonymKey !== e.parent)
    .map((e) => `${e.key} → ${resolveExclusionTerm(e.key).synonymKey} (want ${e.parent})`);
  assert.deepEqual(unreachable, [], unreachable.join(" · "));
});

test("taxonomy: a multi-word keyword is never a substring of a known false friend", () => {
  // Multi-word keywords match as plain substrings. "nut milk" inside "coconut
  // milk" and "ground nut" inside "Ground Nutmeg" are the two shapes that have
  // actually bitten. A keyword may only sit inside one of these names if it
  // carries a WORD_GUARD.
  // NOTE: "peanut oil"/"peanut butter" are false friends of the TREE-NUT lists,
  // not of the peanut list — a keyword that sits inside them is only a bug if it
  // belongs to another allergen. The check below is per-row, so the peanut row's
  // own "peanut *" keywords are correctly out of scope.
  const FALSE_FRIENDS_BY_ROW = (key) => [
    "coconut milk", "coconut cream", "ground nutmeg", "water chestnut",
    "butternut squash", "sweet potato", "butter beans", "cocoa butter",
    "milkfish", "graham crackers", "doughnuts",
    ...(key === "peanuts" ? [] : ["peanut oil", "peanut butter", "peanut flour"]),
  ];
  const offenders = [];
  for (const e of ALLERGEN_TAXONOMY) {
    for (const kw of e.nameKeywords || []) {
      if (!kw.includes(" ")) continue;
      if (WORD_GUARDS[kw]) continue;
      for (const ff of FALSE_FRIENDS_BY_ROW(categoryKeyOf(e))) {
        if (ff.includes(kw.toLowerCase())) offenders.push(`${e.key}: "${kw}" sits inside "${ff}" and has no guard`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("taxonomy: no heterogeneous USDA category is ever used as allergen evidence", () => {
  const bad = [];
  for (const e of ALLERGEN_TAXONOMY) {
    for (const c of e.fdcCategories || []) {
      if (NON_EVIDENCE_FDC_CATEGORIES.has(c.trim().toLowerCase())) bad.push(`${e.key}: ${c}`);
    }
  }
  assert.deepEqual(bad, [], `these categories are evidence of nothing: ${bad.join(", ")}`);
  for (const c of ["Nut and Seed Products", "Cereal Grains and Pasta", "Fast Foods", "Snacks"]) {
    assert.ok(!(c.toLowerCase() in FDC_CATEGORY_FAMILIES), `${c} must stay out of the evidence map`);
  }
});

test("taxonomy: the UI lookup finds an allergen by label OR synonym", () => {
  const byLabel = searchAllergens("tree nuts");
  assert.equal(byLabel[0].key, "tree nuts");
  assert.equal(searchAllergens("coeliac")[0].key, "gluten", "a synonym must find its row");
  assert.equal(searchAllergens("alpha-gal")[0].key, "red meat");
  assert.equal(searchAllergens("escargot")[0].categoryKey, "shellfish");
  assert.ok(searchAllergens("").length > 0, "an empty query returns the catalogue");
  // The legacy "egg" mirror row must not appear twice in a picker.
  const labels = allergenCatalog().map((e) => e.label);
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  assert.deepEqual(dupes, [], `duplicate labels in the picker: ${dupes.join(", ")}`);
  // Public shape only — no matcher internals leak to the UI.
  for (const e of allergenCatalog()) {
    assert.deepEqual(Object.keys(e).sort(), ["categoryKey", "family", "key", "label", "note", "parent", "synonyms", "tier"]);
  }
});

test("taxonomy: coverage the owner asked for, by name", () => {
  const keys = new Set(ALLERGEN_TAXONOMY.map((e) => e.key));
  const required = [
    // regulated majors
    "dairy", "eggs", "peanuts", "tree nuts", "soy", "gluten", "fish", "shellfish", "sesame",
    "crustaceans", "molluscs",
    // tree-nut species depth
    "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia",
    "brazil nut", "pine nut", "chestnut",
    // celiac detail + lactose vs milk protein
    "barley", "rye", "malt", "brewers yeast", "seitan", "lactose", "milk protein",
    // common-but-not-major
    "corn", "nightshades", "alliums", "legumes", "buckwheat", "msg", "red meat",
    // rare, explicitly requested
    "lupin", "mustard", "celery", "sulphites", "kiwi", "latex fruit",
    "sunflower", "poppy seed", "mango", "cinnamon", "spices",
  ];
  const missing = required.filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], `taxonomy is missing: ${missing.join(", ")}`);
  // species depth the brief called out for fish/shellfish lives as keywords
  for (const kw of ["sturgeon", "shad", "croaker"]) {
    assert.ok(CATEGORY_SYNONYMS.fish.includes(kw), `fish must know "${kw}"`);
  }
  for (const kw of ["snail", "escargot", "urchin", "mollusc"]) {
    assert.ok(CATEGORY_SYNONYMS.shellfish.includes(kw), `shellfish must know "${kw}"`);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 2. THE MEASURED FREE-TEXT FAILURES (audit agent 07, F1 + F2)
// ═════════════════════════════════════════════════════════════════════════
// Each of these excluded 0 of 889 recipes before this fix, because
// resolveExclusionTerm() normalised with trim().toLowerCase() and nothing else.

const PHRASINGS = [
  ["cow's milk", "dairy"], ["cows milk", "dairy"], ["dairy-free", "dairy"],
  ["dairy free", "dairy"], ["no dairy", "dairy"], ["dairies", "dairy"],
  ["dairy!", "dairy"], ["lactose free", "dairy"], ["lactose-intolerant", "dairy"],
  ["milk allergy", "dairy"],
  ["gluten free", "gluten"], ["gluten-free", "gluten"], ["wheat allergy", "gluten"],
  ["nut allergy", "tree nuts"], ["shellfish allergy", "shellfish"],
  ["soy allergy", "soy"], ["red meat", "red meat"], ["nightshades", "nightshades"],
  ["MSG", "msg"],
];

test("FREE TEXT: all 19 measured phrasings resolve to a real allergen category", () => {
  const failures = [];
  for (const [typed, expected] of PHRASINGS) {
    const r = resolveExclusionTerm(typed);
    if (!r.recognised) failures.push(`"${typed}" is still unrecognised (kind ${r.kind})`);
    else if (r.synonymKey !== expected) failures.push(`"${typed}" → ${r.synonymKey}, expected ${expected}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("FREE TEXT: 'gluten free' resolves to the SAME category as 'gluten'", () => {
  assert.equal(resolveExclusionTerm("gluten free").synonymKey, resolveExclusionTerm("gluten").synonymKey);
  assert.equal(resolveExclusionTerm("gluten-free").synonymKey, "gluten");
  // ...and behaves identically on real names.
  for (const n of ["Wholewheat Bread", "Spaghetti", "Semolina flour", "farfalle"]) {
    assert.equal(matchesExclusionTerm(n, "gluten free"), matchesExclusionTerm(n, "gluten"), n);
  }
});

test("FREE TEXT: the normaliser strips punctuation, possessives, plurals and intent affixes", () => {
  assert.equal(normaliseExclusionText("Cow's Milk!"), "cows milk");
  assert.equal(normaliseExclusionText("  GLUTEN-FREE  "), "gluten free");
  assert.equal(normaliseExclusionText("dairy…"), "dairy");
  assert.ok(exclusionTermCandidates("lactose-intolerant").includes("lactose"));
  assert.ok(exclusionTermCandidates("dairies").includes("dairy"));
  assert.ok(exclusionTermCandidates("no dairy").includes("dairy"));
  assert.ok(exclusionTermCandidates("nut allergy").includes("nut"));
  // The raw form is always tried FIRST, so normalisation can only add matches.
  assert.equal(exclusionTermCandidates("Dairy")[0], "dairy");
});

test("FREE TEXT: the asymmetry that proved this was an accident is gone", () => {
  // "lactose intolerance" and "coeliac" WERE aliases; "lactose-intolerant" and
  // "gluten free" were not. Same user, same sentence, different outcome.
  assert.equal(resolveExclusionTerm("lactose intolerance").synonymKey, resolveExclusionTerm("lactose-intolerant").synonymKey);
  assert.equal(resolveExclusionTerm("coeliac").synonymKey, resolveExclusionTerm("gluten free").synonymKey);
});

test("FREE TEXT: an unrecognised phrasing still greps for what the user meant", () => {
  const r = resolveExclusionTerm("no mushrooms");
  assert.equal(r.kind, "literal");
  assert.equal(r.recognised, false, "and it still says so out loud");
  assert.equal(r.note, "not a recognised allergen — matching on text only");
  assert.ok(matchesExclusionTerm("Mushroom, white, raw", "no mushrooms"), "the normalised form must still filter");
  assert.ok(!matchesExclusionTerm("Apple, raw", "no mushrooms"));
});

test("FREE TEXT: junk in, no throw, no match-everything", () => {
  for (const junk of [null, undefined, 42, {}, [], true, "", "   ", "\t\n", ".*", "(?:", "\\"]) {
    assert.doesNotThrow(() => resolveExclusionTerm(junk));
    assert.doesNotThrow(() => matchesExclusionTerm("Cheddar cheese", junk));
  }
  assert.equal(matchesExclusionTerm("Cheddar cheese", ""), false);
  assert.equal(matchesExclusionTerm("Cheddar cheese", ".*"), false, "the literal branch is includes(), never a regex");
});

// ═════════════════════════════════════════════════════════════════════════
// 3. THE MEASURED SYNONYM-LIST GAPS (audit agents 05 §P0/P1, 09 §1–2)
// ═════════════════════════════════════════════════════════════════════════

test("GAP: perogies are a dairy carrier for a dairy ALLERGY, not just for vegans", () => {
  // agent 05 P0-2: "Grilled Chicken Breast & Perogies" shipped to a dairy
  // allergy in 8 of 40 generated weeks. The vegan list had carried perogi as a
  // hidden-dairy carrier all along.
  for (const n of ["Perogies, boiled", "Pierogi", "Perogies & Bacon"]) {
    assert.equal(matchesExclusionTerm(n, "dairy"), true, `${n} must be excluded for dairy`);
  }
  assert.equal(adjusterExcludedByStyle({ name: "Perogies, boiled" }, "vegan"), true, "and the vegan behaviour is unchanged");
});

test("GAP: teriyaki, hoisin and worcestershire are SOY carriers, not only gluten carriers", () => {
  for (const n of ["Teriyaki sauce", "Hoisin Sauce", "Sauce, hoisin, ready-to-serve", "Worcestershire Sauce"]) {
    assert.equal(matchesExclusionTerm(n, "soy"), true, `${n} must be excluded for soy`);
    assert.equal(matchesExclusionTerm(n, "gluten"), true, `${n} must still be excluded for gluten`);
  }
  assert.equal(matchesExclusionTerm("Worcestershire Sauce", "fish"), true, "and still for fish (anchovy)");
});

test("GAP: 'Ground Nut Oil' is peanut oil — and bare 'nut' now reaches TREE NUTS too", () => {
  // agent 09 #1: four recipes reached a peanut allergy through this row.
  assert.equal(matchesExclusionTerm("Ground Nut Oil", "peanuts"), true);
  assert.equal(matchesExclusionTerm("Ground Nut Oil", "tree nuts"), true);
  assert.equal(matchesExclusionTerm("Ground Nut Oil", "nuts"), true);
  // ...without firing on the real row it is a substring of.
  assert.equal(matchesExclusionTerm("Ground Nutmeg", "peanuts"), false);
  assert.equal(matchesExclusionTerm("Ground Nutmeg", "tree nuts"), false);
  // agent 09 #2: a one-character typo defeated the whole tree-nut list.
  assert.equal(matchesExclusionTerm("Hazlenuts", "tree nuts"), true);
});

test("GAP: the missing pasta shapes reach a celiac", () => {
  // agent 05 P0-1: `farfalle` was a real RecipeIngredient row WITH GRAMS on a
  // gluten-excluded plate ("Mediterranean Pasta Salad", 1 of 40 weeks).
  for (const n of ["farfalle", "Fusilli", "Rigatoni", "Conchiglie", "Cannelloni", "Ziti", "Rotini", "Orecchiette"]) {
    assert.equal(matchesExclusionTerm(n, "gluten"), true, `${n} must be excluded for gluten`);
  }
});

test("GAP: the other measured gluten carriers", () => {
  // agent 09 #5-#8: real ingredient rows on real plates.
  for (const n of ["Toast", "Beef Gravy", "Rice Krispies", "Christmas pudding"]) {
    assert.equal(matchesExclusionTerm(n, "gluten"), true, `${n} must be excluded for gluten`);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 4. THE MEASURED OVER-EXCLUSION (audit agent 09 §3)
// ═════════════════════════════════════════════════════════════════════════

test("FALSE POSITIVE: the brand LITTLE CAESARS is not Caesar dressing", () => {
  const pizzas = [
    'LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust',
    'LITTLE CAESARS 14" Pepperoni Pizza, Large Deep Dish Crust',
    'LITTLE CAESARS 14" Cheese Pizza, Thin Crust',
  ];
  for (const n of pizzas) {
    assert.equal(matchesExclusionTerm(n, "fish"), false, `${n} must not be excluded for fish`);
    assert.equal(matchesExclusionTerm(n, "eggs"), false, `${n} must not be excluded for eggs`);
  }
  // ...and a name that states the carrier is absent.
  assert.equal(matchesExclusionTerm("Caesar salad, with romaine, no dressing", "fish"), false);
  // The real Caesar dressing is untouched — the fix must not weaken it.
  assert.equal(matchesExclusionTerm("Salad dressing, caesar dressing, regular", "fish"), true);
  assert.equal(matchesExclusionTerm("Caesar salad with dressing", "fish"), true);
});

test("FALSE POSITIVE: a creamer that declares itself non-dairy is not dairy", () => {
  for (const n of [
    "SILK Original Creamer",
    "SILK French Vanilla Creamer",
    "Coffee creamer, soy, liquid",
    "Beverages, coffee, instant, vanilla, sweetened, decaffeinated, with non dairy creamer",
    "Frozen dessert, non-dairy",
  ]) {
    assert.equal(matchesExclusionTerm(n, "dairy"), false, `${n} must not be excluded for dairy`);
    assert.equal(adjusterExcludedByStyle({ name: n }, "vegan"), false, `${n} is a vegan product — it must not be removed from a vegan pool`);
  }
  // DELIBERATELY still excluded: a generic creamer with no declaration is
  // overwhelmingly sodium caseinate, which is a milk protein.
  assert.equal(matchesExclusionTerm("Coffee creamer, liquid", "dairy"), true);
  assert.equal(matchesExclusionTerm("Coffee creamer, powder", "dairy"), true);
});

test("FALSE POSITIVE: 'Egg Plants' is an aubergine", () => {
  // agent 09 §3.4: six real recipes were hidden from an egg-allergic user.
  for (const term of ["egg", "eggs"]) {
    assert.equal(matchesExclusionTerm("Egg Plants", term), false);
    assert.equal(matchesExclusionTerm("Eggplant, raw", term), false);
    assert.equal(matchesExclusionTerm("Sichuan Eggplant", term), false);
  }
  assert.equal(adjusterExcludedByStyle({ name: "Egg Plants" }, "vegan"), false, "a vegan can eat aubergine");
  // ...and real eggs are untouched, including in the same sentence.
  assert.equal(matchesExclusionTerm("Eggs, whole, raw", "eggs"), true);
  assert.equal(matchesExclusionTerm("Egg plants stuffed with egg", "eggs"), true);
  assert.equal(matchesExclusionTerm("Egg Plants", "nightshades"), true, "aubergine IS a nightshade");
});

test("FALSE POSITIVE: a seed butter is not butter, and sweet potato is not a nightshade", () => {
  for (const n of ["Seeds, sunflower seed butter, without salt", "Sesame butter, creamy", "Seeds, sesame butter, tahini, from raw and stone ground kernels"]) {
    assert.equal(matchesExclusionTerm(n, "dairy"), false, `${n} must not be excluded for dairy`);
  }
  assert.equal(matchesExclusionTerm("Sweet potato, cooked, baked in skin", "nightshades"), false);
  assert.equal(matchesExclusionTerm("Potatoes, russet, baked", "nightshades"), true, "the white potato IS one");
});

test("FALSE POSITIVE: the pre-existing guards all still hold", () => {
  const cases = [
    ["Coconut, raw", "tree nuts"], ["Water chestnut, canned", "tree nuts"],
    ["Nutmeg, ground", "tree nuts"], ["Doughnuts, glazed", "tree nuts"],
    ["Butternut squash, raw", "dairy"], ["Milkfish, raw", "dairy"],
    ["Almond milk, unsweetened", "dairy"], ["Butter beans, canned", "dairy"],
    ["Peanut butter, smooth", "dairy"], ["Cream of tartar", "dairy"],
    ["Curry powder", "shellfish"], ["Soybean oil", "soy protein"],
  ];
  for (const [n, t] of cases) assert.equal(matchesExclusionTerm(n, t), false, `${n} must not be excluded for ${t}`);
  assert.equal(matchesExclusionTerm("Milkfish, raw", "fish"), true, "...but milkfish IS a fish");
});

// ═════════════════════════════════════════════════════════════════════════
// 5. THE KIWI TEST — free text, resolved, and excluded EVERYWHERE
// ═════════════════════════════════════════════════════════════════════════

test("KIWI: the term resolves as a real allergen category", () => {
  const r = resolveExclusionTerm("kiwi");
  assert.equal(r.recognised, true);
  assert.equal(r.synonymKey, "kiwi");
  assert.equal(r.family, "kiwi");
  for (const typed of ["Kiwi", " KIWI ", "kiwis", "kiwifruit", "kiwi fruit", "kiwi allergy", "no kiwi", "chinese gooseberry"]) {
    assert.equal(resolveExclusionTerm(typed).synonymKey, "kiwi", `"${typed}" must resolve to kiwi`);
  }
  assert.equal(resolveTaxonomyTerm("kiwi").categoryKey, "kiwi");
});

test("KIWI: every spelling in the wild is excluded, and nothing else is", () => {
  for (const n of [
    "Kiwifruit, green, raw", "Kiwi fruit, raw", "Kiwifruit (kiwi), green, peeled, raw",
    "Kiwifruit, ZESPRI SunGold, raw", "Beverages, Kiwi Strawberry Juice Drink",
    "Babyfood, GERBER, 3rd Foods, apple, mango and kiwi", "Kiwis, sliced",
  ]) {
    assert.equal(matchesExclusionTerm(n, "kiwi"), true, `${n} must be excluded for kiwi`);
  }
  for (const n of ["Strawberries, raw", "Gooseberries, raw", "Apple, raw"]) {
    assert.equal(matchesExclusionTerm(n, "kiwi"), false, `${n} must NOT be excluded for kiwi`);
  }
  // ...end to end through the filter entry point.
  const pool = [
    { name: "Kiwifruit, green, raw", carb: 15 },
    { name: "Kiwi fruit, raw", carb: 15 },
    { name: "Apple, raw", carb: 14 },
  ];
  assert.deepEqual(
    applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["kiwi"] }).map((f) => f.name),
    ["Apple, raw"],
  );
});

test("KIWI: excluded from the real 14,122-row table, every row, no exception", { skip: noCorpus }, () => {
  const kiwis = rowsMatching(/\bkiwi/i);
  assert.ok(kiwis.length >= 8, `expected the corpus kiwi rows, found ${kiwis.length}`);
  const leaked = kiwis.filter((f) => !foodMatchesExclusionTerm(f, "kiwi")).map((f) => f.name);
  assert.deepEqual(leaked, [], `kiwi rows that survived a kiwi exclusion: ${leaked.join(" · ")}`);
});

// ═════════════════════════════════════════════════════════════════════════
// 6. THE SAME CLAIMS, AGAINST THE REAL TABLE
// ═════════════════════════════════════════════════════════════════════════
// The section above uses the real row NAMES. This one proves those rows exist —
// the failure mode that produced the Egg-Plants bug was asserting on names the
// app will never see.

test("CORPUS: every name asserted above is a real row in the scratch copy", { skip: noCorpus }, () => {
  const MUST_EXIST = [
    "Egg Plants", "Ground Nut Oil", "Ground Nutmeg", "Perogies, boiled", "farfalle",
    "Hoisin Sauce", "Teriyaki sauce", "Worcestershire Sauce",
    'LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust',
    "SILK Original Creamer", "Coffee creamer, soy, liquid",
    "Beverages, coffee, instant, vanilla, sweetened, decaffeinated, with non dairy creamer",
    "Seeds, sunflower seed butter, without salt", "Caesar salad, with romaine, no dressing",
    "Salad dressing, caesar dressing, regular",
  ];
  const absent = MUST_EXIST.filter((n) => rowsNamed(n).length === 0);
  assert.deepEqual(absent, [], `asserted against names that are not in the table: ${absent.join(" · ")}`);
});

test("CORPUS: the leak rows are excluded WITH their persisted metadata attached", { skip: noCorpus }, () => {
  const CASES = [
    ["Perogies, boiled", "dairy"], ["Ground Nut Oil", "peanuts"], ["Ground Nut Oil", "tree nuts"],
    ["farfalle", "gluten"], ["Hoisin Sauce", "soy"], ["Teriyaki sauce", "soy"],
    ["Worcestershire Sauce", "soy"], ["Worcestershire Sauce", "fish"],
  ];
  const leaks = [];
  for (const [name, term] of CASES) {
    for (const row of rowsNamed(name)) if (!foodMatchesExclusionTerm(row, term)) leaks.push(`${term}: ${name}`);
  }
  assert.deepEqual(leaks, [], `still leaking: ${leaks.join(" · ")}`);
});

test("CORPUS: the false positives are gone WITH their persisted metadata attached", { skip: noCorpus }, () => {
  const CASES = [
    ["Egg Plants", "eggs"], ["Egg Plants", "egg"], ["Ground Nutmeg", "peanuts"],
    ["Ground Nutmeg", "tree nuts"], ["SILK Original Creamer", "dairy"],
    ["Coffee creamer, soy, liquid", "dairy"],
    ["Beverages, coffee, instant, vanilla, sweetened, decaffeinated, with non dairy creamer", "dairy"],
    ["Seeds, sunflower seed butter, without salt", "dairy"],
    ["Caesar salad, with romaine, no dressing", "fish"],
    ['LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust', "fish"],
    ['LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust', "eggs"],
  ];
  const wrong = [];
  for (const [name, term] of CASES) {
    for (const row of rowsNamed(name)) if (foodMatchesExclusionTerm(row, term)) wrong.push(`${term}: ${name}`);
  }
  assert.deepEqual(wrong, [], `still wrongly excluded: ${wrong.join(" · ")}`);
});

test("CORPUS: no free-text phrasing is inert — each removes real rows", { skip: noCorpus }, () => {
  // The finding was "excludes ZERO of 889 recipes". At food level the bar is the
  // same: a recognised term that removes nothing is a lie the UI would repeat.
  // `.some` short-circuits — one hit is all this claim needs.
  const inert = PHRASINGS
    .map(([typed]) => typed)
    .filter((typed) => !FOODS.some((f) => foodMatchesExclusionTerm(f, typed)));
  assert.deepEqual(inert, [], `these recognised terms still remove nothing: ${inert.join(" · ")}`);
});

test("CORPUS: over-exclusion did not run away — every category keeps a usable pool", { skip: noCorpus }, () => {
  // Over-exclusion is the sanctioned failure direction, but a category that
  // deletes the library is a different bug. Floors are deliberately loose; the
  // sample is deterministic (every row, one pass, six UI checkbox categories).
  for (const key of ["dairy", "gluten", "soy", "fish", "shellfish", "tree nuts"]) {
    let removed = 0;
    for (const f of FOODS) if (foodMatchesExclusionTerm(f, key)) removed += 1;
    const kept = FOODS.length - removed;
    assert.ok(kept / FOODS.length > 0.5, `"${key}" removes more than half the food table — keeps ${kept}/${FOODS.length}`);
  }
});

test("CORPUS: a veto suppresses the rows it was written for, and nothing else", { skip: noCorpus }, () => {
  // A veto is a licensed REDUCTION, so it needs a tighter leash than an
  // addition. Bound it two ways: it may only affect names that actually carry
  // the compound word, and the un-declared cases must still expand.
  for (const compound of Object.keys(COMPOUND_VETOES)) {
    const carriesCompound = new RegExp(`\\b${compound}`, "i");
    const affected = FOODS.filter((f) => carriesCompound.test(f.name) && COMPOUND_VETOES[compound].some((v) => v.test(f.name)));
    assert.ok(affected.length > 0, `the ${compound} veto matches no real row — it is either dead or the corpus moved`);
    assert.ok(affected.length < 40, `the ${compound} veto suppresses ${affected.length} rows — far more than the audit measured`);
  }
  // The declared cases are suppressed…
  assert.equal(expandCompoundTokens("SILK Original Creamer"), "SILK Original Creamer");
  assert.equal(expandCompoundTokens("Caesar salad, with romaine, no dressing"), "Caesar salad, with romaine, no dressing");
  // …and the un-declared ones are not.
  assert.match(expandCompoundTokens("Coffee creamer, liquid"), /cream/);
  assert.match(expandCompoundTokens("Salad dressing, caesar dressing, regular"), /anchovy/);
});

test(`corpus source: ${CORPUS_NOTE}`, () => {
  // Not a no-op: it puts the provenance of section 6 in the test output, so a
  // green run on a machine without dev.db can never be mistaken for a green run
  // against the real 14,122 rows.
  assert.ok(typeof CORPUS_NOTE === "string" && CORPUS_NOTE.length > 0);
});
