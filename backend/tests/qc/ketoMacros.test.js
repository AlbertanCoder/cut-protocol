// QC customer #6 (strict keto) — "keto" mode wasn't ketogenic: computeMacros
// never branched on diet (carbs were leftover kcal ~150 g), and the recipe keto
// filter checked base carb GRAMS while the solver scaled portions up to 2x, so
// grain/starch dishes shipped on a keto plate. These pin both fixes.
const test = require("node:test");
const assert = require("node:assert");
const bmr = require("../../src/lib/bmrEngine.js");
const { recipeExceedsKetoCeiling } = require("../../src/lib/dietaryFilter.js");

test("keto macro target caps carbs and lets fat fill the balance", () => {
  const profile = { sex: "M", bodyFatPct: 22, dietaryStyle: "keto" };
  const m = bmr.computeMacros(profile, 95, 2043);
  assert.ok(m.carbHi <= 30, `keto carb ceiling ${m.carbHi} must be <= 30`);
  assert.ok(m.carbMid <= 30, `keto carb target ${m.carbMid} must be low`);
  // fat must fill most of the remaining calories (not the old 0.34-0.4 g/lb LBM)
  const fatMid = (m.fatLo + m.fatHi) / 2;
  const proteinMid = (m.proteinLo + m.proteinHi) / 2;
  const reconstructed = proteinMid * 4 + fatMid * 9 + m.carbMid * 4;
  assert.ok(Math.abs(reconstructed - 2043) < 60, `keto macros should roughly reconstruct the target: ${Math.round(reconstructed)} vs 2043`);
  assert.equal(m.keto, true);
});

test("NON-keto macro target is unchanged (leftover-carb heuristic) — golden safety", () => {
  const profile = { sex: "M", bodyFatPct: 22, dietaryStyle: "none" };
  const m = bmr.computeMacros(profile, 95, 2043);
  assert.equal(m.keto, undefined, "non-keto must not carry the keto flag");
  // carbs are the leftover (well above a keto cap) — proves the branch didn't leak
  assert.ok(m.carbMid > 40, `non-keto carbs ${m.carbMid} should be the leftover, not capped`);
});

test("keto recipe filter is SCALE-INVARIANT (carb energy fraction, not base grams)", () => {
  // 28 g carb / 400 kcal = 28% carb-cal -> excluded, at any portion size
  const carby = { carb: 28, kcal: 400 };
  assert.equal(recipeExceedsKetoCeiling(carby, "keto"), true);
  // doubling the portion keeps the fraction -> still excluded (the old base-gram
  // ceiling of 30 g would have PASSED the 28 g base and shipped 56 g at 2x)
  const scaled2x = { carb: 56, kcal: 800 };
  assert.equal(recipeExceedsKetoCeiling(scaled2x, "keto"), true);
  // a genuinely low-carb dish stays
  assert.equal(recipeExceedsKetoCeiling({ carb: 5, kcal: 500 }, "keto"), false);
  // non-keto never excluded by this rule
  assert.equal(recipeExceedsKetoCeiling(carby, "none"), false);
});
