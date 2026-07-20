// Brain v3 — the exclusion engine (LAW 2: zero-tolerance exclusions).
//
// Exclusions are computed IN CODE, from the AUTHORITATIVE user profile ONLY
// (profile.dietaryStyle + profile.excludedFoods) — never from LLM output,
// conversation memory, or user free-text. isExcluded() is:
//   • TRANSITIVE — a recipe inherits the union of its ingredients' exclusions.
//     (The current schema has no sub-recipes: a Recipe's ingredients are Food
//     rows, so the closure is recipe → ingredient foods → names. If nested
//     sub-recipes are ever added, extend collectNames() and nothing else.)
//   • FAIL-CLOSED — an ingredient we cannot resolve to a checkable NAME is not
//     "probably fine", it is treated as EXCLUDED and flagged, never surfaced.
//     (With no allergen-tag columns in the schema, "untagged/unknown" == "no
//     resolvable name to run the exhaustive exclusion vocab against". When the
//     schema later gains explicit allergen tags, tighten the checkable test to
//     "has an allergen tag" — the fail-closed direction stays identical.)
//
// It adds NO vocabulary of its own: every keyword decision is delegated to
// dietaryFilter.js's exhaustive, regression-locked maps, so the brain's notion
// of "excluded" can never drift from the deterministic solver's.
const {
  recipeExcludedByStyle,
  matchesExclusionTerm,
  recipeExceedsKetoCeiling,
  applyDietaryFilters,
} = require("../dietaryFilter.js");

// A name is checkable iff it's a non-empty string we can run the vocab against.
// Anything else (null food ref, missing/blank name, non-string) is unresolvable.
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
function isRecipe(item) {
  return item && Array.isArray(item.ingredients);
}

// Every ingredient name in a recipe, resolved the same way the solver does
// (food.name first, then a bare .name fallback for AI/imported shapes).
function ingredientNames(recipe) {
  return (recipe.ingredients || []).map((i) => (i.food?.name ?? i.name));
}

/**
 * explainExclusion(item, profile) -> { excluded, failClosed, reason }
 *   reason is a short machine-usable tag ("unresolvable-ingredient",
 *   "dietary-style", "keto-ceiling", `excluded-food:<term>`, "food-filtered")
 *   or null when not excluded. failClosed is true only for the fail-closed
 *   (unresolvable) path, so callers can LOG those specifically (LAW 2).
 */
function explainExclusion(item, profile) {
  const { dietaryStyle, excludedFoods } = normProfile(profile);

  if (isRecipe(item)) {
    const names = ingredientNames(item);
    // FAIL-CLOSED first: if a recipe has NO ingredients at all, or ANY ingredient
    // can't be resolved to a checkable name, we cannot prove the recipe is safe →
    // exclude it, flagged. An empty ingredient list (bad importer draft, partial
    // delete, missing rows) is "unprovable", not "safe" (LAW 2).
    if (names.length === 0 || names.some((n) => !isCheckableName(n))) {
      return { excluded: true, failClosed: true, reason: "unresolvable-ingredient" };
    }
    const flat = { ingredients: names.map((name) => ({ name })) };
    if (recipeExceedsKetoCeiling(item, dietaryStyle)) {
      return { excluded: true, failClosed: false, reason: "keto-ceiling" };
    }
    if (recipeExcludedByStyle(flat, dietaryStyle)) {
      return { excluded: true, failClosed: false, reason: "dietary-style" };
    }
    for (const term of excludedFoods) {
      if (names.some((n) => matchesExclusionTerm(n, term))) {
        return { excluded: true, failClosed: false, reason: `excluded-food:${String(term).trim().toLowerCase()}` };
      }
    }
    return { excluded: false, failClosed: false, reason: null };
  }

  // Flat food.
  if (!isCheckableName(item?.name)) {
    return { excluded: true, failClosed: true, reason: "unresolvable-food" };
  }
  // Reuse the solver's exact food-level filter (style + list + per-100g keto).
  // An empty result means this single food was filtered out == excluded.
  if (applyDietaryFilters([item], { dietaryStyle, excludedFoods }).length === 0) {
    return { excluded: true, failClosed: false, reason: "food-filtered" };
  }
  return { excluded: false, failClosed: false, reason: null };
}

// LAW-2 public predicate. The model can never overrule this; the pool is built
// from it (before any LLM turn) and the verifier re-runs it after every turn.
function isExcluded(item, profile) {
  return explainExclusion(item, profile).excluded;
}

module.exports = { isExcluded, explainExclusion, isCheckableName };
