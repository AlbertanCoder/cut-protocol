const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { computeMacros } = require("../lib/bmrEngine.js");
const { getWeightNowKg } = require("../lib/weightNow.js");
const { todayStr, mondayOf } = require("../lib/dates.js");
const { generateWeekPlan, regenerateOneSlot, buildSlots, targetsForSlots, scaleRecipe } = require("../lib/weeklyPlanner.js");
const { generateDayCandidates, generateBestWeekPlan, alternatesForSlot, buildBias, applyPrepFilter } = require("../lib/mealSolver.js");
const { buildCostCache } = require("../lib/recipeCost.js");
const { recipeExcludedByStyle, matchesExclusionTerm, recipeExceedsKetoCeiling } = require("../lib/dietaryFilter.js");
const { buildGroceryList } = require("../lib/groceryList.js");
const { toPurchaseUnits } = require("../lib/purchaseUnits.js");

const router = express.Router();
router.use(requireAuth);

const PLAN_INCLUDE = { slots: { include: { recipe: true }, orderBy: [{ dayOfWeek: "asc" }, { slotType: "asc" }, { slotIndex: "asc" }] }, groceryList: true };

function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return recipePool.filter((recipe) => {
    // Shared keto ceiling — single-sourced in dietaryFilter so the library
    // listing (recipes.js) can never diverge from the solver pool (M8).
    if (recipeExceedsKetoCeiling(recipe, dietaryStyle)) return false;
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
  return { profile, dailyTarget, mealConfig, recipePool, rawPoolCount: rawRecipePool.length };
}

// The generation filters the Phase 4 UI sends. Cuisine/protein/budget are
// soft biases; maxPrepMin is a hard cap; allowBatchRepeats relaxes the
// variety rule. Allergies/diet are NOT here — they come from the profile
// and are enforced in filterRecipePool, always.
function parseFilters(body) {
  const f = body?.filters || {};
  return {
    cuisines: Array.isArray(f.cuisines) ? f.cuisines.filter((c) => typeof c === "string").slice(0, 8) : [],
    protein: typeof f.protein === "string" && f.protein ? f.protein : null,
    budget: ["cheap", "moderate", "premium"].includes(f.budget) ? f.budget : null,
    maxPrepMin: Number.isInteger(f.maxPrepMin) && f.maxPrepMin > 0 ? f.maxPrepMin : null,
    allowBatchRepeats: f.allowBatchRepeats === true,
  };
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

// Server-side rebuild of an incoming candidate/alternate slot. The client
// only nominates {recipeId, ingredients:[{foodId, grams}]} — names come
// from the DB and macros are recomputed here, never trusted. Membership in
// the user's FILTERED pool is the compliance check (diet + allergies).
function rebuildSlotFromClient(incoming, recipePool) {
  const recipe = recipePool.find((r) => r.id === incoming.recipeId);
  if (!recipe) throw Object.assign(new Error("recipe not in your allowed pool (diet/allergy rules or unknown id)"), { status: 400 });
  const byFoodId = new Map(recipe.ingredients.map((i) => [i.foodId, i]));
  const ingredients = (incoming.ingredients || []).map((ing) => {
    const ri = byFoodId.get(ing.foodId);
    if (!ri) throw Object.assign(new Error(`ingredient ${ing.foodId} does not belong to recipe "${recipe.name}"`), { status: 400 });
    const grams = Math.round(Number(ing.grams));
    // Stage-C fix (M9): grams must sit within the spec's 0.5x-2x portion band
    // relative to the recipe's base grams (a non-scalable ingredient stays at
    // base), with a small tolerance for 5g practical rounding. Previously any
    // value up to 5000 g was accepted, so a crafted payload could store a x10
    // / 44,000-kcal slot the dashboard then presented as the plan.
    const lo = ri.scalable ? ri.baseGrams * 0.5 : ri.baseGrams;
    const hi = ri.scalable ? ri.baseGrams * 2 : ri.baseGrams;
    const TOL = 6;
    if (!Number.isFinite(grams) || grams < 0 || grams < lo - TOL || grams > hi + TOL) {
      throw Object.assign(new Error(`grams for "${ri.food.name}" (${grams}) are outside the allowed 0.5x-2x portion range`), { status: 400 });
    }
    return { foodId: ri.foodId, name: ri.food.name, role: ri.role, grams };
  });
  if (ingredients.length === 0) throw Object.assign(new Error("a slot needs at least one ingredient"), { status: 400 });
  const totals = ingredients.reduce(
    (sum, ing) => {
      const food = byFoodId.get(ing.foodId).food;
      const factor = ing.grams / 100;
      sum.kcal += food.kcal * factor;
      sum.protein += food.protein * factor;
      sum.fat += food.fat * factor;
      sum.carb += food.carb * factor;
      return sum;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  // Clamp the display scale labels to the same 0.5-2x band so they can't be
  // decoupled from the actual grams (Stage-C M9).
  const clampScale = (s) => Math.min(2, Math.max(0.5, Number(s) || 1));
  return {
    recipeId: recipe.id,
    proteinScale: clampScale(incoming.proteinScale),
    sidesScale: clampScale(incoming.sidesScale),
    ingredients,
    kcal: totals.kcal, protein: totals.protein, fat: totals.fat, carb: totals.carb,
    warning: typeof incoming.warning === "string" ? incoming.warning : null,
  };
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
    const { profile, dailyTarget, mealConfig, recipePool, rawPoolCount } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    const monday = mondayOf(todayStr());

    const existing = await prisma.plan.findUnique({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      include: { slots: true },
    });
    const lockedByKey = new Map((existing?.slots || []).filter((s) => s.locked).map((s) => [slotKey(s), s]));

    const pool = applyPrepFilter(recipePool, filters.maxPrepMin);
    const costCache = filters.budget ? buildCostCache(pool) : null;
    // Best-of-N scored week attempts (AI-free, fast); residual rough slots
    // are patched interactively via swap/alternates, where AI is available.
    // Stage-C fix (M10): pass the pool counts so a rough-week diagnosis can
    // name the TRUE binding constraint (e.g. a maxPrep cap that emptied the
    // pool) instead of always blaming diet/allergy rules.
    const { slots: freshSlots } = await generateBestWeekPlan(dailyTarget, mealConfig, pool, {
      bias: buildBias(filters, costCache),
      allowBatchRepeats: filters.allowBatchRepeats,
      filters,
      counts: { raw: rawPoolCount, afterDiet: recipePool.length, afterPrep: pool.length },
    });
    // A locked slot is only carried forward if its recipe still complies with
    // the CURRENT diet/allergy rules (Stage-C L9). Otherwise a slot locked
    // before a diet change (goat locked, then the user goes vegan) would
    // persist a now-forbidden meal into the regenerated plan — the fresh
    // compliant slot replaces it instead, and its lock is dropped.
    const compliantPoolIds = new Set(recipePool.map((r) => r.id));
    const finalSlots = freshSlots.map((s) => {
      const locked = lockedByKey.get(slotKey(s));
      return locked && compliantPoolIds.has(locked.recipeId)
        ? { ...s, recipeId: locked.recipeId, proteinScale: locked.proteinScale, sidesScale: locked.sidesScale, ingredients: locked.ingredients, kcal: locked.kcal, protein: locked.protein, fat: locked.fat, carb: locked.carb, warning: locked.warning, locked: true }
        : s;
    });

    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
    });

    await prisma.planSlot.deleteMany({ where: { planId: plan.id, id: { notIn: (existing?.slots || []).filter((s) => finalSlots.some((f) => slotKey(f) === slotKey(s))).map((s) => s.id) } } });
    for (const s of finalSlots) await upsertSlot(plan.id, s);

    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 4: 3+ scored complete-day candidates. Fast by design (no AI calls,
// no writes) — accepting one goes through /accept-day.
router.post("/day-options", async (req, res) => {
  try {
    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    const dayOfWeek = Number.isInteger(req.body?.dayOfWeek) && req.body.dayOfWeek >= 0 && req.body.dayOfWeek <= 6 ? req.body.dayOfWeek : 0;

    // Respect what the rest of the week already serves (variety caps span
    // the whole week; yesterday's dishes get discounted today).
    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.findUnique({ where: { userId_startDate: { userId: req.userId, startDate: monday } }, include: { slots: true } });
    const weekUsage = new Map();
    for (const s of plan?.slots || []) {
      if (s.recipeId && s.dayOfWeek !== dayOfWeek) weekUsage.set(s.recipeId, (weekUsage.get(s.recipeId) || 0) + 1);
    }
    const prevDayIds = new Set((plan?.slots || []).filter((s) => s.dayOfWeek === dayOfWeek - 1 && s.recipeId).map((s) => s.recipeId));

    const result = await generateDayCandidates({
      dailyTarget, mealConfig, recipePool, dayOfWeek, filters, weekUsage, prevDayIds,
    });
    // Attach recipe names for display (candidates carry ids + numbers only).
    const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
    for (const c of result.candidates) {
      for (const s of c.slots) s.recipeName = s.recipeId ? nameById.get(s.recipeId) || "?" : null;
    }
    res.json({ ...result, dailyTarget: { kcal: dailyTarget.kcal, proteinLo: dailyTarget.proteinLo, proteinHi: dailyTarget.proteinHi, fatLo: dailyTarget.fatLo, fatHi: dailyTarget.fatHi, carbLo: dailyTarget.carbLo, carbHi: dailyTarget.carbHi } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 4: accepting a candidate writes that day into the week plan.
// Locked slots on that day are preserved; everything else is replaced by
// the (server-rebuilt, compliance-checked) accepted slots.
router.post("/accept-day", async (req, res) => {
  try {
    const { recipePool } = await planContext(req.userId);
    const dayOfWeek = req.body?.dayOfWeek;
    const incoming = req.body?.slots;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return res.status(400).json({ error: "dayOfWeek 0-6 required" });
    if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ error: "slots required" });

    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });
    const lockedKeys = new Set((plan.slots || []).filter((s) => s.locked && s.dayOfWeek === dayOfWeek).map(slotKey));

    const rebuilt = [];
    for (const s of incoming) {
      const record = {
        dayOfWeek, slotType: s.slotType === "snack" ? "snack" : "meal",
        slotIndex: Number.isInteger(s.slotIndex) ? s.slotIndex : 0,
        locked: false,
        ...rebuildSlotFromClient(s, recipePool),
      };
      if (lockedKeys.has(slotKey(record))) continue; // locked slots keep their meal
      rebuilt.push(record);
    }

    // Remove this day's unlocked slots that the accepted set doesn't cover
    // (meal-config changes shrink days cleanly).
    const keepIds = (plan.slots || [])
      .filter((s) => s.dayOfWeek !== dayOfWeek || s.locked || rebuilt.some((r) => slotKey(r) === slotKey(s)))
      .map((s) => s.id);
    await prisma.planSlot.deleteMany({ where: { planId: plan.id, dayOfWeek, id: { notIn: keepIds } } });
    for (const r of rebuilt) await upsertSlot(plan.id, r);

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

// Phase 4: 3 scored alternates for a slot — the user picks, /apply writes.
router.post("/:planId/slots/:slotId/alternates", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const filters = parseFilters(req.body);
    const slotTarget = targetsForSlots(dailyTarget, buildSlots(mealConfig))
      .find((s) => s.dayOfWeek === target.dayOfWeek && s.slotType === target.slotType && s.slotIndex === target.slotIndex);
    if (!slotTarget) return res.status(400).json({ error: "slot not in current meal config" });

    const alternates = await alternatesForSlot({
      slotTarget, recipePool,
      existingSlots: plan.slots.filter((s) => s.id !== target.id),
      filters,
      excludeRecipeIds: target.recipeId ? [target.recipeId] : [],
    });
    const nameById = new Map(recipePool.map((r) => [r.id, r.name]));
    res.json({ alternates: alternates.map((a) => ({ ...a, recipeName: nameById.get(a.recipeId) || "?" })) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Apply a chosen alternate (server-rebuilt + compliance-checked).
router.put("/:planId/slots/:slotId/apply", async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { id: req.params.planId, userId: req.userId }, include: { slots: true } });
    if (!plan) return res.status(404).json({ error: "plan not found" });
    const target = plan.slots.find((s) => s.id === req.params.slotId);
    if (!target) return res.status(404).json({ error: "slot not found" });
    if (target.locked) return res.status(409).json({ error: "slot is locked — unlock it first" });

    const { recipePool } = await planContext(req.userId);
    const record = {
      dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex,
      locked: false,
      ...rebuildSlotFromClient(req.body || {}, recipePool),
    };
    await upsertSlot(plan.id, record);
    const full = await prisma.planSlot.findFirst({ where: { planId: plan.id, dayOfWeek: target.dayOfWeek, slotType: target.slotType, slotIndex: target.slotIndex }, include: { recipe: true } });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: place a specific recipe (from the library detail view) into a
// chosen slot at a chosen serving scale. Pool membership = diet/allergy
// compliance, exactly like accept-day.
router.post("/place-recipe", async (req, res) => {
  try {
    const { dayOfWeek, slotType, slotIndex, recipeId, scale } = req.body || {};
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return res.status(400).json({ error: "dayOfWeek 0-6 required" });
    const type = slotType === "snack" ? "snack" : "meal";
    const idx = Number.isInteger(slotIndex) ? slotIndex : 0;
    const s = Number(scale);
    if (!(s >= 0.5 && s <= 2)) return res.status(400).json({ error: "scale must be between 0.5 and 2" });

    const { recipePool } = await planContext(req.userId);
    const recipe = recipePool.find((r) => r.id === recipeId);
    if (!recipe) return res.status(400).json({ error: "recipe not in your allowed pool (diet/allergy rules or unknown id)" });

    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });
    const existing = (plan.slots || []).find((x) => x.dayOfWeek === dayOfWeek && x.slotType === type && x.slotIndex === idx);
    if (existing?.locked) return res.status(409).json({ error: "that slot is locked — unlock it first" });

    const ingredients = recipe.ingredients.map((ing) => ({
      foodId: ing.foodId, name: ing.food.name, role: ing.role,
      grams: Math.round((ing.baseGrams * (ing.scalable ? s : 1)) / 5) * 5 || Math.round(ing.baseGrams * (ing.scalable ? s : 1)),
    }));
    const totals = ingredients.reduce((t, ing) => {
      const food = recipe.ingredients.find((i) => i.foodId === ing.foodId).food;
      const f = ing.grams / 100;
      return { kcal: t.kcal + food.kcal * f, protein: t.protein + food.protein * f, fat: t.fat + food.fat * f, carb: t.carb + food.carb * f };
    }, { kcal: 0, protein: 0, fat: 0, carb: 0 });

    await upsertSlot(plan.id, {
      dayOfWeek, slotType: type, slotIndex: idx,
      recipeId: recipe.id, proteinScale: s, sidesScale: s,
      ingredients, ...totals, warning: null, locked: false,
    });
    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json(full);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Phase 5: fill TODAY's slots from the cart, each recipe solver-scaled to
// its slot's target. Locked slots keep their meals; extra cart items beyond
// today's slot count are reported, not silently dropped.
router.post("/fill-today-from-cart", async (req, res) => {
  try {
    const { dailyTarget, mealConfig, recipePool } = await planContext(req.userId);
    const cart = await prisma.cartItem.findMany({ where: { userId: req.userId }, orderBy: { addedAt: "asc" } });
    if (cart.length === 0) return res.status(400).json({ error: "your cart is empty" });

    const poolById = new Map(recipePool.map((r) => [r.id, r]));
    const usable = cart.map((c) => poolById.get(c.recipeId)).filter(Boolean);
    const skippedForDiet = cart.length - usable.length;
    if (usable.length === 0) return res.status(422).json({ error: "no cart recipe passes your current diet/allergy rules" });

    const jsDay = new Date().getDay();
    const today = jsDay === 0 ? 6 : jsDay - 1;
    const monday = mondayOf(todayStr());
    const plan = await prisma.plan.upsert({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      update: {},
      create: { userId: req.userId, startDate: monday },
      include: { slots: true },
    });

    const dayTargets = targetsForSlots(dailyTarget, buildSlots(mealConfig)).filter((t) => t.dayOfWeek === 0);
    let cartIdx = 0;
    let placed = 0;
    for (const target of dayTargets) {
      if (cartIdx >= usable.length) break;
      const existing = (plan.slots || []).find((x) => x.dayOfWeek === today && x.slotType === target.slotType && x.slotIndex === target.slotIndex);
      if (existing?.locked) continue;
      const recipe = usable[cartIdx++];
      const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
      // Stage-C fix (#33): the 0.5-2x scale can't always reach a slot's target
      // (a 600-kcal dish forced into a 300-kcal snack slot). Label the miss
      // instead of storing warning:null — the constitution bans silent misses.
      const kcalOff = target.kcalTarget > 0 ? Math.abs(scaled.kcal - target.kcalTarget) / target.kcalTarget : 0;
      const warning = kcalOff > 0.15
        ? `${Math.round(scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} kcal slot — the 0.5-2x portion limit couldn't close the gap.`
        : null;
      await upsertSlot(plan.id, {
        dayOfWeek: today, slotType: target.slotType, slotIndex: target.slotIndex,
        recipeId: recipe.id, proteinScale: scaled.proteinScale, sidesScale: scaled.sidesScale,
        ingredients: scaled.ingredients, kcal: scaled.kcal, protein: scaled.protein, fat: scaled.fat, carb: scaled.carb,
        warning, locked: false,
      });
      placed++;
    }

    const leftover = usable.length - cartIdx;
    const full = await prisma.plan.findUnique({ where: { id: plan.id }, include: PLAN_INCLUDE });
    res.json({
      plan: full,
      placed,
      note: [
        skippedForDiet ? `${skippedForDiet} cart item(s) skipped — outside your current diet/allergy rules.` : null,
        leftover > 0 ? `${leftover} cart item(s) didn't fit today's ${dayTargets.length} slots.` : null,
      ].filter(Boolean).join(" ") || null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Legacy one-shot swap (kept for compatibility; the UI now prefers
// alternates → apply).
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

function planToGroceryListInput(plan) {
  return {
    // Stage-C fix (M7): the slot's ingredients JSON is the schema's declared
    // ground truth and survives recipe deletion (recipeId → SetNull). Keying
    // on recipeId dropped a still-planned, still-displayed meal's ingredients
    // from the shopping list silently. Any slot with real ingredients counts.
    meals: plan.slots
      .filter((s) => Array.isArray(s.ingredients) && s.ingredients.length)
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

  const { items, bySection, totalEstimatedCostCad, costCoverageNote } = buildGroceryList(planToGroceryListInput(plan));
  // Phase 4: practical shopping units primary, grams secondary. checked
  // starts false; the check endpoint below persists ticks.
  const decorated = items.map((i) => ({
    ...i,
    purchaseUnits: toPurchaseUnits(i.name, i.purchase?.grams ?? i.preparedGrams),
    checked: false,
  }));

  // Stage-C fix (M13): buildGroceryList's bySection referenced the PRE-decoration
  // items, so on the fresh-generate path the UI (which prefers bySection)
  // rendered items with no `checked`/`purchaseUnits` — dead checkboxes and
  // invisible purchase units. Rebuild bySection from the decorated items.
  const decoratedByName = new Map(decorated.map((d) => [d.name, d]));
  const decoratedBySection = {};
  for (const [section, secItems] of Object.entries(bySection || {})) {
    decoratedBySection[section] = secItems.map((i) => decoratedByName.get(i.name) || i);
  }

  const list = await prisma.groceryList.upsert({
    where: { planId: plan.id },
    update: { items: decorated },
    create: { planId: plan.id, items: decorated },
  });
  res.json({ ...list, bySection: decoratedBySection, totalEstimatedCostCad, costCoverageNote });
});

router.get("/:planId/grocery-list", async (req, res) => {
  const list = await prisma.groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } });
  if (!list) return res.status(404).json({ error: "no grocery list generated yet for this plan" });
  res.json(list);
});

// Tick/untick a grocery item by name — persisted on the list so it survives
// tab switches (a regenerated list naturally resets its checkboxes).
router.put("/:planId/grocery-list/check", async (req, res) => {
  const { name, checked } = req.body || {};
  if (typeof name !== "string" || typeof checked !== "boolean") {
    return res.status(400).json({ error: "name (string) and checked (boolean) required" });
  }
  const list = await prisma.groceryList.findFirst({ where: { planId: req.params.planId, plan: { userId: req.userId } } });
  if (!list) return res.status(404).json({ error: "no grocery list for this plan" });
  const items = (list.items || []).map((i) => (i.name === name ? { ...i, checked } : i));
  const updated = await prisma.groceryList.update({ where: { id: list.id }, data: { items } });
  res.json(updated);
});

module.exports = router;
// Exposed for unit testing (attached to the router function; app.use unaffected).
module.exports.rebuildSlotFromClient = rebuildSlotFromClient;
module.exports.filterRecipePool = filterRecipePool;
