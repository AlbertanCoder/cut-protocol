const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  bmrRows, computeEnergy, deriveTarget, rateSafety, verdict,
  RATE_OPTIONS, SAFE_FLOOR, effectiveFloor,
} = require("../src/lib/bmrEngine.js");

// Reference fixture: male, 33, 185.4 cm, 105.2 kg, 24% BF (the calibration
// numbers the engines have always been checked against — test data, never
// app defaults).
const REF = {
  sex: "M", age: 33, heightCm: 185.4, bodyFatPct: 24,
  occupationKey: "trades-general", activityOverride: null,
  sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
  rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: [],
};
const KG = 105.2;

test("formula table reproduces the reference fixture within tolerance", () => {
  const rows = bmrRows(REF, KG);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, Math.round(r.v)]));
  const near = (got, want, tol = 12) => assert.ok(Math.abs(got - want) <= tol, `${got} !≈ ${want}`);
  near(byKey.mifflin, 2051);
  near(byKey.harris, 2201);
  near(byKey.katch, 2097);
  near(byKey.cunningham, 2259);
  assert.equal(rows.length, 6, "all six formulas applicable for this fixture");
});

test("body-fat-dependent and age-banded formulas hide honestly", () => {
  const noBf = bmrRows({ ...REF, bodyFatPct: 0 }, KG);
  assert.ok(!noBf.some((r) => r.key === "katch" || r.key === "cunningham"));
  const older = bmrRows({ ...REF, age: 65 }, KG);
  assert.ok(!older.some((r) => r.key === "schofield"));
});

test("excluded formulas leave the average; excluding everything falls back", () => {
  const base = computeEnergy(REF, KG);
  const without = computeEnergy({ ...REF, excludedFormulas: ["cunningham"] }, KG);
  assert.ok(without.rmr < base.rmr, "dropping the highest formula lowers the mean");
  assert.ok(base.spreadLo < base.spreadHi);

  const all = computeEnergy({ ...REF, excludedFormulas: ["mifflin", "oxford", "harris", "schofield", "katch", "cunningham"] }, KG);
  assert.equal(all.allExcludedFallback, true);
  assert.ok(all.rmr > 0);
});

test("TDEE = BMR × occupation + training kcal/day; override wins", () => {
  const e = computeEnergy(REF, KG);
  assert.equal(e.jobSource, "occupation");
  assert.equal(e.jobMultiplier, 1.42);
  const expectedTraining = Math.round((3 * 45 * 5 * 3.5 * KG) / 200 / 7);
  assert.equal(e.trainingKcalPerDay, expectedTraining);
  assert.equal(e.tdee, Math.round(e.rmr * 1.42 + expectedTraining));

  const o = computeEnergy({ ...REF, activityOverride: 1.6 }, KG);
  assert.equal(o.jobSource, "override");
  assert.equal(o.jobMultiplier, 1.6);
  assert.ok(o.tdee > e.tdee);
});

test("target derivation: rate → deficit, floors clamp by sex and user floor", () => {
  const t = deriveTarget({ ...REF, rateLbPerWeek: 1.0 }, 3000);
  assert.equal(t.deficit, 500);
  assert.equal(t.target, 2500);
  assert.equal(t.floored, false);

  const female = deriveTarget({ sex: "F", rateLbPerWeek: 2.0, floorKcal: null }, 1900);
  assert.equal(female.floor, SAFE_FLOOR.F);
  assert.equal(female.target, 1200);
  assert.equal(female.floored, true);

  const strict = deriveTarget({ ...REF, rateLbPerWeek: 2.0, floorKcal: 2000 }, 2800);
  assert.equal(strict.floor, 2000);
  assert.equal(strict.target, 2000, "user floor beats the raw 1800 the math wants");
  assert.equal(strict.floored, true);
});

test("user floor can only be stricter — effectiveFloor never dips below sex floor", () => {
  assert.equal(effectiveFloor({ sex: "M", floorKcal: null }), 1500);
  assert.equal(effectiveFloor({ sex: "F", floorKcal: null }), 1200);
  assert.equal(effectiveFloor({ sex: "M", floorKcal: 2000 }), 2000);
  assert.equal(effectiveFloor({ sex: "M", floorKcal: 1000 }), 1500);
});

test("rate safety: >1% of body weight per week or a floored target is unsafe", () => {
  // 150 lb (68 kg) person choosing 2 lb/wk = 1.33%/wk → unsafe.
  const light = rateSafety({ sex: "F", rateLbPerWeek: 2.0, floorKcal: null }, 68, 2400);
  assert.equal(light.unsafe, true);
  assert.ok(light.pctOfBw > 1);

  // Heavy person at 1 lb/wk with room above the floor → safe.
  const ok = rateSafety({ ...REF, rateLbPerWeek: 1.0 }, KG, 3200);
  assert.equal(ok.unsafe, false);

  // Floored target is unsafe even under 1% of body weight.
  const floored = rateSafety({ ...REF, rateLbPerWeek: 1.0, floorKcal: 2000 }, KG, 2300);
  assert.equal(floored.unsafe, true);
});

test("verdict bands derive from the CHOSEN rate — no hardcoded personal band", () => {
  const on = verdict({ rate: 1.0, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.equal(on.tone, "good");

  const slowChosenFast = verdict({ rate: 1.0, chosenRate: 2.0, daysIn: 30, atFloor: false });
  assert.notEqual(slowChosenFast.tone, "good", "1.0 lb/wk is slow AGAINST a 2.0 plan");

  const onSlowPlan = verdict({ rate: 0.5, chosenRate: 0.5, daysIn: 30, atFloor: false });
  assert.equal(onSlowPlan.tone, "good", "0.5 lb/wk is perfect ON a 0.5 plan");

  const fast = verdict({ rate: 2.2, chosenRate: 1.0, daysIn: 30, atFloor: false });
  assert.equal(fast.tone, "warn");

  const atFloor = verdict({ rate: 0.2, chosenRate: 1.0, daysIn: 30, atFloor: true });
  assert.equal(atFloor.tone, "bad");
  assert.ok(/floor/i.test(atFloor.tag));

  const early = verdict({ rate: null, chosenRate: 1.0, daysIn: 3, atFloor: false });
  assert.equal(early.tone, "wait");
});

test("rate options are exactly the spec's menu", () => {
  assert.deepEqual(RATE_OPTIONS, [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);
});

// ===================================================================
// STAGE C AUDIT REGRESSION GUARDS
// ===================================================================

// Mandated: BMR math must match PUBLISHED formulas, not just look plausible.
// Each expected value is hand-computed from the source equation.
test("REGRESSION (Stage C): every BMR formula reproduces its published value to the kcal", () => {
  const kg = 80, cm = 178, one = (p, k) => Math.round(bmrRows(p, kg).find((r) => r.key === k).v);
  const M = { sex: "M", heightCm: cm, bodyFatPct: 20, excludedFormulas: [] };
  const F = { sex: "F", heightCm: cm, bodyFatPct: 28, excludedFormulas: [] };
  // Mifflin–St Jeor: 10kg + 6.25cm - 5a ± (5 M / -161 F)
  assert.equal(one({ ...M, age: 40 }, "mifflin"), Math.round(10 * 80 + 6.25 * 178 - 5 * 40 + 5));
  assert.equal(one({ ...F, age: 40 }, "mifflin"), Math.round(10 * 80 + 6.25 * 178 - 5 * 40 - 161));
  // Harris–Benedict (1984 revised)
  assert.equal(one({ ...M, age: 40 }, "harris"), Math.round(88.362 + 13.397 * 80 + 4.799 * 178 - 5.677 * 40));
  // Katch–McArdle & Cunningham off LBM (20% BF → LBM 64 kg)
  assert.equal(one({ ...M, age: 40 }, "katch"), Math.round(370 + 21.6 * 64));
  assert.equal(one({ ...M, age: 40 }, "cunningham"), Math.round(500 + 22 * 64));
});

// Mandated + fixes the Oxford 60/70 band (#27): Henry 2005's four adult bands,
// both sexes, at published coefficients.
test("REGRESSION (Stage C / #27): Oxford (Henry) uses all four canonical age bands", () => {
  const kg = 80, ox = (sex, age) => Math.round(bmrRows({ sex, heightCm: 175, bodyFatPct: 0, age, excludedFormulas: [] }, kg).find((r) => r.key === "oxford").v);
  assert.equal(ox("M", 25), Math.round(16.0 * 80 + 545), "M 18-30");
  assert.equal(ox("M", 45), Math.round(14.2 * 80 + 593), "M 30-60");
  assert.equal(ox("M", 65), Math.round(13.0 * 80 + 567), "M 60-70 (was the merged non-canonical band)");
  assert.equal(ox("M", 75), Math.round(13.7 * 80 + 481), "M >70");
  assert.equal(ox("F", 25), Math.round(13.1 * 80 + 558), "F 18-30");
  assert.equal(ox("F", 45), Math.round(9.74 * 80 + 694), "F 30-60");
  assert.equal(ox("F", 65), Math.round(10.2 * 80 + 572), "F 60-70");
  assert.equal(ox("F", 75), Math.round(10.0 * 80 + 577), "F >70");
});

// Mandated: the calorie floor. The constitution's RMR×0.95 rail was missing —
// a high-RMR user at an aggressive rate could be prescribed below it.
test("REGRESSION (Stage C / M1): the RMR×0.95 floor engages above the sex minimum", () => {
  // RMR 2060 → RMR×0.95 = 1957, which is above the 1500 M sex floor.
  const floorWithRmr = effectiveFloor({ sex: "M", floorKcal: null }, 2060);
  assert.equal(floorWithRmr, Math.round(2060 * 0.95), "floor rises to RMR×0.95 = 1957");

  // Aggressive-rate target must clamp UP to that floor, not to 1500.
  const t = deriveTarget({ sex: "M", rateLbPerWeek: 2.0, floorKcal: null }, 2471, 2060);
  assert.equal(t.raw, 1471, "TDEE 2471 − 1000 deficit");
  assert.equal(t.floor, 1957, "floor is RMR×0.95, not the 1500 sex minimum");
  assert.equal(t.target, 1957, "target clamps to the RMR floor — no longer ~450 kcal below it");
  assert.equal(t.floored, true);

  // The sex/user floors still win when they are stricter (higher).
  assert.equal(effectiveFloor({ sex: "M", floorKcal: 2100 }, 2060), 2100, "user floor still beats a lower RMR floor");
  // Low-RMR user: RMR×0.95 below the sex floor → sex floor wins, unchanged.
  assert.equal(effectiveFloor({ sex: "F", floorKcal: null }, 1200), SAFE_FLOOR.F, "1200×0.95=1140 < 1200 F floor");
});

// Fix #28: macro carbs must never render negative for a lean/heavy/floored user.
test("REGRESSION (Stage C / #28): carb range never goes negative when protein+fat exceed target", () => {
  const { computeMacros } = require("../src/lib/bmrEngine.js");
  // 120 kg, 8% BF, floored 1500 kcal target → protein+fat midpoint > target.
  const m = computeMacros({ bodyFatPct: 8 }, 120, 1500);
  assert.ok(m.carbMid >= 0, `carbMid must be >= 0, got ${m.carbMid}`);
  assert.ok(m.carbLo >= 0 && m.carbHi >= 0, `carb range must be non-negative, got ${m.carbLo}–${m.carbHi}`);
});
