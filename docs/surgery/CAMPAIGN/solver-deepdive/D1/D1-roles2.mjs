import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const rec = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
// looser: >=10 g protein / 100 g, no kcal-share condition (admits eggs, salmon, tofu)
const isP = (f) => f.protein >= 10;
let rescuable = 0, noRoleAtAll = 0, withLooseP = 0;
const names = [];
for (const r of rec) {
  const sc = r.ingredients.filter((i) => i.scalable);
  const tagged = sc.filter((i) => i.role === "protein");
  if (tagged.length) continue;
  noRoleAtAll++;
  const cand = sc.filter((i) => isP(i.food));
  if (cand.length) { rescuable++; withLooseP += cand.length; if (names.length < 8) names.push(`${r.name} <- ${cand.map(c=>c.food.name).join(" / ")}`); }
}
console.log(JSON.stringify({
  criterion: ">=10 g protein per 100 g, scalable rows only",
  recipesWithNoScalableProteinRoleIngredient: noRoleAtAll,
  ofThose_haveAnUntaggedProteinSource: rescuable,
  pctRescuable: +(100*rescuable/noRoleAtAll).toFixed(1),
  candidateRows: withLooseP,
  examples: names,
}, null, 1));
await prisma.$disconnect();
