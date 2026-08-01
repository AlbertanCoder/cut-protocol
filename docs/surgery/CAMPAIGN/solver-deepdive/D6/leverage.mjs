// D6 — which EXCLUDED foods cost the solver the most recipes? Ranks each
// gate-excluded Food by the number of recipes that use it as an ingredient, so
// the highest-leverage candidates can be READ and judged independently.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const { PrismaClient } = require(path.join(ROOT, "backend/node_modules/@prisma/client"));
const gate = require(path.join(ROOT, "backend/src/lib/exclusionGate.js"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));
const fs = require("node:fs");

const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D6/dev-copy.db" } },
});
const foods = await prisma.food.findMany({ select: gate.FOOD_GATE_SELECT });
const ings = await prisma.recipeIngredient.findMany({ select: { foodId: true, recipeId: true } });

// recipe-count per foodId (distinct recipes)
const useCount = new Map();
const seen = new Set();
for (const i of ings) {
  const k = `${i.foodId}|${i.recipeId}`;
  if (seen.has(k)) continue;
  seen.add(k);
  useCount.set(i.foodId, (useCount.get(i.foodId) || 0) + 1);
}

const ALLERGIES = ["shellfish", "fish", "kiwi", "soy", "dairy", "eggs", "gluten", "peanuts", "tree nuts", "sesame"];
const STYLES = ["vegetarian", "vegan", "paleo", "halal", "kosher", "mediterranean"];
const out = {};

for (const a of ALLERGIES) {
  const excluded = foods.filter((f) => df.foodMatchesExclusionTerm(f, a));
  const used = excluded.filter((f) => useCount.get(f.id));
  used.sort((x, y) => (useCount.get(y.id) || 0) - (useCount.get(x.id) || 0));
  out[a] = {
    excludedFoods: excluded.length,
    usedInRecipes: used.length,
    top: used.slice(0, 60).map((f) => ({ id: f.id, name: f.name, recipes: useCount.get(f.id), cat: f.fdcCategory, tags: f.allergenTags })),
    allNamesIfSmall: excluded.length <= 400 ? excluded.map((f) => f.name) : null,
  };
  console.log(`\n### ${a}: ${excluded.length} foods excluded, ${used.length} of them used in recipes`);
  for (const f of used.slice(0, 25)) console.log(`   ${String(useCount.get(f.id)).padStart(4)} recipes  [${f.id}] ${f.name}   {cat:${f.fdcCategory || "-"}} {tags:${JSON.stringify(f.allergenTags) || "-"}}`);
}

for (const s of STYLES) {
  const excluded = foods.filter((f) => df.applyDietaryFilters([f], { dietaryStyle: s, excludedFoods: [] }).length === 0);
  const used = excluded.filter((f) => useCount.get(f.id));
  used.sort((x, y) => (useCount.get(y.id) || 0) - (useCount.get(x.id) || 0));
  out["style:" + s] = {
    excludedFoods: excluded.length, usedInRecipes: used.length,
    top: used.slice(0, 60).map((f) => ({ id: f.id, name: f.name, recipes: useCount.get(f.id), cat: f.fdcCategory })),
  };
  console.log(`\n### STYLE ${s}: ${excluded.length} foods excluded, ${used.length} used in recipes`);
  for (const f of used.slice(0, 20)) console.log(`   ${String(useCount.get(f.id)).padStart(4)} recipes  [${f.id}] ${f.name}   {cat:${f.fdcCategory || "-"}}`);
}

fs.writeFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/solver-deepdive/D6/leverage.json"), JSON.stringify(out, null, 1));
await prisma.$disconnect();
