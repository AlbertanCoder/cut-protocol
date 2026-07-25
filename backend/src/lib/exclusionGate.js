// THE EXCLUSION GATE — the single authority on "may this user see this recipe?"
//
// ── why this file exists ──────────────────────────────────────────────────
// Five surfaces answered that question and only ONE of them answered it
// properly. planContext.filterRecipePool read four evidence sources
// (ingredient rows WITH their persisted allergen metadata, the importer's
// "Add'l ingredients:" prose, the recipe TITLE, and the full step text); the
// library browse (routes/recipes.js), the cart→grocery path (routes/cart.js),
// the brain pool (lib/brain/exclusions.js) and the AI-swap fallback
// (lib/weeklyPlanner.js) each flattened the recipe to `ingredient names only`
// and matched against that. Measured against the real 889-recipe library that
// is 210 recipe/allergy pairs the solver correctly hides and the other
// surfaces still show — e.g.
//
//   • "Roasted Eggplant With Tahini, Pine Nuts, and Lentils" — tahini appears
//     in the TITLE only, with no tahini ingredient row → shown to a
//     sesame-allergic user in the library, the cart and the chat.
//   • "Beef Banh Mi Bowls with Sriracha Mayo…" — step 1 reads
//     "Add'l ingredients: mayonnaise, siracha", no mayo row → egg.
//   • "Sushi" — step 3: "half a prawn or a small piece of smoked salmon".
//   • "Singapore Noodles with Shrimp" — "the peanut or canola oil".
//   • "Challah" — "sprinkle with the poppy or sesame seeds".
//
// The bug was never the vocabulary. It was that the same question had five
// implementations, so a fix to one of them fixed one surface. This module is
// the one implementation.
//
// ── the design rule: the weak path must be UNREACHABLE, not discouraged ───
// Three mechanisms, in increasing order of how much they'd hurt to bypass:
//
//   1. THE GATE OWNS THE EVIDENCE. explainRecipeExclusion() takes the RECIPE,
//      never a caller-prepared list of names. There is no parameter through
//      which a surface can hand in a weaker view of the recipe; the four
//      evidence sources are collected in here, by this file, every time. A
//      surface cannot under-check by accident because it has nothing to
//      under-check WITH.
//   2. A DEGRADED RECIPE FAILS CLOSED. The one way left to weaken the gate is
//      to hand it a recipe object whose evidence was already stripped — which
//      is exactly what the brain pool did (it dropped `ing.food`, discarding
//      fdcCategory / allergenTags / mayContain). collectEvidence() detects
//      that shape — an ingredient row that names a persisted Food (foodId) but
//      did not load it — and returns EXCLUDED + failClosed, not "probably
//      fine". Stripping metadata now over-blocks loudly instead of
//      under-blocking silently, which is the only acceptable direction for an
//      allergy.
//   3. RECIPE_GATE_SELECT + a source scan. Loading a recipe with this module's
//      selection is what makes mechanism 2 pass. tests/exclusionGate.test.js
//      additionally scans src/ and fails if any file outside a frozen
//      known-offenders list imports the recipe-level primitives directly
//      (recipeExcludedByStyle / recipeExceedsKetoCeiling /
//      additionalIngredientNames / matchesExclusionTerm). A NEW surface that
//      reaches around the gate breaks the build.
//
// ── what it deliberately does NOT do ──────────────────────────────────────
// It adds no allergen vocabulary of its own. Every keyword, compound token,
// synonym and metadata probe stays in dietaryFilter.js, whose maps are
// regression-locked. This file decides WHAT EVIDENCE gets asked about; that
// file decides what the answer is. Keeping those separate is why the brain's
// notion of "excluded" cannot drift from the solver's.
const {
  recipeExcludedByStyle,
  foodMatchesExclusionTerm,
  recipeExceedsKetoCeiling,
  additionalIngredientNames,
  applyDietaryFilters,
} = require("./dietaryFilter.js");

// ── the load contract ─────────────────────────────────────────────────────
// The Prisma selection that makes a recipe gate-ready. Every surface that
// loads recipes for a user to SEE must use this (or a superset). It exists as
// an exported constant rather than a comment because mechanism 2 above can
// only fail closed on missing metadata — it cannot invent it — so the fix for
// a fail-closed recipe is always "load it with this".
//
// Food.micros is deliberately absent: 40+ nutrients per food is ~1.8 MB of the
// pool payload and nothing on the exclusion or solve path reads it
// (routes/micronutrients.js loads its own foods). Everything the gate probes
// (name, fdcCategory, allergenTags, mayContain) and everything the solver
// scales (kcal/protein/fat/carb/fiber) is here.
const FOOD_GATE_SELECT = {
  id: true, name: true, category: true,
  kcal: true, protein: true, fat: true, carb: true, fiber: true,
  source: true, dataQuality: true, fdcId: true,
  // the three metadata probes — dropping any of these silently downgrades the
  // four-probe union to a name check, which is the bug this module exists for
  fdcCategory: true, allergenTags: true, mayContain: true,
};

const RECIPE_GATE_SELECT = {
  id: true, name: true, description: true,
  // steps carry allergens that never became ingredient rows — evidence, not
  // display copy. A select that drops them re-opens the leak.
  steps: true,
  slotType: true, cuisine: true, prepTimeMin: true, source: true, mealCategory: true,
  kcal: true, protein: true, fat: true, carb: true,
  tasteTier: true, tasteTierSource: true, userRatingAvg: true, userRatingCount: true,
  costPerServing: true, difficulty: true, filterProvenance: true,
  aiFingerprint: true, aiVerifiedAt: true, createdAt: true, createdByUserId: true,
  ingredients: {
    select: {
      id: true, recipeId: true, foodId: true, baseGrams: true, scalable: true, role: true,
      food: { select: FOOD_GATE_SELECT },
    },
  },
};

// ── shared helpers ────────────────────────────────────────────────────────

// A name is checkable iff it's a non-empty string we can run the vocab
// against. Anything else (null food ref, blank name, non-string) is
// unresolvable — and unresolvable is not "safe", it's unprovable.
function isCheckableName(name) {
  return typeof name === "string" && name.trim().length > 0;
}

function normProfile(profile) {
  return {
    dietaryStyle: profile?.dietaryStyle || "none",
    excludedFoods: Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [],
  };
}

// An item is a Recipe if it carries an ingredients array; otherwise a flat Food.
function isRecipeShape(item) {
  return !!item && Array.isArray(item.ingredients);
}

// ── evidence collection (mechanism 1) ─────────────────────────────────────
/**
 * collectEvidence(recipe) -> { rows, gap }
 *
 * `rows` is everything the matchers are allowed to see, as food-shaped
 * objects. Rows sourced from an ingredient carry the WHOLE Food row so the
 * metadata probes have something to read; rows synthesised from prose or the
 * title carry only a name, which foodMatchesExclusionTerm handles natively
 * (absent metadata simply contributes no evidence).
 *
 * `gap` is non-null when the recipe cannot be checked at full strength, and
 * names which shape failure it is. A gap is a fail-closed exclusion.
 */
function collectEvidence(recipe) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : null;
  // No ingredient list at all — a bad importer draft, a partial delete, a
  // caller that passed the wrong object. Unprovable, therefore excluded.
  if (!ingredients || ingredients.length === 0) {
    return { rows: [], gap: "unresolvable-ingredient" };
  }

  const rows = [];
  for (const ing of ingredients) {
    const food = ing?.food ?? null;
    const name = food?.name ?? ing?.name;
    // ORDER MATTERS. Namelessness is checked first so a row with neither a
    // loaded Food nor a name reports the honest "we cannot read this at all"
    // reason rather than the narrower metadata one.
    if (!isCheckableName(name)) return { rows: [], gap: "unresolvable-ingredient" };
    // MECHANISM 2. The row names a persisted Food (it has a foodId) but that
    // Food was not loaded. A name IS present, so a weaker checker would sail
    // through on name-only evidence and never notice the three metadata probes
    // came back empty — that is precisely how the brain pool was under-
    // checking. Refuse instead: load it with RECIPE_GATE_SELECT.
    if (!food && ing?.foodId != null) return { rows: [], gap: "ingredient-metadata-not-loaded" };
    // Carry the whole Food row, not just its name. Stripping to { name } here
    // is what made the persisted allergen metadata inert on the only path that
    // mattered: fdcCategory / allergenTags / mayContain were written to the DB
    // and then thrown away one function before the matcher.
    rows.push(food || { name });
  }

  // Defence-in-depth: any "Add'l ingredients:" the importer left in the step
  // text but never turned into ingredient rows, so an allergen declared only
  // in prose (mayonnaise -> egg) can't slip past.
  for (const extra of additionalIngredientNames(recipe.steps)) rows.push({ name: extra });

  // The recipe's own NAME is evidence and was read by nothing. A dish is
  // routinely named after an ingredient its rows omit — "Egg Drop Soup" has no
  // egg row, "Roasted Eggplant With Tahini, Pine Nuts" has no tahini row — so
  // those reached egg- and sesame-excluded users. Add-only: a title can raise
  // an exclusion, never clear one.
  if (isCheckableName(recipe.name)) rows.push({ name: recipe.name });

  // The FULL step text is evidence too. The importer routinely leaves an
  // ingredient in the instructions without ever creating a row for it — "stir
  // in 1 TBSP butter", a Sushi step naming raw salmon/prawn — and the "Add'l
  // ingredients:" parser above catches only ~1 in 889 of those.
  //
  // This over-excludes: a step reading "serve without butter" or "dairy-free
  // version" will drop a genuinely-safe recipe. That is the deliberate, and
  // per the constitution the ONLY acceptable, failure direction for an allergy
  // — a lost safe recipe beats a medical incident. Negation parsing
  // ("without", "-free") was rejected on purpose: "add butter, or omit for a
  // dairy-free version" carries a negation word yet DOES cook butter in, so a
  // negation-aware scan would re-open the exact leak this closes.
  const stepText = Array.isArray(recipe.steps)
    ? recipe.steps.join("  ")
    : (recipe.steps == null ? "" : String(recipe.steps));
  if (stepText.trim()) rows.push({ name: stepText });

  return { rows, gap: null };
}

// ── the verdicts ──────────────────────────────────────────────────────────
/**
 * explainRecipeExclusion(recipe, profile) -> { excluded, failClosed, reason }
 *
 * reason is a short machine-usable tag — "unresolvable-ingredient",
 * "ingredient-metadata-not-loaded", "keto-ceiling", "dietary-style",
 * `excluded-food:<term>` — or null when not excluded. failClosed is true only
 * on the shape-gap paths so callers can LOG those specifically (LAW 2).
 *
 * The fail-closed screen runs BEFORE the profile is consulted and regardless
 * of whether the profile carries any rules. That is on purpose and it is what
 * makes every surface agree: "this recipe cannot be read" is a property of the
 * recipe, not of the eater, so it cannot be allowed to depend on which surface
 * asked. Measured against the real library it hides nothing — 0 of 889 recipes
 * have an empty ingredient list, a null food or a blank food name.
 */
function explainRecipeExclusion(recipe, profile) {
  const { dietaryStyle, excludedFoods } = normProfile(profile);
  const { rows, gap } = collectEvidence(recipe);
  if (gap) return { excluded: true, failClosed: true, reason: gap };

  if (recipeExceedsKetoCeiling(recipe, dietaryStyle)) {
    return { excluded: true, failClosed: false, reason: "keto-ceiling" };
  }
  // recipeExcludedByStyle reads `.name` off each row, so the same evidence set
  // feeds the style check and the allergy check — they can't see different
  // recipes.
  if (recipeExcludedByStyle({ ingredients: rows }, dietaryStyle)) {
    return { excluded: true, failClosed: false, reason: "dietary-style" };
  }
  for (const term of excludedFoods) {
    // foodMatchesExclusionTerm, not matchesExclusionTerm: the former consults
    // the metadata probes as well as the name, and is the function the
    // add-only union was built for. Rows synthesised from prose/title carry
    // only a name, which it handles.
    if (rows.some((row) => foodMatchesExclusionTerm(row, term))) {
      return { excluded: true, failClosed: false, reason: `excluded-food:${String(term).trim().toLowerCase()}` };
    }
  }
  return { excluded: false, failClosed: false, reason: null };
}

/**
 * Flat (non-recipe) Food verdict. Reuses the solver's own food-level filter so
 * a single food and a food-as-ingredient can never disagree.
 */
function explainFoodExclusion(food, profile) {
  const { dietaryStyle, excludedFoods } = normProfile(profile);
  if (!isCheckableName(food?.name)) {
    return { excluded: true, failClosed: true, reason: "unresolvable-food" };
  }
  if (applyDietaryFilters([food], { dietaryStyle, excludedFoods }).length === 0) {
    return { excluded: true, failClosed: false, reason: "food-filtered" };
  }
  return { excluded: false, failClosed: false, reason: null };
}

// Dispatching form — recipes and flat foods, one entry point.
function explainExclusion(item, profile) {
  return isRecipeShape(item) ? explainRecipeExclusion(item, profile) : explainFoodExclusion(item, profile);
}

// The public predicate. The model can never overrule it, an LLM turn is
// verified against it, and every recipe surface is built from it.
function isExcluded(item, profile) {
  return explainExclusion(item, profile).excluded;
}

// Positive form, for the surfaces that read as "may I show this?".
function recipeAllowed(recipe, profile) {
  return !explainRecipeExclusion(recipe, profile).excluded;
}

/**
 * partitionRecipes(recipes, profile) -> { allowed, blocked }
 *
 * `blocked` carries { recipe, reason, failClosed } so a caller can report WHY
 * without re-running the check (silent shrinkage is banned — every surface
 * that hides something has to be able to say how much and why).
 */
function partitionRecipes(recipes, profile) {
  const allowed = [];
  const blocked = [];
  for (const recipe of recipes || []) {
    const verdict = explainRecipeExclusion(recipe, profile);
    if (verdict.excluded) blocked.push({ recipe, reason: verdict.reason, failClosed: verdict.failClosed });
    else allowed.push(recipe);
  }
  return { allowed, blocked };
}

// Convenience filter for callers that only want the survivors.
function filterRecipes(recipes, profile) {
  return partitionRecipes(recipes, profile).allowed;
}

module.exports = {
  RECIPE_GATE_SELECT,
  FOOD_GATE_SELECT,
  explainExclusion,
  explainRecipeExclusion,
  explainFoodExclusion,
  isExcluded,
  recipeAllowed,
  partitionRecipes,
  filterRecipes,
  isCheckableName,
  // exported for the gate's own tests only — no surface should need it
  collectEvidence,
};
