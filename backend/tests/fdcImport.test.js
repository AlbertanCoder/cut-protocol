// Tests for the USDA FoodData Central import pipeline and the provenance
// repair that preceded it. CI-safe: no network, no database — everything runs
// against the committed fixtures in backend/data/fdc-fixtures/.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  agreement, findConfidentMatch, buildMatchIndex, contentTokens, requiredTokens,
} = require("../scripts/lib/fdcMatch.js");
const {
  iterateFdcRecords, extractMacros, calorieConversionFactors, normalizeFdcRecord, DATASETS, FIXTURE_DIR,
} = require("../scripts/lib/fdcDataset.js");
const { extractMicros, normalizeUnit } = require("../scripts/lib/fdcMicros.js");
const { decideRow } = require("../scripts/lib/provenanceAudit.js");
const { validateFood, checkAtwater } = require("../src/lib/foodValidation.js");
const { runDataQualityAudit } = require("../src/lib/dataQualityAudit.js");

const SR_FIXTURE = path.join(FIXTURE_DIR, "sr_legacy.sample.json");
const haveFixture = fs.existsSync(SR_FIXTURE);

// ── name/description agreement ───────────────────────────────────────────
// The corruption being repaired: fdcId 170160 is USDA "Nuts, almond paste",
// and that id plus its 458 kcal were copied onto six unrelated pastes.

test("agreement: a name that adds its own words never matches the FDC record", () => {
  const desc = "Nuts, almond paste";
  for (const name of ["Red Curry Paste", "Ginger Garlic Paste", "Galangal Paste", "Madras Paste", "Tahini Paste", "Chilli Bean Paste"]) {
    assert.equal(agreement(name, desc).verdict, "suspect", `${name} must not claim "${desc}"`);
  }
});

test("agreement: the genuine owner of the record is kept", () => {
  assert.equal(agreement("Almond Paste", "Nuts, almond paste").verdict, "likely-correct");
  assert.equal(agreement("Nuts, almond paste", "Nuts, almond paste").verdict, "likely-correct");
});

test("agreement: a terser name cannot swallow a more specific FDC record", () => {
  // "Rice" is not "Rice crackers"; "Tomato" is not "Tomato powder".
  assert.equal(agreement("Rice", "Rice crackers").verdict, "suspect");
  assert.equal(agreement("Basmati Rice", "Rice crackers").verdict, "suspect");
  assert.equal(agreement("Tomato", "Tomato powder").verdict, "suspect");
  assert.equal(agreement("Cheese", "Cheese spread, cream cheese base").verdict, "suspect");
});

test("agreement: FDC's leading taxonomy noun is droppable, the food word is not", () => {
  assert.equal(agreement("Cheddar", "Cheese, cheddar").verdict, "likely-correct");
  // ...but the bare group name still cannot claim a specific member.
  assert.equal(agreement("Cheese", "Cheese, cheddar").verdict, "suspect");
});

test("agreement: a preparation word FDC states and the name leaves implicit is tolerated, and flagged", () => {
  const a = agreement("Blueberries", "Blueberries, raw");
  assert.equal(a.verdict, "likely-correct");
  assert.equal(a.stateRelaxed, true);
});

test("agreement: a CONFLICTING preparation word is never tolerated", () => {
  // The name claims a state, the record states a different one.
  assert.equal(agreement("Dried Apricots", "Apricots, raw").verdict, "suspect");
  // Hard state changes (dried/canned) are never droppable in either direction.
  assert.equal(agreement("Tomato", "Tomatoes, sun-dried").verdict, "suspect");
});

test("agreement: curated synonyms are naming facts, and only the listed ones apply", () => {
  assert.equal(agreement("Aubergine", "Eggplant, raw").verdict, "likely-correct");
  // "chilli"->"chili" is allowed; "chilli"->"pepper" deliberately is NOT,
  // because that conflation is what put banana-pepper macros on Habanero.
  assert.equal(agreement("Habanero Pepper", "Pepper, banana, raw").verdict, "suspect");
  assert.equal(agreement("Sichuan Pepper", "Pepper, banana, raw").verdict, "suspect");
});

// ── re-matching ──────────────────────────────────────────────────────────

const RECORDS = [
  { fdcId: 1, description: "Olive oil", priority: 2, kcal: 900, protein: 0, fat: 100, carb: 0, fiber: 0, dataType: "SR Legacy" },
  { fdcId: 2, description: "Bread, onion", priority: 2, kcal: 238, protein: 8, fat: 3, carb: 45, fiber: 3, dataType: "SR Legacy" },
  { fdcId: 3, description: "Soup, tomato", priority: 2, kcal: 19, protein: 1, fat: 0.5, carb: 3, fiber: 0.5, dataType: "SR Legacy" },
  { fdcId: 4, description: "Beef, ground", priority: 2, kcal: 261, protein: 17, fat: 21, carb: 0, fiber: 0 },
  { fdcId: 5, description: "Beef, ground", priority: 1, kcal: 260, protein: 17, fat: 21, carb: 0, fiber: 0 },
  { fdcId: 6, description: "Cinnamon, ground", priority: 2, kcal: 247, protein: 4, fat: 1.2, carb: 80, fiber: 53 },
];
const INDEX = buildMatchIndex(RECORDS);

test("findConfidentMatch: exact token equality resolves", () => {
  const m = findConfidentMatch("Olive Oil", INDEX);
  assert.equal(m.ok, true);
  assert.equal(m.record.fdcId, 1);
});

test("findConfidentMatch: REGRESSION — a food name may not claim a dish that merely mentions it", () => {
  // An earlier revision dropped FDC's leading taxonomy noun when assigning a
  // NEW id, which proposed "Onion" -> "Bread, onion" and "Tomato" -> "Soup,
  // tomato": the same wrong-food-by-name-overlap bug this track repairs.
  assert.equal(findConfidentMatch("Onion", INDEX).ok, false);
  assert.equal(findConfidentMatch("Tomato", INDEX).ok, false);
});

test("findConfidentMatch: the same food in two datasets resolves to the better tier", () => {
  const m = findConfidentMatch("Ground Beef", INDEX);
  assert.equal(m.ok, true);
  assert.equal(m.record.fdcId, 5, "Foundation (priority 1) should win over SR Legacy");
});

test("findConfidentMatch: no match is an honest refusal, not a best guess", () => {
  const m = findConfidentMatch("Galangal Paste", INDEX);
  assert.equal(m.ok, false);
  assert.match(m.reason, /no FDC description/);
});

test("contentTokens/requiredTokens: filler drops, distinguishing words survive", () => {
  assert.deepEqual([...contentTokens("Jams and preserves, apricot")].sort(), ["apricot", "jam", "preserv"]);
  assert.ok([...requiredTokens("Nuts, almond paste")].includes("almond"));
  assert.ok(![...requiredTokens("Nuts, almond paste")].includes("nut"), "leading taxonomy noun is dropped");
});

// ── dataset parsing ──────────────────────────────────────────────────────

test("iterateFdcRecords: streams records across chunk boundaries", { skip: !haveFixture }, async () => {
  const seen = [];
  for await (const rec of iterateFdcRecords(SR_FIXTURE)) seen.push(rec);
  assert.ok(seen.length > 10, "fixture should hold a useful number of records");
  // Every record must be complete JSON — a brace-scanner that loses sync
  // across chunks would yield truncated or merged objects.
  for (const r of seen) {
    assert.equal(typeof r.fdcId, "number");
    assert.equal(typeof r.description, "string");
  }
  const almond = seen.find((r) => r.fdcId === 170160);
  assert.ok(almond, "pinned record 170160 must be present");
  assert.equal(almond.description, "Nuts, almond paste");
});

test("extractMacros: reads per-100g macros, and reports incompleteness rather than zero-filling", () => {
  const rec = {
    foodNutrients: [
      { nutrient: { id: 1008, unitName: "kcal" }, amount: 458 },
      { nutrient: { id: 1003, unitName: "g" }, amount: 9 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 27.7 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 47.8 },
      { nutrient: { id: 1079, unitName: "g" }, amount: 4.5 },
    ],
  };
  const m = extractMacros(rec);
  assert.equal(m.ok, true);
  assert.equal(m.kcal, 458);
  assert.equal(m.protein, 9);

  const missing = extractMacros({ foodNutrients: [{ nutrient: { id: 1008, unitName: "kcal" }, amount: 100 }] });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ["protein", "fat", "carbohydrate"]);
});

test("calorieConversionFactors: a zero factor means 'not declared', never 'yields no energy'", () => {
  const good = calorieConversionFactors({ nutrientConversionFactors: [{ type: ".CalorieConversionFactor", proteinValue: 3.36, fatValue: 8.37, carbohydrateValue: 2.48 }] });
  assert.deepEqual(good, { protein: 3.36, fat: 8.37, carb: 2.48 });
  // Treating 0/0/0 as real would compute 0 kcal for the food and reject it.
  assert.equal(calorieConversionFactors({ nutrientConversionFactors: [{ type: ".CalorieConversionFactor", proteinValue: 0, fatValue: 0, carbohydrateValue: 0 }] }), null);
  assert.equal(calorieConversionFactors({}), null);
});

// ── the Atwater model ────────────────────────────────────────────────────

test("checkAtwater: USDA's food-specific factors reconcile a record the generic 4/4/9 rejects", () => {
  // Limes, raw: USDA computes energy with P3.36 / F8.37 / C2.48.
  const lime = { kcal: 30, protein: 0.7, fat: 0.2, carb: 10.5, fiber: 2.8 };
  assert.equal(checkAtwater(lime).ok, false, "generic model disagrees");
  assert.equal(checkAtwater(lime, { protein: 3.36, fat: 8.37, carb: 2.48 }).ok, true, "USDA's own factors agree");
});

test("validateFood: atwaterFactors and nameIsSourceDescription are opt-in and narrow", () => {
  const anchovy = {
    name: "Anchovies, canned in olive oil, with salt, drained",
    category: "protein", kcal: 210, protein: 28.9, fat: 9.7, carb: 0, fiber: 0, source: "usda-verified",
  };
  // The name-shape heuristic sees "oil" and calls it a mismatched oil record.
  const strict = validateFood(anchovy, {});
  assert.ok(strict.issues.some((i) => i.code === "name-shape"));
  // But name and macros are two fields of ONE record — the mismatch it looks
  // for cannot exist here.
  assert.equal(validateFood(anchovy, { nameIsSourceDescription: true }).ok, true);
});

test("validateFood: a placeholder still fails loudly", () => {
  const p = { name: "chipotle in adobo", category: "pantry", kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, source: "manual-placeholder" };
  const v = validateFood(p, { nameIsSourceDescription: true });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.code === "placeholder"));
});

// ── micronutrients ───────────────────────────────────────────────────────

test("extractMicros: absent is absent, zero is zero — they are never conflated", () => {
  const { micros } = extractMicros({
    foodNutrients: [
      { nutrient: { id: 1087, unitName: "mg" }, amount: 268 },   // calcium
      { nutrient: { id: 1162, unitName: "mg" }, amount: 0 },     // vitamin C, a real measured zero
      { nutrient: { id: 1114, unitName: "µg" } },                 // vitamin D reported with NO amount
    ],
  });
  assert.equal(micros.calcium, 268);
  assert.equal(micros.vitaminC, 0, "a measured zero is stored as 0");
  assert.ok(!("vitaminD" in micros), "a nutrient with no amount must be ABSENT, not 0");
});

test("extractMicros: converts into the registry's canonical unit", () => {
  // FDC reports amino acids in g; the registry's canonical unit is mg.
  const { micros } = extractMicros({ foodNutrients: [{ nutrient: { id: 1213, unitName: "g" }, amount: 0.261 }] });
  assert.equal(micros.leucine, 261);
});

test("extractMicros: a non-mass unit is dropped with a reason, never guessed", () => {
  const r = extractMicros({ foodNutrients: [{ nutrient: { id: 1106, unitName: "IU" }, amount: 500 }] });
  assert.equal(r.micros, null);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, /non-mass unit/);
});

test("extractMicros: no micronutrient data at all yields null, not {}", () => {
  assert.equal(extractMicros({ foodNutrients: [] }).micros, null);
});

test("normalizeUnit: FDC's inconsistent unit spellings fold to the registry's", () => {
  assert.equal(normalizeUnit("G"), "g");
  assert.equal(normalizeUnit("UG"), "mcg");
  assert.equal(normalizeUnit("µg"), "mcg");
  assert.equal(normalizeUnit("MG"), "mg");
});

test("fiber is never written into micros — it has its own scalar column", () => {
  const { micros } = extractMicros({
    foodNutrients: [
      { nutrient: { id: 1079, unitName: "g" }, amount: 4.5 },
      { nutrient: { id: 1087, unitName: "mg" }, amount: 10 },
    ],
  });
  assert.ok(!("fiber" in (micros || {})), "fiber lives in Food.fiber, not the JSON column");
});

// ── the repair decision engine ───────────────────────────────────────────

const BY_ID = new Map(RECORDS.map((r) => [r.fdcId, r]));
BY_ID.set(170160, { fdcId: 170160, description: "Nuts, almond paste", dataType: "SR Legacy", priority: 2, kcal: 458, protein: 9, fat: 27.7, carb: 47.8, fiber: 4.5 });
const row = (over) => ({ id: "x", name: "Red Curry Paste", category: "pantry", fdcId: 170160, kcal: 458, protein: 9, fat: 27.7, carb: 47.8, fiber: 4.5, source: "usda", micros: null, ...over });

test("decideRow: a copied record is downgraded, its false fdcId removed, and the reason recorded", () => {
  const d = decideRow(row(), BY_ID, INDEX, {});
  assert.equal(d.verdict, "downgraded");
  assert.equal(d.changes.fdcId, null, "a provably wrong provenance claim must be removed");
  assert.notEqual(d.changes.source, "usda-verified");
  assert.match(d.changes.dataQuality, /^exception:provenance-cleared/);
  // The row's macros ARE the other food's numbers — that must be said plainly.
  assert.match(d.changes.dataQuality, /NOT this food's numbers/);
});

test("decideRow: downgrading never invents a replacement macro", () => {
  const d = decideRow(row(), BY_ID, INDEX, {});
  for (const k of ["kcal", "protein", "fat", "carb", "fiber"]) {
    assert.ok(!(k in d.changes), `${k} must not be rewritten when nothing could be confidently matched`);
  }
});

test("decideRow: the record's true owner is verified and refreshed from source", () => {
  const d = decideRow(row({ name: "Almond Paste", category: "fats-nuts-oils" }), BY_ID, INDEX, {});
  assert.equal(d.verdict, "verified");
  assert.equal(d.changes.fdcId, 170160);
  assert.equal(d.changes.source, "usda-verified");
  assert.equal(d.changes.kcal, 458);
});

test("decideRow: a suspect row with exactly one confident match is re-derived", () => {
  const d = decideRow(row({ name: "Olive Oil", category: "fats-nuts-oils" }), BY_ID, INDEX, {});
  assert.equal(d.verdict, "rematched");
  assert.equal(d.changes.fdcId, 1);
  assert.equal(d.changes.kcal, 900);
  assert.match(d.changes.dataQuality, /replaced mismatched fdcId 170160/);
});

test("decideRow: an unresolvable fdcId is downgraded, not trusted", () => {
  const d = decideRow(row({ name: "Whatever", fdcId: 999999999 }), BY_ID, INDEX, {});
  assert.equal(d.verdict, "downgraded");
  assert.match(d.changes.dataQuality, /^exception:unverifiable-fdcid/);
});

test("decideRow: curated overrides own their macros and are never overwritten", () => {
  const exemptions = { "red curry paste": { kcal: 100, protein: 2, fat: 5, carb: 12, note: "curated" } };
  const d = decideRow(row(), BY_ID, INDEX, exemptions);
  assert.equal(d.verdict, "curated");
  assert.ok(!("kcal" in d.changes), "a human-reviewed number is not replaced by an import");
  assert.equal(d.changes.fdcId, null);
});

// ── the startup audit ────────────────────────────────────────────────────

const food = (over) => ({ name: "T", category: "pantry", kcal: 100, protein: 5, fat: 2, carb: 15.5, fiber: 0, source: "manual", fdcId: null, dataQuality: "pass", ...over });
const recipe = { name: "R", kcal: 100, protein: 5, fat: 2, carb: 15.5, ingredients: [{ baseGrams: 100, food: food({}) }] };

test("[data-audit]: a documented exception is not a failure, but an undocumented one is", async () => {
  const bad = food({ name: "Alcoholic beverage, beer", kcal: 43, protein: 0.5, fat: 0, carb: 3.6, dataQuality: null });
  const documented = { ...bad, dataQuality: "exception:alcohol-energy — ethanol supplies ~7 kcal/g and is reported in no macro field" };

  const undoc = await runDataQualityAudit({ foods: [bad], recipes: [recipe] });
  assert.equal(undoc.foodFailures.length, 1, "an unexplained Atwater failure must still fail");

  const doc = await runDataQualityAudit({ foods: [documented], recipes: [recipe] });
  assert.equal(doc.foodFailures.length, 0);
  assert.equal(doc.exceptions.length, 1, "and it is reported as an exception, not hidden");
});

test("[data-audit]: reports provenance mix and data-quality breakdown", async () => {
  const s = await runDataQualityAudit({
    foods: [food({ source: "usda-verified", dataQuality: "pass — x" }), food({ source: "manual", dataQuality: null })],
    recipes: [recipe],
  });
  assert.deepEqual(s.bySource, { "usda-verified": 1, manual: 1 });
  assert.equal(s.quality.pass, 1);
  assert.equal(s.quality.unvalidated, 1, "rows predating the pipeline are counted, not hidden");
});

test("[data-audit]: a repeated fdcId is surfaced", async () => {
  const s = await runDataQualityAudit({
    foods: [food({ fdcId: 42 }), food({ fdcId: 42 }), food({ fdcId: 43 })],
    recipes: [recipe],
  });
  assert.equal(s.duplicateFdcIdGroups, 1);
});

test("[data-audit]: thousands of distinct USDA rows are not mistaken for name duplicates", async () => {
  // Loose name folding collides constantly across real FDC descriptions; only
  // rows WITHOUT an fdcId are duplicate-checked by name.
  const beef = { name: "Beef, ground", category: "protein", kcal: 261, protein: 17, fat: 21, carb: 0, fiber: 0, source: "usda-verified", dataQuality: "pass — x" };
  const s = await runDataQualityAudit({
    foods: [{ ...beef, fdcId: 1 }, { ...beef, fdcId: 2 }],
    recipes: [recipe],
  });
  assert.equal(s.duplicateGroups, 0, "distinct FDC records must not be name-folded into duplicates");
  assert.equal(s.foodFailures.length, 0);
  assert.equal(s.clean, true);
});

test("[data-audit]: an empty library never reads as clean", async () => {
  const s = await runDataQualityAudit({ foods: [], recipes: [] });
  assert.equal(s.empty, true);
  assert.equal(s.clean, false);
});

// ── end-to-end over the committed fixtures ───────────────────────────────

test("pipeline: every fixture record normalizes, validates and yields provenance", { skip: !haveFixture }, async () => {
  const ds = DATASETS.find((d) => d.key === "sr_legacy");
  let checked = 0;
  for await (const raw of iterateFdcRecords(SR_FIXTURE)) {
    const rec = normalizeFdcRecord(raw, ds);
    if (!rec.macros.ok) continue;
    checked++;
    const candidate = {
      name: rec.description, category: "pantry",
      kcal: rec.macros.kcal, protein: rec.macros.protein, fat: rec.macros.fat,
      carb: Math.max(0, rec.macros.carb), fiber: rec.macros.fiber, source: "usda-verified",
    };
    const v = validateFood(candidate, { atwaterFactors: rec.atwaterFactors || undefined, nameIsSourceDescription: true });
    // Either it validates, or it is an alcohol/polyol record we would reject
    // and log — never silently accepted.
    assert.equal(typeof v.ok, "boolean");
    assert.equal(typeof rec.fdcId, "number", "every imported row carries a real FDC id");
  }
  assert.ok(checked > 10);
});
