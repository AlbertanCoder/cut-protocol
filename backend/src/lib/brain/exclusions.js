// Brain v3 — the exclusion engine (LAW 2: zero-tolerance exclusions).
//
// This file is now a THIN ADAPTER over ../exclusionGate.js and holds no
// exclusion logic of its own. It used to hold a second implementation, and
// that implementation was weaker than the solver's in two ways at once: it
// checked ingredient NAMES only (no recipe title, no "Add'l ingredients:"
// prose, no step text) and it dropped `ing.food` before matching, discarding
// the persisted fdcCategory / allergenTags / mayContain metadata. Measured
// against the real 889-recipe library that was 210 recipe/allergy pairs the
// deterministic solver correctly hid and the brain pool still handed to the
// model — so the "the model never sees an excluded item" guarantee below was
// true about the pool and false about the recipes.
//
// The guarantees are unchanged; only their implementation moved:
//   • TRANSITIVE — a recipe inherits the union of its ingredients' exclusions.
//     (The current schema has no sub-recipes: a Recipe's ingredients are Food
//     rows. If nested sub-recipes are ever added, extend the gate's
//     collectEvidence() and nothing else.)
//   • FAIL-CLOSED — an item that cannot be resolved to checkable evidence is
//     not "probably fine", it is treated as EXCLUDED and flagged, never
//     surfaced. The gate additionally fails closed when an ingredient row
//     names a persisted Food it did not LOAD — the exact shape this file used
//     to produce — so the old weakening cannot be reintroduced silently.
//   • AUTHORITATIVE-ONLY — exclusions are computed in code from
//     profile.dietaryStyle + profile.excludedFoods, never from LLM output,
//     conversation memory, or user free-text.
//
// It still adds NO vocabulary of its own: the gate delegates every keyword
// decision to dietaryFilter.js's exhaustive, regression-locked maps, so the
// brain's notion of "excluded" can never drift from the solver's.
const { explainExclusion, isExcluded, isCheckableName } = require("../exclusionGate.js");

/**
 * explainExclusion(item, profile) -> { excluded, failClosed, reason }
 *   reason is a short machine-usable tag ("unresolvable-ingredient",
 *   "ingredient-metadata-not-loaded", "dietary-style", "keto-ceiling",
 *   `excluded-food:<term>`, "unresolvable-food", "food-filtered") or null when
 *   not excluded. failClosed is true only for the fail-closed paths, so
 *   callers can LOG those specifically (LAW 2).
 *
 * isExcluded(item, profile) -> boolean
 *   The LAW-2 public predicate. The model can never overrule it; the pool is
 *   built from it (before any LLM turn) and the verifier re-runs it after
 *   every turn.
 *
 * Re-exported rather than re-declared so `require("./exclusions.js")` and
 * `require("../exclusionGate.js")` are the same function object — two names
 * for one authority, which is the whole point.
 */
module.exports = { isExcluded, explainExclusion, isCheckableName };
