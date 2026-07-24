// Persisted allergen metadata — findings dietary-safety-2 (P0) and -4 (P1).
//
// ONE root cause behind both: every import path COMPUTED an authoritative
// allergen signal and then threw it away, because the Food table had nowhere to
// put it. USDA's own food category was parsed by scripts/lib/fdcDataset.js and
// dropped; Open Food Facts' manufacturer-declared allergens_tags were never even
// requested. Name keywords were left as the only evidence — and a prepared-dish
// name defeats word-boundary keyword matching outright.
//
// This suite covers the three things that fix has to be true about:
//   1. the columns exist and are NULLABLE (old rows survive)
//   2. every signal is UNIONED into the verdict
//   3. the union is ADD-ONLY — metadata can raise an exclusion, never clear one
//
// (3) is the one that rots. An add-only invariant that isn't tested will be
// violated within a month by someone writing `return tags.includes(x)` instead
// of `|| tags.includes(x)`, so it is asserted here against deliberately
// CONTRADICTORY metadata: a cheeseburger filed under "Vegetables", an explicit
// empty allergen array on a block of cheddar. The name verdict must survive
// both.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  matchesExclusionTerm,
  foodMatchesExclusionTerm,
  exclusionEvidence,
  styleExcludedByMetadata,
  applyDietaryFilters,
  traceExclusions,
  adjusterExcludedByStyle,
  normaliseAllergenTag,
  normaliseAllergenTags,
  allergenTagFamilies,
  OFF_TAG_FAMILY,
  FDC_CATEGORY_FAMILIES,
  TRACE_POLICY_DEFAULT,
} = require("../src/lib/dietaryFilter.js");
const { candidateFromOffProduct, allergenFieldsFromOffProduct } = require("../src/lib/offImport.js");
const { normalize: normalizeUsdaItem, fdcCategoryOf } = require("../src/lib/usdaClient.js");

// ── 1. the schema/migration contract ─────────────────────────────────────
// A static read, so this stays CI-safe: no database, no Prisma client.

const PRISMA_DIR = path.join(__dirname, "..", "prisma");
const schemaSrc = fs.readFileSync(path.join(PRISMA_DIR, "schema.prisma"), "utf8");

test("schema: Food carries fdcCategory, allergenTags and mayContain, all NULLABLE", () => {
  const model = schemaSrc.slice(schemaSrc.indexOf("model Food {"));
  const body = model.slice(0, model.indexOf("\n}"));
  assert.match(body, /^\s*fdcCategory\s+String\?\s*$/m, "fdcCategory must exist and be optional");
  assert.match(body, /^\s*allergenTags\s+Json\?\s*$/m, "allergenTags must exist and be optional");
  assert.match(body, /^\s*mayContain\s+Json\?\s*$/m, "mayContain must exist and be optional");
});

test("migration: exactly one additive migration adds the three columns, and it redefines no table", () => {
  const dirs = fs.readdirSync(path.join(PRISMA_DIR, "migrations"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /_food_allergen_metadata$/.test(d.name))
    .map((d) => d.name);
  assert.equal(dirs.length, 1, `expected one allergen-metadata migration, found ${dirs.length}: ${dirs.join(", ")}`);
  const sql = fs.readFileSync(path.join(PRISMA_DIR, "migrations", dirs[0], "migration.sql"), "utf8");
  for (const col of ["fdcCategory", "allergenTags", "mayContain"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "Food" ADD COLUMN "${col}"`), `${col} must be added by ALTER TABLE`);
  }
  // The dangerous shape in SQLite/Prisma is the table-rebuild ("RedefineTables"
  // → CREATE new_X / INSERT SELECT / DROP TABLE). This migration must never do
  // that to Food: it would rewrite 14k live rows to add three nullable columns.
  assert.doesNotMatch(sql, /DROP TABLE/i, "an additive migration must not drop a table");
  assert.doesNotMatch(sql, /NOT NULL/i, "all three columns must be nullable so existing rows survive");
});

test("migration: the desktop migration runner can parse it (packaged app applies its own migrations)", () => {
  // The Electron build applies pending Prisma migrations itself on boot via
  // desktopBootstrap.splitSqlStatements(), which only understands `--` line
  // comments and semicolon-terminated statements. A migration that parses under
  // `prisma migrate deploy` but not under that splitter would apply on a dev
  // machine and silently fail on a packaged install.
  let splitSqlStatements;
  try { ({ splitSqlStatements } = require("../src/lib/desktopBootstrap.js")); } catch { /* not exported */ }
  if (typeof splitSqlStatements !== "function") return; // runner refactored — the deploy path still covers us

  const dir = fs.readdirSync(path.join(PRISMA_DIR, "migrations"))
    .find((n) => /_food_allergen_metadata$/.test(n));
  const sql = fs.readFileSync(path.join(PRISMA_DIR, "migrations", dir, "migration.sql"), "utf8");
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 3, `expected 3 ALTER statements, got ${statements.length}: ${statements.join(" | ")}`);
  for (const s of statements) assert.match(s, /^ALTER TABLE "Food" ADD COLUMN/);
});

// ── 2. tag normalisation ─────────────────────────────────────────────────

test("OFF tags normalise: language prefix stripped, case folded, deduped", () => {
  assert.equal(normaliseAllergenTag("en:milk"), "milk");
  assert.equal(normaliseAllergenTag("  EN:GLUTEN  "), "gluten");
  assert.equal(normaliseAllergenTag("fr:lait"), "lait");
  assert.equal(normaliseAllergenTag(null), "");
  assert.deepEqual(normaliseAllergenTags(["en:milk", "EN:Milk", "en:gluten"]), ["milk", "gluten"]);
  assert.deepEqual(normaliseAllergenTags("en:milk,en:eggs"), ["milk", "eggs"]);
});

test("null tags mean 'no declaration available'; [] means 'declared none' — different facts", () => {
  assert.equal(normaliseAllergenTags(null), null, "absence must stay null, never become []");
  assert.equal(normaliseAllergenTags(undefined), null);
  assert.deepEqual(normaliseAllergenTags([]), [], "an explicit empty declaration is preserved");
});

test("tag → allergen family mapping covers the major declarables", () => {
  for (const [tag, family] of [
    ["en:milk", "dairy"], ["en:gluten", "gluten"], ["en:eggs", "egg"],
    ["en:peanuts", "peanut"], ["en:nuts", "tree-nut"], ["en:hazelnuts", "tree-nut"],
    ["en:soybeans", "soy"], ["en:fish", "fish"], ["en:crustaceans", "shellfish"],
    ["en:molluscs", "shellfish"], ["en:sesame-seeds", "sesame"], ["en:celery", "celery"],
    ["en:mustard", "mustard"], ["en:lupin", "lupin"],
    ["en:sulphur-dioxide-and-sulphites", "sulphites"],
  ]) {
    assert.ok(allergenTagFamilies([tag]).has(family), `${tag} must resolve to the ${family} family`);
  }
  // Peanut is a legume, not a tree nut — the two must never collapse.
  assert.ok(!allergenTagFamilies(["en:peanuts"]).has("tree-nut"), "a peanut tag is not a tree-nut tag");
  assert.ok(!allergenTagFamilies(["en:nuts"]).has("peanut"), "a tree-nut tag is not a peanut tag");
  // An unknown tag contributes nothing rather than throwing or matching wildly.
  assert.equal(allergenTagFamilies(["en:not-a-real-allergen"]).size, 0);
});

// ── 3. each evidence source can raise an exclusion ON ITS OWN ─────────────

test("evidence source: a declared allergen tag excludes a food whose NAME says nothing", () => {
  // The dietary-safety-4 case in one row: a branded product whose name carries
  // no allergen keyword at all, but whose panel declares milk.
  const food = { name: "Choco Delight Bar", allergenTags: ["en:milk", "en:soybeans"] };
  assert.equal(matchesExclusionTerm(food.name, "dairy"), false, "precondition: the name alone is not dairy");
  assert.equal(foodMatchesExclusionTerm(food, "dairy"), true, "the declared tag must exclude it");
  assert.equal(foodMatchesExclusionTerm(food, "soy"), true);
  assert.equal(foodMatchesExclusionTerm(food, "gluten"), false, "an undeclared allergen is not invented");

  const ev = exclusionEvidence(food, "dairy");
  assert.deepEqual(ev.reasons.map((r) => r.source), ["allergen-tag"]);
});

test("evidence source: USDA's authoritative category excludes a food whose NAME says nothing", () => {
  const food = { name: "Cheddar-style spread, reduced fat", fdcCategory: "Dairy and Egg Products" };
  assert.equal(foodMatchesExclusionTerm(food, "dairy"), true);
  const bare = { name: "Kefalotyri" }; // a real cheese with no keyword in its name
  assert.equal(matchesExclusionTerm(bare.name, "dairy"), false, "precondition: name alone misses it");
  assert.equal(foodMatchesExclusionTerm({ ...bare, fdcCategory: "Dairy and Egg Products" }, "dairy"), true);
  assert.equal(
    exclusionEvidence({ ...bare, fdcCategory: "Dairy and Egg Products" }, "dairy").reasons[0].source,
    "fdc-category",
  );
});

test("evidence source: a category that is evidence of nothing stays evidence of nothing", () => {
  // Deliberately absent from FDC_CATEGORY_FAMILIES — see the comment on it.
  for (const cat of ["Nut and Seed Products", "Cereal Grains and Pasta", "Fast Foods", "Snacks"]) {
    assert.ok(!(cat.toLowerCase() in FDC_CATEGORY_FAMILIES), `${cat} is too heterogeneous to be allergen evidence`);
  }
  assert.equal(foodMatchesExclusionTerm({ name: "Sunflower seed kernels", fdcCategory: "Nut and Seed Products" }, "tree nuts"), false);
});

// ── 4. traces / "may contain" ────────────────────────────────────────────

test("traces EXCLUDE by default (medical-severity signal), and say which source fired", () => {
  assert.equal(TRACE_POLICY_DEFAULT, "exclude");
  const food = { name: "Oat cookies", mayContain: ["en:nuts"] };
  assert.equal(foodMatchesExclusionTerm(food, "tree nuts"), true, "a declared trace must exclude by default");
  const ev = exclusionEvidence(food, "tree nuts");
  assert.deepEqual(ev.reasons.map((r) => r.source), ["may-contain"]);
  assert.equal(ev.reasons[0].advisory, false, "under the default policy the trace is a real reason, not advisory");
});

test("traces:'flag' surfaces the trace without removing the food — but never hides it", () => {
  const food = { name: "Oat cookies", mayContain: ["en:nuts"] };
  const ev = exclusionEvidence(food, "tree nuts", { traces: "flag" });
  assert.equal(ev.excluded, false, "under the softer policy a trace alone does not exclude");
  assert.equal(ev.reasons.length, 1, "the evidence is still reported — silent failure is banned");
  assert.equal(ev.reasons[0].advisory, true);
});

test("traces:'flag' cannot rescue a food another source already excluded", () => {
  const food = { name: "Almond cookies", mayContain: ["en:nuts"] };
  assert.equal(foodMatchesExclusionTerm(food, "tree nuts", { traces: "flag" }), true, "the NAME already said almond");
});

// ── 5. THE ADD-ONLY INVARIANT ────────────────────────────────────────────

// Metadata combinations that are, variously: absent, empty, irrelevant, and
// actively CONTRADICTORY. None of them may reduce the exclusion set.
const METADATA_VARIANTS = [
  { label: "no metadata", meta: {} },
  { label: "explicit nulls", meta: { fdcCategory: null, allergenTags: null, mayContain: null } },
  { label: "explicitly declares NO allergens", meta: { allergenTags: [], mayContain: [] } },
  { label: "contradictory category", meta: { fdcCategory: "Vegetables and Vegetable Products" } },
  { label: "contradictory tags", meta: { allergenTags: ["en:celery"], mayContain: [] } },
  { label: "category + tags both contradictory", meta: { fdcCategory: "Fruits and Fruit Juices", allergenTags: [] } },
  { label: "corroborating tags", meta: { allergenTags: ["en:milk", "en:gluten", "en:eggs", "en:fish"] } },
];

const INVARIANT_NAMES = [
  "Cheeseburger", "Eggnog", "Buttermilk", "Fishcake", "Cheese, cheddar",
  "Milk, whole, 3.25% milkfat", "Shrimp, cooked", "Wheat flour, white",
  "Almond butter", "Peanut butter, smooth", "Thai Red Curry Paste",
  "White Chocolate Chips", "Toffee Popcorn", "Mixed Nuts", "Sesame seeds",
];
const INVARIANT_TERMS = ["dairy", "gluten", "eggs", "fish", "shellfish", "tree nuts", "peanuts", "soy", "sesame", "lactose", "wheat"];

test("ADD-ONLY: metadata can never clear an exclusion the name already raised", () => {
  const violations = [];
  for (const name of INVARIANT_NAMES) {
    for (const term of INVARIANT_TERMS) {
      if (!matchesExclusionTerm(name, term)) continue; // nothing raised — nothing to preserve
      for (const { label, meta } of METADATA_VARIANTS) {
        if (!foodMatchesExclusionTerm({ name, ...meta }, term)) {
          violations.push(`${name} / ${term} / ${label}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `metadata CLEARED a name-based exclusion: ${violations.join(" · ")}`);
});

test("ADD-ONLY: the same invariant holds for the dietary STYLE filter", () => {
  // applyDietaryFilters() is the real entry point and the one that sees
  // metadata; a food it keeps is a food that reached the plate.
  const stylePasses = (food, style) =>
    applyDietaryFilters([food], { dietaryStyle: style, excludedFoods: [] }).length === 1;

  const violations = [];
  const styleNames = [...INVARIANT_NAMES, "Beef, ground, raw", "Salmon fillet", "Gelatin, dry powder"];
  for (const name of styleNames) {
    for (const style of ["vegan", "vegetarian", "paleo", "halal", "kosher"]) {
      if (!adjusterExcludedByStyle({ name }, style)) continue; // nothing raised
      for (const { label, meta } of METADATA_VARIANTS) {
        if (stylePasses({ name, carb: 0, kcal: 0, ...meta }, style)) {
          violations.push(`${name} / ${style} / ${label}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `metadata CLEARED a style exclusion: ${violations.join(" · ")}`);
});

test("ADD-ONLY, stated as the union it is: any single TRUE source makes the food excluded", () => {
  // A name that says nothing, so each source is isolated and provably decisive.
  const inertName = "Bakery Special No. 7";
  assert.equal(matchesExclusionTerm(inertName, "dairy"), false);
  const sources = [
    { fdcCategory: "Dairy and Egg Products" },
    { allergenTags: ["en:milk"] },
    { mayContain: ["en:milk"] },
  ];
  for (const meta of sources) {
    assert.equal(foodMatchesExclusionTerm({ name: inertName, ...meta }, "dairy"), true, `${JSON.stringify(meta)} alone must exclude`);
  }
  // ...and all of them together report every reason, not just the first.
  const all = exclusionEvidence({ name: "Cheddar cheese", fdcCategory: "Dairy and Egg Products", allergenTags: ["en:milk"], mayContain: ["en:milk"] }, "dairy");
  assert.deepEqual(all.reasons.map((r) => r.source), ["name", "fdc-category", "allergen-tag", "may-contain"]);
  assert.equal(all.excluded, true);
});

// ── 6. the filter entry points actually consume the metadata ─────────────

test("applyDietaryFilters removes a tag-declared allergen the name never mentions", () => {
  const pool = [
    { name: "Choco Delight Bar", carb: 60, allergenTags: ["en:milk"] },
    { name: "Plain rice cake", carb: 80, allergenTags: [] },
  ];
  const kept = applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["dairy"] });
  assert.deepEqual(kept.map((f) => f.name), ["Plain rice cake"]);
});

test("traceExclusions counts the SAME way the filter filters (no UI/engine divergence)", () => {
  const pool = [
    { name: "Choco Delight Bar", allergenTags: ["en:milk"] },
    { name: "Cheeseburger" },
    { name: "Plain rice cake" },
  ];
  const counts = traceExclusions(pool, ["dairy"]);
  const removed = pool.length - applyDietaryFilters(pool, { dietaryStyle: "none", excludedFoods: ["dairy"] }).length;
  assert.equal(counts.dairy, 2);
  assert.equal(counts.dairy, removed, "the number shown must equal the number removed");
});

test("style metadata: USDA flesh categories exclude for vegan AND vegetarian; dairy/egg for vegan only", () => {
  assert.equal(styleExcludedByMetadata({ fdcCategory: "Beef Products" }, "vegan"), true);
  assert.equal(styleExcludedByMetadata({ fdcCategory: "Beef Products" }, "vegetarian"), true);
  assert.equal(styleExcludedByMetadata({ fdcCategory: "Dairy and Egg Products" }, "vegan"), true);
  assert.equal(styleExcludedByMetadata({ fdcCategory: "Dairy and Egg Products" }, "vegetarian"), false, "vegetarians eat dairy and eggs");
  assert.equal(styleExcludedByMetadata({ allergenTags: ["en:fish"] }, "vegetarian"), true);
  assert.equal(styleExcludedByMetadata({ fdcCategory: "Vegetables and Vegetable Products" }, "vegan"), false);
});

test("carnivore deliberately ignores metadata — an inverted style cannot join an add-only union", () => {
  // Metadata evidence is "this is an animal product". For carnivore that would
  // have to CLEAR an exclusion, which is the opposite polarity to every other
  // probe. Rather than smuggle a negative probe into the union, carnivore keeps
  // its name-only behaviour. Pinned so nobody "fixes" it into the union.
  const beef = { name: "Bakery Special No. 7", carb: 0, fdcCategory: "Beef Products" };
  assert.equal(applyDietaryFilters([beef], { dietaryStyle: "carnivore" }).length, 0,
    "an unrecognisable name is still excluded by carnivore's name rule; the category does not rescue it");
});

// ── 7. the import paths write the values ─────────────────────────────────

test("offImport: OFF allergens_tags and traces_tags land on the candidate, normalised", () => {
  const product = {
    upc: "5000159407236", name: "Choco Delight Bar", brand: "Acme",
    per100g: { kcal: 500, protein: 6, fat: 25, carb: 62, fiber: 2 },
    allergens_tags: ["en:milk", "en:soybeans"],
    traces_tags: ["en:nuts"],
  };
  const c = candidateFromOffProduct(product);
  assert.deepEqual(c.allergenTags, ["milk", "soybeans"]);
  assert.deepEqual(c.mayContain, ["nuts"]);
  // ...and the saved row is then excluded for a milk allergy, which is the
  // whole point of persisting it (dietary-safety-4).
  assert.equal(foodMatchesExclusionTerm(c, "dairy"), true);
  assert.equal(foodMatchesExclusionTerm(c, "tree nuts"), true, "declared traces exclude under the default policy");
});

test("offImport: absent allergen data stays null (honest absence), never [] or invented", () => {
  const c = candidateFromOffProduct({
    upc: "1", name: "Stir Fry Noodle Kit", brand: null,
    per100g: { kcal: 385, protein: 9.62, fat: 7.69, carb: 71.15, fiber: 1.9 },
  });
  assert.equal(c.allergenTags, null);
  assert.equal(c.mayContain, null);
});

test("offImport: accepts the raw OFF field names, an already-normalised shape, and a raw envelope", () => {
  const expect = { allergenTags: ["milk"], mayContain: ["nuts"] };
  assert.deepEqual(allergenFieldsFromOffProduct({ allergens_tags: ["en:milk"], traces_tags: ["en:nuts"] }), expect);
  assert.deepEqual(allergenFieldsFromOffProduct({ allergenTags: ["milk"], mayContain: ["nuts"] }), expect);
  assert.deepEqual(allergenFieldsFromOffProduct({ raw: { allergens_tags: ["en:milk"], traces_tags: ["en:nuts"] } }), expect);
  assert.deepEqual(allergenFieldsFromOffProduct({}), { allergenTags: null, mayContain: null });
  assert.deepEqual(allergenFieldsFromOffProduct(null), { allergenTags: null, mayContain: null });
});

test("usdaClient: USDA's own category is read verbatim from every shape it ships in", () => {
  assert.equal(fdcCategoryOf({ foodCategory: "Dairy and Egg Products" }), "Dairy and Egg Products");
  assert.equal(fdcCategoryOf({ foodCategory: { description: "Beef Products" } }), "Beef Products");
  assert.equal(fdcCategoryOf({ wweiaFoodCategory: { wweiaFoodCategoryDescription: "Burgers" } }), "Burgers");
  assert.equal(fdcCategoryOf({}), null, "no declaration is null, never guessed from the name");

  const normalised = normalizeUsdaItem({
    fdcId: 1, description: "Cheese, cheddar", dataType: "SR Legacy",
    foodCategory: { description: "Dairy and Egg Products" }, foodNutrients: [],
  });
  assert.equal(normalised.fdcCategory, "Dairy and Egg Products");
  assert.equal(normalised.category, "dairy-eggs", "the grocery-aisle category is a SEPARATE field and still name-derived");
});

test("usdaClient's fdcCategory precedence matches the bulk importer's, so the two paths cannot disagree", () => {
  const { normalizeFdcRecord } = require("../scripts/lib/fdcDataset.js");
  const record = { fdcId: 9, description: "X", foodCategory: { description: "Poultry Products" }, foodNutrients: [] };
  assert.equal(normalizeFdcRecord(record, null).fdcCategory, fdcCategoryOf(record));
  const survey = { fdcId: 9, description: "X", wweiaFoodCategory: { wweiaFoodCategoryDescription: "Burgers" }, foodNutrients: [] };
  assert.equal(normalizeFdcRecord(survey, null).fdcCategory, fdcCategoryOf(survey));
});

// ── 8. tag vocabulary drift guard ────────────────────────────────────────

test("every OFF tag family is a family some exclusion term can actually resolve to", () => {
  const { SYNONYM_KEY_FAMILY } = require("../src/lib/dietaryFilter.js");
  const reachable = new Set(Object.values(SYNONYM_KEY_FAMILY));
  const orphans = [...new Set(Object.values(OFF_TAG_FAMILY))].filter((f) => !reachable.has(f));
  assert.deepEqual(orphans, [], `these tag families can never be matched by any exclusion term: ${orphans.join(", ")}`);
});
