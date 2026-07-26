// The relay's OWN pricing table. It deliberately does not import backend's.
//
// A shared pricing module across a trust boundary is how a client-side
// assumption ends up enforcing a server-side limit: the client's copy is
// advisory and can be edited by whoever holds the machine, while this copy is
// what actually decides whether money gets spent. They are allowed to drift;
// this one wins.
//
// USD per MILLION tokens, verified against the Anthropic pricing reference on
// 2026-07-25.
//
// CACHE TOKENS ARE NOT INPUT TOKENS, and this is the line item that quietly
// breaks naive meters:
//   - a cache WRITE bills at 1.25x input (5-minute TTL) or 2x (1-hour TTL)
//   - a cache READ bills at 0.1x input
// A relay that folds `cache_creation_input_tokens` into `input_tokens` under-
// charges the most expensive turns it will ever see, so the two are priced
// separately below and summed explicitly in costUsd().
//
// The 1-hour TTL multiplier is the conservative default here: this relay cannot
// see which TTL the client asked for from the usage numbers alone, and guessing
// low means the budget cap lets through spend it thought it had already
// counted. Over-charging our own ledger is a safe direction; under-charging is
// not.
const PER_MTOK = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  // Sonnet 5 carries an introductory rate ($2/$10) through 2026-08-31. The
  // STANDARD rate is used here on purpose — when the promo lapses, a table
  // pinned to the promo would silently under-count every request. Budgeting
  // against the higher number just means the cap trips slightly early.
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const CACHE_WRITE_MULTIPLIER = 2.0; // 1h TTL; 5m is 1.25x — see note above
const CACHE_READ_MULTIPLIER = 0.1;

// The allowlist IS this table's keys. Keeping them the same object means a
// model can never be priced without being allowed, or allowed without being
// priced — the second of which would let an unpriced model bill at $0 and slip
// past every budget cap.
const ALLOWED_MODELS = Object.freeze(Object.keys(PER_MTOK));

function isAllowedModel(model) {
  return Object.prototype.hasOwnProperty.call(PER_MTOK, model);
}

/**
 * Actual USD for a completed call, from the response's own usage block.
 * Unknown model => throws rather than returning 0: a silent zero would be
 * indistinguishable from a free request and would corrupt the budget.
 */
function costUsd(model, usage) {
  const rate = PER_MTOK[model];
  if (!rate) throw new Error(`no pricing for model: ${model}`);
  const u = usage || {};
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
  const cacheRead = Number(u.cache_read_input_tokens) || 0;
  return (
    (input * rate.input +
      output * rate.output +
      cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER +
      cacheRead * rate.input * CACHE_READ_MULTIPLIER) /
    1_000_000
  );
}

/**
 * UPPER-BOUND estimate for admission control, computed BEFORE the upstream call
 * because a budget check that runs after the money is spent is not a budget.
 *
 * Two deliberate approximations, both biased high:
 *   - input tokens are estimated from the request's byte length at ~3.5 bytes
 *     per token. Real tokenization is model-specific and this relay will not
 *     ship a tokenizer to find out; over-estimating spends budget headroom, it
 *     does not spend money.
 *   - output is charged at the FULL clamped max_tokens, i.e. as if every reply
 *     runs to the ceiling. Most do not.
 *
 * This number gates the request. It is never recorded as spend — actuals from
 * the response are, in costUsd() above.
 */
const BYTES_PER_TOKEN_ESTIMATE = 3.5;

function estimateCostUsd(model, bodyBytes, maxTokens) {
  const rate = PER_MTOK[model];
  if (!rate) throw new Error(`no pricing for model: ${model}`);
  const estInput = Math.ceil(bodyBytes / BYTES_PER_TOKEN_ESTIMATE);
  return (estInput * rate.input + (Number(maxTokens) || 0) * rate.output) / 1_000_000;
}

module.exports = {
  PER_MTOK,
  ALLOWED_MODELS,
  CACHE_WRITE_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  isAllowedModel,
  costUsd,
  estimateCostUsd,
};
