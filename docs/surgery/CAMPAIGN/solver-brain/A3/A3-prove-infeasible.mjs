// A3 — ceiling audit. Proves (or refutes) structural infeasibility for every
// IMPOSSIBLE-tier persona in qa-fleet-20260729-2032, from the library itself.
//
// METHOD — an LP relaxation that is deliberately MORE generous than the solver:
//   max protein achievable inside the kcal ceiling
//     = kcalCeiling * max(protein_i / kcal_i) over every row that survives the
//       exclusion gate (recipes AND foods — the macro closer can add a food).
//   It ignores slot count, the 0.5-2x scale bounds, variety caps, and the fat
//   and carb rules. Anything the real solver can build, this bound dominates.
//   So bound < proteinFloor is a PROOF of infeasibility, not evidence for it.
//
// Instrument check: the reconstructed afterDiet pool size must equal the size
// the fleet recorded in poolCounts.afterDiet. Mismatch => the tool is wrong.
//
// Read-only. DATABASE_URL must be the absolute A3 copy.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
const { prisma } = require("./src/lib/prisma.js");
const { filterRecipes, RECIPE_GATE_SELECT, isExcluded, FOOD_GATE_SELECT } = require("./src/lib/exclusionGate.js");

const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const OUT = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A3/";

const jsonl = (f) => fs.readFileSync(QA + f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const personas = jsonl("personas.jsonl");
const results = jsonl("results.jsonl");
const byId = new Map(results.map((r) => [r.id, r]));

// Tolerance constants, quoted from mealSolver.dayTolerance():
//   calories within +/-15% of target; protein no more than 15% short of the
//   band midpoint. Both read off the brief's table and the tolerance fn.
const KCAL_OVER = 1.15;
const PROTEIN_SHORT = 0.85;

const [recipes, foods] = await Promise.all([
  prisma.recipe.findMany({ select: RECIPE_GATE_SELECT }),
  prisma.food.findMany({ select: FOOD_GATE_SELECT }),
]);
console.error(`library: ${recipes.length} recipes, ${foods.length} foods`);

const density = (r) => (r.kcal > 0 && r.protein > 0 ? r.protein / r.kcal : 0);

const rowsOut = [];
for (const p of personas) {
  if (p.tier !== "IMPOSSIBLE") continue;
  const res = byId.get(p.id);
  const prof = p.profile;

  const pool = filterRecipes(recipes, prof);
  // Foods surviving the same gate (per-food primitive, as the closer uses).
  const foodPool = foods.filter((f) => !isExcluded(f, prof));

  const recTop = pool.map(density).sort((a, b) => b - a);
  const foodTop = foodPool
    .map((f) => (f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0))
    .sort((a, b) => b - a);
  const maxD = Math.max(recTop[0] ?? 0, foodTop[0] ?? 0);

  const t = res?.target ?? null;
  const reachedPlan = res?.outcome === "ok";
  const days = res?.primary?.mine?.days ?? [];

  let verdict = "NO-PLAN(profile-blocked-400)";
  let bound = null, floor = null, shortfall = null;
  if (t) {
    const kcalCeiling = t.kcal * KCAL_OVER;
    floor = PROTEIN_SHORT * ((t.proteinLo + t.proteinHi) / 2);
    bound = kcalCeiling * maxD;
    shortfall = floor - bound;
    verdict = bound < floor ? "PROVEN-INFEASIBLE" : "NOT-PROVEN(feasible upper bound clears floor)";
  }

  rowsOut.push({
    id: p.id, kind: p.impossibleKind, horizon: p.horizon, outcome: res?.outcome ?? null,
    reachedPlan,
    recordedAfterDiet: res?.primary?.claims?.poolCounts?.afterDiet ?? null,
    recomputedAfterDiet: pool.length,
    poolMatches: (res?.primary?.claims?.poolCounts?.afterDiet ?? null) === pool.length,
    foodPool: foodPool.length,
    targetKcal: t?.kcal ?? null,
    proteinLo: t?.proteinLo ?? null, proteinHi: t?.proteinHi ?? null,
    proteinFloor: floor == null ? null : +floor.toFixed(1),
    maxProteinPerKcal: +maxD.toFixed(5),
    maxProteinAtCeiling: bound == null ? null : +bound.toFixed(1),
    shortfallG: shortfall == null ? null : +shortfall.toFixed(1),
    verdict,
    days: days.length,
    daysInBand: days.filter((d) => d.inTolerance).length,
  });
}

fs.writeFileSync(OUT + "A3-infeasibility.json", JSON.stringify(rowsOut, null, 2));
const hdr = "id\tkind\thorizon\toutcome\tafterDiet_rec\tafterDiet_fleet\tmatch\ttargetKcal\tproteinFloor\tmaxP@ceiling\tshortfallG\tverdict\tdays\tdaysInBand";
const tsv = [hdr, ...rowsOut.map((r) => [r.id, r.kind, r.horizon, r.outcome, r.recomputedAfterDiet, r.recordedAfterDiet, r.poolMatches, r.targetKcal, r.proteinFloor, r.maxProteinAtCeiling, r.shortfallG, r.verdict, r.days, r.daysInBand].join("\t"))].join("\n");
fs.writeFileSync(OUT + "A3-infeasibility.tsv", tsv);
console.log(tsv);

const mism = rowsOut.filter((r) => r.recordedAfterDiet != null && !r.poolMatches);
console.log(`\nINSTRUMENT CHECK: ${rowsOut.filter((r) => r.poolMatches).length}/${rowsOut.filter((r) => r.recordedAfterDiet != null).length} pool sizes reproduce; mismatches: ${mism.map((m) => m.id).join(",") || "none"}`);
await prisma.$disconnect();
