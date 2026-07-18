const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { computeMacros } = require("../lib/bmrEngine.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { todayStr, mondayOf } = require("../lib/dates.js");
const { generateWeekPlan, regenerateOneSlot } = require("../lib/weeklyPlanner.js");
const { recipeExcludedByStyle, matchesExclusionTerm } = require("../lib/dietaryFilter.js");
const { buildGroceryList } = require("../lib/groceryList.js");

const router = express.Router();
router.use(requireAuth);

const PLAN_INCLUDE = { slots: { include: { recipe: true }, orderBy: [{ dayOfWeek: "asc" }, { slotType: "asc" }, { slotIndex: "asc" }] }, groceryList: true };

// Keto per-serving carb ceiling for recipe-pool filtering. Not the same
// number as dietaryFilter.js's DEFAULT_KETO_CARB_THRESHOLD (15g) - that one
// is per-100g of a single flat ingredient; this is total carbs for a whole
// recipe serving, which is naturally a much bigger number. A simple,
// disclosed default (not a clinical derivation), same spirit as this
// codebase's other keyword/threshold defaults.
const KETO_RECIPE_CARB_CEILING_G = 30;

// dietaryFilter.js's recipe-shaped functions expect {ingredients:[{name}]} -
// this schema's recipePool has {ingredients:[{food:{name}}]} one level
// deeper (RecipeIngredient -> Food relation), so adapt the shape at the call
// site rather than changing the ported module's contract. Keto is handled
// separately here (not via recipeExcludedByStyle) because it depends on
// numeric carb content, which isn't available at the ingredient-name level
// dietaryFilter.js operates on for recipes - this schema's Recipe row
// already caches a real per-serving `carb` total, so use that directly.
function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return recipePool.filter((recipe) => {
    if (dietaryStyle === "keto" && recipe.carb > KETO_RECIPE_CARB_CEILING_G) return false;
    const flatIngredients = recipe.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flatIngredients }, dietaryStyle)) return false;
    if (excludedFoods.length && flatIngredients.some((ing) => excludedFoods.some((term) => matchesExclusionTerm(ing.name, term)))) return false;
    return true;
  });
}

async function planContext(userId) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("no profile set up yet"), { status: 404 });
  const weightNowKg = await getWeightNowKg(userId, profile);
  const dailyTarget = computeMacros(profile, weightNowKg, profile.targetKcal);
  const mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay };
  const rawRecipePool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const recipePool = filterRecipePool(rawRecipePool, profile);
  return { profile, dailyTarget, mealConfig, recipePool };
}

function slotKey(s) {
  return `${s.dayOfWeek}:${s.slotType}:${s.slotIndex}`;
}

async function upsertSlot(planId, slot) {
  return prisma.planSlot.upsert({
    where: { planId_dayOfWeek_slotType_slotIndex: { planId, dayOfWeek: slot.dayOfWeek, slotType: slot.slotType, slotIndex: slot.slotIndex } },
    update: {
      recipeId: slot.recipeId, proteinScale: slot.proteinScale, sidesScale: slot.sidesScale,
      ingredients: slot.ingredients, kcal: slot.kcal, protein: slot.protein, fat: slot.fat, carb: slot.carb,
      warning: slot.warning, locked: slot.locked,
    },
    create: {
      planId, dayOfWeek: slot.dayOfWeek, slotType: slot.slotType, slotIndex: slot.slotIndex,
      recipeId: slot.recipeId, proteinScale: slot.proteinScale, sidesScale: slot.sidesScale,
      ingredients: slot.ingredients, kcal: slot.kcal, protein: slot.protein, fat: slot.fat, carb: slot.carb,
      warning: slot.warning, locked: slot.locked,
    },
  });
}

router.get("/current", async (req, res) => {
  const monday = mondayOf(todayStr());
  const plan = await prisma.plan.findUnique({
    where: { userId_startDate: { userId: req.userId, startDate: monday } },
    include: PLAN_INCLUDE,
  });
  res.json(plan);
});

router.post("/generate", async (req, res) => {
  try {
    const { profile, dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const monday = mondayOf(todayStr());

    const existing = await prisma.plan.findUnique({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      include: { slots: true },
    });
    const lockedByKey = new Map((existing?.slots || []).filter((s) => s.locked).map((s) => [slotKey(s), s]));

    const freshSlots = await generateWeekPlan(dailyTarget, mealConfig, recipePool, {
      aiFallback: { enabled: true, maxCalls: 5, profile },
    });
    const finalSlots = freshSlots.map((s) => {
      const locked = lockedByKey.get(slotKey(s));
      return locked
        ? { ...s, recipeId: locked.recipeId, proteinScale: locked.proteinScale, sidesScale: locked.sidesScale, ingredients: locked.ingredients, kcal: locked.kcal, protein: locked.protein, fat: locked.fat, carb: locked.carb, warning: locked.warning, locked: true }
        : s;
    });

    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
    });

    // Dropping any locked slots that no longer exist in the current meal
    // config (e.g. mealsPerDay changed) — only slots present in
    // finalSlots are meaningful going forward.
    await prisma.planSlot.deleteMany({ where: { planId: plan.id, id: { notIn: (existing?.slots || []).filter((s) => finalSlots.some((f) => slotKey(f) === slotKey(s))).map((s) => s.id) } } });
    for (const s of finalSlots) await upsertSlot(plan.id, s);

    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put("/:planId/slots/:slotId", async (req, res) => {
  const { locked } = req.body || {};
  if (typeof locked !== "boolean") return res.status(400).json({ error: "locked (boolean) required" });
  const slot = await prisma.planSlot.findFirst({ where: { id: req.params.slotId, planId: req.params.planId, plan: { userId: req.userId } } });
  if (!slot) return res.status(404).json({ error: "slot not found" });
  const updated = await prisma.planSlot.update({ where: { id: slot.id }, data: { locked }, include: { recipe: true } });
  res.json(updated);
});

router.post("/:planId/slots/:slotId/swap", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { profile, dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const result = await regenerateOneSlot(
      plan.slots, { dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex }, recipePool, dailyTarget, mealConfig,
      { aiFallback: { enabled: true, maxCalls: 1, profile } }
    );
    const updated = await upsertSlot(plan.id, result);
    const full = await prisma.planSlot.findUnique({ where: { id: updated.id }, include: { recipe: true } });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Adapts a Plan's slots into the {meals:[{status,anchor:{ingredients},adjusters}]}
// shape groceryList.js's buildGroceryList() expects. Only slots with an
// assigned recipe count as "solved" - an empty/unassigned slot contributes
// nothing, same discipline as the ported module's own collectSolvedMeals().
// cut-protocol's PlanSlot.ingredients has no per-ingredient raw/cooked/dry
// `state` (confirmed against schema.prisma - RecipeIngredient has none
// either), so `state` is left undefined rather than guessed; the ported
// module's own convertToPurchaseQuantity() already has an honest fallback
// for that ("as-prepared, state unrecorded — NOT a purchase quantity")
// instead of silently claiming a raw/dry conversion that isn't real.
function planToGroceryListInput(plan) {
  return {
    meals: plan.slots
      .filter((s) => s.recipeId && Array.isArray(s.ingredients) && s.ingredients.length)
      .map((s) => ({
        status: "solved",
        anchor: { ingredients: s.ingredients.map((i) => ({ name: i.name, grams: i.grams, state: undefined })) },
        adjusters: [],
      })),
  };
}

router.post("/:planId/grocery-list", async (req, res) => {
  const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
  if (!plan) return res.status(404).json({ error: "plan not found" });

  // Upgraded from a plain macro-category grouping (no unit conversion, no
  // cost) to aisle-section grouping + cooked->raw purchase-quantity
  // conversion + a labeled CAD cost estimate, ported from recomp-v2's
  // groceryList.js. Note: `items`' shape changed from the old
  // {foodId,name,category,grams} to the richer shape buildGroceryList()
  // returns (see src/lib/groceryList.js) - any frontend code reading
  // GroceryList.items will need updating to match; not verified here since
  // that requires a logged-in browser session.
  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(planToGroceryListInput(plan));

  const list = await prisma.groceryList.upsert({
    where: { planId: plan.id },
    update: { items },
    create: { planId: plan.id, items },
  });
  res.json({ ...list, bySection, totalEstimatedCostCad, costCoverageNote });
});

router.get("/:planId/grocery-list", async (req, res) => {
  const list = await prisma.groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } });
  if (!list) return res.status(404).json({ error: "no grocery list generated yet for this plan" });
  res.json(list);
});

module.exports = router;
