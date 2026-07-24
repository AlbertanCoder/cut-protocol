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
  generateWeekPlan, eligibleRecipes, estimateSlotTarget, buildLockedMap,
  DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP, SCALE_BOUNDS, PROTEIN_TOLERANCE_PCT,
} = require("./weeklyPlanner.js");
const { buildCostCache } = require("./recipeCost.js");
// Protein-priority / recomposition mode — shared weighting + honesty-check
// primitives (also consumed by brain/scorer.js so the floor means the same
// number in both places). Pure math, no LLM: safe on this always-on path.
const { PROTEIN_PRIORITY_WEIGHTS, checkProteinFloor } = require("./brain/proteinFloor.js");

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

/**
 * scoreDay(dailyTarget, slots, opts?) -> honest match% + totals (+ proteinFloor
 * when protein-priority mode is on).
 * opts.proteinPriority (default false): swaps SCORE_WEIGHTS for
 * PROTEIN_PRIORITY_WEIGHTS — protein becomes the dominant term instead of
 * calories — so a kcal-perfect but protein-short day can no longer outscore
 * one that defends the floor, AND attaches `proteinFloor` ({met, shortG,
 * reason}) so a miss is declared, never silently absorbed into the blended
 * score (LAW 7). Omitting opts reproduces today's output byte-for-byte
 * (locked by tests/golden/goldenBaseline.test.js) — no proteinFloor key at
 * all outside this mode, matching scorer.js's identical contract.
 */
function scoreDay(dailyTarget, slots, opts = {}) {
  const priority = Boolean(opts.proteinPriority);
  const weights = priority ? PROTEIN_PRIORITY_WEIGHTS : SCORE_WEIGHTS;
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
    weights.kcal * cap(kcalErr) +
    weights.protein * cap(proteinShort) +
    weights.fat * cap(fatOut) +
    weights.carb * cap(carbOut);
  return {
    matchPct: Math.round(Math.max(0, 1 - err) * 100),
    totals: { kcal: Math.round(t.kcal), protein: Math.round(t.protein), fat: Math.round(t.fat), carb: Math.round(t.carb) },
    kcalErrPct: Math.round(kcalErr * 1000) / 10,
    proteinShortPct: Math.round(proteinShort * 1000) / 10,
    fatInRange: fatOut === 0,
    carbInRange: carbOut === 0,
    ...(priority ? { proteinFloor: checkProteinFloor(t.protein, dailyTarget.proteinLo) } : {}),
  };
}

// A day's totals are "in tolerance" on ALL FOUR macros — calories within ±15%,
// protein no more than 15% short, and fat/carbs no further than 25% of their
// own band midpoint outside their target range. Single-sourced here so the week
// score, the per-day report and every test read the same rule.
//
// solver-core-2 (2026-07-23): fat and carbs used to be COMPUTED (scoreDay
// already produced fatInRange/carbInRange) and then dropped on the floor —
// dayTolerance/dayMissLine/diagnoseFromResult were kcal+protein only, so a
// fat-starved day shipped green with nothing said about it. A macro the app
// prescribes is a macro the app has to report on.
//
// Why a band-relative slack instead of the raw range: computeMacros() emits a
// deliberately NARROW fat band (lbm×0.34 … lbm×0.40 — about ±8% around the
// midpoint) and a ±12 g carb band. Judging a day strictly inside those windows
// would fail nearly every real plan and make the flag meaningless. 25% of the
// band midpoint is the "badly off" line: far enough out to matter, not a
// rounding complaint.
const DAY_KCAL_TOLERANCE_PCT = 0.15;
const DAY_PROTEIN_TOLERANCE_PCT = 0.15;
const DAY_FAT_TOLERANCE_PCT = 0.25;
const DAY_CARB_TOLERANCE_PCT = 0.25;

// How far `v` sits outside [lo, hi], as a fraction of the band midpoint.
// Direction is kept separate: a fat SHORTFALL and a keto carb OVERSHOOT are
// different failures and get judged on different allowances.
function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { shortPct: 0, overPct: 0, mid };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { shortPct: (lo - val) / mid, overPct: 0, mid };
  if (val > hi) return { shortPct: 0, overPct: (val - hi) / mid, mid };
  return { shortPct: 0, overPct: 0, mid };
}

const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

function dayTolerance(dailyTarget, totals) {
  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const kcalDeltaPct = dailyTarget.kcal > 0 ? (totals.kcal - dailyTarget.kcal) / dailyTarget.kcal : 1;
  const proteinShortPct = pMid > 0 ? Math.max(0, (pMid - totals.protein) / pMid) : 0;
  // A target that carries no fat/carb band (older fixtures, partial targets)
  // cannot be judged on it — absent is absent, never a silent pass OR fail.
  const fatBand = hasBand(dailyTarget.fatLo, dailyTarget.fatHi);
  const carbBand = hasBand(dailyTarget.carbLo, dailyTarget.carbHi);
  const fat = fatBand ? bandMiss(totals.fat, dailyTarget.fatLo, dailyTarget.fatHi) : { shortPct: 0, overPct: 0, mid: null };
  const carb = carbBand ? bandMiss(totals.carb, dailyTarget.carbLo, dailyTarget.carbHi) : { shortPct: 0, overPct: 0, mid: null };
  // Keto's carb ceiling is a diet LAW, not a preference: there is no upward
  // allowance on carbs for a ketogenic target (computeMacros stamps `keto`).
  const carbOverAllowance = dailyTarget.keto ? 0 : DAY_CARB_TOLERANCE_PCT;
  return {
    kcalDeltaPct, proteinShortPct,
    kcalOk: Math.abs(kcalDeltaPct) <= DAY_KCAL_TOLERANCE_PCT,
    proteinOk: proteinShortPct <= DAY_PROTEIN_TOLERANCE_PCT,
    proteinMid: pMid,
    fatShortPct: fat.shortPct, fatOverPct: fat.overPct,
    carbShortPct: carb.shortPct, carbOverPct: carb.overPct,
    fatJudged: fatBand, carbJudged: carbBand,
    fatOk: !fatBand || (fat.shortPct <= DAY_FAT_TOLERANCE_PCT && fat.overPct <= DAY_FAT_TOLERANCE_PCT),
    carbOk: !carbBand || (carb.shortPct <= DAY_CARB_TOLERANCE_PCT && carb.overPct <= carbOverAllowance),
  };
}

// One verdict, so no caller can accidentally judge a day on a subset of it.
const dayInTolerance = (t) => t.kcalOk && t.proteinOk && t.fatOk && t.carbOk;

/**
 * Plain-English statement of what a day actually missed by. Plain numbers, no
 * jargon, no scolding — the calorie line reads "over"/"under" and the protein
 * line reads "short", exactly as the constitution's honesty rule requires
 * ("Over by 340 — tomorrow already adjusts", not a red failure badge).
 * Returns null when the day landed inside tolerance.
 */
function dayMissLine(dailyTarget, totals) {
  const t = dayTolerance(dailyTarget, totals);
  const parts = [];
  if (!t.kcalOk) {
    const diff = Math.round(totals.kcal - dailyTarget.kcal);
    parts.push(`${Math.round(totals.kcal).toLocaleString("en-CA")} kcal vs a ${Math.round(dailyTarget.kcal).toLocaleString("en-CA")} target — ${Math.abs(diff).toLocaleString("en-CA")} ${diff > 0 ? "over" : "under"}`);
  }
  if (!t.proteinOk) {
    parts.push(`${Math.round(totals.protein)} g protein vs ${Math.round(t.proteinMid)} g — ${Math.round(t.proteinMid - totals.protein)} g short`);
  }
  // Fat and carbs state the RANGE they missed and by how much — same plain
  // shape as the two lines above, same no-guilt vocabulary.
  const rangeLine = (label, value, lo, hi, short) => {
    const edge = short ? lo : hi;
    const by = Math.round(Math.abs(value - edge));
    return `${Math.round(value)} g ${label} vs a ${Math.round(lo)}–${Math.round(hi)} g range — ${by} g ${short ? "short" : "over"}`;
  };
  if (!t.fatOk) parts.push(rangeLine("fat", totals.fat || 0, dailyTarget.fatLo, dailyTarget.fatHi, t.fatShortPct > 0));
  if (!t.carbOk) parts.push(rangeLine("carbs", totals.carb || 0, dailyTarget.carbLo, dailyTarget.carbHi, t.carbShortPct > 0));
  return parts.length ? parts.join("; ") : null;
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
  // SNACK capacity, same arithmetic (solver benchmark, 2026-07-21). Only 9 of
  // the 889 shipped recipes are snack-eligible, and after a vegan/vegetarian
  // filter that is ZERO — so snack slots came back empty while the only reason
  // offered talked about protein density. A slot the solver cannot fill has to
  // say so in its own words.
  const snackEligible = eligibleRecipes(pool, "snack", new Map(), repeatCap).length;
  const weeklySnackSlots = (mealConfig.snacks || 0) * 7;
  const snackCapacity = snackEligible * repeatCap;
  if (weeklySnackSlots > 0 && snackCapacity < weeklySnackSlots) {
    reasons.push(snackEligible === 0
      ? `Your library has no snack-sized recipe that fits your rules — all ${weeklySnackSlots} snack slots this week come back empty.`
      : `${snackEligible} snack recipe(s) fit your rules × max ${repeatCap} servings/week = ${snackCapacity} servings for ${weeklySnackSlots} snack slots — ${weeklySnackSlots - snackCapacity} snack slot(s) come back empty.`);
    suggestions.push("Set snacks per day to 0 and fold those calories into your meals, or AI-generate a few compliant snacks on the Recipes tab.");
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
  let proteinShortDays = 0, kcalOffDays = 0, floorMissDays = 0, fatOffDays = 0, carbOffDays = 0;
  for (const [, daySlots] of byDay) {
    // Single-sourced through dayTolerance (solver-core-2): the per-macro rules
    // were hand-rolled here at a literal 0.15, which meant a fat/carb miss was
    // structurally invisible to the diagnosis no matter how bad it got.
    const t = daySlots.reduce(
      (a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }),
      { kcal: 0, protein: 0, fat: 0, carb: 0 }
    );
    const tol = dayTolerance(dailyTarget, t);
    if (!tol.proteinOk) proteinShortDays++;
    if (!tol.kcalOk) kcalOffDays++;
    if (!tol.fatOk) fatOffDays++;
    if (!tol.carbOk) carbOffDays++;
    if (filters.proteinPriority && !checkProteinFloor(t.protein, dailyTarget.proteinLo).met) floorMissDays++;
  }

  // Protein-priority mode gets its OWN diagnosis, and unlike the generic
  // checks below it is never gated behind "nothing else already explained
  // it" — the floor is the entire point of the mode, so a miss is ALWAYS
  // named up front (LAW 7), even when a pool-shape reason also applies.
  if (filters.proteinPriority && floorMissDays > 0) {
    const neededRatio = dailyTarget.kcal > 0 ? dailyTarget.proteinLo / dailyTarget.kcal : 0;
    const dense = pool.filter((r) => r.kcal > 0 && r.protein / r.kcal >= neededRatio * 0.75).length;
    reasons.unshift(`Protein-priority mode: the ${Math.round(dailyTarget.proteinLo)}g/day floor wasn't met on ${floorMissDays} day(s) — only ${dense} of ${pool.length} compliant recipes carry enough protein density to close the gap within the 0.5-2x portion limit.`);
    suggestions.unshift("AI-generate a few high-protein compliant recipes, set the protein-preference filter, or allow batch-cooking repeats of the densest dishes.");
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
  // Fat/carb misses are NEVER gated behind "nothing else explained it"
  // (solver-core-2). Portion scaling moves calories, not composition — so a
  // fat- or carb-shaped miss is a statement about the POOL, and it is the one
  // reason the user cannot deduce from the calorie and protein lines.
  if (fatOffDays > 0 || carbOffDays > 0) {
    const bits = [];
    if (fatOffDays > 0) bits.push(`${fatOffDays} day(s) landed outside your ${Math.round(dailyTarget.fatLo)}–${Math.round(dailyTarget.fatHi)} g fat range`);
    if (carbOffDays > 0) bits.push(`${carbOffDays} day(s) landed outside your ${Math.round(dailyTarget.carbLo)}–${Math.round(dailyTarget.carbHi)} g carb range`);
    reasons.push(`${bits.join(", and ")} — portion scaling moves a dish's calories, not its fat/carb ratio, so the pool's composition is what binds here.`);
    suggestions.push("Add (or AI-generate) a few recipes built around the macro you keep missing, or drop the cuisine/protein preference so the solver can reach dishes that carry it.");
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
  lockedSlots = [],
  count = 3, attempts = 9, rng = Math.random, profile = null,
}) {
  const afterPrep = applyPrepFilter(recipePool, filters.maxPrepMin);
  const costCache = filters.budget ? buildCostCache(afterPrep) : null;
  const bias = buildBias(filters, costCache);
  const repeatCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;

  const dayTargets = targetsForSlots(dailyTarget, buildSlots(mealConfig))
    .filter((s) => s.dayOfWeek === 0)
    .map((s) => ({ ...s, dayOfWeek }));

  // solver-core-1: this day's LOCKED slots are constraints of the solve, not a
  // substitution made afterwards — /accept-day keeps them regardless, so a
  // candidate scored without them describes a day that never gets stored.
  const lockedByKey = buildLockedMap(lockedSlots.filter((s) => s && s.dayOfWeek === dayOfWeek));

  // Honest per-candidate verdict on the EXACT slot set the candidate ships
  // (locks included), through the same single-sourced rule the week uses.
  const judge = (slots) => {
    const totals = slots.reduce(
      (a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }),
      { kcal: 0, protein: 0, fat: 0, carb: 0 }
    );
    const tol = dayTolerance(dailyTarget, totals);
    const ok = dayInTolerance(tol);
    return { inTolerance: ok, miss: ok ? null : dayMissLine(dailyTarget, totals) };
  };

  const seen = new Map(); // signature -> candidate
  for (let i = 0; i < attempts; i++) {
    const usage = new Map(weekUsage);
    if (lockedByKey) for (const s of lockedByKey.values()) usage.set(s.recipeId, (usage.get(s.recipeId) || 0) + 1);
    const { slots } = await solveDay(dayTargets, dailyTarget, afterPrep, usage, prevDayIds, rng, null, bias, repeatCap, null, lockedByKey);
    const signature = slots.map((s) => `${s.recipeId}:${s.proteinScale}`).join("|");
    if (seen.has(signature)) continue;
    const score = scoreDay(dailyTarget, slots, { proteinPriority: filters.proteinPriority });
    seen.set(signature, { slots, score, hasWarnings: slots.some((s) => s.warning), ...judge(slots) });
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
        const critUsage = new Map(weekUsage);
        if (lockedByKey) for (const s of lockedByKey.values()) critUsage.set(s.recipeId, (critUsage.get(s.recipeId) || 0) + 1);
        const { slots } = await solveDay(boostedTargets, boostedDaily, resolvePool, critUsage, prevDayIds, rng, null, bias, repeatCap, null, lockedByKey);
        return { slots };
      };
      const revision = await reviseDayWithCritic({
        solve,
        scoreDay: (slots) => scoreDay(dailyTarget, slots, { proteinPriority: filters.proteinPriority }),
        targets: { kcal: dailyTarget.kcal, proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi, fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, carbLo: dailyTarget.carbLo, carbHi: dailyTarget.carbHi },
        profile,
      });
      if (revision.revised) {
        candidates[0] = { slots: revision.slots, score: revision.score, hasWarnings: revision.slots.some((s) => s.warning), ...judge(revision.slots) };
        candidates.sort((a, b) => b.score.matchPct - a.score.matchPct);
      }
    }
  }

  const counts = { raw: recipePool.length, afterDiet: recipePool.length, afterPrep: afterPrep.length };
  const needDiagnosis =
    candidates.length === 0 ||
    candidates[0].score.matchPct < 60 ||
    candidates.every((c) => c.hasWarnings) ||
    // The same rule generateBestWeekPlan applies to a week (solver-core-2):
    // if the BEST day we can offer is outside tolerance, the user is owed a
    // reason, not just a percentage.
    candidates[0].inTolerance === false ||
    // Protein-priority mode: a top candidate that misses the floor is always
    // rough, even when kcal alone makes matchPct look fine (LAW 7 — the mode
    // exists specifically so this can't be silently absorbed).
    (filters.proteinPriority && candidates[0] && candidates[0].score.proteinFloor && !candidates[0].score.proteinFloor.met);
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

/**
 * Score a whole week AND publish one honest line per day.
 *
 * `days` is the load-bearing part (solver benchmark, 2026-07-21). Before it
 * existed the week result carried only an AVERAGE — so a week could ship with
 * one day 18% under target while the only numbers the user could ever see were
 * "7 days" and "89% average". Every day now states its own match %, its own
 * deltas, and, when it misses, its own plain-English miss line. That is what
 * makes "no silent target miss" a property of the output rather than a promise.
 *
 * opts.proteinPriority: threads the priority weighting into every day's
 * score AND adds floorDaysMet/floorDaysTotal to the return (omitted
 * entirely outside the mode, keeping the default shape unchanged).
 */
function scoreWeek(dailyTarget, slots, opts = {}) {
  const priority = Boolean(opts.proteinPriority);
  const byDay = new Map();
  for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
  let daysInTolerance = 0;
  let matchSum = 0;
  const days = [];
  let floorDaysMet = 0;
  for (const dow of [...byDay.keys()].sort((a, b) => a - b)) {
    const daySlots = byDay.get(dow);
    const sc = scoreDay(dailyTarget, daySlots, { proteinPriority: priority });
    // Tolerance is judged on the EXACT totals, never on scoreDay's display-
    // rounded ones. Rounding first can only ever hide a miss (a day 15.009%
    // under target rounded to exactly 15.0% and reported as clean — caught on
    // the benchmark grid), and a hidden miss is the one thing forbidden here.
    const exactTotals = daySlots.reduce(
      (a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }),
      { kcal: 0, protein: 0, fat: 0, carb: 0 }
    );
    const tol = dayTolerance(dailyTarget, exactTotals);
    // All four macros (solver-core-2) — a day that hits kcal + protein while
    // sitting far outside its fat or carb range is not "in tolerance", and
    // saying it is was the app telling the user something untrue.
    const ok = dayInTolerance(tol);
    matchSum += sc.matchPct;
    if (ok) daysInTolerance++;
    if (priority && sc.proteinFloor?.met) floorDaysMet++;
    days.push({
      dayOfWeek: dow,
      dayName: dayName(dow),
      matchPct: sc.matchPct,
      totals: sc.totals,
      kcalDeltaPct: Math.round(tol.kcalDeltaPct * 1000) / 10,
      proteinShortPct: Math.round(tol.proteinShortPct * 1000) / 10,
      fatOk: tol.fatOk,
      carbOk: tol.carbOk,
      inTolerance: ok,
      miss: ok ? null : dayMissLine(dailyTarget, exactTotals),
      unfilledSlots: daySlots.filter((s) => !s.recipeId).length,
      warnedSlots: daySlots.filter((s) => s.warning).length,
      // Per-day floor verdict rides alongside the per-day match line, so the
      // mode's honesty is published at the same granularity as everything else.
      ...(priority ? { proteinFloor: sc.proteinFloor } : {}),
    });
  }
  return {
    daysInTolerance,
    avgMatch: Math.round(matchSum / Math.max(1, byDay.size)),
    days,
    ...(priority ? { floorDaysMet, floorDaysTotal: byDay.size } : {}),
  };
}

/**
 * The week-level equivalent of day candidates: run the (cheap, AI-free)
 * week solve `attempts` times, keep the best-scoring week — more days in
 * tolerance first, average match second. Only THEN, if the best week still
 * has warning slots, one final pass may use the AI fallback to patch them
 * via the caller's swap flow. Keeps generation fast and the outcome honest.
 *
 * options.lockedSlots (solver-core-1): the user's locked PlanSlot rows. They
 * ride through generateWeekPlan into every attempt as FIXED constraints, so
 * every returned slot set already contains them and `score` therefore
 * describes EXACTLY the week the caller is about to store. Callers must NOT
 * substitute locked slots in afterwards — that publishes a match % for a week
 * that never existed, which is the bug this parameter exists to close.
 */
async function generateBestWeekPlan(dailyTarget, mealConfig, recipePool, options = {}) {
  // Stage-C (L4): more attempts + randomized day order (in generateWeekPlan)
  // give best-of-N a genuinely varied set to pick the least-drifted week from.
  const attempts = options.attempts ?? 5;
  const filters = options.filters || {};
  const priority = Boolean(filters.proteinPriority);
  let best = null;
  let attemptsRun = 0;
  for (let i = 0; i < attempts; i++) {
    attemptsRun++;
    const slots = await generateWeekPlan(dailyTarget, mealConfig, recipePool, { ...options, aiFallback: undefined });
    const score = scoreWeek(dailyTarget, slots, { proteinPriority: priority });
    // Selection order: days-in-tolerance first, then — ONLY in protein-priority
    // mode — how many days defended the floor, then average match. Outside the
    // mode this is byte-identical to before (floorDaysMet is undefined, the
    // extra clause never fires).
    const better = !best
      || score.daysInTolerance > best.score.daysInTolerance
      || (score.daysInTolerance === best.score.daysInTolerance
          && priority && (score.floorDaysMet ?? 0) > (best.score.floorDaysMet ?? 0))
      || (score.daysInTolerance === best.score.daysInTolerance
          && (!priority || (score.floorDaysMet ?? 0) === (best.score.floorDaysMet ?? 0))
          && score.avgMatch > best.score.avgMatch);
    if (better) best = { slots, score };
    if (best.score.daysInTolerance === 7 && best.score.avgMatch >= 95 && (!priority || best.score.floorDaysMet === best.score.floorDaysTotal)) break;
  }
  // A rough week never ships silently: attach the result-driven diagnosis.
  // Stage-C fix (M10): when pool counts are supplied, the diagnosis derives
  // from raw/afterDiet/afterPrep so it names the real binding constraint.
  const preSolve = options.counts
    ? diagnose({ counts: options.counts, filters, dailyTarget, mealConfig, pool: recipePool })
    : undefined;
  // Solver benchmark, 2026-07-21: this used to fire only below 6/7 days — a
  // threshold lottery that let 306 of 5,040 benchmarked weeks ship short of a
  // clean week with NO reason attached at all. "Unsolvable + why" is owed the
  // moment ANY day misses its targets or ANY slot comes back unfilled, not
  // once enough days have missed to cross a bar.
  //
  // An unmet protein floor is the same kind of debt: in protein-priority mode
  // the floor IS the target the user selected the mode to defend, so missing it
  // owes a reason on exactly the same terms.
  const anyDayMissed = best.score.daysInTolerance < best.score.days.length;
  const anyUnfilledSlot = best.slots.some((s) => !s.recipeId);
  const floorMissed = priority && best.score.floorDaysMet < best.score.floorDaysTotal;
  best.diagnosis = anyDayMissed || anyUnfilledSlot || floorMissed
    ? diagnoseFromResult({ dailyTarget, slots: best.slots, pool: recipePool, mealConfig, filters, preSolve })
    : null;
  best.attempts = attemptsRun;
  return best;
}

/**
 * Can this pool sustain VARIETY over a multi-week horizon, or will it force
 * repeats? Pure arithmetic on the compliant pool — the honest counterpart to
 * the cross-week variety memory: where the library genuinely cannot carry N
 * weeks of distinct dishes, the app says so up front instead of quietly
 * serving the same eight dinners again.
 */
function varietyOutlook({ pool, mealConfig, filters = {}, horizonWeeks = 4, dailyTarget = null }) {
  const repeatCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
  const mealPool = eligibleRecipes(pool, "meal", new Map(), repeatCap);
  const mealEligible = mealPool.length;
  const snackEligible = eligibleRecipes(pool, "snack", new Map(), repeatCap).length;
  const weeklyMealSlots = (mealConfig.meals || 0) * 7;
  const weeklySnackSlots = (mealConfig.snacks || 0) * 7;
  // Raw pool size OVERSTATES variety, and the benchmark caught it doing so:
  // pools that nominally covered 5 weeks of distinct dinners still went
  // repetitive by week 3, because a 250 kcal dish cannot be stretched into a
  // 900 kcal dinner slot inside the 0.5–2× portion band — the solver kept
  // returning to the same usable subset. Count the dishes that can actually be
  // PORTIONED into this user's slot size; that is the honest variety number.
  const slotEstimate = dailyTarget && weeklyMealSlots > 0
    ? estimateSlotTarget(dailyTarget, mealConfig, "meal") : null;
  const slotKcal = slotEstimate ? Math.round(slotEstimate.kcalTarget) : null;
  // Reachable means reachable on BOTH walls: the portion band has to be able to
  // carry the dish to the slot's calories AND to its protein. Testing calories
  // alone overstated the usable pool and left genuinely repetitive plans
  // unwarned (benchmark: 18 of 1,260 scenarios).
  const minProtein = slotEstimate ? slotEstimate.proteinTarget * (1 - PROTEIN_TOLERANCE_PCT) : 0;
  const usableForSlot = slotEstimate == null ? mealEligible : mealPool.filter((r) =>
    r.kcal > 0
    && r.kcal * SCALE_BOUNDS.max >= slotKcal && r.kcal * SCALE_BOUNDS.min <= slotKcal
    && r.protein * SCALE_BOUNDS.max >= minProtein).length;
  // Weeks of DISTINCT meals the pool can carry before a dish has to come back.
  const distinctWeeks = weeklyMealSlots > 0 ? usableForSlot / weeklyMealSlots : Infinity;
  const weeksCovered = Math.floor(distinctWeeks * 10) / 10;
  const note = distinctWeeks >= horizonWeeks ? null
    : slotKcal == null
      ? `${mealEligible} compliant recipes cover about ${weeksCovered} week(s) of ${weeklyMealSlots} meals before dishes start repeating — over ${horizonWeeks} weeks you will see favourites come back.`
      : `${usableForSlot} of your ${mealEligible} compliant recipes can be portioned to a ${slotKcal.toLocaleString("en-CA")} kcal meal — about ${weeksCovered} week(s) of ${weeklyMealSlots} meals before dishes start repeating, so over ${horizonWeeks} weeks you will see favourites come back.`;
  const snackNote = weeklySnackSlots > 0 && snackEligible * repeatCap < weeklySnackSlots
    ? (snackEligible === 0
      ? `Your library has no snack-sized recipe that fits your rules — snack slots stay empty until you add one.`
      : `Only ${snackEligible} snack recipe(s) fit your rules, so the same snacks come back every week.`)
    : null;
  return {
    mealEligible, usableForSlot, slotKcal, snackEligible, weeklyMealSlots, weeklySnackSlots, repeatCap,
    distinctWeeks: Number.isFinite(distinctWeeks) ? Math.round(distinctWeeks * 10) / 10 : null,
    horizonWeeks,
    sustainsHorizon: distinctWeeks >= horizonWeeks && !snackNote,
    notes: [note, snackNote].filter(Boolean),
  };
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
    // Protein-priority mode re-weights an alternate's match% the same
    // direction as the day/week scorer — a slot-level protein shortfall
    // costs more than a calorie miss instead of the reverse.
    const [kw, pw] = filters.proteinPriority ? [0.35, 0.65] : [0.6, 0.4];
    const matchPct = Math.round(Math.max(0, 1 - (kw * Math.min(1, kcalErr) + pw * Math.min(1, pShort))) * 100);
    alternates.push({ ...result, matchPct });
  }
  return alternates;
}

module.exports = {
  applyPrepFilter, buildBias, scoreDay, scoreWeek, diagnose, diagnoseFromResult,
  generateDayCandidates, generateBestWeekPlan, alternatesForSlot, SCORE_WEIGHTS,
  dayTolerance, dayMissLine, dayInTolerance, varietyOutlook,
  DAY_KCAL_TOLERANCE_PCT, DAY_PROTEIN_TOLERANCE_PCT,
  DAY_FAT_TOLERANCE_PCT, DAY_CARB_TOLERANCE_PCT,
  PROTEIN_PRIORITY_WEIGHTS,
};
