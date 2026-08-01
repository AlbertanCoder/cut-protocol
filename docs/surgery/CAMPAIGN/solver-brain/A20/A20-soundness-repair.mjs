// A20 — SOUNDNESS REPAIR. The refusal predicate rests on A3's bound. I found a
// dead term in it and this re-derives the refusal set with the term alive.
//
// THE DEFECT. `A3-classify-all.mjs:50` and `A3-prove-infeasible.mjs:57` compute
// the food side of the bound as
//     f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0
// The Prisma `Food` model has no such columns. FOOD_GATE_SELECT returns
// id,name,category,kcal,protein,fat,carb,fiber,... — per 100 g. Every food row
// therefore evaluates to density 0 and `bestFoodD` is 0 for all 250 personas.
// My own A20-bound-audit.mjs copied the same field names, so its "212/212
// agrees with A3" was agreement on a SHARED BUG, not corroboration.
//
// DIRECTION OF THE ERROR: it UNDERSTATES the achievable protein, so it makes the
// predicate refuse MORE. That is the false-refusal direction — the one thing this
// assignment cannot tolerate. Hence this repair.
//
// SCOPE: A3's operative SCALED bound (line 62-65) is over `pool.filter(isMealEligible)`
// — recipes only, by construction, not by the bug. The bug hits LOOSE only. But the
// macro closer CAN add a food, so the honest bound is SCALED + the closer's ceiling.
// macroCloser.js:46 `const MAX_GRAMS = { fat: 25, carb: 160, protein: 180 };`
import fs from "node:fs";
import { createRequire } from "node:module";

const DB = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A20/dev.db";
if (process.env.DATABASE_URL !== DB) { console.error("DATABASE_URL must be the absolute A20 copy"); process.exit(1); }

const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
const { prisma } = require("./src/lib/prisma.js");
const { filterRecipes, RECIPE_GATE_SELECT, isExcluded, FOOD_GATE_SELECT } = require("./src/lib/exclusionGate.js");
const { MAX_GRAMS } = require("./src/lib/macroCloser.js");

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/";
const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const jsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const personas = jsonl(QA + "personas.jsonl");
const results = new Map(jsonl(QA + "results.jsonl").map((r) => [r.id, r]));
const cls = new Map(JSON.parse(fs.readFileSync(SB + "A3/A3-classification.json", "utf8")).map((r) => [r.id, r]));
const evalJ = JSON.parse(fs.readFileSync(SB + "A20/A20-predicate-eval.json", "utf8"));
const REFUSED = new Set(evalJ.evals.find((e) => e.pred === "P4_scaledBound").trIds);

const [recipes, foods] = await Promise.all([
  prisma.recipe.findMany({ select: RECIPE_GATE_SELECT }),
  prisma.food.findMany({ select: FOOD_GATE_SELECT }),
]);
console.log(`library: ${recipes.length} recipes, ${foods.length} foods`);
console.log(`macroCloser MAX_GRAMS = ${JSON.stringify(MAX_GRAMS)}`);

// PROOF THE TERM IS DEAD: A3's own expression, over the whole table.
const a3FoodD = Math.max(0, ...foods.map((f) => (f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0)));
const realFoodD = Math.max(0, ...foods.map((f) => (f.kcal > 0 && f.protein > 0 ? f.protein / f.kcal : 0)));
console.log(`\nA3's food-density expression over all ${foods.length} rows: max = ${a3FoodD}   (dead term)`);
console.log(`same expression with the REAL column names:            max = ${realFoodD.toFixed(4)} g/kcal`);
const topAll = foods.filter((f) => f.kcal > 0 && f.protein > 0).map((f) => ({ n: f.name, d: f.protein / f.kcal, p: f.protein }))
  .sort((a, b) => b.d - a.d).slice(0, 3);
topAll.forEach((x) => console.log(`   top row: ${x.d.toFixed(4)} g/kcal  ${x.n}`));

const KCAL_OVER = 1.15, PROTEIN_SHORT = 0.85;
const rows = [];
for (const id of [...REFUSED].sort()) {
  const p = personas.find((x) => x.id === id);
  const c = cls.get(id);
  const t = results.get(id)?.target;
  const pool = filterRecipes(recipes, p.profile);
  const foodPool = foods.filter((f) => !isExcluded(f, p.profile));
  const kcalCeiling = t.kcal * KCAL_OVER;
  const floor = PROTEIN_SHORT * ((t.proteinLo + t.proteinHi) / 2);

  // repaired LOOSE: best density over recipes AND foods, real columns
  const bestFoodD = Math.max(0, ...foodPool.filter((f) => f.kcal > 0 && f.protein > 0).map((f) => f.protein / f.kcal));
  const bestRecD = Math.max(0, ...pool.filter((r) => r.kcal > 0 && r.protein > 0).map((r) => r.protein / r.kcal));
  const looseFixed = kcalCeiling * Math.max(bestFoodD, bestRecD);

  // repaired SCALED: A3's recipe-only slot bound PLUS what the macro closer could add.
  // Closer ceiling = MAX_GRAMS.protein grams of the highest-protein-per-100g surviving
  // food. Generous variant allows all three gap roles to draw the same food.
  const bestP100 = Math.max(0, ...foodPool.map((f) => f.protein || 0));
  const bestP100Name = foodPool.reduce((a, f) => ((f.protein || 0) > (a?.protein || 0) ? f : a), null)?.name ?? null;
  const closer1 = (MAX_GRAMS.protein / 100) * bestP100;
  const closer3 = ((MAX_GRAMS.protein + MAX_GRAMS.carb + MAX_GRAMS.fat) / 100) * bestP100;
  const scaled = c.scaledBound;

  rows.push({
    id, style: p.profile.dietaryStyle ?? null, days: results.get(id)?.primary?.mine?.days?.length ?? 0,
    floor: +floor.toFixed(1), scaledA3: scaled, looseA3: c.looseBound,
    bestRecD: +bestRecD.toFixed(4), bestFoodD: +bestFoodD.toFixed(4),
    looseFixed: +looseFixed.toFixed(1), looseFixedProves: looseFixed < floor,
    bestFoodProteinPer100g: bestP100, bestFoodName: bestP100Name,
    closer1: +closer1.toFixed(1), closer3: +closer3.toFixed(1),
    scaledPlusCloser1: +(scaled + closer1).toFixed(1), scaledPlusCloser3: +(scaled + closer3).toFixed(1),
    stillProvesCloser1: scaled + closer1 < floor, stillProvesCloser3: scaled + closer3 < floor,
    marginCloser3: +(floor - (scaled + closer3)).toFixed(1),
  });
}

console.log("\nid\tdays\tfloor\tscaledA3\tbestFoodD\tlooseFIXED\tlooseProves\tbestP/100g\tcloser3\tscaled+closer3\tSTILL PROVES");
for (const r of rows) console.log([r.id, r.days, r.floor, r.scaledA3, r.bestFoodD, r.looseFixed, r.looseFixedProves,
  r.bestFoodProteinPer100g, r.closer3, r.scaledPlusCloser3, r.stillProvesCloser3].join("\t"));

const survive1 = rows.filter((r) => r.stillProvesCloser1);
const survive3 = rows.filter((r) => r.stillProvesCloser3);
const looseStill = rows.filter((r) => r.looseFixedProves);
console.log(`\nREPAIRED LOOSE still proves: ${looseStill.length}/16 personas (was 14/16 with the dead term)`);
console.log(`REPAIRED SCALED + 1 closer addition still proves: ${survive1.length}/16 personas, ${survive1.reduce((a, b) => a + b.days, 0)} days`);
console.log(`REPAIRED SCALED + 3 closer additions still proves:  ${survive3.length}/16 personas, ${survive3.reduce((a, b) => a + b.days, 0)} days`);
console.log(`LOST (no longer provable) under the 3-addition bound: ${rows.filter(r=>!r.stillProvesCloser3).map(r=>r.id).join(",") || "(none)"}`);
console.log(`thinnest surviving margin: ${Math.min(...survive3.map((r) => r.marginCloser3)).toFixed(1)} g on ${survive3.reduce((a,b)=>b.marginCloser3<a.marginCloser3?b:a).id}`);
console.log(`best food protein/100g seen in these pools: ${Math.max(...rows.map(r=>r.bestFoodProteinPer100g))} (${rows.reduce((a,b)=>b.bestFoodProteinPer100g>a.bestFoodProteinPer100g?b:a).bestFoodName})`);

fs.writeFileSync(SB + "A20/A20-soundness-repair.json", JSON.stringify({
  defect: { a3FoodDensityExpressionMax: a3FoodD, realFoodDensityMax: realFoodD, topFoodRows: topAll,
    files: ["A3/A3-classify-all.mjs:50", "A3/A3-prove-infeasible.mjs:57", "A20/A20-bound-audit.mjs:54"] },
  maxGrams: MAX_GRAMS,
  repaired: { loosePersonas: looseStill.length, scaledCloser1Personas: survive1.length,
    scaledCloser1Days: survive1.reduce((a, b) => a + b.days, 0),
    scaledCloser3Personas: survive3.length, scaledCloser3Days: survive3.reduce((a, b) => a + b.days, 0) },
  rows,
}, null, 2));
console.log("\nwrote A20-soundness-repair.json");
await prisma.$disconnect();
