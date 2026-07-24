// recipeTaste.js — Stage 3, filter #5 of five.
//
// A DETERMINISTIC palatability score in [0,1]. Pure function: no DB, no clock,
// no network. Optional online-review enrichment is a FUTURE hook, declared here
// and OFF in this build (see REVIEW_ENRICHMENT_HOOK at the bottom) — nothing in
// this file can make a network call.
//
// FOUR EVIDENCE TIERS, strongest last. Each tier that has data overrides the
// weaker one beneath it; a tier with no data is simply skipped (never scored as
// a phantom pass — LAW 7 / "solver declares unsolvable + why").
//
//   1. INGREDIENT SIGNAL  (weakest) — does this dish carry the things that make
//      food taste of something: fat, umami, aromatics, acid, sweet/heat. Five
//      independent flavour axes; the score is how many are present. This is a
//      floor, not an opinion — it can only say "this is a bare-bones dish" or
//      "this is a seasoned one".
//   2. CURATED TIER — Recipe.tasteTier, set by review ("decent" | "really_good"
//      | "exceptional"). Blended over the ingredient signal.
//   3. COMMUNITY AGGREGATE — Recipe.userRatingAvg / userRatingCount, the cached
//      mean of all RecipeRating rows, normalised 0..1. Only consulted with at
//      least one rating behind it.
//   4. THE USER'S OWN RATING (strongest) — a RecipeRating row for THIS user
//      (+1 like / -1 dislike). It dominates every tier above: what the owner
//      actually thinks of a dish outranks any inference about it. ("The user's
//      observed data beats the model's prediction.")
//
// A dislike DAMPENS, it never hard-excludes: taste is a ranking filter, not the
// allergy wall. Hard exclusion of food belongs to dietaryFilter and nowhere else.

// Flavour-axis probes. Matched as substrings against lowercased ingredient
// names + the recipe name. Deliberately coarse: this tier is a floor check, and
// a long precise list would just be an unmaintainable second food taxonomy.
const FLAVOUR_AXES = {
  fat: ["butter", "oil", "cream", "cheese", "bacon", "lard", "ghee", "coconut milk", "tahini", "mayonnaise", "yolk", "avocado", "nut", "seed oil"],
  umami: ["soy sauce", "fish sauce", "oyster sauce", "anchovy", "parmesan", "pecorino", "mushroom", "tomato puree", "tomato purée", "stock", "bouillon", "miso", "worcestershire", "marmite", "seaweed", "kombu", "bacon", "chorizo", "hoisin"],
  aromatic: ["garlic", "onion", "shallot", "leek", "ginger", "cumin", "coriander", "cilantro", "paprika", "cinnamon", "thyme", "rosemary", "basil", "parsley", "oregano", "curry", "masala", "bay leaf", "cardamom", "chive", "dill", "mint", "lemongrass", "spice"],
  acid: ["lemon", "lime", "vinegar", "wine", "yogurt", "yoghurt", "tamarind", "tomato", "pickle", "sour cream", "creme fraiche", "buttermilk"],
  sweetheat: ["sugar", "honey", "syrup", "molasses", "chilli", "chili", "cayenne", "jalapeno", "harissa", "pepper flake", "scotch bonnet", "hot sauce", "chocolate", "date", "raisin"],
};

const AXIS_KEYS = Object.keys(FLAVOUR_AXES);

// Ingredient-signal maps onto [FLOOR, CEIL] rather than [0,1]: a dish with zero
// detected flavour axes is bland, not inedible, and a dish with all five is
// promising, not guaranteed. Compressing the weakest evidence into a narrow
// band is what keeps it from outvoting the tiers above it.
const SIGNAL_FLOOR = 0.40;
const SIGNAL_CEIL = 0.70;

// Curated tier anchors. `null` tier ranks as "decent" and is never filtered out
// by default — that rule predates this file (see the schema comment on
// Recipe.tasteTier) and is preserved here.
const TIER_BASE = { decent: 0.55, really_good: 0.72, exceptional: 0.88 };
const TIER_WEIGHT = 0.65; // curated tier vs the ingredient signal beneath it
const AGGREGATE_WEIGHT = 0.50; // community mean vs everything beneath it

// The user's own verdict. A like floors the score near the top of the range; a
// dislike collapses it toward — but never to — zero, so a disliked recipe can
// still be chosen if it is the only thing that fits the macros. Silent removal
// would be the solver lying about its pool size.
const LIKE_FLOOR = 0.75;
const LIKE_RESIDUAL = 0.25;
const DISLIKE_SHRINK = 0.20;

const BANDS = [
  { key: "low", maxScore: 0.50 },
  { key: "decent", maxScore: 0.70 },
  { key: "good", maxScore: 0.85 },
  { key: "excellent", maxScore: 1.01 },
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round3 = (x) => Math.round(x * 1000) / 1000;

function ingredientHaystack(recipe) {
  const names = [];
  if (typeof recipe.name === "string") names.push(recipe.name);
  for (const ing of Array.isArray(recipe.ingredients) ? recipe.ingredients : []) {
    const n = ing?.food?.name || ing?.name;
    if (typeof n === "string") names.push(n);
  }
  return names.join(" | ").toLowerCase();
}

function detectAxes(haystack) {
  const hit = [];
  for (const axis of AXIS_KEYS) {
    if (FLAVOUR_AXES[axis].some((probe) => haystack.includes(probe))) hit.push(axis);
  }
  return hit;
}

// Pull this user's own rating out of whichever shape the caller has to hand:
// a Map<recipeId, rating> (what planContext builds), a plain object, or an
// explicit `rating` number. Anything else contributes nothing.
function ownRatingFor(recipe, opts) {
  if (Number.isFinite(opts?.rating)) return Number(opts.rating);
  const id = recipe?.id;
  if (id == null) return null;
  const r = opts?.ratings;
  if (r instanceof Map) {
    const v = r.get(id);
    return Number.isFinite(v) ? Number(v) : null;
  }
  if (r && typeof r === "object" && Object.hasOwn(r, id)) {
    const v = r[id];
    return Number.isFinite(v) ? Number(v) : null;
  }
  return null;
}

/**
 * computeTaste(recipe, opts) -> { score, band, source, factors }
 *   opts.ratings  Map<recipeId, +1|-1> — THIS user's ratings (planContext shape)
 *   opts.rating   number — an explicit override for a single-recipe call
 *
 * Deterministic and total. `source` names the strongest evidence tier that
 * actually contributed, so the UI can say WHY a dish ranked where it did.
 */
function computeTaste(recipe = {}, opts = {}) {
  const haystack = ingredientHaystack(recipe);
  const axes = detectAxes(haystack);
  const signal = axes.length / AXIS_KEYS.length;

  let score = SIGNAL_FLOOR + (SIGNAL_CEIL - SIGNAL_FLOOR) * signal;
  let source = "ingredient_signal";

  const tier = typeof recipe.tasteTier === "string" ? recipe.tasteTier : null;
  const tierBase = tier != null ? TIER_BASE[tier] : undefined;
  if (tierBase != null) {
    score = TIER_WEIGHT * tierBase + (1 - TIER_WEIGHT) * score;
    source = "curated_tier";
  }

  const ratingCount = Number.isFinite(recipe.userRatingCount) ? Number(recipe.userRatingCount) : 0;
  const ratingAvg = Number.isFinite(recipe.userRatingAvg) ? clamp01(Number(recipe.userRatingAvg)) : null;
  if (ratingCount > 0 && ratingAvg != null) {
    score = AGGREGATE_WEIGHT * ratingAvg + (1 - AGGREGATE_WEIGHT) * score;
    source = "community_aggregate";
  }

  const own = ownRatingFor(recipe, opts);
  if (own != null && own !== 0) {
    score = own > 0 ? LIKE_FLOOR + LIKE_RESIDUAL * score : DISLIKE_SHRINK * score;
    source = "user_rating";
  }

  score = clamp01(score);
  const band = BANDS.find((b) => score < b.maxScore).key;

  return {
    score: round3(score),
    band,
    source,
    factors: {
      flavourAxes: axes,
      axisCount: axes.length,
      axisTotal: AXIS_KEYS.length,
      tasteTier: tier,
      tasteTierSource: typeof recipe.tasteTierSource === "string" ? recipe.tasteTierSource : null,
      userRatingAvg: ratingAvg,
      userRatingCount: ratingCount,
      ownRating: own,
    },
    provenance: "estimated",
  };
}

function buildTasteCache(pool = [], opts = {}) {
  const cache = new Map();
  for (const r of pool) cache.set(r.id, computeTaste(r, opts));
  return cache;
}

// FUTURE HOOK — online review enrichment (Spoonacular/Edamam-style rating
// pulls). OFF in this build and never called. It exists as a named seam so the
// day it lands, the wiring point is obvious and reviewable rather than being
// bolted into computeTaste(). Turning it on is a deliberate code change plus a
// declared cadence, not a config flag flip.
const REVIEW_ENRICHMENT_HOOK = {
  enabled: false,
  provider: null,
  note: "zero-network build: computeTaste() reads only the recipe row and the user's own RecipeRating rows",
};

module.exports = {
  computeTaste,
  buildTasteCache,
  FLAVOUR_AXES,
  TIER_BASE,
  BANDS,
  REVIEW_ENRICHMENT_HOOK,
};
