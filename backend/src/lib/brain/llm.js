// Brain v2 — thin Anthropic wrapper. Reuses aiRecipeClient.js's patterns (same
// SDK, same env-var key handling, same model) but adds a HARD, bounded contract
// for a judgment layer: a strict on/off gate, a ~15s timeout, and JSON-or-throw.
// The deterministic meal solver is always authoritative; nothing here sets
// macros. Every caller (critic/tailor) treats a throw as a no-op fallback.
const Anthropic = require("@anthropic-ai/sdk");

// Lazily construct the client so merely REQUIRING this module never needs a key
// (aiRecipeClient constructs at load; the brain must be importable — and
// unit-testable — with the brain off and no ANTHROPIC_API_KEY present).
let _client = null;
function client() {
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return _client;
}

// The brain is EXPLICIT OPT-IN: on only when a key exists AND BRAIN==="on".
// Default off so a build behaves byte-identically to the deterministic-only
// engine until the live LLM layer has been verified with a real key. This is the
// single gate every brain feature checks. To enable: set BRAIN=on in the env.
function isBrainEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.BRAIN === "on";
}

const BRAIN_TIMEOUT_MS = 15000;
const BRAIN_MODEL = "claude-opus-4-8";

// Strip an optional ```json … ``` fence, then JSON.parse. Throws on invalid JSON.
function parseJSON(text) {
  const trimmed = String(text || "").trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(unfenced);
}

// askJSON({ system, user }) -> parsed JSON object. Bounded to BRAIN_TIMEOUT_MS
// with zero SDK retries (a judgment layer must fail fast into its fallback, not
// stall a request). Throws on timeout, refusal, missing text, or invalid JSON —
// callers convert that throw into their documented no-op fallback.
async function askJSON({ system, user, maxTokens = 1024 } = {}) {
  const response = await client().messages.create(
    {
      model: BRAIN_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: BRAIN_TIMEOUT_MS, maxRetries: 0 }
  );
  if (response.stop_reason === "refusal") throw new Error("brain: model declined the request");
  const textBlock = (response.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("brain: no text content in response");
  return parseJSON(textBlock.text);
}

module.exports = { isBrainEnabled, askJSON, parseJSON, BRAIN_TIMEOUT_MS, BRAIN_MODEL };
