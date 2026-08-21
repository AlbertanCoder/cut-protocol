// prescription/preferenceBias.js — soft-preference multiplier for the day
// solver's candidate sampling.
//
// The solver has carried a `bias` hook since day one — "a MULTIPLIER, never
// a veto" (daySolver.sampleCandidates) — and nothing ever passed one: the
// profile's cuisinePreferences and mealPreferencesNote columns existed and
// were writable, and the food they described never changed. The 250-customer
// fleet (2026-08-20) read that gap out loud: mediterranean profiles got
// Tex-Mex burrito bowls and coconut-aminos stir-fries, picky eaters got
// "a world tour", spice lovers got "not one chili flake in two days".
//
// CONTRACT: this returns a multiplier over candidate recipes, or null when
// the profile expresses no preference. It can never empty a pool, never
// override a gate, and never beats the protein/fat fit terms outright —
// hard rules (allergens, style) stay hard, taste stays soft.

"use strict";

// Words the appetite note can carry. Deliberately small and literal — this
// is a nudge, not NLP; anything it cannot read leaves the bias neutral.
const PLAIN_RE = /\b(plain|simple|familiar|picky|basic|no[\s-]?frills)\b/i;
const SPICY_RE = /\b(spicy|spice|heat|hot[\s-]?sauce|chili|chilli)\b/i;

// What "reads as spicy" in a recipe name — the same literalness.
const SPICY_NAME_RE = /\b(chili|chilli|chipotle|jalapeno|jalapeño|harissa|sriracha|cayenne|scotch bonnet|curry|szechuan|sichuan|gochujang|piri[\s-]?piri|spicy|arrabbiata|diablo)\b/i;

// Multipliers. Explicit preferences pull harder than the implied
// mediterranean-style pull; penalties never go near zero (soft, not a veto).
const CUISINE_PREF_BOOST = 2.5;
const CUISINE_PREF_PENALTY = 0.6;
const CUISINE_IMPLIED_BOOST = 1.8;
const CUISINE_IMPLIED_PENALTY = 0.75;
const PLAIN_FUSSY_PENALTY = 0.5; // >9 ingredient rows
const PLAIN_SIMPLE_BOOST = 1.5; // ≤6 ingredient rows
const SPICY_BOOST = 2.0;
const SPICY_AVOID_PENALTY = 0.6; // plain eaters steered away from heat

/**
 * buildPreferenceBias(profile) → ((recipe) => multiplier) | null
 *
 * profile: { cuisinePreferences?, mealPreferencesNote?, dietaryStyle? }.
 * A mediterranean DIETARY STYLE implies a soft pull toward recipes tagged
 * cuisine:"mediterranean" — the style's exclusion lattice is deliberately
 * only the hard "avoid" core (processed meat, sugary drinks), and the fleet
 * showed the pattern half needs at least a nudge. Explicit
 * cuisinePreferences override the implied pull entirely.
 */
function buildPreferenceBias(profile) {
  if (!profile) return null;
  const explicit = (Array.isArray(profile.cuisinePreferences) ? profile.cuisinePreferences : [])
    .map((c) => String(c).toLowerCase().trim())
    .filter(Boolean);
  const implied = explicit.length === 0 && profile.dietaryStyle === "mediterranean" ? ["mediterranean"] : [];
  const cuisines = explicit.length ? explicit : implied;
  const boost = explicit.length ? CUISINE_PREF_BOOST : CUISINE_IMPLIED_BOOST;
  const penalty = explicit.length ? CUISINE_PREF_PENALTY : CUISINE_IMPLIED_PENALTY;

  const note = String(profile.mealPreferencesNote || "");
  const wantsPlain = PLAIN_RE.test(note);
  const wantsSpicy = SPICY_RE.test(note);

  if (!cuisines.length && !wantsPlain && !wantsSpicy) return null;

  return (r) => {
    let m = 1;
    // Untagged recipes (most of the pool) stay neutral on cuisine — the
    // bias only moves what the classifier actually labelled.
    if (cuisines.length && r.cuisine) {
      m *= cuisines.includes(String(r.cuisine).toLowerCase()) ? boost : penalty;
    }
    if (wantsPlain) {
      const rows = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      if (rows > 9) m *= PLAIN_FUSSY_PENALTY;
      else if (rows > 0 && rows <= 6) m *= PLAIN_SIMPLE_BOOST;
      if (SPICY_NAME_RE.test(r.name || "")) m *= SPICY_AVOID_PENALTY;
    }
    if (wantsSpicy && SPICY_NAME_RE.test(r.name || "")) m *= SPICY_BOOST;
    return m;
  };
}

module.exports = { buildPreferenceBias };
