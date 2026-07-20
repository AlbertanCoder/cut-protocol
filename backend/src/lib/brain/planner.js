// Brain v3 — the planDay LOOP (gated + DORMANT in Stage A). Ties the spine
// together WITHOUT the deterministic solver ever depending on it:
//   GATE (LAW 4) → buildPool (LAW 2, once) → feasibility (fail fast, ZERO LLM)
//   → selector proposes ids/intents → deterministic compute (tools, LAW 1)
//   → verifier gate (LAW 1/2/3) → scorer → converge or (bounded) revise.
// The model never decides "done": satisfies() is the deterministic acceptance
// predicate. maxIters is a HARD cap from DEPTH_PROFILES. Honest failure only
// (LAW 7): impossible → failed/partial with the binding constraint + gaps, never
// a silent miss.
//
// Everything external is injectable (deps) so the whole loop is unit-testable
// with a mock client and no Prisma / no network. With the brain gated OFF (the
// default) planDay returns {status:'unavailable'} and the caller falls through
// to today's deterministic solver — byte-identical behaviour.
const { buildSlots, targetsForSlots } = require("../weeklyPlanner.js");
const { isBrainEnabled, DEPTH_PROFILES } = require("./llm.js");
const { buildPool } = require("./pool.js");
const { checkFeasibility, proteinMid } = require("./feasibility.js");
const { makeTools } = require("./tools.js");
const selector = require("./selector.js");
const { scorePlan } = require("./scorer.js");
const { verifyPlan } = require("./verifier.js");
const { buildSystemPrompt } = require("./prompts/system.js");

function buildSlotTargets(target, mealConfig) {
  const daySlots = buildSlots(mealConfig).filter((s) => s.dayOfWeek === 0);
  return targetsForSlots(target, daySlots).map((s) => ({
    slotType: s.slotType, slotIndex: s.slotIndex, kcalTarget: s.kcalTarget, proteinTarget: s.proteinTarget,
  }));
}

// Deterministic compute (LAW 1): scale each chosen recipe via the tool layer.
// The tool output IS the macro + its provenance, so the verifier's independent
// recompute matches exactly and the number is traceable.
function computeSlots(slots, tools) {
  const out = [];
  const unresolved = [];
  for (const s of slots) {
    if (!s.recipeId) { unresolved.push({ ...s, reason: "no-pick" }); continue; }
    try {
      const scaled = tools.scaleRecipe({ recipeId: s.recipeId, kcalTarget: s.kcalTarget, proteinTarget: s.proteinTarget });
      out.push({
        slotType: s.slotType, slotIndex: s.slotIndex, recipeId: s.recipeId,
        kcalTarget: s.kcalTarget, proteinTarget: s.proteinTarget,
        macros: scaled.value, value: scaled.value, ingredients: scaled.ingredients, prov: scaled.prov,
      });
    } catch {
      unresolved.push({ ...s, reason: "not-in-pool" });
    }
  }
  return { slots: out, unresolved };
}

// Deterministic acceptance predicate — the loop converges against THIS, never
// the model's say-so. kcal ±3% or ±50; protein ≥target−5 & ≤target+15; carb/fat
// within their band ±12.
function satisfies(totals, target) {
  const kcal = target.kcal || 0;
  const kcalOk = Math.abs(totals.kcal - kcal) <= Math.max(50, kcal * 0.03);
  const pMid = proteinMid(target);
  const proteinOk = totals.protein >= pMid - 5 && totals.protein <= pMid + 15;
  const bandOk = (v, lo, hi) => (lo == null && hi == null) || (v >= (lo ?? -Infinity) - 12 && v <= (hi ?? Infinity) + 12);
  return kcalOk && proteinOk && bandOk(totals.carb, target.carbLo, target.carbHi) && bandOk(totals.fat, target.fatLo, target.fatHi);
}

function gapsOf(totals, target) {
  return {
    kcal: Math.round((totals.kcal - (target.kcal || 0)) * 10) / 10,
    protein: Math.round((totals.protein - proteinMid(target)) * 10) / 10,
  };
}

/**
 * planDay({ profile, target, mealConfig, library, constraints, options }, deps)
 * -> PlanResult { status, day, totals, targets, gaps, within, iterations, reason, explanation, prov }
 * status: 'converged' | 'partial' | 'failed' | 'unavailable'.
 */
async function planDay({ profile, target, mealConfig = { meals: 3, snacks: 0 }, library = {}, constraints = {}, options = {} } = {}, deps = {}) {
  const {
    enabled = isBrainEnabled(),
    online = true,
    underCaps = true,
    depth = options.depth || "balanced",
    buildPoolFn = buildPool,
    feasibilityFn = checkFeasibility,
    makeToolsFn = makeTools,
    proposeDayFn = selector.proposeDay,
    scoreFn = scorePlan,
    verifyFn = verifyPlan,
  } = deps;

  const P = (value) => ({ formulaId: "planDay", inputs: { depth }, value });

  // GATE (LAW 4): opt-in + online + under caps. Otherwise the caller falls back
  // to the deterministic solver — no pool built, no tokens, no behaviour change.
  if (!enabled) return { status: "unavailable", reason: "brain-off", prov: P(false) };
  if (!online) return { status: "unavailable", reason: "offline", prov: P(false) };
  if (!underCaps) return { status: "unavailable", reason: "cost-cap", prov: P(false) };

  const pool = buildPoolFn(profile, library, constraints);
  const feas = feasibilityFn(pool, target);
  if (!feas.feasible) {
    // ZERO LLM calls on an infeasible pool.
    return { status: "failed", reason: feas.bindingConstraint, explanation: feas.message, gaps: null, within: false, iterations: 0, fixes: feas.fixes || [], prov: P(false) };
  }

  const tools = makeToolsFn(pool, profile);
  const slotTargets = buildSlotTargets(target, mealConfig);
  const system = options.system || buildSystemPrompt({ profile, depth, toolNames: Object.keys(tools) });
  const maxIters = (DEPTH_PROFILES[depth] || DEPTH_PROFILES.balanced).maxIters;

  let best = null;
  let iterations = 0;
  for (let i = 0; i < maxIters; i++) {
    iterations++;
    let proposal;
    try {
      proposal = await proposeDayFn({ slotTargets, tools, system, model: options.model, maxTurns: options.maxTurns });
    } catch {
      // Offline / timeout / model error mid-run → degrade (LAW 4). With nothing
      // verified yet, the caller falls back to the deterministic solver.
      if (!best) return { status: "unavailable", reason: "offline", explanation: "Brain call failed (offline/timeout); using the deterministic planner.", iterations, prov: P(false) };
      break; // otherwise keep bestSoFar
    }
    const { slots: computed, unresolved } = computeSlots(proposal.slots || [], tools);
    const verdict = verifyFn({ slots: computed }, { pool, profile, tools });
    const totals = tools.dayTotals({ slots: computed }).value;
    const scored = scoreFn({ slots: computed, totals }, target);
    const candidate = { slots: computed, unresolved, totals, score: scored.score, verdict };

    // Keep the best VERIFIED candidate; only fall back to an unverified one if
    // nothing verified has been seen (bestSoFar is always retained).
    if (verdict.ok) {
      if (!best || !best.verdict.ok || scored.score > best.score) best = candidate;
    } else if (!best) {
      best = candidate;
    }
    if (verdict.ok && satisfies(totals, target)) break;
  }

  const converged = !!best && best.verdict.ok && satisfies(best.totals, target);
  const status = converged ? "converged" : best && best.slots.length ? "partial" : "failed";
  return {
    status,
    day: best ? best.slots : [],
    totals: best ? best.totals : null,
    targets: target,
    gaps: best && best.totals ? gapsOf(best.totals, target) : null,
    within: converged,
    iterations,
    reason: converged ? null : status === "partial" ? "closest-fit" : "no-verified-candidate",
    explanation: converged ? null : status === "partial" ? "Shipped the closest VERIFIED fit within the iteration cap." : "No candidate passed verification.",
    verification: best ? best.verdict : null,
    prov: P(converged),
  };
}

module.exports = { planDay, satisfies, buildSlotTargets, computeSlots };
