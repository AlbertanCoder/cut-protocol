// Brain v3 — output guard (Stage D, layer L4). postCheck(text) runs AFTER the
// model, assuming every earlier layer was bypassed: a leak scan (never echo the
// system prompt, the <user_data> delimiters, a key, or env access) and a
// fail-closed replacement with a canned refusal. Number-provenance on STRUCTURED
// plan output is already enforced by verifier.js; this guards the free-text chat
// surface (Stage D2).
const { refusalText } = require("./policy.js");

const LEAK_RE = /NON-NEGOTIABLE|<\/?\s*user_data|\bsk-ant[-a-z0-9]|JWT_SECRET|-----BEGIN|process\.env/i;

// LAW 1 on the chat surface: the model must not STATE calorie/macro numbers it
// authored — the deterministic tools + plan own every number. Structural counts
// ("3 meals", "2 snacks", "lose 2 lbs") are fine; only calorie / macro-gram
// assertions are flagged (they'd be model-authored + unverifiable in free text).
const NUMBER_CLAIM_RE = /\b\d[\d.,]*\s*(k?cals?|calories?|kcal)\b|\b\d[\d.,]*\s*g(?:rams?)?\s*(?:of\s+)?(protein|carb|carbohydrate|fat|fibre|fiber|sugar)\b|\b(protein|carbs?|carbohydrates?|fat|fibre|fiber|sugar)\s*[:=-]?\s*\d[\d.,]*\s*g\b/i;

const NUMBER_REDIRECT = "I can talk through the approach, but for exact calories and macros use the Plan tab — those numbers come from the app's calculator, not me.";

function postCheck(text, { refusalKey = "off_topic" } = {}) {
  const t = String(text ?? "");
  if (LEAK_RE.test(t)) return { ok: false, reason: "leak", response: refusalText(refusalKey) };
  if (NUMBER_CLAIM_RE.test(t)) return { ok: false, reason: "number-claim", response: NUMBER_REDIRECT };
  return { ok: true, response: t };
}

// scanForLeak(text) — the LEAK half of postCheck() on its own, for STRUCTURED
// (non-chat) model output. The NUMBER_CLAIM rule deliberately does NOT apply
// there: a recipe draft's JSON legitimately contains gram amounts, and those
// numbers are never trusted anyway (recipeGeneration.js recomputes every macro
// from resolved Food rows). The leak scan still applies to every surface — the
// model must never echo the system prompt, the <user_data> delimiters, a key,
// or env access, whatever the shape of the reply.
function scanForLeak(text) {
  const t = String(text ?? "");
  return LEAK_RE.test(t) ? { ok: false, reason: "leak" } : { ok: true };
}

module.exports = { postCheck, scanForLeak, LEAK_RE, NUMBER_CLAIM_RE };
