// W1-5 B7 — is the SHORTLIST binding, or the POOL? Exhaustive best composition
// distance over the whole eligible pool for every real meal slot the fleet builds.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const wp = require("../../../backend/src/lib/weeklyPlanner.js");
const { filterRecipePool } = require("../../../backend/src/lib/planContext.js");
const { RECIPE_GATE_SELECT } = require("../../../backend/src/lib/exclusionGate.js");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const prisma = new PrismaClient();
const GOOD_ENOUGH = 0.05;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(4); };

const main = async () => {
  const rows = await prisma.recipe.findMany({
    select: { ...RECIPE_GATE_SELECT, ingredients: { select: { foodId: true, baseGrams: true, scalable: true, role: true, food: { select: { name: true, kcal: true, protein: true, fat: true, carb: true } } } } },
  });
  const T = JSON.parse(fs.readFileSync("fleet/out/W1-5/targets.json", "utf8")).personas;
  const personas = fs.readFileSync("docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  const byId = new Map(T.map((t) => [t.id, t]));
  const poolCache = new Map();
  const poolFor = (style, ex) => { const k = JSON.stringify([style, [...ex].sort()]); if (!poolCache.has(k)) poolCache.set(k, filterRecipePool(rows, { dietaryStyle: style, excludedFoods: ex })); return poolCache.get(k); };

  const results = [];
  for (const p of personas) {
    const t = byId.get(p.id); if (!t) continue;
    const pool = poolFor(t.dietaryStyle, t.excludedFoods);
    const meal = pool.filter((r) => (r.slotType === "meal" || r.slotType === "either") && !NON_MEAL_CATEGORIES.has(r.mealCategory));
    if (!meal.length) { results.push({ id: p.id, slotType: "meal", pool: 0, best: null }); continue; }
    const m = p.profile.mealsPerDay, s = p.profile.snacksPerDay;
    const ws = []; for (let i = 0; i < m; i++) ws.push({ type: "meal", w: m === 1 ? 1 : i === m - 1 ? 1.15 : i === 0 ? 0.9 : 1 });
    for (let i = 0; i < s; i++) ws.push({ type: "snack", w: 0.4 });
    const tot = ws.reduce((a, b) => a + b.w, 0);
    const pMid = t.pMid, fMid = (t.fatLo + t.fatHi) / 2, cMid = t.carbMid;
    for (const w of ws.filter((x) => x.type === "meal")) {
      const share = w.w / tot;
      const target = { slotType: "meal", kcalTarget: t.targetKcal * share, proteinTarget: pMid * share,
        fatShare: fMid * share, carbShare: cMid * share, fatTarget: fMid * share, carbTarget: cMid * share };
      let best = Infinity, bestGated = Infinity;
      for (const r of meal) {
        const sc = wp.scaleRecipe(r, target.kcalTarget, target.proteinTarget);
        if (!sc) continue;
        const d = wp.compositionDistance(target, sc);
        if (d < best) best = d;
        // gated: also has to pass the kcal/protein accept gate
        const kOff = Math.abs(sc.kcal - target.kcalTarget) / target.kcalTarget * 100;
        const pShort = Math.max(0, (target.proteinTarget - sc.protein) / target.proteinTarget) * 100;
        if (kOff <= wp.KCAL_TOLERANCE_PCT && pShort <= wp.PROTEIN_TOLERANCE_PCT && d < bestGated) bestGated = d;
      }
      results.push({ id: p.id, diet: t.dietaryStyle, pool: meal.length, best: Number.isFinite(best) ? +best.toFixed(4) : null, bestGated: Number.isFinite(bestGated) ? +bestGated.toFixed(4) : null });
    }
  }
  const withBest = results.filter((r) => r.best != null);
  const withGated = results.filter((r) => r.bestGated != null);
  const out = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    mealSlotsEvaluated: results.length,
    slotsWithAnyScalableCandidate: withBest.length,
    // EXHAUSTIVE search of the whole pool, not the 5-20 the solver draws
    exhaustive_slotsWithinGoodEnough: withBest.filter((r) => r.best <= GOOD_ENOUGH).length,
    exhaustive_pctWithinGoodEnough: +((withBest.filter((r) => r.best <= GOOD_ENOUGH).length / withBest.length) * 100).toFixed(2),
    exhaustive_bestDistance_median: q(withBest.map((r) => r.best), 0.5),
    exhaustive_bestDistance_p25: q(withBest.map((r) => r.best), 0.25),
    exhaustive_bestDistance_p75: q(withBest.map((r) => r.best), 0.75),
    gated_slotsWithAnyGatePassingCandidate: withGated.length,
    gated_slotsWithinGoodEnough: withGated.filter((r) => r.bestGated <= GOOD_ENOUGH).length,
    gated_pctOfAllSlots: +((withGated.filter((r) => r.bestGated <= GOOD_ENOUGH).length / results.length) * 100).toFixed(2),
    gated_bestDistance_median: q(withGated.map((r) => r.bestGated), 0.5),
  };
  fs.writeFileSync("fleet/out/W1-5/b7-shortlist.json", JSON.stringify({ ...out, results }, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
