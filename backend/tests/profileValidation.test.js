const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProfilePatch } = require("../src/routes/profile.js");
const { computeMacros, kg2lb } = require("../src/lib/bmrEngine.js");

// Stage-C regression guards (findings C5/L2 + M11/L3): the packaged app
// accepted absurd vitals and a poisoned excludedFoods array live. These lock
// the input validation so those can never silently corrupt targets or 500
// the recipe screens again.

const ok = (patch) => assert.equal(validateProfilePatch(patch).length, 0, `should be valid: ${JSON.stringify(patch)}`);
const bad = (patch, re) => {
  const errs = validateProfilePatch(patch);
  assert.ok(errs.length > 0, `should be rejected: ${JSON.stringify(patch)}`);
  if (re) assert.ok(errs.some((e) => re.test(e)), `expected an error matching ${re}, got: ${errs.join(" | ")}`);
};

test("REGRESSION (C5/L2): absurd or zeroed vitals are rejected, not silently saved", () => {
  bad({ age: 0 }, /age/);
  bad({ age: -5 }, /age/);
  bad({ age: 3 }, /age/);
  bad({ age: 200 }, /age/);
  bad({ heightCm: 0 }, /height/i);
  bad({ heightCm: -10 }, /height/i);
  bad({ startWeightKg: 0 }, /weight/i);
  bad({ goalWeightKg: 0 }, /goal/i);
  bad({ goalWeightKg: -20 }, /goal/i);
  bad({ bodyFatPct: 120 }, /bodyFat/i);
  bad({ age: "thirty" }, /age/);
  bad({ heightCm: NaN }, /height/i);
});

test("REGRESSION (C5): sane vitals still pass", () => {
  ok({ age: 33, heightCm: 182, startWeightKg: 88, goalWeightKg: 79, bodyFatPct: 24 });
  ok({ age: 14 }); ok({ age: 100 });
  ok({ heightCm: 100 }); ok({ heightCm: 250 });
  ok({ bodyFatPct: 0 }); ok({ bodyFatPct: null }); // 0/null = unknown
  ok({}); // an empty patch touches nothing and is valid
});

test("E2 (v2): bodyFatSource accepts the enum or null, rejects anything else", () => {
  ok({ bodyFatSource: "visual-estimate" });
  ok({ bodyFatSource: "measured" });
  ok({ bodyFatSource: null });
  bad({ bodyFatSource: "guessed" }, /bodyFatSource/);
  bad({ bodyFatSource: 5 }, /bodyFatSource/);
  bad({ bodyFatSource: "MEASURED" }, /bodyFatSource/); // case-sensitive enum
});

test("REGRESSION (M11/L3): a poisoned excludedFoods array is rejected before it can 500 the app", () => {
  bad({ excludedFoods: [5] }, /excludedFoods/);
  bad({ excludedFoods: [null] }, /excludedFoods/);
  bad({ excludedFoods: ["shellfish", 7] }, /excludedFoods/);
  bad({ excludedFoods: [""] }, /excludedFoods/);
  bad({ excludedFoods: ["   "] }, /excludedFoods/);
  bad({ excludedFoods: "shellfish" }, /excludedFoods/); // not an array
  bad({ excludedFoods: [{ junk: true }] }, /excludedFoods/);
  bad({ excludedFoods: ["x".repeat(61)] }, /excludedFoods/);
});

test("REGRESSION (M11): a clean excludedFoods array passes", () => {
  ok({ excludedFoods: [] });
  ok({ excludedFoods: ["shellfish", "kiwi"] });
  ok({ excludedFoods: ["soy protein", "custom thing"] });
});

// ── Wave 6 · onboarding-flow-4 · what "bodyFatPct = 0/null = unknown" DOES ──
//
// The two cases above lock that 0 and null are ACCEPTED as "unknown". These
// lock what happens downstream, because the protein prescription is per-lb of
// LEAN mass and an unknown body fat used to make lean mass = TOTAL bodyweight —
// a 232 lb man was handed ~264-290 g of protein off a bodybuilder's LBM he does
// not have. Hand-checked arithmetic, spelled out so a reader can verify it
// without running anything:
//
//   232.00 lb total weight, male, body fat unknown
//   assumed body fat 21 %  (ACE adult midpoint; F would be 28 %)
//   lean mass = 232.00 × (1 − 0.21) = 183.28 lb
//   protein   = 183.28 × 1.14 = 208.94 → 209 g   ·   × 1.25 = 229.10 → 229 g
//   the OLD bug: 232.00 × 1.14 = 264 g · × 1.25 = 290 g   ← must never reappear
//
// NOTE for anyone reading the finding text: the fallback is an assumed-body-fat
// estimate, NOT the Boer LBM equation. Boer on this man (185.42 cm) gives
// 0.407×105.23 + 0.267×185.42 − 19.2 = 73.14 kg = 161.24 lb, a 30.5 % implied
// body fat and a 184-202 g protein range — a different, more conservative
// answer. Whichever is preferred, the number is an ESTIMATE and must be
// labelled as one; `bfAssumed`/`assumedBodyFatPct` is that label.
const M232 = { sex: "M", age: 32, heightCm: 185.42, dietaryStyle: null };
const KG232 = 232 / 2.20462;

test("onboarding-flow-4: unknown body fat derives lean mass from an ASSUMED body fat, not total weight", () => {
  for (const bf of [0, null, undefined]) {
    const m = computeMacros({ ...M232, bodyFatPct: bf }, KG232, 2202);
    assert.ok(Math.abs(m.lbmLb - 183.28) < 0.01, `bf=${bf} lbmLb ${m.lbmLb} should be 183.28`);
    assert.equal(m.proteinLo, 209);
    assert.equal(m.proteinHi, 229);
    // the bug, named so it can never quietly return
    assert.notEqual(m.proteinLo, 264);
    assert.notEqual(m.proteinHi, 290);
    assert.ok(Math.abs(m.lbmLb - kg2lb(KG232)) > 40, "lean mass must not be total bodyweight");
  }
});

test("onboarding-flow-4: the assumption is LABELLED in the returned data, per sex", () => {
  const male = computeMacros({ ...M232, bodyFatPct: 0 }, KG232, 2202);
  assert.equal(male.bfAssumed, true);
  assert.equal(male.assumedBodyFatPct, 21);

  const female = computeMacros({ ...M232, sex: "F", bodyFatPct: null }, 70, 1800);
  assert.equal(female.bfAssumed, true);
  assert.equal(female.assumedBodyFatPct, 28);
  assert.ok(Math.abs(female.lbmLb - kg2lb(70) * 0.72) < 0.01, `lbmLb ${female.lbmLb}`);

  // a KNOWN body fat is never dressed up as an assumption
  const known = computeMacros({ ...M232, bodyFatPct: 24 }, KG232, 2202);
  assert.equal(known.bfAssumed, false);
  assert.equal(known.assumedBodyFatPct, null);
  assert.ok(Math.abs(known.lbmLb - kg2lb(KG232) * 0.76) < 0.01, `lbmLb ${known.lbmLb}`);
});

test("onboarding-flow-4: the keto branch carries the same label — no unlabelled side door", () => {
  const m = computeMacros({ ...M232, bodyFatPct: 0, dietaryStyle: "keto" }, KG232, 2202);
  assert.equal(m.keto, true);
  assert.equal(m.bfAssumed, true);
  assert.equal(m.assumedBodyFatPct, 21);
  assert.ok(Math.abs(m.lbmLb - 183.28) < 0.01);
});
