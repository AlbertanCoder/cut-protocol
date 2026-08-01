// W1-5 G + H — target-side sanity on the 250-persona fleet, through the REAL
// bmrEngine. Read-only. BRAIN=off node fleet/out/W1-5/targets.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const bmr = require("../../../backend/src/lib/bmrEngine.js");
const { filterRecipePool } = require("../../../backend/src/lib/planContext.js");
const { RECIPE_GATE_SELECT } = require("../../../backend/src/lib/exclusionGate.js");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const prisma = new PrismaClient();

const PERSONAS = "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl";
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(4); };
const eligible = (pool, st) => pool.filter((r) => (r.slotType === st || r.slotType === "either") && (st !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory)));

// Deurenberg 1991: BF% = 1.20*BMI + 0.23*age - 10.8*sex(M=1,F=0) - 5.4
const deurenberg = (bmi, age, sex) => 1.20 * bmi + 0.23 * age - 10.8 * (sex === "M" ? 1 : 0) - 5.4;

const main = async () => {
  const rows = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  const personas = fs.readFileSync(PERSONAS, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  // per-diet meal-eligible protein-density distribution, cached
  const poolCache = new Map();
  const poolFor = (style, excluded) => {
    const key = JSON.stringify([style, [...excluded].sort()]);
    if (poolCache.has(key)) return poolCache.get(key);
    const pool = filterRecipePool(rows, { dietaryStyle: style, excludedFoods: excluded });
    const meal = eligible(pool, "meal"), snack = eligible(pool, "snack");
    const pd = meal.filter((r) => r.kcal > 0).map((r) => (r.protein / r.kcal) * 100);
    const v = { pool: pool.length, meal: meal.length, snack: snack.length,
      p50: q(pd, 0.5), p75: q(pd, 0.75), p90: q(pd, 0.90), p99: q(pd, 0.99), max: pd.length ? +Math.max(...pd).toFixed(4) : null,
      dens: pd };
    poolCache.set(key, v); return v;
  };

  const out = [];
  for (const p of personas) {
    const pr = p.profile;
    const profile = {
      sex: pr.sex, age: pr.age, heightCm: pr.heightCm, bodyFatPct: pr.bodyFatPct ?? 0,
      occupationKey: pr.occupationKey, activityOverride: null,
      sessionsPerWeek: pr.sessionsPerWeek, trainingStyle: pr.trainingStyle, minutesPerSession: pr.minutesPerSession,
      rateLbPerWeek: pr.rateLbPerWeek, floorKcal: pr.floorKcal ?? null, excludedFormulas: [],
      unitPref: pr.unitPref, startWeightKg: pr.startWeightKg, goalWeightKg: pr.goalWeightKg, rateAcknowledged: true,
      dietaryStyle: pr.dietaryStyle && pr.dietaryStyle !== "none" ? pr.dietaryStyle : null,
      mealsPerDay: pr.mealsPerDay, snacksPerDay: pr.snacksPerDay, excludedFoods: pr.excludedFoods || [],
    };
    const energy = bmr.computeEnergy(profile, pr.startWeightKg);
    const derived = bmr.deriveTarget(profile, energy.tdee, energy.rmr);
    const t = bmr.computeMacros(profile, pr.startWeightKg, derived.target);

    const bmi = pr.startWeightKg / Math.pow(pr.heightCm / 100, 2);
    const pMid = (t.proteinLo + t.proteinHi) / 2;
    const fMid = (t.fatLo + t.fatHi) / 2;
    const cMid = t.carbMid;
    const midKcal = pMid * 4 + fMid * 9 + cMid * 4;
    const kcalGapAbs = t.kcal - midKcal;              // I5: how far below targetKcal the midpoints sum
    const oneSidedAllowance = 0.15 * t.kcal;          // ±15% kcal gate, one side
    const spendPct = (kcalGapAbs / oneSidedAllowance) * 100;
    const demandedDensity = (pMid / t.kcal) * 100;    // g protein per 100 kcal the day requires
    const demandedDensityLo = (t.proteinLo / t.kcal) * 100;
    // the gate is one-sided on protein: >= 0.85 * pMid
    const demandedDensityGate = (0.85 * pMid / t.kcal) * 100;
    const proteinPctE = (pMid * 4 / t.kcal) * 100;

    const pool = poolFor(profile.dietaryStyle, profile.excludedFoods);

    // corrected lean mass via Deurenberg
    const bfD = Math.max(3, Math.min(60, deurenberg(bmi, pr.age, pr.sex)));
    const weightLb = pr.startWeightKg * 2.20462262;
    const lbmD = weightLb * (1 - bfD / 100);
    const pLoD = Math.round(lbmD * 1.14), pHiD = Math.round(lbmD * 1.25);
    const pMidD = (pLoD + pHiD) / 2;
    const demandedDensityD = (pMidD / t.kcal) * 100;
    const demandedDensityGateD = (0.85 * pMidD / t.kcal) * 100;
    const gPerKgActualD = pMidD / pr.startWeightKg;

    out.push({
      id: p.id, idx: p.idx, tier: p.tier, sex: pr.sex, age: pr.age, bmi: +bmi.toFixed(2),
      weightKg: pr.startWeightKg, dietaryStyle: profile.dietaryStyle, excludedFoods: profile.excludedFoods,
      bfAssumed: !!t.bfAssumed, assumedBodyFatPct: t.assumedBodyFatPct,
      targetKcal: t.kcal, keto: !!t.keto, carbFloored: !!t.carbFloored,
      lbmLb: +t.lbmLb.toFixed(1), proteinLo: t.proteinLo, proteinHi: t.proteinHi, pMid,
      fatLo: t.fatLo, fatHi: t.fatHi, carbLo: t.carbLo, carbMid: t.carbMid, carbHi: t.carbHi,
      macroKcalGap: t.macroKcalGap, midKcal: +midKcal.toFixed(1),
      kcalGapAbs: +kcalGapAbs.toFixed(1), spendPctOfOneSidedAllowance: +spendPct.toFixed(2),
      proteinPctE: +proteinPctE.toFixed(2),
      gProteinPerKgTotal: +(pMid / pr.startWeightKg).toFixed(3),
      gProteinPerKgLbm: +(pMid / (t.lbmLb / 2.20462262)).toFixed(3),
      demandedDensity: +demandedDensity.toFixed(4), demandedDensityGate: +demandedDensityGate.toFixed(4),
      poolMeal: pool.meal, poolSnack: pool.snack, poolP50: pool.p50, poolP75: pool.p75, poolP90: pool.p90, poolP99: pool.p99, poolMax: pool.max,
      aboveP90: demandedDensity > pool.p90, aboveP90_gate: demandedDensityGate > pool.p90,
      aboveMax: demandedDensity > pool.max, aboveMax_gate: demandedDensityGate > pool.max,
      // corrected-BF counterfactual
      bfDeurenberg: +bfD.toFixed(2), pMidDeurenberg: pMidD,
      demandedDensityD: +demandedDensityD.toFixed(4), demandedDensityGateD: +demandedDensityGateD.toFixed(4),
      aboveP90_D: demandedDensityD > pool.p90, aboveP90_gate_D: demandedDensityGateD > pool.p90,
      gPerKgActualDeurenberg: +gPerKgActualD.toFixed(3),
      proteinInflationPct: +(((pMid - pMidD) / pMidD) * 100).toFixed(2),
    });
  }

  const assumed = out.filter((o) => o.bfAssumed);
  const summary = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    personas: out.length,
    // ── I1 ──
    I1_bfAssumed: assumed.length,
    I1_bfAssumed_bmi30plus: assumed.filter((o) => o.bmi >= 30).length,
    I1_proteinInflation_median: q(assumed.map((o) => o.proteinInflationPct), 0.5),
    I1_proteinInflation_median_bmi30plus: q(assumed.filter((o) => o.bmi >= 30).map((o) => o.proteinInflationPct), 0.5),
    I1_proteinInflation_max: Math.max(...assumed.map((o) => o.proteinInflationPct)),
    I1_gPerKgTotal_M: q(assumed.filter((o) => o.sex === "M").map((o) => o.gProteinPerKgTotal), 0.5),
    I1_gPerKgTotal_F: q(assumed.filter((o) => o.sex === "F").map((o) => o.gProteinPerKgTotal), 0.5),
    // ── I2 (the sharpest number) ──
    I2_assumed_aboveP90: assumed.filter((o) => o.aboveP90).length,
    I2_assumed_aboveP90_underDeurenberg: assumed.filter((o) => o.aboveP90_D).length,
    I2_assumed_aboveP90_gate: assumed.filter((o) => o.aboveP90_gate).length,
    I2_assumed_aboveP90_gate_underDeurenberg: assumed.filter((o) => o.aboveP90_gate_D).length,
    I2_all250_aboveP90: out.filter((o) => o.aboveP90).length,
    I2_all250_aboveP90_underDeurenberg: out.filter((o) => o.aboveP90_D).length,
    I2_assumed_aboveMax: assumed.filter((o) => o.aboveMax).length,
    // ── I3 ──
    I3_over35pctE: out.filter((o) => o.proteinPctE > 35).length,
    I3_maxPctE: Math.max(...out.map((o) => o.proteinPctE)),
    I3_carbFloored: out.filter((o) => o.carbFloored).length,
    I3_carbFloored_allAssumed: out.filter((o) => o.carbFloored).every((o) => o.bfAssumed),
    I3_carbFloored_allFemale: out.filter((o) => o.carbFloored).every((o) => o.sex === "F"),
    I3_carbFloored_detail: out.filter((o) => o.carbFloored).map((o) => ({ id: o.id, sex: o.sex, bmi: o.bmi, bfAssumed: o.bfAssumed, carbMid: o.carbMid, carbLo: o.carbLo })),
    // ── I4 safety tension ──
    I4_belowMinProtein_underDeurenberg: assumed.filter((o) => o.gPerKgActualDeurenberg < 1.2).length,
    I4_worst_gPerKg_underDeurenberg: Math.min(...assumed.map((o) => o.gPerKgActualDeurenberg)),
    // ── I5 ──
    I5_kcalGap_median: q(out.map((o) => o.kcalGapAbs), 0.5),
    I5_kcalGap_p90: q(out.map((o) => o.kcalGapAbs), 0.9),
    I5_spendPct_median: q(out.map((o) => o.spendPctOfOneSidedAllowance), 0.5),
    I5_spendPct_p90: q(out.map((o) => o.spendPctOfOneSidedAllowance), 0.9),
    I5_gapPositiveCount: out.filter((o) => o.kcalGapAbs > 0).length,
    I5_gapExceedsAllowance: out.filter((o) => o.kcalGapAbs > 0.15 * o.targetKcal).length,
    // ── F1 / F2 material ──
    F2_demandedDensity_median: q(out.map((o) => o.demandedDensity), 0.5),
    F2_demandedDensityGate_median: q(out.map((o) => o.demandedDensityGate), 0.5),
    F2_poolP50_median: q(out.map((o) => o.poolP50), 0.5),
    F2_demandAbovePoolP50: out.filter((o) => o.demandedDensity > o.poolP50).length,
    F2_demandGateAbovePoolP50: out.filter((o) => o.demandedDensityGate > o.poolP50).length,
    F2_demandAbovePoolP75: out.filter((o) => o.demandedDensity > o.poolP75).length,
    F2_demandAbovePoolP90: out.filter((o) => o.demandedDensity > o.poolP90).length,
    F2_demandAbovePoolMax: out.filter((o) => o.demandedDensity > o.poolMax).length,
    F2_demandGateAbovePoolMax: out.filter((o) => o.demandedDensityGate > o.poolMax).length,
  };
  fs.writeFileSync("fleet/out/W1-5/targets.json", JSON.stringify({ summary, personas: out }, null, 2));
  console.log(JSON.stringify(summary, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
