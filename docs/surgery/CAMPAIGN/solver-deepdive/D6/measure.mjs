// D6 — gate attrition measurement. READ-ONLY against a COPY of dev.db.
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

const STYLES = ["none", "mediterranean", "vegetarian", "vegan", "paleo", "keto", "carnivore", "halal", "kosher"];
const ALLERGIES = ["shellfish", "fish", "kiwi", "soy", "dairy", "eggs", "gluten", "peanuts", "tree nuts", "sesame"];

const recipes = await prisma.recipe.findMany({ select: gate.RECIPE_GATE_SELECT });
const foods = await prisma.food.findMany({ select: gate.FOOD_GATE_SELECT });
console.log(`LIBRARY: ${recipes.length} recipes, ${foods.length} foods`);

const R = recipes.length, F = foods.length;
const prof = (dietaryStyle, excludedFoods = []) => ({ dietaryStyle, excludedFoods });

function measure(label, p) {
  const { allowed, blocked } = gate.partitionRecipes(recipes, p);
  const foodsLeft = df.applyDietaryFilters(foods, p).length;
  const reasons = {};
  for (const b of blocked) {
    const k = b.reason.startsWith("excluded-food:") ? "excluded-food" : b.reason;
    reasons[k] = (reasons[k] || 0) + 1;
  }
  return {
    label, recipes: allowed.length, recipePct: (allowed.length / R * 100),
    foods: foodsLeft, foodPct: (foodsLeft / F * 100), reasons, allowedIds: allowed.map(r => r.id),
  };
}

const out = { styles: [], allergies: [], combos: [] };
console.log("\n=== PER-STYLE (no allergies) ===");
for (const s of STYLES) {
  const m = measure(s, prof(s));
  out.styles.push(m);
  console.log(`${s.padEnd(15)} recipes ${String(m.recipes).padStart(4)}/${R} (${m.recipePct.toFixed(1)}%)  foods ${String(m.foods).padStart(6)}/${F} (${m.foodPct.toFixed(1)}%)  ${JSON.stringify(m.reasons)}`);
}
console.log("\n=== PER-ALLERGY (style none) ===");
for (const a of ALLERGIES) {
  const m = measure(a, prof("none", [a]));
  out.allergies.push(m);
  console.log(`${a.padEnd(15)} recipes ${String(m.recipes).padStart(4)}/${R} (${m.recipePct.toFixed(1)}%)  foods ${String(m.foods).padStart(6)}/${F} (${m.foodPct.toFixed(1)}%)`);
}
const COMBOS = [
  ["vegan", ["soy"]], ["vegan", ["gluten"]], ["vegetarian", ["tree nuts"]],
  ["vegetarian", ["dairy", "eggs"]], ["keto", ["dairy"]], ["keto", ["tree nuts"]],
  ["paleo", ["eggs"]], ["none", ["dairy", "gluten"]], ["none", ["dairy", "gluten", "soy"]],
  ["halal", ["dairy"]], ["kosher", ["shellfish"]], ["vegan", ["soy", "gluten"]],
  ["vegan", ["tree nuts", "peanuts"]], ["none", ["tree nuts", "peanuts", "sesame"]],
  ["mediterranean", ["fish", "shellfish"]], ["carnivore", ["dairy"]],
];
console.log("\n=== COMBOS ===");
for (const [s, ex] of COMBOS) {
  const m = measure(`${s}+${ex.join("+")}`, prof(s, ex));
  out.combos.push(m);
  console.log(`${m.label.padEnd(28)} recipes ${String(m.recipes).padStart(4)}/${R} (${m.recipePct.toFixed(1)}%)  foods ${String(m.foods).padStart(6)}/${F} (${m.foodPct.toFixed(1)}%)`);
}

const fs = require("node:fs");
fs.writeFileSync(path.join(ROOT, "docs/surgery/CAMPAIGN/solver-deepdive/D6/attrition.json"), JSON.stringify(out, null, 1));
await prisma.$disconnect();
