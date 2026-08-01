// D6 — COMPLETENESS pass. Every food that is (a) excluded and (b) actually used
// in at least one recipe, for the terms/styles not yet read in full. These are
// the only exclusions that can cost the recipe solver anything, so reading all
// of them turns "I sampled and found little" into "I read all of them".
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const { PrismaClient } = require(path.join(ROOT, "backend/node_modules/@prisma/client"));
const gate = require(path.join(ROOT, "backend/src/lib/exclusionGate.js"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));
const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D6/dev-copy.db" } },
});
const foods = await prisma.food.findMany({ select: gate.FOOD_GATE_SELECT });
const ings = await prisma.recipeIngredient.findMany({ select: { foodId: true, recipeId: true } });
const use = new Map(); const seen = new Set();
for (const i of ings) { const k = `${i.foodId}|${i.recipeId}`; if (seen.has(k)) continue; seen.add(k); use.set(i.foodId, (use.get(i.foodId) || 0) + 1); }
const used = foods.filter((f) => use.get(f.id));
console.log(`${used.length} of ${foods.length} foods are used in at least one recipe\n`);

const which = process.argv[2];
if (which === "terms") {
  for (const t of ["dairy", "gluten", "tree nuts", "peanuts", "sesame", "eggs"]) {
    const ex = used.filter((f) => df.foodMatchesExclusionTerm(f, t));
    ex.sort((a, b) => use.get(b.id) - use.get(a.id));
    console.log(`\n########## ${t.toUpperCase()} — ${ex.length} used foods excluded ##########`);
    for (const f of ex) console.log(`${String(use.get(f.id)).padStart(4)}  ${f.name}   [${f.fdcCategory || "-"}]`);
  }
} else {
  for (const s of ["vegan", "vegetarian", "paleo"]) {
    const ex = used.filter((f) => df.applyDietaryFilters([f], { dietaryStyle: s, excludedFoods: [] }).length === 0);
    ex.sort((a, b) => use.get(b.id) - use.get(a.id));
    console.log(`\n########## STYLE ${s.toUpperCase()} — ${ex.length} used foods excluded ##########`);
    for (const f of ex) console.log(`${String(use.get(f.id)).padStart(4)}  ${f.name}   [${f.fdcCategory || "-"}]`);
  }
}
await prisma.$disconnect();
