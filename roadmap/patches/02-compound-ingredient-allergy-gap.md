# Fix 2 [CRITICAL, likely quick] — compound/generic ingredient names defeat category-synonym allergy matching

**File:** `backend/src/lib/dietaryFilter.js`
**Call site that must change too:** `backend/src/routes/plans.js` (`filterRecipePool()`)
**Diagnosed in:** PABLO_REVIEW.md §2.5 — "Spanish seafood rice" contains an
ingredient literally named **"Frozen Seafood mix"** (confirmed present twice
in `backend/src/lib/portedFromRecomp/recipeLibrary.mjs`, lines 39576 and
40213), which is NOT caught by the `shellfish` category synonym list
(`shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster|crawfish|crayfish`)
because the ingredient's name contains none of those literal words. A
shellfish-allergic user with `excludedFoods: ["shellfish"]` set would still
be served this recipe.

---

## Design reasoning

Pablo's own review flags this as structural, not a one-off: "the filter can
only be as good as the ingredient's *name*... generic compound-ingredient
names ('seafood mix,' and by the same logic likely 'mixed nuts,' 'curry
paste,' 'stock cube,' etc. elsewhere in the library) will silently defeat
category-based filtering." His recommendation is explicitly either/or —
"expand the synonym list... or — better — add a lightweight secondary check
for known compound-allergen terms... surfacing an explicit 'could not
verify' warning rather than silent pass-through."

**This patch does both**, because they solve different halves of the
problem:

- **Expanding `CATEGORY_SYNONYMS.shellfish`** directly catches the confirmed
  live case ("Frozen Seafood mix") immediately, cheaply, with zero new
  concepts. But it's reactive — the next compound term nobody thought of
  ("mixed nuts" for a nut allergy, "stock cube" for gluten) will defeat it
  the same way, silently.
- **A generic ambiguous-ingredient classifier** is the actual structural fix
  Pablo calls "better": a fixed list of *known compound-generic ingredient
  name patterns* (not tied to any one allergen category) that, when they
  appear on an ingredient AND none of the literal category synonyms already
  matched, mark that ingredient as "ambiguous" rather than silently "clear."
  A recipe filter that's uncertain should **fail closed** (exclude) for an
  allergy-labeled exclusion — the cost of an over-cautious exclusion is a
  smaller recipe pool; the cost of a false "clear" is a real allergic
  reaction. This app's own constitution (`CLAUDE.md` C7: "silent target
  misses are forbidden") and its own dead-but-written-for-this-purpose
  `traceExclusions()` functions already establish "silent failure is banned"
  as this codebase's stated principle for exactly this kind of gap.

**Scope of the ambiguous-term list.** Kept to genuinely generic
compound/blended product names that are common across real grocery products
and could plausibly hide almost any allergen category (seafood mixes, nut
mixes, stock/bouillon/gravy bases, curry/seasoning/marinade blends) — not an
attempt to exhaustively enumerate every possible hidden-allergen product,
which isn't achievable by keyword list regardless of size. This is a safety
net under the category-synonym list, not a replacement for it.

---

## Patch — `backend/src/lib/dietaryFilter.js`

### 1. Expand the shellfish synonym list with the confirmed compound term

**Before:**
```js
const CATEGORY_SYNONYMS = {
  gluten: [
    "gluten", "wheat", "barley", "rye", "couscous", "pasta", "bread", "farro",
    "malt", "seitan", "spelt", "semolina", "bulgur", "cracker", "crackers",
    "noodle", "noodles", "tortilla", "tortillas", "cereal", "breadcrumb",
    "breadcrumbs", "flour", "orzo", "panko",
  ],
  shellfish: [
    "shellfish", "shrimp", "prawn", "crab", "lobster", "scallop", "mussel",
    "clam", "oyster", "crawfish", "crayfish",
  ],
```

**After:**
```js
const CATEGORY_SYNONYMS = {
  gluten: [
    "gluten", "wheat", "barley", "rye", "couscous", "pasta", "bread", "farro",
    "malt", "seitan", "spelt", "semolina", "bulgur", "cracker", "crackers",
    "noodle", "noodles", "tortilla", "tortillas", "cereal", "breadcrumb",
    "breadcrumbs", "flour", "orzo", "panko",
  ],
  shellfish: [
    "shellfish", "shrimp", "prawn", "crab", "lobster", "scallop", "mussel",
    "clam", "oyster", "crawfish", "crayfish",
    // Compound/generic product names that legitimately contain shellfish but
    // don't literally spell out any species word - confirmed real case:
    // "Frozen Seafood mix" on "Spanish seafood rice" (PABLO_REVIEW.md §2.5).
    // "seafood" ALONE is deliberately not in this list - "seafood" also
    // covers plain fish (see the "Smoked Haddock Kedgeree" case Pablo found
    // was a correct non-match), and adding bare "seafood" here would
    // over-exclude fish-only dishes for a shellfish-only allergy. The
    // multi-word phrases below are specific enough to reliably mean a
    // blended/mixed product, which in practice is shellfish-inclusive.
    "seafood mix", "seafood medley", "mixed seafood", "surimi",
  ],
```

*(`hasWordOrPlural()` does single-word regex matching with word boundaries and
does not handle multi-word phrases — see change 3 below, which is required
for these multi-word entries to actually match.)*

### 2. Add the generic ambiguous-compound-ingredient list and classifier

**Before** (insert after the `CATEGORY_SYNONYMS` block, before `DEFAULT_KETO_CARB_THRESHOLD`):
```js
// Default keto threshold is on carb-per-100g of the raw ingredient, not a
// typical realistic serving size - a disclosed simplification.
const DEFAULT_KETO_CARB_THRESHOLD = 15;
```

**After:**
```js
// Generic compound/blended product names known to routinely hide a specific
// ingredient that a category-synonym keyword match can't see from the name
// alone - "Frozen Seafood mix" (PABLO_REVIEW.md §2.5) is the confirmed real
// case, but the same structural gap applies to any blended product: a "mixed
// nuts" bag for a nut allergy, a "stock cube" or "gravy mix" for gluten
// (wheat is a very common cheap filler in bouillon), a "curry paste" or
// "seasoning mix" for basically anything. This list is NOT keyed to any one
// CATEGORY_SYNONYMS entry on purpose - a compound term here should be
// treated as ambiguous regardless of which exclusion term is being checked,
// because the same blended-product problem applies across every category.
// Not exhaustive by design (no fixed keyword list can be) - this is a safety
// net under the literal/category matching above, not a replacement for it.
const AMBIGUOUS_COMPOUND_TERMS = [
  "seafood mix", "seafood medley", "mixed seafood", "surimi",
  "mixed nuts", "nut mix", "trail mix",
  "curry paste", "curry powder",
  "stock cube", "stock powder", "bouillon", "gravy mix", "gravy granules",
  "seasoning mix", "spice mix", "spice blend", "five spice", "mixed spice",
  "marinade mix", "marinade", "sauce mix",
];

// Default keto threshold is on carb-per-100g of the raw ingredient, not a
// typical realistic serving size - a disclosed simplification.
const DEFAULT_KETO_CARB_THRESHOLD = 15;
```

### 3. Add a phrase-matching helper (multi-word terms need substring, not `hasWordOrPlural`'s single-word regex)

**Before:**
```js
function matchesAny(name, words) {
  return words.some((w) => hasWord(name, w));
}
```

**After:**
```js
function matchesAny(name, words) {
  return words.some((w) => hasWord(name, w));
}

// hasWord()/hasWordOrPlural() are single-word, word-boundary regexes - they
// don't handle multi-word phrases like "seafood mix" or "stock cube"
// (a boundary-anchored regex per word would require matching word order and
// adjacency, which \b-per-word doesn't give you for free). Plain
// case-insensitive substring is the right tool for a fixed multi-word phrase
// list; single-word entries in CATEGORY_SYNONYMS/AMBIGUOUS_COMPOUND_TERMS
// still get the stricter word-boundary treatment via hasWordOrPlural() at
// the call sites below - this helper is only reached for phrases containing
// a space.
function hasPhrase(name, phrase) {
  return name.toLowerCase().includes(phrase.toLowerCase());
}

function matchesTermList(name, term) {
  return term.includes(" ") ? hasPhrase(name, term) : hasWordOrPlural(name, term);
}

// Does this ingredient name hit one of the generic compound/blended-product
// patterns? Independent of any specific exclusion term - see
// AMBIGUOUS_COMPOUND_TERMS' comment for why this isn't category-keyed.
function isAmbiguousCompoundIngredient(name) {
  return AMBIGUOUS_COMPOUND_TERMS.some((term) => matchesTermList(name, term));
}
```

### 4. Update `matchesExclusionTerm()` to use the new phrase-aware matcher (so the multi-word additions in change 1 actually work)

**Before:**
```js
function matchesExclusionTerm(name, term) {
  const key = (term || "").trim().toLowerCase();
  if (!key) return false;
  const synonyms = CATEGORY_SYNONYMS[key];
  if (synonyms) {
    // "milk" needs the same plant-milk qualifier check the vegan/vegetarian
    // style filter already uses - a dairy allergy must not remove almond
    // milk just because "milk" is a dairy synonym.
    return synonyms.some((word) => (word === "milk" ? isDairyMilk(name) : hasWordOrPlural(name, word)));
  }
  // Not a known category - literal substring fallback. Covers free-text
  // entries like "kiwi" and specific multi-word phrases like "soy protein"
  // that should NOT expand to the whole soy category.
  return name.toLowerCase().includes(key);
}
```

**After:**
```js
function matchesExclusionTerm(name, term) {
  const key = (term || "").trim().toLowerCase();
  if (!key) return false;
  const synonyms = CATEGORY_SYNONYMS[key];
  if (synonyms) {
    // "milk" needs the same plant-milk qualifier check the vegan/vegetarian
    // style filter already uses - a dairy allergy must not remove almond
    // milk just because "milk" is a dairy synonym. Multi-word synonym
    // entries ("seafood mix") use substring matching via matchesTermList();
    // single-word entries keep the stricter word-boundary/plural match.
    return synonyms.some((word) => (word === "milk" ? isDairyMilk(name) : matchesTermList(name, word)));
  }
  // Not a known category - literal substring fallback. Covers free-text
  // entries like "kiwi" and specific multi-word phrases like "soy protein"
  // that should NOT expand to the whole soy category.
  return name.toLowerCase().includes(key);
}

// Three-way classification for a single ingredient name against a single
// exclusion term: a definite category/literal match, a generic
// compound-product name we can't resolve either way, or genuinely clear.
// Callers that enforce a real allergy (not just a dietary-style preference)
// should treat "ambiguous" the same as "match" - fail closed. Silent
// pass-through on an unresolvable name is exactly the gap PABLO_REVIEW.md
// §2.5 found ("Frozen Seafood mix" reading as "clear" under literal-only
// matching despite containing an unnamed shellfish product).
function classifyIngredientForExclusion(name, term) {
  if (matchesExclusionTerm(name, term)) return "match";
  if (isAmbiguousCompoundIngredient(name)) return "ambiguous";
  return "clear";
}
```

### 5. Export the new classifier + a recipe-level trace helper (mirrors the existing `traceRecipeExclusions()` pattern)

**Before** (end of file):
```js
module.exports = {
  recipeExcludedByStyle,
  adjusterExcludedByStyle,
  matchesExclusionTerm,
  applyDietaryFilters,
  traceExclusions,
  traceRecipeExclusions,
};
```

**After:**
```js
// Recipe-level equivalent of classifyIngredientForExclusion() - a recipe is
// "ambiguous" for a term if none of its ingredients definitely MATCH but at
// least one is ambiguous. Mirrors traceRecipeExclusions()'s shape so a
// future UI pass can render both counts side by side ("N excluded for
// shellfish, M more contain an unverified ingredient"). Not wired to any
// route/component by this patch - see Risks below.
function traceAmbiguousRecipes(recipes, excludedFoods) {
  const counts = {};
  (excludedFoods || []).forEach((term) => {
    const key = (term || "").trim().toLowerCase();
    if (!key) return;
    counts[key] = (recipes || []).filter((recipe) => {
      const names = (recipe.ingredients || []).map((ing) => ing.name);
      const anyMatch = names.some((n) => matchesExclusionTerm(n, key));
      const anyAmbiguous = names.some((n) => isAmbiguousCompoundIngredient(n));
      return !anyMatch && anyAmbiguous;
    }).length;
  });
  return counts;
}

module.exports = {
  recipeExcludedByStyle,
  adjusterExcludedByStyle,
  matchesExclusionTerm,
  classifyIngredientForExclusion,
  isAmbiguousCompoundIngredient,
  traceAmbiguousRecipes,
  applyDietaryFilters,
  traceExclusions,
  traceRecipeExclusions,
};
```

---

## Patch — `backend/src/routes/plans.js` (required for the ambiguous flag to actually enforce anything)

`matchesExclusionTerm()` alone doesn't change behavior anywhere until the
enforcement call site — `filterRecipePool()` — is told to treat "ambiguous"
as exclude-worthy too. Without this half, change 1-5 above only adds a
function nobody calls from the real generation path.

**Before:**
```js
const { recipeExcludedByStyle, matchesExclusionTerm } = require("../lib/dietaryFilter.js");
```

**After:**
```js
const { recipeExcludedByStyle, matchesExclusionTerm, classifyIngredientForExclusion } = require("../lib/dietaryFilter.js");
```

**Before:**
```js
function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return recipePool.filter((recipe) => {
    if (dietaryStyle === "keto" && recipe.carb > KETO_RECIPE_CARB_CEILING_G) return false;
    const flatIngredients = recipe.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flatIngredients }, dietaryStyle)) return false;
    if (excludedFoods.length && flatIngredients.some((ing) => excludedFoods.some((term) => matchesExclusionTerm(ing.name, term)))) return false;
    return true;
  });
}
```

**After:**
```js
function filterRecipePool(recipePool, profile) {
  const dietaryStyle = profile.dietaryStyle || null;
  const excludedFoods = Array.isArray(profile.excludedFoods) ? profile.excludedFoods : [];
  if (!dietaryStyle && excludedFoods.length === 0) return recipePool;
  return recipePool.filter((recipe) => {
    if (dietaryStyle === "keto" && recipe.carb > KETO_RECIPE_CARB_CEILING_G) return false;
    const flatIngredients = recipe.ingredients.map((i) => ({ name: i.food.name }));
    if (recipeExcludedByStyle({ ingredients: flatIngredients }, dietaryStyle)) return false;
    // Fail closed: a "match" excludes as before, and an "ambiguous"
    // compound-ingredient name (e.g. "Frozen Seafood mix" under a
    // "shellfish" exclusion - PABLO_REVIEW.md §2.5) now excludes too,
    // instead of silently passing as "clear" just because no literal
    // synonym word appeared in the name. Excluded foods are a declared
    // allergy/intolerance list, not a soft preference - over-excluding a
    // recipe we can't verify is the safe direction to be wrong in.
    if (excludedFoods.length && flatIngredients.some((ing) => excludedFoods.some((term) => classifyIngredientForExclusion(ing.name, term) !== "clear"))) return false;
    return true;
  });
}
```

---

## Risks / things to double-check before applying

1. **Pool-size impact.** Fail-closed on "ambiguous" will shrink the eligible
   recipe pool for any user with an active exclusion, by an amount that
   depends on how common the `AMBIGUOUS_COMPOUND_TERMS` phrases are across
   the real 628-recipe library. Run a read-only probe (same style as
   AUDIT.md's/PABLO_REVIEW.md's own scratch probes) counting how many
   recipes get newly excluded for `shellfish`/`gluten`/`nuts`/`soy` before
   and after this patch, so the reviewer knows the real magnitude, not a
   guess. If it turns out to be large (e.g. "gravy mix" or "seasoning mix"
   appears on hundreds of unrelated recipes), narrow the
   `AMBIGUOUS_COMPOUND_TERMS` list rather than shipping a pool that's
   suddenly too thin for the planner to solve most slots (which would also
   interact with Fix 1's retry/AI-fallback gate — a much smaller eligible
   pool means more AI-fallback calls and more "best effort" warnings).
2. **`isAmbiguousCompoundIngredient()` is deliberately NOT category-scoped.**
   This means an ingredient named "gravy mix" gets flagged ambiguous for
   *any* active exclusion term, even ones (like "kiwi") it has no plausible
   relationship to. That's intentional simplicity, not a bug — but it means
   a user with several unrelated exclusions active will see more filtering
   than strictly necessary. If that proves too aggressive in practice, a
   follow-up could key ambiguous terms to specific categories the way
   `CATEGORY_SYNONYMS` already is.
3. **The `traceAmbiguousRecipes()` export is not wired to any route or UI
   component by this patch** — same "built but not connected" state AUDIT.md
   already flagged for `traceExclusions()`/`traceRecipeExclusions()` (§4,
   §10 MINOR item). It's included here because Pablo's suggested design
   explicitly wants a *count/flag* the UI could eventually render ("could not
   verify — contains an unrecognized ingredient"), and the function is cheap
   and harmless to ship unwired — but don't consider this fix's "flag/warning
   path" complete from a user-visible standpoint until something actually
   calls it. That wiring is a separate, small follow-up (Engine tab or Plan
   tab surfacing "N slots contain an ingredient we couldn't verify against
   your exclusions").
4. **`hasPhrase()`'s plain substring match has no word-boundary protection**
   for multi-word phrases (unlike `hasWordOrPlural()` for single words) —
   e.g. "seafood mix" would also match a hypothetical "un-seafood mixture"
   ingredient name. Given real ingredient names in this library are short,
   literal product names (not sentences), this is a low-probability false
   positive and was judged an acceptable simplification, but flag for review
   if a false-positive case shows up against the real pool.
