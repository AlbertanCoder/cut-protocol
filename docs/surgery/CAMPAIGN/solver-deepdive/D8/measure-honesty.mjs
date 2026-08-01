/**
 * D8 — measure what the USER can actually see when a day misses.
 *
 * Deliberately does NOT call diagnose()/dayMissLine() to decide whether a day is
 * out of band. Tolerance is recomputed here from the published thresholds so the
 * verdict is independent of the code under test (prior cross-checks agreed with
 * the defect by reusing the system's own helpers).
 *
 * READ-ONLY: runs against a COPY of dev.db in the scratchpad.
 */
import { createRequire } from "node:module";
// Resolve from the BACKEND package root so @prisma/client and src/lib both load.
const BACKEND = "C:/Users/<account>/Desktop/cut-protocol/backend/";
const require = createRequire(BACKEND + "package.json");

const DB = process.env.D8_DB;
process.env.DATABASE_URL = `file:${DB}`;
process.env.BRAIN = "off";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB}` } } });

const { computeMacros } = require(BACKEND + "src/lib/bmrEngine.js");
const { filterRecipePool } = require(BACKEND + "src/lib/planContext.js");
const { generateBestWeekPlan } = require(BACKEND + "src/lib/mealSolver.js");

// ── independent tolerance (thresholds from mealSolver.js:210-213, recomputed here)
const T = { kcal: 0.15, protein: 0.15, fat: 0.25, carb: 0.25 };
function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { short: 0, over: 0 };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { short: (lo - val) / mid, over: 0 };
  if (val > hi) return { short: 0, over: (val - hi) / mid };
  return { short: 0, over: 0 };
}
function judge(dt, tot) {
  const pMid = (dt.proteinLo + dt.proteinHi) / 2;
  const kcalDelta = dt.kcal > 0 ? (tot.kcal - dt.kcal) / dt.kcal : 1;
  const pShort = pMid > 0 ? Math.max(0, (pMid - tot.protein) / pMid) : 0;
  const hasF = Number.isFinite(dt.fatLo) && Number.isFinite(dt.fatHi) && dt.fatHi > 0;
  const hasC = Number.isFinite(dt.carbLo) && Number.isFinite(dt.carbHi) && dt.carbHi > 0;
  const f = hasF ? bandMiss(tot.fat, dt.fatLo, dt.fatHi) : { short: 0, over: 0 };
  const c = hasC ? bandMiss(tot.carb, dt.carbLo, dt.carbHi) : { short: 0, over: 0 };
  const carbOverAllow = dt.keto ? 0 : T.carb;
  const kcalOk = Math.abs(kcalDelta) <= T.kcal;
  const proteinOk = pShort <= T.protein;
  const fatOk = !hasF || (f.short <= T.fat && f.over <= T.fat);
  const carbOk = !hasC || (c.short <= T.carb && c.over <= carbOverAllow);
  return {
    ok: kcalOk && proteinOk && fatOk && carbOk,
    kcalOk, proteinOk, fatOk, carbOk,
    kcalUnder: kcalDelta < -T.kcal, kcalOver: kcalDelta > T.kcal,
    fatShort: hasF && f.short > T.fat, fatOver: hasF && f.over > T.fat,
    carbShort: hasC && c.short > T.carb, carbOver: hasC && c.over > carbOverAllow,
  };
}
const totalsOf = (ss) => ss.reduce((a, s) => ({
  kcal: a.kcal + (s.kcal || 0), protein: a.protein + (s.protein || 0),
  fat: a.fat + (s.fat || 0), carb: a.carb + (s.carb || 0),
}), { kcal: 0, protein: 0, fat: 0, carb: 0 });

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ_NAMES = ["Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils"];
const ADJ_ROLE = { "Olive Oil": "fat", Butter: "fat", Avocado: "fat", "White rice, cooked": "carb",
  Potatoes: "carb", Oats: "carb", "Chicken breast, cooked, skinless": "protein",
  "Greek Yogurt": "protein", Tofu: "protein", Lentils: "protein" };

async function main() {
  const profiles = await prisma.profile.findMany({ take: 40 });
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
  });
  const adjFoods = await prisma.food.findMany({ where: { name: { in: ADJ_NAMES } } });
  const adjusters = adjFoods.map((f) => ({ role: ADJ_ROLE[f.name], food: f })).filter((a) => a.role);

  console.log(`profiles=${profiles.length} recipes=${recipes.length} adjusters=${adjusters.length}`);

  const stat = {
    days: 0, out: 0,
    outWithSlotWarning: 0, outSilentOnReload: 0,
    outWithUnfilled: 0,
    slots: 0, warnedSlots: 0,
    staleWarnings: 0, adjustedSlots: 0,
    // which macro drove the miss
    byAxis: { kcalUnder: 0, kcalOver: 0, protein: 0, fatShort: 0, fatOver: 0, carbShort: 0, carbOver: 0 },
    // out-of-band days where kcal AND protein were both fine (so no slot could warn)
    outButKcalProteinFine: 0,
    diagnosisNull: 0, weeks: 0,
  };
  // counterfactual: warned slots under a 4-macro slot gate
  let warned2 = 0, warned4 = 0;

  const SEEDS = Number(process.env.D8_SEEDS || 12);
  for (const profile of profiles) {
    let dt;
    try { dt = computeMacros(profile, profile.weightKg ?? 80, profile.targetKcal ?? 2200); }
    catch { continue; }
    if (!(dt?.kcal > 0)) continue;
    const pool = filterRecipePool(recipes, profile);
    if (pool.length < 10) continue;
    const mealConfig = { meals: profile.mealsPerDay || 3, snacks: profile.snacksPerDay || 1 };

    for (let seed = 0; seed < SEEDS; seed++) {
      let best;
      try {
        best = await generateBestWeekPlan(dt, mealConfig, pool.map((r) => ({ ...r })), {
          attempts: 3, rng: mulberry32(seed * 7919 + profile.id.length),
          filters: {}, adjusters,
          counts: { raw: recipes.length, afterDiet: pool.length, afterPrep: pool.length, afterStack: pool.length },
        });
      } catch (e) { continue; }
      stat.weeks++;
      if (best.diagnosis == null) stat.diagnosisNull++;

      const byDay = new Map();
      for (const s of best.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      for (const [, ss] of byDay) {
        stat.days++;
        const tot = totalsOf(ss);
        const v = judge(dt, tot);
        stat.slots += ss.length;
        const warnedHere = ss.filter((s) => s.warning).length;
        stat.warnedSlots += warnedHere;
        for (const s of ss) {
          if (Array.isArray(s.ingredients) && s.ingredients.some((i) => i && i.adjuster)) {
            stat.adjustedSlots++;
            // a warning formed BEFORE the adjuster changed this slot's macros
            if (s.warning) stat.staleWarnings++;
          }
        }
        if (v.ok) continue;
        stat.out++;
        if (v.kcalUnder) stat.byAxis.kcalUnder++;
        if (v.kcalOver) stat.byAxis.kcalOver++;
        if (!v.proteinOk) stat.byAxis.protein++;
        if (v.fatShort) stat.byAxis.fatShort++;
        if (v.fatOver) stat.byAxis.fatOver++;
        if (v.carbShort) stat.byAxis.carbShort++;
        if (v.carbOver) stat.byAxis.carbOver++;
        if (v.kcalOk && v.proteinOk) stat.outButKcalProteinFine++;
        if (ss.some((s) => !s.recipeId)) stat.outWithUnfilled++;
        if (warnedHere > 0) stat.outWithSlotWarning++;
        else stat.outSilentOnReload++;
      }
      // counterfactual slot gate: 2-macro (today) vs 4-macro
      for (const s of best.slots) {
        if (s.warning) warned2++;
        // a 4-macro slot gate would additionally warn any slot whose day is out
        // of band on fat/carb — approximated per-slot by its share of the day
      }
    }
  }
  // second pass for the 4-macro counterfactual, day-scoped
  console.log(JSON.stringify({ ...stat, warned2 }, null, 2));
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
  console.log("\n── HEADLINE ──");
  console.log(`days solved:                 ${stat.days}`);
  console.log(`days OUT of band:            ${stat.out} (${pct(stat.out, stat.days)})`);
  console.log(`  ...with >=1 slot warning:  ${stat.outWithSlotWarning} (${pct(stat.outWithSlotWarning, stat.out)} of out-of-band)`);
  console.log(`  ...SILENT after reload:    ${stat.outSilentOnReload} (${pct(stat.outSilentOnReload, stat.out)} of out-of-band)`);
  console.log(`out-of-band days where kcal+protein BOTH fine (slot gate structurally cannot fire): ${stat.outButKcalProteinFine} (${pct(stat.outButKcalProteinFine, stat.out)})`);
  console.log(`slots carrying an adjuster:  ${stat.adjustedSlots}; of those with a pre-adjuster warning (STALE): ${stat.staleWarnings}`);
  console.log(`weeks with diagnosis===null: ${stat.diagnosisNull} / ${stat.weeks}`);
  console.log("miss axes:", stat.byAxis);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
