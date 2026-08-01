// D6 — the gate's cost across the ACTUAL 259-profile test population, and the
// recovery from the judged-false exclusions. This is the right denominator for
// "how much compliance headroom sits in gate precision".
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
const recipes = await prisma.recipe.findMany({ select: gate.RECIPE_GATE_SELECT });
const profiles = await prisma.profile.findMany({ select: { userId: true, dietaryStyle: true, excludedFoods: true } });

const FALSE = new Map(Object.entries({
  "Heavy Cream": ["eggs"], "Feta": ["eggs"], "Cream Cheese": ["eggs"], "Cheddar Cheese": ["eggs"],
  "Dulce de leche": ["eggs"], "Salted Butter": ["eggs"], "Gouda Cheese": ["eggs"],
  "Cheese, parmesan, grated": ["eggs"], "Cheese, swiss, low fat": ["eggs"], "Swiss Cheese": ["eggs"],
  "Full fat sour cream": ["eggs"],
  "Shrimp": ["fish"], "Conchs": ["fish"], "Smoked Haddock": ["shellfish"], "Monkfish": ["shellfish"],
  "Fish, tuna, light, canned in water, drained solids": ["shellfish"], "Frogs Legs": ["fish", "shellfish"],
  "Fish Sauce": ["soy"],
  "Cinnamon": ["gluten"], "Peaches": ["gluten"], "Oatmeal": ["gluten"],
  "Lentil pasta, dry": ["gluten"], "Chickpea pasta, dry": ["gluten"], "Rice Noodles": ["gluten"],
  "Oyster Mushrooms": ["shellfish"], "flax eggs": ["eggs"],
}));
// The judgement set keys on the exclusion FAMILY, so a user who typed "milk"
// or "celiac" gets the same treatment as one who ticked the checkbox.
function exempt(row, term) {
  const list = FALSE.get(row?.name);
  if (!list) return false;
  const t = String(term).trim().toLowerCase();
  if (list.includes(t)) return true;
  const fam = (x) => { try { return df.describeExclusionTerms([x])[0]?.synonymKey || x; } catch { return x; } };
  const tf = fam(t);
  return list.some((l) => fam(l) === tf);
}
function verdictFixed(recipe, p) {
  const style = p.dietaryStyle || "none";
  const ex = Array.isArray(p.excludedFoods) ? p.excludedFoods : [];
  const { rows, gap } = gate.collectEvidence(recipe);
  if (gap) return true;
  if (df.recipeExceedsKetoCeiling(recipe, style)) return true;
  if (df.recipeExcludedByStyle({ ingredients: rows }, style)) return true;
  for (const term of ex) if (rows.some((r) => !exempt(r, term) && df.foodMatchesExclusionTerm(r, term))) return true;
  return false;
}

const R = recipes.length;
const rows = [];
for (const p of profiles) {
  const now = recipes.filter((r) => !gate.explainRecipeExclusion(r, p).excluded).length;
  const fixed = recipes.filter((r) => !verdictFixed(r, p)).length;
  rows.push({ userId: p.userId, style: p.dietaryStyle, ex: p.excludedFoods, now, fixed, gain: fixed - now });
}
rows.sort((a, b) => a.now - b.now);
const sum = (f) => rows.reduce((a, x) => a + f(x), 0);
console.log(`profiles: ${rows.length}   library: ${R} recipes`);
console.log(`mean pool now:   ${(sum((x) => x.now) / rows.length).toFixed(1)} (${(sum((x) => x.now) / rows.length / R * 100).toFixed(1)}%)`);
console.log(`mean pool fixed: ${(sum((x) => x.fixed) / rows.length).toFixed(1)} (${(sum((x) => x.fixed) / rows.length / R * 100).toFixed(1)}%)`);
console.log(`profiles gaining any recipe: ${rows.filter((x) => x.gain > 0).length}`);
console.log(`mean gain among those: ${(sum((x) => x.gain) / Math.max(1, rows.filter((x) => x.gain > 0).length)).toFixed(1)} recipes`);
console.log(`max gain: ${Math.max(...rows.map((x) => x.gain))}`);
for (const t of [20, 40, 60, 80, 100, 150, 200]) {
  console.log(`pools < ${String(t).padStart(3)} recipes:  now ${String(rows.filter((x) => x.now < t).length).padStart(3)}   fixed ${String(rows.filter((x) => x.fixed < t).length).padStart(3)}`);
}
console.log("\n=== 25 MOST-STARVED PROFILES ===");
for (const x of rows.slice(0, 25)) {
  console.log(`${String(x.now).padStart(4)} -> ${String(x.fixed).padStart(4)} (+${x.gain})  style=${x.style || "none"}  ex=${JSON.stringify(x.ex)}`);
}
fs.writeFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/solver-deepdive/D6/population.json"), JSON.stringify(rows, null, 1));
await prisma.$disconnect();
