const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NUTRIENT_LIST, NUTRIENTS, NUTRIENT_KEYS, getNutrient, nutrientsByGroup, convertUnit } = require("../src/lib/nutrients.js");

// ---------------------------------------------------------------------
// Registry shape / acceptance bar
// ---------------------------------------------------------------------

test("registry covers at least 40 nutrients", () => {
  assert.ok(NUTRIENT_LIST.length >= 40, `expected >= 40 nutrients, got ${NUTRIENT_LIST.length}`);
});

test("registry covers every required category: vitamins, minerals, fibre, fatty acids, amino acids", () => {
  const groups = new Set(NUTRIENT_LIST.map((n) => n.group));
  for (const g of ["vitamin", "mineral", "fiber", "fattyAcid", "aminoAcid"]) {
    assert.ok(groups.has(g), `missing group "${g}"`);
    assert.ok(nutrientsByGroup(g).length > 0, `group "${g}" has no entries`);
  }
});

test("every nutrient key is unique", () => {
  assert.equal(NUTRIENT_KEYS.length, new Set(NUTRIENT_KEYS).size);
});

test("every FDC nutrient id is unique (a duplicate would silently collide two nutrients on import)", () => {
  const ids = NUTRIENT_LIST.map((n) => n.fdcId);
  assert.equal(ids.length, new Set(ids).size);
});

test("every entry has a stable key, display name, canonical unit, and FDC id", () => {
  for (const n of NUTRIENT_LIST) {
    assert.equal(typeof n.key, "string");
    assert.ok(n.key.length > 0);
    assert.equal(typeof n.name, "string");
    assert.ok(n.name.length > 0);
    assert.ok(["g", "mg", "mcg"].includes(n.unit), `${n.key} has an unrecognized unit "${n.unit}"`);
    assert.equal(typeof n.fdcId, "number");
  }
});

test("every target is either null (with a cited reason) or a fully-specified, sourced number", () => {
  for (const n of NUTRIENT_LIST) {
    const t = n.target;
    assert.ok(t, `${n.key} is missing a target object entirely (should at least be a documented null)`);
    if (t.amount == null) {
      assert.equal(typeof t.note, "string", `${n.key}'s null target has no explanatory note`);
      assert.ok(t.note.length > 0);
    } else {
      assert.equal(typeof t.amount, "number");
      assert.ok(t.amount > 0);
      assert.ok(["g", "mg", "mcg"].includes(t.unit));
      assert.ok(["minimum", "maximum"].includes(t.type), `${n.key}'s target needs a minimum/maximum type`);
      assert.equal(typeof t.source, "string", `${n.key}'s target has no cited source`);
      assert.ok(t.source.length > 0);
    }
  }
});

test("fiber is sourced from Food.fiber, not from the micros JSON (single source of truth)", () => {
  const fiber = getNutrient("fiber");
  assert.equal(fiber.sourceField, "fiber");
});

test("no nutrient other than fiber declares a sourceField (micros JSON stays the one other source)", () => {
  for (const n of NUTRIENT_LIST) {
    if (n.key === "fiber") continue;
    assert.equal(n.sourceField, undefined, `${n.key} unexpectedly has a sourceField`);
  }
});

test("getNutrient returns the right entry, or null for an unknown key", () => {
  assert.equal(getNutrient("iron").name, "Iron");
  assert.equal(getNutrient("not-a-real-nutrient"), null);
});

test("ceiling nutrients (sodium, saturated fat, cholesterol) are typed maximum, not minimum", () => {
  for (const key of ["sodium", "saturatedFat", "cholesterol"]) {
    assert.equal(getNutrient(key).target.type, "maximum", `${key} should be a ceiling`);
  }
});

test("NUTRIENTS map and NUTRIENT_LIST stay in sync", () => {
  for (const n of NUTRIENT_LIST) assert.equal(NUTRIENTS[n.key], n);
});

// ---------------------------------------------------------------------
// convertUnit — the unit-conversion primitive
// ---------------------------------------------------------------------

test("convertUnit: same unit is a no-op", () => {
  assert.equal(convertUnit(42, "mg", "mg"), 42);
});

test("convertUnit: mcg -> mg divides by 1000", () => {
  assert.equal(convertUnit(1500, "mcg", "mg"), 1.5);
});

test("convertUnit: g -> mg multiplies by 1000", () => {
  assert.equal(convertUnit(2, "g", "mg"), 2000);
});

test("convertUnit: mg -> mcg multiplies by 1000", () => {
  assert.equal(convertUnit(0.9, "mg", "mcg"), 900);
});

test("convertUnit: g -> mcg chains both factors", () => {
  assert.equal(convertUnit(1, "g", "mcg"), 1_000_000);
});

test("convertUnit: throws loudly on an unsupported unit rather than mis-scaling silently", () => {
  assert.throws(() => convertUnit(5, "mg", "ml"));
  assert.throws(() => convertUnit(5, "kcal", "mg"));
});
