#!/usr/bin/env node
// Live verification fixture for the adaptive-TDEE layer (same spirit as
// verifyPhase3/verifyPhase4). Builds a THROWAWAY account in the local dev DB
// with 45 days of weigh-ins + food log for a person whose true burn is
// deliberately 380 kcal above what the formula predicts, then prints what the
// engine actually did with it: the materialized target, the reconciliation,
// the uncertainty budget, and the weekly adjustment log.
//
//   node backend/scripts/verifyAdaptiveTdee.js
//
// Writes to whatever DATABASE_URL points at — dev only. The account is
// recreated from scratch on every run.
require("dotenv/config");
const bcrypt = require("bcryptjs");
const { prisma } = require("../src/lib/prisma.js");
const { addDays, todayStr } = require("../src/lib/dates.js");
const { computeEnergy } = require("../src/lib/bmrEngine.js");
const { KCAL_PER_KG } = require("../src/lib/expenditureEstimator.js");
const { recomputeTarget } = require("../src/lib/profileTarget.js");
const { adaptiveContext } = require("../src/lib/adaptiveTarget.js");

const EMAIL = "adaptive.qa@local";
const DAYS = 45;

function lcg(s) { let x = s >>> 0; return () => ((x = (1664525 * x + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

(async () => {
  const today = todayStr();
  const start = addDays(today, -(DAYS - 1));
  await prisma.mealLog.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.weighin.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.profile.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await bcrypt.hash("adaptive-qa-" + Date.now(), 10) },
  });
  const profileData = {
    userId: user.id, sex: "M", age: 34, heightCm: 180, bodyFatPct: 22,
    occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
    startWeightKg: 96, goalWeightKg: 84, startDate: start, unitPref: "imperial",
    rateLbPerWeek: 1.0, excludedFormulas: [], excludedFoods: [], cuisinePreferences: [], targetKcal: 2150,
  };
  await prisma.profile.create({ data: profileData });

  const energy = computeEnergy(profileData, 96);
  const TRUE_BURN = energy.tdee + 380; // this person genuinely burns 380 more than the formula says
  const INTAKE = 2350;
  console.log(`formula TDEE at 96 kg: ${energy.tdee}   ·   simulated TRUE burn: ${Math.round(TRUE_BURN)}`);

  const rnd = lcg(4242);
  let mass = 96, water = 0;
  const weighins = [], logs = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(start, i);
    mass += (INTAKE - TRUE_BURN) / KCAL_PER_KG;
    water = 0.7 * water + gauss(rnd) * 0.45;
    if (rnd() < 0.88) weighins.push({ userId: user.id, date, weightKg: Math.round((mass + water + gauss(rnd) * 0.1) * 100) / 100 });
    if (rnd() < 0.92) {
      const kcal = Math.max(900, Math.round(INTAKE + gauss(rnd) * 320));
      logs.push({ userId: user.id, date, source: "manual", name: "Day total", kcal, proteinG: 180, carbG: 220, fatG: 70 });
    }
  }
  await prisma.weighin.createMany({ data: weighins });
  await prisma.mealLog.createMany({ data: logs });

  const t = await recomputeTarget(user.id);
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  const ctx = await adaptiveContext(user.id, profile);

  console.log("\n--- materialized target ---");
  console.log(JSON.stringify({ target: t.target, tdee: t.tdee, formulaTdee: t.formulaTdee, source: t.tdeeSource, status: t.adaptiveStatus }, null, 1));
  console.log("\n--- reconciliation (predicted vs actual) ---");
  console.log(JSON.stringify(ctx.adaptive.reconciliation, null, 1));
  console.log("\n--- estimate ---");
  console.log(JSON.stringify(ctx.adaptive.estimate, null, 1));
  console.log("\n--- window ---");
  console.log(JSON.stringify(ctx.adaptive.window, null, 1));
  console.log("\n--- adjustment ledger ---");
  console.table(ctx.ledger.map((r) => ({
    date: r.date, status: r.status, src: r.source,
    formula: r.formulaTdeeKcal, burn: r.expenditureKcal, target: r.targetKcal, change: r.changeKcal,
  })));

  console.log(`\nProfile.targetKcal in DB = ${profile.targetKcal}  ·  screen shows ${ctx.target.target}  ·  match: ${profile.targetKcal === ctx.target.target}`);
  console.log(`recovered burn ${ctx.adaptive.estimate.expenditureKcal} vs true ${Math.round(TRUE_BURN)}  ·  error ${Math.abs(ctx.adaptive.estimate.expenditureKcal - Math.round(TRUE_BURN))} kcal`);
  console.log(`formula-only error would have been ${Math.abs(ctx.energy.tdee - Math.round(TRUE_BURN))} kcal`);
  await prisma.$disconnect();
})();
