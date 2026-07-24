# Agent 04 handoff — Wave 2 (dietary-safety-2 / -4 / -5)

Branch `qc/overnight-2026-07-23`. Everything below is a change **outside**
Agent 04's ownership list, so it was NOT made. Each item is small, exact, and
independently verifiable.

---

## 0. ORCHESTRATOR — REQUIRED, IN THIS ORDER

The Food table gained three nullable columns. The generated Prisma client does
not know about them until it is regenerated, and `routes/foods.js` spreads the
import candidate straight into `prisma.food.create()` — so **applying the
migration without regenerating the client will 500 the barcode-import route**.

```bash
cd backend
npx prisma migrate deploy      # applies 20260724030630_food_allergen_metadata
npx prisma generate            # MUST follow — the client needs the new fields
```

Verified on a COPY of `backend/prisma/dev.db` in the session scratchpad, not on
the real one: 24 migrations found, 1 applied, 14,122 Food rows survived, all
three columns present and NULL on every existing row. The real
`backend/prisma/dev.db` was not opened for writing (mtime unchanged,
`git status` shows only `schema.prisma` + the new migration directory).

Rollback, if ever needed, is three `ALTER TABLE "Food" DROP COLUMN` statements —
nothing was rewritten and no table was redefined.

---

## 1. `backend/src/lib/openFoodFactsClient.js` — finishes dietary-safety-4

**This is the one gap that leaves part of a finding open.** `offImport.js` now
reads, normalises, and persists OFF's allergen declaration, and it is tested —
but `lookupUpc()` never asks OFF for those fields, so nothing reaches it yet.
Two edits:

```js
// FIELDS (~line 48) — add the two tag fields to the request
const FIELDS = [
  "code", "product_name", "generic_name", "brands", "quantity",
  "nutrition_data_per", "serving_size", "serving_quantity",
  "nutriments", "status", "status_verbose",
  "allergens_tags", "traces_tags",          // ← ADD
].join(",");
```

```js
// the return object of lookupUpc() (~line 252) — pass them through verbatim.
// offImport.allergenFieldsFromOffProduct() does the normalising; this file
// stays an honest fetch-and-normalise and should not interpret them.
    allergens_tags: Array.isArray(p.allergens_tags) ? p.allergens_tags : null,
    traces_tags: Array.isArray(p.traces_tags) ? p.traces_tags : null,
```

`offImport.js` already accepts all three shapes (`allergens_tags` /
`allergenTags` / `raw.allergens_tags`), so nothing else has to change and
`tests/allergenMetadata.test.js` covers each. Until this lands, the barcode
path stores `null` — honest absence, not a wrong answer.

---

## 2. `backend/scripts/importFdcBulk.mjs` — backfills dietary-safety-2

`rec.fdcCategory` is already on every index record (`scripts/lib/fdcDataset.js`
parses it, and this script already reads it for the alcohol-energy exception at
`const isAlcohol = ALCOHOL_CATEGORIES.has(rec.fdcCategory)`). It is simply never
written. Add `fdcCategory: rec.fdcCategory ?? null,` to **both**
`toInsert.push({...})` object literals (the alcohol-exception one and the normal
one). No other change.

After that, a re-run of the importer backfills USDA's authoritative category
onto every FDC-sourced row and the `fdc-category` evidence probe in
`dietaryFilter.exclusionEvidence()` goes live. Until then that probe is wired,
tested, and dormant — every row has `fdcCategory = NULL` and contributes no
evidence, which is why the migration is safe to apply on its own.

---

## 3. `backend/src/lib/ingredientResolver.js` — Agent 03's file

`usdaClient.normalize()` now returns `fdcCategory` (USDA's own category, read
verbatim from `foodCategory` / `foodCategory.description` /
`wweiaFoodCategory.wweiaFoodCategoryDescription`, same precedence the bulk
importer uses). The USDA-hit branch of `resolveIngredient()` creates a Food row
without it — one line, in the `createFoodImpl({...})` call:

```js
name: usableHit.name, category: usableHit.category, fdcId: usableHit.fdcId,
fdcCategory: usableHit.fdcCategory ?? null,      // ← ADD
```

Purely additive; `normalize()` gaining a field breaks nothing.

---

## 4. Frontend (Agent 07) — the dietary-safety-5 UI surface

Free-text exclusions no longer silently degrade to substring matching, but the
user still has to be told when a term was NOT recognised. `dietaryFilter.js`
exports the data for it:

```js
const { describeExclusionTerms } = require("../lib/dietaryFilter.js");
describeExclusionTerms(profile.excludedFoods);
// [{ term, key, synonymKey, family, kind, recognised, note }, …]
```

Three cases to render differently:

| `kind` | meaning | suggested UI |
|---|---|---|
| `category` | a known allergen checkbox value (`dairy`, `gluten`) | normal chip |
| `alias` | free text that resolved to a category — `note` reads `matched as the "dairy" allergen category` | normal chip + the note as a tooltip/subtitle |
| `literal` | unrecognised — `note` reads **`not a recognised allergen — matching on text only`** | chip + a visible caution line |

The caution line is the point: the term still filters (fail-safe over-exclusion,
never dropped), but it is matching text, not an allergen family, and the user is
entitled to know that. Per CLAUDE.md's colour laws this is `--warn` amber, not
`--red` — it is a limitation, not an error.

---

## 5. Optional follow-up — recipe paths still match on names only

These call `matchesExclusionTerm(ing.name, term)`, so they get the compound-token
and alias fixes but **not** the persisted-metadata evidence:

- `src/lib/planContext.js:40`
- `src/lib/weeklyPlanner.js:35` (Agent 08)
- `src/lib/recipeGeneration.js:90`
- `src/lib/aiRecipeClient.js:41`
- `src/routes/recipes.js:36`, `src/routes/cart.js:22`

Each becomes metadata-aware by swapping in the object-level sibling, where the
ingredient's joined Food row is available:

```js
foodMatchesExclusionTerm(ing.food ? { ...ing.food, name: ing.name } : ing, term)
```

`traceRecipeExclusions()` already does exactly this. Not urgent — no row carries
metadata until items 1–3 land — but it is where the remaining name-only surface
lives.

## 6. `docs/qc/allergen-sweep.md` + `allergen-sweep-detail.json` are now STALE

`npm run qc:sweep14k` regenerates both, and both are outside this agent's
ownership so they were left untouched. The sweep WAS run against the real
14,124-food table (output redirected to the scratchpad, `docs/` never written):

| | committed baseline | after this wave |
|---|--:|--:|
| leak-candidate food×category pairs | **25** | **0** |
| — dairy | 3 | 0 |
| — tree nuts | 15 | 0 |
| — eggs | 7 | 0 |
| false exclusions | 3 | 3 (unchanged, all pre-existing) |

`npm run qc:sweep14k -- --assert` exits 0 now; it exited 1 on the baseline.
Please re-run it and commit the regenerated report.

Two of those leaks were NOT among the three assigned findings — they surfaced
while verifying, live in `dietaryFilter.js` (owned), and are pinned by new
regression tests in `allergySweep.test.js`:

- **tree nuts, 18 rows.** The `chestnut` guard used `hasWord()` (exact,
  singular), so every `Nuts, chestnuts, japanese/chinese/european, …` row and
  bare `Chestnuts` leaked. Now `hasWordOrPlural()`; the water-chestnut
  exemption still holds for the plural form.
- **dairy, 3 rows.** `Infant formula, … SIMILAC, SENSITIVE (LACTOSE FREE)` is
  still cow's-milk protein. Lactose intolerance and milk allergy are different
  conditions and this filter serves the dangerous one. `"lactose"` added to the
  dairy synonym list.

## 7. Note, no action — `backend/scripts/runTests.mjs`

Two test files were added (`allergenMetadata.test.js`, `dietaryAliasMap.test.js`)
and existing suites grew. `MIN_TEST_FILES` / `MIN_TESTS` are floors, so counts
only moving up cannot trip them. Raise them deliberately when convenient.
