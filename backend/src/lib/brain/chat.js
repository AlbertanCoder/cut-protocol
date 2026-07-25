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
const { preGate, preGateFieldText } = require("./guard.js");
const { postCheck } = require("./outputGuard.js");
const { refusalText } = require("./policy.js");
const { buildPool } = require("./pool.js");
const { makeTools } = require("./tools.js");
const { buildSystemBlocks } = require("./prompts/system.js");
const { cachedSystemParam } = require("./cache.js");
const { TOOL_DEFS } = require("./selector.js");
const { guardedCall } = require("./ledger.js");
const { defaultBudget } = require("./userBudget.js");
const { estimateUsd } = require("./pricing.js");
const { MODELS } = require("./config.js");
const { makeClassifier } = require("./classifier.js");
const { sanitizeHistory, signTurn } = require("./historyGuard.js");
const { looksLikePlanRequest, generateDayForChat, planIntro } = require("./chatPlan.js");

// The chat coach only SEARCHES for grounding (name real recipes/foods from the
// compliant pool) — it never gets the compute tools (scaleRecipe/computeMacros/
// dayTotals). Handing it those made it try to ASSEMBLE a numbered plan it can't
// finish in a chat turn, so it produced nothing. Building plans is the Plan tab.
const CHAT_TOOL_DEFS = TOOL_DEFS.filter((t) => t.name === "searchRecipes" || t.name === "searchFoods");

// Client-supplied conversation history so follow-ups ("why not?", "that one")
// have context. It is CAPPED, SHAPE-VALIDATED, GUARDED and — for assistant turns
// — AUTHENTICATED; see historyGuard.js for why shape validation alone was a
// role-forgery hole. The system-prompt laws still govern the whole exchange
// (LAW 6 — history content is untrusted, never instructions).

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

  // LAW 4: one budget for the whole turn (classifier + main call), built only
  // AFTER the enable gate so the off-state never constructs one.
  //
  // defaultBudget({userId}), NOT defaultLedger(). config.js has defined per-user
  // caps ($0.50 request / $1 day / $5 month) since Stage 4 and userBudget.js's
  // own header calls out the gap they close — but they were wired into
  // mealRouter only, so this route enforced the GLOBAL cap alone. One
  // authenticated account could therefore drink the entire budget ($5/day,
  // $15/month) and every other user would degrade to closest-fit with nothing in
  // the UI explaining why. With no userId (shouldn't happen behind requireAuth)
  // makeBudget returns exactly the global ledger, so this is never LESS strict.
  //
  // G2: the Tier-1 classifier decides preGate's ambiguous middle — default ON
  // when armed, injectable (pass classify:null for Tier-0-only). It shares this
  // budget, so classifier spend counts against the same per-user cap.
  const ledger = deps.ledger || defaultBudget({ userId });
  const classify = deps.classify !== undefined ? deps.classify : makeClassifier({ ledger, model: MODELS.classifier });

  const verdict = await preGate(message, { classify });
  if (verdict.decision === "refuse") {
    return { available: true, refused: true, refusalKey: verdict.refusalKey, reply: refusalText(verdict.refusalKey) };
  }

  // History is guarded BEFORE any spend: a forged or injected prior turn must
  // cost nothing. A tripped USER turn refuses the request outright (it is the
  // same verdict preGate would have given had it arrived live); unauthenticated
  // ASSISTANT turns are dropped inside sanitizeHistory and we simply proceed
  // with less context.
  const priorTurns = sanitizeHistory(history, { userId });
  if (!priorTurns.ok) {
    return { available: true, refused: true, refusalKey: priorTurns.refusalKey, reply: refusalText(priorTurns.refusalKey) };
  }

  try {
    // Stage 1 (v2): an explicit "build me a full day" ask short-circuits to the
    // DETERMINISTIC day-solver — engine numbers (LAW 1), the compliant pool
    // (LAW 2), no model call. A failure (no profile / empty pool) returns null
    // and falls through to the conversational coach below (LAW 7).
    if (looksLikePlanRequest(message)) {
      const plan = await generateDayForChat({ userId }, deps).catch(() => null);
      if (plan) {
        const intro = planIntro(plan);
        return { available: true, refused: false, reply: intro, replyToken: signTurn(userId, intro), plan };
      }
    }

    const profile = (await loadProfile(userId)) || {};
    const library = await loadLibrary(profile);
    const pool = buildPool(profile, library);
    const tools = makeTools(pool, profile);

    // INDIRECT INJECTION via the profile. mealPreferencesNote is free text the
    // user typed on the Profile tab, and system.js interpolates it into
    // <user_data> on EVERY request. sanitizeUserData neutralizes the delimiter
    // tags, so it cannot break out of the wrapper — but nothing ran the domain
    // guard over its CONTENT, so a note is a persistent, every-turn injection
    // slot. Screen it here and drop it if it trips; the rest of the profile
    // (dietary style, exclusions) is enum/list data the user cannot free-type.
    const safeProfile = preGateFieldText(profile.mealPreferencesNote).decision === "refuse"
      ? { ...profile, mealPreferencesNote: null }
      : profile;

    // Prompt-cache breakpoints (Stage J, finally wired). The static
    // persona/scope/laws/narration prefix is re-billed at full input price on
    // every turn unless it is marked cacheable; cache reads bill at ~0.1x.
    const system = cachedSystemParam(buildSystemBlocks({ profile: safeProfile, depth, toolNames: Object.keys(tools) }));
    const maxTurns = (DEPTH_PROFILES[depth] || DEPTH_PROFILES.balanced).maxIters + 2;

    // LAW 4: enforce the cost cap AROUND the model call (same ledger as the
    // classifier). Deny -> degrade with an honest notice; the model is never
    // called, nothing is spent.
    const projectedUsd = estimateUsd(model, { turns: maxTurns, maxTokens: 1024 });
    // `collect` is the throw-safe usage channel (ledger.js withUsageLogging): a
    // tool loop that dies on turn 3 still books the two turns already billed.
    const gate = await guardedCall(ledger, { projectedUsd, userId, model, phase: "chat", intent: "chat" },
      (collect) => runLoop({
        system,
        messages: [...priorTurns.turns, { role: "user", content: message }],
        tools, toolDefs: CHAT_TOOL_DEFS, maxTurns, model,
        onUsage: (u) => { if (collect) collect.usage = u; },
      }));
    if (!gate.allowed) return { available: true, refused: false, degraded: true, capped: true, reply: gate.notice || "The AI coach is paused (cost cap reached). Your deterministic plan is on the Plan tab and still works." };

    const loop = gate.result;
    const text = (loop.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) {
      // The tool-loop ended with no final answer (e.g. hit max turns). That's a
      // "couldn't complete", NOT off-topic — say so honestly (LAW 7); do not show
      // the domain refusal, which misrepresents what happened.
      return { available: true, refused: false, degraded: true, reply: "I couldn't pull that together just now — try rephrasing, or generate a plan on the Plan tab." };
    }
    const checked = postCheck(text, { refusalKey: "off_topic" });
    const reply = checked.response || refusalText("off_topic");
    // The reply ships with a signature the client echoes back as history. That
    // is what makes a later assistant turn provably OURS (historyGuard.js).
    return { available: true, refused: false, reply, replyToken: signTurn(userId, reply), guarded: !checked.ok };
  } catch {
    // Offline / DB / model failure → honest degrade, never a crash (LAW 4/7).
    // Plain English, no jargon: "deterministic" is an implementation word and
    // means nothing to the person reading a reassurance.
    return { available: true, refused: false, degraded: true, reply: "I couldn't put that together right now — the meal plan on the Plan tab is built by the app's own calculator and still works." };
  }
}

module.exports = { brainChat };
