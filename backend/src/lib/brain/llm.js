// Brain v2 — thin Anthropic wrapper. Reuses aiRecipeClient.js's patterns (same
// SDK, same env-var key handling, same model) but adds a HARD, bounded contract
// for a judgment layer: a strict on/off gate, a ~15s timeout, and JSON-or-throw.
// The deterministic meal solver is always authoritative; nothing here sets
// macros. Every caller (critic/tailor) treats a throw as a no-op fallback.
const Anthropic = require("@anthropic-ai/sdk");
const { MODELS } = require("./config.js");

// ── RELAY CONFIG ─────────────────────────────────────────────────────────────
// A packaged install ships NO secrets, so `ANTHROPIC_API_KEY` is simply absent
// there and the brain can never turn on. The second way in is a RELAY: a narrow
// forwarding service that holds the only copy of the real key and accepts a
// per-device token instead. The SDK takes a `baseURL`, so the relay needs zero
// changes in askJSON/askSchemaJSON/runToolLoop — only client() moves.
//
// The device token lives on a user's machine and MUST be assumed extractable.
// The relay's model allowlist and USD caps are therefore authoritative; nothing
// enforced on this side of the wire is a security control.
//
// BASE URL NORMALIZATION, which is not cosmetic. The SDK builds a request as
// `new URL(baseURL + "/v1/messages")` (client.js buildURL). So the baseURL must
// be the BARE ORIGIN — a pasted `https://relay.example.com/v1` would resolve to
// `/v1/v1/messages` and 404 against a relay that serves `/v1/messages`. Both
// forms are accepted and normalized to the same thing, because "paste your
// relay URL" invites the `/v1` and a 404 at that layer reads like a dead relay.
//
// SCHEME RULE: https anywhere, http ONLY on loopback. A relay token crossing
// the public internet in cleartext is the one failure mode that hands an
// attacker the credential without them having to touch either machine. Loopback
// http stays legal because that is how Stage 3 tests against a local relay.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function relayConfig() {
  const rawUrl = String(process.env.BRAIN_RELAY_URL || "").trim();
  const token = String(process.env.BRAIN_RELAY_TOKEN || "").trim();
  // Partial config is NOT config. Half a relay is how you get a client that
  // authenticates to nothing, or points nowhere with a valid credential.
  if (!rawUrl || !token) return null;

  let parsed;
  try { parsed = new URL(rawUrl); } catch { return null; }

  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol === "http:") { if (!isLoopback) return null; }
  else if (parsed.protocol !== "https:") return null;

  // Strip trailing slashes, then ONE trailing `/v1` — the SDK appends its own.
  const baseURL = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return { baseURL, token };
}

// Lazily construct the client so merely REQUIRING this module never needs a key
// (aiRecipeClient constructs at load; the brain must be importable — and
// unit-testable — with the brain off and no ANTHROPIC_API_KEY present).
//
// RELAY WINS over a direct key when both are present. A stray ANTHROPIC_API_KEY
// in the environment must never silently route around the relay's authoritative
// caps — a bypass you cannot see is worse than a misconfiguration you can.
let _client = null;
function client() {
  if (!_client) {
    const relay = relayConfig();
    _client = relay
      ? new Anthropic({ baseURL: relay.baseURL, apiKey: relay.token })
      : new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return _client;
}

// Test seam: inject a fake Anthropic client (needs a `messages.create`). The
// production path is untouched — client() stays lazy and _client stays null
// until a real key constructs it or a test sets it here. Pass null to reset.
function __setClient(fake) {
  _client = fake;
}

// Depth → HARD iteration cap for the planning loop (enforced in code regardless
// of what the model asks for). Only iters/alternatives/narration ever change
// with depth; laws/scope/exclusions never do.
const DEPTH_PROFILES = { fast: { maxIters: 1 }, balanced: { maxIters: 3 }, thorough: { maxIters: 6 } };

// The brain is EXPLICIT OPT-IN: on only when a key exists AND BRAIN==="on".
// Default off so a build behaves byte-identically to the deterministic-only
// engine until the live LLM layer has been verified with a real key. This is the
// single gate every brain feature checks. To enable: set BRAIN=on in the env.
// Two ways to have a transport, one gate. A direct key (dev, backend/.env) or a
// complete relay config (a packaged install, which ships no key by design).
// Neither one is sufficient alone: BRAIN=on stays a required, explicit opt-in.
function isBrainEnabled() {
  if (process.env.BRAIN !== "on") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(relayConfig());
}

const BRAIN_TIMEOUT_MS = 15000;

// The transport's default model comes from config.js — there is no second
// hardcoded id here. (There used to be: `BRAIN_MODEL = "claude-opus-4-8"`,
// which silently overrode the config table for every caller that omitted
// `model`. Its only live consumer was the dormant tailor.js, which therefore
// would have billed a cheap judgment turn at Opus rates.)
const DEFAULT_MODEL = MODELS.workhorse;

// ── THINKING: an explicit OFF, because the default flipped underneath us ──────
// On Opus 4.8 and earlier, omitting `thinking` meant NO thinking. On Claude
// Opus 5 and Claude Sonnet 5 — the two tiers this brain actually runs — omitting
// it runs ADAPTIVE thinking, and `max_tokens` is a hard cap on thinking PLUS the
// reply. Our judgment calls are bounded at 1024 output tokens, so an unrequested
// adaptive-thinking turn can consume the whole budget and return a truncated (or
// empty) answer, which chat.js would surface as the honest-but-wrong "I couldn't
// pull that together just now".
//
// So every call on a model whose default is adaptive sends `{type:"disabled"}`
// explicitly. That is accepted on Sonnet 5, and on Opus 5 at effort `high` or
// below (`high` is the default and we never raise it). Models NOT in this set —
// Haiku 4.5, and anything older — are left alone: they default to no thinking
// already, and sending an unexpected `thinking` shape to them risks a 400.
//
// If a future tier genuinely benefits from thinking, raise its maxTokens FIRST.
const THINKING_OFF_MODELS = new Set([
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5", "claude-sonnet-4-6",
]);
function thinkingParam(model) {
  return THINKING_OFF_MODELS.has(model) ? { type: "disabled" } : undefined;
}

// A long-form STRUCTURED generation (recipe drafting) legitimately takes longer
// than a judgment turn — thinking + 8k output tokens. It still gets a HARD
// bound: an unbounded model call is a hang, and a hang on an Express route is an
// occupied socket, not an error anyone can see. Env-overridable, never infinite.
const DRAFT_TIMEOUT_MS = Number(process.env.BRAIN_DRAFT_TIMEOUT_MS) > 0
  ? Number(process.env.BRAIN_DRAFT_TIMEOUT_MS)
  : 90000;

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
async function askJSON({ system, user, maxTokens = 1024, model = DEFAULT_MODEL, onUsage } = {}) {
  const thinking = thinkingParam(model);
  const response = await client().messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      ...(thinking ? { thinking } : {}),
    },
    { timeout: BRAIN_TIMEOUT_MS, maxRetries: 0 }
  );
  // Surface token usage to the cost ledger BEFORE any throw — the tokens were
  // spent regardless of whether the body parses (LAW 4 accounting).
  if (typeof onUsage === "function") onUsage(response.usage || null);
  if (response.stop_reason === "refusal") throw new Error("brain: model declined the request");
  const textBlock = (response.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("brain: no text content in response");
  return parseJSON(textBlock.text);
}

// askSchemaJSON({ system, user, schema }) -> parsed JSON object, constrained by
// a json_schema output format. Same transport, same lazy keyless client, same
// zero-retry policy as askJSON — the ONE place a structured generation reaches
// Anthropic. Exists so aiRecipeClient.js (recipe drafting) stops constructing a
// second SDK client of its own: one transport = one place to bound, meter and
// mock. Bounded by `timeoutMs` (default DRAFT_TIMEOUT_MS). Usage is surfaced via
// onUsage BEFORE any throw so the ledger books tokens that were really spent.
async function askSchemaJSON({
  system, user, schema, maxTokens = 4096, model = DEFAULT_MODEL,
  timeoutMs = DRAFT_TIMEOUT_MS, thinking, effort, onUsage,
} = {}) {
  const params = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  // An explicit caller-supplied `thinking` wins; otherwise force it OFF on the
  // models whose default flipped to adaptive (see THINKING_OFF_MODELS).
  const think = thinking || thinkingParam(model);
  if (think) params.thinking = think;
  if (schema) params.output_config = { format: { type: "json_schema", schema }, ...(effort ? { effort } : {}) };

  const response = await client().messages.create(params, { timeout: timeoutMs, maxRetries: 0 });
  if (typeof onUsage === "function") onUsage(response.usage || null);
  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  const textBlock = (response.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("no text content in response");
  return { data: parseJSON(textBlock.text), text: textBlock.text, usage: response.usage || null };
}

// Anthropic tool_use / tool_result transport. Sends the conversation with the
// tool definitions; when the model calls a tool, executes it from `tools` (the
// deterministic tool layer) and feeds the JSON result back, up to maxTurns — a
// HARD cap enforced here, not a request the model can raise. Records every tool
// call (name + input) so tests can assert exactly what was invoked. Bounded to
// BRAIN_TIMEOUT_MS with zero SDK retries: a judgment layer fails fast into its
// deterministic fallback, it never stalls a request.
// `system` accepts a plain string OR an ordered array of text blocks (some
// carrying `cache_control`) — the SDK takes both, and the block form is how
// prompt-cache breakpoints reach the wire (see cache.js / prompts/system.js).
//
// `onUsage(usage)` is invoked after EVERY turn with the running total. That is
// the LAW-4 accounting fix for a mid-loop throw: previously the accumulated
// usage lived only in the return value, so a turn-3 failure discarded the two
// turns Anthropic had already billed and the caps never saw them.
async function runToolLoop({ system, messages = [], tools = {}, toolDefs = [], maxTurns = 4, maxTokens = 1024, model = DEFAULT_MODEL, onUsage } = {}) {
  const convo = messages.map((m) => ({ ...m }));
  const calls = [];
  // Summed across turns for the cost ledger. cache_creation_input_tokens is
  // counted too — a cache WRITE bills at 1.25x input and was previously invisible
  // to the ledger, so wiring prompt caching without this would have under-counted
  // exactly the turns that cost the most.
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const thinking = thinkingParam(model);
  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    const resp = await client().messages.create(
      { model, max_tokens: maxTokens, system, messages: convo, tools: toolDefs, ...(thinking ? { thinking } : {}) },
      { timeout: BRAIN_TIMEOUT_MS, maxRetries: 0 }
    );
    const u = resp.usage || {};
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    if (typeof onUsage === "function") onUsage(usage);
    const content = resp.content || [];
    convo.push({ role: "assistant", content });
    const toolUses = content.filter((b) => b && b.type === "tool_use");
    if (toolUses.length === 0) {
      return { stop: resp.stop_reason || "end_turn", content, calls, turns, convo, usage };
    }
    const results = [];
    for (const tu of toolUses) {
      calls.push({ name: tu.name, input: tu.input, id: tu.id });
      let out;
      try {
        const fn = tools[tu.name];
        out = fn ? fn(tu.input || {}) : { error: `unknown tool: ${tu.name}` };
      } catch (e) {
        out = { error: String(e && e.message ? e.message : e) };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    convo.push({ role: "user", content: results });
  }
  return { stop: "max_turns", content: [], calls, turns, convo, usage };
}

module.exports = {
  isBrainEnabled, askJSON, askSchemaJSON, parseJSON, runToolLoop, __setClient,
  DEPTH_PROFILES, BRAIN_TIMEOUT_MS, DRAFT_TIMEOUT_MS,
  DEFAULT_MODEL, THINKING_OFF_MODELS, thinkingParam,
  // Exported so the status route can say WHY the brain is off without
  // reimplementing "is this config complete" and drifting from the gate.
  relayConfig,
};
