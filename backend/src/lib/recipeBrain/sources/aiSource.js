// Recipe Brain — channel 4: GOVERNED GENERATION. The most expensive answer,
// asked last, through the only door.
//
// This channel adds exactly one thing to the Stage 4 router's generation path:
// the SPEC rides into the prompt. The router asks for "~620 kcal, ~45 g
// protein"; a spec-driven ask adds the fat/carb guidance, the cost ceiling,
// the prep cap and the density requirement — because the fleet lab showed the
// pool's failures are STRUCTURAL (fat-heavy, protein-thin), and a generator
// that isn't told the structure keeps producing drafts the verifier throws
// away. Better-aimed asks = fewer discarded drafts = less spend for the same
// coverage. That is the whole economic argument, and it is measured by the
// attempts records this channel returns.
//
// UNCHANGED LAWS (inherited verbatim from mealRouter, which this channel is a
// sibling of, not a replacement for):
//   • every call goes through aiRecipeClient.generateRecipeDrafts → the
//     governed door (gate, caps, ledger, injection guard, timeout). This
//     module NEVER touches a transport.
//   • cheapest CAPABLE model first; escalation only after a failure a bigger
//     model plausibly fixes; terminal refusals stop the ladder.
//   • the model proposes, the code decides: every draft faces the caller's
//     verify gate (walls, placeholder audit, macro math, matrix caps) and a
//     failed draft is discarded, never repaired into something plausible.
const { generateRecipeDrafts, DRAFT_MAX_TOKENS } = require("../../aiRecipeClient.js");
const { MODEL_LADDER, ESCALATABLE, PRE_CALL_REFUSALS } = require("../../mealRouter.js");
const { estimateUsd } = require("../../brain/pricing.js");
const { defaultBudget } = require("../../brain/userBudget.js");

// ── spec → prompt hints (app-authored, deterministic, no user text) ─────────
// These become the aiRecipeClient's optional structured params. Every number
// is derived from the spec; nothing here is a wall (walls ride separately and
// are re-enforced in code afterwards, as always).
function specHints(spec) {
  if (!spec) return {};
  const hints = {};
  if (spec.fatTargetG) hints.targetFatG = { lo: spec.fatTargetG.lo, hi: spec.fatTargetG.hi };
  if (spec.carbTargetG || spec.keto) {
    hints.targetCarbG = spec.keto && spec.carbTargetG ? { lo: 0, hi: spec.carbTargetG.hi }
      : spec.carbTargetG ? { lo: spec.carbTargetG.lo, hi: spec.carbTargetG.hi } : null;
  }
  if (spec.caps?.maxCostCad != null) hints.maxCostCad = spec.caps.maxCostCad;
  else if (spec.soft?.budget === "cheap") hints.maxCostCad = 3.5; // the tier's own band edge (recipeCost.TIERS)
  if (spec.caps?.maxComplexity != null && spec.caps.maxComplexity <= 4) hints.keepSimple = true;
  if (spec.proteinDensityMid != null) hints.proteinDensityHint = spec.proteinDensityMid;
  if (spec.emphasis?.fat === "lower") hints.leanBias = true;
  return hints;
}

/**
 * generate({ spec, target, profile, existingRecipeNames, verifyImpl }, deps?) -> {
 *   accepted: { draft, verdict, model, tier } | null,
 *   attempts,      // per-tier records, mealRouter vocabulary (outcome codes)
 *   modelCalls,
 *   lastRefusal,   // for the orchestrator's honest degrade copy
 * }
 *
 * verifyImpl(draft) -> { ok, ... } is REQUIRED — this channel refuses to run
 * without a verify gate (fail closed beats generate-and-hope). The caller owns
 * verification so web and AI proposals face the identical screen.
 */
async function generate({ spec, target, profile = {}, existingRecipeNames = [], verifyImpl } = {}, deps = {}) {
  if (typeof verifyImpl !== "function") {
    throw new Error("aiSource.generate: verifyImpl is required — generation without a verify gate is not a thing this codebase does");
  }
  const {
    generateDraftsImpl = generateRecipeDrafts,
    ladder = MODEL_LADDER,
    budget = defaultBudget({ userId: profile?.userId ?? null }),
  } = deps;

  const rules = {
    excludedFoods: Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [],
    dietaryStyle: profile?.dietaryStyle || null,
  };
  const attempts = [];
  let modelCalls = 0;
  let lastRefusal = null;

  for (const [tier, model] of ladder.entries()) {
    if (tier > 0) {
      const prior = attempts[attempts.length - 1];
      if (!prior || !ESCALATABLE.has(prior.outcome)) break;
    }

    const projectedUsd = estimateUsd(model, { turns: 1, maxTokens: DRAFT_MAX_TOKENS });
    const gate = await budget.precheck(projectedUsd);
    if (!gate.allowed) {
      attempts.push({ model, tier, outcome: "cost-cap", reason: gate.reason, projectedUsd });
      lastRefusal = { code: "cost-cap", reason: gate.reason, message: gate.notice };
      break;
    }

    let out;
    try {
      out = await generateDraftsImpl(
        {
          slotType: spec.slotType,
          protein: spec.soft?.protein || undefined,
          cuisine: spec.soft?.cuisines?.[0] || undefined,
          prepTimeMin: spec.caps?.maxPrepMin || undefined,
          freeText: profile?.mealPreferencesNote || undefined,
          allowAllergens: false, // never negotiable on an unattended path
          targetKcal: target.kcalTarget,
          targetProtein: target.proteinTarget,
          existingRecipeNames,
          excludedFoods: rules.excludedFoods,
          dietaryStyle: rules.dietaryStyle,
          userId: profile?.userId ?? null,
          ...specHints(spec),
        },
        { ledger: budget, model }
      );
    } catch (e) {
      const code = e && e.code ? e.code : "llm-error";
      if (!PRE_CALL_REFUSALS.has(code)) modelCalls++;
      attempts.push({ model, tier, outcome: code, reason: e && e.reason ? e.reason : null, message: e && e.message ? e.message : null });
      lastRefusal = { code, reason: e && e.reason ? e.reason : null, message: e && e.message ? e.message : String(e) };
      if (!ESCALATABLE.has(code)) break;
      continue;
    }

    modelCalls++;
    const drafts = Array.isArray(out?.drafts) ? out.drafts : [];
    if (!drafts.length) {
      attempts.push({ model, tier, outcome: "no-usable-draft", droppedForAllergies: out?.droppedForAllergies?.length ?? 0, droppedForShape: out?.droppedForShape?.length ?? 0 });
      lastRefusal = { code: "no-usable-draft", reason: "every draft was dropped before verification", message: null };
      continue;
    }

    const discardedReasons = [];
    for (const draft of drafts) {
      const verdict = await verifyImpl(draft);
      if (!verdict || !verdict.ok) { discardedReasons.push(verdict?.reason || "failed verification"); continue; }
      attempts.push({ model, tier, outcome: "generated", discarded: discardedReasons.length });
      return { accepted: { draft, verdict, model, tier }, attempts, modelCalls, lastRefusal: null, discarded: discardedReasons };
    }

    attempts.push({ model, tier, outcome: "verification-failed", discarded: discardedReasons.length, reasons: discardedReasons });
    lastRefusal = { code: "verification-failed", reason: "every generated recipe failed verification", message: discardedReasons.join(" ") };
  }

  return { accepted: null, attempts, modelCalls, lastRefusal };
}

module.exports = { generate, specHints };
