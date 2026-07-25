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
//      wholeFoodsWithoutMicros, distinctFoods, distinctFoodsWithMicros,
//      distinctFoodsWithoutMicros, coverage:{...}, nutrients:{...} }
//
// NAMING WARNING (kept honest rather than quietly renamed): aggregatePortions'
// `wholeFoodsWithMicros` / `wholeFoodsWithoutMicros` count PORTIONS, not
// distinct foods — chicken appearing in lunch and dinner is 2, not 1 (see
// microAggregation.js:90-91). The UI wanted to say "N of M distinct foods",
// which those numbers cannot support: with repeated ingredients M is inflated
// and the sentence is simply false. The portion counts stay in the response
// under their existing names (they are real, and callers may depend on them);
// the DISTINCT counts below are computed here, where the deduplicated foodId
// set already exists, so no shared aggregation math had to change.
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

  // Distinct-food coverage. `foodIds` is already deduplicated above, so this
  // counts each food ONCE however many slots use it. An id with no matching
  // Food row (a stale foodId) counts as "without micros" — it is genuinely a
  // food we hold no micronutrient data for, which is exactly what the number
  // is meant to convey. Ingredients carrying no foodId at all are not distinct
  // foods we can name, so they are excluded here and remain visible through
  // portionCount / totalGrams instead.
  let distinctFoodsWithMicros = 0;
  for (const id of foodIds) {
    const food = foodsById.get(id);
    if (food && food.micros && typeof food.micros === "object") distinctFoodsWithMicros += 1;
  }

  res.json({
    date,
    hasPlan: todaySlots.length > 0,
    totalGrams: result.totalGrams,
    portionCount: result.portionCount,
    // Portion-level counts (see the naming warning above) — unchanged.
    wholeFoodsWithMicros: result.wholeFoodsWithMicros,
    wholeFoodsWithoutMicros: result.wholeFoodsWithoutMicros,
    // Distinct-food counts — what "N of M foods" actually means.
    distinctFoods: foodIds.length,
    distinctFoodsWithMicros,
    distinctFoodsWithoutMicros: foodIds.length - distinctFoodsWithMicros,
    coverage: summarizeCoverage(result),
    nutrients: result.nutrients,
  });
});

module.exports = router;
