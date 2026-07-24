// recipeCost.js — Stage 3, filter #2 of five (COST) + the composed five-filter API.
//
// ── WHY scoreRecipe() LIVES HERE ────────────────────────────────────────────
// The five filters are allergy (dietaryFilter.js — the wall, not ours), cost
// (this file), time (recipe.prepTimeMin), complexity (recipeComplexity.js) and
// taste (recipeTaste.js). The composed entrypoint scoreRecipe()/explainPool()
// is hosted here because mealSolver.js and routes/plans.js ALREADY import this
// module — wiring the full stack in is then an extra named import from a path
// they hold, not a new dependency edge. If a later stage wants a neutral
// facade, move these two functions to recipeFilters.js and re-export; nothing
// in this file depends on their location.
//
// ── COST MODEL ─────────────────────────────────────────────────────────────
// Per-serving ingredient cost from backend/data/ingredientCosts.json — a
// DETERMINISTIC, hand-maintained, region-agnostic CAD baseline. NOT a live
// grocery API. Live pricing is a future hook (LIVE_PRICING_HOOK below), OFF in
// this build; this module makes zero network calls and reads no clock.
//
// Two numbers are reported and they mean different things:
//   costCad  — the full estimate, INCLUDING a conservative price for every
//              unrecognised ingredient. This is the number you rank on.
//   coverage — the share of grams priced by a REAL table match, fallbacks
//              excluded. This is the number that tells you how much of the
//              above is a guess. Below 50% the tier degrades to "unknown" and
//              the caller must present it as unknown, not as a bargain.
//
// The fallback exists because $0-for-unknown is not a neutral default — it is a
// discount. A $0 default makes the recipes we understand LEAST look like the
// cheapest food in the library and hands them the top of a cost-ranked sort.
// See _meta.fallbackRule in ingredientCosts.json for the full argument; the
// short version is that unknown is priced at the 75th percentile of its
// category, so missing information is never rewarded.
const path = require("node:path");
const fs = require("node:fs");
const { computeComplexity } = require("./recipeComplexity.js");
const { computeTaste } = require("./recipeTaste.js");

const TABLE_PATH = path.join(__dirname, "..", "..", "data", "ingredientCosts.json");

// ── table load + derived fallbacks ─────────────────────────────────────────
const RAW_TABLE = JSON.parse(fs.readFileSync(TABLE_PATH, "utf8"));

// Longest keyword first. The old groceryPrices.js used first-match-wins over a
// hand-ordered array, so "Peanut Butter" hit the "peanut" row listed above it
// and was priced as nuts. Sorting by length makes the specific entry win by
// construction instead of by whoever last edited the ordering.
// FREE IS THE ONE PRICE THAT MAY NEVER BE AWARDED BY ACCIDENT. Every other
// entry matches as a plain substring — that is deliberate, it is what makes
// "Prawns" hit "prawn" and "Blueberries" hit "blueberr" without maintaining a
// plural list. But substring matching on a ZERO-priced entry is a trapdoor:
// "Watermelon" contains "water", so a naive include() prices a melon at $0.00
// and hands it the top of every cost-ranked sort. Zero-priced entries therefore
// require a WORD-BOUNDARY match. (Found by fiveFilters.test.js, not by review.)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEYWORDS = Object.entries(RAW_TABLE.keywords)
  .map(([kw, [cad, category]]) => ({
    kw,
    cad,
    category,
    boundaryRe: cad === 0 ? new RegExp(`(^|[^a-z0-9])${escapeRe(kw)}([^a-z0-9]|$)`) : null,
  }))
  .sort((a, b) => b.kw.length - a.kw.length || (a.kw < b.kw ? -1 : 1));

// Nearest-rank percentile — deterministic, no interpolation, no floating-point
// tie-break ambiguity across platforms.
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.max(0, Math.ceil(p * sortedAsc.length) - 1);
  return sortedAsc[Math.min(idx, sortedAsc.length - 1)];
}

// Derived AT LOAD from the table itself, so editing a price in the JSON can
// never leave a stale hard-coded fallback behind.
const FALLBACKS = (() => {
  const byCat = new Map();
  const all = [];
  for (const { cad, category } of KEYWORDS) {
    all.push(cad);
    if (!byCat.has(category)) byCat.set(category, []);
    byCat.get(category).push(cad);
  }
  all.sort((a, b) => a - b);
  const categories = {};
  for (const [cat, list] of byCat) {
    list.sort((a, b) => a - b);
    categories[cat] = percentile(list, 0.75);
  }
  return { global: percentile(all, 0.75), categories, tableSize: all.length };
})();

const NORMALISE_RE = /\s+/g;
function normaliseName(name) {
  return String(name || "").toLowerCase().replace(NORMALISE_RE, " ").trim();
}

/**
 * priceFor(name, category) -> { pricePer100g, matched, keyword, basis }
 * Never returns null and never returns an unexplained 0:
 *   basis "keyword"          — a real table entry matched the name
 *   basis "category-p75"     — unknown name, but the Food row's grocery
 *                              category gives us a defensible band
 *   basis "table-p75"        — unknown name AND unknown category
 * `matched` is true only for basis "keyword"; it is what coverage counts.
 */
function priceFor(name, category) {
  const n = normaliseName(name);
  if (n) {
    for (const entry of KEYWORDS) {
      const hit = entry.boundaryRe ? entry.boundaryRe.test(n) : n.includes(entry.kw);
      if (hit) {
        return { pricePer100g: entry.cad, matched: true, keyword: entry.kw, basis: "keyword" };
      }
    }
  }
  const catPrice = category != null ? FALLBACKS.categories[category] : undefined;
  if (catPrice != null) {
    return { pricePer100g: catPrice, matched: false, keyword: null, basis: "category-p75" };
  }
  return { pricePer100g: FALLBACKS.global, matched: false, keyword: null, basis: "table-p75" };
}

// Tier bands over the per-serving CAD estimate. Unchanged from the original
// module so existing budget-bias behaviour in mealSolver.buildBias() is not
// silently re-scaled by this rewrite.
const TIERS = [
  { key: "cheap", maxCad: 3.5 },
  { key: "moderate", maxCad: 7 },
  { key: "premium", maxCad: Infinity },
];

const COVERAGE_FLOOR = 0.5;

/**
 * computeRecipeCost(recipe) -> {
 *   costCad, costMatchedCad, costFallbackCad, coverage, tier,
 *   totalGrams, matchedGrams, unpricedNames, provenance
 * }
 * Pure. `recipe.ingredients[].baseGrams` are already PER SERVING (the schema's
 * cached macros are per serving at scale=1), so this is a per-serving cost.
 */
function computeRecipeCost(recipe = {}) {
  let costMatchedCad = 0;
  let costFallbackCad = 0;
  let matchedGrams = 0;
  let totalGrams = 0;
  const unpricedNames = [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

  for (const ing of ingredients) {
    const grams = Number(ing?.baseGrams) || 0;
    if (!Number.isFinite(grams) || grams <= 0) continue;
    totalGrams += grams;
    const name = ing?.food?.name || ing?.name || "";
    const category = ing?.food?.category ?? ing?.category ?? null;
    const p = priceFor(name, category);
    const amount = p.pricePer100g * (grams / 100);
    if (p.matched) {
      costMatchedCad += amount;
      matchedGrams += grams;
    } else {
      costFallbackCad += amount;
      unpricedNames.push(name || "(unnamed ingredient)");
    }
  }

  const costCad = Math.round((costMatchedCad + costFallbackCad) * 100) / 100;
  const coverage = totalGrams > 0 ? matchedGrams / totalGrams : 0;
  const tier = coverage < COVERAGE_FLOOR ? "unknown" : TIERS.find((t) => costCad <= t.maxCad).key;

  return {
    costCad,
    costMatchedCad: Math.round(costMatchedCad * 100) / 100,
    costFallbackCad: Math.round(costFallbackCad * 100) / 100,
    coverage: Math.round(coverage * 100) / 100,
    tier,
    totalGrams: Math.round(totalGrams * 10) / 10,
    matchedGrams: Math.round(matchedGrams * 10) / 10,
    unpricedNames,
    provenance: "estimated",
  };
}

function buildCostCache(pool = []) {
  const cache = new Map();
  for (const r of pool) cache.set(r.id, computeRecipeCost(r));
  return cache;
}

// FUTURE HOOK — live grocery pricing (flyer/retail API). OFF, never called, no
// transport imported. Named so the wiring point is reviewable when it lands.
const LIVE_PRICING_HOOK = {
  enabled: false,
  provider: null,
  note: "zero-network build: cost comes only from backend/data/ingredientCosts.json",
};

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPOSED FIVE-FILTER API
// ═══════════════════════════════════════════════════════════════════════════
//
// COMPOSITION LAW (from the Stage 3 spec, not negotiable):
//   • ALLERGY + DIET + MACRO TARGETS gate the pool. They are HARD, they run
//     UPSTREAM (dietaryFilter.js / planContext.filterRecipePool), and NOTHING
//     in this file may re-implement, re-check or weaken them. A recipe reaching
//     scoreRecipe() is already allergy-safe; if it is not, the bug is upstream
//     and scoring it here would only hide that.
//   • COST / TIME / COMPLEXITY / TASTE are OPTIONAL HARD CAPS — enforced only
//     when the user actually sets one — PLUS a ranking score over the
//     survivors.
//   • NO FILTER IS EVER SILENTLY DROPPED. A cap that cannot be evaluated is
//     reported in `unevaluable`, never assumed passed. When a stack empties the
//     pool, explainPool() NAMES the binding constraint rather than returning a
//     fake-green plan.

const DEFAULT_WEIGHTS = { cost: 0.25, time: 0.25, complexity: 0.20, taste: 0.30 };

// Normalisation anchors used only for RANKING (never for pass/fail). A $10
// serving and a 90-minute cook are the practical ceilings of this library; past
// them the rank term simply saturates at 0.
const COST_ANCHOR_CAD = 10;
const TIME_ANCHOR_MIN = 90;

const CAP_KEYS = ["cost", "time", "complexity", "taste"];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function readPrefs(prefs = {}) {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const w = { ...DEFAULT_WEIGHTS };
  if (prefs.weights && typeof prefs.weights === "object") {
    for (const k of CAP_KEYS) {
      const v = Number(prefs.weights[k]);
      if (Number.isFinite(v) && v >= 0) w[k] = v;
    }
  }
  const sum = CAP_KEYS.reduce((a, k) => a + w[k], 0) || 1;
  for (const k of CAP_KEYS) w[k] /= sum;
  return {
    maxCostCad: num(prefs.maxCostCad),
    maxTimeMin: num(prefs.maxTimeMin ?? prefs.maxPrepMin),
    maxComplexity: num(prefs.maxComplexity),
    minTaste: Number.isFinite(Number(prefs.minTaste)) ? Number(prefs.minTaste) : null,
    ratings: prefs.ratings ?? null,
    rating: prefs.rating,
    // Matches mealSolver.applyPrepFilter()'s long-standing behaviour: a recipe
    // with no prepTimeMin is NOT removed by a time cap. Flipping this to "fail"
    // is a deliberate opt-in, and either way `time.known:false` is reported so
    // an unknown is never mistaken for a measurement.
    unknownTimePolicy: prefs.unknownTimePolicy === "fail" ? "fail" : "pass",
    weights: w,
    minSurvivors: Number.isInteger(prefs.minSurvivors) && prefs.minSurvivors > 0 ? prefs.minSurvivors : 1,
  };
}

function recipeTimeMin(recipe) {
  const v = Number(recipe?.prepTimeMin);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * scoreRecipe(recipe, prefs) -> {
 *   recipeId, cost, time, complexity, taste,
 *   passesHardCaps, violations, bindingConstraint, unevaluable, rank, weights
 * }
 *
 * Deterministic and pure: no DB, no network, no clock. Callable identically on
 * a persisted Recipe row (with ingredients+food included) and on an unsaved AI
 * draft, which is what lets the library path and the AI path share one scorer.
 *
 * `bindingConstraint` here is per-recipe: the FIRST cap this recipe fails, in
 * the fixed order cost → time → complexity → taste. For the pool-level question
 * ("why is my plan empty?") use explainPool(), which is the honest-fail path.
 */
function scoreRecipe(recipe = {}, prefs = {}) {
  const p = readPrefs(prefs);

  const cost = computeRecipeCost(recipe);
  const complexity = computeComplexity(recipe);
  const taste = computeTaste(recipe, { ratings: p.ratings, rating: p.rating });
  const timeMin = recipeTimeMin(recipe);
  const time = { min: timeMin, known: timeMin != null, provenance: "row" };

  const violations = [];
  const unevaluable = [];

  if (p.maxCostCad != null) {
    if (cost.costCad > p.maxCostCad) violations.push("cost");
    // A cost estimate below the coverage floor is still USED (it is the best
    // number available and it is conservative), but the caller is told the
    // evidence is thin so it can surface that rather than imply precision.
    if (cost.tier === "unknown") unevaluable.push("cost:low-coverage");
  }
  if (p.maxTimeMin != null) {
    if (timeMin == null) {
      unevaluable.push("time:unknown");
      if (p.unknownTimePolicy === "fail") violations.push("time");
    } else if (timeMin > p.maxTimeMin) violations.push("time");
  }
  if (p.maxComplexity != null && complexity.score > p.maxComplexity) violations.push("complexity");
  if (p.minTaste != null && taste.score < p.minTaste) violations.push("taste");

  const costCeiling = p.maxCostCad ?? COST_ANCHOR_CAD;
  const timeCeiling = p.maxTimeMin ?? TIME_ANCHOR_MIN;
  const costScore = 1 - clamp01(cost.costCad / costCeiling);
  const timeScore = timeMin == null ? 0.5 : 1 - clamp01(timeMin / timeCeiling);
  const complexityScore = 1 - (complexity.score - 1) / 9;
  const tasteScore = taste.score;

  const rank =
    p.weights.cost * costScore +
    p.weights.time * timeScore +
    p.weights.complexity * complexityScore +
    p.weights.taste * tasteScore;

  return {
    recipeId: recipe?.id ?? null,
    cost,
    time,
    complexity,
    taste,
    passesHardCaps: violations.length === 0,
    violations,
    bindingConstraint: violations.length ? CAP_KEYS.find((k) => violations.includes(k)) : null,
    unevaluable,
    rank: Math.round(rank * 10000) / 10000,
    rankTerms: {
      cost: Math.round(costScore * 1000) / 1000,
      time: Math.round(timeScore * 1000) / 1000,
      complexity: Math.round(complexityScore * 1000) / 1000,
      taste: Math.round(tasteScore * 1000) / 1000,
    },
    weights: p.weights,
  };
}

/**
 * explainPool(recipes, prefs) -> {
 *   total, survivorCount, survivors, activeCaps, perCap, liftGain,
 *   ok, bindingConstraint, message, unevaluable
 * }
 *
 * THE HONEST-FAIL PATH. Applies the optional caps to an already-compliant pool
 * and, when the stack leaves too few recipes, names WHICH cap is doing it —
 * measured, by lifting one cap at a time and counting what comes back. If no
 * single lift is enough, it says "combined" and shows the per-cap numbers
 * rather than guessing. It never returns a green result on an empty pool.
 *
 * The input pool must ALREADY be allergy/diet filtered. explainPool never
 * suggests loosening an allergy and cannot, because it has no allergy input.
 */
function explainPool(recipes = [], prefs = {}) {
  const p = readPrefs(prefs);
  const pool = Array.isArray(recipes) ? recipes : [];
  const scored = pool.map((r) => ({ recipe: r, s: scoreRecipe(r, prefs) }));

  const activeCaps = CAP_KEYS.filter((k) => {
    if (k === "cost") return p.maxCostCad != null;
    if (k === "time") return p.maxTimeMin != null;
    if (k === "complexity") return p.maxComplexity != null;
    return p.minTaste != null;
  });

  const survivorsAll = scored.filter((x) => x.s.passesHardCaps);
  const perCap = {};
  const liftGain = {};
  for (const k of activeCaps) {
    perCap[k] = {
      failed: scored.filter((x) => x.s.violations.includes(k)).length,
      passedAlone: scored.filter((x) => !x.s.violations.includes(k)).length,
    };
    // Survivors if THIS cap alone were lifted (all others still enforced).
    liftGain[k] = scored.filter((x) => x.s.violations.every((v) => v === k)).length - survivorsAll.length;
  }

  const unevaluable = [...new Set(scored.flatMap((x) => x.s.unevaluable))];
  const ok = survivorsAll.length >= p.minSurvivors;

  let bindingConstraint = null;
  let message;
  if (ok) {
    message = `${survivorsAll.length} of ${pool.length} recipes clear the filter stack (${activeCaps.length ? activeCaps.join(", ") : "no optional caps set"}).`;
  } else if (activeCaps.length === 0) {
    // Empty with no caps set means the pool arrived empty — an upstream
    // (allergy/diet/macro) problem. Say so; do not invent a cap to blame.
    bindingConstraint = "pool";
    message = "The recipe pool was already empty before any cost/time/complexity/taste cap was applied — the binding constraint is upstream (diet, allergies or the macro targets), not these filters.";
  } else {
    let best = null;
    for (const k of activeCaps) if (liftGain[k] > 0 && (best === null || liftGain[k] > liftGain[best])) best = k;
    if (best) {
      bindingConstraint = best;
      message = `No plan: ${survivorsAll.length} recipe(s) clear all caps. The binding constraint is ${best.toUpperCase()} — lifting it alone returns ${liftGain[best] + survivorsAll.length} recipe(s). Every other cap stays enforced.`;
    } else {
      bindingConstraint = "combined";
      const detail = activeCaps.map((k) => `${k} removes ${perCap[k].failed}`).join("; ");
      message = `No plan: ${survivorsAll.length} recipe(s) clear all caps, and lifting any SINGLE cap does not fix it — the constraints are binding in combination (${detail}). Loosen more than one, or widen the pool.`;
    }
  }

  return {
    total: pool.length,
    survivorCount: survivorsAll.length,
    survivors: survivorsAll.map((x) => x.recipe),
    scored,
    activeCaps,
    perCap,
    liftGain,
    unevaluable,
    ok,
    bindingConstraint,
    message,
  };
}

module.exports = {
  // cost (filter #2)
  computeRecipeCost,
  buildCostCache,
  priceFor,
  normaliseName,
  TIERS,
  FALLBACKS,
  KEYWORDS,
  COST_TABLE_META: RAW_TABLE._meta,
  LIVE_PRICING_HOOK,
  // composed five-filter API
  scoreRecipe,
  explainPool,
  DEFAULT_WEIGHTS,
  CAP_KEYS,
};
