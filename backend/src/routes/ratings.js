const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { recomputeAgg } = require("../lib/brain/taste.js");

const router = express.Router();
router.use(requireAuth);

// T (v2): after a rating changes, refresh the recipe's cached aggregate. Additive
// columns only — the deterministic solver never reads them (byte-identical), the
// brain scorer does. Fail-soft: an orphan rating (deleted recipe) is a no-op.
async function refreshRecipeAgg(recipeId) {
  const rows = await prisma.recipeRating.findMany({ where: { recipeId }, select: { rating: true } });
  const { userRatingAvg, userRatingCount } = recomputeAgg(rows);
  await prisma.recipe.updateMany({ where: { id: recipeId }, data: { userRatingAvg, userRatingCount } });
}

// T (v2) — recipe taste ratings. SOFT palatability only: re-ranks which recipes
// the solver PREFERS, never a displayed number (LAW 1) and never an override of
// a hard diet/allergy filter. rating: 1 (like) | -1 (dislike); no row = neutral.

router.get("/", async (req, res) => {
  const rows = await prisma.recipeRating.findMany({
    where: { userId: req.userId },
    select: { recipeId: true, rating: true },
  });
  res.json(rows);
});

router.put("/", async (req, res) => {
  const recipeId = typeof req.body?.recipeId === "string" ? req.body.recipeId : null;
  const rating = req.body?.rating;
  if (!recipeId) return res.status(400).json({ error: "recipeId required" });
  if (rating !== 1 && rating !== -1) return res.status(400).json({ error: "rating must be 1 (like) or -1 (dislike)" });
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  if (!recipe) return res.status(404).json({ error: "recipe not found" });
  const row = await prisma.recipeRating.upsert({
    where: { userId_recipeId: { userId: req.userId, recipeId } },
    update: { rating },
    create: { userId: req.userId, recipeId, rating },
    select: { recipeId: true, rating: true },
  });
  await refreshRecipeAgg(recipeId);
  res.json(row);
});

router.delete("/:recipeId", async (req, res) => {
  await prisma.recipeRating.deleteMany({ where: { userId: req.userId, recipeId: req.params.recipeId } });
  await refreshRecipeAgg(req.params.recipeId);
  res.status(204).end();
});

module.exports = router;
