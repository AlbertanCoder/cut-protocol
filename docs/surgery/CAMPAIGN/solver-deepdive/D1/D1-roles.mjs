import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const rec = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
// independent notion of "this ingredient IS the protein": >=40% of its calories
// from protein AND >=10 g protein per 100 g. Nothing to do with the role column.
const isProteinFood = (f) => (f.kcal > 0 ? (f.protein * 4) / f.kcal >= 0.4 : false) && f.protein >= 10;
let rows = 0, protFood = 0, protFoodTaggedProtein = 0, protFoodTaggedOther = 0, protFoodNull = 0;
let nonProtTaggedProtein = 0, taggedProtein = 0;
let recipesWithUntaggedProteinFood = 0, recipesRescuable = 0;
const bad = [];
for (const r of rec) {
  let hasTagged = false, hasUntaggedProt = false;
  for (const i of r.ingredients) {
    rows++;
    const p = isProteinFood(i.food);
    if (i.role === "protein") { taggedProtein++; hasTagged = true; if (!p) nonProtTaggedProtein++; }
    if (p) {
      protFood++;
      if (i.role === "protein") protFoodTaggedProtein++;
      else if (i.role == null) { protFoodNull++; hasUntaggedProt = true; }
      else { protFoodTaggedOther++; hasUntaggedProt = true; if (bad.length < 12) bad.push(`${i.food.name} [role=${i.role}] in "${r.name}"`); }
    }
  }
  if (hasUntaggedProt) recipesWithUntaggedProteinFood++;
  if (!hasTagged && hasUntaggedProt) recipesRescuable++;
}
console.log(JSON.stringify({
  ingredientRows: rows, taggedRoleProtein: taggedProtein,
  proteinDenseFoodRows: protFood,
  proteinDense_taggedProtein: protFoodTaggedProtein,
  proteinDense_taggedSomethingElse: protFoodTaggedOther,
  proteinDense_roleNull: protFoodNull,
  proteinDense_MISFILED_pct: +(100 * (protFoodTaggedOther + protFoodNull) / protFood).toFixed(2),
  taggedProtein_butNotProteinDense: nonProtTaggedProtein,
  falsePositiveTag_pct: +(100 * nonProtTaggedProtein / taggedProtein).toFixed(2),
  recipesWithAProteinFoodNotTaggedProtein: recipesWithUntaggedProteinFood,
  ONE_KNOB_RECIPES_RESCUABLE_BY_TAGGING: recipesRescuable,
  examples: bad,
}, null, 1));
await prisma.$disconnect();
