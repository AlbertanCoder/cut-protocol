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

async function brainChat({ userId, message, depth = "balanced" } = {}, deps = {}) {
  const {
    enabled = isBrainEnabled(),
    classify = null,
    loadProfile = defaultLoadProfile,
    loadLibrary = defaultLoadLibrary,
    runLoop = runToolLoop,
    model = MODELS.workhorse,
  } = deps;

  if (!enabled) return { available: false };

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

    // LAW 4: enforce the cost cap AROUND the model call (constructed only here,
    // on the ALLOWED path, so the gated-off state never builds a ledger). Deny ->
    // degrade with an honest notice; the model is never called, nothing is spent.
    const ledger = deps.ledger || defaultLedger();
    const projectedUsd = estimateUsd(model, { turns: maxTurns, maxTokens: 1024 });
    const gate = await guardedCall(ledger, { projectedUsd, userId, model, phase: "chat", intent: "chat" },
      () => runLoop({ system, messages: [{ role: "user", content: message }], tools, toolDefs: TOOL_DEFS, maxTurns, model }));
    if (!gate.allowed) return { available: true, refused: false, degraded: true, capped: true, reply: gate.notice || "The AI coach is paused (cost cap reached). Your deterministic plan on the Plan tab is unaffected." };

    const loop = gate.result;
    const text = (loop.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim();
    const checked = postCheck(text, { refusalKey: "off_topic" });
    return { available: true, refused: false, reply: checked.response || refusalText("off_topic"), guarded: !checked.ok };
  } catch {
    // Offline / DB / model failure → honest degrade, never a crash (LAW 4/7).
    return { available: true, refused: false, degraded: true, reply: "I couldn't put that together right now — your deterministic plan on the Plan tab is unaffected." };
  }
}

module.exports = { brainChat };
