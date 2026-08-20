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
