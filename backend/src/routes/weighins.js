const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { kg2lb, computeMacros, trendRate, trailingAverage, verdict } = require("../lib/bmrEngine.js");
const { recomputeTarget, reconcileTarget } = require("../lib/profileTarget.js");
const { adaptiveContext } = require("../lib/adaptiveTarget.js");
// One definition of "what day is it", shared with every other consumer. This
// file used to carry a THIRD private copy of dayNum/todayStr (the lib had one,
// the frontend had another), and the copy here computed today in UTC — so on
// any evening after 18:00 local the `daysIn` below counted a day that had not
// happened yet and the "WEEK 1 — WATER NOISE" hold lifted early. Never
// re-declare these; import them.
const { dayNum, todayStr } = require("../lib/dates.js");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const weighins = await prisma.weighin.findMany({ where: { userId: req.userId }, orderBy: { date: "asc" } });
  res.json(weighins.map((w) => ({ date: w.date, weightKg: w.weightKg })));
});

router.post("/", async (req, res) => {
  const { date, weightKg } = req.body || {};
  if (!date || typeof weightKg !== "number" || weightKg < 35 || weightKg > 300) {
    return res.status(400).json({ error: "date and a sane weightKg (35-300) are required" });
  }
  const w = await prisma.weighin.upsert({
    where: { userId_date: { userId: req.userId, date } },
    update: { weightKg },
    create: { userId: req.userId, date, weightKg },
  });
  // Weight moved → TDEE moved → the derived target may move with it.
  await recomputeTarget(req.userId, todayStr(), "weighin:create");
  res.json({ date: w.date, weightKg: w.weightKg });
});

router.delete("/:date", async (req, res) => {
  await prisma.weighin.deleteMany({ where: { userId: req.userId, date: req.params.date } });
  await recomputeTarget(req.userId, todayStr(), "weighin:delete");
  res.status(204).end();
});

router.get("/summary", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  if (!profile) return res.status(404).json({ error: "no profile set up yet" });

  const weighins = await prisma.weighin.findMany({ where: { userId: req.userId }, orderBy: { date: "asc" } });
  const entries = weighins.map((w) => ({ date: w.date, weightLb: kg2lb(w.weightKg) }));
  // One clock read for the whole request: resolving the context on one date and
  // reconciling the cache against another would reintroduce the very drift this
  // route is closing (a request can straddle midnight). The trailing average is
  // anchored on this SAME read, so the window it reports is the window it used.
  const asOf = todayStr();

  // "7-day average" has to mean SEVEN DAYS.
  //
  // This was `entries.slice(-7)` — the last seven ROWS — so someone weighing
  // 3×/week got an average spanning ~16 calendar days under a label promising 7.
  // It was not a display bug: resolveEnergy() feeds this weight into
  // computeEnergy(), so the error propagated into every BMR formula, the TDEE,
  // the derived target and all four macro ranges. TrendTab computed the calendar
  // window correctly and the two disagreed on screen — 208.0 lb here against
  // 206.5 lb there, same statistic, same label, same moment, and two different
  // goal dates fell out of it.
  //
  // bmrEngine.trailingAverage() has been the correct primitive, with tests,
  // since it was written (see the header above it). It simply had no callers.
  const avg7 = trailingAverage(entries, (e) => e.weightLb, { asOf });
  // `/ 2.20462` is kg2lb's exact inverse (bmrEngine.js:18) — unchanged from the
  // previous line so the ONLY thing that moves here is which rows are averaged.
  const avg7Kg = avg7 ? avg7.avg / 2.20462 : null;
  const rate = trendRate(entries);
  const daysIn = dayNum(asOf) - dayNum(profile.startDate) + 1;

  // ONE resolver decides which expenditure the app runs on (adaptive
  // reconciliation when the data supports it, formula TDEE otherwise) and how
  // far the target may move this cycle (±STEP_CAP_KCAL) — the same call
  // recomputeTarget() makes.
  const ctx = await adaptiveContext(req.userId, profile, asOf);
  // adaptive-tdee-2: the stored Profile.targetKcal is a CACHE and goes stale by
  // clock alone. Reconcile it against the live resolver on this read — the
  // resolver wins, the row is refreshed, and the correction is logged — so the
  // planner (which reads the stored number) and this screen cannot disagree.
  const targetDrift = (await reconcileTarget(req.userId, {
    asOf, profile, resolved: ctx, reason: "weighins/summary",
  }))?.drift ?? null;
  const { energy, target, safety } = ctx;
  const weightNowKg = ctx.weightKg;
  const v = verdict({ rate, chosenRate: profile.rateLbPerWeek, daysIn, atFloor: target.floored });
  const macros = computeMacros(profile, weightNowKg, target.target, target.floor);
  // onboarding-flow-4: the protein target is per-lb of LEAN mass, and when
  // bodyFatPct is unset that lean mass is an ASSUMPTION (a sex-typical body fat,
  // see bmrEngine.ASSUMED_BODY_FAT_PCT), not a measurement. computeMacros
  // discloses it as bfAssumed/assumedBodyFatPct; name the provenance here in the
  // same shape the rest of the app labels provenance, so no surface can render
  // an estimated protein range as a measured one.
  macros.lbmSource = macros.bfAssumed ? "assumed-bodyfat-estimate" : "user-bodyfat";
  macros.lbmSourceNote = macros.bfAssumed
    ? `Estimated: body fat % isn't set, so lean mass assumes a typical ${macros.assumedBodyFatPct}% for your sex. Enter a real measurement to sharpen the protein target.`
    : `From your entered body fat (${profile.bodyFatPct}%).`;

  res.json({
    weighins: weighins.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    avg7Kg, rate, daysIn, verdict: v,
    // Provenance for the number above: how many weigh-ins actually landed in the
    // window, and whether it fell back to the newest reading because the window
    // was empty (`stale`). A sparse weigher can then be shown that the average
    // is thin instead of being handed a confident number — the constitution's
    // "displayed numbers can reveal their formula and inputs".
    // ADDITIVE: `avg7Kg` keeps its bare-number-or-null contract, so ProfileTab,
    // TodayTab and TrendTab need no change to keep working.
    avg7Meta: avg7
      ? {
        count: avg7.count,
        windowDays: avg7.windowDays,
        fromDate: avg7.fromDate,
        toDate: avg7.toDate,
        stale: avg7.stale,
        staleDays: avg7.staleDays,
      }
      : null,
    energy, // rows(+excluded flags), rmr, spreadLo/Hi, jobMultiplier/source/label, trainingKcalPerDay, tdee
    target, // rate, deficit, raw, target, floor, floored, indicatedTargetKcal, stepCapped
    rateSafety: safety,
    macros,
    // How honest the number is, in one block: measured vs formula-only, what
    // date the food log actually runs through, and whether the step cap is
    // holding back a larger indicated move.
    confidence: ctx.confidence,
    stepCap: ctx.stepCap,
    // Cache-vs-resolver reconciliation for this read (adaptive-tdee-2).
    targetDrift,
    // Adaptive layer: the intake-vs-weight reconciliation, the expenditure it
    // produced, whether it is in effect, and the replayable adjustment log.
    adaptive: {
      ...ctx.adaptive,
      inEffect: ctx.applied,
      effectiveTdee: ctx.effectiveTdee,
      tdeeSource: ctx.tdeeSource,
      formulaTarget: ctx.formulaTarget,
      // What the data asks for (no memory) vs what is actually in force after
      // the ±125 kcal/cycle step cap. If these differ the cap is mid-walk and
      // stepCap.reason says so — never a silent truncation.
      indicatedTarget: ctx.indicatedTarget,
      appliedTarget: target,
      stepCap: ctx.stepCap,
      ledger: ctx.ledger,
      reversible: ctx.reversible,
    },
  });
});

module.exports = router;
