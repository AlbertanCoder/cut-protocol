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
function isBrainEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.BRAIN === "on";
}

const BRAIN_TIMEOUT_MS = 15000;
const BRAIN_MODEL = "claude-opus-4-8";

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
async function askJSON({ system, user, maxTokens = 1024, model = BRAIN_MODEL, onUsage } = {}) {
  const response = await client().messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
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
  system, user, schema, maxTokens = 4096, model = BRAIN_MODEL,
  timeoutMs = DRAFT_TIMEOUT_MS, thinking, effort, onUsage,
} = {}) {
  const params = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  if (thinking) params.thinking = thinking;
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
async function runToolLoop({ system, messages = [], tools = {}, toolDefs = [], maxTurns = 4, maxTokens = 1024, model = BRAIN_MODEL } = {}) {
  const convo = messages.map((m) => ({ ...m }));
  const calls = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }; // summed across turns for the cost ledger
  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    const resp = await client().messages.create(
      { model, max_tokens: maxTokens, system, messages: convo, tools: toolDefs },
      { timeout: BRAIN_TIMEOUT_MS, maxRetries: 0 }
    );
    const u = resp.usage || {};
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
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
  DEPTH_PROFILES, BRAIN_TIMEOUT_MS, DRAFT_TIMEOUT_MS, BRAIN_MODEL,
};
