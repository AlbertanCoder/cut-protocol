// W1-5 — F8 (gate attrition), F9 (keto is supply not filtering), F10 (cache drift).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const { filterRecipePool } = require("../../../backend/src/lib/planContext.js");
const { RECIPE_GATE_SELECT, explainRecipeExclusion } = require("../../../backend/src/lib/exclusionGate.js");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const df = require("../../../backend/src/lib/dietaryFilter.js");
const prisma = new PrismaClient();
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(4); };

const main = async () => {
  const rows = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  const T = JSON.parse(fs.readFileSync("fleet/out/W1-5/targets.json", "utf8")).personas;

  // ── F8: what the gate actually removes, per persona ─────────────────────
  const sizes = [];
  for (const t of T) {
    const pool = filterRecipePool(rows, { dietaryStyle: t.dietaryStyle, excludedFoods: t.excludedFoods });
    sizes.push({ id: t.id, diet: t.dietaryStyle, pool: pool.length, removedPct: +(((rows.length - pool.length) / rows.length) * 100).toFixed(2) });
  }
  const F8 = {
    library: rows.length,
    meanPool: +(sizes.reduce((a, s) => a + s.pool, 0) / sizes.length).toFixed(1),
    medianPool: q(sizes.map((s) => s.pool), 0.5),
    meanRemovedPct: +(sizes.reduce((a, s) => a + s.removedPct, 0) / sizes.length).toFixed(2),
    medianRemovedPct: q(sizes.map((s) => s.removedPct), 0.5),
    smallestPools: sizes.sort((a, b) => a.pool - b.pool).slice(0, 12),
  };

  // ── F9: keto exclusion reasons ──────────────────────────────────────────
  const ketoProfile = { dietaryStyle: "keto", excludedFoods: [] };
  const ketoPool = filterRecipePool(rows, ketoProfile);
  const ketoOut = rows.filter((r) => !ketoPool.some((p) => p.id === r.id));
  let byCeiling = 0, byStyle = 0, byBoth = 0, byOther = 0;
  const reasons = {};
  for (const r of ketoOut) {
    const ceil = df.recipeExceedsKetoCeiling({ carb: r.carb, kcal: r.kcal }, "keto");
    const style = df.recipeExcludedByStyle(r, "keto");
    if (ceil && style) byBoth++; else if (ceil) byCeiling++; else if (style) byStyle++; else byOther++;
    const e = explainRecipeExclusion(r, ketoProfile);
    const k = e?.reason ?? "unknown"; reasons[k] = (reasons[k] || 0) + 1;
  }
  const ketoMeal = ketoPool.filter((r) => (r.slotType === "meal" || r.slotType === "either") && !NON_MEAL_CATEGORIES.has(r.mealCategory));
  // keto personas' fat band, as a fat DENSITY window
  const ketoPersonas = T.filter((t) => t.dietaryStyle === "keto");
  const fatDensLo = ketoPersonas.map((t) => (t.fatLo / t.targetKcal) * 100);
  const fatDensHi = ketoPersonas.map((t) => (t.fatHi / t.targetKcal) * 100);
  const loMed = q(fatDensLo, 0.5), hiMed = q(fatDensHi, 0.5);
  const clears = ketoMeal.filter((r) => r.kcal > 0 && (r.fat / r.kcal) * 100 >= loMed && (r.fat / r.kcal) * 100 <= hiMed);
  const F9 = {
    ketoPool: ketoPool.length, ketoSurvivalPct: +((ketoPool.length / rows.length) * 100).toFixed(2),
    ketoExcluded: ketoOut.length,
    excludedByCarbCeilingOnly: byCeiling, excludedByStyleOnly: byStyle, excludedByBoth: byBoth, excludedByOther: byOther,
    carbCeilingShareOfExclusions: +(((byCeiling + byBoth) / ketoOut.length) * 100).toFixed(2),
    reasons,
    ketoMealEligible: ketoMeal.length,
    ketoPersonas: ketoPersonas.length,
    ketoFatBandDensity_medianLo: loMed, ketoFatBandDensity_medianHi: hiMed,
    ketoMealClearingFatBand: clears.length,
    ketoMealClearingFatBandNames: clears.map((r) => r.name),
    ketoMealFatDensity_median: q(ketoMeal.filter((r) => r.kcal > 0).map((r) => (r.fat / r.kcal) * 100), 0.5),
  };

  // ── F10: recipe cache drift ─────────────────────────────────────────────
  const full = await prisma.recipe.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, ingredients: { select: { baseGrams: true, food: { select: { kcal: true, protein: true, fat: true, carb: true } } } } } });
  const drifts = [];
  for (const r of full) {
    const t = r.ingredients.reduce((s, i) => { const f = i.baseGrams / 100; if (!i.food) return s; s.kcal += i.food.kcal * f; s.protein += i.food.protein * f; s.fat += i.food.fat * f; s.carb += i.food.carb * f; return s; }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
    const d = (a, b) => (b > 0 ? Math.abs(a - b) / b * 100 : a > 0 ? 100 : 0);
    drifts.push({ name: r.name, kcalDriftPct: +d(t.kcal, r.kcal).toFixed(4), proteinDriftPct: +d(t.protein, r.protein).toFixed(4), storedKcal: +r.kcal.toFixed(1), computedKcal: +t.kcal.toFixed(1) });
  }
  const F10 = {
    recipes: drifts.length,
    worstKcalDriftPct: Math.max(...drifts.map((d) => d.kcalDriftPct)),
    medianKcalDriftPct: q(drifts.map((d) => d.kcalDriftPct), 0.5),
    p99KcalDriftPct: q(drifts.map((d) => d.kcalDriftPct), 0.99),
    over1pct: drifts.filter((d) => d.kcalDriftPct > 1).length,
    worst5: drifts.sort((a, b) => b.kcalDriftPct - a.kcalDriftPct).slice(0, 5),
  };

  fs.writeFileSync("fleet/out/W1-5/f8f9f10.json", JSON.stringify({ F8, F9, F10, poolSizes: sizes }, null, 2));
  console.log(JSON.stringify({ F8, F9, F10 }, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
