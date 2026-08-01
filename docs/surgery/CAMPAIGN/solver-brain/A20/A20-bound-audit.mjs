// A20 — audit of the refusal predicate's soundness argument.
//
// THE PROOF I am relying on (LOOSE), stated so it can be attacked:
//   A day is in band only if kcalOk AND proteinOk (mealSolver.js:256
//   `dayInTolerance = t.kcalOk && t.proteinOk && t.fatOk && t.carbOk`).
//   kcalOk  => total kcal <= target * 1.15   (:244, DAY_KCAL_TOLERANCE_PCT=0.15)
//   proteinOk => total protein >= 0.85 * pMid (:245, DAY_PROTEIN_TOLERANCE_PCT=0.15)
//   Every component contributes protein_i = kcal_i * dens_i, and dens_i is
//   invariant under portion scaling (grams scale both linearly). So
//     protein_total = SUM kcal_i*dens_i <= maxDens * SUM kcal_i <= maxDens * kcalCeiling.
//   If maxDens * kcalCeiling < 0.85*pMid, NO assignment can satisfy both rules.
//   That is a certificate: independent of slots, the 0.5-2.0x clamp, variety,
//   the macro closer, fat and carbs.
//
// THE HOLE I am checking for: the argument needs dens_i finite for every row
// the solver can reach. A row with kcal<=0 and protein>0 has infinite density
// and BREAKS the bound. A3's dens() maps such rows to 0, which would silently
// UNDERSTATE the bound -- the direction that manufactures FALSE REFUSALS.
import fs from "node:fs";
import { createRequire } from "node:module";

const DB = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A20/dev.db";
if (process.env.DATABASE_URL !== DB) { console.error("DATABASE_URL must be the absolute A20 copy"); process.exit(1); }

const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
const { prisma } = require("./src/lib/prisma.js");
const { filterRecipes, RECIPE_GATE_SELECT, isExcluded, FOOD_GATE_SELECT } = require("./src/lib/exclusionGate.js");

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/";
const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const jsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const personas = jsonl(QA + "personas.jsonl");
const results = new Map(jsonl(QA + "results.jsonl").map((r) => [r.id, r]));
const cls = new Map(JSON.parse(fs.readFileSync(SB + "A3/A3-classification.json", "utf8")).map((r) => [r.id, r]));

const [recipes, foods] = await Promise.all([
  prisma.recipe.findMany({ select: RECIPE_GATE_SELECT }),
  prisma.food.findMany({ select: FOOD_GATE_SELECT }),
]);
console.log(`library: ${recipes.length} recipes, ${foods.length} foods`);

// ---- HOLE CHECK 1: infinite-density rows (kcal<=0 but protein>0) -----------
const badRecipes = recipes.filter((r) => !(r.kcal > 0) && r.protein > 0);
const badFoods = foods.filter((f) => !(f.kcalPer100g > 0) && f.proteinPer100g > 0);
console.log(`\nHOLE CHECK 1 infinite-density rows: recipes=${badRecipes.length} foods=${badFoods.length}`);
for (const r of badRecipes.slice(0, 10)) console.log(`  RECIPE ${r.id} "${r.name}" kcal=${r.kcal} protein=${r.protein}`);
for (const f of badFoods.slice(0, 10)) console.log(`  FOOD ${f.id} "${f.name}" kcal=${f.kcalPer100g} protein=${f.proteinPer100g}`);

// ---- HOLE CHECK 2: physically impossible densities (>0.25 g/kcal) ----------
// Pure protein is 4 kcal/g => 0.25 g/kcal is the physical ceiling. Anything
// above it is a bad data row. It INFLATES the bound (safe direction: fewer
// refusals) but it is worth naming.
const dens = (r) => (r.kcal > 0 && r.protein > 0 ? r.protein / r.kcal : 0);
const fdens = (f) => (f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0);
const hotR = recipes.filter((r) => dens(r) > 0.25);
const hotF = foods.filter((f) => fdens(f) > 0.25);
console.log(`\nHOLE CHECK 2 supra-physical density (>0.25 g/kcal): recipes=${hotR.length} foods=${hotF.length}`);
for (const f of hotF.slice(0, 8)) console.log(`  FOOD "${f.name}" ${f.proteinPer100g}g/${f.kcalPer100g}kcal = ${fdens(f).toFixed(3)}`);

// ---- Independent recomputation of LOOSE for every persona ------------------
const KCAL_OVER = 1.15, PROTEIN_SHORT = 0.85;
const rows = [];
for (const p of personas) {
  const res = results.get(p.id);
  const t = res?.target ?? null;
  if (!t || res?.outcome !== "ok") continue;
  const pool = filterRecipes(recipes, p.profile);
  const foodPool = foods.filter((f) => !isExcluded(f, p.profile));
  const maxD = Math.max(0, ...pool.map(dens), ...foodPool.map(fdens));
  const kcalCeiling = t.kcal * KCAL_OVER;
  const floor = PROTEIN_SHORT * ((t.proteinLo + t.proteinHi) / 2);
  const loose = kcalCeiling * maxD;
  const a3 = cls.get(p.id);
  rows.push({
    id: p.id, tier: p.tier, kind: p.impossibleKind ?? null,
    afterDiet: pool.length, recordedAfterDiet: res?.primary?.claims?.poolCounts?.afterDiet ?? null,
    poolMatches: (res?.primary?.claims?.poolCounts?.afterDiet ?? null) === pool.length,
    maxDens: +maxD.toFixed(5), floor: +floor.toFixed(1), loose: +loose.toFixed(1),
    looseProves: loose < floor,
    a3Loose: a3?.looseBound ?? null, a3Scaled: a3?.scaledBound ?? null,
    a3Class: a3?.classification ?? null,
    looseAgrees: a3?.looseBound == null ? null : Math.abs(a3.looseBound - loose) < 0.15,
    days: res?.primary?.mine?.days?.length ?? 0,
    daysInBand: (res?.primary?.mine?.days ?? []).filter((d) => d.inTolerance).length,
  });
}

const poolOk = rows.filter((r) => r.poolMatches).length;
const looseOk = rows.filter((r) => r.looseAgrees).length;
console.log(`\nINSTRUMENT CHECK pool sizes reproduce the fleet's own count: ${poolOk}/${rows.length}`);
console.log(`INSTRUMENT CHECK my LOOSE bound reproduces A3's: ${looseOk}/${rows.length}`);
const mism = rows.filter((r) => r.looseAgrees === false);
for (const m of mism.slice(0, 10)) console.log(`  MISMATCH ${m.id} mine=${m.loose} a3=${m.a3Loose}`);

// ---- The set the two bounds disagree about --------------------------------
const looseProven = rows.filter((r) => r.looseProves);
const scaledOnly = rows.filter((r) => !r.looseProves && r.a3Class === "structurally-impossible");
console.log(`\nLOOSE-proven (certified) personas: ${looseProven.length}, days=${looseProven.reduce((a, b) => a + b.days, 0)}`);
console.log(`SCALED-only personas (proof I cannot certify): ${scaledOnly.length}, days=${scaledOnly.reduce((a, b) => a + b.days, 0)}`);
for (const s of scaledOnly) console.log(`  ${s.id} ${s.tier} floor=${s.floor} loose=${s.loose} scaled=${s.a3Scaled} days=${s.days} inBand=${s.daysInBand}`);

// falsification: any LOOSE-proven persona with an in-band day would kill the proof
const violators = looseProven.filter((r) => r.daysInBand > 0);
console.log(`\nFALSIFICATION any LOOSE-proven persona landing an in-band day: ${violators.length} ${violators.map((v) => v.id).join(",") || "(none)"}`);

fs.writeFileSync(SB + "A20/A20-bound-audit.json", JSON.stringify({
  library: { recipes: recipes.length, foods: foods.length },
  holeCheck: {
    infiniteDensityRecipes: badRecipes.map((r) => ({ id: r.id, name: r.name, kcal: r.kcal, protein: r.protein })),
    infiniteDensityFoods: badFoods.map((f) => ({ id: f.id, name: f.name, kcal: f.kcalPer100g, protein: f.proteinPer100g })),
    supraPhysicalRecipes: hotR.length, supraPhysicalFoods: hotF.map((f) => ({ name: f.name, p: f.proteinPer100g, k: f.kcalPer100g })).slice(0, 40),
  },
  instrumentChecks: { poolMatches: poolOk, looseAgrees: looseOk, n: rows.length },
  looseProven: looseProven.map((r) => r.id), scaledOnly: scaledOnly.map((r) => r.id),
  falsificationViolators: violators.map((v) => v.id),
  rows,
}, null, 2));
console.log("\nwrote A20-bound-audit.json");
await prisma.$disconnect();
