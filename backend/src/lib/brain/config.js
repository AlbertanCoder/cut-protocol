// Brain v3 — config. Model IDs and cost caps, all env-overridable so nothing is
// hardcoded at a call site (LAW 4 cost control lives on real, swappable knobs).
// Defaults are the current Claude tiers (see pricing.js for $/token).
//
// THIS FILE IS THE SINGLE SOURCE OF MODEL IDS. llm.js used to carry a second
// hardcoded default (BRAIN_MODEL = "claude-opus-4-8") that shadowed this table
// for every caller who omitted `model` — the dormant tailor.js did exactly that,
// so a "cheap judgment layer" would have billed at Opus rates. llm.js now
// defaults to MODELS.workhorse; do not reintroduce a literal model id anywhere
// else.
const MODELS = {
  classifier: process.env.BRAIN_MODEL_CLASSIFIER || "claude-haiku-4-5", // cheap Tier-1 guard/classify
  workhorse: process.env.BRAIN_MODEL_WORKHORSE || "claude-sonnet-5", // the planning/selection workhorse
  // Hard cases only. Opus 5 supersedes Opus 4.8 at the SAME $5/$25 per MTok —
  // a free capability step. Two behavioural differences the transport handles
  // explicitly (see llm.js THINKING_OFF_MODELS):
  //   • thinking is ON BY DEFAULT on Opus 5 (omitting `thinking` runs adaptive,
  //     unlike 4.8 where omitting meant no thinking), and max_tokens caps
  //     thinking + reply TOGETHER — so a 1024-token judgment call would truncate.
  //   • `thinking:{type:"disabled"}` is accepted only at effort `high` or below
  //     (the default), which is exactly how llm.js sends it.
  escalation: process.env.BRAIN_MODEL_ESCALATION || "claude-opus-5", // hard cases only
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
