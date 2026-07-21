const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clampProposedTier, recomputeAgg, effectiveTasteScore, TIER_SCORE } = require("../../src/lib/brain/taste.js");
const { scorePlan } = require("../../src/lib/brain/scorer.js");

test("clampProposedTier: the LLM can never mint 'exceptional'; invalid → decent", () => {
  assert.equal(clampProposedTier("exceptional"), "really_good");
  assert.equal(clampProposedTier("really_good"), "really_good");
  assert.equal(clampProposedTier("decent"), "decent");
  assert.equal(clampProposedTier("garbage"), "decent");
  assert.equal(clampProposedTier(null), "decent");
});

test("recomputeAgg: thumbs → 0..1 mean + count", () => {
  assert.deepEqual(recomputeAgg([]), { userRatingAvg: null, userRatingCount: 0 });
  assert.deepEqual(recomputeAgg([{ rating: 1 }, { rating: 1 }, { rating: -1 }]), { userRatingAvg: 2 / 3, userRatingCount: 3 });
});

test("effectiveTasteScore: cold-start returns the curated prior (null → decent)", () => {
  assert.equal(effectiveTasteScore({ tasteTier: "really_good", userRatingCount: 0 }), TIER_SCORE.really_good);
  assert.equal(effectiveTasteScore({ tasteTier: null }), TIER_SCORE.decent);
});

test("effectiveTasteScore: Bayesian shrinkage blends prior with ratings", () => {
  const s = effectiveTasteScore({ tasteTier: "decent", userRatingAvg: 1.0, userRatingCount: 6 }); // (0.5*3 + 1*6)/9
  assert.ok(Math.abs(s - (0.5 * 3 + 1 * 6) / 9) < 1e-9);
  assert.ok(s > 0.5 && s <= 1, "many likes pull above the decent prior");
  assert.ok(effectiveTasteScore({ tasteTier: "really_good", userRatingAvg: 0, userRatingCount: 10 }) < TIER_SCORE.really_good, "many dislikes pull below the prior");
});

test("scorer taste term: ZERO without a taste signal (byte-identical), positive when tagged", () => {
  const target = { kcal: 2000, proteinLo: 150, proteinHi: 190, fatLo: 50, fatHi: 80, carbLo: 150, carbHi: 250 };
  const slot = { recipeId: "a", kcal: 2000, protein: 170, carb: 200, fat: 65 };
  const noSignal = scorePlan({ slots: [slot] }, target);
  assert.equal(noSignal.breakdown.terms.taste, 0, "no tasteTier/rating → taste contributes nothing");
  const tagged = scorePlan({ slots: [{ ...slot, tasteTier: "decent" }] }, target);
  assert.ok(tagged.breakdown.terms.taste > 0, "a tagged decent recipe adds a small taste penalty");
  // taste must never dominate: an otherwise-perfect plan stays high-scoring
  assert.ok(tagged.score > 0.9, `taste is a light nudge, not a wall (score ${tagged.score})`);
});
