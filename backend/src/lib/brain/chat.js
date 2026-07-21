// Brain v3 — Stage D2 chat entry point. brainChat({userId, message, depth}, deps)
// sits behind POST /api/brain/chat:
//   GATE  (LAW 4)  — brain off → {available:false}; the caller (and the UI) treat
//                    the assistant as absent.
//   GUARD (LAW 5/6)— preGate refuses off-topic / injection / medical up front.
//   ALLOWED        — build the compliant pool + tools + system prompt, run a
//                    bounded tool-loop for a reply, then postCheck it (leak scan).
// Any failure degrades to an honest canned line — never a crash. All I/O
// (profile, library, the model loop) is injectable, so the gate/guard logic is
// keyless-testable with no DB and no network.
const { isBrainEnabled, runToolLoop, DEPTH_PROFILES } = require("./llm.js");
const { preGate } = require("./guard.js");
const { postCheck } = require("./outputGuard.js");
const { refusalText } = require("./policy.js");
const { buildPool } = require("./pool.js");
const { makeTools } = require("./tools.js");
const { buildSystemPrompt } = require("./prompts/system.js");
const { TOOL_DEFS } = require("./selector.js");
const { defaultLedger, guardedCall } = require("./ledger.js");
const { estimateUsd } = require("./pricing.js");
const { MODELS } = require("./config.js");
const { makeClassifier } = require("./classifier.js");

// The chat coach only SEARCHES for grounding (name real recipes/foods from the
// compliant pool) — it never gets the compute tools (scaleRecipe/computeMacros/
// dayTotals). Handing it those made it try to ASSEMBLE a numbered plan it can't
// finish in a chat turn, so it produced nothing. Building plans is the Plan tab.
const CHAT_TOOL_DEFS = TOOL_DEFS.filter((t) => t.name === "searchRecipes" || t.name === "searchFoods");

// Client-supplied conversation history so follow-ups ("why not?", "that one")
// have context. Capped + shape-validated; each turn was already guarded when it
// was first sent, and the system-prompt laws still govern the whole exchange
// (LAW 6 — history content is untrusted, never instructions).
const MAX_HISTORY = 8;
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
}

async function defaultLoadProfile(userId) {
  const { prisma } = require("../prisma.js");
  return prisma.profile.findUnique({ where: { userId } });
}
async function defaultLoadLibrary() {
  const { prisma } = require("../prisma.js");
  const [recipes, foods] = await Promise.all([
    prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } }),
    prisma.food.findMany(),
  ]);
  return { recipes, foods };
}

async function brainChat({ userId, message, depth = "balanced", history = [] } = {}, deps = {}) {
  const {
    enabled = isBrainEnabled(),
    loadProfile = defaultLoadProfile,
    loadLibrary = defaultLoadLibrary,
    runLoop = runToolLoop,
    model = MODELS.workhorse,
  } = deps;

  if (!enabled) return { available: false };

  // LAW 4: one ledger for the whole turn (classifier + main call), built only
  // AFTER the enable gate so the off-state never constructs one. G2: the Tier-1
  // classifier decides preGate's ambiguous middle — default ON when armed,
  // injectable (pass classify:null for Tier-0-only).
  const ledger = deps.ledger || defaultLedger();
  const classify = deps.classify !== undefined ? deps.classify : makeClassifier({ ledger, model: MODELS.classifier });

  const verdict = await preGate(message, { classify });
  if (verdict.decision === "refuse") {
    return { available: true, refused: true, reply: refusalText(verdict.refusalKey) };
  }

  try {
    const profile = (await loadProfile(userId)) || {};
    const library = await loadLibrary(profile);
    const pool = buildPool(profile, library);
    const tools = makeTools(pool, profile);
    const system = buildSystemPrompt({ profile, depth, toolNames: Object.keys(tools) });
    const maxTurns = (DEPTH_PROFILES[depth] || DEPTH_PROFILES.balanced).maxIters + 2;

    // LAW 4: enforce the cost cap AROUND the model call (same ledger as the
    // classifier). Deny -> degrade with an honest notice; the model is never
    // called, nothing is spent.
    const projectedUsd = estimateUsd(model, { turns: maxTurns, maxTokens: 1024 });
    const gate = await guardedCall(ledger, { projectedUsd, userId, model, phase: "chat", intent: "chat" },
      () => runLoop({ system, messages: [...sanitizeHistory(history), { role: "user", content: message }], tools, toolDefs: CHAT_TOOL_DEFS, maxTurns, model }));
    if (!gate.allowed) return { available: true, refused: false, degraded: true, capped: true, reply: gate.notice || "The AI coach is paused (cost cap reached). Your deterministic plan on the Plan tab is unaffected." };

    const loop = gate.result;
    const text = (loop.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) {
      // The tool-loop ended with no final answer (e.g. hit max turns). That's a
      // "couldn't complete", NOT off-topic — say so honestly (LAW 7); do not show
      // the domain refusal, which misrepresents what happened.
      return { available: true, refused: false, degraded: true, reply: "I couldn't pull that together just now — try rephrasing, or generate a plan on the Plan tab." };
    }
    const checked = postCheck(text, { refusalKey: "off_topic" });
    return { available: true, refused: false, reply: checked.response || refusalText("off_topic"), guarded: !checked.ok };
  } catch {
    // Offline / DB / model failure → honest degrade, never a crash (LAW 4/7).
    return { available: true, refused: false, degraded: true, reply: "I couldn't put that together right now — your deterministic plan on the Plan tab is unaffected." };
  }
}

module.exports = { brainChat };
