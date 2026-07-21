// Stage 6 (K) fix — seed the high-protein-density foods the protein-forward
// recipes need (the simulation showed veg/vegan days couldn't hit protein).
// Idempotent: skips any that already exist. All pass Atwater 4/4/9 within 15%.
//   node scripts/seedHighProteinFoods.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");

const FOODS = [
  { name: "Seitan", category: "protein", kcal: 120, protein: 25, fat: 2, carb: 4, fiber: 1 },
  { name: "Textured vegetable protein, dry", category: "protein", kcal: 330, protein: 52, fat: 1, carb: 30, fiber: 18 },
  { name: "Edamame, shelled, cooked", category: "fruit-veg", kcal: 121, protein: 12, fat: 5, carb: 9, fiber: 5 },
  { name: "Pea protein powder", category: "protein", kcal: 375, protein: 80, fat: 5, carb: 5, fiber: 3 },
  { name: "Lentil pasta, dry", category: "grains", kcal: 350, protein: 25, fat: 2, carb: 55, fiber: 11 },
  { name: "Chickpea pasta, dry", category: "grains", kcal: 340, protein: 20, fat: 5, carb: 55, fiber: 8 },
];

let added = 0;
for (const f of FOODS) {
  const at = 4 * f.protein + 4 * f.carb + 9 * f.fat;
  if (Math.abs(f.kcal - at) > 0.15 * Math.max(f.kcal, at)) { console.log(`SKIP ${f.name} — atwater ${f.kcal} vs ${at}`); continue; }
  if (await prisma.food.findUnique({ where: { name: f.name } })) { console.log(`exists: ${f.name}`); continue; }
  await prisma.food.create({ data: { ...f, source: "manual" } });
  console.log(`added: ${f.name} (${f.protein}gP/${f.kcal}kcal)`);
  added++;
}
console.log(`+${added} foods`);
await prisma.$disconnect();
