import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LIB = "C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/";
const { PrismaClient } = require("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules/@prisma/client");
const { isExcluded, FOOD_GATE_SELECT } = require(LIB + "exclusionGate.js");
const { macroTrustIssue } = require(LIB + "foodValidation.js");
const prisma = new PrismaClient({ datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3.db" } } });

let t = Date.now();
const ten = await prisma.food.findMany({ where: { name: { in: ["Olive Oil","Butter","Avocado","White rice, cooked","Potatoes","Oats","Chicken breast, cooked, skinless","Greek Yogurt","Tofu","Lentils"] } }, select: FOOD_GATE_SELECT });
console.log(`ten-name \`in\` query (today's loadAdjusterFoods): ${Date.now() - t} ms, ${ten.length} rows`);

t = Date.now();
const all = await prisma.food.findMany({ select: FOOD_GATE_SELECT });
console.log(`full-table findMany (14,151 rows, FOOD_GATE_SELECT): ${Date.now() - t} ms`);

// A candidate numeric prefilter done IN SQL rather than in JS
t = Date.now();
const numeric = await prisma.food.findMany({
  where: { OR: [{ protein: { gte: 25 } }, { fat: { gte: 50 } }, { carb: { gte: 50 } }] },
  select: FOOD_GATE_SELECT,
});
console.log(`SQL numeric prefilter (P>=25 | F>=50 | C>=50): ${Date.now() - t} ms, ${numeric.length} rows`);

const profile = { dietaryStyle: "vegan", excludedFoods: ["soy","legumes","gluten","nuts","sesame"] };
for (const [label, rows] of [["10 rows", ten], ["numeric prefilter", numeric], ["whole table", all]]) {
  t = Date.now();
  let n = 0;
  for (const f of rows) { if (!macroTrustIssue(f) && !isExcluded(f, profile)) n++; }
  console.log(`gate pass over ${label} (${rows.length} rows): ${Date.now() - t} ms -> ${n} survivors`);
}
// repeat the whole-table gate 3x to see warm cost
for (let i = 0; i < 3; i++) {
  t = Date.now();
  let n = 0;
  for (const f of all) { if (!macroTrustIssue(f) && !isExcluded(f, profile)) n++; }
  console.log(`  whole-table gate repeat ${i + 1}: ${Date.now() - t} ms (${n} survivors)`);
}
await prisma.$disconnect();
