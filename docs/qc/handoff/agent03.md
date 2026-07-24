# Agent 03 handoff — fleet finding `food-data-1` (P0)

Wave 2, branch `qc/overnight-2026-07-23`. Owned files only:
`backend/src/lib/ingredientResolver.js`, `backend/tests/ingredientResolver.test.js`.

## What was fixed

`ingredientResolver.js:11` held a token-overlap `similarity()` scorer with
`MATCH_THRESHOLD = 0.6`. `similarity("almond butter", "Butter")` evaluates to
`1 / min(2,1) = 1.0` — a perfect score — so the resolver silently rewrote a nut
butter into the dairy row. Both the scorer and the threshold are **deleted**,
not flagged off.

Replacement is a deterministic ladder (exact → curated alias → descriptor-only
whole-token containment → `needs_review`), plus an allergen-root equality
backstop on every accepted match, plus an admissibility filter on USDA hits so
the USDA door can't perform the same rename.

Measured against a read-only copy of the real 14,122-row `Food` table: the old
matcher silently renamed **21 of 58** ordinary/adversarial ingredient queries
into a different food; **5** of those crossed an allergen-root boundary. New
ladder: **0** cross-allergen resolutions on the same sweep.

## CALLER IMPACT — who now has to handle `needs_review`

`resolveIngredient()`'s return contract is **backwards compatible**: `food` is
still always a real Food row (never `null`), and `matched` still reads
`"existing" | "usda" | "placeholder"`. Neither caller needs an edit to keep
working. Both, however, now see the placeholder branch much more often, and
both can now surface a far better review UI using the new fields.

### 1. `backend/src/lib/recipeGeneration.js:38` — `resolveDraftIngredients()`
*(also reached via `generateAndSaveSlotRecipe()` and therefore by
`weeklyPlanner.js`'s unattended solver fallback)*

- Currently destructures `{ food, matched }` and sets
  `placeholderMacros: matched === "placeholder"`. **Still correct** — Agent 03
  added a test locking the invariant `needsReview ⇔ matched === "placeholder"`.
- **Behaviour change:** more drafts will now come back with placeholder
  ingredients (zero macros) instead of wrong-but-confident ones. Draft totals
  computed by `sumMacros()` will therefore under-count rather than mis-count.
  That is the intended, honest failure mode, but the AI-draft flow may want to
  refuse to auto-save a draft whose ingredients are mostly placeholders — the
  unattended `generateAndSaveSlotRecipe()` path has no human in the loop at all
  and will happily persist a recipe made of zero-macro rows.
  **Recommended (NOT done — file not owned):** in
  `generateAndSaveSlotRecipe()`, reject/retry a draft when
  `resolved.ingredients.filter(i => i.placeholderMacros).length` exceeds some
  share of the ingredient list, and surface the reason.
- **Available to adopt:** `status`, `needsReview`, `confidence`, `candidates`,
  `reason`, `extras` — pass them through onto each resolved ingredient so the
  UI can show *why* and offer the shortlist.

### 2. `backend/src/lib/recipeImporter.js:786` — `importRecipeFromUrl()`

- Same destructure, same `placeholderMacros` flag; **no edit required**.
- **Behaviour change:** URL imports will produce more amber/red review rows.
  This is the flow with a human already in front of it (the DraftCard), so it
  is the natural home for the new shortlist.
  **Recommended (NOT done — file not owned):** push `reason` into
  `importNotes` and carry `candidates` onto the ingredient so the DraftCard can
  offer "did you mean…" instead of only "no macro data".

### 3. `frontend/src/components/RecipesTab.jsx:287`

- Already renders the red *"(no macro data — fix it in the Food database before
  saving)"* warning off `ing.placeholderMacros`. **It keeps working unchanged**,
  and now fires on every unresolved ingredient. It will fire more often.
- **Recommended (NOT done — file not owned):** render `ing.candidates` as a
  pick-list. The data is there the moment a caller forwards it.

### 4. Not affected
`offImport.js` (own path, references the resolver only in a comment),
`usdaClient.js` (comment only), `foodCategories.js` (comment only), and
`backend/tests/recipeGeneration.test.js` (injects `resolveIngredientImpl`
fakes, never the real resolver).

## Requests outside Agent 03's ownership

1. **`recipeGeneration.js` / `recipeImporter.js`:** forward the new
   `status` / `needsReview` / `candidates` / `reason` fields onto each
   ingredient object (additive; nothing existing breaks).
2. **`generateAndSaveSlotRecipe()`:** add a placeholder-share guard on the
   unattended path — it is the only flow that persists a recipe with no human
   review.
3. **`RecipesTab.jsx`:** upgrade the red placeholder warning into a
   "did you mean…" picker once (1) lands.
4. **Backlog / product call:** there is now no way for a user to *complete* a
   review item in the UI — the placeholder Food row must be edited in the Foods
   tab by hand. A real review queue is the follow-up feature.
5. **Known, accepted false negatives** (fail-closed by design, on the real
   pool): `"carrot"` (pool has no plain `Carrot` row, only `Carrot juice,
   canned` / `Carrot, dehydrated`), `"bell pepper"` (old code resolved it to
   the *black pepper spice* row, 27 vs ~251 kcal/100g), `"olive"`. These now
   return `needs_review` with a shortlist instead of a wrong row. If the food
   table gains plain `Carrot` / `Bell pepper` rows they resolve exactly.
