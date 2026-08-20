// allergenSubstitutions.js — the rescue table for the recipe-adaptation layer.
//
// Directive §3.3.3: the ontology must know the SUBSTITUTIONS so cuisines get
// rescued instead of gutted — "soy and wheat allergy, loves Chinese food"
// stays a served customer because soy sauce becomes coconut aminos, not
// because Chinese food disappears from the pool.
//
// Trust model, stated plainly:
//   · Entries here are PROPOSALS for the adaptation layer (LLM or human).
//     They certify nothing. Every adapted recipe still passes the full
//     deterministic gate — exclusionGate + dietaryFilter + the sanity gate —
//     exactly like any other candidate. Belt and braces, per §3.3.1.
//   · `stillTrips` names what the replacement is STILL made of, so
//     substitutionsFor() never offers a rescue that violates the same
//     profile it is rescuing (GF tamari is a gluten rescue and a soy leak).
//   · A test locks the loop: every `use` string in this table is run
//     through the real matchesExclusionTerm against everything it claims
//     NOT to trip. A rescue the filter itself would deny cannot ship.

"use strict";

const SUBSTITUTIONS = [
  {
    avoid: /\bsoy sauce\b|\bshoyu\b/i,
    label: "soy sauce",
    rescues: ["soy", "gluten"],
    use: "coconut aminos",
    stillTrips: [],
    ratio: "1:1, slightly sweeter — reduce any added sugar a touch",
  },
  {
    avoid: /\bsoy sauce\b|\bshoyu\b/i,
    label: "soy sauce",
    rescues: ["gluten"],
    use: "gluten-free tamari",
    stillTrips: ["soy"],
    ratio: "1:1. Must be the GF-LABELLED product — trace-wheat tamari exists",
  },
  {
    avoid: /\btamari\b/i,
    label: "tamari",
    rescues: ["soy"],
    use: "coconut aminos",
    stillTrips: [],
    ratio: "1:1",
  },
  {
    avoid: /\bflour tortilla\b|\bwheat wrap\b|\bwheat tortilla\b/i,
    label: "wheat wrap",
    rescues: ["gluten"],
    use: "rice paper",
    stillTrips: [],
    ratio: "2 sheets per tortilla; soften in warm water",
  },
  {
    avoid: /\bflour tortilla\b|\bwheat tortilla\b/i,
    label: "flour tortilla",
    rescues: ["gluten"],
    use: "corn tortilla",
    stillTrips: [],
    ratio: "1:1 — smaller, so count up",
  },
  {
    avoid: /\boyster sauce\b/i,
    label: "oyster sauce",
    rescues: ["shellfish"],
    use: "mushroom vegetarian stir-fry sauce",
    stillTrips: ["gluten", "soy"],
    ratio: "1:1. Commercial versions are usually soy-sauce based — still wheat and soy",
  },
  {
    avoid: /\bfish sauce\b/i,
    label: "fish sauce",
    rescues: ["fish"],
    use: "coconut aminos",
    stillTrips: [],
    ratio: "1:1 plus a pinch of salt — misses the funk, carries the salt-sweet",
  },
  {
    avoid: /\bseitan\b|\bwheat gluten\b/i,
    label: "seitan",
    rescues: ["gluten"],
    use: "tempeh",
    stillTrips: ["soy"],
    ratio: "1:1 by weight as the protein lever",
  },
  {
    avoid: /\bbreadcrumbs?\b|\bpanko\b/i,
    label: "breadcrumbs",
    rescues: ["gluten"],
    // "crushed rice crackers" was the first draft; the property test caught
    // the real filter denying it — unlabelled crackers are a deliberate
    // celiac over-exclusion. The rescue the filter accepts is the same one
    // celiac guidance gives: the GF-LABELLED product.
    use: "gluten-free breadcrumbs",
    stillTrips: [],
    ratio: "1:1 by volume — must be the GF-labelled product",
  },
  {
    avoid: /\bwheat pasta\b|\bspaghetti\b|\bpenne\b|\bfettuccine\b/i,
    label: "wheat pasta",
    rescues: ["gluten"],
    use: "rice noodles",
    stillTrips: [],
    ratio: "1:1 dry weight; cooks faster",
  },
  {
    avoid: /\bhoisin\b/i,
    label: "hoisin sauce",
    rescues: ["gluten", "soy"],
    use: "coconut aminos reduced with a pinch of five-spice and a date",
    stillTrips: [],
    ratio: "reduce 2:1 to hoisin thickness",
  },
];

/**
 * substitutionsFor(ingredientName, exclusions) → [{ label, use, ratio, stillTrips }]
 *
 * Offers only rescues that (a) address at least one of the profile's
 * exclusions and (b) do not themselves trip anything else in the profile.
 * The caller re-verifies the adapted recipe through the real gate anyway —
 * this filter exists so the ADAPTATION layer is never even shown a bad idea.
 */
function substitutionsFor(ingredientName, exclusions = []) {
  const name = String(ingredientName || "");
  const profile = exclusions.map((e) => String(e).toLowerCase());
  return SUBSTITUTIONS.filter((s) => {
    if (!s.avoid.test(name)) return false;
    if (!s.rescues.some((r) => profile.includes(r))) return false;
    return !s.stillTrips.some((t) => profile.includes(t));
  }).map(({ label, use, ratio, stillTrips }) => ({ label, use, ratio, stillTrips }));
}

module.exports = { SUBSTITUTIONS, substitutionsFor };
