const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildPrompt } = require("../../src/lib/aiRecipeClient.js");
const { specHints } = require("../../src/lib/recipeBrain/sources/aiSource.js");
const { buildSpec } = require("../../src/lib/recipeBrain/spec.js");

// ─────────────────────────────────────────────────────────────────────────────
// The spec-hints seam into the governed drafter. Two claims:
//   1. WITHOUT hints, buildPrompt's output is unchanged — the additive params
//      cannot perturb any existing caller (mealRouter, the interactive route);
//   2. WITH hints, the derived numbers appear as app-authored guidance lines.
// Pure string tests; the transport is never involved.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = {
  slotType: "meal", targetKcal: 620, targetProtein: 45,
  excludedFoods: ["peanuts"], dietaryStyle: null, existingRecipeNames: ["Old Bowl"],
};

test("absent hints leave the prompt byte-identical (additive-only change)", () => {
  const before = buildPrompt(BASE);
  const withNulls = buildPrompt({ ...BASE, targetFatG: null, targetCarbG: null, maxCostCad: null, keepSimple: false, proteinDensityHint: null, leanBias: false });
  assert.equal(withNulls, before);
  assert.ok(!/g fat per serving|CAD per serving|protein-dense|Keep it lean|Keep it simple/.test(before), "no hint lines without hints");
});

test("hints appear as derived guidance lines with the spec's own numbers", () => {
  const p = buildPrompt({
    ...BASE,
    targetFatG: { lo: 16.2, hi: 19.2 }, targetCarbG: { lo: 53, hi: 62 },
    maxCostCad: 3.5, keepSimple: true, proteinDensityHint: 7.26, leanBias: true,
  });
  assert.match(p, /16–19 g fat per serving/);
  assert.match(p, /53–62 g carbs per serving/);
  assert.match(p, /7\.3 g protein per 100 kcal/);
  assert.match(p, /\$3\.50 CAD per serving/);
  assert.match(p, /Keep it lean/);
  assert.match(p, /Keep it simple/);
  assert.match(p, /peanuts/, "the walls still ride exactly as before");
});

test("specHints derives the hint set from the spec and only the spec", () => {
  const spec = buildSpec({
    target: { slotType: "meal", kcalTarget: 620, proteinTarget: 45 },
    dailyTarget: { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210, keto: false },
    filters: { budget: "cheap", maxComplexity: 3 },
    profile: {},
  });
  const h = specHints(spec);
  assert.ok(h.targetFatG && h.targetFatG.lo > 0);
  assert.equal(h.maxCostCad, 3.5, "a cheap budget tier implies the tier's own band edge");
  assert.equal(h.keepSimple, true);
  assert.equal(h.proteinDensityHint, spec.proteinDensityMid);
  assert.deepEqual(specHints(null), {});
});

test("a lean emphasis becomes the lean bias hint", () => {
  const spec = buildSpec({
    target: { slotType: "meal", kcalTarget: 620, proteinTarget: 45 },
    dailyTarget: { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210 },
    emphasis: { fat: "lower" },
  });
  assert.equal(specHints(spec).leanBias, true);
});
