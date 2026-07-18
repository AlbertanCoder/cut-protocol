const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { validateFood, computeRecipeMacros } = require("../lib/foodValidation.js");
const { CATEGORY_SLUGS } = require("../lib/foodCategories.js");
const { loadFoodOverrides } = require("../lib/foodOverrides.js");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const foods = await prisma.food.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  res.json(foods);
});

const EDITABLE = ["name", "category", "kcal", "protein", "fat", "carb", "fiber"];
const r1 = (n) => Math.round(n * 10) / 10;

// Foods are a shared library (every recipe and plan reads them), so edits are
// admin-only — same policy recipes.js applies to library content. The Phase 2
// guardrail: nothing invalid gets written, and cached recipe macros are
// recomputed for every recipe that uses the edited food.
router.put("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user?.role !== "admin") {
    return res.status(403).json({ error: "food library edits are admin-only" });
  }
  const food = await prisma.food.findUnique({ where: { id: req.params.id } });
  if (!food) return res.status(404).json({ error: "food not found" });

  const patch = {};
  for (const key of EDITABLE) {
    if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  }
  const candidate = { ...food, ...patch };
  const { ok, issues } = validateFood(candidate, {
    exemptions: loadFoodOverrides(),
    validCategories: CATEGORY_SLUGS,
  });
  if (!ok) {
    return res.status(400).json({ error: "food fails validation", issues });
  }
  // A hand-edit supersedes whatever record the row pointed at before.
  if (patch.kcal !== undefined || patch.protein !== undefined || patch.fat !== undefined || patch.carb !== undefined) {
    patch.source = "manual";
  }

  try {
    const updated = await prisma.food.update({ where: { id: food.id }, data: patch });

    // Ripple: recipes cache per-serving macros — recompute every recipe that
    // contains this food so the caches never drift from their ingredients.
    const affected = await prisma.recipe.findMany({
      where: { ingredients: { some: { foodId: food.id } } },
      include: { ingredients: { include: { food: true } } },
    });
    for (const r of affected) {
      const t = computeRecipeMacros(r.ingredients);
      await prisma.recipe.update({
        where: { id: r.id },
        data: { kcal: r1(t.kcal), protein: r1(t.protein), fat: r1(t.fat), carb: r1(t.carb) },
      });
    }

    res.json({ food: updated, recipesRecomputed: affected.length });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a food named "${patch.name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
