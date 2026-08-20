// seedRebuildCandidates.mjs — the deterministic gate between proposed recipe
// candidates (data/rebuildCandidates.mjs) and the pool.
//
//   DATABASE_URL=file:./rebuild-qa.db node scripts/seedRebuildCandidates.mjs           # dry run
//   DATABASE_URL=file:./rebuild-qa.db node scripts/seedRebuildCandidates.mjs --write   # persist survivors
//
// A candidate is admitted only when ALL of:
//   1. every ingredient resolves to a Food row by exact name
//   2. every resolved food passes an energy-consistency screen (the seeded
//      pool carries rows wearing another food's macros — cod-liver oil on
//      "Salmon", 0-kcal almonds; referencing one poisons the recipe)
//   3. nutritionCore totals certify (ok: true)
//   4. recipeSanityGate passes (150-1,400 kcal/serving, protein ≤ 100 g, grams)
//   5. the REAL exclusion gate admits it for every audience it claims to
//      serve (vegan_gf / keto / carnivore / p0 / p2 / open)
// Rejections are printed with reasons — a gate that only says "no" teaches
// the proposer nothing. Default is a DRY RUN; --write persists.

import { createRequire } from "node:module";
import { NEW_FOODS, CANDIDATES } from "../data/rebuildCandidates.mjs";

const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/prisma.js");
const { macroTotals, atwaterApproxKcal } = require("../src/lib/nutritionCore.js");
const { sanityCheckRecipe } = require("../src/lib/recipeSanityGate.js");
const { filterRecipes, explainRecipeExclusion } = require("../src/lib/exclusionGate.js");

const WRITE = process.argv.includes("--write");

const AUDIENCE_PROFILES = {
  vegan_gf: { dietaryStyle: "vegan", excludedFoods: ["gluten"] },
  keto: { dietaryStyle: "keto", excludedFoods: [] },
  carnivore: { dietaryStyle: "carnivore", excludedFoods: [] },
  p0: { dietaryStyle: null, excludedFoods: ["shellfish", "gluten", "kiwi", "soy"] },
  p2: { dietaryStyle: null, excludedFoods: ["soy", "wheat"] },
  open: { dietaryStyle: null, excludedFoods: [] },
};

// A food's stored energy must be consistent with its own macros. Fiber makes
// real foods read LOW vs 4/4/9 (fiber-adjusted Atwater), so the floor is
// generous; the ceiling catches oil-macros-on-a-vegetable shapes.
function foodEnergyConsistent(f) {
  const approx = atwaterApproxKcal(f.protein, f.fat, f.carb);
  if (approx < 15) return f.kcal < 60; // water/broth shapes
  const ratio = f.kcal / approx;
  return ratio >= 0.55 && ratio <= 1.6;
}

// ── upsert the new label-sourced foods first (dry run: verify only) ───────
const foodByName = new Map();
for (const f of NEW_FOODS) {
  if (!foodEnergyConsistent(f)) throw new Error(`NEW_FOODS ${f.name} fails its own energy consistency check`);
  if (WRITE) {
    const existing = await prisma.food.findFirst({ where: { name: f.name } });
    const row = existing
      ? await prisma.food.update({ where: { id: existing.id }, data: f })
      : await prisma.food.create({ data: f });
    foodByName.set(f.name, row);
  } else {
    foodByName.set(f.name, { id: `dry-${f.name}`, ...f });
  }
}

async function resolveFood(name) {
  if (foodByName.has(name)) return foodByName.get(name);
  const row = await prisma.food.findFirst({ where: { name } });
  if (row) foodByName.set(name, row);
  return row;
}

const admitted = [];
const rejected = [];

for (const c of CANDIDATES) {
  const reasons = [];
  const resolved = [];
  for (const ing of c.ingredients) {
    const food = await resolveFood(ing.foodName);
    if (!food) { reasons.push(`unresolved: "${ing.foodName}"`); continue; }
    if (!foodEnergyConsistent(food)) {
      reasons.push(`corrupt-energy food refused: "${ing.foodName}" (${food.kcal} kcal vs macros ${Math.round(atwaterApproxKcal(food.protein, food.fat, food.carb))})`);
      continue;
    }
    resolved.push({ ...ing, food });
  }
  if (reasons.length) { rejected.push({ name: c.name, reasons }); continue; }

  const foodsById = new Map(resolved.map((r) => [r.food.id, r.food]));
  const { ok, totals } = macroTotals(resolved.map((r) => ({ foodId: r.food.id, grams: r.baseGrams })), foodsById);
  if (!ok) { rejected.push({ name: c.name, reasons: ["macroTotals uncertifiable"] }); continue; }

  const sanity = sanityCheckRecipe(
    { name: c.name, ingredients: resolved.map((r) => ({ name: r.foodName, grams: r.baseGrams, foodId: r.food.id })) },
    { totals, foodsById }
  );
  if (!sanity.ok) {
    rejected.push({ name: c.name, reasons: sanity.issues.filter((i) => i.severity === "fail").map((i) => i.message) });
    continue;
  }

  // Shape the candidate the way the gate loads recipes, and assert admission
  // for every audience it claims.
  const gateShape = {
    name: c.name, steps: c.steps, slotType: c.slotType, cuisine: c.cuisine,
    source: "ai-generated", mealCategory: null, dataQuality: null,
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, carb: totals.carb,
    ingredients: resolved.map((r) => ({ baseGrams: r.baseGrams, foodId: r.food.id, food: r.food })),
  };
  const audienceFailures = [];
  for (const key of c.audience) {
    const profile = AUDIENCE_PROFILES[key];
    if (!profile) { audienceFailures.push(`unknown audience "${key}"`); continue; }
    const kept = filterRecipes([gateShape], profile);
    if (kept.length !== 1) {
      const why = explainRecipeExclusion(gateShape, profile);
      audienceFailures.push(`real gate refuses it for audience "${key}": ${JSON.stringify(why?.reason ?? why)}`);
    }
  }
  if (audienceFailures.length) { rejected.push({ name: c.name, reasons: audienceFailures }); continue; }

  admitted.push({ ...c, totals, resolved });
}

console.log(`\n${WRITE ? "WRITE" : "DRY RUN"} — candidates ${CANDIDATES.length} · admitted ${admitted.length} · rejected ${rejected.length}\n`);
for (const r of rejected) console.log(`✖ ${r.name}\n    ${r.reasons.join("\n    ")}`);

if (WRITE) {
  for (const c of admitted) {
    const t = c.totals;
    const data = {
      name: c.name, description: null, steps: c.steps, slotType: c.slotType,
      cuisine: c.cuisine, prepTimeMin: c.prepTimeMin, source: "ai-generated", mealCategory: null,
      kcal: t.kcal, protein: t.protein, fat: t.fat, carb: t.carb,
    };
    const recipe = await prisma.recipe.upsert({ where: { name: c.name }, update: data, create: data });
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    for (const r of c.resolved) {
      await prisma.recipeIngredient.create({
        data: { recipeId: recipe.id, foodId: r.food.id, baseGrams: r.baseGrams, scalable: r.scalable ?? true, role: r.role ?? null },
      });
    }
  }
  console.log(`\nPersisted ${admitted.length} recipes (source "ai-generated").`);
}

await prisma.$disconnect();
