// Serves the daily micronutrient rollup for the Today view. Data source is
// deliberately today's SOLVED PLAN (PlanSlot.ingredients — the schema's own
// ground truth for actual grams-per-food in a slot, see schema.prisma),
// the exact same "planned" data TodayTab's macro ring already reads —
// NOT the food diary (MealLog). MealLog stores a self-contained macro
// snapshot with no foodId/grams link (by design — see schema.prisma's
// comment on MealLog), so there is no honest way to recover which foods
// built a logged entry's micronutrients after the fact without inventing
// data. Reusing the plan (which DOES carry real per-food grams) keeps every
// number here traceable back to a real Food row instead of estimated.
const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { todayStr, mondayOf, dayNum } = require("../lib/dates.js");
const { aggregatePortions, portionsFromPlanSlotIngredients, summarizeCoverage } = require("../lib/microAggregation.js");

const router = express.Router();
router.use(requireAuth);

const isDateStr = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00"));

// GET /api/micronutrients/today?date=YYYY-MM-DD (defaults to today)
// -> { date, hasPlan, totalGrams, portionCount, wholeFoodsWithMicros,
//      wholeFoodsWithoutMicros, coverage:{...}, nutrients:{...} }
router.get("/today", async (req, res) => {
  const date = typeof req.query.date === "string" && req.query.date ? req.query.date : todayStr();
  if (!isDateStr(date)) return res.status(400).json({ error: "date must be yyyy-mm-dd" });

  const monday = mondayOf(date);
  const dayOfWeek = dayNum(date) - dayNum(monday); // 0 = Monday .. 6 = Sunday

  const plan = await prisma.plan.findUnique({
    where: { userId_startDate: { userId: req.userId, startDate: monday } },
    include: { slots: true },
  });

  const todaySlots = (plan?.slots || []).filter(
    (s) => s.dayOfWeek === dayOfWeek && Array.isArray(s.ingredients) && s.ingredients.length > 0
  );

  const foodIds = [...new Set(todaySlots.flatMap((s) => s.ingredients.map((ing) => ing.foodId)).filter(Boolean))];
  const foods = foodIds.length ? await prisma.food.findMany({ where: { id: { in: foodIds } } }) : [];
  const foodsById = new Map(foods.map((f) => [f.id, f]));

  const portions = todaySlots.flatMap((s) => portionsFromPlanSlotIngredients(s.ingredients, foodsById));
  const result = aggregatePortions(portions);

  res.json({
    date,
    hasPlan: todaySlots.length > 0,
    totalGrams: result.totalGrams,
    portionCount: result.portionCount,
    wholeFoodsWithMicros: result.wholeFoodsWithMicros,
    wholeFoodsWithoutMicros: result.wholeFoodsWithoutMicros,
    coverage: summarizeCoverage(result),
    nutrients: result.nutrients,
  });
});

module.exports = router;
