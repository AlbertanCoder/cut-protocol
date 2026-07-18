// Per-serving recipe cost from the local editable CAD price table
// (groceryPrices.js — rough estimates, disclosed). Coverage-aware: a recipe
// whose ingredients mostly have no price match reports tier "unknown"
// rather than pretending a half-summed number is a real cost.
const { estimateCostCad } = require("./groceryPrices.js");

const TIERS = [
  { key: "cheap", maxCad: 3.5 },
  { key: "moderate", maxCad: 7 },
  { key: "premium", maxCad: Infinity },
];

function computeRecipeCost(recipe) {
  let costCad = 0;
  let costedGrams = 0;
  let totalGrams = 0;
  for (const ing of recipe.ingredients) {
    const grams = ing.baseGrams || 0;
    totalGrams += grams;
    const est = estimateCostCad(ing.food?.name || ing.name || "", grams);
    if (est) {
      costCad += est.amountCad;
      costedGrams += grams;
    }
  }
  const coverage = totalGrams > 0 ? costedGrams / totalGrams : 0;
  const tier = coverage < 0.5 ? "unknown" : TIERS.find((t) => costCad <= t.maxCad).key;
  return { costCad: Math.round(costCad * 100) / 100, coverage: Math.round(coverage * 100) / 100, tier };
}

function buildCostCache(pool) {
  const cache = new Map();
  for (const r of pool) cache.set(r.id, computeRecipeCost(r));
  return cache;
}

module.exports = { computeRecipeCost, buildCostCache, TIERS };
