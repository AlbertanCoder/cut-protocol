// Additive import of recomp-v2's recipe/food library into cut-protocol's DB.
// Idempotent (upsert by name), same convention as seedRecipes.js — re-running
// this never touches the 27 hand-curated recipes or anything AI-generated,
// since those live under different names. Ported from a project that is
// being deleted after this data is safely landed here (see
// docs/MERGE_AUDIT_2026-07-12.md and the archived zip in Desktop/_archive/).
//
// Source data has no servings field concept here — cut-protocol's Recipe
// model caches PER-SERVING macros at scale=1 (no `servings` field at all,
// confirmed against schema.prisma). recomp-v2's recipes are multi-serving
// dishes (`servings` field, e.g. 4), so every ingredient gram amount and
// every macro total gets divided by `servings` here to land as a single
// serving, matching cut-protocol's own convention exactly.
import "dotenv/config";
import prismaPkg from "../src/lib/prisma.js";
const { prisma } = prismaPkg;

import { RECIPES } from "../src/lib/portedFromRecomp/recipeLibrary.mjs";
import { FDC_MACRO_CACHE } from "../src/lib/portedFromRecomp/fdcMacroCache.mjs";
import { TIER1_FOODS } from "../src/lib/portedFromRecomp/foodLibrary.mjs";
import { ADJUSTERS } from "../src/lib/portedFromRecomp/adjusters.mjs";
import categoriesPkg from "../src/lib/foodCategories.js";
const { classifyFood } = categoriesPkg;
// Recipe meal-category classifier (roadmap/03-recipe-curation.md,
// docs/audit/04-recipe-curation-report.md). Applied at seed time so a FRESH
// seed lands correct mealCategory values (desserts/breads/condiments flagged
// non-meal) instead of the old "everything is slotType:meal, mealCategory
// null" state that let desserts fill lunch/dinner slots.
import classificationPkg from "../src/lib/recipeClassification.js";
const { classifyRecipe } = classificationPkg;

// Phase 2: every seeded food gets its category from the shared grocery-store
// classifier (foodCategories.js), the same rules the app and audit enforce —
// re-running this seed can no longer reintroduce the legacy category scheme.
function guessCategory(name) {
  return classifyFood(name).category;
}

async function main() {
  // 1. Foods — one row per distinct ingredient name across all 602 recipes
  // (764 distinct names, 0 name->multiple-fdcId collisions, confirmed by a
  // read-only inspection pass before writing this script), macros pulled
  // per-100g straight from FDC_MACRO_CACHE by fdcId (every ingredient has one,
  // every fdcId is present in the cache — also confirmed, zero exceptions).
  const foodByName = new Map();
  for (const r of RECIPES) {
    for (const ing of r.ingredients) {
      const key = ing.name.trim();
      if (foodByName.has(key)) continue;
      const macro = FDC_MACRO_CACHE[String(ing.fdcId)];
      foodByName.set(key, {
        name: key,
        category: guessCategory(key),
        fdcId: ing.fdcId,
        kcal: macro.kcal, protein: macro.protein, fat: macro.fat, carb: macro.carb, fiber: macro.fiber ?? 0,
        source: "usda",
      });
    }
  }

  // 2. TIER1_FOODS (74 hand-curated items, already has a real category) — only
  // add if no recipe-derived Food already claimed that exact name.
  for (const f of TIER1_FOODS) {
    if (foodByName.has(f.name)) continue;
    foodByName.set(f.name, {
      name: f.name, category: guessCategory(f.name), fdcId: f.fdcId,
      kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber ?? 0,
      source: f.sourceTag === "USDA-VERIFIED" ? "usda" : "manual",
    });
  }

  // 3. ADJUSTERS (8 curated sides) — perGram macros, converted to per-100g.
  for (const a of ADJUSTERS) {
    if (foodByName.has(a.name)) continue;
    foodByName.set(a.name, {
      name: a.name, category: guessCategory(a.name) ?? a.role ?? "other", fdcId: a.fdcId,
      kcal: a.perGram.kcal * 100, protein: a.perGram.p * 100, fat: a.perGram.f * 100, carb: a.perGram.c * 100, fiber: 0,
      source: "usda",
    });
  }

  // Food.fdcId is @unique (schema.prisma, landed 2026-07-22) but this ported
  // library predates that constraint and carries 193 duplicate-fdcId groups
  // covering 611 of its 943 rows — "Beef" and "Ground Beef" both cite 170602.
  // Writing fdcId blindly dies with P2002 at the 15th food, which is why CI's
  // Seed step crashed before a single test ran (docs/qc/session-findings-
  // 2026-08-10.md, the CORRECTED block above Defect 1). Policy here: FIRST
  // WRITER WINS the fdcId; every later row still lands as a Food — a food is
  // never dropped — it just lands without an fdcId claim. Ownership is
  // preloaded from the DATABASE, not just tracked within this run, so a
  // re-run (idempotence) or a row seeded by another script can never collide
  // either. On update, a non-claimable fdcId is simply omitted so an existing
  // row keeps whatever fdcId it already holds.
  const fdcOwner = new Map(); // fdcId -> Food.id that owns it
  for (const row of await prisma.food.findMany({ where: { fdcId: { not: null } }, select: { id: true, fdcId: true } })) {
    fdcOwner.set(row.fdcId, row.id);
  }

  const foodIdByName = {};
  let foodsCreated = 0, foodsUpdated = 0, fdcIdUnclaimed = 0;
  for (const f of foodByName.values()) {
    // Manual upsert-by-name: Food.name is no longer @unique (bulk-import scale
    // change), so upsert({ where: { name } }) is no longer valid. Same semantics as
    // before — match the first row with this name, update it, else create.
    const existed = await prisma.food.findFirst({ where: { name: f.name } });
    const owner = f.fdcId != null ? fdcOwner.get(f.fdcId) : undefined;
    const claims = f.fdcId != null && (owner === undefined || (existed !== null && owner === existed.id));
    if (f.fdcId != null && !claims) fdcIdUnclaimed++;
    const base = { category: f.category, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber, source: f.source };
    const row = existed
      ? await prisma.food.update({ where: { id: existed.id }, data: claims ? { ...base, fdcId: f.fdcId } : base })
      : await prisma.food.create({ data: { name: f.name, ...base, fdcId: claims ? f.fdcId : null } });
    if (claims) fdcOwner.set(f.fdcId, row.id);
    foodIdByName[f.name] = row.id;
    existed ? foodsUpdated++ : foodsCreated++;
  }
  console.log(`Foods: ${foodsCreated} created, ${foodsUpdated} updated (${foodByName.size} total considered; ${fdcIdUnclaimed} landed without an fdcId claim — duplicate fdcId, first writer keeps it).`);

  // 4. Recipes — 602 TheMealDB-sourced dishes, upserted by name. If a name
  // already exists AND wasn't created by a prior run of this same script
  // (source !== "themealdb-import"), skip it rather than clobber a
  // hand-curated or AI-generated recipe that happens to share a name.
  let recipesCreated = 0, recipesUpdated = 0, recipesSkipped = 0;
  for (const r of RECIPES) {
    const servings = r.servings || 1;
    let kcal = 0, protein = 0, fat = 0, carb = 0;
    for (const ing of r.ingredients) {
      const macro = FDC_MACRO_CACHE[String(ing.fdcId)];
      const factor = ing.grams / 100;
      kcal += macro.kcal * factor; protein += macro.protein * factor; fat += macro.fat * factor; carb += macro.carb * factor;
    }
    kcal /= servings; protein /= servings; fat /= servings; carb /= servings;

    const existing = await prisma.recipe.findUnique({ where: { name: r.name } });
    if (existing && existing.source !== "themealdb-import") {
      recipesSkipped++;
      continue;
    }

    // Classify meal category from name + ingredients + macros + TheMealDB
    // source tags. `needsReview` items (genuinely ambiguous, e.g. Cumberland
    // Pie) are left null so a human decides — the classifier never guesses.
    const classification = classifyRecipe({
      name: r.name,
      ingredients: r.ingredients,
      kcal, protein, fat, carb,
      sourceTags: r.tags,
    });
    const mealCategory = classification.needsReview ? null : classification.mealCategory;

    const prepTimeMin = Math.round(r.activeMin ?? r.totalMin ?? 0) || null;
    // mealCategory is set ONLY on create, never on update: re-running the seed
    // must not clobber human review decisions (scripts/applyAmbiguousOverrides.js)
    // or a prior retag (scripts/retagRecipeCategories.mjs). Use the retag
    // script to (re)tag existing rows.
    const recipe = await prisma.recipe.upsert({
      where: { name: r.name },
      update: { steps: r.steps, slotType: "meal", prepTimeMin, kcal, protein, fat, carb, source: "themealdb-import" },
      create: { name: r.name, steps: r.steps, slotType: "meal", prepTimeMin, kcal, protein, fat, carb, source: "themealdb-import", mealCategory },
    });

    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    // (recipeId, foodId) is UNIQUE, but 125 of the 602 source recipes list the
    // same ingredient name on more than one line (e.g. Soy Sauce twice in Beef
    // and Broccoli Stir-Fry — marinade line + sauce line). Aggregate grams per
    // resolved food so each (recipe, food) pair lands as exactly ONE row whose
    // grams are the sum of its lines. The recipe macro totals computed above
    // already counted every line, so summing the grams preserves them exactly.
    const gramsByFoodId = new Map();
    for (const ing of r.ingredients) {
      const foodId = foodIdByName[ing.name.trim()];
      gramsByFoodId.set(foodId, (gramsByFoodId.get(foodId) || 0) + ing.grams / servings);
    }
    for (const [foodId, baseGrams] of gramsByFoodId) {
      await prisma.recipeIngredient.create({
        data: { recipeId: recipe.id, foodId, baseGrams, scalable: true, role: null },
      });
    }
    existing ? recipesUpdated++ : recipesCreated++;
  }
  console.log(`Recipes: ${recipesCreated} created, ${recipesUpdated} updated, ${recipesSkipped} skipped (name collision with a non-imported recipe).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
