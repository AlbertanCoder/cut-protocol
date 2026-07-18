const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { kg2lb, computeTDEE, computeMacros, trendRate, verdict } = require("../lib/bmrEngine.js");

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
  if (!date || typeof weightKg !== "number" || weightKg < 45 || weightKg > 220) {
    return res.status(400).json({ error: "date and a sane weightKg (45-220) are required" });
  }
  const w = await prisma.weighin.upsert({
    where: { userId_date: { userId: req.userId, date } },
    update: { weightKg },
    create: { userId: req.userId, date, weightKg },
  });
  res.json({ date: w.date, weightKg: w.weightKg });
});

router.delete("/:date", async (req, res) => {
  await prisma.weighin.deleteMany({ where: { userId: req.userId, date: req.params.date } });
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
  const v = verdict(rate, profile.targetKcal, daysIn);

  const weightNowKg = avg7Kg != null ? avg7Kg : profile.startWeightKg;
  const { rows, rmr, tdee } = computeTDEE(profile, weightNowKg);
  const macros = computeMacros(profile, weightNowKg, profile.targetKcal);

  res.json({
    weighins: weighins.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    avg7Kg, rate, daysIn, verdict: v,
    bmr: { rows, rmr, tdee },
    macros,
  });
});

module.exports = router;
