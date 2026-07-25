// Brain v3 — output guard (Stage D, layer L4). postCheck(text) runs AFTER the
// model, assuming every earlier layer was bypassed: a leak scan (never echo the
// system prompt, the <user_data> delimiters, a key, or env access) and a
// fail-closed replacement with a canned refusal. Number-provenance on STRUCTURED
// plan output is already enforced by verifier.js; this guards the free-text chat
// surface (Stage D2).
const { refusalText } = require("./policy.js");

const LEAK_RE = /NON-NEGOTIABLE|<\/?\s*user_data|\bsk-ant[-a-z0-9]|JWT_SECRET|-----BEGIN|process\.env/i;

// LAW 1 on the chat surface: the model must not STATE numbers it authored — the
// deterministic tools + the plan own every number. This regex is the enforcement
// point, and it used to be much narrower than the law it enforces. It missed:
//
//   • INGREDIENT GRAMS — it only fired on `g` when followed by a macro noun, so
//     "200 g chicken" and "toss in 30g of rice" sailed through. A gram amount IS
//     a number the engine owns (portion scaling is the solver's job), and it is
//     the single most likely number for a food coach to volunteer.
//   • PRICES — LAW 1 names them explicitly ("calorie, macro, gram, price, or
//     count") and nothing checked. "$4 a serving" is model-authored costing;
//     recipeCost.js owns that number and refuses to fabricate a total.
//   • SPELLED-OUT NUMBERS — "two thousand calories" is the same claim as
//     "2000 calories" with the digits removed, which is exactly what a model
//     does when told not to write numbers.
//
// DELIBERATELY STILL ALLOWED: bare structural counts ("3 meals", "2 snacks",
// "lose 2 lbs"). LAW 1's prose does say "count", but the system prompt's own
// NARRATION block tells the model to speak in that register, and flagging it
// would fire the redirect on nearly every useful reply — the guard would become
// noise and stop meaning anything. That tension between LAW 1's wording and the
// NARRATION guidance is real and is reported rather than silently resolved here;
// this file enforces the reading the prompt and the tests already agree on.
const NUM = "\\d[\\d.,]*";
const SPELLED =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)" +
  "(?:[\\s-]+(?:and[\\s-]+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)){0,4}";
const MACRO = "(?:protein|carbs?|carbohydrates?|fat|fibre|fiber|sugar|sodium|salt)";
const ENERGY = "(?:k?cals?|calories?|kilojoules?|kj)";
const GRAMS = "(?:g|grams?|mg|milligrams?|oz|ounces?)";

const NUMBER_CLAIM_RE = new RegExp(
  [
    // energy: "2000 calories", "500kcal"
    `\\b${NUM}\\s*${ENERGY}\\b`,
    // macro grams either way round: "40g of protein", "protein: 40 g"
    `\\b${NUM}\\s*${GRAMS}\\s*(?:of\\s+)?${MACRO}\\b`,
    `\\b${MACRO}\\s*[:=-]?\\s*${NUM}\\s*${GRAMS}\\b`,
    // ANY weight amount — an ingredient gram is a number the solver owns
    `\\b${NUM}\\s*${GRAMS}\\b`,
    // prices: "$4", "4 dollars", "about 3.50 CAD", "costs 12"
    `[$£€]\\s*${NUM}`,
    `\\b${NUM}\\s*(?:dollars?|bucks|cents|usd|cad|eur|gbp)\\b`,
    `\\b(?:costs?|cost|price[ds]?|priced at|for about|for around)\\s+(?:about|around|roughly|~)?\\s*[$£€]?\\s*${NUM}\\b`,
    // spelled-out forms of all of the above
    `\\b${SPELLED}\\s+(?:${ENERGY}|${GRAMS}|dollars?|cents)\\b`,
    `\\b${SPELLED}\\s+${GRAMS}\\s+(?:of\\s+)?${MACRO}\\b`,
  ].join("|"),
  "i"
);

const NUMBER_REDIRECT = "I can talk through the approach, but for exact calories, macros, portions and costs use the Plan tab — those numbers come from the app's calculator, not me.";

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
