// D6 — read the actual excluded rows. Independent judgement requires reading
// the row, not re-running the gate's vocabulary against it.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const { PrismaClient } = require(path.join(ROOT, "backend/node_modules/@prisma/client"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));
const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D6/dev-copy.db" } },
});

const NAMES = [
  "Oyster Mushrooms", "flax eggs", "Lentil pasta, dry", "Chickpea pasta, dry",
  "Rice Noodles", "Cinnamon", "Peaches", "Oatmeal", "Fish Sauce", "Oyster Sauce",
  "Shrimp", "Smoked Haddock", "Monkfish", "Frogs Legs", "Conchs", "Heavy Cream",
  "Feta", "Cheddar Cheese", "Salted Butter", "Dulce de leche", "Egg Noodles",
  "Tempura Flour", "Worcestershire Sauce", "Chicken Stock Cube", "Coconut Milk",
  "Almond Milk", "Peanut Butter", "Butter Beans", "Cocoa Butter", "Shea Butter",
  "Buckwheat", "Buckwheat Flour", "Corn Tortillas", "Rice Flour", "Coconut Cream",
];
const rows = await prisma.food.findMany({
  where: { name: { in: NAMES } },
  select: { id: true, name: true, category: true, fdcCategory: true, allergenTags: true, mayContain: true, source: true, dataQuality: true, fdcId: true, kcal: true, protein: true, carb: true, fat: true },
});
const TERMS = ["shellfish", "fish", "soy", "dairy", "eggs", "gluten", "peanuts", "tree nuts", "sesame"];
for (const r of rows) {
  const hits = TERMS.filter((t) => df.foodMatchesExclusionTerm(r, t));
  const nameHits = TERMS.filter((t) => df.foodMatchesExclusionTerm({ name: r.name }, t));
  console.log(`\n── ${r.name}`);
  console.log(`   fdcCategory: ${r.fdcCategory ?? "null"} | category: ${r.category} | source: ${r.source} | fdcId: ${r.fdcId ?? "-"}`);
  console.log(`   allergenTags: ${JSON.stringify(r.allergenTags)} | mayContain: ${JSON.stringify(r.mayContain)}`);
  console.log(`   macros/100g: ${r.kcal}kcal P${r.protein} C${r.carb} F${r.fat}`);
  console.log(`   dataQuality: ${String(r.dataQuality ?? "").slice(0, 160)}`);
  console.log(`   EXCLUDED-BY (full row): ${hits.join(", ") || "none"}`);
  console.log(`   EXCLUDED-BY (name only): ${nameHits.join(", ") || "none"}`);
}
// Which recipes do the top offenders take down?
const OFFENDERS = ["Cinnamon", "Lentil pasta, dry", "Chickpea pasta, dry", "Rice Noodles", "flax eggs", "Heavy Cream", "Feta", "Shrimp", "Fish Sauce"];
console.log("\n\n=== RECIPES LOST TO EACH OFFENDER ===");
for (const n of OFFENDERS) {
  const f = rows.find((x) => x.name === n);
  if (!f) continue;
  const rs = await prisma.recipeIngredient.findMany({ where: { foodId: f.id }, select: { recipe: { select: { id: true, name: true } } } });
  const uniq = [...new Map(rs.map((x) => [x.recipe.id, x.recipe.name])).entries()];
  console.log(`\n${n} -> ${uniq.length} recipes: ${uniq.slice(0, 12).map((x) => x[1]).join(" | ")}`);
}
await prisma.$disconnect();
