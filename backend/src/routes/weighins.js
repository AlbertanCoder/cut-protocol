const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { kg2lb, computeMacros, trendRate, verdict } = require("../lib/bmrEngine.js");
const { recomputeTarget } = require("../lib/profileTarget.js");
const { adaptiveContext } = require("../lib/adaptiveTarget.js");

const router = express.Router();
router.use(requireAuth);

const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);
const todayStr = () => new Date().toISOString().slice(0, 10);

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
  await recomputeTarget(req.userId);
  res.json({ date: w.date, weightKg: w.weightKg });
});

router.delete("/:date", async (req, res) => {
  await prisma.weighin.deleteMany({ where: { userId: req.userId, date: req.params.date } });
  await recomputeTarget(req.userId);
  res.status(204).end();
});

router.get("/summary", async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  if (!profile) return res.status(404).json({ error: "no profile set up yet" });

  const weighins = await prisma.weighin.findMany({ where: { userId: req.userId }, orderBy: { date: "asc" } });
  const entries = weighins.map((w) => ({ date: w.date, weightLb: kg2lb(w.weightKg) }));
  const last7 = entries.slice(-7);
  const avg7Lb = last7.length ? last7.reduce((s, x) => s + x.weightLb, 0) / last7.length : null;
  const avg7Kg = avg7Lb != null ? avg7Lb / 2.20462 : null;
  const rate = trendRate(entries);
  const daysIn = dayNum(todayStr()) - dayNum(profile.startDate) + 1;

  // ONE resolver decides which expenditure the app runs on (adaptive
  // reconciliation when the data supports it, formula TDEE otherwise) — the
  // same call recomputeTarget() makes, so the screen and the stored
  // Profile.targetKcal can never disagree.
  const ctx = await adaptiveContext(req.userId, profile);
  const { energy, target, safety } = ctx;
  const weightNowKg = ctx.weightKg;
  const v = verdict({ rate, chosenRate: profile.rateLbPerWeek, daysIn, atFloor: target.floored });
  const macros = computeMacros(profile, weightNowKg, target.target);

  res.json({
    weighins: weighins.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    avg7Kg, rate, daysIn, verdict: v,
    energy, // rows(+excluded flags), rmr, spreadLo/Hi, jobMultiplier/source/label, trainingKcalPerDay, tdee
    target, // rate, deficit, raw, target, floor, floored — derived from effectiveTdee
    rateSafety: safety,
    macros,
    // Adaptive layer: the intake-vs-weight reconciliation, the expenditure it
    // produced, whether it is in effect, and the replayable adjustment log.
    adaptive: {
      ...ctx.adaptive,
      inEffect: ctx.applied,
      effectiveTdee: ctx.effectiveTdee,
      tdeeSource: ctx.tdeeSource,
      formulaTarget: ctx.formulaTarget,
      appliedTarget: target,
      ledger: ctx.ledger,
      reversible: ctx.reversible,
    },
  });
});

module.exports = router;
