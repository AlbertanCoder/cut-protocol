// Name-vs-FDC-description agreement, and the deliberately narrow re-matching
// rule used to repair corrupted provenance.
//
// WHY THIS IS NOT A FUZZY MATCHER
// ------------------------------------------------------------------------
// The corruption this repairs was caused by scored name similarity: recomp-v1
// matched recipe ingredient lines to FDC records by token overlap, and
// "Red Curry Paste" scored high enough against "Nuts, almond paste" to inherit
// its fdcId and its 458 kcal. Any threshold-on-a-similarity-score approach has
// that failure mode by construction — somewhere on the scale there is always a
// wrong food that scores just above the line.
//
// So there is no score here. Both directions are set containment, and every
// decision is explainable as a list of tokens:
//
//   R ⊆ F   the row name may not introduce a token the FDC description lacks
//           ("curry", "tahini", "galangal" are instantly disqualifying)
//   F ⊆ R   the FDC description's distinguishing tokens must all appear in the
//           row name ("Rice" cannot claim "Rice crackers"; "Tomato" cannot
//           claim "Tomato powder")
//
// Only two vocabularies soften the second direction, both documented below:
// FDC's leading taxonomy noun ("Nuts, almond paste" → "almond paste") and a
// short list of preparation qualifiers. Nothing else. When the rule cannot
// decide, the answer is "suspect" — and a suspect row is downgraded, never
// guessed at.

const { nameKey } = require("../../src/lib/foodValidation.js");

const tokenize = (s) => nameKey(s || "").split(" ").filter(Boolean);
const stemSet = (words) => new Set(tokenize(words.join(" ")));

// Grammatical filler and FDC bookkeeping words: present or absent, they never
// change which food is being described.
const FILLER = stemSet([
  "and", "or", "with", "without", "added", "from", "made", "of", "in", "on",
  "the", "a", "an", "nfs", "ns", "all", "types", "varieties", "including",
  "includes", "usda", "commodity", "each", "plus", "other", "not", "further",
  "specified", "as", "to", "for", "by", "any",
]);

// Leading taxonomy nouns in FDC's "Group, item, modifiers" description style.
// Dropped ONLY from the front of a comma-bearing description, ONLY when
// content tokens remain — so "Nuts, almond paste" can be claimed by
// "Almond Paste", while "Cheese, cheddar" can still never be claimed by the
// bare name "Cheese" (that would leave "cheddar" unaccounted for).
const TAXONOMY_PREFIX = stemSet([
  "nuts", "seeds", "spices", "herbs", "soup", "soups", "beverages", "beverage",
  "cereals", "snacks", "sweets", "candies", "desserts", "fish", "shellfish",
  "mollusks", "crustaceans", "cheese", "milk", "yogurt", "cream", "sugars",
  "syrups", "oil", "oils", "fat", "fats", "egg", "eggs", "beef", "pork",
  "lamb", "veal", "poultry", "chicken", "turkey", "vegetables", "fruits",
  "legumes", "babyfood", "gelatins", "puddings", "toppings", "frostings",
  "leavening", "seaweed", "salad", "sauce", "sauces", "alcoholic", "infant",
  "formulated", "restaurant", "snack", "crackers", "cookies", "bread", "rolls",
  "pie", "pasta", "noodles", "potatoes", "mushrooms", "peppers", "onions",
  "beans", "peas", "melons", "berries",
]);

// Qualifiers that describe who made it or that it is an unprepared base —
// dropped only from the "FDC must be covered by the row name" direction.
const PREP_QUALIFIER = stemSet([
  "home", "prepared", "homemade", "commercial", "recipe", "unprepared",
  "industrial", "retail",
]);

// Cooking-state words. These move macros by up to 3x (raw vs cooked rice), so
// they are NEVER dropped when ASSIGNING a new fdcId. They are dropped in one
// narrow case only — see `agreement()` — when judging an fdcId a row ALREADY
// carries, where the row's numbers demonstrably came from that record and the
// only discrepancy is that the app's display name is terser than FDC's
// ("Blueberries" vs "Blueberries, raw").
const SOFT_STATE = stemSet([
  "raw", "cooked", "boiled", "steamed", "microwaved", "grilled", "broiled",
  "roasted", "baked", "braised", "stewed",
]);
// Forms that change water content or composition so much they are a different
// food. Never droppable anywhere.
const HARD_STATE = stemSet([
  "dried", "dehydrated", "canned", "frozen", "powder", "powdered",
  "concentrate", "concentrated", "smoked", "cured", "fried", "candied",
]);

// Dialect / spelling equivalences between the app's (British-leaning) food
// names and USDA's (American) descriptions. Each entry is a statement of fact
// about naming — an aubergine IS an eggplant — not a similarity judgement, and
// each is individually reviewable. This is the ONLY place a token may be
// rewritten before comparison.
//
// Deliberately EXCLUDED, because they are not identities:
//   capsicum→pepper   (capsicum is the genus; "pepper" also means peppercorn)
//   coriander→cilantro (UK "coriander" is the seed AND the leaf; USDA splits
//                       them, and they have completely different macros)
//   chilli→pepper     (the exact conflation that put banana-pepper macros on
//                       Habanero, Kampot and Sichuan "Pepper" rows)
const SYNONYM = new Map(Object.entries({
  aubergine: "eggplant",
  courgette: "zucchini",
  rocket: "arugula",
  beetroot: "beet",
  swede: "rutabaga",
  maize: "corn",
  groundnut: "peanut",
  prawn: "shrimp",
  yoghurt: "yogurt",
  chilli: "chili",
  chile: "chili",
  choi: "choy",
  tinned: "canned",
  wholemeal: "wholewheat",
  sultana: "raisin",
  minced: "ground",
  mince: "ground",
}).map(([k, v]) => [tokenize(k)[0], tokenize(v)[0]]));

const canon = (t) => SYNONYM.get(t) || t;

/** Content tokens of a name: stemmed, filler removed, synonyms canonicalized. */
function contentTokens(name) {
  return new Set(tokenize(name).filter((t) => !FILLER.has(t)).map(canon));
}

/**
 * The tokens of an FDC description that MUST be accounted for by a candidate
 * name: content tokens minus the leading taxonomy noun and prep qualifiers.
 */
function requiredTokens(description) {
  const all = tokenize(description).filter((t) => !FILLER.has(t)).map(canon);
  let rest = all;
  // Drop a single leading taxonomy noun, only in FDC's comma-list style, and
  // only when something identifying survives.
  if (description.includes(",") && all.length > 1 && TAXONOMY_PREFIX.has(all[0])) {
    const candidate = all.slice(1);
    if (candidate.some((t) => !PREP_QUALIFIER.has(t))) rest = candidate;
  }
  return new Set(rest.filter((t) => !PREP_QUALIFIER.has(t)));
}

const missingFrom = (needed, have) => [...needed].filter((t) => !have.has(t));
const canonical = (set) => [...set].sort().join(" ");

/**
 * Does `rowName` genuinely denote the food that `description` describes?
 * Returns { verdict: "likely-correct" | "suspect", reason, stateRelaxed? }.
 *
 * This judges an fdcId a row ALREADY carries. Conservative by design: anything
 * the containment rules cannot settle is "suspect", because a suspect row is
 * re-derived or honestly downgraded, whereas a wrongly-confident row keeps
 * shipping a wrong number.
 *
 * One narrow relaxation: when the ONLY unaccounted-for tokens are soft cooking
 * states and the row name states no conflicting one, the verdict is
 * likely-correct with `stateRelaxed: true`. Rationale — "Blueberries" carrying
 * FDC "Blueberries, raw" is a terser display name, not a different food, and
 * the row's macros already come from that record, so keeping the pointer
 * asserts nothing new. The caller surfaces these separately in the audit.
 */
function agreement(rowName, description) {
  const R = contentTokens(rowName);
  const F = contentTokens(description);
  if (R.size === 0 || F.size === 0) {
    return { verdict: "suspect", reason: "name or FDC description has no content tokens" };
  }
  const extra = missingFrom(R, F);
  if (extra.length) {
    return {
      verdict: "suspect",
      reason: `name introduces token(s) the FDC description does not have: ${extra.join(", ")}`,
    };
  }
  const missing = missingFrom(requiredTokens(description), R);
  if (missing.length === 0) {
    return { verdict: "likely-correct", reason: "name and FDC description denote the same food" };
  }
  // Everything still unaccounted for is a soft cooking state, and the row name
  // does not claim a different one?
  const allSoftState = missing.every((t) => SOFT_STATE.has(t));
  const rowStates = [...R].filter((t) => SOFT_STATE.has(t) || HARD_STATE.has(t));
  if (allSoftState && rowStates.length === 0) {
    return {
      verdict: "likely-correct",
      stateRelaxed: true,
      reason: `name matches the FDC food; FDC additionally states preparation "${missing.join(", ")}" which the name leaves implicit`,
    };
  }
  return {
    verdict: "suspect",
    reason: `FDC description carries distinguishing token(s) the name lacks: ${missing.join(", ")}`,
  };
}

// ── re-matching a suspect row against the full FDC corpus ────────────────

/**
 * Index normalized FDC records for exact-containment lookup.
 * records: [{ fdcId, description, priority, macros, ... }]
 */
function buildMatchIndex(records) {
  const exact = new Map();
  for (const rec of records) {
    const full = contentTokens(rec.description);
    if (full.size === 0) continue;
    const entry = { ...rec, tokensFull: full };
    const ek = canonical(full);
    if (!exact.has(ek)) exact.set(ek, []);
    exact.get(ek).push(entry);
  }
  return { exact };
}

/**
 * Find the one FDC record a name unambiguously denotes, or explain why not.
 *
 * The ONLY accepted evidence is exact content-token equality between the name
 * and the FDC description. Nothing weaker.
 *
 * An earlier revision also accepted "the name equals the description's
 * distinguishing tokens after dropping FDC's leading taxonomy noun". Run
 * against the real corpus that rule proposed "Onion" -> "Bread, onion",
 * "Tomato" -> "Soup, tomato", "Garlic" -> "Roll, garlic" and "Zucchini" ->
 * "Bread, zucchini" — i.e. it reproduced the exact bug class this track is
 * repairing, because for those descriptions the leading noun IS the food and
 * the trailing word is the flavour. It was removed. Two genuinely good matches
 * ("Jalapeno", "Mozzarella") were lost with it; they are downgraded honestly
 * instead, which is the correct trade.
 *
 * Ambiguity is a refusal, not a tie-break: if two materially different
 * descriptions both qualify, no match is returned. Identical descriptions
 * appearing in several datasets are the same food, and resolve to the
 * highest-quality tier (Foundation > SR Legacy > Survey).
 *
 * Returns { ok:true, record, tier } | { ok:false, reason, candidates? }
 */
function findConfidentMatch(rowName, index) {
  const R = contentTokens(rowName);
  if (R.size === 0) return { ok: false, reason: "name has no content tokens" };
  const key = canonical(R);

  const tier = "exact-token-set";
  const candidates = index.exact.get(key) || [];
  if (candidates.length === 0) return { ok: false, reason: "no FDC description has exactly this name's tokens" };

  const byFood = new Map();
  for (const c of candidates) {
    const k = canonical(c.tokensFull);
    if (!byFood.has(k)) byFood.set(k, []);
    byFood.get(k).push(c);
  }
  if (byFood.size > 1) {
    return {
      ok: false,
      reason: `ambiguous — ${byFood.size} materially different FDC descriptions match`,
      candidates: [...byFood.values()].map((g) => g[0].description),
    };
  }
  const group = [...byFood.values()][0];
  const record = group.slice().sort((a, b) => a.priority - b.priority)[0];
  return { ok: true, record, tier };
}

module.exports = {
  tokenize,
  contentTokens,
  requiredTokens,
  agreement,
  buildMatchIndex,
  findConfidentMatch,
  FILLER,
  TAXONOMY_PREFIX,
  PREP_QUALIFIER,
  SOFT_STATE,
  HARD_STATE,
};
