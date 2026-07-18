// Shared draft-resolution/persistence logic, extracted from routes/recipes.js
// so both the interactive generate-drafts/save-draft flow and the automated
// weekly-solver fallback (weeklyPlanner.js, via generateAndSaveSlotRecipe()
// below) go through the exact same "never fabricate a Food row, never skip
// the real macro computation" path — one implementation, not two that can
// silently drift apart.
const { prisma } = require("./prisma.js");
const { resolveIngredient } = require("./ingredientResolver.js");
const { generateRecipeDrafts } = require("./aiRecipeClient.js");

const RECIPE_INCLUDE = { ingredients: { include: { food: true } } };

function sumMacros(ingredients) {
  // ingredients: [{ food: {kcal,protein,fat,carb}, grams }]
  return ingredients.reduce(
    (t, i) => {
      const factor = i.grams / 100;
      return {
        kcal: t.kcal + i.food.kcal * factor,
        protein: t.protein + i.food.protein * factor,
        fat: t.fat + i.food.fat * factor,
        carb: t.carb + i.food.carb * factor,
      };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
}

// draft: {name, description, cuisine, slotType, prepTimeMin, servings, steps,
//         ingredients:[{name,grams,role,scalable}]} — as returned by
// generateRecipeDrafts(). Resolves every ingredient name to a real Food row
// (existing match, live USDA lookup, or an honestly-flagged placeholder —
// resolveIngredient() never fabricates macros) and computes real totals from
// those resolved rows, never from the AI's own say-so.
async function resolveDraftIngredients(draft, resolveIngredientImpl = resolveIngredient) {
  const resolvedIngredients = [];
  for (const ing of draft.ingredients) {
    const { food, matched } = await resolveIngredientImpl(ing.name);
    resolvedIngredients.push({
      foodId: food.id, name: food.name, grams: ing.grams,
      role: ing.role, scalable: ing.scalable, matched,
      placeholderMacros: matched === "placeholder",
    });
  }
  const foods = await prisma.food.findMany({ where: { id: { in: resolvedIngredients.map((i) => i.foodId) } } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const macros = sumMacros(resolvedIngredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams })));

  return {
    name: draft.name, description: draft.description, cuisine: draft.cuisine,
    slotType: draft.slotType, prepTimeMin: draft.prepTimeMin, servings: draft.servings,
    steps: draft.steps, ingredients: resolvedIngredients, ...macros,
  };
}

// resolvedDraft: the shape resolveDraftIngredients() returns, OR an
// equivalent shape built from already-resolved ingredients (foodId already
// known) — the interactive /save-draft route takes ingredients a human
// already reviewed, which already carry foodId, so it builds this shape
// itself rather than re-resolving names.
async function persistRecipe(resolvedDraft, { source = "ai-generated" } = {}) {
  return prisma.recipe.create({
    data: {
      name: resolvedDraft.name, description: resolvedDraft.description || null, cuisine: resolvedDraft.cuisine || null,
      slotType: resolvedDraft.slotType || "meal", prepTimeMin: resolvedDraft.prepTimeMin || null,
      steps: resolvedDraft.steps || [], source,
      kcal: resolvedDraft.kcal, protein: resolvedDraft.protein, fat: resolvedDraft.fat, carb: resolvedDraft.carb,
      ingredients: {
        create: resolvedDraft.ingredients.map((i) => ({
          foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable ?? true, role: i.role || null,
        })),
      },
    },
    include: RECIPE_INCLUDE,
  });
}

// Same protein/kcal-ratio-closeness scoring weeklyPlanner.js's pickRecipe()
// already uses to pick among pool candidates — reused here so "pick the
// best of the 3 AI drafts" isn't a second, different notion of "best fit".
function scoreDraftFit(resolvedDraft, targetRatio) {
  const ratio = resolvedDraft.kcal > 0 ? resolvedDraft.protein / resolvedDraft.kcal : 0;
  return Math.abs(ratio - targetRatio);
}

// target: {slotType, kcalTarget, proteinTarget} (weeklyPlanner.js's slot
// target shape). profile: needs excludedFoods/dietaryStyle (safety, always
// enforced via allowAllergens:false + the hard-coded ALLERGY_BLOCKLIST in
// aiRecipeClient.js) and the new cuisinePreferences/mealPreferencesNote
// fields. existingRecipeNames: passed straight to generateRecipeDrafts() to
// reduce near-duplicates, same as the interactive route already does.
//
// Generates 3 drafts (generateRecipeDrafts()'s prompt always asks for
// exactly 3 — not worth touching that contract just to ask for 1), picks the
// best-fitting one, resolves + persists it as source:"ai-generated" — from
// then on it's a normal, reusable pool recipe, same organic-growth property
// ingredientResolver.js already has for Food rows.
// Last param is dependency injection for tests only (real callers never
// pass it — defaults are the real Claude/USDA/DB-backed implementations).
// Matches this codebase's existing fdcClient.js-style `fetchImpl` pattern
// rather than mocking require()'d modules.
async function generateAndSaveSlotRecipe(target, profile, existingRecipeNames, deps = {}) {
  const { generateDraftsImpl = generateRecipeDrafts, resolveIngredientImpl = resolveIngredient, persistRecipeImpl = persistRecipe } = deps;

  const cuisine = profile.cuisinePreferences?.length
    ? profile.cuisinePreferences[Math.floor(Math.random() * profile.cuisinePreferences.length)]
    : undefined;

  const { drafts } = await generateDraftsImpl({
    slotType: target.slotType === "snack" ? "snack" : "meal",
    cuisine,
    freeText: profile.mealPreferencesNote || undefined,
    allowAllergens: false, // always safety-first for this unattended path
    targetKcal: target.kcalTarget,
    targetProtein: target.proteinTarget,
    existingRecipeNames,
  });

  if (!drafts.length) {
    throw new Error("Claude generated no usable drafts (all 3 may have been dropped for allergy-rule violations)");
  }

  const resolvedDrafts = [];
  for (const draft of drafts) resolvedDrafts.push(await resolveDraftIngredients(draft, resolveIngredientImpl));

  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const best = resolvedDrafts.reduce((a, b) => (scoreDraftFit(a, targetRatio) <= scoreDraftFit(b, targetRatio) ? a : b));

  return persistRecipeImpl(best, { source: "ai-generated" });
}

module.exports = { sumMacros, resolveDraftIngredients, persistRecipe, generateAndSaveSlotRecipe, RECIPE_INCLUDE };
