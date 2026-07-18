const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");
const { buildGroceryList } = require("../lib/groceryList.js");
const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling } = require("../lib/dietaryFilter.js");

const router = express.Router();
router.use(requireAuth);

// A cart recipe complies with the current profile if it survives the same
// diet-style + allergy + keto filter the plan pool and library use. Stage-C
// fix (M12): the cart can hold recipes that were compliant when added but
// aren't after a diet/allergy change; its grocery list must not silently
// shop an allergen.
function recipeCompliant(recipe, profile) {
  const dietaryStyle = profile?.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [];
  if (recipeExceedsKetoCeiling(recipe, dietaryStyle)) return false;
  const flat = recipe.ingredients.map((i) => ({ name: i.food.name }));
  if (recipeExcludedByStyle({ ingredients: flat }, dietaryStyle)) return false;
  if (excludedFoods.length && flat.some((ing) => excludedFoods.some((t) => matchesExclusionTerm(ing.name, t)))) return false;
  return true;
}

router.get("/", async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.userId },
    include: { recipe: { include: RECIPE_INCLUDE } },
    orderBy: { addedAt: "desc" },
  });
  res.json(items);
});

router.post("/", async (req, res) => {
  const { recipeId } = req.body || {};
  if (!recipeId) return res.status(400).json({ error: "recipeId required" });
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });

  const item = await prisma.cartItem.upsert({
    where: { userId_recipeId: { userId: req.userId, recipeId } },
    update: {},
    create: { userId: req.userId, recipeId },
    include: { recipe: { include: RECIPE_INCLUDE } },
  });
  res.status(201).json(item);
});

router.delete("/:recipeId", async (req, res) => {
  await prisma.cartItem.deleteMany({ where: { userId: req.userId, recipeId: req.params.recipeId } });
  res.status(204).end();
});

// Cart recipes are library items at their base serving size (scale=1), not
// solved/scaled PlanSlots — a different shape than plans.js's
// planToGroceryListInput() but the same {meals:[{status,anchor,adjusters}]}
// contract buildGroceryList() expects, so the underlying engine is reused
// rather than duplicated.
function cartToGroceryListInput(cartItems) {
  return {
    meals: cartItems.map((item) => ({
      status: "solved",
      anchor: { ingredients: item.recipe.ingredients.map((i) => ({ name: i.food.name, grams: i.baseGrams, state: undefined })) },
      adjusters: [],
    })),
  };
}

router.post("/grocery-list", async (req, res) => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId: req.userId },
    include: { recipe: { include: RECIPE_INCLUDE } },
  });
  if (!cartItems.length) return res.status(400).json({ error: "cart is empty" });

  // Drop cart items that no longer comply with the current diet/allergy rules,
  // and report them by name — never silently shop an excluded ingredient (M12).
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const compliant = cartItems.filter((it) => recipeCompliant(it.recipe, profile));
  const skippedForDiet = cartItems.filter((it) => !recipeCompliant(it.recipe, profile)).map((it) => it.recipe.name);
  if (!compliant.length) {
    return res.status(400).json({ error: "no cart items comply with your current diet & allergy rules", skippedForDiet });
  }
  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(cartToGroceryListInput(compliant));
  res.json({ items, bySection, totalEstimatedCostCad, costCoverageNote, skippedForDiet });
});

module.exports = router;
