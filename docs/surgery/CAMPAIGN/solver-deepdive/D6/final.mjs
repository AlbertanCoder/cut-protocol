// D6 — FINAL headroom, allergen + style false positives, across the real
// 259-profile population. Judgement set built by reading rows, not by re-running
// the gate's vocabulary.
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
const recipes = await prisma.recipe.findMany({ select: gate.RECIPE_GATE_SELECT });
const profiles = await prisma.profile.findMany({ select: { dietaryStyle: true, excludedFoods: true } });

// (food name) -> allergen terms it must not fire for
const FALSE_TERM = new Map(Object.entries({
  "Heavy Cream": ["eggs"], "Feta": ["eggs"], "Cream Cheese": ["eggs"], "Cheddar Cheese": ["eggs"],
  "Dulce de leche": ["eggs"], "Salted Butter": ["eggs"], "Gouda Cheese": ["eggs"],
  "Cheese, parmesan, grated": ["eggs"], "Cheese, swiss, low fat": ["eggs"], "Swiss Cheese": ["eggs"],
  "Full fat sour cream": ["eggs"],
  "Shrimp": ["fish"], "Conchs": ["fish"], "Smoked Haddock": ["shellfish"], "Monkfish": ["shellfish"],
  "Fish, tuna, light, canned in water, drained solids": ["shellfish"], "Frogs Legs": ["fish", "shellfish"],
  "Fish Sauce": ["soy"],
  "Cinnamon": ["gluten"], "Peaches": ["gluten"], "Oatmeal": ["gluten"],
  "Lentil pasta, dry": ["gluten"], "Chickpea pasta, dry": ["gluten"], "Rice Noodles": ["gluten"],
  "Brown Rice Noodle": ["gluten"], "Rice Stick Noodles": ["gluten"], "Vermicelli Rice Noodles": ["gluten"],
  "Flat Rice Noodles": ["gluten"], "Rice Flour Pancakes": ["gluten"],
  "Oyster Mushrooms": ["shellfish"], "flax eggs": ["eggs"],
  "Ground Nut Oil": ["tree nuts"], "Grape Nut Cereal": ["tree nuts"],
  "vegan butter": ["dairy"], "soya milk": ["dairy"],
}));
// foods wrongly excluded by a STYLE
const FALSE_STYLE = new Map(Object.entries({
  "Kidney Beans": ["vegan", "vegetarian"], "Oyster Mushrooms": ["vegan", "vegetarian"],
  "flax eggs": ["vegan"], "Beef tomatoes": ["vegan", "vegetarian"],
  "vegan butter": ["vegan"], "soya milk": ["vegan"],
}));
const famOf = (t) => { try { return df.describeExclusionTerms([t])[0]?.synonymKey || String(t).toLowerCase(); } catch { return String(t).toLowerCase(); } };
function exemptTerm(row, term) {
  const list = FALSE_TERM.get(row?.name); if (!list) return false;
  const tf = famOf(term);
  return list.some((l) => famOf(l) === tf) || list.includes(String(term).trim().toLowerCase());
}
function verdictFixed(recipe, p) {
  const style = p.dietaryStyle || "none";
  const ex = Array.isArray(p.excludedFoods) ? p.excludedFoods : [];
  const { rows, gap } = gate.collectEvidence(recipe);
  if (gap) return true;
  if (df.recipeExceedsKetoCeiling(recipe, style)) return true;
  const styleRows = rows.filter((r) => !(FALSE_STYLE.get(r?.name) || []).includes(style));
  if (df.recipeExcludedByStyle({ ingredients: styleRows }, style)) return true;
  for (const term of ex) if (rows.some((r) => !exemptTerm(r, term) && df.foodMatchesExclusionTerm(r, term))) return true;
  return false;
}
const R = recipes.length;
console.log("=== HEADROOM ON NAMED PERSONAS ===");
for (const [label, style, ex] of [
  ["vegan", "vegan", []], ["vegan+gluten", "vegan", ["gluten"]],
  ["vegan+soy+gluten+nuts", "vegan", ["soy", "gluten", "peanuts", "tree nuts", "sesame", "legumes"]],
  ["vegetarian", "vegetarian", []], ["egg allergy", "none", ["eggs"]],
  ["fish allergy", "none", ["fish"]], ["gluten (celiac)", "none", ["gluten"]],
  ["dairy allergy", "none", ["dairy"]], ["soy allergy", "none", ["soy"]],
  ["tree nut allergy", "none", ["tree nuts"]],
]) {
  const p = { dietaryStyle: style, excludedFoods: ex };
  const now = recipes.filter((r) => !gate.explainRecipeExclusion(r, p).excluded).length;
  const fx = recipes.filter((r) => !verdictFixed(r, p)).length;
  console.log(`${label.padEnd(24)} ${String(now).padStart(4)} -> ${String(fx).padStart(4)}  (+${fx - now})  ${(now / R * 100).toFixed(1)}% -> ${(fx / R * 100).toFixed(1)}%`);
}
console.log("\n=== ACROSS THE REAL 259-PROFILE POPULATION ===");
let sn = 0, sf = 0, gained = 0, maxg = 0;
const small = { now: 0, fixed: 0 };
for (const p of profiles) {
  const now = recipes.filter((r) => !gate.explainRecipeExclusion(r, p).excluded).length;
  const fx = recipes.filter((r) => !verdictFixed(r, p)).length;
  sn += now; sf += fx; if (fx > now) gained++; maxg = Math.max(maxg, fx - now);
  if (now < 60) small.now++; if (fx < 60) small.fixed++;
}
const n = profiles.length;
console.log(`mean pool: ${(sn / n).toFixed(1)} (${(sn / n / R * 100).toFixed(1)}%) -> ${(sf / n).toFixed(1)} (${(sf / n / R * 100).toFixed(1)}%)`);
console.log(`total recipe-slots recovered: ${sf - sn} across ${n} profiles`);
console.log(`profiles that gain anything: ${gained}/${n}   max single gain: ${maxg}`);
console.log(`profiles with pool <60 recipes: ${small.now} -> ${small.fixed}`);
await prisma.$disconnect();
