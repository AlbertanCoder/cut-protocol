// A3 — the three-way split over ALL 250 personas / 578 days.
//
// Two bounds, both upper bounds on achievable day protein, both generous:
//
//   LOOSE  = kcalCeiling * max(protein/kcal) over every gate-surviving row.
//            Ignores slots, scale bounds, variety, fat, carbs.
//
//   SCALED = sum over the day's slots of
//              min(2.0 * row.kcal, slotKcalCeiling) * density(row)
//            maximised per slot over rows eligible for that slot type, using
//            the 0.5-2.0x portion clamp the product actually ships
//            (mealSolver: "portion scaling clamped to 0.5-2x"). Still ignores
//            fat, carbs and the variety cap, so it still dominates the solver.
//
// A day is STRUCTURALLY IMPOSSIBLE if SCALED < proteinFloor: no assignment of
// library rows to slots inside the shipped portion clamp can reach the floor.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
const { prisma } = require("./src/lib/prisma.js");
const { filterRecipes, RECIPE_GATE_SELECT, isExcluded, FOOD_GATE_SELECT } = require("./src/lib/exclusionGate.js");

const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const OUT = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A3/";
const jsonl = (f) => fs.readFileSync(QA + f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const personas = jsonl("personas.jsonl");
const byId = new Map(jsonl("results.jsonl").map((r) => [r.id, r]));

const KCAL_OVER = 1.15, PROTEIN_SHORT = 0.85;

const [recipes, foods] = await Promise.all([
  prisma.recipe.findMany({ select: RECIPE_GATE_SELECT }),
  prisma.food.findMany({ select: FOOD_GATE_SELECT }),
]);

const dens = (r) => (r.kcal > 0 && r.protein > 0 ? r.protein / r.kcal : 0);
const MEAL = new Set(["breakfast", "lunch", "dinner", "any", null]);
const isMealEligible = (r) => MEAL.has(r.slotType) || r.slotType === undefined;

const out = [];
for (const p of personas) {
  const res = byId.get(p.id);
  const t = res?.target ?? null;
  const days = res?.primary?.mine?.days ?? [];
  const nSlots = res?.primary?.slotsReturned ?? ((p.profile.mealsPerDay ?? 3) + (p.profile.snacksPerDay ?? 0));

  const pool = filterRecipes(recipes, p.profile);
  const foodPool = foods.filter((f) => !isExcluded(f, p.profile));
  const bestFoodD = Math.max(0, ...foodPool.map((f) => (f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0)));
  const looseD = Math.max(bestFoodD, ...pool.map(dens), 0);

  let looseBound = null, scaledBound = null, floor = null, cls = "no-plan";
  if (t && nSlots > 0) {
    const kcalCeiling = t.kcal * KCAL_OVER;
    floor = PROTEIN_SHORT * ((t.proteinLo + t.proteinHi) / 2);
    looseBound = kcalCeiling * looseD;

    // SCALED: split the ceiling evenly across slots, cap each slot's kcal
    // contribution at 2x the chosen row's own serving.
    const slotCeil = kcalCeiling / nSlots;
    const mealRows = pool.filter(isMealEligible);
    const rows = mealRows.length ? mealRows : pool;
    const bestSlotProtein = Math.max(0, ...rows.map((r) => Math.min(2 * r.kcal, slotCeil) * dens(r)));
    scaledBound = bestSlotProtein * nSlots;

    if (scaledBound < floor) cls = "structurally-impossible";
    else if (looseBound < floor) cls = "structurally-impossible"; // loose is tighter here only if slots misread
    else cls = "reachable";
  }

  out.push({
    id: p.id, tier: p.tier, kind: p.impossibleKind ?? p.robustKind ?? null,
    horizon: p.horizon, outcome: res?.outcome ?? null,
    poolAfterDiet: pool.length, foodPool: foodPool.length, nSlots,
    targetKcal: t?.kcal ?? null,
    proteinFloor: floor == null ? null : +floor.toFixed(1),
    looseBound: looseBound == null ? null : +looseBound.toFixed(1),
    scaledBound: scaledBound == null ? null : +scaledBound.toFixed(1),
    marginG: floor == null ? null : +(scaledBound - floor).toFixed(1),
    classification: cls,
    days: days.length, daysInBand: days.filter((d) => d.inTolerance).length,
  });
}

fs.writeFileSync(OUT + "A3-classification.json", JSON.stringify(out, null, 2));

// ── the three-way split, in DAYS ──────────────────────────────────────────
const split = { "structurally-impossible": { days: 0, inBand: 0, personas: 0 }, "pool-limited": { days: 0, inBand: 0, personas: 0 }, "solver-limited": { days: 0, inBand: 0, personas: 0 } };
const POOL_LIMIT = 60; // "pool-limited" = gate leaves a thin pool but the floor is reachable
for (const r of out) {
  if (!r.days) continue;
  let k;
  if (r.classification === "structurally-impossible") k = "structurally-impossible";
  else if (r.poolAfterDiet < POOL_LIMIT) k = "pool-limited";
  else k = "solver-limited";
  split[k].days += r.days; split[k].inBand += r.daysInBand; split[k].personas++;
}
const tot = Object.values(split).reduce((a, b) => a + b.days, 0);
console.log(JSON.stringify(split, null, 2));
console.log("TOTAL DAYS", tot);
for (const [k, v] of Object.entries(split)) console.log(k.padEnd(26), "days=" + v.days, "inBand=" + v.inBand, "personas=" + v.personas, "rate=" + (v.days ? (v.inBand / v.days).toFixed(3) : "-"));

// which non-IMPOSSIBLE personas are structurally impossible?
const strays = out.filter((r) => r.classification === "structurally-impossible" && r.tier !== "IMPOSSIBLE" && r.days);
console.log("\nSTRUCTURALLY IMPOSSIBLE OUTSIDE THE IMPOSSIBLE TIER:", strays.length, "personas /", strays.reduce((a, b) => a + b.days, 0), "days");
for (const s of strays) console.log(" ", s.id, s.tier, s.kind ?? "", "pool=" + s.poolAfterDiet, "floor=" + s.proteinFloor, "scaled=" + s.scaledBound, "margin=" + s.marginG, "days=" + s.days, "inBand=" + s.daysInBand);

// IMPOSSIBLE-tier personas that are NOT structurally impossible
const soft = out.filter((r) => r.tier === "IMPOSSIBLE" && r.classification !== "structurally-impossible" && r.days);
console.log("\nIMPOSSIBLE-TIER BUT NOT PROVEN IMPOSSIBLE:", soft.length, "personas /", soft.reduce((a, b) => a + b.days, 0), "days,", soft.reduce((a, b) => a + b.daysInBand, 0), "of them IN BAND");
for (const s of soft) console.log(" ", s.id, s.kind, "pool=" + s.poolAfterDiet, "floor=" + s.proteinFloor, "scaled=" + s.scaledBound, "margin=" + s.marginG, "days=" + s.days, "inBand=" + s.daysInBand);

await prisma.$disconnect();
