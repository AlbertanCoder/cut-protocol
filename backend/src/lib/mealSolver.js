// Phase 4 solver layer on top of weeklyPlanner's proven slot mechanics:
// - N complete-day candidates, each scored honestly against the daily targets
// - soft preference biases (cuisine / protein / budget) that shape pick
//   probability but never eligibility — hard rules (diet, allergies, prep
//   cap) live in pool filtering, full stop
// - 3-alternate generation for a single slot
// - structured infeasibility diagnosis that names the constraint to loosen
//   (never a silent failure, and NEVER a suggestion to loosen an allergy)
const {
  buildSlots, targetsForSlots, solveDay, resolveSlot, scaleRecipe,
  generateWeekPlan, eligibleRecipes, DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP,
} = require("./weeklyPlanner.js");
const { buildCostCache } = require("./recipeCost.js");

// ── hard filters ─────────────────────────────────────────────────────────

// Max prep time is a hard cap. Recipes with unknown prep time pass (we
// can't honestly exclude on data we don't have) — the diagnosis discloses
// how many unknowns are in play when the pool runs thin.
function applyPrepFilter(pool, maxPrepMin) {
  if (!maxPrepMin) return pool;
  return pool.filter((r) => r.prepTimeMin == null || r.prepTimeMin <= maxPrepMin);
}

// ── soft biases ──────────────────────────────────────────────────────────

const BUDGET_ORDER = { cheap: 0, moderate: 1, premium: 2 };

function recipeMentionsProtein(recipe, protein) {
  const needle = protein.toLowerCase();
  if (recipe.name.toLowerCase().includes(needle)) return true;
  return recipe.ingredients.some((i) => (i.food?.name || i.name || "").toLowerCase().includes(needle));
}

/**
 * filters: { cuisines: string[], protein: string, budget: "cheap"|"moderate"|"premium", ... }
 * Returns a per-recipe weight multiplier for pickRecipe. Multipliers, never
 * vetoes: a strongly-preferred pool that can't hit macros should still be
 * beatable by an off-preference recipe that can.
 */
function buildBias(filters = {}, costCache = null) {
  const cuisines = (filters.cuisines || []).filter(Boolean);
  const protein = filters.protein || null;
  const budget = filters.budget || null;
  // T (v2): SOFT taste ratings — a Map<recipeId, 1|-1>. Re-ranks which recipes
  // the solver prefers; never changes a macro (LAW 1) or overrides a hard diet/
  // allergy filter. Absent/empty → no term → bias is byte-identical to before.
  const ratings = filters.ratings instanceof Map && filters.ratings.size > 0 ? filters.ratings : null;
  if (!cuisines.length && !protein && !budget && !ratings) return null;

  return (recipe) => {
    let w = 1;
    if (cuisines.length) {
      w *= recipe.cuisine && cuisines.includes(recipe.cuisine) ? 3 : 0.7;
    }
    if (protein) {
      w *= recipeMentionsProtein(recipe, protein) ? 2.5 : 0.8;
    }
    if (budget && costCache) {
      const c = costCache.get(recipe.id);
      if (c && c.tier !== "unknown") {
        const diff = BUDGET_ORDER[c.tier] - BUDGET_ORDER[budget];
        w *= diff <= 0 ? 1.8 : 0.5; // at-or-under budget boosted, over dampened
      }
    }
    if (ratings) {
      const r = ratings.get(recipe.id);
      if (r === 1) w *= 1.6; // liked → boosted
      else if (r === -1) w *= 0.35; // disliked → dampened, never fully excluded (soft)
    }
    return w;
  };
}

// ── day scoring ──────────────────────────────────────────────────────────

// Honest match %: weighted, capped error terms — 55% calories (the wall),
// 30% protein shortfall (the other wall, asymmetric), 7.5% each for fat and
// carb landing outside their ranges. 100% = everything on target; the UI is
// expected to present this as closest-fit, not a promise of perfection.
const SCORE_WEIGHTS = { kcal: 0.55, protein: 0.3, fat: 0.075, carb: 0.075 };

function scoreDay(dailyTarget, slots) {
  const t = slots.reduce(
    (s, x) => ({ kcal: s.kcal + x.kcal, protein: s.protein + x.protein, fat: s.fat + x.fat, carb: s.carb + x.carb }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const kcalErr = dailyTarget.kcal > 0 ? Math.abs(t.kcal - dailyTarget.kcal) / dailyTarget.kcal : 1;
  const proteinShort = pMid > 0 ? Math.max(0, (pMid - t.protein) / pMid) : 0;
  const rangeMiss = (v, lo, hi) => (v < lo ? (lo - v) / Math.max(hi, 1) : v > hi ? (v - hi) / Math.max(hi, 1) : 0);
  const fatOut = rangeMiss(t.fat, dailyTarget.fatLo, dailyTarget.fatHi);
  const carbOut = rangeMiss(t.carb, dailyTarget.carbLo, dailyTarget.carbHi);
  const cap = (x) => Math.min(1, x);
  const err =
    SCORE_WEIGHTS.kcal * cap(kcalErr) +
    SCORE_WEIGHTS.protein * cap(proteinShort) +
    SCORE_WEIGHTS.fat * cap(fatOut) +
    SCORE_WEIGHTS.carb * cap(carbOut);
  return {
    matchPct: Math.round(Math.max(0, 1 - err) * 100),
    totals: { kcal: Math.round(t.kcal), protein: Math.round(t.protein), fat: Math.round(t.fat), carb: Math.round(t.carb) },
    kcalErrPct: Math.round(kcalErr * 1000) / 10,
    proteinShortPct: Math.round(proteinShort * 1000) / 10,
    fatInRange: fatOut === 0,
    carbInRange: carbOut === 0,
  };
}

// ── infeasibility diagnosis ──────────────────────────────────────────────

/**
 * counts: { raw, afterDiet, afterPrep } — pool sizes as each HARD filter
 * applied. Produces reasons + concrete suggestions. Allergies and dietary
 * style are named as the binding constraint when they are, but loosening an
 * ALLERGY is never suggested — that list ends at prep time, batch repeats,
 * meal structure, and AI generation.
 */
function diagnose({ counts, filters, dailyTarget, mealConfig, pool }) {
  const reasons = [];
  const suggestions = [];
  const slotsPerDay = (mealConfig.meals || 0) + (mealConfig.snacks || 0);

  if (counts.afterDiet === 0) {
    reasons.push("Your dietary style + allergy rules exclude every recipe in the library.");
    suggestions.push("Generate new compliant recipes with the AI on the Recipes tab — the filters here can't conjure dishes that don't exist yet.");
    return { feasible: false, reasons, suggestions };
  }
  if (filters?.maxPrepMin && counts.afterPrep < counts.afterDiet) {
    const cut = counts.afterDiet - counts.afterPrep;
    if (counts.afterPrep < Math.max(slotsPerDay * 3, 12)) {
      reasons.push(`Max prep ${filters.maxPrepMin} min cuts the compliant pool from ${counts.afterDiet} to ${counts.afterPrep} recipes (${cut} removed).`);
      suggestions.push(`Raise max prep time (each step back adds recipes — without the cap you have ${counts.afterDiet}).`);
    }
  }
  // Weekly capacity: only MEAL-eligible recipes fill meal slots (desserts,
  // beverages, condiment sides don't count), each capped by the repeat rule.
  // Stage-C fix (#35): use the ACTIVE repeat cap — with batch-cooking on the
  // cap is BATCH_REPEAT_CAP, so the old math undercounted capacity and could
  // suggest enabling batch repeats that were already enabled.
  const repeatCap = filters?.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
  const mealEligible = eligibleRecipes(pool, "meal", new Map(), repeatCap).length;
  const weeklyMealSlots = (mealConfig.meals || 0) * 7;
  const capacity = mealEligible * repeatCap;
  if (weeklyMealSlots > 0 && capacity < weeklyMealSlots * 1.3) {
    reasons.push(`${mealEligible} meal-eligible recipes × max ${repeatCap} servings/week = ${capacity} servings for ${weeklyMealSlots} meal slots — the back half of the week will run on poor fits.`);
    suggestions.push(filters?.allowBatchRepeats
      ? "Reduce meals per day, or AI-generate more compliant recipes to deepen the pool."
      : "Allow batch-cooking repeats, reduce meals per day, or AI-generate more compliant recipes.");
  }
  // Protein density: the solver can only scale what exists. If almost
  // nothing meal-eligible carries the protein-per-kcal ratio the targets
  // need, days will chronically land protein-short.
  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const neededRatio = dailyTarget.kcal > 0 ? pMid / dailyTarget.kcal : 0;
  const densePool = pool.filter((r) => r.kcal > 0 && r.protein / r.kcal >= neededRatio * 0.75);
  const denseNeeded = Math.max(10, (mealConfig.meals || 3) * 4);
  if (pool.length > 0 && densePool.length < denseNeeded) {
    reasons.push(`Your targets need ~${Math.round(neededRatio * 1000) / 10}g protein per 100 kcal; only ${densePool.length} of ${pool.length} eligible recipes come close (${denseNeeded}+ needed for a full varied week).`);
    suggestions.push("Set the protein-preference filter, or AI-generate a few high-protein recipes to deepen the pool.");
  }
  return { feasible: reasons.length === 0, reasons, suggestions };
}

/**
 * Post-hoc diagnosis from an actual solve result — no threshold lottery.
 * Called whenever an outcome is rough (day candidates all warned, or a week
 * lands <6/7 days in tolerance): classifies what actually bound the solve
 * and GUARANTEES at least one concrete reason + suggestion, so a needed
 * explanation can never come back empty.
 */
function diagnoseFromResult({ dailyTarget, slots, pool, mealConfig, filters = {}, preSolve = null }) {
  const base = preSolve || diagnose({
    counts: { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length },
    filters, dailyTarget, mealConfig, pool,
  });
  const reasons = [...base.reasons];
  const suggestions = [...base.suggestions];

  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const byDay = new Map();
  for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
  let proteinShortDays = 0, kcalOffDays = 0;
  for (const [, daySlots] of byDay) {
    const t = daySlots.reduce((a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein }), { kcal: 0, protein: 0 });
    if ((pMid - t.protein) / pMid > 0.15) proteinShortDays++;
    if (Math.abs(t.kcal - dailyTarget.kcal) / dailyTarget.kcal > 0.15) kcalOffDays++;
  }

  if (reasons.length === 0 && proteinShortDays > 0) {
    const neededRatio = dailyTarget.kcal > 0 ? pMid / dailyTarget.kcal : 0;
    const dense = pool.filter((r) => r.kcal > 0 && r.protein / r.kcal >= neededRatio * 0.75).length;
    reasons.push(`${proteinShortDays} day(s) landed protein-short: your targets need ~${Math.round(neededRatio * 1000) / 10}g protein per 100 kcal and only ${dense} of ${pool.length} compliant recipes come close, so the back half of the week runs out of good fits.`);
    suggestions.push("AI-generate a few high-protein compliant recipes, set the protein-preference filter, or allow batch-cooking repeats of the dense dishes.");
  }
  if (reasons.length === 0 && kcalOffDays > 0) {
    reasons.push(`${kcalOffDays} day(s) missed the calorie window: within the 0.5–2× portion bounds, the compliant pool's dishes can't stretch/shrink to your slot sizes.`);
    suggestions.push("Adjust meals/snacks per day so slot sizes better match the pool's typical dishes, or allow batch-cooking repeats.");
  }
  if (reasons.length === 0) {
    reasons.push(`The solver shipped its closest fits, but ${pool.length} compliant recipes give it little room under the current variety rules.`);
    suggestions.push("Allow batch-cooking repeats or AI-generate more compliant recipes to deepen the pool.");
  }
  return { feasible: false, reasons, suggestions };
}

// ── day candidates ───────────────────────────────────────────────────────

const dayName = (d) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][d] || `day ${d}`;

/**
 * Generate `count` distinct complete-day plans for one day-of-week, scored.
 * weekUsage/prevDayIds let the candidates respect what the rest of the week
 * already serves. No AI fallback here — candidates must return in
 * milliseconds; the AI path lives on explicit generate/swap actions.
 */
async function generateDayCandidates({
  dailyTarget, mealConfig, recipePool, dayOfWeek = 0,
  filters = {}, weekUsage = new Map(), prevDayIds = new Set(),
  count = 3, attempts = 9, rng = Math.random, profile = null,
}) {
  const afterPrep = applyPrepFilter(recipePool, filters.maxPrepMin);
  const costCache = filters.budget ? buildCostCache(afterPrep) : null;
  const bias = buildBias(filters, costCache);
  const repeatCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;

  const dayTargets = targetsForSlots(dailyTarget, buildSlots(mealConfig))
    .filter((s) => s.dayOfWeek === 0)
    .map((s) => ({ ...s, dayOfWeek }));

  const seen = new Map(); // signature -> candidate
  for (let i = 0; i < attempts; i++) {
    const usage = new Map(weekUsage);
    const { slots } = await solveDay(dayTargets, dailyTarget, afterPrep, usage, prevDayIds, rng, null, bias, repeatCap);
    const signature = slots.map((s) => `${s.recipeId}:${s.proteinScale}`).join("|");
    if (seen.has(signature)) continue;
    const score = scoreDay(dailyTarget, slots);
    seen.set(signature, { slots, score, hasWarnings: slots.some((s) => s.warning) });
  }

  const candidates = [...seen.values()]
    .sort((a, b) => b.score.matchPct - a.score.matchPct)
    .slice(0, count);

  // Brain v2 (Phase 10): an OPTIONAL LLM critic pass on the BEST day, strictly
  // behind the ANTHROPIC_API_KEY + BRAIN gate AND requiring a profile (the
  // critic's dietary context). When the brain is off — the default, and whenever
  // no profile is supplied (e.g. every unit test) — this whole block is skipped:
  // candidate output stays byte-identical to the deterministic solver and ZERO
  // LLM calls happen. The deterministic solver remains authoritative; the critic
  // only proposes CONSTRAINTS for one bounded re-solve, and reviseDayWithCritic
  // keeps whichever day scores higher.
  if (profile && candidates.length) {
    // Lazy require so nothing brain-related (or the Anthropic SDK) loads on the
    // deterministic hot path when the brain is disabled.
    const { isBrainEnabled, reviseDayWithCritic } = require("./brain/index.js");
    if (isBrainEnabled()) {
      const solve = async (constraints) => {
        if (!constraints) return { slots: candidates[0].slots }; // reuse the already-solved best day
        const excl = new Set(Array.isArray(constraints.excludeRecipeIds) ? constraints.excludeRecipeIds : []);
        const resolvePool = excl.size ? afterPrep.filter((r) => !excl.has(r.id)) : afterPrep;
        // A protein-target NUDGE only — scaleRecipe still computes the real
        // macros deterministically, so the LLM never sets a number.
        const boost = 1 + Math.min(0.5, Math.max(0, Number(constraints.minProteinBoost) || 0));
        const boostedDaily = boost === 1 ? dailyTarget : { ...dailyTarget, proteinLo: dailyTarget.proteinLo * boost, proteinHi: dailyTarget.proteinHi * boost };
        const boostedTargets = boost === 1 ? dayTargets : dayTargets.map((t) => ({ ...t, proteinTarget: t.proteinTarget * boost }));
        const { slots } = await solveDay(boostedTargets, boostedDaily, resolvePool, new Map(weekUsage), prevDayIds, rng, null, bias, repeatCap);
        return { slots };
      };
      const revision = await reviseDayWithCritic({
        solve,
        scoreDay: (slots) => scoreDay(dailyTarget, slots),
        targets: { kcal: dailyTarget.kcal, proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi, fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, carbLo: dailyTarget.carbLo, carbHi: dailyTarget.carbHi },
        profile,
      });
      if (revision.revised) {
        candidates[0] = { slots: revision.slots, score: revision.score, hasWarnings: revision.slots.some((s) => s.warning) };
        candidates.sort((a, b) => b.score.matchPct - a.score.matchPct);
      }
    }
  }

  const counts = { raw: recipePool.length, afterDiet: recipePool.length, afterPrep: afterPrep.length };
  const needDiagnosis =
    candidates.length === 0 ||
    candidates[0].score.matchPct < 60 ||
    candidates.every((c) => c.hasWarnings);
  // Result-driven: when the outcome is rough, the explanation derives from
  // what actually bound the solve and is guaranteed non-empty.
  const diagnosis = needDiagnosis
    ? diagnoseFromResult({
        dailyTarget, slots: candidates[0]?.slots || [], pool: afterPrep, mealConfig, filters,
        preSolve: diagnose({ counts, filters, dailyTarget, mealConfig, pool: afterPrep }),
      })
    : null;

  return { dayOfWeek, dayName: dayName(dayOfWeek), candidates, diagnosis, poolSize: afterPrep.length };
}

// ── best-of-K week generation ────────────────────────────────────────────

function scoreWeek(dailyTarget, slots) {
  const byDay = new Map();
  for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
  let daysInTolerance = 0;
  let matchSum = 0;
  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  for (const [, daySlots] of byDay) {
    const sc = scoreDay(dailyTarget, daySlots);
    matchSum += sc.matchPct;
    const kcalOk = Math.abs(sc.totals.kcal - dailyTarget.kcal) / dailyTarget.kcal <= 0.15;
    const proteinOk = (pMid - sc.totals.protein) / pMid <= 0.15;
    if (kcalOk && proteinOk) daysInTolerance++;
  }
  return { daysInTolerance, avgMatch: Math.round(matchSum / Math.max(1, byDay.size)) };
}

/**
 * The week-level equivalent of day candidates: run the (cheap, AI-free)
 * week solve `attempts` times, keep the best-scoring week — more days in
 * tolerance first, average match second. Only THEN, if the best week still
 * has warning slots, one final pass may use the AI fallback to patch them
 * via the caller's swap flow. Keeps generation fast and the outcome honest.
 */
async function generateBestWeekPlan(dailyTarget, mealConfig, recipePool, options = {}) {
  // Stage-C (L4): more attempts + randomized day order (in generateWeekPlan)
  // give best-of-N a genuinely varied set to pick the least-drifted week from.
  const attempts = options.attempts ?? 5;
  const filters = options.filters || {};
  let best = null;
  for (let i = 0; i < attempts; i++) {
    const slots = await generateWeekPlan(dailyTarget, mealConfig, recipePool, { ...options, aiFallback: undefined });
    const score = scoreWeek(dailyTarget, slots);
    if (!best || score.daysInTolerance > best.score.daysInTolerance ||
        (score.daysInTolerance === best.score.daysInTolerance && score.avgMatch > best.score.avgMatch)) {
      best = { slots, score };
    }
    if (best.score.daysInTolerance === 7 && best.score.avgMatch >= 95) break;
  }
  // A rough week never ships silently: attach the result-driven diagnosis.
  // Stage-C fix (M10): when pool counts are supplied, the diagnosis derives
  // from raw/afterDiet/afterPrep so it names the real binding constraint.
  const preSolve = options.counts
    ? diagnose({ counts: options.counts, filters, dailyTarget, mealConfig, pool: recipePool })
    : undefined;
  best.diagnosis = best.score.daysInTolerance < 6
    ? diagnoseFromResult({ dailyTarget, slots: best.slots, pool: recipePool, mealConfig, filters, preSolve })
    : null;
  return best;
}

// ── slot alternates ──────────────────────────────────────────────────────

/**
 * Up to `count` DISTINCT alternates for one existing slot, each scored
 * against the slot's own target. excludeRecipeIds keeps the current recipe
 * (and anything already offered) out of the list.
 */
async function alternatesForSlot({
  slotTarget, recipePool, existingSlots, filters = {},
  excludeRecipeIds = [], count = 3, rng = Math.random,
}) {
  const afterPrep = applyPrepFilter(recipePool, filters.maxPrepMin);
  const costCache = filters.budget ? buildCostCache(afterPrep) : null;
  const bias = buildBias(filters, costCache);
  const repeatCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;

  const usageCount = new Map();
  for (const s of existingSlots) {
    if (s.recipeId) usageCount.set(s.recipeId, (usageCount.get(s.recipeId) || 0) + 1);
  }
  const usedToday = new Set(
    existingSlots.filter((s) => s.dayOfWeek === slotTarget.dayOfWeek && s.recipeId).map((s) => s.recipeId)
  );
  const excluded = new Set(excludeRecipeIds);

  const alternates = [];
  const offered = new Set();
  for (let i = 0; i < count * 4 && alternates.length < count; i++) {
    const pool = afterPrep.filter((r) => !excluded.has(r.id) && !offered.has(r.id));
    if (pool.length === 0) break;
    const result = await resolveSlot(slotTarget, pool, new Map(usageCount), new Set(), usedToday, rng, null, bias, repeatCap);
    if (!result.recipeId || offered.has(result.recipeId)) continue;
    offered.add(result.recipeId);
    const kcalErr = slotTarget.kcalTarget > 0 ? Math.abs(result.kcal - slotTarget.kcalTarget) / slotTarget.kcalTarget : 0;
    const pShort = slotTarget.proteinTarget > 0 ? Math.max(0, (slotTarget.proteinTarget - result.protein) / slotTarget.proteinTarget) : 0;
    const matchPct = Math.round(Math.max(0, 1 - (0.6 * Math.min(1, kcalErr) + 0.4 * Math.min(1, pShort))) * 100);
    alternates.push({ ...result, matchPct });
  }
  return alternates;
}

module.exports = {
  applyPrepFilter, buildBias, scoreDay, scoreWeek, diagnose, diagnoseFromResult,
  generateDayCandidates, generateBestWeekPlan, alternatesForSlot, SCORE_WEIGHTS,
};
