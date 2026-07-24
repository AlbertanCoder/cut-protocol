// Brain v3 — THE GOVERNED DOOR. One wrapper, applied to every live model call
// in this app, so the seven controls cannot be forgotten by the next feature
// that wants an LLM.
//
// WHY THIS FILE EXISTS (2026-07-23, fleet finding brain-stack-1):
// the brain's controls were real but expressed as per-call-site WIRING —
// chat.js, critic.js and classifier.js each independently remembered to check
// the gate, estimate the cost, call guardedCall() and post-check the output.
// POST /api/recipes/generate-drafts was written earlier, against its own
// Anthropic client (aiRecipeClient.js constructed one at module load), and
// remembered none of it: no gate, no cap, no ledger row, no injection guard, no
// timeout, and a hard crash rather than a 503 when no key was present. An
// unmetered model call on an authenticated route is a money bleed that shows up
// on a bill, not in a log — and this build is about to be handed to a tester.
// A one-off patch on that one route would have left the NEXT route free to
// repeat it, so the controls moved here and the structural test in
// tests/aiGovernanceStructure.test.js now fails the build if a module reaches
// the transport without coming through this door.
//
// THE SEVEN CONTROLS, in the order governedModelCall applies them:
//   1 GATE          isFeatureEnabled() — explicit opt-in, DEFAULT OFF.
//   2 KEYLESS-503   no ANTHROPIC_API_KEY -> honest 503, never a crash/hang.
//   3 INPUT GUARD   guard.preGateFieldText on every user-supplied string,
//                   BEFORE a single token is spent.
//   4 COST CAP      ledger.precheck (via ledger.guardedCall) — PRE-call. A
//                   request that would breach the cap never reaches the model.
//   5 LEDGER        ledger.record of the ACTUAL usage (withUsageLogging), so
//                   the caps are cumulative and survive a restart.
//   6 TIMEOUT       a hard deadline around the call — no unbounded await.
//   7 OUTPUT GUARD  outputGuard.scanForLeak on the raw reply, plus the caller's
//                   own structural validation, BEFORE anything is persisted.
//
// Nothing here turns anything on. Every gate defaults to OFF and this module
// never reads, prompts for, or creates an API key.
const { isBrainEnabled } = require("./llm.js");
const { preGateFieldText } = require("./guard.js");
const { refusalText } = require("./policy.js");
const { scanForLeak } = require("./outputGuard.js");
const { defaultLedger, guardedCall } = require("./ledger.js");
const { estimateUsd } = require("./pricing.js");

// ── 1/2. The gate ──────────────────────────────────────────────────────────
// Every LLM-backed feature is registered here with its enable flag. `flag:null`
// means "brain-gated only" — armed solely by BRAIN=on, the single staged
// turn-on switch. A feature MAY declare its own flag so a build can arm one
// narrow capability without waking the whole brain; both are explicit opt-ins
// and both default to OFF, so an unconfigured build makes no model calls at all.
const FEATURES = {
  chat: { flag: null, label: "The AI coach" },
  critic: { flag: null, label: "The plan critic" },
  classify: { flag: null, label: "The domain classifier" },
  recipeDrafts: { flag: "AI_RECIPE_DRAFTS", label: "AI recipe drafting" },
};

// llmAvailability(feature) -> { enabled:true } | { enabled:false, reason, status, message }
// The refusal is honest about WHICH condition failed (no key vs switched off)
// without ever naming a key value or an env var's contents.
function llmAvailability(feature) {
  const f = FEATURES[feature];
  if (!f) {
    return { enabled: false, reason: "unknown-feature", status: 503, message: `Unknown AI feature "${feature}" — it is not registered in the governance table, so it is refused.` };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { enabled: false, reason: "no-api-key", status: 503, message: "AI features are unavailable in this build — no API key is configured. Everything else works normally." };
  }
  // BRAIN=on arms every registered feature (the staged turn-on switch, shared
  // with chat/critic/classify via the SAME isBrainEnabled() implementation).
  if (isBrainEnabled()) return { enabled: true, feature };
  if (f.flag && process.env[f.flag] === "on") return { enabled: true, feature };
  return {
    enabled: false,
    reason: "feature-off",
    status: 503,
    message: `${f.label} is switched off in this build.${f.flag ? ` Set ${f.flag}=on (or BRAIN=on) to enable it.` : " Set BRAIN=on to enable it."}`,
  };
}

function isFeatureEnabled(feature) {
  return llmAvailability(feature).enabled;
}

// A governance refusal that a route can translate straight into a response.
// isGovernance marks it as a DECIDED outcome, never an unexpected crash.
class LlmRefusal extends Error {
  constructor({ code, message, status = 503, reason = null }) {
    super(message);
    this.name = "LlmRefusal";
    this.code = code;
    this.status = status;
    this.reason = reason;
    this.isGovernance = true;
  }
}

// ── 3. Input guard ─────────────────────────────────────────────────────────
// Screens every user-supplied string that will be interpolated into a prompt.
// Refusal happens BEFORE the ledger is even consulted: an injection attempt
// must cost nothing.
function guardUserText(fields = [], opts = {}) {
  for (const raw of fields) {
    const field = typeof raw === "string" ? { label: "input", value: raw } : raw || {};
    const values = Array.isArray(field.value) ? field.value : [field.value];
    for (const v of values) {
      if (v == null) continue;
      const verdict = preGateFieldText(v, opts);
      if (verdict.decision === "refuse") {
        return { ok: false, label: field.label || "input", category: verdict.category, refusalKey: verdict.refusalKey || "off_topic" };
      }
    }
  }
  return { ok: true };
}

// ── 6. Timeout ─────────────────────────────────────────────────────────────
// A hard deadline on top of the transport's own SDK timeout. Two layers on
// purpose: the SDK bound protects the HTTP call, this one protects the whole
// operation (retry loops, tool loops, a fake client in a test that never
// settles). A breach is a clean typed error, never a hung socket.
function withDeadline(promise, ms, label = "model call") {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label} timed out after ${ms}ms`);
      e.code = "llm-timeout";
      reject(e);
    }, ms);
    // Deliberately NOT unref'd. The timer is always cleared in the .finally
    // below the instant the race settles, so it can never outlive its purpose
    // and leak. Unref'ing it would mean that when the guarded call produces no
    // I/O of its own — a stuck retry loop, or a fake client in a test that
    // never settles — the event loop can drain to empty and the deadline never
    // fires, so a "hard deadline" silently fails to enforce anything. (That is
    // exactly what surfaced as CI-only "Promise resolution is still pending"
    // on Node 20: the sole pending work was an unref'd deadline the loop
    // refused to wait for.)
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * governedModelCall(ctx, fn) — run `fn` (which performs the actual model call)
 * under all seven controls. Returns
 *   { ok:true,  result, spent }                     — the call happened, and its
 *                                                     ACTUAL usage is on the ledger
 *   { ok:false, code, status, message, reason }     — refused/degraded; `fn` was
 *                                                     NOT invoked for codes
 *                                                     llm-disabled / input-refused /
 *                                                     cost-cap
 *
 * ctx:
 *   feature      registry key (FEATURES) — REQUIRED, unknown = refused
 *   phase/intent ledger labels
 *   userId       ledger attribution (nullable)
 *   model        model id — drives the cost estimate; an unpriced model makes
 *                estimateUsd() return Infinity and the cap DENY (fail closed)
 *   maxTokens/turns  the conservative pre-call cost estimate's inputs
 *   userText     [{label,value}] or [string] — screened by the input guard
 *   timeoutMs    hard deadline (0/absent = rely on the transport's own bound)
 *   ledger       injected for tests; production uses the Prisma-backed ledger
 *   inspectOutput(result) -> string|null — raw text handed to the leak scan
 */
async function governedModelCall(ctx = {}, fn) {
  const {
    feature, phase = feature, intent = feature, userId = null, model,
    maxTokens = 1024, turns = 1, userText = [], fieldOpts = {},
    timeoutMs = 0, inspectOutput = null,
  } = ctx;

  // 1 + 2 — gate / keyless. No key or not armed: nothing is constructed, no
  // ledger is touched, `fn` is never called.
  const availability = llmAvailability(feature);
  if (!availability.enabled) {
    return { ok: false, code: "llm-disabled", status: availability.status, reason: availability.reason, message: availability.message };
  }

  // 3 — input guard, before any spend.
  const guarded = guardUserText(userText, fieldOpts);
  if (!guarded.ok) {
    return {
      ok: false, code: "input-refused", status: 400, reason: guarded.category,
      message: refusalText(guarded.refusalKey), field: guarded.label,
    };
  }

  // 4 + 5 — cost cap (PRE-call) and ledger, both via the same ledger module the
  // chat/critic/classifier paths use. guardedCall() denies BEFORE running `fn`.
  const ledger = ctx.ledger || defaultLedger();
  const projectedUsd = estimateUsd(model, { turns, maxTokens });
  let gate;
  try {
    gate = await guardedCall(
      ledger,
      { projectedUsd, userId, model, phase, intent },
      () => withDeadline(Promise.resolve().then(fn), timeoutMs, `${feature} model call`) // 6 — timeout
    );
  } catch (e) {
    if (e && e.code === "llm-timeout") {
      return { ok: false, code: "llm-timeout", status: 504, reason: "timeout", message: "The AI request took too long and was cancelled. Nothing was saved — try again." };
    }
    return { ok: false, code: "llm-error", status: 502, reason: "model-error", message: e && e.message ? e.message : "The AI request failed." };
  }
  if (!gate.allowed) {
    return { ok: false, code: "cost-cap", status: 429, reason: gate.reason, message: gate.notice, spent: gate.spent };
  }

  // 7 — output guard (leak scan). The caller's structural validation runs on the
  // parsed body; this catches a raw prompt/secret echo whatever the shape.
  if (typeof inspectOutput === "function") {
    let raw = null;
    try { raw = inspectOutput(gate.result); } catch { raw = null; }
    if (raw != null && !scanForLeak(raw).ok) {
      return { ok: false, code: "output-guard", status: 502, reason: "leak", message: "The AI reply was withheld because it failed the output safety check." };
    }
  }

  return { ok: true, result: gate.result };
}

// governedModelCallOrThrow — same contract, but a refusal becomes an LlmRefusal.
// Used by call sites whose callers already have a documented catch (the weekly
// solver's AI fallback treats any throw as "honest unsolved slot"), so a refusal
// degrades identically to any other failure instead of needing a second code path.
async function governedModelCallOrThrow(ctx, fn) {
  const outcome = await governedModelCall(ctx, fn);
  if (!outcome.ok) throw new LlmRefusal(outcome);
  return outcome.result;
}

// ── The call-site registry ─────────────────────────────────────────────────
// Every place in src/ that can reach the Anthropic transport. The structural
// test discovers transport users from source and FAILS on any that is missing
// here — that is the mechanism that stops a future ungated route.
//
// costControl:
//   "governance"      — goes through governedModelCall (this file)
//   "ledger.guardedCall" — wires ledger.guardedCall directly (chat/critic/
//                       classifier, written before this file existed; same
//                       enforcement point, same caps, same LlmUsage rows)
//   "none"            — NO cost cap. Only permitted for a call site that no
//                       route can invoke; the structural test enforces that
//                       claim by scanning for callers outside brain/.
const LLM_CALL_SITES = [
  { id: "brain.chat", module: "src/lib/brain/chat.js", entry: "brainChat", feature: "chat", costControl: "ledger.guardedCall", route: "POST /api/brain/chat" },
  { id: "brain.critic", module: "src/lib/brain/critic.js", entry: "reviewDay", feature: "critic", costControl: "ledger.guardedCall", route: "POST /api/plans/* (via mealSolver)" },
  { id: "brain.classifier", module: "src/lib/brain/classifier.js", entry: "makeClassifier", feature: "classify", costControl: "ledger.guardedCall", route: "POST /api/brain/chat (Tier-1 guard)" },
  { id: "recipes.generateDrafts", module: "src/lib/aiRecipeClient.js", entry: "generateRecipeDrafts", feature: "recipeDrafts", costControl: "governance", route: "POST /api/recipes/generate-drafts" },
  // ── dormant: wired into no route. `none` is allowed ONLY while that stays
  // true; tests/aiGovernanceStructure.test.js re-checks it on every run and
  // fails the moment one of these is called from outside src/lib/brain/.
  { id: "brain.tailor", module: "src/lib/brain/tailor.js", entry: "tailorRecipe", feature: null, costControl: "none", route: null, dormant: true },
  { id: "brain.selector", module: "src/lib/brain/selector.js", entry: "proposeDay", feature: null, costControl: "none", route: null, dormant: true },
  { id: "brain.create", module: "src/lib/brain/create.js", entry: "generateRecipe", feature: null, costControl: "none", route: null, dormant: true },
  // The barrel re-exports the transport symbols; it never invokes one. The
  // structural test verifies that (a re-export is not a call site).
  { id: "brain.index", module: "src/lib/brain/index.js", entry: "(barrel re-export)", feature: null, costControl: "n/a", route: null, barrel: true },
];

module.exports = {
  FEATURES, llmAvailability, isFeatureEnabled,
  governedModelCall, governedModelCallOrThrow, LlmRefusal,
  guardUserText, withDeadline, LLM_CALL_SITES,
};
