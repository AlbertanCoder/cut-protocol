// Brain v3 — model pricing (USD per 1M tokens). Source: platform.claude.com,
// cached 2026-07. STANDARD (non-intro) rates by default — conservative for
// cost-capping (estimating higher makes the cap trip sooner, the safe direction).
// Update on any pricing change; not fabricated telemetry — a documented, editable
// table like groceryPrices.js. Cache reads bill at ~0.1× input (prompt caching).
const PRICING = {
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0 },
  "claude-sonnet-5": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-opus-4-8": { inputPerM: 5.0, outputPerM: 25.0 },
};

const CACHE_READ_MULTIPLIER = 0.1;

// costUsd(model, usage) -> number | null. usage: {input_tokens, output_tokens,
// cache_read_input_tokens?, cache_creation_input_tokens?}. Returns null for an
// unknown model so the caller fails loud rather than under-estimating to $0.
function costUsd(model, usage = {}) {
  const p = PRICING[model];
  if (!p) return null;
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
  const inTokensBilled = input + cacheWrite * 1.25 + cacheRead * CACHE_READ_MULTIPLIER;
  const cost = (inTokensBilled / 1e6) * p.inputPerM + (output / 1e6) * p.outputPerM;
  return Math.round(cost * 1e6) / 1e6;
}

// Conservative PRE-CALL cost estimate for the ledger precheck. Overestimates on
// purpose (deny early rather than overspend): assumes each turn fills the input
// context to EST_INPUT_TOKENS_PER_TURN and emits maxTokens of output. Unknown
// model -> Infinity so precheck fails CLOSED (never a $0 estimate that sails).
const EST_INPUT_TOKENS_PER_TURN = 12000;
function estimateUsd(model, { turns = 1, maxTokens = 1024 } = {}) {
  const t = Math.max(1, turns);
  const c = costUsd(model, { input_tokens: t * EST_INPUT_TOKENS_PER_TURN, output_tokens: t * maxTokens });
  return c == null ? Infinity : c;
}

module.exports = { PRICING, costUsd, CACHE_READ_MULTIPLIER, estimateUsd, EST_INPUT_TOKENS_PER_TURN };
