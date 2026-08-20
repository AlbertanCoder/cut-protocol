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
  normalizeDayIndices, buildPriorUsage,
  DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP, SCALE_BOUNDS, PROTEIN_TOLERANCE_PCT,
  KCAL_TOLERANCE_PCT,
} = require("./weeklyPlanner.js");
const { buildCostCache, explainPool } = require("./recipeCost.js");
// The anti-ketosis floor has ONE definition, in the file that prescribes to it.
const { NONKETO_CARB_FLOOR_G } = require("./bmrEngine.js");
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

// Stage 3: the cost / complexity / taste OPTIONAL hard caps. Time is still
// applyPrepFilter above (unchanged, so its null-passes behaviour is
// byte-identical, and when no new cap is set this is a pass-through — the whole
// pre-Stage-3 world). The input MUST already be allergy/diet filtered
// (filterRecipePool upstream); these caps only ever NARROW further, so they can
// never weaken an allergy exclusion — that is the composition rule's safety
// property, satisfied structurally rather than by a check. Returns explainPool's
// verdict so the CALLER can name the binding constraint; never swallow it — an
// empty pool with no reason is the silent miss the constitution forbids.
function applyFilterStack(pool, filters = {}, ratings = null) {
  const prefs = {
    maxCostCad: filters.maxCostCad ?? null,
    maxComplexity: filters.maxComplexity ?? null,
    minTaste: filters.minTaste ?? null,
    ratings,
  };
  if (prefs.maxCostCad == null && prefs.maxComplexity == null && prefs.minTaste == null) {
    return { survivors: pool, explain: null };
  }
  const explain = explainPool(pool, { ...prefs, minSurvivors: 3 });
  return { survivors: explain.survivors, explain };
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

// Honest match %: weighted, capped error terms — 46% calories (the wall),
// 30% protein shortfall (the other wall, asymmetric), 12% each for fat and carb
// landing outside their ranges. 100% = everything on target; the UI is expected
// to present this as closest-fit, not a promise of perfection.
//
// REWEIGHTED 2026-07-24 (solver-core-4). solver-core-2 made dayInTolerance a
// FOUR-macro verdict but left this headline number weighting fat and carb at
// 0.075 each against an error term that could only ever reach 1.0 — so a day
// sitting 98 g outside its fat band lost at most 7.5 points. Measured on the
// real library: days the app itself graded OUT of tolerance scored a median 93%,
// and 743 of 1,091 of them scored 90% or better. `meta.matchPct` is the first
// field in the generate response; it cannot say 93% about a day the same
// response marks as missed. The UI's green gate reads `inTolerance` and is
// already correct — this fixes the NUMBER, not the colour.
//
// The fat/carb error terms are also now measured in units of their OWN
// tolerance (see missTerm in scoreDay), so 1.0 means "exactly at the line
// dayInTolerance draws" and a day that fails on fat forfeits the whole fat
// weight. Calories keep a raw-fraction term so their long-standing calibration
// ("a 10% calorie miss costs ~5 points") is preserved.
const SCORE_WEIGHTS = { kcal: 0.46, protein: 0.3, fat: 0.12, carb: 0.12 };

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
  // Fat/carb error is expressed as a MULTIPLE of that macro's own day tolerance
  // — the exact same bandMiss/allowance arithmetic dayTolerance() grades on, so
  // the headline number and the green/amber verdict can never disagree about
  // what "outside the range" means. 1.0 IS the line, and it is where the term
  // saturates: past the line the verdict has already flipped, and matchPct is a
  // closeness measure, not a punishment scale. A target with no fat/carb band
  // (older fixtures, partial targets) contributes nothing, exactly as before.
  // (bandMiss/hasBand/DAY_*_TOLERANCE_PCT are declared below with dayTolerance,
  // their single source of truth; nothing calls scoreDay during module init.)
  const missTerm = (miss, tolShort, tolOver) => {
    if (miss.shortPct > 0) return tolShort > 0 ? Math.min(1, miss.shortPct / tolShort) : 1;
    if (miss.overPct > 0) return tolOver > 0 ? Math.min(1, miss.overPct / tolOver) : 1;
    return 0;
  };
  const fatJudged = hasBand(dailyTarget.fatLo, dailyTarget.fatHi);
  const carbJudged = hasBand(dailyTarget.carbLo, dailyTarget.carbHi);
  // Keto's carb ceiling is a diet LAW, not a preference — no upward allowance,
  // same as dayTolerance.
  const carbOverAllowance = dailyTarget.keto ? 0 : DAY_CARB_TOLERANCE_PCT;
  const fatOut = fatJudged
    ? missTerm(bandMiss(t.fat, dailyTarget.fatLo, dailyTarget.fatHi), DAY_FAT_TOLERANCE_PCT, DAY_FAT_TOLERANCE_PCT)
    : 0;
  // STEERS THE SCORE ON PURPOSE — matchPct is not the verdict.
  //
  // dayTolerance no longer grades carbs against this band, so this term looks
  // obsolete and is not. matchPct ranks day CANDIDATES and breaks ties between
  // weeks in best-of-N; keeping a carb term here is what stops the solver
  // preferring a plate that buys its calories from the single cheapest source.
  // A verdict says what is acceptable, a score says what is preferred among
  // acceptable options, and they are allowed to differ.
  const carbOut = carbJudged
    ? missTerm(bandMiss(t.carb, dailyTarget.carbLo, dailyTarget.carbHi), DAY_CARB_TOLERANCE_PCT, carbOverAllowance)
    : 0;
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
const DAY_KCAL_TOLERANCE_PCT = 0.10;
const DAY_PROTEIN_TOLERANCE_PCT = 0.15;
const DAY_FAT_TOLERANCE_PCT = 0.25;
const DAY_CARB_TOLERANCE_PCT = 0.25;

// ── THE GOAL RULER (owner decision, 2026-08-03) ──────────────────────────
//
// The bands above grade a day on four macros at once. Measured over the real
// 250-persona fleet, that is not what was failing days: of 166 failing axes,
// fat-over was 83 and carb-over 47 — 78% of all failures were fat/carb RATIO
// misses — while protein failed ONCE and kcal-under ONCE.
//
// A fat/carb ratio miss does not change the calorie deficit, and the deficit is
// what drives fat loss. So the app was refusing four days in five over a number
// that does not move the goal — and the trim arm built to fix those days is
// what mangled portions, because squashing fat and carb into bands is the only
// way to hit them (83.2% of trimmed slots landed below 0.7x a normal portion).
//
// So: grade what the goal is made of. Calories are the deficit. Protein is a
// FLOOR (muscle retention; more is never a miss). Fat is a GUARDRAIL, not a
// target — wide enough to be a nutrition limit rather than a ratio preference.
// Carbs take the remainder and are not graded on their own.
//
// KETO IS EXEMPT from the fat CEILING — and from the ceiling only. There, a high
// fat share is the diet's definition, not a defect. The FLOOR still binds: a keto
// target prescribes more fat than any other, so a keto day starved of it is the
// clearest possible miss, not the diet working. Keto's carb ceiling stays a hard
// diet law.
//
// THE LOWER EDGE IS TWO FLOORS, WHICHEVER IS HIGHER.
//
// 20 %E is the AMDR's lower bound (IOM 2005) and the band computeMacros() itself
// prescribes to — `fatPrescriptionDrift.test.js` asserts 20-35 %E on every
// unfloored prescription. It was 15% here, which meant the GRADER blessed days
// the ENGINE would never prescribe. That gap is not harmless: best-of-N selects
// on what passes, so the achieved distribution drifts toward the loosest
// admissible edge rather than toward the prescription.
//
// And a share is not a gram. The gram-level essential-fat floor lives on the
// target as bmrEngine's `fatFloorG` — and until now it did not bind here at all:
// `fatFloorG` appeared in this file exactly once, inside a comment claiming it
// still did. bmrEngine's own export block already recorded the gap. A 2,000 kcal
// target with a 48 g essential floor passed a 44 g day (19.8 %E), and 20 %E alone
// would still pass it at 44.4 g. Neither floor subsumes the other, so the edge is
// max(both).
const DAY_FAT_PCT_ENERGY_MIN = 0.20;
const DAY_FAT_PCT_ENERGY_MAX = 0.35;

// ── the WEEK's energy band ────────────────────────────────────────────────
//
// Half the day band, and the "half" is the whole argument: this exists to catch
// drift the per-day verdict cannot see, so it MUST be strictly tighter than the
// day band or it catches nothing. Seven days each sitting at +8% pass every
// single day check and quietly cost the deficit a full day's calories. At ±10%
// the week would pass that too and the verdict would be decoration; at ±5% it
// fails, which is the entire reason for it.
//
// MEASURED on the fleet (192 multi-day windows across 3 seeds), |residual| as a
// share of the week's budget:
//     p50 1.3% · p75 5.8% · p90 12.1% · p95 19.1% · max 38.7%
//     ±5% band -> 69.8% of weeks land inside   (±2% -> 57.3%, ±10% -> 81.8%)
// Most weeks land far inside it — errors across days DO largely cancel, which is
// the premise. The band binds on the tail, which is what a tail is for.
//
// Mean SIGNED residual is −0.74%: weeks land slightly OVER budget on average, not
// under. Small, but it is a bias and not noise, so it is reported rather than
// rounded away.
const WEEK_KCAL_TOLERANCE_PCT = 0.05;

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
  // THE GRADED FLOOR IS NOT THE BAND'S BOTTOM when body composition is a guess.
  //
  // proteinLo derives from lean mass, and lean mass from body fat — which the
  // engine ASSUMES (21% M / 28% F) when the user has not measured it. Measured on
  // the 103 fleet personas who DO know theirs, recomputing as if they had left it
  // blank moves the floor by >=10 g for 69% of them and >=10 g TOO HIGH for 42%,
  // worst case +59 g. Failing someone every day against that is the defect.
  //
  // bmrEngine publishes `proteinFloorG` separately: proteinLo when body fat is
  // measured, 1.6 g/kg of BODYWEIGHT when it is not — a number needing no guess.
  // The BAND is untouched, so the search still aims where it always did and only
  // the grade moved. Lowering proteinLo itself was tried first and cost 0.18 g/kg
  // of delivered protein, because proteinMid is what the search aims at.
  //
  // Falls back to proteinLo when absent, so partial targets and older fixtures
  // grade exactly as they did.
  const proteinFloor = Number.isFinite(dailyTarget.proteinFloorG)
    ? dailyTarget.proteinFloorG : dailyTarget.proteinLo;
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
  // Energy share of fat, measured against the LARGER of what the day delivered
  // and what it was supposed to deliver.
  //
  // Achieved-only was the first attempt, to stop an over-eaten day looking leaner
  // than it is — max() keeps that intact, because an over-eaten day IS the larger
  // number. What it fixes is the other direction, which inverted the verdict: on
  // an under-delivered day the denominator collapses and the guardrail
  // manufactures a fat MISS out of a calorie miss. A day landing 1,061 of 2,200
  // kcal with 46 g of fat was told "46 g fat vs a 24-41 g range - 5 g over" while
  // being 1,139 kcal short. Against the 2,200 it owed, 46 g is 18.8 %E — UNDER the
  // floor. The old line named the wrong macro, in the wrong direction, on a day
  // whose only real problem was that it was empty.
  const fatPctEnergyBase = Math.max(totals.kcal || 0, dailyTarget.kcal > 0 ? dailyTarget.kcal : 0);
  const fatPctEnergy = fatPctEnergyBase > 0 ? ((totals.fat || 0) * 9) / fatPctEnergyBase : 0;
  // THE ANTI-KETOSIS FLOOR. Carbs are the remainder and are not graded as a
  // target — but "not a target" is not "unbounded". bmrEngine holds a non-keto
  // target at NONKETO_CARB_FLOOR_G for a stated reason: below ~50 g/day a diet
  // drifts into ketosis, so squeezing an omnivore plan toward zero carbs makes
  // it silently ketogenic. The verdict has to grade against the SAME number, or
  // the app ships exactly the day the engine refused to prescribe.
  //
  // Measured: 20 green non-keto days below 50 g across a sweep of lean/heavy
  // profiles at aggressive deficits — protein at its floor and fat at the 35 %E
  // ceiling squeeze the remainder, and nothing was watching it.
  //
  // Capped at the target's own carbMid so this never demands MORE than the
  // prescription could allocate: on a target the engine had to squeeze below the
  // floor itself (`carbFloored`), the day owes what was prescribed, not 50. That
  // overshoot is already disclosed as carbFloored + macroKcalGap.
  //
  // This replaces a `dailyTarget.goal === "muscle gain" || "recomp"` branch that
  // could never fire: nothing in the codebase sets `goal` (Profile has no such
  // column), so six passing tests were dressing up dead code as shipped
  // behaviour. Goal-parameterised carb floors can sit ON TOP of this one when a
  // goal field exists; a safety floor is true for everyone and needs no schema.
  const carbFloorG = !dailyTarget.keto && carbBand && Number.isFinite(dailyTarget.carbMid)
    ? Math.min(NONKETO_CARB_FLOOR_G, dailyTarget.carbMid)
    : null;
  // THE SAFETY FLOOR OUTRANKS THE BAND. deriveTarget() clamps a target UP to
  // max(RMR×0.95, 1500 M / 1200 F, the user's own stricter floor) — the
  // constitution's hard floor — and for anyone on an aggressive rate the target
  // IS the floor. A symmetric ±10% band around it then re-opened the whole
  // clamp downward: a floored 1,834 kcal target graded a 1,651 kcal day green,
  // 183 kcal below the number the engine had just refused to go under. The band
  // may narrow the day, never widen it past the floor.
  //
  // adaptiveTarget.js:212 already states this rule for its own cap ("the safety
  // floor outranks the cap… it may never hold one BELOW the floor"). It is not
  // a property of that mechanism; it is constitutional, so it is restated here
  // rather than imported.
  const kcalFloor = Number.isFinite(dailyTarget.floorKcal) && dailyTarget.floorKcal > 0
    ? dailyTarget.floorKcal : null;
  const kcalBandLo = dailyTarget.kcal * (1 - DAY_KCAL_TOLERANCE_PCT);
  // FLOAT NOISE ONLY — deliberately not a nutritional slack.
  //
  // A floored target sets kcal === floorKcal, and the solver optimises toward
  // kcal, so achieved totals CLUSTER on this edge by construction. Two
  // arithmetically identical sums of the same plate differ in the last bits
  // depending on addition order: the fleet has a day where the solver's own total
  // is 1,469.5 and an independent recompute from the raw food rows is
  // 1,469.4999999999998. One passed and one failed, which is an instrument that
  // cannot agree with itself.
  //
  // The first attempt here was half a calorie of "no human resolves this" slack.
  // That was the wrong KIND of fix and it failed on the same day: a wide window
  // does not remove the knife edge, it moves it — to floor−0.5, which that day
  // landed on exactly. The epsilon must cover the scale the two computations
  // actually differ at (~1e-13) and nothing else, so real totals cannot sit on it.
  //
  // This does not soften the "judge on EXACT totals, never display-rounded ones"
  // rule stated elsewhere in this file. That rule exists so rounding cannot HIDE
  // a miss. A day 0.5 kcal under its floor still fails, as it should.
  const FLOOR_EPSILON_KCAL = 1e-6;
  const kcalLoEdge = kcalFloor != null ? Math.max(kcalBandLo, kcalFloor - FLOOR_EPSILON_KCAL) : kcalBandLo;
  // True when the FLOOR is what the day fell under, not merely the band — so the
  // miss line can name the real constraint instead of reporting a generic "under".
  const kcalFloorBinding = kcalFloor != null && kcalFloor > kcalBandLo && totals.kcal < kcalFloor;
  // Fat's lower edge in GRAMS: the AMDR share of this day's energy, or the
  // target's absolute essential-fat floor, whichever is higher. Published so
  // dayMissLine states the same edge the verdict used.
  const essentialFatG = Number.isFinite(dailyTarget.fatFloorG) && dailyTarget.fatFloorG > 0
    ? dailyTarget.fatFloorG : 0;
  const fatLoEdgeG = Math.max((fatPctEnergyBase * DAY_FAT_PCT_ENERGY_MIN) / 9, essentialFatG);
  const fatHiEdgeG = (fatPctEnergyBase * DAY_FAT_PCT_ENERGY_MAX) / 9;
  const fatOk = !fatBand || !(totals.kcal > 0)
    || ((totals.fat || 0) >= fatLoEdgeG
        && (dailyTarget.keto || fatPctEnergy <= DAY_FAT_PCT_ENERGY_MAX));
  const carbOk = (!dailyTarget.keto || !carbBand || carb.overPct <= 0)
    && (carbFloorG == null || (totals.carb || 0) >= carbFloorG);
  // WHICH WAY a macro missed, decided by the rule that actually failed and
  // published so no instrument has to re-derive it. Three QC harnesses were
  // reading direction off `fatOverPct`/`carbOverPct` — distances from the target's
  // GRAM band, which is no longer what fatOk/carbOk are decided by — and
  // mislabelled 5 days per seed as `fat:short` when they were %E-over. Carbs now
  // have exactly two failure modes: a non-keto day under the anti-ketosis floor,
  // or a keto day over its ceiling.
  const fatMissSide = fatOk ? null : ((totals.fat || 0) > fatLoEdgeG ? "over" : "short");
  const carbMissSide = carbOk ? null : (dailyTarget.keto ? "over" : "short");
  return {
    kcalDeltaPct, proteinShortPct,
    kcalFloor, kcalFloorBinding, proteinFloor,
    kcalOk: dailyTarget.kcal > 0
      && totals.kcal >= kcalLoEdge
      && kcalDeltaPct <= DAY_KCAL_TOLERANCE_PCT,
    // A target with no protein floor is not judged on one — the same rule the
    // absent fat/carb bands and the absent kcal floor already follow. Without
    // this guard `150 >= undefined` is false, so a partial target FAILED on
    // protein and then rendered the miss as "vs NaN g floor — NaN g short". The
    // rule it replaced (a shortfall against the band midpoint) failed safe here,
    // so this was a straight robustness regression, and NaN is the one thing a
    // number that can reach the screen must never be.
    proteinOk: !Number.isFinite(proteinFloor) || totals.protein >= proteinFloor,
    proteinMid: pMid,
    fatShortPct: fat.shortPct, fatOverPct: fat.overPct,
    carbShortPct: carb.shortPct, carbOverPct: carb.overPct,
    fatJudged: fatBand, carbJudged: carbBand,
    // Reported for diagnosis and for any caller that still wants band distance —
    // no longer what the day is JUDGED on. See the goal-ruler note above.
    fatBandOk: !fatBand || (fat.shortPct <= DAY_FAT_TOLERANCE_PCT && fat.overPct <= DAY_FAT_TOLERANCE_PCT),
    carbBandOk: !carbBand || (carb.shortPct <= DAY_CARB_TOLERANCE_PCT && carb.overPct <= carbOverAllowance),
    fatPctEnergy,
    // Fat is a GUARDRAIL on energy share. A day with no calories has no share to
    // judge and is not silently failed on it; targets with no fat band are not
    // judged. KETO IS EXEMPT FROM THE CEILING ONLY — see the note above. It used
    // to short-circuit the whole guardrail, so a keto target prescribing 157-185 g
    // of fat graded a 13 g day (4.9 %E) green with no miss line at all. That is a
    // silent target miss on the diet's own defining macro.
    fatLoEdgeG, fatHiEdgeG, essentialFatG,
    fatMissSide, carbMissSide,
    fatOk,
    carbFloorG,
    // Carbs take the remainder and are not graded as a TARGET — but two floors
    // still hold: keto's carb ceiling, a diet law that survives the reframe
    // untouched, and the non-keto anti-ketosis floor above.
    carbOk,
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
    if (t.kcalFloorBinding) {
      // Name the floor, because the floor is what it fell under. Saying "under
      // target" here would describe a smaller, softer constraint than the one
      // that actually bound, and floor blocks are SHOWN, never absorbed.
      parts.push(`${Math.round(totals.kcal).toLocaleString("en-CA")} kcal vs your ${Math.round(t.kcalFloor).toLocaleString("en-CA")} floor — ${Math.round(t.kcalFloor - totals.kcal).toLocaleString("en-CA")} under`);
    } else {
      const diff = Math.round(totals.kcal - dailyTarget.kcal);
      parts.push(`${Math.round(totals.kcal).toLocaleString("en-CA")} kcal vs a ${Math.round(dailyTarget.kcal).toLocaleString("en-CA")} target — ${Math.abs(diff).toLocaleString("en-CA")} ${diff > 0 ? "over" : "under"}`);
    }
  }
  if (!t.proteinOk && Number.isFinite(t.proteinFloor)) {
    parts.push(`${Math.round(totals.protein)} g protein vs ${Math.round(t.proteinFloor)} g floor — ${Math.round(t.proteinFloor - totals.protein)} g short`);
  }
  // Fat and carbs state the RANGE they missed and by how much — same plain
  // shape as the two lines above, same no-guilt vocabulary.
  if (!t.fatOk && totals.kcal > 0) {
    const minG = t.fatLoEdgeG;
    const maxG = t.fatHiEdgeG;
    const short = (totals.fat || 0) < minG;
    const edge = short ? minG : maxG;
    const by = Math.round(Math.abs((totals.fat || 0) - edge));
    // A keto day has no ceiling, so quoting it a range would name a limit that
    // does not exist for it. It gets the floor it actually missed, and nothing else.
    parts.push(dailyTarget.keto
      ? `${Math.round(totals.fat || 0)} g fat vs a ${Math.round(minG)} g floor — ${by} g short`
      : `${Math.round(totals.fat || 0)} g fat vs a ${Math.round(minG)}–${Math.round(maxG)} g range — ${by} g ${short ? "short" : "over"}`);
  }
  if (!t.carbOk) {
    if (dailyTarget.keto && t.carbOverPct > 0) {
      parts.push(`${Math.round(totals.carb || 0)} g carbs vs a ${Math.round(dailyTarget.carbLo)}–${Math.round(dailyTarget.carbHi)} g range — ${Math.round(totals.carb - dailyTarget.carbHi)} g over`);
    } else if (t.carbFloorG != null && (totals.carb || 0) < t.carbFloorG) {
      parts.push(`${Math.round(totals.carb || 0)} g carbs vs ${Math.round(t.carbFloorG)} g floor — ${Math.round(t.carbFloorG - (totals.carb || 0))} g short`);
    }
  }
  return parts.length ? parts.join("; ") : null;
}

// ── infeasibility diagnosis ──────────────────────────────────────────────

/**
 * counts: { raw, trustExcluded?, afterDiet, afterPrep } — pool sizes as each
 * HARD filter applied (attribution order raw -> trust -> diet -> prep).
 * Produces reasons + concrete suggestions. Allergies and dietary
 * style are named as the binding constraint when they are, but loosening an
 * ALLERGY is never suggested — that list ends at prep time, batch repeats,
 * meal structure, and AI generation. The ingredient-trust gate is likewise
 * NAMED but never offered as a knob: untrusted nutrition data is fixed in the
 * food library, not waived for a plan.
 */
function diagnose({ counts, filters, dailyTarget, mealConfig, pool, days = 7 }) {
  const reasons = [];
  const suggestions = [];
  const slotsPerDay = (mealConfig.meals || 0) + (mealConfig.snacks || 0);
  // Stage 2: the capacity arithmetic below was written for exactly one week.
  // `days` lets a 3-day window (or a 28-day horizon's window) be judged on the
  // slots it actually has. Default 7 = every pre-horizon caller, unchanged.
  const windowDays = Number.isFinite(days) && days > 0 ? days : 7;
  // The trust gate's removals are part of every pool-size story this function
  // tells (silent shrinkage is banned). Phrased once, appended wherever this
  // diagnosis already fires — it never flips a feasible verdict on its own.
  const trustLine = counts.trustExcluded > 0
    ? `${counts.trustExcluded} recipe(s) sit out of planning because they carry ingredient rows whose nutrition data isn't trusted yet — they stay visible in Recipes, flagged in their detail, until the data is fixed.`
    : null;
  // The plausibility fence's removals get the same never-silent treatment
  // (Phase-2, recipeSanityGate): implausible per-serving numbers are fixed in
  // the library, never served and never blamed on diet rules.
  const sanityLine = counts.sanityExcluded > 0
    ? `${counts.sanityExcluded} recipe(s) sit out of planning because their per-serving numbers fail plausibility checks (a serving past 1,400 kcal, an ingredient amount past belief) — they stay visible in Recipes until the data is corrected.`
    : null;

  if (counts.afterDiet === 0) {
    if (trustLine) reasons.push(trustLine);
    if (sanityLine) reasons.push(sanityLine);
    if (!((counts.trustExcluded || 0) + (counts.sanityExcluded || 0) >= counts.raw)) {
      reasons.push("Your dietary style + allergy rules exclude every recipe in the library.");
    }
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
  // Stage 3: the cost/complexity/taste caps get the same treatment the prep cap
  // has — a named, quantified reason. explainPool already measured WHICH cap is
  // binding (by lifting one at a time), so this is a passthrough, not a second
  // guess. It has no allergy input at all, so it can never suggest loosening one.
  if (counts.stackExplain && counts.stackExplain.ok === false) {
    reasons.push(counts.stackExplain.message);
    const b = counts.stackExplain.bindingConstraint;
    if (b === "cost") suggestions.push("Raise the cost-per-serving cap, or switch it off and use the budget tier as a soft preference instead.");
    else if (b === "complexity") suggestions.push("Raise the complexity cap — 'simple' is a narrow band in this library.");
    else if (b === "taste") suggestions.push("Lower the minimum taste score, or rate more recipes so the score has your own data behind it.");
    else if (b === "combined") suggestions.push("Loosen more than one cap — no single one is responsible.");
  }
  // Weekly capacity: only MEAL-eligible recipes fill meal slots (desserts,
  // beverages, condiment sides don't count), each capped by the repeat rule.
  // Stage-C fix (#35): use the ACTIVE repeat cap — with batch-cooking on the
  // cap is BATCH_REPEAT_CAP, so the old math undercounted capacity and could
  // suggest enabling batch repeats that were already enabled.
  const repeatCap = filters?.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
  const mealEligible = eligibleRecipes(pool, "meal", new Map(), repeatCap).length;
  const weeklyMealSlots = (mealConfig.meals || 0) * windowDays;
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
  const weeklySnackSlots = (mealConfig.snacks || 0) * windowDays;
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
  // Honesty rider: whenever this diagnosis fires for ANY reason, the trust
  // gate's removals are disclosed alongside it. Appended only when a reason
  // already exists, so a healthy solve stays feasible and diagnosis-free.
  if (reasons.length > 0 && trustLine && !reasons.includes(trustLine)) reasons.push(trustLine);
  if (reasons.length > 0 && sanityLine && !reasons.includes(sanityLine)) reasons.push(sanityLine);
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
    if (fatOffDays > 0) bits.push(`${fatOffDays} day(s) landed outside the ${Math.round(DAY_FAT_PCT_ENERGY_MIN * 100)}-${Math.round(DAY_FAT_PCT_ENERGY_MAX * 100)}% fat guardrail`);
    if (carbOffDays > 0) {
      if (dailyTarget.keto) bits.push(`${carbOffDays} day(s) exceeded the keto carb ceiling`);
      else bits.push(`${carbOffDays} day(s) landed below the ${Math.round(Math.min(NONKETO_CARB_FLOOR_G, dailyTarget.carbMid ?? NONKETO_CARB_FLOOR_G))} g carb floor a non-keto plan holds`);
    }
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
  const prepped = applyPrepFilter(recipePool, filters.maxPrepMin);
  // Stage 3: apply the cost/complexity/taste caps on top of prep, then solve over
  // the survivors. Reassigning `afterPrep` to the stacked pool means every later
  // use (costCache, bias, solveDay) consumes the narrowed pool with no rename.
  const { survivors: afterPrep, explain: stackExplain } = applyFilterStack(prepped, filters, filters.ratings);
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

  const counts = { raw: recipePool.length, afterDiet: recipePool.length, afterPrep: afterPrep.length, stackExplain };
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
  let weekAchievedKcal = 0;
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
    weekAchievedKcal += exactTotals.kcal;
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
  // ── THE WEEK'S ENERGY, as its own verdict ────────────────────────────────
  //
  // Days are graded one at a time, and a week of days that each land inside ±10%
  // can still drift: seven days at +8% is a whole day's worth of calories the
  // deficit never sees. Nothing was watching that, so it is watched here.
  //
  // REPORTED ALONGSIDE daysInTolerance, NEVER INSTEAD OF IT — the same
  // "satisfiable and all-planned side by side" rule this project applies to fleet
  // rates, applied to the verdict. A week can land its budget while missing four
  // days, and a week can hit seven clean days and still drift; those are two
  // different facts and neither one substitutes for the other.
  //
  // Deliberately a VERDICT and not a controller. It does not move any day's
  // target: one target survives everywhere, the day the user is shown is the day
  // they were prescribed, and this is a pure function of the stored slots — so it
  // recomputes identically on every read and SELF-HEALS after a slot swap instead
  // of going stale. Making the plan act on the residual is a separate decision
  // with its own measurement, and the shape for it is a redistribution pass over
  // an already-solved week, not a per-day target that moves during solving.
  // A single day is not a week. Grading one day against a band tighter than its
  // own would be a second, stricter verdict on the same number wearing a
  // different name — and 74% of the persona fleet asks for one-day plans.
  const weekBudgetKcal = dailyTarget.kcal > 0 && byDay.size >= 2 ? dailyTarget.kcal * byDay.size : null;
  const weekResidualKcal = weekBudgetKcal == null ? null : Math.round(weekBudgetKcal - weekAchievedKcal);
  return {
    daysInTolerance,
    avgMatch: Math.round(matchSum / Math.max(1, byDay.size)),
    days,
    weekBudgetKcal: weekBudgetKcal == null ? null : Math.round(weekBudgetKcal),
    weekAchievedKcal: weekBudgetKcal == null ? null : Math.round(weekAchievedKcal),
    // Signed: POSITIVE means the week landed UNDER its budget. Named `residual`
    // rather than `deficit` or `surplus` because those words already mean
    // something specific about energy balance in this app and would read as a
    // claim about fat loss rather than about the plan.
    weekResidualKcal,
    weekResidualPct: weekBudgetKcal ? Math.round((weekResidualKcal / weekBudgetKcal) * 1000) / 10 : null,
    weekInTolerance: weekBudgetKcal == null ? null
      : Math.abs(weekResidualKcal) <= weekBudgetKcal * WEEK_KCAL_TOLERANCE_PCT,
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
  // Stage-C fix (M10): when pool counts are supplied, the diagnosis derives from
  // raw/afterDiet/afterPrep so it names the real binding constraint.
  //
  // Computed BEFORE the attempts loop (solver-core-4). It used to be computed
  // after it, under a variable literally named `preSolve` — so an empty pool ran
  // five full week solves before anything was declared. Cheap, but the fail-fast
  // property the name claims was not real. It is now: the pre-solve verdict
  // exists first, and a pool with nothing in it stops after ONE pass, because a
  // re-roll of an empty pool is a re-roll of the same empty week.
  const windowDays = normalizeDayIndices(options.dayIndices).length;
  const preSolve = options.counts
    ? diagnose({ counts: options.counts, filters, dailyTarget, mealConfig, pool: recipePool, days: windowDays })
    : undefined;
  const nothingToSolve = recipePool.length === 0 || options.counts?.afterDiet === 0;
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
    // "every day landed" — expressed as days.length, not a literal 7, so a
    // partial window (Stage 2's "3 days") can finish early on the same terms a
    // full week always could. For a full week days.length IS 7.
    if (best.score.days.length > 0 && best.score.daysInTolerance === best.score.days.length
        && best.score.avgMatch >= 95 && (!priority || best.score.floorDaysMet === best.score.floorDaysTotal)) break;
    // Nothing eligible to draw from: every further attempt reproduces this
    // attempt's empty week, so stop and let the diagnosis below speak.
    if (nothingToSolve) break;
  }
  // A rough week never ships silently: attach the result-driven diagnosis.
  // Solver benchmark, 2026-07-21: this used to fire only below 6/7 days — a
  // threshold lottery that let 306 of 5,040 benchmarked weeks ship short of a
  // clean week with NO reason attached at all. "Unsolvable + why" is owed the
  // moment ANY day misses its targets or ANY slot comes back unfilled, not
  // once enough days have missed to cross a bar.
  //
  // An unmet protein floor is the same kind of debt: in protein-priority mode
  // the floor IS the target the user selected the mode to defend, so missing it
  // owes a reason on exactly the same terms.
  // ── THE BRAIN, ONCE, ON THE WINNER ─────────────────────────────────────────
  // The attempts loop above strips aiFallback deliberately (see :679) so
  // best-of-N stays free. This is the other half of that decision: the winning
  // week's surviving gaps are offered to the Library→Brain router exactly once.
  //
  // It runs BEFORE the diagnosis below, and that ordering is the point — a slot
  // the brain just filled must not still be reported as a miss. Running it
  // after would make the app lie about its own result.
  //
  // BRAIN=off / no aiFallback: buildAiFallbackContext returns null, this is a
  // no-op, and the goldens stay byte-identical.
  if (options.aiFallback?.enabled && best?.slots?.length) {
    const { fillGapsWithBrain } = require("./weeklyPlanner.js");
    const pass = await fillGapsWithBrain(best.slots, {
      dailyTarget, mealConfig, recipePool,
      aiFallback: options.aiFallback,
      dayIndices: options.dayIndices,
    });
    best.slots = pass.slots;
    best.brain = {
      attempted: pass.attempted, filled: pass.filled, replaced: pass.replaced, callsUsed: pass.callsUsed,
      // Slots the wall clock left behind (routes/plans.js BRAIN_GENERATE_BUDGET_MS).
      // Reported, never hidden: they keep their warnings and reach the diagnosis below.
      stoppedForTime: pass.stoppedForTime ?? 0,
    };
    // The score drove SELECTION and is now stale — the brain has changed what
    // is on the plate. Rescore so daysInTolerance/avgMatch describe the week
    // actually being returned, which the diagnosis immediately reads.
    if (pass.filled || pass.replaced) best.score = scoreWeek(dailyTarget, best.slots, { proteinPriority: priority });
  }

  const anyDayMissed = best.score.daysInTolerance < best.score.days.length;
  const anyUnfilledSlot = best.slots.some((s) => !s.recipeId);
  const floorMissed = priority && best.score.floorDaysMet < best.score.floorDaysTotal;
  // A solve that produced NO days at all is the one shape that slipped through:
  // with days.length === 0 both counters above read false, so a plan delivering
  // 0 kcal against a real calorie target shipped with diagnosis: null — "nothing
  // missed" because nothing was measured. A window that was asked for days, and
  // carries a target to hit, owes the same explanation as one that missed them.
  // (A window of ZERO days — windowDays 0 — is not that: nothing was asked for,
  // so nothing is owed. horizonWindows never emits one.)
  const noDaysAtAll = windowDays > 0 && best.score.days.length === 0 && dailyTarget?.kcal > 0;
  best.diagnosis = anyDayMissed || anyUnfilledSlot || floorMissed || noDaysAtAll
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
  const prepped = applyPrepFilter(recipePool, filters.maxPrepMin);
  // Stage 3: apply the cost/complexity/taste caps on top of prep, then solve over
  // the survivors. Reassigning `afterPrep` to the stacked pool means every later
  // use (costCache, bias, solveDay) consumes the narrowed pool with no rename.
  // Swap path: apply the same caps so an alternate can never violate a cap the
  // original respected. No diagnosis surface here, so only the survivors are used.
  const { survivors: afterPrep } = applyFilterStack(prepped, filters, filters.ratings);
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

// ═════════════════════════════════════════════════════════════════════════
// STAGE 2 — ANY-HORIZON GENERATION (1 meal → 1 month)
// ═════════════════════════════════════════════════════════════════════════
//
// The horizon is COMPOSED, never forked. A month is four runs of the SAME
// generateBestWeekPlan over four day-windows, sharing one variety ledger; a
// 3-day plan is one run over a 3-day window. There is exactly one solver, one
// pool builder (planContext.filterRecipePool, upstream of everything here) and
// one honesty layer. Nothing below may widen a pool — the only pool operation
// here is NARROWING it by the horizon repeat cap, which can never re-admit a
// dish the diet/allergy filter removed.

const DAYS_PER_WEEK = 7;
// A ceiling with a reason: past ~3 months the user's own target has moved
// (weigh-ins re-derive it), so a plan that far out would be solved against a
// number the app itself no longer believes. Asking for more is refused with
// that sentence, not silently truncated.
const MAX_HORIZON_DAYS = 90;

const HORIZON_PRESETS = [
  { key: "meal", label: "1 meal", days: 0, kind: "meal" },
  { key: "day", label: "1 day", days: 1, kind: "days" },
  { key: "3days", label: "3 days", days: 3, kind: "days" },
  { key: "week", label: "1 week", days: 7, kind: "days" },
  { key: "2weeks", label: "2 weeks", days: 14, kind: "days" },
  { key: "month", label: "1 month", days: 28, kind: "days" },
];
const PRESET_BY_KEY = new Map(HORIZON_PRESETS.map((p) => [p.key, p]));

const horizonShape = (p) => ({
  key: p.key, label: p.label, days: p.days, kind: p.kind,
  weeks: p.kind === "meal" ? 0 : Math.ceil(p.days / DAYS_PER_WEEK),
  custom: p.custom === true,
});

/**
 * Parse whatever the client sent into a horizon spec. Accepts a preset key
 * ("month"), a plain day count (21), or { key } / { days }. Absent input =
 * "week", so every pre-Stage-2 caller keeps its exact behaviour.
 * Throws a 400-tagged Error naming the real limit rather than clamping — a
 * silently shortened plan is a silent target miss by another name.
 */
function resolveHorizon(input) {
  if (input == null || input === "") return horizonShape(PRESET_BY_KEY.get("week"));
  if (typeof input === "object" && !Array.isArray(input)) {
    if (input.key != null) return resolveHorizon(input.key);
    if (input.days != null) return resolveHorizon(input.days);
    throw Object.assign(new Error("horizon must name a preset (key) or a day count (days)"), { status: 400 });
  }
  if (typeof input === "string") {
    const k = input.trim().toLowerCase();
    if (PRESET_BY_KEY.has(k)) return horizonShape(PRESET_BY_KEY.get(k));
    if (/^\d+$/.test(k)) return resolveHorizon(Number(k));
    throw Object.assign(
      new Error(`unknown horizon "${input}" — use one of ${HORIZON_PRESETS.map((p) => p.key).join(", ")}, or a day count 1-${MAX_HORIZON_DAYS}`),
      { status: 400 }
    );
  }
  if (typeof input === "number" && Number.isInteger(input)) {
    if (input < 1 || input > MAX_HORIZON_DAYS) {
      throw Object.assign(
        new Error(`a custom horizon must be 1-${MAX_HORIZON_DAYS} days — past ${MAX_HORIZON_DAYS} days your calorie target has been re-derived from newer weigh-ins, so the plan would be solved against a number the app no longer believes.`),
        { status: 400 }
      );
    }
    const preset = HORIZON_PRESETS.find((p) => p.kind === "days" && p.days === input);
    if (preset) return horizonShape(preset);
    return horizonShape({ key: "custom", label: `${input} days`, days: input, kind: "days", custom: true });
  }
  throw Object.assign(new Error("horizon must be a preset key, a day count, or omitted"), { status: 400 });
}

/**
 * Split `days` consecutive calendar days into per-week day-index windows,
 * starting at `startDayOfWeek` (0 = Monday) of the first week. Pure — no dates,
 * no clock. The caller maps window i onto the Plan row for (first Monday + 7i).
 */
function horizonWindows(days, startDayOfWeek = 0) {
  const total = Math.max(0, Math.trunc(days) || 0);
  let cursor = ((Math.trunc(startDayOfWeek) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const windows = [];
  let placed = 0;
  while (placed < total) {
    const idx = [];
    for (let d = cursor; d < DAYS_PER_WEEK && placed < total; d++, placed++) idx.push(d);
    windows.push(idx);
    cursor = 0;
  }
  return windows;
}

/**
 * The variety contract for a horizon, scaled to its length.
 *
 * Two caps, both enforced:
 *   · PER-WEEK cap — the existing rule, untouched: 2 servings of a dish per
 *     week, 4 with batch-cooking opted in.
 *   · HORIZON cap — new, and the reason a month is not "the same three meals
 *     on repeat". It grows SUB-linearly (perWeek + weeks-1) instead of the
 *     perWeek x weeks the old per-week-only rule implied: a 4-week plan on
 *     default settings allows 5 servings of one dish, not 8. Breadth is forced
 *     to grow with the horizon rather than repetition.
 *
 * distinctFloor is the arithmetic consequence of the horizon cap — the minimum
 * number of DISTINCT dishes a fully-solved horizon must contain. It is a check
 * on the cap being real, not a second knob.
 */
function varietyPlanFor({ weeks, days, mealConfig = {}, filters = {} }) {
  const perWeekCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
  const w = Math.max(1, Math.trunc(weeks) || 1);
  const d = Math.max(0, Math.trunc(days) || 0);
  const horizonRepeatCap = perWeekCap + (w - 1);
  const mealSlots = (mealConfig.meals || 0) * d;
  const snackSlots = (mealConfig.snacks || 0) * d;
  const totalSlots = mealSlots + snackSlots;
  return {
    weeks: w, days: d, perWeekCap, horizonRepeatCap,
    mealSlots, snackSlots, totalSlots,
    distinctFloor: horizonRepeatCap > 0 ? Math.ceil(totalSlots / horizonRepeatCap) : 0,
  };
}

// ── the binding constraint, NAMED ────────────────────────────────────────
//
// diagnose()/diagnoseFromResult() already say what went wrong in sentences.
// This says WHICH ONE THING is binding, as a stable key the UI (and a test)
// can assert on. Deliberately a separate function: the diagnose() return shape
// is locked by the golden baseline, and a named constraint is a different
// question from a list of reasons.
const BINDING = {
  DIET: "dietary-rules",
  PREP: "max-prep",
  FILTER_CAP: "filter-cap", // a cost/complexity/taste cap (Stage 3), named by explainPool
  MEAL_POOL: "meal-pool",
  SNACK_POOL: "snack-pool",
  VARIETY_CAP: "variety-cap",
  POOL_DEPTH: "pool-depth",
  PROTEIN_DENSITY: "protein-density",
  // Fat/carbs are COMPOSITION, not size (solver-core-4). Portion scaling moves a
  // dish's calories, never its fat-per-kcal — so a fat- or carb-shaped miss is a
  // statement about which dishes exist, and it is a DIFFERENT constraint from
  // the portion band. Before this key existed the flow fell through to
  // PORTION_BOUNDS, whose sentence names "calorie and protein target" — i.e. it
  // reported the two macros that were actually satisfied. For the 3,200 kcal
  // high-protein profile (0 of 7 days in tolerance, every one of them a fat
  // failure, calories and protein perfect) that was the literal machine-readable
  // output. The prose reasons[] already told the truth; only this key lied.
  MACRO_COMPOSITION: "macro-composition",
  PORTION_BOUNDS: "portion-bounds",
  NO_BUDGET: "no-remaining-budget",
};

/**
 * Can the pool's dishes, in ANY mix and at ANY portion, land inside this
 * target's fat (or carb) band? Portion scaling multiplies a dish's grams, so
 * its macro-per-kcal is invariant, and a day is a positive combination of its
 * dishes — therefore the day's achievable fat-per-kcal lies between the pool's
 * min and max. When that whole interval sits on one side of the allowed band,
 * no re-pick and no re-portion can ever land it, and saying "portion limit"
 * would be blaming the wrong thing. Returns null when the target carries no
 * such band or the pool has no usable recipe.
 */
function compositionReach(pool, key, dailyTarget, tolShortPct, tolOverPct) {
  const lo = dailyTarget?.[`${key}Lo`];
  const hi = dailyTarget?.[`${key}Hi`];
  if (!hasBand(lo, hi) || !(dailyTarget?.kcal > 0)) return null;
  const mid = (lo + hi) / 2;
  const allowLoG = Math.max(0, lo - mid * tolShortPct);
  const allowHiG = hi + mid * tolOverPct;
  let poolLo = Infinity;
  let poolHi = -Infinity;
  let n = 0;
  for (const r of pool) {
    if (!(r.kcal > 0)) continue;
    const perKcal = (Number(r[key]) || 0) / r.kcal;
    if (!Number.isFinite(perKcal)) continue;
    poolLo = Math.min(poolLo, perKcal);
    poolHi = Math.max(poolHi, perKcal);
    n++;
  }
  if (!n) return null;
  // Grams the pool could deliver at this day's calorie level, at its extremes.
  const reachLoG = poolLo * dailyTarget.kcal;
  const reachHiG = poolHi * dailyTarget.kcal;
  return {
    key, n, allowLoG, allowHiG, reachLoG, reachHiG, lo, hi,
    unreachable: reachLoG > allowHiG ? "over" : reachHiG < allowLoG ? "short" : null,
  };
}

const g = (n) => Math.round(n);

/**
 * `observed` (optional): what the solve ACTUALLY missed —
 * { fatOffDays, carbOffDays, kcalOffDays, proteinShortDays, totalDays }. Absent
 * means "no solve to read", and every branch below then reasons from the pool
 * alone exactly as it always did.
 */
function classifyBinding({ counts = null, filters = {}, dailyTarget, mealConfig = {}, pool = [], days = 7, variety = null, observed = null }) {
  const c = counts || { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length };
  const perWeekCap = filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP;
  const weeks = variety?.weeks || Math.max(1, Math.ceil(days / DAYS_PER_WEEK));
  const horizonCap = variety?.horizonRepeatCap ?? perWeekCap;
  const mealSlots = (mealConfig.meals || 0) * days;
  const snackSlots = (mealConfig.snacks || 0) * days;
  const mealEligible = eligibleRecipes(pool, "meal", new Map(), perWeekCap).length;
  const snackEligible = eligibleRecipes(pool, "snack", new Map(), perWeekCap).length;

  if (c.afterDiet === 0) {
    // The trust gate's removals must not be billed to diet/allergy rules —
    // naming the wrong constraint is how a user "fixes" the wrong thing.
    const trustBit = c.trustExcluded > 0
      ? ` (${c.trustExcluded} of them by the ingredient-trust gate — untrusted nutrition data, fixed in the library rather than loosened for a plan)`
      : "";
    const sanityBit = c.sanityExcluded > 0
      ? ` (${c.sanityExcluded} of them by the plausibility fence — per-serving numbers past belief, fixed in the library rather than served)`
      : "";
    return { key: BINDING.DIET, label: "your dietary style + allergy rules",
      detail: `every one of the ${c.raw} recipes in the library is excluded before the solver runs${trustBit}${sanityBit}.` };
  }
  if (filters.maxPrepMin && c.afterPrep === 0) {
    return { key: BINDING.PREP, label: `your ${filters.maxPrepMin}-minute max-prep cap`,
      detail: `it removes all ${c.afterDiet} recipes your diet allows.` };
  }
  // Stage 3: a cost/complexity/taste cap emptied the pool AFTER prep. explainPool
  // already isolated which cap is binding (by lifting one at a time), so name it
  // rather than letting the flow fall through to a generic "meal-pool" verdict —
  // the bug this branch fixes was blaming the prep cap for a cut the caps made.
  if (c.stackExplain && c.stackExplain.ok === false && c.stackExplain.bindingConstraint
      && c.stackExplain.bindingConstraint !== "pool") {
    const b = c.stackExplain.bindingConstraint;
    return { key: BINDING.FILTER_CAP, label: b === "combined" ? "your cost / time / complexity / taste caps together" : `your ${b} cap`,
      detail: c.stackExplain.message };
  }
  if (mealSlots > 0 && mealEligible === 0) {
    return { key: BINDING.MEAL_POOL, label: "your meal-eligible recipe pool",
      detail: `${pool.length} recipe(s) pass your rules but none of them is a main meal, so all ${mealSlots} meal slot(s) come back empty.` };
  }
  if (mealSlots > 0 && mealEligible * horizonCap < mealSlots) {
    // Would loosening the repeat cap alone fix it? Then the CAP is binding.
    // Otherwise the pool is simply too shallow for a horizon this long, and
    // saying "allow repeats" would be a lie.
    const batchHorizonCap = BATCH_REPEAT_CAP + (weeks - 1);
    if (!filters.allowBatchRepeats && mealEligible * batchHorizonCap >= mealSlots) {
      return { key: BINDING.VARIETY_CAP, label: "the repeat cap",
        detail: `${mealEligible} meal-eligible recipe(s) x ${horizonCap} servings per ${days}-day plan = ${mealEligible * horizonCap} servings for ${mealSlots} meal slots. Allowing batch-cooking repeats raises the cap to ${batchHorizonCap} and closes the gap.` };
    }
    if (filters.maxPrepMin && c.afterPrep < c.afterDiet) {
      return { key: BINDING.PREP, label: `your ${filters.maxPrepMin}-minute max-prep cap`,
        detail: `it cuts the compliant pool from ${c.afterDiet} to ${c.afterPrep} recipes, leaving ${mealEligible} meal-eligible dishes for ${mealSlots} meal slots.` };
    }
    return { key: BINDING.POOL_DEPTH, label: "the depth of your compliant recipe pool",
      detail: `${mealEligible} meal-eligible recipe(s) cannot fill ${mealSlots} meal slots over ${days} days without exceeding ${horizonCap} servings of the same dish.` };
  }
  if (snackSlots > 0 && snackEligible * horizonCap < snackSlots) {
    return { key: BINDING.SNACK_POOL, label: "your snack-eligible recipe pool",
      detail: snackEligible === 0
        ? `no snack-sized recipe fits your rules, so all ${snackSlots} snack slot(s) come back empty.`
        : `${snackEligible} snack recipe(s) x ${horizonCap} servings = ${snackEligible * horizonCap} for ${snackSlots} snack slots.` };
  }
  const pMid = ((dailyTarget?.proteinLo || 0) + (dailyTarget?.proteinHi || 0)) / 2;
  const neededRatio = dailyTarget?.kcal > 0 ? pMid / dailyTarget.kcal : 0;
  const dense = pool.filter((r) => r.kcal > 0 && r.protein / r.kcal >= neededRatio * 0.75).length;
  const denseNeeded = Math.max(10, (mealConfig.meals || 3) * 4);
  if (pool.length > 0 && dense < denseNeeded) {
    return { key: BINDING.PROTEIN_DENSITY, label: "protein density in your recipe pool",
      detail: `your targets need ~${Math.round(neededRatio * 1000) / 10} g protein per 100 kcal and only ${dense} of ${pool.length} compliant recipes come close.` };
  }

  // ── fat / carb COMPOSITION (solver-core-4) ─────────────────────────────
  // Two ways to conclude it: the pool provably cannot reach the band (pure
  // arithmetic, true with or without a solve), or the solve we just ran came
  // back fat/carb-shaped. Either way the answer is the same, and it is NOT the
  // portion limit — stretching a dish cannot change what it is made of.
  const fatReach = compositionReach(pool, "fat", dailyTarget, DAY_FAT_TOLERANCE_PCT, DAY_FAT_TOLERANCE_PCT);
  const carbReach = compositionReach(pool, "carb", dailyTarget, DAY_CARB_TOLERANCE_PCT, dailyTarget?.keto ? 0 : DAY_CARB_TOLERANCE_PCT);
  const unreachable = fatReach?.unreachable ? fatReach : carbReach?.unreachable ? carbReach : null;
  const fatOffDays = observed?.fatOffDays || 0;
  const carbOffDays = observed?.carbOffDays || 0;
  if (unreachable) {
    const macro = unreachable.key === "fat" ? "fat" : "carbs";
    const side = unreachable.unreachable === "over" ? "carries more" : "carries less";
    return { key: BINDING.MACRO_COMPOSITION, label: `${macro} in your recipe pool`,
      detail: `every one of the ${unreachable.n} compliant dishes ${side} ${macro} than your ${g(unreachable.lo)}-${g(unreachable.hi)} g range allows — at ${g(dailyTarget.kcal)} kcal they land between ${g(unreachable.reachLoG)} and ${g(unreachable.reachHiG)} g. Portion scaling changes a dish's size, not its ${macro}-per-calorie, so no mix of these recipes reaches the band.` };
  }
  if (fatOffDays > 0 || carbOffDays > 0) {
    const total = observed?.totalDays || days;
    const bits = [];
    if (fatOffDays > 0) bits.push(`${fatOffDays} of ${total} day(s) landed outside your ${g(dailyTarget?.fatLo)}-${g(dailyTarget?.fatHi)} g fat range`);
    if (carbOffDays > 0) bits.push(`${carbOffDays} of ${total} day(s) landed outside your ${g(dailyTarget?.carbLo)}-${g(dailyTarget?.carbHi)} g carb range`);
    const macro = fatOffDays >= carbOffDays ? "fat" : "carbs";
    const clean = (observed?.kcalOffDays || 0) === 0 && (observed?.proteinShortDays || 0) === 0
      ? " Calories and protein landed on target on every day — it is composition, not portion size, that is short."
      : "";
    return { key: BINDING.MACRO_COMPOSITION, label: `${macro} in your recipe pool`,
      detail: `${bits.join(", and ")}. Portion scaling moves a dish's calories, not its fat/carb ratio, so what binds here is which dishes your rules leave in the pool.${clean}` };
  }

  return { key: BINDING.PORTION_BOUNDS, label: "the 0.5x-2x portion limit",
    detail: "the compliant dishes exist, but they cannot be scaled far enough to land on every slot's calorie and protein target at once." };
}

// ── the horizon composer ─────────────────────────────────────────────────

const uniqueStrings = (arr) => [...new Set(arr.filter(Boolean))];

/**
 * Solve a horizon of any length by composing week solves.
 *
 * Returns { horizon, windows[], score, variety, diagnosis, timings } — every
 * day carries its own match %, its own miss line, and the whole horizon
 * carries ONE named binding constraint when anything fell short. There is no
 * path through this function that reports success while a day missed: the
 * diagnosis is attached whenever a day is out of tolerance, a slot is unfilled
 * or the variety contract is breached.
 */
async function generateHorizonPlan({
  dailyTarget, mealConfig, recipePool, horizon,
  filters = {}, counts = null, bias = null,
  priorPlans = [], lockedSlotsByWindow = [], startDayOfWeek = 0,
  attempts, rng = Math.random, clock = Date.now,
  // The horizon planner previously had no way to express "the brain may fill
  // gaps", so /generate had nothing to pass even if it wanted to. Threaded
  // through to each window's generateBestWeekPlan, which spends it on the
  // winning week only.
  aiFallback = null,
  // Small, already-allergy-filtered components the day solver may ADD when portion
  // scaling alone cannot land the macros (macroCloser.js). Absent => no-op.
  adjusters = null,
}) {
  if (!horizon || horizon.kind !== "days") {
    throw Object.assign(new Error("generateHorizonPlan needs a day-kind horizon (use solveOneMeal for a single dish)"), { status: 400 });
  }
  const t0 = clock();
  const windows = horizonWindows(horizon.days, startDayOfWeek);
  const variety = varietyPlanFor({ weeks: windows.length, days: horizon.days, mealConfig, filters });

  const horizonUsage = new Map(); // recipeId -> servings across the WHOLE horizon
  const lockedUsage = new Map(); // ... of which the user pinned
  const solvedSoFar = []; // newest-first, feeds the existing cross-week memory
  const results = [];
  let dayCursor = 0;

  // ADMISSION HEADROOM. The cap is checked when a dish ENTERS a week, but the
  // week that follows can still serve it perWeekCap more times — so admitting
  // anything merely "under the cap" lets a dish finish the horizon OVER it
  // (measured: cap 5, actual 6). Admit only dishes with a full week's headroom
  // left, which makes `used + perWeekCap <= horizonRepeatCap` an identity
  // rather than a hope. For a single-window horizon the term is inert
  // (horizonRepeatCap === perWeekCap and usage starts empty), so the plain
  // 1-week path is untouched.
  const admissionCeiling = variety.horizonRepeatCap - variety.perWeekCap;

  // Shared across every window — see the aiFallback note in the loop.
  let brainCallsLeft = aiFallback?.enabled ? (aiFallback.maxCalls ?? 0) : 0;
  const brainTotals = { attempted: 0, filled: 0, replaced: 0, callsUsed: 0 };

  for (let i = 0; i < windows.length; i++) {
    // HORIZON REPEAT CAP. Narrowing only — a recipe leaves the pool once it has
    // spent its horizon allowance. It can never put one BACK, so the diet/
    // allergy filtering upstream stays the absolute boundary it is.
    const pool = horizonUsage.size
      ? recipePool.filter((r) => (horizonUsage.get(r.id) || 0) <= admissionCeiling)
      : recipePool;
    const week = await generateBestWeekPlan(dailyTarget, mealConfig, pool, {
      ...(attempts != null ? { attempts } : {}),
      rng, bias, filters, counts,
      allowBatchRepeats: filters.allowBatchRepeats,
      dayIndices: windows[i],
      lockedSlots: lockedSlotsByWindow[i] || [],
      // ONE budget for the whole horizon, not one per window. A month is four
      // windows; handing each a fresh maxCalls would quietly quadruple the
      // spend the caller thought it had authorised. Each window gets what is
      // left, and what it uses is deducted below.
      ...(aiFallback && brainCallsLeft > 0
        ? { aiFallback: { ...aiFallback, maxCalls: brainCallsLeft } }
        : {}),
      // Cross-window memory: the weeks THIS horizon already solved come first,
      // then the user's real plan history. Same recency weighting as before.
      priorUsage: buildPriorUsage([...solvedSoFar, ...(priorPlans || [])]),
      adjusters,
    });
    if (week.brain) {
      brainCallsLeft = Math.max(0, brainCallsLeft - (week.brain.callsUsed || 0));
      for (const k of ["attempted", "filled", "replaced", "callsUsed"]) brainTotals[k] += week.brain[k] || 0;
    }
    for (const s of week.slots) {
      if (!s.recipeId) continue;
      horizonUsage.set(s.recipeId, (horizonUsage.get(s.recipeId) || 0) + 1);
      // A LOCKED slot is the user's own pin, carried through the solve as a
      // constraint. It counts toward the cap (so the solver spends the rest of
      // the allowance knowing about it) but it can also be the sole reason the
      // cap is exceeded — which the verdict below has to say out loud rather
      // than blame on the solver.
      if (s.locked) lockedUsage.set(s.recipeId, (lockedUsage.get(s.recipeId) || 0) + 1);
    }
    solvedSoFar.unshift({ slots: week.slots.map((s) => ({ recipeId: s.recipeId })) });
    results.push({
      windowIndex: i, dayIndices: windows[i], poolSize: pool.length,
      slots: week.slots, score: week.score, diagnosis: week.diagnosis, attempts: week.attempts,
      days: week.score.days.map((d) => ({ ...d, windowIndex: i, dayIndex: dayCursor++, key: `${i}:${d.dayOfWeek}` })),
    });
  }

  // ── aggregate, honestly ────────────────────────────────────────────────
  const allSlots = results.flatMap((r) => r.slots);
  const allDays = results.flatMap((r) => r.days);
  const filledSlots = allSlots.filter((s) => s.recipeId).length;
  const unfilledSlots = allSlots.length - filledSlots;
  const distinctRecipes = horizonUsage.size;
  let maxRepeat = 0;
  let maxRepeatRecipeId = null;
  for (const [id, n] of horizonUsage) if (n > maxRepeat) { maxRepeat = n; maxRepeatRecipeId = id; }
  const requiredDistinct = variety.horizonRepeatCap > 0 ? Math.ceil(filledSlots / variety.horizonRepeatCap) : 0;

  const varietyReport = {
    ...variety,
    distinctRecipes, maxRepeat, maxRepeatRecipeId,
    lockedRepeatsOfMax: lockedUsage.get(maxRepeatRecipeId) || 0,
    filledSlots, unfilledSlots, requiredDistinct,
    capHeld: maxRepeat <= variety.horizonRepeatCap,
    floorHeld: distinctRecipes >= requiredDistinct,
  };

  const daysInTolerance = allDays.filter((d) => d.inTolerance).length;
  const avgMatch = allDays.length ? Math.round(allDays.reduce((s, d) => s + d.matchPct, 0) / allDays.length) : 0;
  const priority = Boolean(filters.proteinPriority);
  const floorDaysMet = priority ? allDays.filter((d) => d.proteinFloor?.met).length : undefined;

  const score = {
    daysInTolerance, avgMatch, days: allDays, totalDays: allDays.length,
    ...(priority ? { floorDaysMet, floorDaysTotal: allDays.length } : {}),
  };

  // A horizon is only clean when EVERY day landed, EVERY slot filled and the
  // variety contract held. Anything else owes a reason and a named constraint.
  const anyMissed = daysInTolerance < allDays.length;
  const varietyBreached = !varietyReport.capHeld || !varietyReport.floorHeld;
  let diagnosis = null;
  if (anyMissed || unfilledSlots > 0 || varietyBreached) {
    const reasons = uniqueStrings(results.flatMap((r) => r.diagnosis?.reasons || []));
    const suggestions = uniqueStrings(results.flatMap((r) => r.diagnosis?.suggestions || []));
    if (!varietyReport.capHeld) {
      const pinned = lockedUsage.get(maxRepeatRecipeId) || 0;
      reasons.unshift(`Variety contract breached: one dish was served ${maxRepeat} times across ${horizon.days} days, over the ${variety.horizonRepeatCap}-serving cap for this horizon${pinned > 0 ? ` (${pinned} of those are slots you locked)` : ""}.`);
    }
    if (unfilledSlots > 0) {
      reasons.unshift(`${unfilledSlots} of ${allSlots.length} slots over ${horizon.days} days came back empty — no compliant recipe was left that could fill them.`);
    }
    if (reasons.length === 0) {
      reasons.push(`${allDays.length - daysInTolerance} of ${allDays.length} days landed outside your macro tolerance.`);
    }
    if (suggestions.length === 0) {
      suggestions.push("Shorten the horizon, allow batch-cooking repeats, or AI-generate more compliant recipes to deepen the pool.");
    }
    // What the solve ACTUALLY missed, so the named constraint describes this
    // horizon rather than a guess from pool shape alone (solver-core-4).
    const observed = {
      totalDays: allDays.length,
      fatOffDays: allDays.filter((d) => d.fatOk === false).length,
      carbOffDays: allDays.filter((d) => d.carbOk === false).length,
      kcalOffDays: allDays.filter((d) => Math.abs(d.kcalDeltaPct) > DAY_KCAL_TOLERANCE_PCT * 100).length,
      proteinShortDays: allDays.filter((d) => d.proteinShortPct > DAY_PROTEIN_TOLERANCE_PCT * 100).length,
    };
    const binding = classifyBinding({ counts, filters, dailyTarget, mealConfig, pool: recipePool, days: horizon.days, variety, observed });
    diagnosis = { feasible: false, reasons, suggestions, binding };
  }

  return {
    horizon, windows: results, score, variety: varietyReport, diagnosis,
    attempts: results.reduce((s, r) => s + (r.attempts || 0), 0),
    solveMs: clock() - t0,
    // Present ONLY when the caller opted in, so a BRAIN=off response is shaped
    // exactly as it was before this existed. `callsUsed` is what the UI and the
    // live-smoke report cite — a spend figure the user can check against the
    // LlmUsage ledger rather than take on trust.
    ...(aiFallback?.enabled ? { brain: { ...brainTotals, callsRemaining: brainCallsLeft } } : {}),
  };
}

// ── the 1-meal horizon ───────────────────────────────────────────────────

const BASIS_NOTES = {
  diary: (c, t) => `Fitted to what is LEFT of today: your diary already logs ${Math.round(c)} of ${Math.round(t)} kcal.`,
  plan: (c, t) => `Nothing logged in the diary today, so this is fitted to what is left after today's PLANNED meals — ${Math.round(c)} of ${Math.round(t)} kcal already placed.`,
  "full-day": (c, t) => `Nothing logged and nothing planned for today, so this is fitted to your FULL day target of ${Math.round(t)} kcal. One dish rarely carries a whole day inside the 0.5x-2x portion limit — the numbers below say exactly how close it got.`,
};

/**
 * Fit ONE dish to a remaining-macro target. Instant by construction: no week
 * solve, no writes, no AI — the same resolveSlot the week planner uses, over
 * the same already-filtered pool.
 *
 * `basis` names WHERE the remaining macros came from ("diary" | "plan" |
 * "full-day") and the returned note says it in words, because "we fitted this
 * to your remaining macros" is a different promise from "we fitted this to
 * your whole day".
 */
async function solveOneMeal({
  dailyTarget, remaining, mealConfig = { meals: 3, snacks: 0 }, recipePool,
  filters = {}, slotType = "meal", basis = "full-day", consumedKcal = 0,
  count = 3, rng = Math.random, clock = Date.now,
}) {
  const t0 = clock();
  const prepped = applyPrepFilter(recipePool, filters.maxPrepMin);
  // Stage 3: one-meal solves honour the same optional caps as full days.
  const { survivors: afterPrep, explain: stackExplain } = applyFilterStack(prepped, filters, filters.ratings);
  const kcalTarget = Number(remaining?.kcal);
  const proteinTarget = Math.max(0, Number(remaining?.protein) || 0);
  const note = (BASIS_NOTES[basis] || BASIS_NOTES["full-day"])(consumedKcal, dailyTarget?.kcal || 0);
  const base = {
    basis, note, slotType,
    target: { kcal: Math.round(Math.max(0, kcalTarget || 0)), protein: Math.round(proteinTarget) },
    poolSize: afterPrep.length, solveMs: 0,
  };

  // Nothing left to fit. Solving anyway would hand back a dish the user has no
  // room for and call it a match — the exact silent miss the constitution bans.
  if (!(kcalTarget > 0)) {
    return {
      ...base, options: [], best: null, fits: false,
      miss: `You have ${Math.round(kcalTarget || 0)} kcal left of today's ${Math.round(dailyTarget?.kcal || 0)} target — there is no room left to fit a meal into.`,
      binding: { key: BINDING.NO_BUDGET, label: "today's remaining calorie budget", detail: "it is already spent." },
      solveMs: clock() - t0,
    };
  }

  const slotTarget = { dayOfWeek: 0, slotType, slotIndex: 0, weight: 1, kcalTarget, proteinTarget };
  const options = await alternatesForSlot({
    slotTarget, recipePool: afterPrep, existingSlots: [], filters, count, rng,
  });
  const best = options[0] || null;

  // How far a SINGLE dish in this pool can actually stretch — the honest answer
  // to "why not?" when the remaining budget is a whole day's worth.
  const eligible = eligibleRecipes(afterPrep, slotType, new Map(), filters.allowBatchRepeats ? BATCH_REPEAT_CAP : DEFAULT_REPEAT_CAP);
  let reachMax = 0;
  let reachMin = Infinity;
  for (const r of eligible) {
    if (!(r.kcal > 0)) continue;
    reachMax = Math.max(reachMax, r.kcal * SCALE_BOUNDS.max);
    reachMin = Math.min(reachMin, r.kcal * SCALE_BOUNDS.min);
  }

  if (!best) {
    // If the cost/complexity/taste caps emptied the pool, say THAT — not
    // "couldn't be portioned", which would blame the wrong thing.
    const capBound = stackExplain && stackExplain.ok === false;
    return {
      ...base, options: [], best: null, fits: false,
      miss: capBound
        ? stackExplain.message
        : `No ${slotType} recipe in your compliant pool could be portioned to ${Math.round(kcalTarget)} kcal.`,
      binding: capBound
        ? { key: `filter:${stackExplain.bindingConstraint}`, label: `the ${stackExplain.bindingConstraint} cap`, detail: stackExplain.message }
        : classifyBinding({ counts: null, filters, dailyTarget, mealConfig, pool: afterPrep, days: 1 }),
      solveMs: clock() - t0,
    };
  }

  const kcalOff = Math.abs(best.kcal - kcalTarget) / kcalTarget;
  const proteinShort = proteinTarget > 0 ? Math.max(0, (proteinTarget - best.protein) / proteinTarget) : 0;
  const fits = kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT;
  const missParts = [];
  if (kcalOff > KCAL_TOLERANCE_PCT) {
    const d = Math.round(best.kcal - kcalTarget);
    missParts.push(`${Math.round(best.kcal)} kcal against ${Math.round(kcalTarget)} remaining — ${Math.abs(d)} ${d > 0 ? "over" : "under"}`);
  }
  if (proteinShort > PROTEIN_TOLERANCE_PCT) {
    missParts.push(`${Math.round(best.protein)} g protein against ${Math.round(proteinTarget)} g — ${Math.round(proteinTarget - best.protein)} g short`);
  }
  // The two walls of the portion band, stated as themselves. A remainder can be
  // too BIG for any one dish (double portion still short) or too SMALL for any
  // one dish (half portion still over) — different sentences, both true, and
  // neither of them "here is your meal".
  const overReach = reachMax > 0 && kcalTarget > reachMax;
  const underReach = Number.isFinite(reachMin) && kcalTarget < reachMin;
  const portionBinding =
    overReach
      ? { key: BINDING.PORTION_BOUNDS, label: "the 0.5x-2x portion limit",
          detail: `the biggest dish in your compliant pool reaches ${Math.round(reachMax)} kcal at a double portion, and you have ${Math.round(kcalTarget)} kcal left — one dish cannot cover that. Split it across ${Math.ceil(kcalTarget / Math.max(1, reachMax))} meals, or generate a full day.` }
      : underReach
        ? { key: BINDING.PORTION_BOUNDS, label: "the 0.5x-2x portion limit",
            detail: `the smallest dish in your compliant pool is still ${Math.round(reachMin)} kcal at a half portion, and you have only ${Math.round(kcalTarget)} kcal left — nothing in the library fits a gap that small.` }
        : null;
  return {
    ...base,
    options, best, fits,
    miss: fits ? null : missParts.join("; "),
    binding: fits ? null : portionBinding
      || classifyBinding({ counts: null, filters, dailyTarget, mealConfig, pool: afterPrep, days: 1 }),
    solveMs: clock() - t0,
  };
}

module.exports = {
  applyPrepFilter, applyFilterStack, buildBias, scoreDay, scoreWeek, diagnose, diagnoseFromResult,
  generateDayCandidates, generateBestWeekPlan, alternatesForSlot, SCORE_WEIGHTS,
  dayTolerance, dayMissLine, dayInTolerance, varietyOutlook,
  DAY_KCAL_TOLERANCE_PCT, DAY_PROTEIN_TOLERANCE_PCT,
  DAY_FAT_TOLERANCE_PCT, DAY_CARB_TOLERANCE_PCT, WEEK_KCAL_TOLERANCE_PCT,
  // The %E guardrail's own edges. Exported because an instrument that grades with
  // this ruler has to be able to STATE it: every fleet report stamps the ruler it
  // measured, and without these the stamp could only describe the old band-relative
  // one. A level with a wrong ruler on it is worse than a level with none.
  DAY_FAT_PCT_ENERGY_MIN, DAY_FAT_PCT_ENERGY_MAX,
  PROTEIN_PRIORITY_WEIGHTS,
  // Stage 2 — any-horizon generation
  resolveHorizon, horizonWindows, varietyPlanFor, classifyBinding,
  generateHorizonPlan, solveOneMeal,
  HORIZON_PRESETS, MAX_HORIZON_DAYS, DAYS_PER_WEEK, BINDING,
};
