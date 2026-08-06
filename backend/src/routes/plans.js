const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { todayStr, mondayOf, dayNum, addDays } = require("../lib/dates.js");
const {
  regenerateOneSlot, buildSlots, targetsForSlots, scaleRecipe, RECENCY_WEIGHTS,
  KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT,
} = require("../lib/weeklyPlanner.js");
const {
  generateDayCandidates, alternatesForSlot, buildBias, applyPrepFilter, applyFilterStack, varietyOutlook,
  resolveHorizon, horizonWindows, generateHorizonPlan, solveOneMeal, HORIZON_PRESETS, MAX_HORIZON_DAYS, DAYS_PER_WEEK,
} = require("../lib/mealSolver.js");
const { buildCostCache } = require("../lib/recipeCost.js");
const { buildGroceryList } = require("../lib/groceryList.js");
const { toPurchaseUnits } = require("../lib/purchaseUnits.js");
const { planContext, filterRecipePool, parseFilters } = require("../lib/planContext.js");

const router = express.Router();
router.use(requireAuth);
// saas-launch Stage 2: EVERYTHING in this file is portion-solved output —
// the premium product. One mount gates all of it. Desktop installs
// (no SUPABASE_URL) pass straight through; see lib/entitlement.js.
router.use(require("../lib/entitlement.js").requirePremium);

const PLAN_INCLUDE = { slots: { include: { recipe: true }, orderBy: [{ dayOfWeek: "asc" }, { slotType: "asc" }, { slotIndex: "asc" }] }, groceryList: true };

// planContext / filterRecipePool / parseFilters moved to ../lib/planContext.js
// (Stage 1, v2) so the brain's chat planner reuses the SAME pool-builder — the
// M8 single-source invariant. filterRecipePool is still re-exported at the
// bottom of this file so tests/planLogic.test.js keeps importing it from here.

function slotKey(s) {
  return `${s.dayOfWeek}:${s.slotType}:${s.slotIndex}`;
}

// ── The verdict's slot signature ─────────────────────────────────────────────
// THE RECIPE is stated in backend/prisma/schema.prisma (model Plan,
// verdictSlotSig) and implemented a second time in
// frontend/src/components/PlanTab.jsx (planSlotSig). All three MUST agree — a
// writer and a reader that disagree make every verdict look permanently stale,
// which is the failure mode this column exists to prevent. There is a test
// pinning the exact output string; change the recipe in one place and it fails.
//
// Keyed on the (dayOfWeek, slotType, slotIndex) natural key rather than
// PlanSlot.id, because a regenerate deletes and recreates rows so ids churn
// even when the meals are identical. `locked` is EXCLUDED on purpose: a lock
// toggle moves no macro and must not stale a verdict that is still true.
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

function planSlotSig(plan) {
  const slots = plan?.slots;
  if (!Array.isArray(slots)) return null;
  return slots
    .map((s) => [
      s.dayOfWeek, s.slotType, s.slotIndex, s.recipeId ?? "",
      round3(s.proteinScale), round3(s.sidesScale),
    ].join(":"))
    .sort()
    .join("|");
}

// Which existing slot ids survive a week regenerate. Two ways to survive:
// the fresh week covers the same slot key (the row is overwritten in place
// by upsert), or the slot is LOCKED and its recipe still complies with the
// current diet/allergy rules. The second clause is the meal-config-shrink
// fix (audit Tier 4): shrinking 4 meals to 3 used to silently DELETE a
// locked 4th meal — the lock promise accept-day already honours (its keep
// filter retains `s.locked` rows). Compliance-gating the lock keeps the
// Stage-C L9 rule intact: a slot locked before a diet change never
// persists a now-forbidden meal.
function slotIdsToKeep(existingSlots, finalSlots, compliantPoolIds) {
  return existingSlots
    .filter((s) =>
      finalSlots.some((f) => slotKey(f) === slotKey(s))
      || (s.locked && s.recipeId != null && compliantPoolIds.has(s.recipeId)))
    .map((s) => s.id);
}

async function upsertSlot(planId, slot, db = prisma) {
  return db.planSlot.upsert({
    where: { planId_dayOfWeek_slotType_slotIndex: { planId, dayOfWeek: slot.dayOfWeek, slotType: slot.slotType, slotIndex: slot.slotIndex } },
    update: {
      recipeId: slot.recipeId, proteinScale: slot.proteinScale, sidesScale: slot.sidesScale,
      ingredients: slot.ingredients, kcal: slot.kcal, protein: slot.protein, fat: slot.fat, carb: slot.carb,
      warning: slot.warning, locked: slot.locked,
    },
    create: {
      planId, dayOfWeek: slot.dayOfWeek, slotType: slot.slotType, slotIndex: slot.slotIndex,
      recipeId: slot.recipeId, proteinScale: slot.proteinScale, sidesScale: slot.sidesScale,
      ingredients: slot.ingredients, kcal: slot.kcal, protein: slot.protein, fat: slot.fat, carb: slot.carb,
      warning: slot.warning, locked: slot.locked,
    },
  });
}

// ── THE ONE WARNING DERIVATION (E8) ──────────────────────────────────────
//
// A slot's `warning` is the honesty signal the constitution rests on:
// "Solver declares 'unsolvable + why' — silent target misses are forbidden."
// It is therefore a SERVER CONCLUSION about the macros the server itself just
// recomputed. It is never a field a client hands us (a client that wants a
// clean-looking week simply sends null, and the miss disappears) and never a
// hardcoded null.
//
// This is the derivation /fill-today-from-cart already did correctly, lifted
// out so every write path states a miss in the same words against the same
// thresholds the SOLVER gates on (KCAL_TOLERANCE_PCT / PROTEIN_TOLERANCE_PCT,
// imported rather than re-typed as a literal 0.15).
//
// Protein is in here because resolveSlot() warns on a protein shortfall ALONE
// (weeklyPlanner.js, the `best.proteinShort > PROTEIN_TOLERANCE_PCT` branch).
// Deriving from kcal only would have silently dropped exactly those warnings
// on the paths below — swapping a warning the client could forge for a warning
// that never fires is not a fix. Shortfall is asymmetric, like the solver's:
// over-delivering protein is inside the band by construction.
//
// No target (a slot the current meal config doesn't describe) => null: there
// is no target to miss, which is not the same as a miss being hidden.
function deriveSlotWarning(macros, slotTarget) {
  if (!slotTarget) return null;
  const kcalTarget = Number(slotTarget.kcalTarget) || 0;
  const proteinTarget = Number(slotTarget.proteinTarget) || 0;
  const kcal = Number(macros?.kcal) || 0;
  const protein = Number(macros?.protein) || 0;

  const misses = [];
  const kcalOff = kcalTarget > 0 ? Math.abs(kcal - kcalTarget) / kcalTarget : 0;
  if (kcalOff > KCAL_TOLERANCE_PCT) misses.push(`${Math.round(kcal)} kcal vs a ${Math.round(kcalTarget)} kcal slot`);
  const proteinShort = proteinTarget > 0 ? Math.max(0, (proteinTarget - protein) / proteinTarget) : 0;
  if (proteinShort > PROTEIN_TOLERANCE_PCT) misses.push(`${Math.round(protein)}g protein vs a ${Math.round(proteinTarget)}g target`);

  return misses.length ? `${misses.join("; ")} — the 0.5-2x portion limit couldn't close the gap.` : null;
}

// The per-slot target for one day, keyed by (slotType, slotIndex). Same
// lookup the alternates endpoint already does; hoisted so every path that
// needs to JUDGE a slot can find the number it is judged against.
function slotTargetFinder(dailyTarget, mealConfig) {
  const targets = targetsForSlots(dailyTarget, buildSlots(mealConfig));
  return (dayOfWeek, slotType, slotIndex) =>
    targets.find((t) => t.dayOfWeek === dayOfWeek && t.slotType === slotType && t.slotIndex === slotIndex) || null;
}

// Server-side rebuild of an incoming candidate/alternate slot. The client
// only nominates {recipeId, ingredients:[{foodId, grams}]} — names come
// from the DB and macros are recomputed here, never trusted. Membership in
// the user's FILTERED pool is the compliance check (diet + allergies).
function rebuildSlotFromClient(incoming, recipePool, slotTarget = null) {
  const recipe = recipePool.find((r) => r.id === incoming.recipeId);
  if (!recipe) throw Object.assign(new Error("recipe not in your allowed pool (diet/allergy rules or unknown id)"), { status: 400 });
  const byFoodId = new Map(recipe.ingredients.map((i) => [i.foodId, i]));
  const ingredients = (incoming.ingredients || []).map((ing) => {
    const ri = byFoodId.get(ing.foodId);
    if (!ri) throw Object.assign(new Error(`ingredient ${ing.foodId} does not belong to recipe "${recipe.name}"`), { status: 400 });
    const grams = Math.round(Number(ing.grams));
    // Stage-C fix (M9): grams must sit within the spec's 0.5x-2x portion band
    // relative to the recipe's base grams (a non-scalable ingredient stays at
    // base), with a small tolerance for 5g practical rounding. Previously any
    // value up to 5000 g was accepted, so a crafted payload could store a x10
    // / 44,000-kcal slot the dashboard then presented as the plan.
    const lo = ri.scalable ? ri.baseGrams * 0.5 : ri.baseGrams;
    const hi = ri.scalable ? ri.baseGrams * 2 : ri.baseGrams;
    const TOL = 6;
    if (!Number.isFinite(grams) || grams < 0 || grams < lo - TOL || grams > hi + TOL) {
      throw Object.assign(new Error(`grams for "${ri.food.name}" (${grams}) are outside the allowed 0.5x-2x portion range`), { status: 400 });
    }
    return { foodId: ri.foodId, name: ri.food.name, role: ri.role, grams };
  });
  if (ingredients.length === 0) throw Object.assign(new Error("a slot needs at least one ingredient"), { status: 400 });
  const totals = ingredients.reduce(
    (sum, ing) => {
      const food = byFoodId.get(ing.foodId).food;
      const factor = ing.grams / 100;
      sum.kcal += food.kcal * factor;
      sum.protein += food.protein * factor;
      sum.fat += food.fat * factor;
      sum.carb += food.carb * factor;
      return sum;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  // Clamp the display scale labels to the same 0.5-2x band so they can't be
  // decoupled from the actual grams (Stage-C M9).
  const clampScale = (s) => Math.min(2, Math.max(0.5, Number(s) || 1));
  return {
    recipeId: recipe.id,
    proteinScale: clampScale(incoming.proteinScale),
    sidesScale: clampScale(incoming.sidesScale),
    ingredients,
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, carb: totals.carb,
    // E8: DERIVED, never `incoming.warning`. Everything else on this path is
    // already re-established server-side — recipeId is pool-checked,
    // ingredients are ownership-checked, grams are bounds-checked, macros are
    // recomputed from raw Food rows, scales are clamped — and the honesty
    // signal was the single field still taken on the client's word. A client
    // could clear a real miss by sending null, or invent any sentence it liked.
    warning: deriveSlotWarning(totals, slotTarget),
  };
}

router.get("/current", async (req, res) => {
  const monday = mondayOf(todayStr());
  const plan = await prisma.plan.findUnique({
    where: { userId_startDate: { userId: req.userId, startDate: monday } },
    include: PLAN_INCLUDE,
  });
  res.json(plan);
});

// GET /plans/horizons — the generate surface's menu, served from the SAME
// catalogue resolveHorizon() validates against, so a control can never offer an
// option the solver would reject.
router.get("/horizons", (req, res) => {
  res.json({
    presets: HORIZON_PRESETS.map((p) => ({
      key: p.key, label: p.label, days: p.days, kind: p.kind,
      weeks: p.kind === "meal" ? 0 : Math.ceil(p.days / DAYS_PER_WEEK),
    })),
    customMaxDays: MAX_HORIZON_DAYS,
    defaultKey: "week",
  });
});

// Sum a set of {kcal, protein-ish} rows into one remainder basis.
const sumIntake = (rows, p) => rows.reduce(
  (t, r) => ({ kcal: t.kcal + (r.kcal || 0), protein: t.protein + (r[p] || 0) }),
  { kcal: 0, protein: 0 }
);

// How many meals the brain may DESIGN for one generate.
//
// The old hardcoded `maxCalls: 1` on the legacy swap endpoint is the right
// number for swapping one slot and the wrong number for everything else: a
// month has ~84 slots, and one designed meal across thirty days is
// indistinguishable from none.
//
// Roughly one designed meal per two days, floored at 1 and hard-capped so a
// long horizon cannot run away. The cap is the point — the brain's own
// per-user USD caps (brain/config.js CAPS) remain authoritative and will deny
// before this ceiling is reached if the money is already spent, but a caller
// should never be able to *request* an unbounded number of designs.
const BRAIN_CALL_CEILING = Number(process.env.BRAIN_MAX_DESIGNS_PER_GENERATE) > 0
  ? Number(process.env.BRAIN_MAX_DESIGNS_PER_GENERATE)
  : 12;

function brainCallBudget(horizon) {
  const days = Math.max(1, Number(horizon?.days) || 1);
  return Math.min(BRAIN_CALL_CEILING, Math.max(1, Math.ceil(days / 2)));
}

// ── THE WALL CLOCK ──────────────────────────────────────────────────────────
// A COUNT of calls is not a bound on TIME. The call ceiling above says "at most
// 12 designs"; at the transport's 90s draft timeout that is 18 minutes, against
// a client that used to hang up at 45s (frontend/src/lib/api.js) — so the user
// got a spinner that resolved into neither a plan nor an error. That is the S2
// defect in autopsy-20260727-0126.
//
// The rule: THE SERVER MUST ALWAYS ANSWER BEFORE THE CLIENT HANGS UP. A
// truthful partial week — some slots brain-filled, the rest carrying their
// honest warnings and diagnosis — beats a dead spinner every time.
//
//   client patience (TIMEOUT.LLM)      120s
//   brain pass, hard ceiling            75s   <- can never be exceeded: a design
//                                              is only STARTED when the budget
//                                              still covers a whole one
//   deterministic solve + week writes   ~10s  (measured ms-level; generous)
//   -------------------------------------------------------------------
//   server worst case                  ~85s   ->  ~35s margin (29%)
//
// Raising either constant without raising TIMEOUT.LLM re-arms the spinner.
const BRAIN_GENERATE_BUDGET_MS = Number(process.env.BRAIN_GENERATE_BUDGET_MS) > 0
  ? Number(process.env.BRAIN_GENERATE_BUDGET_MS)
  : 75000;
const BRAIN_SLOT_TIMEOUT_MS = Number(process.env.BRAIN_SLOT_TIMEOUT_MS) > 0
  ? Number(process.env.BRAIN_SLOT_TIMEOUT_MS)
  : 35000;

/**
 * POST /plans/generate — ANY horizon (Stage 2).
 *
 * body.horizon: "meal" | "day" | "3days" | "week" | "2weeks" | "month" | <1-90>
 * Absent = "week", which is byte-for-byte the pre-Stage-2 behaviour: one
 * Monday-anchored week, same locks, same memory, same meta shape.
 *
 * A horizon longer than a week is COMPOSED of week solves sharing one variety
 * ledger — one Plan row per calendar week, each rewritten in its own
 * transaction. A horizon SHORTER than a week starts today and touches only the
 * days it covers; the rest of the week is left exactly as it was.
 */
router.post("/generate", async (req, res) => {
  try {
    const horizon = resolveHorizon(req.body?.horizon); // throws 400 on junk/out-of-range
    const { profile, dailyTarget, mealConfig, recipePool, rawPoolCount, ratings, adjusters } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    filters.ratings = ratings; // T (v2): soft taste re-rank

    const today = todayStr();
    const monday = mondayOf(today);
    const todayIndex = dayNum(today) - dayNum(monday); // 0 = Monday … 6 = Sunday

    const prepped = applyPrepFilter(recipePool, filters.maxPrepMin);
    // Stage 3: the week / month / horizon Generate path applies the optional
    // cost/complexity/taste caps HERE — this is its single pool-narrowing point.
    // (The day-options, swap and one-meal solvers narrow inside mealSolver; this
    // one hands an already-narrowed pool to generateHorizonPlan, so the caps
    // reach the primary Generate button too, not only those three surfaces.)
    const { survivors: pool, explain: stackExplain } = applyFilterStack(prepped, filters, filters.ratings);
    const costCache = filters.budget ? buildCostCache(pool) : null;
    // Stage-C fix (M10): pass the pool counts so a rough-plan diagnosis can name
    // the TRUE binding constraint instead of always blaming diet/allergy rules.
    // afterPrep is the PREP-only count and afterStack the count after the
    // cost/complexity/taste caps — kept distinct so classifyBinding/diagnose
    // can't blame prep for a cut the stack made (a QC finding: a cost cap that
    // emptied the pool was reported as "prep removes all 889"). stackExplain
    // lets both name the real cap.
    const poolCounts = { raw: rawPoolCount, afterDiet: recipePool.length, afterPrep: prepped.length, afterStack: pool.length, stackExplain };

    // ── 1 MEAL ───────────────────────────────────────────────────────────
    // One dish against what is LEFT of today. No writes, no week solve — this
    // is the instant path. The basis (diary / planned meals / whole day) is
    // named in the response, because those are three different promises.
    if (horizon.kind === "meal") {
      const [logs, currentPlan] = await Promise.all([
        prisma.mealLog.findMany({ where: { userId: req.userId, date: today }, select: { kcal: true, proteinG: true } }),
        prisma.plan.findUnique({ where: { userId_startDate: { userId: req.userId, startDate: monday } }, include: PLAN_INCLUDE }),
      ]);
      const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
      let basis = "full-day";
      let consumed = { kcal: 0, protein: 0 };
      if (logs.length) {
        basis = "diary";
        consumed = sumIntake(logs, "proteinG");
      } else {
        const todaySlots = (currentPlan?.slots || []).filter((s) => s.dayOfWeek === todayIndex && s.recipeId);
        if (todaySlots.length) {
          basis = "plan";
          consumed = sumIntake(todaySlots, "protein");
        }
      }
      const oneMeal = await solveOneMeal({
        dailyTarget, mealConfig, recipePool: pool, filters, basis,
        consumedKcal: consumed.kcal,
        remaining: { kcal: dailyTarget.kcal - consumed.kcal, protein: Math.max(0, pMid - consumed.protein) },
      });
      const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
      oneMeal.options = (oneMeal.options || []).map((o) => ({ ...o, recipeName: nameById.get(o.recipeId) || "?" }));
      oneMeal.best = oneMeal.options[0] || null;
      return res.json({
        ...(currentPlan || {}),
        meta: {
          horizon: { ...horizon, basis, date: today, consumed },
          oneMeal,
          poolCounts,
          dailyTarget: { kcal: dailyTarget.kcal, proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi },
        },
      });
    }

    // ── 1 DAY → 1 MONTH (and any N days) ─────────────────────────────────
    // Sub-week horizons start TODAY (asking for "3 days" on a Thursday means
    // Thu-Sat, not Mon-Wed). Week-or-longer horizons start at this week's
    // Monday, which is what the Plan row and the week board already mean.
    const startDayOfWeek = horizon.days >= DAYS_PER_WEEK ? 0 : todayIndex;
    const windows = horizonWindows(horizon.days, startDayOfWeek);
    const weekStarts = windows.map((_, i) => addDays(monday, i * 7));

    const existingPlans = await prisma.plan.findMany({
      where: { userId: req.userId, startDate: { in: weekStarts } },
      include: { slots: true },
    });
    const byStart = new Map(existingPlans.map((p) => [p.startDate, p]));

    // A locked slot is only carried forward if its recipe still complies with
    // the CURRENT diet/allergy rules (Stage-C L9). Otherwise a slot locked
    // before a diet change (goat locked, then the user goes vegan) would
    // persist a now-forbidden meal into the regenerated plan.
    const compliantPoolIds = new Set(recipePool.map((r) => r.id));
    // solver-core-1: the locks go INTO the solve as fixed constraints, so the
    // open slots are sized around them and the score describes EXACTLY the plan
    // we are about to store — never substituted in afterwards.
    const lockedSlotsByWindow = windows.map((cover, i) => {
      const covered = new Set(cover);
      return (byStart.get(weekStarts[i])?.slots || [])
        .filter((s) => s.locked && s.recipeId != null && compliantPoolIds.has(s.recipeId) && covered.has(s.dayOfWeek));
    });

    // Cross-week variety memory: what the user's PREVIOUS plans already served,
    // newest first, recency-weighted. Inside the horizon, generateHorizonPlan
    // prepends the weeks it has already solved to this same list.
    const priorPlans = await prisma.plan.findMany({
      where: { userId: req.userId, startDate: { lt: weekStarts[0] } },
      orderBy: { startDate: "desc" },
      take: RECENCY_WEIGHTS.length,
      include: { slots: { select: { recipeId: true } } },
    });

    // ── THE BRAIN, ON THE GENERATE BUTTON ──────────────────────────────────
    // This is P0-1. The Library→Brain router (lib/mealRouter.js) has existed
    // and worked for some time, but it only runs when a caller passes
    // `aiFallback` — and the ONLY caller that ever did was the legacy one-shot
    // swap endpoint below (:626), which the UI has moved away from. So the
    // brain has never designed a meal during a real generate. Zero LlmUsage
    // rows confirm it.
    //
    // Lazy require: pulling brain/llm.js at module load would drag the
    // Anthropic SDK into every boot, including keyless installs. The codebase
    // keeps that off the hot path deliberately (weeklyPlanner.js:15) and this
    // does not break the rule.
    const { isBrainEnabled } = require("../lib/brain/llm.js");
    const brainOn = isBrainEnabled();
    const result = await generateHorizonPlan({
      dailyTarget, mealConfig, recipePool: pool, horizon, filters,
      counts: poolCounts,
      // Allergy-filtered in planContext; the solver only ever consumes this list.
      adjusters,
      bias: buildBias(filters, costCache),
      priorPlans, lockedSlotsByWindow, startDayOfWeek,
      // BRAIN=off (or a keyless install) => omitted entirely => the horizon
      // planner behaves exactly as it did before P0-1 and the goldens hold.
      ...(brainOn
        ? {
            aiFallback: {
              enabled: true,
              maxCalls: brainCallBudget(horizon),
              profile,
              // The wall clock (see BRAIN_GENERATE_BUDGET_MS above). maxCalls
              // bounds the money; these two bound the time. Both are needed.
              budgetMs: BRAIN_GENERATE_BUDGET_MS,
              slotTimeoutMs: BRAIN_SLOT_TIMEOUT_MS,
              // The clock is injected from HERE, not read inside the solver:
              // mealSolver.js and weeklyPlanner.js are held to the solver-path
              // purity invariant (no Math.random / Date.now / new Date), which
              // is what keeps the goldens reproducible. A route may read the
              // clock; the solver may not.
              now: () => Date.now(),
            },
          }
        : {}),
    });

    // One transaction PER WEEK (audit Tier 4): a week rewrite is atomic, so a
    // failure can never leave a half-written week on disk. Per-week rather than
    // one giant transaction because a month is ~84 upserts, and `weeksWritten`
    // below reports honestly how far it got if one fails.
    const written = new Map();
    for (let i = 0; i < windows.length; i++) {
      const startDate = weekStarts[i];
      const covered = windows[i];
      const finalSlots = result.windows[i].slots;
      const existingSlots = byStart.get(startDate)?.slots || [];
      const full = await prisma.$transaction(async (tx) => {
        const plan = await tx.plan.upsert({
          where: { userId_startDate: { userId: req.userId, startDate } },
          update: {},
          create: { userId: req.userId, startDate },
        });
        // Scoped to the days this horizon actually covers. A 3-day plan must
        // not delete the four days it never touched — for a full week
        // `covered` is 0-6, so this is the pre-Stage-2 delete exactly.
        await tx.planSlot.deleteMany({
          where: {
            planId: plan.id,
            dayOfWeek: { in: covered },
            id: { notIn: slotIdsToKeep(existingSlots, finalSlots, compliantPoolIds) },
          },
        });
        for (const s of finalSlots) await upsertSlot(plan.id, s, tx);
        return tx.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
      });
      written.set(startDate, full);
    }

    const horizonStart = addDays(monday, startDayOfWeek);
    const horizonEnd = addDays(horizonStart, horizon.days - 1);
    const v = result.variety;
    const outlook = varietyOutlook({ pool, mealConfig, filters, dailyTarget, horizonWeeks: windows.length });
    // What the horizon ACTUALLY produced, stated as a number rather than a
    // promise — the counterpart to varietyOutlook's up-front prediction.
    const horizonVarietyNote = v.totalSlots > 0
      ? `${horizon.label}: ${v.distinctRecipes} distinct dish(es) across ${v.filledSlots} filled slot(s); most-repeated dish appears ${v.maxRepeat}x against a ${v.horizonRepeatCap}x cap for this horizon (${v.perWeekCap}x per week).`
      : null;

    // Forward what the solver ALREADY computed (never recompute). Additive: the
    // plan object is unchanged, `meta` rides alongside it, and for the default
    // week horizon every pre-Stage-2 key keeps its exact meaning.
    const meta = {
      // Scalar match % FIRST — this is the number the honesty claim rests on and
      // the shape the UI reads. `score` keeps the full object.
      matchPct: result.score.avgMatch,
      attempts: result.attempts, // "best of N" — the real count, not a claim
      score: result.score, // { daysInTolerance, avgMatch, days[], totalDays }
      // Per-day honest report: every day states its own match %, its own deltas
      // and, when it misses, its own plain-English miss line. Without this a day
      // could land 18% under target behind a healthy average — a silent target
      // miss, which the constitution forbids.
      days: result.score.days,
      // { feasible, reasons, suggestions, binding } | null. Null ONLY when every
      // day landed in tolerance, every slot filled, and the variety contract held.
      diagnosis: result.diagnosis,
      poolCounts, // { raw, afterDiet, afterPrep }
      variety: { ...outlook, horizon: v, notes: [...(outlook.notes || []), horizonVarietyNote].filter(Boolean) },
      priorWeeksConsidered: priorPlans.length,
      horizon: {
        ...horizon,
        startDate: horizonStart, endDate: horizonEnd, startDayOfWeek,
        weeksWritten: written.size, solveMs: result.solveMs,
        // `weeks` stays the COUNT (from the horizon spec); the per-week report
        // is its own key so one name never means two things.
        weekPlans: result.windows.map((w, i) => ({
          startDate: weekStarts[i], dayIndices: w.dayIndices,
          days: w.score.days.length,
          daysInTolerance: w.score.daysInTolerance,
          avgMatch: w.score.avgMatch,
          unfilledSlots: w.slots.filter((s) => !s.recipeId).length,
          poolSize: w.poolSize,
        })),
      },
    };
    // ── PERSIST THE VERDICT ─────────────────────────────────────────────────
    // Until this landed, `meta` existed only in the HTTP response: it rode into
    // one React useState and died at the next reload, so the user kept the meals
    // and lost the reason they were the wrong meals. The columns and the reader
    // shipped in 34452cb; this is the write half that commit did not own.
    //
    // Stored on the FIRST week's row: a multi-week horizon writes several Plan
    // rows but produces ONE narration covering all of them, and that row is also
    // the only one this route returns. `diagnosis` is a promoted copy of
    // meta.diagnosis written in the same statement — deliberate duplication, kept
    // in sync here, with meta.diagnosis authoritative if they ever disagree.
    //
    // A failed write must not cost the user a plan they already have: the plan
    // rows are committed, and a verdict is an explanation of them. So this is
    // best-effort and loud, never fatal.
    const firstWeek = written.get(weekStarts[0]);
    const verdictAt = new Date();
    const verdictSlotSig = planSlotSig(firstWeek);
    let persisted = false;
    try {
      await prisma.plan.update({
        where: { id: firstWeek.id },
        data: { verdict: meta, diagnosis: result.diagnosis ?? null, verdictAt, verdictSlotSig },
      });
      persisted = true;
    } catch (e) {
      console.warn(`[plan-verdict] user=${req.user.id} plan=${firstWeek.id} write failed: ${e.message} — plan stands, verdict not durable this time`);
    }
    // The response plan is always THIS week's row (weekStarts[0] === monday),
    // so the week board keeps rendering exactly what it always did. The verdict
    // fields ride along so the client sees the same row a reload would fetch,
    // and `meta` stays for every existing reader.
    res.json({
      ...firstWeek,
      ...(persisted ? { verdict: meta, diagnosis: result.diagnosis ?? null, verdictAt, verdictSlotSig } : {}),
      meta,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 4: 3+ scored complete-day candidates. Fast by design (no AI calls,
// no writes) — accepting one goes through /accept-day.
router.post("/day-options", async (req, res) => {
  try {
    const { profile, dailyTarget, mealConfig, recipePool, ratings } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    filters.ratings = ratings; // T (v2): soft taste re-rank
    const dayOfWeek = Number.isInteger(req.body?.dayOfWeek) && req.body.dayOfWeek >= 0 && req.body.dayOfWeek <= 6 ? req.body.dayOfWeek : 0;

    // Respect what the rest of the week already serves (variety caps span
    // the whole week; yesterday's dishes get discounted today).
    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.findUnique({ where: { userId_startDate: { userId: req.userId, startDate: monday } }, include: { slots: true } });
    const weekUsage = new Map();
    for (const s of plan?.slots || []) {
      if (s.recipeId && s.dayOfWeek !== dayOfWeek) weekUsage.set(s.recipeId, (weekUsage.get(s.recipeId) || 0) + 1);
    }
    const prevDayIds = new Set((plan?.slots || []).filter((s) => s.dayOfWeek === dayOfWeek - 1 && s.recipeId).map((s) => s.recipeId));

    // solver-core-1 (day level): /accept-day keeps this day's locked slots
    // regardless of the candidate chosen, so the candidates must be solved and
    // scored WITH them.
    const lockedSlots = (plan?.slots || []).filter((s) => s.locked && s.dayOfWeek === dayOfWeek && s.recipeId);
    const result = await generateDayCandidates({
      dailyTarget, mealConfig, recipePool, dayOfWeek, filters, weekUsage, prevDayIds, lockedSlots, profile,
    });
    // Attach recipe names for display (candidates carry ids + numbers only).
    const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
    for (const c of result.candidates) {
      for (const s of c.slots) s.recipeName = s.recipeId ? nameById.get(s.recipeId) || "?" : null;
    }
    res.json({ ...result, dailyTarget: { kcal: dailyTarget.kcal, proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi, fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, carbLo: dailyTarget.carbLo, carbHi: dailyTarget.carbHi } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 4: accepting a candidate writes that day into the week plan.
// Locked slots on that day are preserved; everything else is replaced by
// the (server-rebuilt, compliance-checked) accepted slots.
router.post("/accept-day", async (req, res) => {
  try {
    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const dayOfWeek = req.body?.dayOfWeek;
    const incoming = req.body?.slots;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return res.status(400).json({ error: "dayOfWeek 0-6 required" });
    if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ error: "slots required" });

    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });
    const lockedKeys = new Set((plan.slots || []).filter((s) => s.locked && s.dayOfWeek === dayOfWeek).map(slotKey));

    // E8: the accepted day is judged against THIS user's current slot targets,
    // so an accepted candidate that misses says so in the server's own words.
    const targetFor = slotTargetFinder(dailyTarget, mealConfig);

    const rebuilt = [];
    for (const s of incoming) {
      const slotType = s.slotType === "snack" ? "snack" : "meal";
      const slotIndex = Number.isInteger(s.slotIndex) ? s.slotIndex : 0;
      const record = {
        dayOfWeek, slotType, slotIndex,
        locked: false,
        ...rebuildSlotFromClient(s, recipePool, targetFor(dayOfWeek, slotType, slotIndex)),
      };
      if (lockedKeys.has(slotKey(record))) continue; // locked slots keep their meal
      rebuilt.push(record);
    }

    // Remove this day's unlocked slots that the accepted set doesn't cover
    // (meal-config changes shrink days cleanly).
    const keepIds = (plan.slots || [])
      .filter((s) => s.dayOfWeek !== dayOfWeek || s.locked || rebuilt.some((r) => slotKey(r) === slotKey(s)))
      .map((s) => s.id);
    // Atomic day rewrite — same reasoning as /generate's transaction above.
    const full = await prisma.$transaction(async (tx) => {
      await tx.planSlot.deleteMany({ where: { planId: plan.id, dayOfWeek, id: { notIn: keepIds } } });
      for (const r of rebuilt) await upsertSlot(plan.id, r, tx);
      return tx.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put("/:planId/slots/:slotId", async (req, res) => {
  const { locked } = req.body || {};
  if (typeof locked !== "boolean") return res.status(400).json({ error: "locked (boolean) required" });
  const slot = await prisma.planSlot.findFirst({ where: { id: req.params.slotId, planId: req.params.planId, plan: { userId: req.userId } } });
  if (!slot) return res.status(404).json({ error: "slot not found" });
  const updated = await prisma.planSlot.update({ where: { id: slot.id }, data: { locked }, include: { recipe: true } });
  res.json(updated);
});

// Phase 4: 3 scored alternates for a slot — the user picks, /apply writes.
router.post("/:planId/slots/:slotId/alternates", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    const slotTarget = targetsForSlots(dailyTarget, buildSlots(mealConfig))
      .find((s) => s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex);
    if (!slotTarget) return res.status(400).json({ error: "slot not in current meal config" });

    const alternates = await alternatesForSlot({
      slotTarget, recipePool,
      existingSlots: plan.slots.filter((s) => s.id !== target.id),
      filters,
      excludeRecipeIds: target.recipeId ? [target.recipeId] : [],
    });
    const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
    res.json({ alternates: alternates.map((a) => ({ ...a, recipeName: nameById.get(a.recipeId) || "?" })) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Apply a chosen alternate (server-rebuilt + compliance-checked).
router.put("/:planId/slots/:slotId/apply", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    // E8: same slot target the /alternates endpoint scored against, so the
    // applied slot's warning describes the plate we are about to store.
    const slotTarget = slotTargetFinder(dailyTarget, mealConfig)(target.dayOfWeek, target.slotType, target.slotIndex);
    const record = {
      dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex,
      locked: false,
      ...rebuildSlotFromClient(req.body || {}, recipePool, slotTarget),
    };
    await upsertSlot(plan.id, record);
    const full = await prisma.planSlot.findFirst({ where: { planId: plan.id, dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex }, include: { recipe: true } });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: place a specific recipe (from the library detail view) into a
// chosen slot at a chosen serving scale. Pool membership = diet/allergy
// compliance, exactly like accept-day.
router.post("/place-recipe", async (req, res) => {
  try {
    const { dayOfWeek, slotType, slotIndex, recipeId, scale } = req.body || {};
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return res.status(400).json({ error: "dayOfWeek 0-6 required" });
    const type = slotType === "snack" ? "snack" : "meal";
    const idx = Number.isInteger(slotIndex) ? slotIndex : 0;
    const s = Number(scale);
    if (!(s >= 0.5 && s <= 2)) return res.status(400).json({ error: "scale must be between 0.5 and 2" });

    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const recipe = recipePool.find((r) => r.id === recipeId);
    if (!recipe) return res.status(400).json({ error: "recipe not in your allowed pool (diet/allergy rules or unknown id)" });

    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });
    const existing = (plan.slots || []).find((x) => x.dayOfWeek === dayOfWeek && x.slotType === type && x.slotIndex === idx);
    if (existing?.locked) return res.status(409).json({ error: "that slot is locked — unlock it first" });

    const ingredients = recipe.ingredients.map((ing) => ({
      foodId: ing.foodId, name: ing.food.name, role: ing.role,
      grams: Math.round((ing.baseGrams * (ing.scalable ? s : 1)) / 5) * 5 || Math.round(ing.baseGrams * (ing.scalable ? s : 1)),
    }));
    const totals = ingredients.reduce((t, ing) => {
      const food = recipe.ingredients.find((i) => i.foodId === ing.foodId).food;
      const f = ing.grams / 100;
      return { kcal: t.kcal + food.kcal * f, protein: t.protein + food.protein * f, fat: t.fat + food.fat * f, carb: t.carb + food.carb * f };
    }, { kcal: 0, protein: 0, fat: 0, carb: 0 });

    // E8: this used to hardcode `warning: null` while its sibling below
    // (/fill-today-from-cart) derived the same signal properly in this same
    // file. Placing a 600-kcal dish by hand into a 300-kcal snack slot is
    // exactly the miss the constitution forbids storing in silence — the user
    // chose the recipe, but the server still owes them the number.
    await upsertSlot(plan.id, {
      dayOfWeek, slotType: type, slotIndex: idx,
      recipeId: recipe.id, proteinScale: s, sidesScale: s,
      ingredients, ...totals, locked: false,
      warning: deriveSlotWarning(totals, slotTargetFinder(dailyTarget, mealConfig)(dayOfWeek, type, idx)),
    });
    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: fill TODAY's slots from the cart, each recipe solver-scaled to
// its slot's target. Locked slots keep their meals; extra cart items beyond
// today's slot count are reported, not silently dropped.
router.post("/fill-today-from-cart", async (req, res) => {
  try {
    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const cart = await prisma.cartItem.findMany({ where: { userId: req.userId }, orderBy: { addedAt: "asc" } });
    if (cart.length === 0) return res.status(400).json({ error: "your cart is empty" });

    const poolById = new Map(recipePool.map((r) => [r.id, r]));
    const usable = cart.map((c) => poolById.get(c.recipeId)).filter(Boolean);
    const skippedForDiet = cart.length - usable.length;
    if (usable.length === 0) return res.status(422).json({ error: "no cart recipe passes your current diet/allergy rules" });

    const jsDay = new Date().getDay();
    const today = jsDay === 0 ? 6 : jsDay - 1;
    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });

    const dayTargets = targetsForSlots(dailyTarget, buildSlots(mealConfig)).filter((t) => t.dayOfWeek === 0);
    let cartIdx = 0;
    let placed = 0;
    for (const target of dayTargets) {
      if (cartIdx >= usable.length) break;
      const existing = (plan.slots || []).find((x) => x.dayOfWeek === today && x.slotType === target.slotType && x.slotIndex === target.slotIndex);
      if (existing?.locked) continue;
      const recipe = usable[cartIdx++];
      const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
      // Stage-C fix (#33): the 0.5-2x scale can't always reach a slot's target
      // (a 600-kcal dish forced into a 300-kcal snack slot). Label the miss
      // instead of storing warning:null — the constitution bans silent misses.
      // This derivation is now deriveSlotWarning() above — E8 made it the ONE
      // copy, shared with accept-day / apply / place-recipe, which either
      // trusted the client or hardcoded null.
      const warning = deriveSlotWarning(scaled, target);
      await upsertSlot(plan.id, {
        dayOfWeek: today, slotType: target.slotType, slotIndex: target.slotIndex,
        recipeId: recipe.id, proteinScale: scaled.proteinScale, sidesScale: scaled.sidesScale,
        ingredients: scaled.ingredients, kcal: scaled.kcal, protein: scaled.protein, fat: scaled.fat, carb: scaled.carb,
        warning, locked: false,
      });
      placed++;
    }

    const leftover = usable.length - cartIdx;
    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json({
      plan: full,
      placed,
      note: [
        skippedForDiet ? `${skippedForDiet} cart item(s) skipped — outside your current diet/allergy rules.` : null,
        leftover > 0 ? `${leftover} cart item(s) didn't fit today's ${dayTargets.length} slots.` : null,
      ].filter(Boolean).join(" ") || null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Legacy one-shot swap (kept for compatibility; the UI now prefers
// alternates → apply).
router.post("/:planId/slots/:slotId/swap", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { profile, dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const result = await regenerateOneSlot(
      plan.slots, { dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex }, recipePool, dailyTarget, mealConfig,
      { aiFallback: { enabled: true, maxCalls: 1, profile } }
    );
    const updated = await upsertSlot(plan.id, result);
    const full = await prisma.planSlot.findUnique({ where: { id: updated.id }, include: { recipe: true } });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

function planToGroceryListInput(plan) {
  return {
    // Stage-C fix (M7): the slot's ingredients JSON is the schema's declared
    // ground truth and survives recipe deletion (recipeId → SetNull). Keying
    // on recipeId dropped a still-planned, still-displayed meal's ingredients
    // from the shopping list silently. Any slot with real ingredients counts.
    meals: plan.slots
      .filter((s) => Array.isArray(s.ingredients) && s.ingredients.length)
      .map((s) => ({
        status: "solved",
        anchor: { ingredients: s.ingredients.map((i) => ({ name: i.name, grams: i.grams, state: undefined })) },
        adjusters: [],
      })),
  };
}

router.post("/:planId/grocery-list", async (req, res) => {
  const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
  if (!plan) return res.status(404).json({ error: "plan not found" });

  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(planToGroceryListInput(plan));
  // Phase 4: practical shopping units primary, grams secondary. checked
  // starts false; the check endpoint below persists ticks.
  const decorated = items.map((i) => ({
    ...i,
    purchaseUnits: toPurchaseUnits(i.name, i.purchase?.grams ?? i.preparedGrams),
    checked: false,
  }));

  // Stage-C fix (M13): buildGroceryList's bySection referenced the PRE-decoration
  // items, so on the fresh-generate path the UI (which prefers bySection)
  // rendered items with no `checked`/`purchaseUnits` — dead checkboxes and
  // invisible purchase units. Rebuild bySection from the decorated items.
  const decoratedByName = new Map(decorated.map((d) => [d.name, d]));
  const decoratedBySection = {};
  for (const [section, secItems] of Object.entries(bySection || {})) {
    decoratedBySection[section] = secItems.map((i) => decoratedByName.get(i.name) || i);
  }

  const list = await prisma.groceryList.upsert({
    where: { planId: plan.id },
    update: { items: decorated },
    create: { planId: plan.id, items: decorated },
  });
  res.json({ ...list, bySection: decoratedBySection, totalEstimatedCostCad, costCoverageNote });
});

router.get("/:planId/grocery-list", async (req, res) => {
  const list = await prisma.groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } });
  if (!list) return res.status(404).json({ error: "no grocery list generated yet for this plan" });
  res.json(list);
});

// Tick/untick a grocery item by name — persisted on the list so it survives
// tab switches (a regenerated list naturally resets its checkboxes).
router.put("/:planId/grocery-list/check", async (req, res) => {
  const { name, checked } = req.body || {};
  if (typeof name !== "string" || typeof checked !== "boolean") {
    return res.status(400).json({ error: "name (string) and checked (boolean) required" });
  }
  const list = await prisma.groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } });
  if (!list) return res.status(404).json({ error: "no grocery list for this plan" });
  const items = (list.items || []).map((i) => (i.name === name ? { ...i, checked } : i));
  const updated = await prisma.groceryList.update({ where: { id: list.id }, data: { items } });
  res.json(updated);
});

module.exports = router;
// Exposed for unit testing (attached to the router function; app.use unaffected).
module.exports.rebuildSlotFromClient = rebuildSlotFromClient;
module.exports.deriveSlotWarning = deriveSlotWarning;
module.exports.slotTargetFinder = slotTargetFinder;
module.exports.filterRecipePool = filterRecipePool;
module.exports.slotIdsToKeep = slotIdsToKeep;
module.exports.planSlotSig = planSlotSig;
