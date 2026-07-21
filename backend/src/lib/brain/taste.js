// Brain v2 Stage T — taste-quality tier + rating blend. Pure, keyless, dormant
// until the brain scorer reads it. A SOFT re-rank ONLY: it never removes a safe
// candidate (Law 2 — that stays in exclusions), and effectiveTasteScore is an
// INTERNAL ranking weight, never a displayed number (Law 1).
const TIERS = ["decent", "really_good", "exceptional"];
const TIER_ORDINAL = { decent: 1, really_good: 2, exceptional: 3 };
// Curated prior mapped to a 0..1 score.
const TIER_SCORE = { decent: 0.5, really_good: 0.75, exceptional: 1.0 };
const SHRINK_K = 3; // prior weight for Bayesian shrinkage (cold-start safe)

// The LLM may PROPOSE a tier but can never mint "exceptional" — capped at
// really_good, tagged source 'llm'. Curated/user_derived outrank llm upstream.
function clampProposedTier(tier) {
  if (tier === "exceptional") return "really_good";
  return TIERS.includes(tier) ? tier : "decent";
}

// RecipeRating (Stage 5) is a thumb: 1 like / -1 dislike. Normalise to 0..1.
function ratingToScore(rating) { return rating > 0 ? 1 : rating < 0 ? 0 : 0.5; }

// Cache aggregate from a set of RecipeRating rows [{rating}].
function recomputeAgg(ratingRows = []) {
  const scores = ratingRows.map((x) => ratingToScore(x.rating));
  const userRatingCount = scores.length;
  const userRatingAvg = userRatingCount ? scores.reduce((s, v) => s + v, 0) / userRatingCount : null;
  return { userRatingAvg, userRatingCount };
}

// Blend the curated prior (from tier, null → decent) with the user-rating
// aggregate by Bayesian shrinkage. Cold-start returns the prior; many ratings
// approach the rating mean. Always in [0,1].
function effectiveTasteScore({ tasteTier = null, userRatingAvg = null, userRatingCount = 0 } = {}) {
  const prior = TIER_SCORE[tasteTier] ?? TIER_SCORE.decent;
  const count = Number(userRatingCount) || 0;
  if (!count || userRatingAvg == null) return prior;
  const blended = (prior * SHRINK_K + userRatingAvg * count) / (SHRINK_K + count);
  return Math.max(0, Math.min(1, blended));
}

module.exports = { TIERS, TIER_ORDINAL, TIER_SCORE, SHRINK_K, clampProposedTier, ratingToScore, recomputeAgg, effectiveTasteScore };
