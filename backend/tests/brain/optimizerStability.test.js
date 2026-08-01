// ── brain/optimizer · step-size stability and the weight trap ────────────
//
// Two defects the 2026-07-31 fleet found by reading this file. Neither is
// reachable from the product today: brain/create.js is the only production
// caller of solvePortions and it always passes k=2, which routes to solve2, so
// solveGeneral never runs; and nothing repo-wide reads the returned `residual`.
// The brain is also keyless/dormant. They are latent, not live — which is
// exactly why they need tests before it is wired up.
//
// (1) STEP SIZE. solveGeneral normalised its projected-gradient step by the
//     largest COLUMN energy: lr = 1/(2·maxCol), where maxCol is the largest
//     diagonal of AᵀWA. The gradient's Lipschitz constant is L = 2·λ_max(AᵀWA),
//     and λ_max is bounded by n·maxDiag — so the divisor must carry that n.
//     Meal-recipe columns are strongly correlated (every recipe has a large
//     positive kcal), so this is the ordinary case. At k=7 the step ran ~3.5x
//     over the stability limit. It never diverged, because the box clamp caught
//     it — it OSCILLATED between the bounds and returned a bad point silently
//     after its fixed 200 iterations. A silent bad answer is the failure mode
//     that matters; a thrown error would have been kinder.
//
// (2) WEIGHTS. The defaults are applied to raw squared errors in each axis's own
//     units, so fat/carb are down-weighted by ~4 orders of magnitude rather than
//     "included at low weight". Deliberately NOT changed while the brain is dark
//     — see the note in optimizer.js. The test below MEASURES the current ratio
//     so the decision surfaces the moment anyone wires this up, instead of being
//     inherited silently a third time.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { solvePortions, residualOf, mix } = require("../../src/lib/brain/optimizer.js");

// Strongly-correlated columns: the case that makes λ_max ≫ maxDiag. Every
// "recipe" carries a big positive kcal, which is what real recipes do.
const correlated = (k) => Array.from({ length: k }, (_, i) => ({
  kcal: 400 + i * 25, protein: 30 + i * 2, fat: 12 + i, carb: 40 + i * 3,
}));

test("solveGeneral converges instead of oscillating on correlated columns (k=7)", () => {
  const candidates = correlated(7);
  const target = { kcal: 2000, protein: 150 };
  const { scales, macros } = solvePortions(candidates, target, {});

  assert.equal(scales.length, 7);
  for (const x of scales) {
    assert.ok(Number.isFinite(x), "a diverged or NaN scale is the loud version of this bug");
    assert.ok(x >= 0.5 && x <= 2, `scale ${x} escaped the box`);
  }

  // THIS is the assertion that catches the bug. Measured against the pre-fix
  // step on these same columns: k=3 landed 1,075 kcal, k=5 landed 4,454, k=7
  // landed 3,443 — all against a 2,000 target. With the n in the bound, k=3, 5
  // and 7 all land 2,000 exactly.
  //
  // Note what does NOT work as a detector: box-pinning. Pre-fix k=7 pinned ZERO
  // of 7 coordinates and was still 72% over target, so "most coordinates pinned"
  // would have passed the broken code. The returned point being WRONG is the
  // symptom; where it sits in the box is not.
  assert.ok(Math.abs(macros.kcal - target.kcal) < target.kcal * 0.25,
    `landed ${Math.round(macros.kcal)} kcal against a ${target.kcal} target — pre-fix this was 3,443`);
});

test("solveGeneral is stable as k grows — the n in the step bound is doing work", () => {
  // The old step exceeded the limit by a factor that grows with n. Pre-fix on
  // these columns against a 2,000 kcal target: k=3 -> 1,075, k=5 -> 4,454,
  // k=7 -> 3,443. Post-fix all three land 2,000 exactly.
  const target = { kcal: 2000, protein: 150 };
  for (const k of [3, 5, 7]) {
    const { scales, macros } = solvePortions(correlated(k), target, {});
    assert.equal(scales.length, k);
    for (const x of scales) {
      assert.ok(Number.isFinite(x), `k=${k}: non-finite scale`);
      assert.ok(x >= 0.5 && x <= 2, `k=${k}: scale ${x} escaped the box`);
    }
    assert.ok(Math.abs(macros.kcal - target.kcal) < target.kcal * 0.25,
      `k=${k}: landed ${Math.round(macros.kcal)} kcal against a ${target.kcal} target`);
  }

  // k=10 is a genuinely INFEASIBLE target here — ten correlated recipes at the
  // 0.5x floor already overshoot 2,000 kcal — so it is checked for a clean
  // clamped answer, not for accuracy. Asserting accuracy on an infeasible input
  // would be asserting the solver can break its own bounds.
  const { scales, macros } = solvePortions(correlated(10), target, {});
  assert.ok(scales.every((x) => x >= 0.5 && x <= 2), "k=10: infeasible, but still inside the box");
  assert.ok(Number.isFinite(macros.kcal), "k=10: still a real number");
});

test("solveGeneral stays deterministic — no randomness, no clock", () => {
  const a = solvePortions(correlated(6), { kcal: 1800, protein: 140 }, {});
  const b = solvePortions(correlated(6), { kcal: 1800, protein: 140 }, {});
  assert.deepEqual(a.scales, b.scales);
});

test("the default weights make fat ~4 orders of magnitude cheaper than kcal — pinned, not endorsed", () => {
  // Equal-percentage misses on each axis, priced by the default weights. This is
  // a MEASUREMENT of current behaviour, deliberately left in place while the
  // brain is dark. If someone re-weights the objective, this test fails and the
  // decision becomes explicit rather than inherited.
  const target = { kcal: 2000, protein: 150, fat: 60, carb: 200 };
  const cost = (axis) => {
    const off = { ...target, [axis]: target[axis] * 1.1 }; // a 10% miss on one axis
    return residualOf(off, target) ** 2;
  };

  const kcalCost = cost("kcal");
  const fatCost = cost("fat");
  assert.ok(kcalCost / fatCost > 1000,
    `expected the known ~10,000x imbalance; measured ${Math.round(kcalCost / fatCost)}x`);

  // Spelling out the arithmetic from the source comment so the numbers are checkable.
  assert.equal(Math.round(kcalCost), 40000, "1 x 200^2");
  assert.ok(Math.abs(fatCost - 3.6) < 0.01, "0.1 x 6^2");
});

test("mix() is unchanged by any of this — the macro accumulator is untouched", () => {
  const m = mix([{ kcal: 100, protein: 10, fat: 5, carb: 20 }], [2]);
  assert.deepEqual(m, { kcal: 200, protein: 20, fat: 10, carb: 40 });
});
