// D6 — evidence-tier attribution. For every excluded recipe, find the WEAKEST
// evidence tier that still fires. Tier 1 = a real ingredient Food row (strong).
// Tier 2 = "Add'l ingredients:" prose. Tier 3 = the recipe TITLE. Tier 4 = the
// whole step-text blob (weakest — a multi-KB string treated as a food name).
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

// Rebuild the gate's evidence set, but TAGGED by tier, so we can ask which
// tier each exclusion actually rests on. Mirrors exclusionGate.collectEvidence.
function tieredRows(recipe) {
  const t1 = [], t2 = [], t3 = [], t4 = [];
  for (const ing of recipe.ingredients || []) {
    const food = ing?.food ?? null;
    const name = food?.name ?? ing?.name;
    if (typeof name !== "string" || !name.trim()) return null;
    t1.push(food || { name });
  }
  for (const extra of df.additionalIngredientNames(recipe.steps)) t2.push({ name: extra });
  if (typeof recipe.name === "string" && recipe.name.trim()) t3.push({ name: recipe.name });
  const stepText = Array.isArray(recipe.steps) ? recipe.steps.join("  ") : (recipe.steps == null ? "" : String(recipe.steps));
  if (stepText.trim()) t4.push({ name: stepText });
  return { t1, t2, t3, t4 };
}

const ALLERGIES = ["shellfish", "fish", "kiwi", "soy", "dairy", "eggs", "gluten", "peanuts", "tree nuts", "sesame"];
const STYLES = ["mediterranean", "vegetarian", "vegan", "paleo", "carnivore", "halal", "kosher"];

function firstFiringTier(recipe, test) {
  const t = tieredRows(recipe);
  if (!t) return "shape-gap";
  if (t.t1.some(test)) return 1;
  if (t.t2.some(test)) return 2;
  if (t.t3.some(test)) return 3;
  if (t.t4.some(test)) return 4;
  return null;
}

const report = { allergies: {}, styles: {} };
console.log("=== ALLERGY EXCLUSIONS BY WEAKEST FIRING EVIDENCE TIER ===");
console.log("term            total   T1-ingr  T2-prose  T3-title  T4-steps");
for (const a of ALLERGIES) {
  const test = (row) => df.foodMatchesExclusionTerm(row, a);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  for (const r of recipes) {
    if (!gate.explainRecipeExclusion(r, { dietaryStyle: "none", excludedFoods: [a] }).excluded) continue;
    const tier = firstFiringTier(r, test);
    if (tier && tier !== "shape-gap") { counts[tier]++; byTier[tier].push({ id: r.id, name: r.name }); }
  }
  const tot = counts[1] + counts[2] + counts[3] + counts[4];
  report.allergies[a] = { counts, byTier };
  console.log(`${a.padEnd(15)} ${String(tot).padStart(4)}   ${String(counts[1]).padStart(6)}  ${String(counts[2]).padStart(7)}  ${String(counts[3]).padStart(7)}  ${String(counts[4]).padStart(7)}`);
}

console.log("\n=== STYLE EXCLUSIONS BY WEAKEST FIRING EVIDENCE TIER ===");
console.log("style           total   T1-ingr  T2-prose  T3-title  T4-steps");
for (const s of STYLES) {
  const test = (row) => df.recipeExcludedByStyle({ ingredients: [row] }, s);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  for (const r of recipes) {
    const v = gate.explainRecipeExclusion(r, { dietaryStyle: s, excludedFoods: [] });
    if (!v.excluded || v.reason !== "dietary-style") continue;
    const tier = firstFiringTier(r, test);
    if (tier && tier !== "shape-gap") { counts[tier]++; byTier[tier].push({ id: r.id, name: r.name }); }
  }
  const tot = counts[1] + counts[2] + counts[3] + counts[4];
  report.styles[s] = { counts, byTier };
  console.log(`${s.padEnd(15)} ${String(tot).padStart(4)}   ${String(counts[1]).padStart(6)}  ${String(counts[2]).padStart(7)}  ${String(counts[3]).padStart(7)}  ${String(counts[4]).padStart(7)}`);
}

fs.writeFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/solver-deepdive/D6/tiers.json"), JSON.stringify(report, null, 1));
await prisma.$disconnect();
