// QC dietitian critic — two correctness bugs in computeMacros:
//   1. bodyFatPct unknown (null/0/undefined) computed LBM off the FULL bodyweight
//      (LBM = weight × (1 − 0)), so a 176 lb man got bodybuilder-level protein
//      (~200 g) instead of ~165. Now an assumed sex-typical BF is used and
//      disclosed (bfAssumed) — the known-BF path is byte-identical.
//   2. A NON-keto target could squeeze carbs to 0 g (silently ketogenic) for a
//      lean/heavy/aggressive-deficit profile. Now carbs hold a 50 g floor with
//      fat borrowed down to essential; a genuinely infeasible target still lands
//      carbs at 0 (never negative) with the overshoot honest in macroKcalGap.
// computeMacros is not part of any golden (the baseline uses a hardcoded target),
// so these are golden-safe by construction.
const test = require("node:test");
const assert = require("node:assert");
const { computeMacros } = require("../../src/lib/bmrEngine.js");

const proteinMid = (m) => (m.proteinLo + m.proteinHi) / 2;
const fatMid = (m) => (m.fatLo + m.fatHi) / 2;
const reconstruct = (m) => proteinMid(m) * 4 + fatMid(m) * 9 + m.carbMid * 4;

test("unknown body fat (null/0/undefined) falls back to a disclosed assumption, not full bodyweight", () => {
  const known = computeMacros({ sex: "M", bodyFatPct: 21, dietaryStyle: "none" }, 80, 2000);
  for (const bf of [null, 0, undefined]) {
    const m = computeMacros({ sex: "M", bodyFatPct: bf, dietaryStyle: "none" }, 80, 2000);
    assert.equal(m.bfAssumed, true, `bf=${bf} must flag the assumption`);
    assert.equal(m.assumedBodyFatPct, 21, `bf=${bf} assumes the M midpoint`);
    // LBM is off ~21% BF, not 0% BF: protein is nowhere near the ~200 g the old
    // full-bodyweight bug produced for a 176 lb man.
    assert.ok(m.proteinHi < 185, `unknown-BF protein ${m.proteinHi} must not be bodyweight-based`);
    assert.ok(!Number.isNaN(m.proteinLo) && !Number.isNaN(m.carbMid), `bf=${bf} must not produce NaN`);
    // all three unknown spellings collapse to the same assumed-BF result
    assert.equal(m.proteinLo, known.proteinLo);
    assert.equal(m.carbMid, known.carbMid);
  }
});

test("known body fat is unchanged and not flagged as assumed", () => {
  const m = computeMacros({ sex: "M", bodyFatPct: 20, dietaryStyle: "none" }, 80, 2000);
  assert.equal(m.bfAssumed, false);
  assert.equal(m.assumedBodyFatPct, null);
  // 80 kg = 176.4 lb, 20% BF -> LBM 141 lb -> protein 1.14-1.25 g/lb
  assert.equal(m.proteinLo, Math.round(176.37 * 0.8 * 1.14));
});

test("female unknown BF uses the female assumption", () => {
  const m = computeMacros({ sex: "F", bodyFatPct: null, dietaryStyle: "none" }, 65, 1600);
  assert.equal(m.bfAssumed, true);
  assert.equal(m.assumedBodyFatPct, 28);
});

test("non-keto carbs never go below the floor when the target can hold them", () => {
  // Lean, heavy, aggressive deficit: leftover carb would be < 50 g.
  const m = computeMacros({ sex: "M", bodyFatPct: 12, dietaryStyle: "none" }, 95, 1700);
  assert.equal(m.carbFloored, true, "the floor should have engaged");
  assert.ok(m.carbMid >= 0, `carbMid must never be negative, got ${m.carbMid}`);
  assert.ok(m.carbMid <= 50, "carbs are held at the floor, not above");
  assert.ok(m.carbMid >= 40, `feasible floor should hold carbs near 50, got ${m.carbMid}`);
  // fat was borrowed down but stays at/above essential (0.3 g/lb LBM)
  const lbmLb = 95 * 2.20462 * 0.88;
  assert.ok(fatMid(m) >= Math.round(lbmLb * 0.3) - 1, "fat stays at or above essential");
  // and the macros still reconstruct to the target
  assert.ok(Math.abs(reconstruct(m) - 1700) < 20, `feasible floored macros reconstruct: ${Math.round(reconstruct(m))} vs 1700`);
});

test("a genuinely infeasible non-keto target lands carbs at 0, never negative (Stage-C / #28)", () => {
  const m = computeMacros({ sex: "M", bodyFatPct: 8, dietaryStyle: "none" }, 120, 1500);
  assert.ok(m.carbMid >= 0 && m.carbLo >= 0 && m.carbHi >= 0, `carb range non-negative, got ${m.carbLo}-${m.carbHi}`);
  assert.equal(m.carbMid, 0, "protein + essential fat already exceed the target");
  assert.equal(m.carbFloored, true);
  assert.ok(m.macroKcalGap < 0, "the overshoot is surfaced honestly, not hidden");
});

test("the common non-keto case is untouched by the floor (byte-for-byte leftover heuristic)", () => {
  const m = computeMacros({ sex: "M", bodyFatPct: 18, dietaryStyle: "none" }, 82, 2000);
  assert.equal(m.carbFloored, false, "a normal cut must not trip the floor");
  assert.ok(m.carbMid > 150, `leftover carbs stay well above the floor, got ${m.carbMid}`);
});
