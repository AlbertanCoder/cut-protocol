// Brain v2 — the CRITIC. Reviews ONE already-solved day for coherence/sanity
// and, when it finds real problems, proposes CONSTRAINTS for a single re-solve.
// It never touches macros: the deterministic solver owns every number. The
// critic can only (a) name problems and (b) hand back an exclude-list and an
// optional small protein-target nudge. HARD FALLBACK: brain off, or ANY
// error/timeout/garbage -> { ok:true, issues:[] }, i.e. a no-op that leaves the
// deterministic day exactly as it was.
const { isBrainEnabled, askJSON } = require("./llm.js");
const { defaultLedger, guardedCall } = require("./ledger.js");
const { estimateUsd } = require("./pricing.js");
const { MODELS } = require("./config.js");

const SYSTEM = [
  "You are a meal-plan QUALITY CRITIC for a cut-phase (fat-loss) meal planning app.",
  "You judge the COHERENCE and SANITY of a single day's meals — nothing else.",
  "Flag a day when it is silly or incoherent, for example: the same recipe or the",
  "same single protein repeated across every slot; combinations that don't read as",
  "real meals; extreme monotony; or a clear protein shortfall versus the day's",
  "protein target.",
  "You MUST NOT invent, set, or adjust any macronutrient or calorie numbers — the",
  "app's deterministic solver owns ALL macros and portions. You may ONLY flag",
  "problems and propose constraints for the app to RE-SOLVE the day: recipe ids to",
  "exclude, and an optional small protein-target boost as a fraction (0-0.5).",
  "Never suggest loosening an allergy or dietary style.",
  'Reply with ONLY a JSON object of exactly this shape (no prose, no code fence):',
  '{"ok": boolean, "issues": [{"slotRef": string, "problem": string}],',
  '"constraints": {"excludeRecipeIds": string[], "minProteinBoost": number}}',
  'Set "ok": true with an empty "issues" array when the day is coherent.',
].join(" ");

function buildUserPrompt({ slots = [], totals = {}, targets = {}, profile = {} } = {}) {
  const lines = [];
  const pMid = targets.proteinLo != null && targets.proteinHi != null
    ? Math.round((targets.proteinLo + targets.proteinHi) / 2)
    : null;
  lines.push(`Daily target: ~${Math.round(targets.kcal || 0)} kcal${pMid != null ? `, ~${pMid} g protein` : ""}.`);
  lines.push(`Day totals delivered: ${Math.round(totals.kcal || 0)} kcal, ${Math.round(totals.protein || 0)} g protein, ${Math.round(totals.carb || 0)} g carb, ${Math.round(totals.fat || 0)} g fat.`);
  if (profile?.dietaryStyle) lines.push(`Dietary style: ${profile.dietaryStyle} (hard rule — never suggest relaxing it).`);
  if (profile?.mealPreferencesNote) lines.push(`User preference note: ${profile.mealPreferencesNote}`);
  lines.push("Slots:");
  for (const s of slots) {
    lines.push(
      `- ${s.slotType || "meal"} #${s.slotIndex ?? 0}: "${s.recipeName || s.name || "?"}" (recipeId ${s.recipeId ?? "none"}) — ` +
      `${Math.round(s.kcal || 0)} kcal, ${Math.round(s.protein || 0)} g protein${s.warning ? ` [solver warning: ${s.warning}]` : ""}`
    );
  }
  lines.push("Is this day coherent? If not, list the issues and propose exclude ids / a small protein boost to re-solve.");
  return lines.join("\n");
}

// Coerce whatever the model returns into the strict, SAFE shape. Anything
// unexpected is dropped; the protein boost is clamped to [0,0.5]; only string
// recipe ids survive. Guarantees the caller can trust the result blindly.
function normalize(raw) {
  if (!raw || typeof raw !== "object") return { ok: true, issues: [] };
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .filter((i) => i && typeof i === "object")
        .map((i) => ({ slotRef: String(i.slotRef ?? ""), problem: String(i.problem ?? "") }))
        .filter((i) => i.problem)
    : [];
  const ok = raw.ok === true || issues.length === 0;
  const c = raw.constraints && typeof raw.constraints === "object" ? raw.constraints : {};
  const excludeRecipeIds = Array.isArray(c.excludeRecipeIds)
    ? c.excludeRecipeIds.filter((x) => typeof x === "string" && x)
    : [];
  const boostRaw = Number(c.minProteinBoost);
  const minProteinBoost = Number.isFinite(boostRaw) ? Math.min(0.5, Math.max(0, boostRaw)) : 0;
  const constraints = {};
  if (excludeRecipeIds.length) constraints.excludeRecipeIds = excludeRecipeIds;
  if (minProteinBoost > 0) constraints.minProteinBoost = minProteinBoost;
  return { ok, issues, constraints };
}

async function reviewDay(input = {}, deps = {}) {
  const { enabled = isBrainEnabled(), ask = askJSON, model = MODELS.workhorse } = deps;
  if (!enabled) return { ok: true, issues: [] };
  // LAW 4: cap-guard the critic's model call. The ledger is built only AFTER the
  // gate, so the brain-off path never constructs one. Deny -> no-op (the
  // deterministic day is left exactly as it was, same as any critic error).
  const ledger = deps.ledger || defaultLedger();
  const projectedUsd = estimateUsd(model, { turns: 1, maxTokens: 1024 });
  try {
    let usage = null;
    const gate = await guardedCall(ledger, { projectedUsd, userId: input.userId, model, phase: "critic", intent: "critic" },
      async () => ({ data: await ask({ system: SYSTEM, user: buildUserPrompt(input), model, onUsage: (u) => { usage = u; } }), usage }));
    if (!gate.allowed) return { ok: true, issues: [] };
    return normalize(gate.result.data);
  } catch {
    return { ok: true, issues: [] };
  }
}

module.exports = { reviewDay, buildUserPrompt, normalize };
