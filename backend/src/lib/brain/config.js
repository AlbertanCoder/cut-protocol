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

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

module.exports = { MODELS, CAPS };
