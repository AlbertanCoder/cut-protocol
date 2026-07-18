const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");
const { buildGroceryList } = require("../lib/groceryList.js");

const router = express.Router();
router.use(requireAuth);

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
  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(cartToGroceryListInput(cartItems));
  res.json({ items, bySection, totalEstimatedCostCad, costCoverageNote });
});

module.exports = router;
