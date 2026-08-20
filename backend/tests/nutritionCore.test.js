// nutritionCore.test.js — FDC-canonical accounting, hand-computed fixtures.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { macroTotals, netCarbs, atwaterApproxKcal } = require("../src/lib/nutritionCore");

const FOODS = new Map([
  [1, { kcal: 177, protein: 24.1, fat: 8.2, carb: 0, fiber: 0 }],     // chicken thigh /100g
  [2, { kcal: 130, protein: 2.7, fat: 0.3, carb: 28.2, fiber: 0.4 }], // white rice cooked
  [3, { kcal: 884, protein: 0, fat: 100, carb: 0, fiber: 0 }],        // olive oil
  [4, { kcal: 132, protein: 8.9, fat: 0.5, carb: 23.7, fiber: 8.7 }], // black beans
]);

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("macro totals sum per-100g values by grams, at full precision", () => {
  const { ok, totals, missing } = macroTotals(
    [{ foodId: 1, grams: 165 }, { foodId: 2, grams: 200 }, { foodId: 3, grams: 10 }],
    FOODS
  );
  assert.equal(ok, true);
  assert.deepEqual(missing, []);
  // Hand-computed: 177×1.65 + 130×2 + 884×0.1 = 292.05 + 260 + 88.4
  close(totals.kcal, 640.45, "kcal");
  close(totals.protein, 24.1 * 1.65 + 2.7 * 2, "protein");   // 45.165
  close(totals.fat, 8.2 * 1.65 + 0.3 * 2 + 10, "fat");        // 24.13
  close(totals.carb, 28.2 * 2, "carb");                       // 56.4
  close(totals.fiber, 0.4 * 2, "fiber");                      // 0.8
  close(totals.netCarb, 56.4 - 0.8, "netCarb");
});

test("kcal is the FDC-derived sum, and the 4/4/9 approximation genuinely diverges from it", () => {
  const { totals } = macroTotals(
    [{ foodId: 1, grams: 165 }, { foodId: 2, grams: 200 }, { foodId: 3, grams: 10 }],
    FOODS
  );
  const approx = atwaterApproxKcal(totals.protein, totals.fat, totals.carb);
  // 623.43 vs 640.45 — a 17 kcal gap on ONE meal. Over a day this alone can
  // exceed a ±50 kcal verification band, which is why the approximation is
  // display-only and the FDC sum decides.
  assert.ok(Math.abs(approx - totals.kcal) > 10,
    `expected visible divergence, got approx=${approx} fdc=${totals.kcal}`);
});

test("net carbs floor at zero and treat missing fiber as zero (the safe HIGH side for ceilings)", () => {
  assert.equal(netCarbs(10, 25), 0);
  assert.equal(netCarbs(20, undefined), 20);
  assert.equal(netCarbs(undefined, 5), 0);
});

test("high-fiber ingredient: netCarb is visibly below carb", () => {
  const { totals } = macroTotals([{ foodId: 4, grams: 200 }], FOODS);
  close(totals.carb, 47.4, "carb");
  close(totals.fiber, 17.4, "fiber");
  close(totals.netCarb, 30, "netCarb");
});

test("an unresolvable ingredient makes the result UNCERTIFIABLE, never silently zero", () => {
  const { ok, totals, missing } = macroTotals(
    [{ foodId: 1, grams: 100 }, { foodId: 999, grams: 100 }],
    FOODS
  );
  assert.equal(ok, false);
  assert.deepEqual(missing, [999]);
  close(totals.kcal, 177, "the resolvable part still sums, for diagnostics");
});

test("incomplete macros on a food count as missing — a hole is not a zero", () => {
  const broken = new Map([[7, { kcal: 100, protein: null, fat: 1, carb: 5 }]]);
  const { ok, missing } = macroTotals([{ foodId: 7, grams: 100 }], broken);
  assert.equal(ok, false);
  assert.deepEqual(missing, [7]);
});

test("negative or non-finite grams are refused as missing, never summed", () => {
  const { ok, missing } = macroTotals(
    [{ foodId: 1, grams: -50 }, { foodId: 2, grams: NaN }],
    FOODS
  );
  assert.equal(ok, false);
  assert.equal(missing.length, 2);
});

test("works with a plain object map as well as a Map", () => {
  const { ok, totals } = macroTotals(
    [{ foodId: "a", grams: 100 }],
    { a: { kcal: 50, protein: 1, fat: 2, carb: 3, fiber: 1 } }
  );
  assert.equal(ok, true);
  close(totals.kcal, 50, "kcal");
  close(totals.netCarb, 2, "netCarb");
});
