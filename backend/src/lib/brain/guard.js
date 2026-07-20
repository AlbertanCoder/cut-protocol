// Brain v3 — the domain guard (Stage D, layer L2). preGate(text, {classify})
// runs defense-in-depth BEFORE any planning turn:
//   Tier-0 (deterministic, always): length cap, injection/extraction regex,
//     medical-dosing redirect.
//   Tier-1 (a Haiku classifier, INJECTED): decides the ambiguous middle. When
//     Tier-1 is unavailable (no key / over cap / error) the gate FAILS CLOSED —
//     it allows only a clearly food-related query and refuses everything else,
//     choosing safety over helpfulness. Decision table:
//       injection / extraction / secret  → refuse (injection)   [Tier-0]
//       medical / dosing                  → refuse (medical)     [Tier-0]
//       empty / >500 chars                → refuse (off_topic)   [Tier-0]
//       Tier-1 present  → its allow/refuse verdict
//       Tier-1 absent   → allow iff clearly food, else refuse (off_topic)
// Returns GuardVerdict { decision:'allow'|'refuse', category, confidence, refusalKey? }.
const MAX_LEN = 500;

// Instruction-injection / prompt-extraction / secret-exfiltration.
const INJECTION_RE = /(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|rule|prompt|previous|above|system|constraint)|(reveal|print|repeat|show|output|echo)\b.{0,30}\b(system|prompt|rule|instruction|above)|your\s+(system\s+)?(prompt|instructions|rules)|<\/?\s*user_data|\bsk-ant|api[\s_-]?key|jailbreak|you are now|act as (an?\s+)?(dan|unrestricted|jailbroken)|developer mode/i;

// Medical / clinical / supplement dosing — distinct doctor redirect.
const MEDICAL_RE = /\b(dose|dosage|dosing|how much .*(should i take|to take)|mg of|milligram|prescription|prescribe|metformin|insulin|ozempic|wegovy|semaglutide|steroids?|anabolic|medication|medicine|diagnos\w*|symptom|blood pressure|cholesterol (med|drug))\b/i;

// Clearly food / meal / diet related (Tier-0 allow signal).
const FOOD_RE = /\b(meal|meals|recipe|recipes|food|foods|eat|eating|ate|diet|dietary|nutrition|protein|carb|carbs|fat|fats|calorie|calories|kcal|macro|macros|breakfast|lunch|dinner|snack|snacks|cook|cooking|grocery|groceries|vegan|vegetarian|keto|paleo|halal|kosher|pescatarian|hungry|weight|cut|cutting|bulk|bulking|swap|serving|portion|ingredient|plan my day|meal plan|high[- ]?protein|low[- ]?carb)\b/i;

function verdict(decision, category, confidence, refusalKey) {
  return { decision, category, confidence, refusalKey };
}

async function preGate(text, { classify = null } = {}) {
  const t = String(text || "").trim();

  // ── Tier-0 (deterministic) ──
  if (t.length === 0 || t.length > MAX_LEN) return verdict("refuse", "off_topic", 1, "off_topic");
  if (INJECTION_RE.test(t)) return verdict("refuse", "injection", 1, "injection");
  if (MEDICAL_RE.test(t)) return verdict("refuse", "medical", 1, "medical");

  const foodish = FOOD_RE.test(t);

  // ── Tier-1 (injected classifier) ──
  if (typeof classify === "function") {
    try {
      const c = await classify(t); // { decision:'allow'|'refuse', category?, confidence? }
      if (c && c.decision === "allow") return verdict("allow", c.category || "food", c.confidence ?? 0.9);
      return verdict("refuse", (c && c.category) || "off_topic", c?.confidence ?? 0.9, "off_topic");
    } catch {
      // fall through to the fail-closed Tier-0 rule
    }
  }

  // ── No / failed Tier-1: fail closed unless Tier-0 clearly says food ──
  return foodish ? verdict("allow", "food", 0.6) : verdict("refuse", "off_topic", 0.6, "off_topic");
}

module.exports = { preGate, INJECTION_RE, MEDICAL_RE, FOOD_RE, MAX_LEN };
