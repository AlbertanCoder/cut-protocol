const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProfilePatch } = require("../src/routes/profile.js");

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
