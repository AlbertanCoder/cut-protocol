// prescription levers — per-role scaling, directive bounds, honest rounding.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LEVER_BOUNDS, solveLevers, roundGrams, applyLevers } = require("../../src/lib/prescription/levers.js");

const CHICKEN = { kcal: 165, protein: 31, fat: 3.6, carb: 0, fiber: 0 };
const RICE = { kcal: 130, protein: 2.7, fat: 0.3, carb: 28, fiber: 0.4 };
const OIL = { kcal: 884, protein: 0, fat: 100, carb: 0, fiber: 0 };
const GARLIC = { kcal: 143, protein: 7, fat: 0, carb: 28, fiber: 2 };

const rows = () => [
  { grams: 200, scalable: true, role: "protein", food: CHICKEN },
  { grams: 180, scalable: true, role: "carb", food: RICE },
  { grams: 10, scalable: true, role: "fat", food: OIL },
  { grams: 6, scalable: false, role: "other", food: GARLIC },
];

test("directive lever bounds are exactly as specified", () => {
  assert.deepEqual(LEVER_BOUNDS.protein, { lo: 0.5, hi: 2.5 });
  assert.deepEqual(LEVER_BOUNDS.carb, { lo: 0.3, hi: 2.5 });
  assert.deepEqual(LEVER_BOUNDS.fat, { lo: 0.5, hi: 2.0 });
});

test("the solve moves each role independently toward the target", () => {
  // Base dish: 653 kcal / 68 p. Ask for more protein at similar kcal — the
  // protein lever must rise while carbs give way.
  const { scales, achieved } = solveLevers(rows(), { kcal: 650, protein: 95 });
  assert.ok(scales.protein > 1.2, `protein lever should rise, got ${scales.protein}`);
  assert.ok(scales.carb < 1, `carb lever should yield, got ${scales.carb}`);
  assert.ok(Math.abs(achieved.protein - 95) < 7, `protein lands within a band: ${achieved.protein}`);
  assert.ok(Math.abs(achieved.kcal - 650) < 50, `kcal lands within a band: ${achieved.kcal}`);
});

test("clamps hold: an absurd ask pins levers at their bounds, never past", () => {
  const { scales } = solveLevers(rows(), { kcal: 4000, protein: 400 });
  assert.equal(scales.protein, 2.5);
  assert.equal(scales.carb, 2.5);
  assert.equal(scales.fat, 2.0);
});

test("scalable:false rows never move, whatever the ask", () => {
  const { rows: out } = applyLevers(rows(), { protein: 2.5, carb: 2.5, fat: 2, other: 2 });
  const garlic = out.find((r) => r.food === GARLIC);
  assert.equal(garlic.grams, 6, "fixed aromatics are frozen at 1×");
});

test("rounding: 5 g steps for ordinary food, 1 g for calorie-dense, never 0 for a real amount", () => {
  assert.equal(roundGrams(163, CHICKEN), 165);
  assert.equal(roundGrams(11.4, OIL), 11, "oil is 1 g-stepped (≥500 kcal/100 g)");
  assert.equal(roundGrams(0.4, OIL), 1, "a real amount never rounds to 0");
  assert.equal(roundGrams(7.6, RICE), 8, "under 20 g goes to whole grams");
});

test("totals are recomputed FROM the rounded grams — the shipped number is the eaten number", () => {
  const { rows: out, totals } = applyLevers(rows(), { protein: 1.13, carb: 0.87, fat: 1.4, other: 1 });
  let expect = 0;
  for (const r of out) expect += r.food.kcal * (r.grams / 100);
  assert.ok(Math.abs(totals.kcal - expect) < 1e-9, "kcal must be the sum over ROUNDED grams, not pre-rounding math");
});

test("net carbs derive from carb minus fiber in the recomputation", () => {
  const { totals } = applyLevers([{ grams: 200, scalable: true, role: "carb", food: RICE }], { carb: 1 });
  assert.ok(Math.abs(totals.netCarb - (56 - 0.8)) < 1e-9);
});

// ── aromatic ceiling (fleet, 2026-08-20) ──────────────────────────────────
// Customers were prescribed 50-105 g of bay leaves and 25-155 g of thyme:
// herb rows are ordinary "other" levers to the math, so recipe-data warts
// scaled up like food. Dried herbs/spices cap at 10 g, fresh at 60 g, keyed
// on the FDC category the gate already loads.

const BAY_DRIED = { kcal: 313, protein: 7.6, fat: 8.4, carb: 75, fiber: 26, fdcCategory: "Spices and Herbs" };
const BASIL_FRESH = { kcal: 23, protein: 3.2, fat: 0.6, carb: 2.7, fiber: 1.6, fdcCategory: "Spices and Herbs" };

test("aromatics: a bowl of bay leaves cannot leave the solver", () => {
  const { aromaticCapG } = require("../../src/lib/prescription/levers.js");
  assert.equal(aromaticCapG(BAY_DRIED), 10, "dried herb caps at 10 g");
  assert.equal(aromaticCapG(BASIL_FRESH), 60, "fresh herb caps at 60 g (a pistou is legitimate)");
  assert.equal(aromaticCapG(CHICKEN), null, "food is not capped");
  // Through the rounding choke point: a 50 g bay-leaf row scaled 2x lands at 10 g.
  assert.equal(roundGrams(100, BAY_DRIED), 10);
  assert.equal(roundGrams(155, BASIL_FRESH), 60);
  // Small honest amounts are untouched.
  assert.equal(roundGrams(2, BAY_DRIED), 2);
  assert.equal(roundGrams(30, BASIL_FRESH), 30);
});

test("aromatics: applyLevers caps the plated grams even when the lever asked for more", () => {
  const { rows: out } = applyLevers(
    [{ grams: 50, scalable: true, role: "other", food: BAY_DRIED }],
    { other: 2.0 }
  );
  assert.equal(out[0].grams, 10, `50 g bay leaves x2.0 lever must plate 10 g, got ${out[0].grams}`);
});

test("aromatics: the NAME fallback caps herb rows that carry no FDC category", () => {
  const { aromaticCapG } = require("../../src/lib/prescription/levers.js");
  // Slice 3 (2026-08-21): a 135 g thyme portion sailed past the
  // category-only check — label-entered rows carry no fdcCategory.
  assert.equal(aromaticCapG({ name: "Thyme", kcal: 276 }), 10, "dried thyme by name alone");
  assert.equal(aromaticCapG({ name: "Thyme, fresh", kcal: 101 }), 60);
  assert.equal(aromaticCapG({ name: "Turkey sausages", kcal: 180 }), null, "'sage' inside 'sausages' never matches");
  assert.equal(aromaticCapG({ name: "Peppermint tea", kcal: 1 }), null, "'mint' inside 'peppermint' never matches");
});
