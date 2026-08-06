const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { RECIPE_INCLUDE } = require("../lib/recipeGeneration.js");
const { buildGroceryList } = require("../lib/groceryList.js");
// One authority for "may this user see this recipe?" — see exclusionGate.js.
// This route used to carry its own copy of the check that read ingredient
// NAMES only; against the real library that copy shopped 210 recipe/allergy
// pairs the solver hides, including a sesame-allergic user's grocery list for
// "Roasted Eggplant With Tahini, Pine Nuts, and Lentils" (tahini is in the
// title, never in an ingredient row). RECIPE_INCLUDE already loads whole Food
// rows, which is what keeps the gate at full strength here — a query that
// stripped them would fail CLOSED, loudly, instead of under-checking.
const { partitionRecipes } = require("../lib/exclusionGate.js");

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

// saas-launch Stage 2: adding/removing cart items stays free (it's browsing);
// computing SHOPPING QUANTITIES from the cart is portion-solved output.
router.post("/grocery-list", require("../lib/entitlement.js").requirePremium, async (req, res) => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId: req.userId },
    include: { recipe: { include: RECIPE_INCLUDE } },
  });
  if (!cartItems.length) return res.status(400).json({ error: "cart is empty" });

  // Drop cart items that no longer comply with the current diet/allergy rules,
  // and report them by name — never silently shop an excluded ingredient (M12).
  // The cart can hold recipes that were compliant when added but aren't after a
  // diet/allergy change, so this is re-decided at list time, never trusted from
  // the add. partitionRecipes runs the gate ONCE per item and hands back both
  // halves — the old code called its checker twice per item and could, in
  // principle, disagree with itself.
  const profile = await prisma.profile.findUnique({ where: { userId: req.userId } });
  const verdicts = partitionRecipes(cartItems.map((it) => it.recipe), profile);
  const allowedIds = new Set(verdicts.allowed.map((r) => r.id));
  const compliant = cartItems.filter((it) => allowedIds.has(it.recipe.id));
  const skippedForDiet = verdicts.blocked.map((b) => b.recipe.name);
  if (!compliant.length) {
    return res.status(400).json({ error: "no cart items comply with your current diet & allergy rules", skippedForDiet });
  }
  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(cartToGroceryListInput(compliant));
  res.json({ items, bySection, totalEstimatedCostCad, costCoverageNote, skippedForDiet });
});

module.exports = router;
