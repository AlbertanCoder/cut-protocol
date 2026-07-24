const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { computeMacros } = require("../lib/bmrEngine.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { estimateSlotTarget } = require("../lib/weeklyPlanner.js");
const { generateRecipeDrafts } = require("../lib/aiRecipeClient.js");
const { llmAvailability } = require("../lib/brain/governance.js");
const { sumMacros, resolveDraftIngredients, persistRecipe, resolvedDraftViolation, RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");

const router = express.Router();
router.use(requireAuth);

const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling } = require("../lib/dietaryFilter.js");

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
    // Stage-C fix (M8): the keto whole-recipe carb ceiling was enforced only in
    // the solver pool, so a keto user saw every recipe in the library and got
    // a misleading error when placing a non-keto one. Same ceiling here now.
    if (recipeExceedsKetoCeiling(r, dietaryStyle)) return false;
    const flat = r.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return false;
    if (excludedFoods.length && flat.some((ing) => excludedFoods.some((term) => matchesExclusionTerm(ing.name, term)))) return false;
    return true;
  });
  res.json({ recipes: visible, hiddenCount: recipes.length - visible.length });
});

// GET /api/recipes/ai-status — lets a client ask whether AI drafting is armed
// in THIS build before offering the button, the same way /api/brain/status
// gates the chat bar. With the feature off the honest answer is "off", not a
// broken button that 503s on click.
router.get("/ai-status", (req, res) => {
  const availability = llmAvailability("recipeDrafts");
  res.json({ enabled: availability.enabled, reason: availability.reason || null });
});

// POST /api/recipes/generate-drafts — the ONE LLM-calling route outside
// /api/brain. Governed by src/lib/brain/governance.js (fleet finding
// brain-stack-1): the gate, the keyless 503, the injection guard, the pre-call
// cost cap, the ledger row, the timeout and the output guard all live in
// generateRecipeDrafts()'s governed wrapper — this handler adds no LLM policy
// of its own, it only renders the outcome. NOTHING is written before the model
// call returns: a refusal at any control leaves zero rows behind.
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

    const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
    const dietaryStyle = profile.dietaryStyle || null;

    const { drafts, droppedForAllergies, droppedForShape, allergenOverrides } = await generateRecipeDrafts({
      slotType, protein, cuisine, prepTimeMin, freeText, batchStyle,
      allowAllergens: !!allowAllergens,
      targetKcal: target.kcalTarget, targetProtein: target.proteinTarget,
      existingRecipeNames,
      // Stage-C fix (C2): the generator enforces THIS user's profile.
      excludedFoods,
      dietaryStyle,
      userId: req.userId, // ledger attribution
    });

    // The allergen filter above screened the names the MODEL wrote. Resolution
    // can land an ingredient on a differently-named Food row ("chickpea pasta"
    // -> a wheat pasta row), so the same filter runs again on the RESOLVED
    // names — otherwise resolution is an allergen-erasure path. The override
    // still applies (it is the user's explicit, per-generation choice), but a
    // violation is always reported, never silent.
    const resolved = [];
    for (const draft of drafts) {
      const r = await resolveDraftIngredients(draft);
      const violation = resolvedDraftViolation(r, { excludedFoods, dietaryStyle });
      if (violation) {
        if (!allowAllergens) { droppedForAllergies.push({ name: r.name, reason: `${violation} (found after ingredient resolution)` }); continue; }
        allergenOverrides.push({ name: r.name, reason: `${violation} (found after ingredient resolution)` });
      }
      resolved.push(r);
    }

    res.json({ drafts: resolved, droppedForAllergies, droppedForShape, allergenOverrides });
  } catch (e) {
    // A governance refusal is a DECIDED outcome with an honest status
    // (503 off/keyless · 400 input refused · 429 cost cap · 504 timeout),
    // never a stack trace and never a 500.
    if (e && e.isGovernance) return res.status(e.status || 503).json({ error: e.message, code: e.code });
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: every save goes through the Phase 2 data validator — a recipe
// built on a zero-macro placeholder or an invalid food row is rejected with
// directions, never silently persisted. Cuisine is auto-classified when the
// draft doesn't carry one; source is whitelisted (ai-generated | imported).
const { validateFood } = require("../lib/foodValidation.js");
const { loadFoodOverrides } = require("../lib/foodOverrides.js");
const { classifyCuisine, CUISINES } = require("../lib/recipeCuisine.js");
const { importRecipeFromUrl } = require("../lib/recipeImporter.js");

function validateDraftFoods(ingredients, foodById) {
  const problems = [];
  const exemptions = loadFoodOverrides();
  for (const ing of ingredients) {
    const food = foodById.get(ing.foodId);
    const { ok, issues } = validateFood(food, { exemptions });
    if (!ok) {
      const placeholder = issues.some((i) => i.code === "placeholder");
      problems.push({
        foodId: food.id, name: food.name,
        reason: placeholder
          ? "zero-macro placeholder — open it in the Food database and enter real values first"
          : issues.map((i) => i.detail).join("; "),
      });
    }
    if (!(Number(ing.grams) > 0)) {
      problems.push({ foodId: food.id, name: food.name, reason: "amount must be above 0 g" });
    }
  }
  return problems;
}

router.post("/save-draft", async (req, res) => {
  const { name, description, cuisine, slotType, prepTimeMin, ingredients, steps, source } = req.body || {};
  if (!name || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "name and at least one ingredient are required" });
  }

  const foods = await prisma.food.findMany({ where: { id: { in: ingredients.map((i) => i.foodId) } } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  if (foods.length !== new Set(ingredients.map((i) => i.foodId)).size) {
    return res.status(400).json({ error: "one or more ingredient foodIds don't exist" });
  }

  const problems = validateDraftFoods(ingredients, foodById);
  if (problems.length) {
    return res.status(422).json({ error: "recipe fails the data validator", invalidIngredients: problems });
  }

  const macros = sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams })));
  const finalCuisine = cuisine && CUISINES.some((c) => c.key === cuisine)
    ? cuisine
    : classifyCuisine(name).cuisine;

  try {
    const recipe = await persistRecipe(
      { name, description, cuisine: finalCuisine, slotType, prepTimeMin, steps, ingredients, ...macros },
      { source: source === "imported" ? "imported" : "ai-generated" }
    );
    res.status(201).json(recipe);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a recipe named "${name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

// Phase 5 importer: URL → reviewable draft (same shape as AI drafts — the
// frontend reuses the draft editor). Nothing is saved here.
router.post("/import", async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== "string" || !url.trim()) return res.status(400).json({ error: "url required" });
  try {
    const draft = await importRecipeFromUrl(url.trim());
    res.json({ draft });
  } catch (e) {
    res.status(422).json({ error: e.message });
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
    const problems = validateDraftFoods(ingredients, foodById);
    if (problems.length) {
      return res.status(422).json({ error: "recipe fails the data validator", invalidIngredients: problems });
    }
    Object.assign(patch, sumMacros(ingredients.map((i) => ({ food: foodById.get(i.foodId), grams: i.grams }))));
  }

  try {
    // Stage-C fix (M5): the ingredient replacement and the recipe update run
    // in ONE transaction. Before, a P2002 name collision on the update (a
    // handled 409) left the ingredients already replaced under the old cached
    // macros — wrong nutrition data the solver then consumes; a crash between
    // the delete and create left the recipe with zero ingredients.
    const updated = await prisma.$transaction(async (tx) => {
      if (ingredients !== undefined) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
        await tx.recipeIngredient.createMany({
          data: ingredients.map((i) => ({
            recipeId: recipe.id, foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable ?? true, role: i.role || null,
          })),
        });
      }
      return tx.recipe.update({ where: { id: recipe.id }, data: patch, include: RECIPE_INCLUDE });
    });
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
