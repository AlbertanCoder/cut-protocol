const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { computeMacros } = require("../lib/bmrEngine.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { estimateSlotTarget } = require("../lib/weeklyPlanner.js");
const { generateRecipeDrafts } = require("../lib/aiRecipeClient.js");
const { sumMacros, resolveDraftIngredients, persistRecipe, RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");

const router = express.Router();
router.use(requireAuth);

const { recipeExcludedByStyle, matchesExclusionTerm } = require("../lib/dietaryFilter.js");

// Phase 3: the library never surfaces a recipe containing an excluded
// ingredient — the same hard filter the solver pool uses. `hiddenCount`
// keeps the filtering visible (silent shrinkage is banned); ?all=1 is the
// explicit escape hatch (used nowhere by default).
router.get("/", async (req, res) => {
  const recipes = await prisma.recipe.findMany({ include: RECIPE_INCLUDE, orderBy: { name: "asc" } });
  if (req.query.all === "1") return res.json({ recipes, hiddenCount: 0 });

  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const dietaryStyle = profile?.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return res.json({ recipes, hiddenCount: 0 });

  const visible = recipes.filter((r) => {
    const flat = r.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return false;
    if (excludedFoods.length && flat.some((ing) => excludedFoods.some((term) => matchesExclusionTerm(ing.name, term)))) return false;
    return true;
  });
  res.json({ recipes: visible, hiddenCount: recipes.length - visible.length });
});

router.post("/generate-drafts", async (req, res) => {
  const { slotType, protein, cuisine, prepTimeMin, freeText, batchStyle, allowAllergens } = req.body || {};
  if (!["meal", "snack"].includes(slotType)) return res.status(400).json({ error: "slotType must be 'meal' or 'snack'" });

  try {
    const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: "no profile set up yet" });
    const weightNowKg = await getWeightNowKg(req.userId, profile);
    const dailyTarget = computeMacros(profile, weightNowKg, profile.targetKcal);
    const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
    const target = estimateSlotTarget(dailyTarget, mealConfig, slotType);
    const existingRecipeNames = (await prisma.recipe.findMany({ select: { name: true } })).map((r) => r.name);

    const { drafts, droppedForAllergies } = await generateRecipeDrafts({
      slotType, protein, cuisine, prepTimeMin, freeText, batchStyle,
      allowAllergens: !!allowAllergens,
      targetKcal: target.kcalTarget, targetProtein: target.proteinTarget,
      existingRecipeNames,
    });

    const resolved = [];
    for (const draft of drafts) resolved.push(await resolveDraftIngredients(draft));

    res.json({ drafts: resolved, droppedForAllergies });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post("/save-draft", async (req, res) => {
  const { name, description, cuisine, slotType, prepTimeMin, ingredients, steps } = req.body || {};
  if (!name || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "name and at least one ingredient are required" });
  }

  const foods = await prisma.food.findMany({ where: { id: { in: ingredients.map((i) => i.foodId) } } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  if (foods.length !== new Set(ingredients.map((i) => i.foodId)).size) {
    return res.status(400).json({ error: "one or more ingredient foodIds don't exist" });
  }
  const macros = sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams })));

  try {
    const recipe = await persistRecipe(
      { name, description, cuisine, slotType, prepTimeMin, steps, ingredients, ...macros },
      { source: "ai-generated" }
    );
    res.status(201).json(recipe);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a recipe named "${name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

// roadmap/05-data-isolation-audit.md and roadmap/04-multi-tenancy-auth.md
// both independently found the same gap: Recipe has no owner column, and
// these two routes had zero ownership check - any authenticated user could
// edit/delete ANY recipe (the whole shared library, or another user's own
// creation), cascading to silently wipe other users' carts (CartItem.recipeId
// -> Recipe is onDelete:Cascade) and null out slots in other users' active
// plans (PlanSlot.recipeId -> Recipe is onDelete:SetNull). Harmless today
// (one seeded account), armed the moment self-registration ships. A recipe
// with createdByUserId:null is pre-multi-tenancy shared/curated content -
// only an admin may mutate it; a recipe with a creator may only be mutated
// by that creator or an admin.
async function assertCanMutateRecipe(recipe, userId, res) {
  if (recipe.createdByUserId === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.role === "admin") return true;
  res.status(403).json({ error: "you don't have permission to modify this recipe" });
  return false;
}

router.put("/:id", async (req, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });
  if (!(await assertCanMutateRecipe(recipe, req.userId, res))) return;

  const { name, description, cuisine, slotType, prepTimeMin, steps, ingredients } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (cuisine !== undefined) patch.cuisine = cuisine;
  if (slotType !== undefined) patch.slotType = slotType;
  if (prepTimeMin !== undefined) patch.prepTimeMin = prepTimeMin;
  if (steps !== undefined) patch.steps = steps;

  if (ingredients !== undefined) {
    const foods = await prisma.food.findMany({ where: { id: { in: ingredients.map((i) => i.foodId) } } });
    const foodById = new Map(foods.map((f) => [f.id, f]));
    if (foods.length !== new Set(ingredients.map((i) => i.foodId)).size) {
      return res.status(400).json({ error: "one or more ingredient foodIds don't exist" });
    }
    Object.assign(patch, sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams }))));
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    await prisma.recipeIngredient.createMany({
      data: ingredients.map((i) => ({
        recipeId: recipe.id, foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable ?? true, role: i.role || null,
      })),
    });
  }

  try {
    const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: patch, include: RECIPE_INCLUDE });
    res.json(updated);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a recipe named "${name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });
  if (!(await assertCanMutateRecipe(recipe, req.userId, res))) return;
  // RecipeIngredient -> Recipe is ON DELETE RESTRICT; clear it first.
  // PlanSlot -> Recipe is ON DELETE SET NULL, so old plans survive intact.
  await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
  await prisma.recipe.delete({ where: { id: recipe.id } });
  res.status(204).end();
});

module.exports = router;
