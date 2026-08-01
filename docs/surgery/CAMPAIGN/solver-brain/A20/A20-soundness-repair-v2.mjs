// A20 — SOUNDNESS REPAIR v2. v1 bounded the macro closer by the whole 14,151-row
// food table and every refusal collapsed. That bound is WRONG in the generous
// direction: the closer cannot reach the food table.
//
// `planContext.js:167-178` ADJUSTER_CANDIDATES is a hardcoded TEN-name list —
// Olive Oil / Butter / Avocado (fat), White rice, cooked / Potatoes / Oats (carb),
// Chicken breast, cooked, skinless / Greek Yogurt / Tofu / Lentils (protein).
// `loadAdjusters()` (:204-215) puts each through `isExcluded(food, profile)`.
// `macroCloser.js:102` confirms: "already diet/allergy-filtered by the caller".
//
// So the honest repaired bound is:
//   SCALED (A3, recipes in slots)  +  what the SURVIVING adjusters can contribute
// with MAX_GRAMS = { fat: 25, carb: 160, protein: 180 } (macroCloser.js:46), and
// maximally generous: every surviving adjuster at its full gram ceiling.
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

// verbatim from planContext.js:167-178
const ADJUSTER_CANDIDATES = [
  { name: "Olive Oil", role: "fat" }, { name: "Butter", role: "fat" }, { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" }, { name: "Potatoes", role: "carb" }, { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" }, { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" }, { name: "Lentils", role: "protein" },
];

const [recipes, adjRows] = await Promise.all([
  prisma.recipe.findMany({ select: RECIPE_GATE_SELECT }),
  prisma.food.findMany({ where: { name: { in: ADJUSTER_CANDIDATES.map((a) => a.name) } }, select: FOOD_GATE_SELECT }),
]);
const byLower = new Map();
for (const f of adjRows) { const k = f.name.trim().toLowerCase(); if (!byLower.has(k)) byLower.set(k, f); }
console.log(`ADJUSTER_CANDIDATES named: ${ADJUSTER_CANDIDATES.length}; rows found in DB: ${byLower.size}`);
for (const c of ADJUSTER_CANDIDATES) {
  const f = byLower.get(c.name.trim().toLowerCase());
  console.log(`  [${c.role}] ${c.name} -> ${f ? `${f.protein}g P / ${f.kcal} kcal per 100 g` : "NOT IN DB"}`);
}

const KCAL_OVER = 1.15, PROTEIN_SHORT = 0.85;
const rows = [];
for (const id of [...REFUSED].sort()) {
  const p = personas.find((x) => x.id === id);
  const c = cls.get(id);
  const t = results.get(id)?.target;
  const floor = PROTEIN_SHORT * ((t.proteinLo + t.proteinHi) / 2);
  const pool = filterRecipes(recipes, p.profile);

  const surviving = [];
  for (const cand of ADJUSTER_CANDIDATES) {
    const f = byLower.get(cand.name.trim().toLowerCase());
    if (!f) continue;
    if (isExcluded(f, p.profile)) continue;
    surviving.push({ role: cand.role, name: f.name, protein: f.protein || 0, kcal: f.kcal || 0 });
  }
  // maximally generous: EVERY surviving adjuster at its full role gram ceiling
  const closerProtein = surviving.reduce((a, s) => a + (MAX_GRAMS[s.role] / 100) * s.protein, 0);
  const proteinRoleSurvivors = surviving.filter((s) => s.role === "protein");
  const bound = c.scaledBound + closerProtein;

  rows.push({
    id, days: results.get(id)?.primary?.mine?.days?.length ?? 0,
    style: p.profile.dietaryStyle ?? null, exclusions: p.profile.exclusions ?? [],
    poolAfterDiet: pool.length, floor: +floor.toFixed(1), scaledA3: c.scaledBound,
    survivingAdjusters: surviving.map((s) => `${s.name}(${s.role})`),
    proteinRoleSurvivors: proteinRoleSurvivors.length,
    closerProteinCeiling: +closerProtein.toFixed(1),
    repairedBound: +bound.toFixed(1), stillProves: bound < floor,
    marginG: +(floor - bound).toFixed(1),
  });
}

console.log("\nid\tdays\tafterDiet\tfloor\tscaledA3\tproteinAdj\tcloserCeil\trepairedBound\tSTILL PROVES\tmargin_g");
for (const r of rows) console.log([r.id, r.days, r.poolAfterDiet, r.floor, r.scaledA3, r.proteinRoleSurvivors,
  r.closerProteinCeiling, r.repairedBound, r.stillProves, r.marginG].join("\t"));

const survive = rows.filter((r) => r.stillProves);
const lost = rows.filter((r) => !r.stillProves);
console.log(`\nREPAIRED SOUND REFUSAL SET: ${survive.length}/16 personas, ${survive.reduce((a, b) => a + b.days, 0)} days`);
console.log(`LOST (bound no longer proves): ${lost.length} personas, ${lost.reduce((a, b) => a + b.days, 0)} days  ${lost.map((r) => r.id).join(",") || "(none)"}`);
if (survive.length) {
  const thin = survive.reduce((a, b) => (b.marginG < a.marginG ? b : a));
  console.log(`thinnest surviving margin: ${thin.marginG} g on ${thin.id} (floor ${thin.floor}, bound ${thin.repairedBound})`);
}
const noProteinAdj = rows.filter((r) => r.proteinRoleSurvivors === 0).length;
console.log(`personas with ZERO surviving protein adjuster: ${noProteinAdj}/16`);
console.log(`distinct surviving adjuster sets: ${JSON.stringify([...new Set(rows.map((r) => r.survivingAdjusters.join("+")))])}`);

fs.writeFileSync(SB + "A20/A20-soundness-repair-v2.json", JSON.stringify({
  maxGrams: MAX_GRAMS, adjusterCandidates: ADJUSTER_CANDIDATES.length, adjusterRowsFound: byLower.size,
  repairedSound: { personas: survive.length, days: survive.reduce((a, b) => a + b.days, 0) },
  lost: { personas: lost.length, days: lost.reduce((a, b) => a + b.days, 0), ids: lost.map((r) => r.id) },
  personasWithNoProteinAdjuster: noProteinAdj, rows,
}, null, 2));
console.log("\nwrote A20-soundness-repair-v2.json");
await prisma.$disconnect();
