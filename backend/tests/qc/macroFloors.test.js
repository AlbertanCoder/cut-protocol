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
    // The assumption still drives lean mass (and therefore fat and the band's top);
    // what it no longer drives is the graded protein floor. Both are asserted below.
    // LBM is off ~21% BF, not 0% BF: protein is nowhere near the ~200 g the old
    // full-bodyweight bug produced for a 176 lb man.
    assert.ok(m.proteinHi < 185, `unknown-BF protein ${m.proteinHi} must not be bodyweight-based`);
    assert.ok(!Number.isNaN(m.proteinLo) && !Number.isNaN(m.carbMid), `bf=${bf} must not produce NaN`);
    // The GRADED FLOOR is bodyweight-derived when body fat is unknown (2026-08-04)
    // — see profileValidation.test.js for the measurement behind that. It is LOWER
    // than the assumed-body-fat floor, so the old full-bodyweight over-prescription
    // this test was written against (~200 g for a 176 lb man) stays impossible.
    assert.equal(m.proteinFloorG, Math.round(80 * 1.6), `bf=${bf} floors on bodyweight`);
    assert.ok(m.proteinFloorG < known.proteinFloorG, "a guess must not out-demand a measurement");
    // The PRESCRIPTION is identical either way — only the graded floor differs.
    assert.equal(m.proteinLo, known.proteinLo);
    assert.equal(m.carbMid, known.carbMid, "everything not the floor is unaffected by the guess");
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
  //
  // ── FIXTURE MOVED 1700 → 1600 kcal (2026-08-03) ──────────────────────────
  // Not a weakened assertion — the same invariant, re-aimed at a target that
  // still reaches it. Fat used to be a fixed 0.34–0.40 g per lb of LBM, a
  // number that did not know the calorie target, so at 1700 kcal this profile
  // was prescribed ~63–74 g of fat and the leftover carb fell under the floor.
  // Fat is now anchored to a SHARE OF ENERGY (the DEFECT 5.5 rewrite in
  // bmrEngine), so the same profile gets ~55–59 g, and the ~130 kcal that
  // frees up lands in carbs: carbMid comes out at 52 g, just clear of the
  // 50 g floor, and `carbFloored` is correctly false.
  //
  // In other words the old fixture stopped being an aggressive deficit — it
  // was only ever aggressive because fat was over-prescribed. The floor
  // itself is unchanged and still engages across the whole lean/heavy region
  // (bf 8–15%, 95–115 kg, 1500–1800 kcal); 1600 puts this profile back inside
  // it. The test failing loudly on the model change is the system working.
  const m = computeMacros({ sex: "M", bodyFatPct: 12, dietaryStyle: "none" }, 95, 1600);
  assert.equal(m.carbFloored, true, "the floor should have engaged");
  assert.ok(m.carbMid >= 0, `carbMid must never be negative, got ${m.carbMid}`);
  assert.ok(m.carbMid <= 50, "carbs are held at the floor, not above");
  assert.ok(m.carbMid >= 40, `feasible floor should hold carbs near 50, got ${m.carbMid}`);
  // fat was borrowed down but stays at/above essential (0.3 g/lb LBM)
  const lbmLb = 95 * 2.20462 * 0.88;
  assert.ok(fatMid(m) >= Math.round(lbmLb * 0.3) - 1, "fat stays at or above essential");
  // and the macros still reconstruct to the target
  assert.ok(Math.abs(reconstruct(m) - 1600) < 20, `feasible floored macros reconstruct: ${Math.round(reconstruct(m))} vs 1600`);
});

test("the old 1700 kcal fixture now clears the floor unaided — the boundary the fat rewrite moved", () => {
  // Locks in WHY the fixture above moved, so the next person to see a diff on
  // this file does not have to re-derive it. If a future change pushes this
  // profile back under the floor, that is a real regression in fat
  // prescription and this test names it rather than leaving it to look like a
  // stale fixture again.
  const m = computeMacros({ sex: "M", bodyFatPct: 12, dietaryStyle: "none" }, 95, 1700);
  assert.equal(m.carbFloored, false, "at 1700 kcal the leftover carb clears 50 g on its own");
  assert.ok(m.carbMid > 50, `carbs land above the floor unaided, got ${m.carbMid}`);
  // Fat sits at essential here, which is the point of the energy-anchored
  // model: it borrows fat DOWN to the floor and no further, and hands the
  // difference to carbohydrate rather than holding a gram count that stopped
  // making sense at this calorie level.
  const lbmLb = 95 * 2.20462 * 0.88;
  assert.ok(fatMid(m) >= Math.round(lbmLb * 0.3) - 1, "fat is at or above essential");
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
