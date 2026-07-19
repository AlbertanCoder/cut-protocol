// Brain v2 — the TAILOR. Given a recipe + the slot's targets + the user's
// profile, it may propose human-readable SWAP SUGGESTIONS and a short note
// ("swap white rice for cauliflower rice to cut carbs", etc.). It is advisory
// ONLY: the caller keeps using the deterministic scaleRecipe for the FINAL
// macros — the tailor never sets a number. FALLBACK: brain off, or ANY
// error/timeout/garbage -> null (no suggestion; caller proceeds unchanged).
const { isBrainEnabled, askJSON } = require("./llm.js");

const SYSTEM = [
  "You are a recipe TAILOR for a cut-phase meal planning app.",
  "Given one recipe and a slot's calorie/protein target, suggest small, realistic",
  "ingredient swaps that would make the dish fit the target better or suit the",
  "user's stated preferences — e.g. a leaner protein, a lower-carb side.",
  "You give SUGGESTIONS ONLY. You MUST NOT output calories, macros, or gram",
  "amounts — the app recomputes all numbers deterministically. Never suggest",
  "anything that violates the user's dietary style or allergies.",
  'Reply with ONLY a JSON object (no prose, no code fence):',
  '{"swaps": [{"from": string, "to": string, "why": string}], "note": string}',
  "Return an empty swaps array and a brief note if the recipe already fits well.",
].join(" ");

function buildUserPrompt({ recipe = {}, targets = {}, profile = {} } = {}) {
  const lines = [];
  lines.push(`Recipe: "${recipe.name || "?"}"${recipe.cuisine ? ` (${recipe.cuisine})` : ""}.`);
  const ings = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ings.length) {
    lines.push("Ingredients: " + ings.map((i) => (i.food?.name || i.name || "?")).join(", ") + ".");
  }
  lines.push(`Slot target: ~${Math.round(targets.kcalTarget || targets.kcal || 0)} kcal, ~${Math.round(targets.proteinTarget || 0)} g protein.`);
  if (profile?.dietaryStyle) lines.push(`Dietary style: ${profile.dietaryStyle} (hard rule).`);
  if (Array.isArray(profile?.excludedFoods) && profile.excludedFoods.length) {
    lines.push(`Must avoid: ${profile.excludedFoods.join(", ")}.`);
  }
  if (profile?.mealPreferencesNote) lines.push(`Preference note: ${profile.mealPreferencesNote}`);
  lines.push("Suggest swaps (or none) — no numbers, just ingredient changes and a short why.");
  return lines.join("\n");
}

// Coerce to { swaps?, note } with strings only; drop anything malformed. A
// result with neither usable swaps nor a note collapses to null (no-op).
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const swaps = Array.isArray(raw.swaps)
    ? raw.swaps
        .filter((s) => s && typeof s === "object")
        .map((s) => ({ from: String(s.from ?? ""), to: String(s.to ?? ""), why: String(s.why ?? "") }))
        .filter((s) => s.from && s.to)
    : [];
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (!swaps.length && !note) return null;
  const out = { note };
  if (swaps.length) out.swaps = swaps;
  return out;
}

async function tailorRecipe(input = {}) {
  if (!isBrainEnabled()) return null;
  try {
    const raw = await askJSON({ system: SYSTEM, user: buildUserPrompt(input) });
    return normalize(raw);
  } catch {
    return null;
  }
}

module.exports = { tailorRecipe, buildUserPrompt, normalize };
