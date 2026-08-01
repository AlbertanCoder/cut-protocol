// A16-concentrate.mjs — rig treatment: A7's concentrate FOOD row, priced.
//
// A7 measured that `nutritional yeast`, `rice protein`, `potato protein` and
// `hemp protein` have ZERO rows in the 14,151-food library although all survive
// every wall in the killer allergen stack. This treatment simulates adding ONE
// of them.
//
// THE COMPOSITION IS CITED, NOT INVENTED (integrity rule 5):
//   Nutritional yeast, per 15 g serving: 60 kcal, 8 g protein, 0.5 g fat,
//   5 g carbohydrate, 3 g fibre. Source: "Nutritional yeast", Wikipedia, 2026,
//   nutrition table attributed to Bob's Red Mill manufacturer-reported values
//   citing USDA FoodData Central #1946780.
//   https://en.wikipedia.org/wiki/Nutritional_yeast
//   CAVEAT carried from A7 and re-confirmed here: the direct FDC food-details
//   URL returns HTTP 404 to a fetcher, so FDC ID 1946780 is itself UNVERIFIED.
//   Per-100 g values below are DERIVED by x(100/15) and shown in the constant.
//
// TWO MECHANISMS, because a Food row on its own does nothing. The solver picks
// RECIPES; a Food row reaches a plan only via a recipe ingredient or via the
// macro closer's adjuster list, which is a hardcoded 10-name array at
// planContext.js:167-178.
//
//   A16_CONC_MODE=adjuster  one line added to ADJUSTER_CANDIDATES. The cheapest
//                           possible intervention. NOTE macroCloser.js:46 caps
//                           protein adjusters at MAX_GRAMS.protein = 180 g,
//                           per ROLE not per FOOD — 180 g of yeast flakes is not
//                           a portion. The treatment records the grams actually
//                           placed so the implausibility is measured, not argued.
//   A16_CONC_MODE=recipes   A16_CONC_N authored recipes using the row, with the
//                           concentrate held to <= MAX_CONC_G grams, which is
//                           the plausible version.
//   A16_CONC_MODE=both
//
// Nothing in backend/src is modified. The DB is never written — the row exists
// only in memory, and is registered into the rig's own foodById map so the
// independent re-derivation from raw Food rows still covers it (drift must
// stay 0, which is the check that this row's arithmetic is real).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const require = createRequire(import.meta.url);
const planCtx = require(path.join(REPO, "backend/src/lib/planContext.js"));
const solver = require(path.join(REPO, "backend/src/lib/mealSolver.js"));
const gate = require(path.join(REPO, "backend/src/lib/exclusionGate.js"));
const foodVal = require(path.join(REPO, "backend/src/lib/foodValidation.js"));

const MODE = String(process.env.A16_CONC_MODE || "adjuster");
const NREC = Number(process.env.A16_CONC_N ?? 8);
const MAX_CONC_G = Number(process.env.A16_CONC_MAXG ?? 30);

export const NAME = `A16-concentrate-${MODE}-N${MODE === "adjuster" ? 0 : NREC}`;

// per 100 g, DERIVED from the cited 15 g serving by x(100/15)
export const NUTRITIONAL_YEAST = {
  id: "A16-food-nutritional-yeast",
  name: "Nutritional Yeast",
  category: "pantry",
  kcal: 400, protein: 53.333, fat: 3.333, carb: 33.333, fiber: 20,
  source: "LABEL",
  dataQuality: "A16 SIMULATED ROW — Wikipedia 2026 nutrition table (Bob's Red Mill, cites USDA FDC #1946780, FDC id itself unverified)",
  fdcId: null, fdcCategory: null, allergenTags: null, mayContain: null,
};

const cat = JSON.parse(fs.readFileSync(path.join(HERE, "A16-catalogue-v2.json"), "utf8")).catalogue;

// Harvest real vegan-safe bases/vegs already vetted by the catalogue builder.
const veganFoods = new Map();
for (const r of cat.vegan || []) for (const ing of r.ingredients) if (!veganFoods.has(ing.foodId)) veganFoods.set(ing.foodId, { food: ing.food, role: ing.role });
const bases = [...veganFoods.values()].filter((x) => x.role === "carb").map((x) => x.food);
const vegs = [...veganFoods.values()].filter((x) => x.role === "veg").map((x) => x.food);

// gate + trust probes on the simulated row, reported rather than assumed
export const PROBE = {
  macroTrustIssue: foodVal.macroTrustIssue(NUTRITIONAL_YEAST) || null,
  excludedForVegan: gate.isExcluded(NUTRITIONAL_YEAST, { dietaryStyle: "vegan", excludedFoods: [] }),
  excludedForKillerStack: gate.isExcluded(NUTRITIONAL_YEAST, { dietaryStyle: "vegan", excludedFoods: ["soy", "gluten", "peanuts", "tree nuts", "sesame", "legumes"] }),
};

function buildRecipes(k) {
  const tgt = { p: 7.47, f: 2.32, c: 11.02 };   // vegan target centroid, A16-catalogue-v2 measured
  const dist = (p, f, c) => Math.sqrt(4 * (p - tgt.p) ** 2 + (f - tgt.f) ** 2 + 0.5 * (c - tgt.c) ** 2);
  const CG = [10, 15, 20, 25, 30].filter((g) => g <= MAX_CONC_G);
  const BG = [0, 30, 60, 90, 120, 150, 200];
  const VG = [0, 100];
  const cands = [];
  for (const b of bases) for (const v of vegs) {
    if (b.id === v.id) continue;
    for (const band of [["meal", 380, 750], ["snack", 140, 330]]) {
      let best = null;
      for (const cg of CG) for (const bg of BG) for (const vg of VG) {
        const kcal = (NUTRITIONAL_YEAST.kcal * cg + b.kcal * bg + v.kcal * vg) / 100;
        if (kcal < band[1] || kcal > band[2]) continue;
        const P = (NUTRITIONAL_YEAST.protein * cg + b.protein * bg + v.protein * vg) / 100;
        const F = (NUTRITIONAL_YEAST.fat * cg + b.fat * bg + v.fat * vg) / 100;
        const C = (NUTRITIONAL_YEAST.carb * cg + b.carb * bg + v.carb * vg) / 100;
        const d = dist((P / kcal) * 100, (F / kcal) * 100, (C / kcal) * 100);
        if (!best || d < best.d) best = { d, cg, bg, vg, kcal, P, F, C, slotType: band[0] };
      }
      if (best) cands.push({ b, v, ...best });
    }
  }
  cands.sort((x, y) => x.d - y.d || x.b.name.localeCompare(y.b.name));
  const perBase = new Map(); const out = [];
  for (const c of cands) {
    if (out.length >= k) break;
    if ((perBase.get(c.b.id) || 0) >= 2) continue;
    perBase.set(c.b.id, (perBase.get(c.b.id) || 0) + 1);
    const i = out.length;
    const ings = [
      { foodId: NUTRITIONAL_YEAST.id, baseGrams: c.cg, role: "protein", food: NUTRITIONAL_YEAST },
      c.bg > 0 ? { foodId: c.b.id, baseGrams: c.bg, role: "carb", food: c.b } : null,
      c.vg > 0 ? { foodId: c.v.id, baseGrams: c.vg, role: "veg", food: c.v } : null,
    ].filter(Boolean).map((x, j) => ({ id: `A16-conc-${i}-i${j}`, recipeId: `A16-conc-${i}`, scalable: true, ...x }));
    out.push({
      id: `A16-conc-${i}`,
      name: `Nutritional Yeast with ${[c.bg > 0 ? c.b.name : null, c.vg > 0 ? c.v.name : null].filter(Boolean).join(" and ")} [A16 conc #${i}]`,
      description: null, steps: [], slotType: c.slotType, cuisine: null, prepTimeMin: 15,
      source: "curated", mealCategory: null,
      kcal: c.kcal, protein: c.P, fat: c.F, carb: c.C,
      tasteTier: null, tasteTierSource: null, userRatingAvg: null, userRatingCount: null,
      costPerServing: null, difficulty: null, filterProvenance: null,
      aiFingerprint: null, aiVerifiedAt: null, createdAt: new Date(0).toISOString(), createdByUserId: null,
      ingredients: ings,
      _a16: { concGrams: c.cg, pDen: (c.P / c.kcal) * 100, fDen: (c.F / c.kcal) * 100 },
    });
  }
  return out;
}

const CONC_RECIPES = MODE === "adjuster" ? [] : buildRecipes(NREC);
let dumped = false;

export function applyTreatment({ customer, pool, filters, adjusters, foodById }) {
  // the simulated row must be visible to the rig's INDEPENDENT re-derivation
  if (foodById && !foodById.has(NUTRITIONAL_YEAST.id)) foodById.set(NUTRITIONAL_YEAST.id, NUTRITIONAL_YEAST);
  if (!dumped) {
    dumped = true;
    fs.writeFileSync(path.join(HERE, `A16-concentrate-${MODE}-manifest.json`), JSON.stringify({
      mode: MODE, maxConcGrams: MAX_CONC_G, probe: PROBE, food: NUTRITIONAL_YEAST,
      recipes: CONC_RECIPES.map((r) => ({ id: r.id, name: r.name, slotType: r.slotType, concGrams: r._a16.concGrams, kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb, pDen: r._a16.pDen })),
    }, null, 2));
  }

  const patch = {};
  if (MODE === "adjuster" || MODE === "both") {
    // the product's own gates, exactly as planContext.loadAdjusters applies them
    if (!foodVal.macroTrustIssue(NUTRITIONAL_YEAST) && !gate.isExcluded(NUTRITIONAL_YEAST, customer.profile)) {
      patch.adjusters = adjusters.concat([{ role: "protein", food: NUTRITIONAL_YEAST }]);
    }
  }
  if ((MODE === "recipes" || MODE === "both") && CONC_RECIPES.length) {
    const admitted = planCtx.filterRecipePool(CONC_RECIPES, customer.dietProfile);
    patch.pool = pool.concat(solver.applyPrepFilter(admitted, filters?.maxPrepMin ?? undefined));
  }
  return patch;
}
