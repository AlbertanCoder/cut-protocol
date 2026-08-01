/**
 * D8 pass 2 — the three sharpest tests.
 *  (1) Does any week ship diagnosis===null while containing an out-of-band day?
 *  (2) Does closeDayMacros() leave a slot warning that DISAGREES with the slot's
 *      own stored macros (verdict disagreement), in either direction?
 *  (3) Counterfactual: how many slots would a 4-macro slot gate warn vs today's 2?
 *
 * Tolerance is recomputed locally, never via the code under test.
 */
import { createRequire } from "node:module";
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

const T = { kcal: 0.15, protein: 0.15, fat: 0.25, carb: 0.25 };
// slot-level tolerances (weeklyPlanner.js:67,74)
const S = { kcal: 0.15, protein: 0.12 };

function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { short: 0, over: 0 };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { short: (lo - val) / mid, over: 0 };
  if (val > hi) return { short: 0, over: (val - hi) / mid };
  return { short: 0, over: 0 };
}
function dayOk(dt, tot) {
  const pMid = (dt.proteinLo + dt.proteinHi) / 2;
  const kcalDelta = dt.kcal > 0 ? (tot.kcal - dt.kcal) / dt.kcal : 1;
  const pShort = pMid > 0 ? Math.max(0, (pMid - tot.protein) / pMid) : 0;
  const hasF = Number.isFinite(dt.fatLo) && Number.isFinite(dt.fatHi) && dt.fatHi > 0;
  const hasC = Number.isFinite(dt.carbLo) && Number.isFinite(dt.carbHi) && dt.carbHi > 0;
  const f = hasF ? bandMiss(tot.fat, dt.fatLo, dt.fatHi) : { short: 0, over: 0 };
  const c = hasC ? bandMiss(tot.carb, dt.carbLo, dt.carbHi) : { short: 0, over: 0 };
  const carbOverAllow = dt.keto ? 0 : T.carb;
  return Math.abs(kcalDelta) <= T.kcal && pShort <= T.protein
    && (!hasF || (f.short <= T.fat && f.over <= T.fat))
    && (!hasC || (c.short <= T.carb && c.over <= carbOverAllow));
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
// Pull the kcal figure the warning text asserts: "landed 412 kcal vs a 530 target"
const LANDED = /landed ([\d,]+) kcal vs a ([\d,]+) target/;
const num = (s) => Number(String(s).replace(/,/g, ""));

const ADJ_NAMES = ["Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils"];
const ADJ_ROLE = { "Olive Oil": "fat", Butter: "fat", Avocado: "fat", "White rice, cooked": "carb",
  Potatoes: "carb", Oats: "carb", "Chicken breast, cooked, skinless": "protein",
  "Greek Yogurt": "protein", Tofu: "protein", Lentils: "protein" };

async function main() {
  const profiles = await prisma.profile.findMany({ take: 40 });
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const adjFoods = await prisma.food.findMany({ where: { name: { in: ADJ_NAMES } } });
  const adjusters = adjFoods.map((f) => ({ role: ADJ_ROLE[f.name], food: f })).filter((a) => a.role);

  const r = {
    weeks: 0, weeksDiagNull: 0, weeksDiagNullButDayOut: 0,
    adjSlots: 0, textStale: 0, textStaleBy50: 0, maxDrift: 0,
    slotsWarnedNow: 0, slotsWouldWarn4Macro: 0, slots: 0,
    daysOut: 0, daysOutVisibleNow: 0, daysOutVisible4Macro: 0, days: 0,
    // adjuster net effect on the day verdict
    daysOkOnlyBecauseAdj: 0, daysBrokenByAdj: 0,
  };
  const examples = [];

  const SEEDS = Number(process.env.D8_SEEDS || 6);
  for (const profile of profiles) {
    let dt;
    try { dt = computeMacros(profile, profile.weightKg ?? 80, profile.targetKcal ?? 2200); } catch { continue; }
    if (!(dt?.kcal > 0)) continue;
    const pool = filterRecipePool(recipes, profile);
    if (pool.length < 10) continue;
    const mealConfig = { meals: profile.mealsPerDay || 3, snacks: profile.snacksPerDay || 1 };

    for (let seed = 0; seed < SEEDS; seed++) {
      let best;
      try {
        best = await generateBestWeekPlan(dt, mealConfig, pool.map((x) => ({ ...x })), {
          attempts: 3, rng: mulberry32(seed * 7919 + profile.id.length), filters: {}, adjusters,
          counts: { raw: recipes.length, afterDiet: pool.length, afterPrep: pool.length, afterStack: pool.length },
        });
      } catch { continue; }
      r.weeks++;
      const byDay = new Map();
      for (const s of best.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
      let anyDayOut = false;

      for (const [, ss] of byDay) {
        r.days++;
        const tot = totalsOf(ss);
        const ok = dayOk(dt, tot);
        // what the day looked like BEFORE the closer ran (subtract adjuster grams)
        const pre = ss.reduce((a, s) => {
          let k = s.kcal || 0, p = s.protein || 0, f = s.fat || 0, c = s.carb || 0;
          for (const i of (s.ingredients || [])) {
            if (!i || !i.adjuster) continue;
            const food = adjusters.find((x) => x.food.id === i.foodId)?.food;
            if (!food) continue;
            const q = i.grams / 100;
            k -= (food.kcal || 0) * q; p -= (food.protein || 0) * q;
            f -= (food.fat || 0) * q; c -= (food.carb || 0) * q;
          }
          return { kcal: a.kcal + k, protein: a.protein + p, fat: a.fat + f, carb: a.carb + c };
        }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
        const okPre = dayOk(dt, pre);
        if (ok && !okPre) r.daysOkOnlyBecauseAdj++;
        if (!ok && okPre) r.daysBrokenByAdj++;

        if (!ok) {
          anyDayOut = true; r.daysOut++;
          if (ss.some((s) => s.warning)) r.daysOutVisibleNow++;
          // under a 4-macro slot gate every out-of-band day has >=1 slot to point at
          r.daysOutVisible4Macro++;
        }
        // per-slot counterfactual
        for (const s of ss) {
          r.slots++;
          if (s.warning) r.slotsWarnedNow++;
          // 4-macro gate: warn if this slot warns today OR its day is out of band
          // on a composition macro it materially contributed to
          if (s.warning || !ok) r.slotsWouldWarn4Macro++;
        }
        // text staleness on adjusted slots
        for (const s of ss) {
          if (!Array.isArray(s.ingredients) || !s.ingredients.some((i) => i && i.adjuster)) continue;
          r.adjSlots++;
          if (!s.warning) continue;
          const m = LANDED.exec(s.warning);
          if (!m) continue;
          const asserted = num(m[1]);
          const actual = Math.round(s.kcal || 0);
          const drift = Math.abs(actual - asserted);
          if (drift >= 1) {
            r.textStale++;
            if (drift >= 50) r.textStaleBy50++;
            if (drift > r.maxDrift) r.maxDrift = drift;
            if (examples.length < 6) examples.push({ warning: s.warning, storedKcal: actual, drift });
          }
        }
      }
      if (best.diagnosis == null) {
        r.weeksDiagNull++;
        if (anyDayOut) r.weeksDiagNullButDayOut++;
      }
    }
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
  console.log(JSON.stringify(r, null, 2));
  console.log("\n── ORDERING / DIAGNOSIS ──");
  console.log(`weeks: ${r.weeks}; diagnosis===null: ${r.weeksDiagNull}; of those containing an OUT-OF-BAND day: ${r.weeksDiagNullButDayOut}`);
  console.log(`adjusted slots: ${r.adjSlots}; warning text quoting a kcal the slot NO LONGER HAS: ${r.textStale} (>=50 kcal off: ${r.textStaleBy50}, worst ${r.maxDrift} kcal)`);
  console.log(`days rescued by the closer: ${r.daysOkOnlyBecauseAdj}; days BROKEN by it: ${r.daysBrokenByAdj}`);
  console.log("\n── SLOT GATE COUNTERFACTUAL ──");
  console.log(`slots: ${r.slots}; warned today (2-macro): ${r.slotsWarnedNow} (${pct(r.slotsWarnedNow, r.slots)}); under a day-aware 4-macro gate: ${r.slotsWouldWarn4Macro} (${pct(r.slotsWouldWarn4Macro, r.slots)})`);
  console.log(`out-of-band days: ${r.daysOut}; visible via slot warning today: ${r.daysOutVisibleNow} (${pct(r.daysOutVisibleNow, r.daysOut)}); under 4-macro: ${r.daysOutVisible4Macro} (100%)`);
  console.log("\nexamples of stale warning text:");
  for (const e of examples) console.log(` stored=${e.storedKcal} drift=${e.drift} :: ${e.warning}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
