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

const { isExcluded } = require("../exclusionGate.js");

// Words the appetite note can carry. Deliberately small and literal — this
// is a nudge, not NLP; anything it cannot read leaves the bias neutral.
const PLAIN_RE = /\b(plain|simple|familiar|picky|basic|no[\s-]?frills)\b/i;
const SPICY_RE = /\b(spicy|spice|heat|hot[\s-]?sauce|chili|chilli)\b/i;

// "I dislike fish" — the fleet's most-asked-for missing field (~20 reviews:
// the only way to keep fish off the plate was to lie and call it an
// allergy). The note can carry it now. Terms are a curated list, matched in
// the note by a dislike verb, and matched against candidate dishes through
// the exclusion GATE with a dislikes-only pseudo-profile — so "dislike
// fish" sees Smoked Haddock exactly the way a fish allergy would (all four
// probes, full vocabulary), just softly.
const DISLIKE_VERBS = /(?:dislikes?|hates?|can(?:'|no)?t stand|avoids?|no)\s+([a-z\s]+)/gi;
const DISLIKABLE_TERMS = [
  "fish", "seafood", "shellfish", "eggs", "mushroom", "tofu", "cilantro",
  "coriander", "olives", "onion", "liver", "lamb", "pork",
];
const DISLIKE_PENALTY = 0.15;

function dislikesIn(note) {
  const found = new Set();
  for (const m of String(note || "").matchAll(DISLIKE_VERBS)) {
    const tail = m[1].toLowerCase();
    for (const t of DISLIKABLE_TERMS) if (tail.includes(t)) found.add(t);
  }
  return [...found];
}

// What "reads as spicy" in a recipe name — the same literalness.
const SPICY_NAME_RE = /\b(chili|chilli|chipotle|jalapeno|jalapeño|harissa|sriracha|cayenne|scotch bonnet|curry|szechuan|sichuan|gochujang|piri[\s-]?piri|spicy|arrabbiata|diablo)\b/i;

// Heat hides in ingredient lists under bland names ("Thai-style steamed
// fish" carries the scotch bonnet; slice 4's spice-lovers got "trace
// chilli" because only NAMES were read). One pass over the rows.
function readsSpicy(r) {
  if (SPICY_NAME_RE.test(r.name || "")) return true;
  const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
  return ings.some((i) => SPICY_NAME_RE.test((i?.food?.name || i?.name || "")));
}

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
  const dislikes = dislikesIn(note);

  if (!cuisines.length && !wantsPlain && !wantsSpicy && !dislikes.length) return null;

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
    if (wantsSpicy && readsSpicy(r)) m *= SPICY_BOOST;
    if (dislikes.length && isExcluded(r, { excludedFoods: dislikes })) m *= DISLIKE_PENALTY;
    return m;
  };
}

/**
 * partitionByPreference(list, profile) → { preferred, note }
 *
 * The two-pass upgrade (2026-08-22): a soft multiplier still loses to
 * macro fit when the pool is deep — slice 4's fish-disliker got salmon
 * AND tuna, and every picky eater still toured the world. `preferred` is
 * the subset a dish-level preference can hold for EVERY dish:
 *   - none of the customer's DISLIKES (gate-checked, full vocabulary)
 *   - not fussier than a plain eater tolerates, when the note says plain
 *   - not a TAGGED-mismatching cuisine, when cuisines are chosen
 *     (untagged rows stay in — absence of a tag is not a mismatch)
 * Spice is deliberately NOT here: "loves spicy" means SOME heat, not six
 * hot dishes a day — it stays a sampling boost. The caller falls back to
 * the full list whenever `preferred` is too thin to sample from; taste
 * must never make a day unsolvable.
 */
function partitionByPreference(list, profile) {
  if (!profile) return { preferred: list, note: null };
  // Only EXPLICIT cuisine choices partition; the mediterranean-style
  // implied pull stays a bias multiplier — hard-partitioning a whole pool
  // on an inference would trip the fallback constantly and change nothing.
  const cuisines = (Array.isArray(profile.cuisinePreferences) ? profile.cuisinePreferences : [])
    .map((c) => String(c).toLowerCase().trim())
    .filter(Boolean);
  const note = String(profile.mealPreferencesNote || "");
  const wantsPlain = PLAIN_RE.test(note);
  const dislikes = dislikesIn(note);
  if (!cuisines.length && !wantsPlain && !dislikes.length) return { preferred: list, note: null };

  const preferred = list.filter((r) => {
    if (dislikes.length && isExcluded(r, { excludedFoods: dislikes })) return false;
    if (wantsPlain) {
      const rows = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      if (rows > 9) return false;
      if (SPICY_NAME_RE.test(r.name || "")) return false;
    }
    if (cuisines.length && r.cuisine && !cuisines.includes(String(r.cuisine).toLowerCase())) return false;
    return true;
  });
  return { preferred, note: preferred.length < list.length ? "preference-first" : null };
}

module.exports = { buildPreferenceBias, partitionByPreference };
