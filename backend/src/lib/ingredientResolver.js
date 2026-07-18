const { prisma } = require("./prisma.js");
const { searchFoods } = require("./usdaClient.js");
const { validateFood, checkNameShape } = require("./foodValidation.js");
const { classifyFood } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

// Token-overlap similarity — good enough for "chicken breast" matching
// "Chicken breast, cooked, skinless" without a fuzzy-match dependency.
function similarity(a, b) {
  const ta = new Set(normalize(a));
  const tb = new Set(normalize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

const MATCH_THRESHOLD = 0.6;

// Returns an existing or newly-created Food row for an ingredient name the
// AI proposed. Never fabricates macros — an existing match or a real USDA
// lookup, or (last resort) a flagged manual-placeholder with zeroed macros
// the user has to fill in themselves.
async function resolveIngredient(name) {
  const existing = await prisma.food.findMany();
  let best = null, bestScore = 0;
  for (const f of existing) {
    const score = similarity(name, f.name);
    if (score > bestScore) { bestScore = score; best = f; }
  }
  if (best && bestScore >= MATCH_THRESHOLD) return { food: best, matched: "existing" };

  try {
    const hits = await searchFoods(name, { pageSize: 5 });
    // Phase 2 guardrail: a hit must pass full food validation under its own
    // USDA name (rejects the zero-energy Foundation records AND internally
    // inconsistent data), and must not violate the SEARCHED name's implied
    // shape — this is exactly how "Porridge oats" once ended up storing
    // 884 kcal of oil data. Bad hits fall through to the next candidate.
    const usableHit = hits.find((h) => {
      const candidate = {
        name: h.name, category: h.category, kcal: h.per100g.kcal,
        protein: h.per100g.protein, fat: h.per100g.fat, carb: h.per100g.carb,
        fiber: h.per100g.fiber, source: "usda",
      };
      const own = validateFood(candidate, { exemptions: loadFoodOverrides() });
      const shapeVsRequest = checkNameShape({ ...candidate, name });
      return own.ok && shapeVsRequest.length === 0;
    });
    if (usableHit) {
      const food = await prisma.food.create({
        data: {
          name: usableHit.name, category: usableHit.category, fdcId: usableHit.fdcId,
          kcal: usableHit.per100g.kcal, protein: usableHit.per100g.protein, fat: usableHit.per100g.fat,
          carb: usableHit.per100g.carb, fiber: usableHit.per100g.fiber, source: "usda",
        },
      });
      return { food, matched: "usda" };
    }
  } catch (e) {
    // USDA lookup failed (network/key issue) — fall through to placeholder rather than blocking the whole draft
  }

  const food = await prisma.food.create({
    data: {
      name, category: classifyFood(name).category,
      kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0,
      source: "manual-placeholder",
    },
  });
  return { food, matched: "placeholder" };
}

module.exports = { resolveIngredient };
