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
