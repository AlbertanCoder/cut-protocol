const { prisma } = require("./prisma.js");
const { searchFoods } = require("./usdaClient.js");

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

function guessCategoryFromName(name) {
  const s = name.toLowerCase();
  if (/(butter|oil|nuts?|seeds?)/.test(s)) return "fat";
  if (/(milk|yogurt|cheese|dairy)/.test(s)) return "dairy";
  if (/(pepper|cucumber|broccoli|spinach|lettuce|salad|greens|vegetable)/.test(s)) return "veg";
  if (/(rice|potato|bread|pasta|grain|oat|cereal|bean|legume)/.test(s)) return "carb";
  if (/(beef|pork|poultry|chicken|turkey|fish|seafood|sausage|meat|egg)/.test(s)) return "protein";
  if (/(fruit|berry|berries|apple|banana)/.test(s)) return "fruit";
  return "other";
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
    // Some USDA "Foundation" records are detailed analytical entries (fatty
    // acid breakdowns, vitamins) with no general macro data at all — e.g.
    // "Oil, canola" (fdcId 748278) has 38 nutrients and not one of them is
    // energy/protein/fat/carb. Taking the top hit blindly created several
    // real all-zero foods. Skip hits with no usable macro data and try the
    // next candidate instead of silently accepting an empty record.
    const usableHit = hits.find((h) => h.per100g.kcal > 0 || h.per100g.protein > 0 || h.per100g.fat > 0 || h.per100g.carb > 0);
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
      name, category: guessCategoryFromName(name),
      kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0,
      source: "manual-placeholder",
    },
  });
  return { food, matched: "placeholder" };
}

module.exports = { resolveIngredient };
