// prescription feasibility — arithmetic-impossibility screen at target time.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkTargetFeasibility } = require("../../src/lib/prescription/feasibility.js");

test("the founder profile's numbers add up as food (P0 fixture values)", () => {
  const r = checkTargetFeasibility({
    kcal: 2150, proteinG: { lo: 200, hi: 220 }, fatG: { lo: 60, hi: 70 },
    netCarbG: { lo: 135, hi: 160 }, floorKcal: 2000,
  });
  assert.equal(r.feasible, true, `implied ${JSON.stringify(r.impliedKcal)} vs band ${JSON.stringify(r.kcalBand)}`);
});

test("an impossible combination is caught BEFORE any solver runs, with carbs flexed first", () => {
  // 1,200 kcal against 200 g protein + 80 g fat: protein+fat alone imply
  // ≥ 1,372 kcal at the LOWEST per-gram factors — no food can satisfy it.
  const r = checkTargetFeasibility({ kcal: 1200, proteinG: 200, fatG: 80, netCarbG: 100 });
  assert.equal(r.feasible, false);
  assert.ok(r.suggestion, "an infeasible target must ship a one-tap suggestion");
  assert.match(r.suggestion.note, /don't add up as food|has to move/);
});

test("when even flexed carbs would breach a keto ceiling, the note says the ceiling is the problem", () => {
  // 2,800 kcal at modest protein/fat forces carbs far above a 25 g ceiling.
  const r = checkTargetFeasibility({ kcal: 2800, proteinG: 120, fatG: 80, netCarbG: 20, netCarbMaxG: 25 });
  assert.equal(r.feasible, false);
  assert.match(r.suggestion.note, /ceiling/);
  assert.ok(r.suggestion.netCarbG > 25);
});

test("generous by design: tight-but-real targets are not flagged", () => {
  const r = checkTargetFeasibility({ kcal: 1600, proteinG: 140, fatG: 45, netCarbG: 130 });
  assert.equal(r.feasible, true);
});
