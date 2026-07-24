const { prisma } = require("./prisma.js");
const { searchFoods } = require("./usdaClient.js");
const { validateFood, checkNameShape } = require("./foodValidation.js");
const { classifyFood } = require("./foodCategories.js");
const { loadFoodOverrides } = require("./foodOverrides.js");

// ---------------------------------------------------------------------------
// WHY THIS FILE IS PARANOID  (fleet finding food-data-1, fixed 2026-07-23)
//
// Until this rewrite, resolveIngredient() picked a Food row with a
// token-overlap `similarity()` score and a MATCH_THRESHOLD of 0.6:
//
//     similarity("almond butter", "Butter")
//       = overlap(1) / min(|{almond,butter}|, |{butter}|)   = 1 / 1 = 1.0
//
// A perfect score. The nut butter was SILENTLY REWRITTEN into the dairy row
// "Butter" — different macros, different allergen profile, no flag, no review
// item, and the recipe was then saved with `food.name` (the dairy name) as the
// ingredient. That is an allergen-erasure path: a dairy-allergic user's recipe
// could contain dairy and the UI would never say so. The food table has since
// grown to ~14k rows, which makes a confident wrong match MORE likely, not less.
//
// The fuzzy scorer is gone. It is not behind a flag — a fuzzy path that can be
// re-enabled is a fuzzy path. What replaces it is a deterministic ladder:
//
//   1. exact      — normalised names are identical
//   2. alias      — hand-curated synonym table below, nothing inferred
//   3. containment— the candidate name is the query PLUS non-substantive
//                   descriptors only ("chicken breast" -> "Chicken breast, raw")
//   4. anything weaker -> NOT RESOLVED. status "needs_review", the original
//                   query text kept verbatim, plus display-only suggestions.
//
// Every accepted match additionally has to clear an allergen-root equality
// check (see ALLERGEN_ROOTS). An unresolved ingredient is never renamed, never
// substituted, and never inherits another food's macros: it lands on a
// zero-macro manual placeholder that carries the user's own words, exactly as
// typed, and is flagged `needsReview: true` for a human to finish.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeTokens(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const normalizeKey = (s) => normalizeTokens(s).join(" ");

// ---------------------------------------------------------------------------
// Tier 2 — hand-curated alias table.
//
// EXPLICIT ONLY. Every entry is a synonym a cook would call the SAME
// ingredient, written out by hand, both spellings where they differ. Nothing
// here is inferred, stemmed, or learned. Adding an entry that changes what a
// person would actually eat is how the 2026-07-23 bug comes back.
// Keys and values are pre-normalised (lowercase, single-spaced).
// ---------------------------------------------------------------------------
const ALIASES = new Map(Object.entries({
  // UK / AU / IN -> US produce names
  "aubergine": "eggplant",
  "aubergines": "eggplant",
  "brinjal": "eggplant",
  "courgette": "zucchini",
  "courgettes": "zucchini",
  "capsicum": "bell pepper",
  "capsicums": "bell pepper",
  "rocket": "arugula",
  "swede": "rutabaga",
  "pak choi": "bok choy",
  "spring onion": "green onion",
  "spring onions": "green onions",
  "scallion": "green onion",
  "scallions": "green onions",
  "coriander leaves": "cilantro",
  "sultanas": "golden raisins",
  "desiccated coconut": "shredded coconut",

  // Baking / pantry
  "bicarbonate of soda": "baking soda",
  "bicarb soda": "baking soda",
  "cornflour": "cornstarch",          // UK "cornflour" IS cornstarch. NOT the
                                      // same as US two-word "corn flour" —
                                      // that one is deliberately absent.
  "icing sugar": "powdered sugar",
  "confectioners sugar": "powdered sugar",
  "caster sugar": "superfine sugar",
  "plain flour": "all purpose flour",

  // Dairy (allergen class preserved on both sides)
  "double cream": "heavy cream",
  "single cream": "light cream",

  // Allergen-class-changing aliases — each one is listed in
  // ALIAS_ROOT_EXCEPTIONS below with the reason it is safe.
  "prawn": "shrimp",
  "prawns": "shrimp",
  "soya": "soy",
  "soya milk": "soy milk",
  "soya sauce": "soy sauce",
  "groundnut": "peanut",
  "groundnuts": "peanuts",
}));

// An alias whose allergen roots differ from its canonical form is a red flag —
// it is exactly the shape of the bug this file exists to prevent. Spelling
// variants that name the SAME allergen (prawn/shrimp, soya/soy,
// groundnut/peanut) are handled properly in ROOT_EQUIVALENCE below, so they
// are NOT exceptions and must not be listed here.
//
// This map is empty by design. If a future alias genuinely has to change an
// allergen root set, it needs an entry here spelling out why that is safe —
// `ingredientResolver.test.js` fails the build otherwise, and separately fails
// if any alias DROPS a root.
const ALIAS_ROOT_EXCEPTIONS = {};

// ---------------------------------------------------------------------------
// Tier 3 — descriptor allowlist (CURATED AND CLOSED).
//
// A containment match is only accepted when every EXTRA token the candidate
// carries is on this list. Two hard rules for anything added here:
//
//   1. It must not name a food, a food class, or an allergen. ("nuts", "meat",
//      "oil", "salt" are food words and are deliberately absent.)
//   2. It must not materially change macro density. Dehydration and
//      concentration words are therefore BANNED: dried / dehydrated /
//      powdered / powder / concentrate / condensed / evaporated / instant.
//      Phase 2 already shipped a bug where "Milk" carried MILK POWDER data
//      (61 kcal/100g vs 496) — that is what those words do.
//      Fat-adding preparations are banned for the same reason: fried,
//      breaded, battered, buttered, creamed, "in oil".
// ---------------------------------------------------------------------------
const DESCRIPTOR_TOKENS = new Set([
  // state / preparation that keeps the food the same food
  "raw", "uncooked", "cooked", "unprepared", "prepared", "fresh", "frozen",
  "chilled", "refrigerated", "boiled", "steamed", "roasted", "baked",
  "grilled", "broiled", "braised", "poached", "blanched",
  // packing / handling
  "canned", "drained", "undrained", "rinsed", "peeled", "unpeeled", "pitted",
  "skinless", "boneless", "trimmed", "untrimmed", "shelled", "husked",
  // cut / form (no density change)
  "whole", "halves", "halved", "quartered", "pieces", "sliced", "slices",
  "diced", "cubed", "chopped", "minced", "shredded", "grated", "crushed",
  "ground",
  // seasoning state
  "unsalted", "salted", "unsweetened", "plain", "unseasoned", "seasoned",
  // catalogue / provenance noise
  "usda", "commodity", "generic", "nfs", "unspecified", "average", "all",
  "types", "type", "variety", "varieties", "regular", "standard", "organic",
  "conventional", "natural", "commercially", "commercial", "prepackaged",
  // size grading
  "large", "medium", "small", "extra", "jumbo", "baby", "mini",
]);

// Multi-token descriptor clauses, stripped as contiguous sequences before the
// single-token pass. Same two rules as above.
const DESCRIPTOR_PHRASES = [
  ["without", "salt", "added"],
  ["with", "salt", "added"],
  ["no", "salt", "added"],
  ["without", "added", "salt"],
  ["salt", "added"],
  ["meat", "only"],
  ["bone", "in"],
  ["skin", "on"],
  ["skin", "removed"],
  ["not", "further", "specified"],
  ["ready", "to", "eat"],
  ["all", "types"],
  ["all", "varieties"],
  ["food", "grade"],
];

// Grammatical filler. Never substantive, never a food.
const STOPWORDS = new Set(["and", "or", "the", "a", "an", "of", "with", "without", "added", "in", "on", "to", "for"]);

// ---------------------------------------------------------------------------
// Allergen roots — the backstop.
//
// Independent of the ladder: an accepted match must have the SAME allergen
// root set as the (alias-canonicalised) query. A query without "butter" can
// never land on a food with "butter", and a query WITH it can never land on a
// food without it. Matching is whole-token with simple plural tolerance —
// never substring, or "buttermilk"/"eggplant"/"butternut" would falsely
// inherit roots they do not have.
// ---------------------------------------------------------------------------
const ALLERGEN_ROOTS = [
  // dairy
  "milk", "butter", "cream", "cheese", "yogurt", "yoghurt", "whey", "casein", "ghee",
  // egg
  "egg",
  // gluten grains
  "wheat", "gluten", "barley", "rye", "semolina", "spelt",
  // soy
  "soy", "soya", "edamame", "tofu",
  // peanut (a legume — kept separate from tree nuts on purpose)
  "peanut", "groundnut",
  // tree nuts
  "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia",
  "brazilnut", "chestnut",
  // sesame
  "sesame", "tahini",
  // crustacean / mollusc
  "shrimp", "prawn", "crab", "lobster", "crayfish", "scallop", "mussel",
  "oyster", "clam", "squid", "octopus", "shellfish",
  // fish
  "fish", "anchovy", "anchovies", "tuna", "salmon", "cod", "haddock",
  "sardine", "mackerel", "trout",
];

// Single tokens that spell out more than one allergen. Whole-token matching
// alone would score these as zero roots, which would let a compound word slip
// past the backstop.
const COMPOUND_ROOT_TOKENS = {
  buttermilk: ["milk"],   // dairy despite the "butter" spelling
  eggnog: ["egg", "milk"],
  mayonnaise: ["egg"],
  mayo: ["egg"],
};

// Two spellings of ONE allergen. Collapsing them here (rather than letting an
// alias quietly swap one root for another) is what keeps "prawns" -> "Shrimp"
// legal while "almond butter" -> "Butter" stays illegal: the equivalence is
// declared, named, and auditable instead of inferred.
const ROOT_EQUIVALENCE = {
  prawn: "shrimp",        // prawn IS shrimp — same crustacean, same allergen
  crayfish: "shrimp",     // decapod crustacean, same allergen class
  soya: "soy",            // British/Indian spelling
  groundnut: "peanut",    // groundnut IS peanut
  yoghurt: "yogurt",      // British spelling
  anchovies: "anchovy",   // irregular plural
};

const ROOT_LOOKUP = (() => {
  const m = new Map();
  for (const root of ALLERGEN_ROOTS) {
    const canonical = ROOT_EQUIVALENCE[root] || root;
    m.set(root, canonical);
    m.set(`${root}s`, canonical);
    m.set(`${root}es`, canonical);
  }
  return m;
})();

function allergenRootsOf(text) {
  const roots = new Set();
  for (const t of normalizeTokens(text)) {
    const hit = ROOT_LOOKUP.get(t);
    if (hit) roots.add(hit);
    const compound = COMPOUND_ROOT_TOKENS[t];
    if (compound) for (const c of compound) roots.add(c);
  }
  return roots;
}

function sameAllergenRoots(queryText, candidateText) {
  const a = allergenRootsOf(queryText);
  const b = allergenRootsOf(candidateText);
  if (a.size !== b.size) return false;
  for (const r of a) if (!b.has(r)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function matchesPhraseAt(tokens, i, phrase) {
  if (i + phrase.length > tokens.length) return false;
  for (let k = 0; k < phrase.length; k++) if (tokens[i + k] !== phrase[k]) return false;
  return true;
}

// Removes descriptor phrases, descriptor tokens and stopwords. Whatever
// survives is a SUBSTANTIVE token — a word that changes what the food is.
function stripDescriptors(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const phrase = DESCRIPTOR_PHRASES.find((p) => matchesPhraseAt(tokens, i, p));
    if (phrase) { i += phrase.length; continue; }
    if (DESCRIPTOR_TOKENS.has(tokens[i]) || STOPWORDS.has(tokens[i])) { i++; continue; }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

// Index of `needle` as a WHOLE-TOKEN, IN-ORDER, CONTIGUOUS subsequence of
// `hay`, or -1. Order and contiguity are what make containment direction-safe:
// "almond butter" is not a subsequence of ["butter"], and "butter" only
// appears inside ["butter","lettuce"] with a non-descriptor token left over.
function sequenceIndex(hay, needle) {
  if (!needle.length || needle.length > hay.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

// Tier 3 test. Returns the leftover descriptor tokens on success, null on
// failure. Success requires: the query's FULL token sequence appears in the
// candidate, and every token the candidate adds (before AND after the match)
// is a curated descriptor. Anything else is a different food.
function descriptorOnlyContainment(queryTokens, candidateTokens) {
  const at = sequenceIndex(candidateTokens, queryTokens);
  if (at < 0) return null;
  const before = candidateTokens.slice(0, at);
  const after = candidateTokens.slice(at + queryTokens.length);
  if (stripDescriptors(before).length > 0) return null;
  if (stripDescriptors(after).length > 0) return null;
  return [...before, ...after];
}

// ---------------------------------------------------------------------------
// Display-only suggestions for the review queue.
//
// This score NEVER resolves anything. It only orders the shortlist a human
// picks from. Keeping the ranking and the resolving strictly separate is the
// whole point — the old code let a ranking decide a write.
// ---------------------------------------------------------------------------
function suggestCandidates(queryTokens, foods, limit = 5) {
  const wanted = new Set(stripDescriptors(queryTokens));
  if (!wanted.size) return [];
  const scored = [];
  for (const f of foods) {
    const tokens = new Set(stripDescriptors(normalizeTokens(f.name)));
    let shared = 0;
    for (const t of wanted) if (tokens.has(t)) shared++;
    if (shared > 0) scored.push({ id: f.id, name: f.name, shared, len: tokens.size });
  }
  scored.sort((a, b) => b.shared - a.shared || a.len - b.len || String(a.name).localeCompare(String(b.name)));
  return scored.slice(0, limit).map(({ id, name }) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// The ladder (pure — no DB, no network; this is what the tests hammer)
// ---------------------------------------------------------------------------

// Deterministic ordering so the same pool always yields the same answer.
const byStableOrder = (a, b) => {
  const ai = a.id ?? Number.MAX_SAFE_INTEGER;
  const bi = b.id ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai < bi ? -1 : 1;
  return String(a.name).localeCompare(String(b.name));
};

/**
 * @param {string} query      ingredient name as the user/AI/import wrote it
 * @param {Array}  foods      candidate Food rows ({id, name, source, ...})
 * @returns {{status:"resolved"|"needs_review", confidence:string|null,
 *            food:object|null, query:string, canonicalQuery:string,
 *            extras:string[], candidates:Array<{id:number,name:string}>,
 *            reason:string}}
 */
function matchExistingFood(query, foods) {
  const queryTokens = normalizeTokens(query);
  const pool = Array.isArray(foods) ? [...foods].sort(byStableOrder) : [];

  const unresolved = (reason, canonical = queryTokens.join(" ")) => ({
    status: "needs_review",
    confidence: null,
    food: null,
    query: String(query ?? ""),
    canonicalQuery: canonical,
    extras: [],
    candidates: suggestCandidates(queryTokens, pool),
    reason,
  });

  if (!queryTokens.length) return unresolved("empty ingredient name", "");

  const queryKey = queryTokens.join(" ");
  const aliasTarget = ALIASES.get(queryKey) || null;
  const canonicalTokens = aliasTarget ? normalizeTokens(aliasTarget) : queryTokens;
  const canonicalKey = canonicalTokens.join(" ");

  // The allergen backstop always runs against the CANONICALISED query, so a
  // sanctioned alias ("prawns" -> "shrimp") compares on the right root set.
  const allergenSafe = (candidateName) => sameAllergenRoots(canonicalKey, candidateName);

  const resolve = (food, confidence, extras, reason) => ({
    status: "resolved",
    confidence,
    food,
    query: String(query ?? ""),
    canonicalQuery: canonicalKey,
    extras,
    candidates: [],
    reason,
  });

  // --- Tier 1: exact normalised name -------------------------------------
  const exact = pool.find((f) => normalizeKey(f.name) === queryKey && allergenSafe(f.name));
  if (exact) return resolve(exact, "exact", [], `exact name match on "${exact.name}"`);

  // --- Tier 2: curated alias ---------------------------------------------
  if (aliasTarget) {
    const viaAlias = pool.find((f) => normalizeKey(f.name) === canonicalKey && allergenSafe(f.name));
    if (viaAlias) {
      return resolve(viaAlias, "alias", [], `curated alias "${queryKey}" -> "${canonicalKey}", exact match on "${viaAlias.name}"`);
    }
  }

  // --- Tier 3: descriptor-only containment --------------------------------
  // Prefer the candidate that adds the FEWEST descriptor tokens — the closest
  // thing to the plain ingredient. Ties break on stable order.
  let best = null;
  for (const f of pool) {
    const extras = descriptorOnlyContainment(canonicalTokens, normalizeTokens(f.name));
    if (!extras) continue;
    if (!allergenSafe(f.name)) continue;
    if (!best || extras.length < best.extras.length) best = { food: f, extras };
  }
  if (best) {
    return resolve(
      best.food,
      aliasTarget ? "alias" : "containment",
      best.extras,
      `"${best.food.name}" is "${canonicalKey}" plus descriptors only [${best.extras.join(", ")}]`
    );
  }

  // --- Tier 4: no resolution. Do not guess. -------------------------------
  return unresolved(
    `no exact, alias, or descriptor-only match for "${queryKey}" — needs a human to pick or add the food`,
    canonicalKey
  );
}

// ---------------------------------------------------------------------------
// USDA-hit admissibility.
//
// USDA names are verbose ("Chicken, broilers or fryers, breast, meat only,
// raw"), so the strict containment ladder would reject almost every legitimate
// hit. The rule for this tier is instead:
//
//   a) every SUBSTANTIVE token of the query must appear in the candidate name
//      (order-free) — this alone kills "coconut milk" -> "Milk, whole",
//      "almond butter" -> "Butter, salted", "chickpea flour" -> "Wheat flour";
//   b) the allergen root sets must be identical.
//
// (a) means the candidate may only ADD detail, never swap the food out.
// ---------------------------------------------------------------------------
function usdaCandidateAcceptable(query, candidateName) {
  const queryKey = normalizeKey(query);
  const canonical = ALIASES.get(queryKey) || queryKey;
  const wanted = stripDescriptors(normalizeTokens(canonical));
  if (!wanted.length) return false;
  const have = new Set(normalizeTokens(candidateName));
  for (const t of wanted) if (!have.has(t)) return false;
  return sameAllergenRoots(canonical, candidateName);
}

// ---------------------------------------------------------------------------
// resolveIngredient — the DB/network-facing entry point.
//
// Return contract (unchanged for existing callers: `food` is ALWAYS a real row
// and `matched` still reads "existing" | "usda" | "placeholder"):
//   food         Food row. Never null. On needs_review it is a zero-macro
//                placeholder whose name is the caller's text VERBATIM.
//   matched      "existing" | "usda" | "placeholder"
//   status       "resolved" | "needs_review"
//   needsReview  boolean convenience mirror of status
//   confidence   "exact" | "alias" | "containment" | "usda" | null
//   query        the original ingredient text, verbatim
//   candidates   display-only shortlist for the review UI ([] when resolved)
//   extras       descriptor tokens the matched name added ([] unless tier 3)
//   reason       one-line human explanation, always present
//
// `deps` is test-only dependency injection, matching the fetchImpl /
// resolveIngredientImpl pattern already used elsewhere in this codebase.
// Real callers never pass it.
// ---------------------------------------------------------------------------
async function resolveIngredient(name, deps = {}) {
  const {
    listFoodsImpl = () => prisma.food.findMany(),
    searchFoodsImpl = searchFoods,
    createFoodImpl = (data) => prisma.food.create({ data }),
    loadOverridesImpl = loadFoodOverrides,
  } = deps;

  const query = String(name ?? "");
  const existing = await listFoodsImpl();
  const match = matchExistingFood(query, existing);

  if (match.status === "resolved") {
    // A previously-created placeholder is a legitimate row to REUSE (it keeps
    // the food table from filling with duplicates of the same unknown name)
    // but it still has no verified macros, so it stays a review item.
    const isPlaceholder = match.food.source === "manual-placeholder";
    return {
      food: match.food,
      matched: isPlaceholder ? "placeholder" : "existing",
      status: isPlaceholder ? "needs_review" : "resolved",
      needsReview: isPlaceholder,
      confidence: match.confidence,
      query,
      candidates: isPlaceholder ? suggestCandidates(normalizeTokens(query), existing) : [],
      extras: match.extras,
      reason: isPlaceholder
        ? `${match.reason} — but that row is still an unverified manual placeholder (zero macros)`
        : match.reason,
    };
  }

  // No local match. Try USDA, under the same never-swap-the-food rules.
  try {
    const hits = await searchFoodsImpl(query, { pageSize: 5 });
    // Phase 2 guardrail, retained: a hit must pass full food validation under
    // its own USDA name (rejects the zero-energy Foundation records AND
    // internally inconsistent data), and must not violate the SEARCHED name's
    // implied shape — this is exactly how "Porridge oats" once ended up
    // storing 884 kcal of oil data. Bad hits fall through to the next
    // candidate. New in the food-data-1 fix: usdaCandidateAcceptable() so a
    // USDA hit cannot rename the ingredient into a different food either.
    const usableHit = (hits || []).find((h) => {
      if (!usdaCandidateAcceptable(query, h.name)) return false;
      const candidate = {
        name: h.name, category: h.category, kcal: h.per100g.kcal,
        protein: h.per100g.protein, fat: h.per100g.fat, carb: h.per100g.carb,
        fiber: h.per100g.fiber, source: "usda",
      };
      const own = validateFood(candidate, { exemptions: loadOverridesImpl() });
      const shapeVsRequest = checkNameShape({ ...candidate, name: query });
      return own.ok && shapeVsRequest.length === 0;
    });
    if (usableHit) {
      const food = await createFoodImpl({
        name: usableHit.name, category: usableHit.category, fdcId: usableHit.fdcId,
        kcal: usableHit.per100g.kcal, protein: usableHit.per100g.protein, fat: usableHit.per100g.fat,
        carb: usableHit.per100g.carb, fiber: usableHit.per100g.fiber, source: "usda",
      });
      return {
        food,
        matched: "usda",
        status: "resolved",
        needsReview: false,
        confidence: "usda",
        query,
        candidates: [],
        extras: [],
        reason: `USDA record "${usableHit.name}" contains every substantive word of "${query}" and the same allergen profile`,
      };
    }
  } catch {
    // USDA lookup failed (network/key issue) — fall through to the placeholder
    // rather than blocking the whole draft. A placeholder is honest; a guess
    // is not.
  }

  // Nothing safe to point at. Keep the user's words EXACTLY as written, zero
  // the macros, and hand it to a human. No rename, no substitution, no
  // borrowed allergen profile.
  const food = await createFoodImpl({
    name: query, category: classifyFood(query).category,
    kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0,
    source: "manual-placeholder",
  });
  return {
    food,
    matched: "placeholder",
    status: "needs_review",
    needsReview: true,
    confidence: null,
    query,
    candidates: match.candidates,
    extras: [],
    reason: match.reason,
  };
}

module.exports = {
  resolveIngredient,
  // exported for tests and for any future review-queue UI
  matchExistingFood,
  usdaCandidateAcceptable,
  normalizeTokens,
  normalizeKey,
  stripDescriptors,
  descriptorOnlyContainment,
  allergenRootsOf,
  sameAllergenRoots,
  suggestCandidates,
  ALIASES,
  ALIAS_ROOT_EXCEPTIONS,
  ROOT_EQUIVALENCE,
  DESCRIPTOR_TOKENS,
  DESCRIPTOR_PHRASES,
  ALLERGEN_ROOTS,
};
