// W1-5 A/B/C — pool census per diet through the REAL production filter path.
// Read-only. No network. Usage: BRAIN=off node fleet/out/W1-5/census.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "backend/src/lib/x.js"));
const { PrismaClient } = require("@prisma/client");
const { filterRecipePool } = require("../../../backend/src/lib/planContext.js");
const { RECIPE_GATE_SELECT } = require("../../../backend/src/lib/exclusionGate.js");
const { NON_MEAL_CATEGORIES } = require("../../../backend/src/lib/recipeClassification.js");
const { DIETARY_STYLES, KETO_RECIPE_CARB_CEILING_G } = require("../../../backend/src/lib/dietaryFilter.js");

const OUT = "fleet/out/W1-5";
const prisma = new PrismaClient();

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(3);
};

// slotAttemptBudget verbatim from weeklyPlanner.js:102-105
const MIN_SLOT_ATTEMPTS = 5, MAX_SLOT_ATTEMPTS = 20;
const slotAttemptBudget = (n0) => {
  const n = Number.isFinite(n0) ? n0 : 0;
  return Math.max(MIN_SLOT_ATTEMPTS, Math.min(MAX_SLOT_ATTEMPTS, Math.floor(n / 10)));
};
// eligibleRecipes verbatim from weeklyPlanner.js:183-187 (usageCount empty)
const eligible = (pool, slotType) =>
  pool.filter((r) => (r.slotType === slotType || r.slotType === "either")
    && (slotType !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory)));

const isGeneratedTemplate = (r) => r.source === "ai-generated" && /^high-protein\b.*\bwith\b/i.test(r.name || "");

const dens = (rs, k) => rs.filter((r) => r.kcal > 0).map((r) => (r[k] / r.kcal) * 100);

const main = async () => {
  const rows = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  console.error(`library rows: ${rows.length}`);

  // ---- F3: whole-library slot placeability -------------------------------
  const slotTypeCounts = {};
  for (const r of rows) slotTypeCounts[r.slotType ?? "(null)"] = (slotTypeCounts[r.slotType ?? "(null)"] || 0) + 1;
  const catCounts = {};
  for (const r of rows) catCounts[r.mealCategory ?? "(null)"] = (catCounts[r.mealCategory ?? "(null)"] || 0) + 1;

  const placeableInMeal = (r) => (r.slotType === "meal" || r.slotType === "either") && !NON_MEAL_CATEGORIES.has(r.mealCategory);
  const placeableInSnack = (r) => r.slotType === "snack" || r.slotType === "either";
  const noSlot = rows.filter((r) => !placeableInMeal(r) && !placeableInSnack(r));
  const barredByCategory = rows.filter((r) => NON_MEAL_CATEGORIES.has(r.mealCategory));

  const f3 = {
    library: rows.length,
    slotTypeCounts, mealCategoryCounts: catCounts,
    barredByNonMealCategory: barredByCategory.length,
    placeableInNoSlot: noSlot.length,
    placeableInNoSlotPct: +((noSlot.length / rows.length) * 100).toFixed(2),
    mealEligibleWholeLibrary: rows.filter(placeableInMeal).length,
    snackEligibleWholeLibrary: rows.filter(placeableInSnack).length,
    noSlotBreakdown: Object.entries(noSlot.reduce((m, r) => {
      const k = `${r.slotType}/${r.mealCategory}`; m[k] = (m[k] || 0) + 1; return m;
    }, {})).sort((a, b) => b[1] - a[1]),
  };

  // ---- A: per-diet census -------------------------------------------------
  const census = [];
  const perDiet = {};
  for (const style of DIETARY_STYLES) {
    const profile = { dietaryStyle: style === "none" ? null : style, excludedFoods: [] };
    const pool = filterRecipePool(rows, profile);
    const meal = eligible(pool, "meal");
    const snack = eligible(pool, "snack");
    const pd = dens(meal, "protein");
    const fd = dens(meal, "fat");
    const snackPd = dens(snack, "protein");
    const snackFd = dens(snack, "fat");
    const row = {
      style,
      survivors: pool.length,
      survivalPct: +((pool.length / rows.length) * 100).toFixed(1),
      mealEligible: meal.length,
      snackEligible: snack.length,
      unplaceable: pool.filter((r) => !placeableInMeal(r) && !placeableInSnack(r)).length,
      // g protein per 100 kcal, meal-eligible
      p25: q(pd, 0.25), p50: q(pd, 0.5), p75: q(pd, 0.75), p90: q(pd, 0.9),
      fatP50: q(fd, 0.5),
      snackP50: q(snackPd, 0.5), snackFatP50: q(snackFd, 0.5),
      snackAttemptBudget: slotAttemptBudget(pool.length),
      mealAttemptBudget: slotAttemptBudget(pool.length),
      templatesInMeal: meal.filter(isGeneratedTemplate).length,
    };
    census.push(row);
    perDiet[style] = {
      poolIds: pool.map((r) => r.id),
      snack: snack.map((r) => ({ id: r.id, name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb, slotType: r.slotType, mealCategory: r.mealCategory, source: r.source })),
      meal: meal.map((r) => ({ id: r.id, name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb, source: r.source })),
    };
  }

  // ---- B: snack starvation -----------------------------------------------
  const snackLib = rows.filter(placeableInSnack);
  const snackF6 = {
    snackEligibleWholeLibrary: snackLib.length,
    bySlotType: snackLib.reduce((m, r) => { m[r.slotType] = (m[r.slotType] || 0) + 1; return m; }, {}),
    rows: snackLib.map((r) => ({
      id: r.id, name: r.name, slotType: r.slotType, mealCategory: r.mealCategory, source: r.source,
      kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb,
      pDens: r.kcal > 0 ? +((r.protein / r.kcal) * 100).toFixed(2) : null,
      fDens: r.kcal > 0 ? +((r.fat / r.kcal) * 100).toFixed(2) : null,
      cDens: r.kcal > 0 ? +((r.carb / r.kcal) * 100).toFixed(2) : null,
    })).sort((a, b) => (b.pDens ?? 0) - (a.pDens ?? 0)),
    perDietSnack: census.map((c) => ({ style: c.style, snackEligible: c.snackEligible, attemptBudget: c.snackAttemptBudget, exhaustive: c.snackAttemptBudget >= c.snackEligible })),
  };

  // ---- D: F6 template densities -------------------------------------------
  const templates = rows.filter(isGeneratedTemplate);
  const rest = rows.filter((r) => !isGeneratedTemplate(r));
  const mean = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) : null);
  const f6 = {
    templateCount: templates.length,
    templateMealEligible: templates.filter(placeableInMeal).length,
    templateSnackEligible: templates.filter(placeableInSnack).length,
    template_pDens_mean: mean(dens(templates, "protein")),
    template_pDens_median: q(dens(templates, "protein"), 0.5),
    template_fDens_mean: mean(dens(templates, "fat")),
    template_fDens_median: q(dens(templates, "fat"), 0.5),
    rest_pDens_mean: mean(dens(rest, "protein")),
    rest_pDens_median: q(dens(rest, "protein"), 0.5),
    rest_fDens_mean: mean(dens(rest, "fat")),
    rest_fDens_median: q(dens(rest, "fat"), 0.5),
    weight: 0.35,
  };
  // "high-protein-lean" per diet: pDens >= 8.16 AND fDens <= 2.60 (brief's target box)
  const TARGET_P = 8.16, TARGET_F = 2.60;
  f6.targetBoxPerDiet = [];
  for (const style of DIETARY_STYLES) {
    const profile = { dietaryStyle: style === "none" ? null : style, excludedFoods: [] };
    const pool = filterRecipePool(rows, profile);
    const meal = eligible(pool, "meal");
    const box = meal.filter((r) => r.kcal > 0 && (r.protein / r.kcal) * 100 >= TARGET_P && (r.fat / r.kcal) * 100 <= TARGET_F);
    // draw-mass: sum of the `real` multiplier over meal pool vs target-box share
    const wAll = meal.reduce((s, r) => s + (isGeneratedTemplate(r) ? 0.35 : 1), 0);
    const wBox = box.reduce((s, r) => s + (isGeneratedTemplate(r) ? 0.35 : 1), 0);
    const wAll1 = meal.length;
    const wBox1 = box.length;
    f6.targetBoxPerDiet.push({
      style, mealPool: meal.length,
      inTargetBox: box.length,
      inTargetBoxTemplates: box.filter(isGeneratedTemplate).length,
      inTargetBoxReal: box.filter((r) => !isGeneratedTemplate(r)).length,
      drawMassPct_withWeight: +((wBox / wAll) * 100).toFixed(2),
      drawMassPct_noWeight: +((wBox1 / wAll1) * 100).toFixed(2),
    });
  }

  // ---- F12: recipes that can never serve any slot at 0.5-2x ---------------
  // Recorded raw here; slot-target feasibility computed in feasibility.mjs
  const extreme = rows.filter((r) => r.kcal > 3000 || (r.kcal > 0 && r.kcal < 60) || r.kcal <= 0)
    .map((r) => ({ id: r.id, name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb, slotType: r.slotType, mealCategory: r.mealCategory }));

  fs.writeFileSync(`${OUT}/census.json`, JSON.stringify({
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    libraryRows: rows.length, f3, census, snackF6, f6, extremeRecipes: extreme,
    ketoCeiling: KETO_RECIPE_CARB_CEILING_G,
  }, null, 2));
  fs.writeFileSync(`${OUT}/per-diet-pools.json`, JSON.stringify(perDiet));

  console.log("=== F3 ===");
  console.log(JSON.stringify(f3, null, 1));
  console.log("=== CENSUS ===");
  console.table(census);
  console.log("=== SNACK ===");
  console.log(JSON.stringify(snackF6.perDietSnack, null, 1));
  console.log("snack rows:", snackF6.snackEligibleWholeLibrary, JSON.stringify(snackF6.bySlotType));
  console.log("=== F6 ===");
  console.log(JSON.stringify(f6, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
