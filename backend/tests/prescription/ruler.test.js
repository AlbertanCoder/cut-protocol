// prescription ruler — directive §3.2 bands, ceilings-truncate, floor
// supremacy, and the §3.3.4 scan line.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BANDS, resolveBands, dayVerdict, allergenScanLine } = require("../../src/lib/prescription/ruler.js");

test("point targets get the directive band widths around them", () => {
  const b = resolveBands({ kcal: 2000, proteinG: 180, fatG: 65, netCarbG: 150 });
  assert.deepEqual([b.kcal.lo, b.kcal.hi], [1950, 2050]);
  assert.deepEqual([b.proteinG.lo, b.proteinG.hi], [173, 187]);
  assert.deepEqual([b.fatG.lo, b.fatG.hi], [58, 72]);
  assert.deepEqual([b.netCarbG.lo, b.netCarbG.hi], [140, 160]);
  assert.deepEqual(BANDS, { kcal: 50, proteinG: 7, fatG: 7, netCarbG: 10 });
});

test("a RANGE target IS the band — no widening", () => {
  const b = resolveBands({ kcal: 2150, proteinG: { lo: 200, hi: 220 }, fatG: { lo: 60, hi: 70 }, netCarbG: { lo: 135, hi: 160 } });
  assert.deepEqual([b.proteinG.lo, b.proteinG.hi], [200, 220]);
  assert.equal(b.proteinG.mid, 210);
});

test("a ceiling TRUNCATES the band, never licenses crossing it (keto §3.2)", () => {
  const b = resolveBands({ kcal: 2400, proteinG: 150, fatG: 190, netCarbG: 20, netCarbMaxG: 25 });
  assert.equal(b.netCarbG.hi, 25, "the ±10 band would reach 30; the ceiling caps it at 25");
  const v = dayVerdict({ kcal: 2400, protein: 150, fat: 190, netCarb: 27 }, { kcal: 2400, proteinG: 150, fatG: 190, netCarbG: 20, netCarbMaxG: 25 });
  assert.equal(v.inBand, false);
  assert.ok(v.misses.some((m) => m.key === "netCarbG" && m.kind === "over"));
});

test("the kcal floor outranks the band's lower edge", () => {
  const b = resolveBands({ kcal: 1900, proteinG: 150, fatG: 60, netCarbG: 150, floorKcal: 2000 });
  assert.equal(b.kcal.lo, 2000, "the band may never license eating below the floor");
});

test("verdict: in-band day reads clean; misses carry direction and magnitude", () => {
  const t = { kcal: 2000, proteinG: 180, fatG: 65, netCarbG: 150 };
  assert.equal(dayVerdict({ kcal: 2010, protein: 182, fat: 63, netCarb: 155 }, t).inBand, true);
  const v = dayVerdict({ kcal: 2080, protein: 170, fat: 63, netCarb: 155 }, t);
  assert.equal(v.inBand, false);
  const kcalMiss = v.misses.find((m) => m.key === "kcal");
  assert.equal(kcalMiss.kind, "over");
  assert.ok(Math.abs(kcalMiss.by - 30) < 1e-9);
  assert.ok(v.misses.some((m) => m.key === "proteinG" && m.kind === "under"));
});

test("FAIL CLOSED: a dimension the caller never specified is a MISS, not a silent pass (review finding)", () => {
  // NaN comparisons are all false — before this fix an undefined netCarbG
  // produced a NaN band that "verified" as in-band without ever measuring.
  const v = dayVerdict({ kcal: 2000, protein: 180, fat: 65, netCarb: 150 }, { kcal: 2000, proteinG: 180, fatG: 65 });
  assert.equal(v.inBand, false);
  assert.ok(v.misses.some((m) => m.key === "netCarbG" && m.kind === "unspecified-target"));
  const half = dayVerdict({ kcal: 2000, protein: 180, fat: 65, netCarb: 150 }, { kcal: 2000, proteinG: 180, fatG: 65, netCarbG: { lo: 120 } });
  assert.equal(half.inBand, false, "a {lo}-only range is malformed, not a pass");
});

test("the allergen scan line matches the directive's machine-written shape", () => {
  const line = allergenScanLine({ profile: ["gluten", "soy", "shellfish", "kiwi"], ingredientCount: 41, hits: [] });
  assert.equal(line, "allergen_scan: PASS (profile: gluten, soy, shellfish, kiwi) — 0 hits across 41 ingredients");
  assert.match(allergenScanLine({ profile: ["eggs"], ingredientCount: 12, hits: ["Mayo Bowl (slot meal#0)"] }), /^allergen_scan: FAIL/);
});
