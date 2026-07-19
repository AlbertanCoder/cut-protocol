// Brain v3 — routing. Two cheap, deterministic decisions:
//   needsLLM(request): the deterministic solver already owns regen / scale /
//     swap / grocery / weigh-in / export — those NEVER touch the model. Only
//     open-ended planning and chat go to the LLM. Keeping this list explicit
//     stops the brain from spending tokens on work the engine does for free.
//   pickModel(phase, complexity): Haiku classifier / Sonnet workhorse / Opus
//     escalation — model IDs come from config (no hardcoding).
const { MODELS } = require("./config.js");

// Intents the deterministic engine fully handles — no LLM, ever.
const DETERMINISTIC_INTENTS = new Set([
  "regen", "regenerate", "scale", "swap", "grocery", "grocery-list",
  "weigh-in", "weighin", "export", "trend", "verdict",
]);

function needsLLM(request = {}) {
  const intent = String(request.intent || "").trim().toLowerCase();
  if (DETERMINISTIC_INTENTS.has(intent)) return false;
  // Default: only genuinely open-ended intents (plan / chat / generate) reach here.
  return true;
}

function pickModel(phase, complexity = "normal") {
  if (phase === "classify" || phase === "guard") return MODELS.classifier;
  if (phase === "escalate" || complexity === "hard") return MODELS.escalation;
  return MODELS.workhorse;
}

module.exports = { needsLLM, pickModel, DETERMINISTIC_INTENTS };
