// D6 — probe attribution. Which of the four probes actually fired for each
// excluded food? Isolates the rows excluded ONLY by the coarse fdc-category
// probe (dietaryFilter.js:1585) — the paired-category over-match — and measures
// what the solver would get back if the pair were disambiguated by name.
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
const useCount = new Map(); const seen = new Set();
for (const i of ings) { const k = `${i.foodId}|${i.recipeId}`; if (seen.has(k)) continue; seen.add(k); useCount.set(i.foodId, (useCount.get(i.foodId) || 0) + 1); }

const ALLERGIES = ["shellfish", "fish", "kiwi", "soy", "dairy", "eggs", "gluten", "peanuts", "tree nuts", "sesame"];
const out = {};
console.log("=== FOODS EXCLUDED BY THE fdc-category PROBE ALONE (no name/tag evidence) ===");
console.log("These are the rows the coarse USDA shelf label removes on its own.\n");
for (const a of ALLERGIES) {
  const catOnly = [];
  for (const f of foods) {
    const ev = df.exclusionEvidence ? null : null;
    // exclusionEvidence is not exported; reconstruct by differencing name-only
    // vs object-aware, which isolates metadata-driven exclusions exactly.
    const objExcluded = df.foodMatchesExclusionTerm(f, a);
    if (!objExcluded) continue;
    const nameExcluded = df.foodMatchesExclusionTerm({ name: f.name }, a);
    if (nameExcluded) continue; // name evidence exists -> not category-only
    const noCat = df.foodMatchesExclusionTerm({ name: f.name, allergenTags: f.allergenTags, mayContain: f.mayContain }, a);
    if (noCat) continue; // tags carried it -> a real declaration, keep
    catOnly.push(f);
  }
  const used = catOnly.filter((f) => useCount.get(f.id));
  used.sort((x, y) => (useCount.get(y.id) || 0) - (useCount.get(x.id) || 0));
  out[a] = { count: catOnly.length, used: used.map((f) => ({ id: f.id, name: f.name, cat: f.fdcCategory, recipes: useCount.get(f.id) })) };
  console.log(`## ${a}: ${catOnly.length} foods excluded by category alone; ${used.length} used in recipes`);
  for (const f of used.slice(0, 30)) console.log(`     ${String(useCount.get(f.id)).padStart(3)} recipes  ${f.name}   [${f.fdcCategory}]`);
  console.log("");
}
fs.writeFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/solver-deepdive/D6/probes.json"), JSON.stringify(out, null, 1));
await prisma.$disconnect();
