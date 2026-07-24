// Brain v3 — config. Model IDs and cost caps, all env-overridable so nothing is
// hardcoded at a call site (LAW 4 cost control lives on real, swappable knobs).
// Defaults are the current Claude tiers (see pricing.js for $/token).
const MODELS = {
  classifier: process.env.BRAIN_MODEL_CLASSIFIER || "claude-haiku-4-5", // cheap Tier-1 guard/classify
  workhorse: process.env.BRAIN_MODEL_WORKHORSE || "claude-sonnet-5", // the planning/selection workhorse
  escalation: process.env.BRAIN_MODEL_ESCALATION || "claude-opus-4-8", // hard cases only
};

// USD caps. Enforced PRE-CALL by ledger.js; breach → deterministic fallback +
// honest notice, never an error to the user.
const CAPS = {
  monthlyUsd: numEnv("BRAIN_MONTHLY_COST_CAP_USD", 15), // below the console $15 limit by design
  dailyUsd: numEnv("BRAIN_DAILY_COST_CAP_USD", 5),
  perRequestUsd: numEnv("BRAIN_PER_REQUEST_CAP_USD", 0.5),
};

// PER-USER caps (Stage 4). CAPS above protect the OWNER'S BILL; these protect it
// from a single account — one user in a retry loop could otherwise consume the
// whole monthly budget and every other user degrades to closest-fit for the rest
// of the month with no visible cause. Enforced at the same pre-call point, by
// the same ledger arithmetic, over the same rows filtered by userId.
//
// CLAMPED to the global cap: a per-user cap above the global one is meaningless
// (the global denies first) and a misconfigured env must never read as headroom.
const USER_CAPS = {
  monthlyUsd: Math.min(numEnv("BRAIN_USER_MONTHLY_COST_CAP_USD", 5), CAPS.monthlyUsd),
  dailyUsd: Math.min(numEnv("BRAIN_USER_DAILY_COST_CAP_USD", 1), CAPS.dailyUsd),
  perRequestUsd: Math.min(numEnv("BRAIN_USER_PER_REQUEST_CAP_USD", CAPS.perRequestUsd), CAPS.perRequestUsd),
};

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

module.exports = { MODELS, CAPS, USER_CAPS };
