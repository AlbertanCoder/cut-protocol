# Stage 4 handoff — the Library→Brain router

Builder agent S4, 2026-07-24. Everything below is a change in a file **S4 does
not own**. Nothing here has been applied. Each item is an exact diff plus the
reason it exists.

## What landed (owned files, applied)

| File | Change |
|---|---|
| `backend/src/lib/mealRouter.js` | NEW — the router: pool → cache → library → brain → verify → cache-forever → degrade |
| `backend/src/lib/brain/slotCache.js` | NEW — constraint fingerprint + the index over previously-generated recipes |
| `backend/src/lib/brain/userBudget.js` | NEW — per-user daily/monthly caps composed with the global ledger |
| `backend/src/lib/brain/config.js` | `USER_CAPS` (clamped to `CAPS`) |
| `backend/src/lib/brain/ledger.js` | `memoryStore.sumSince(date, scope?)` — optional `{ userId }` filter (additive) |
| `backend/src/lib/brain/usageStore.js` | `sumSince(date, scope?)` — same, against the `[userId, createdAt]` index (additive) |
| `backend/src/lib/aiRecipeClient.js` | exports `DRAFT_MAX_TOKENS` so the router projects the same cost governance charges |
| `backend/src/lib/recipeGeneration.js` | `resolveDraftIngredients(draft, resolveImpl, loadFoodsImpl?)` (injectable Food re-fetch, fails loud on an incomplete set); `persistRecipe(..., { tasteTier?, tasteTierSource? })` |
| `backend/tests/mealRouter.test.js` | NEW — 17 tests, all green, zero network/DB |

The router is a **library**. It is wired into no route yet — see item 3.

---

## 1. `backend/scripts/runTests.mjs` — raise the tripwire floors

Stage 4 adds one test file and 17 tests. The floors are minimums so they do not
FAIL today, but the convention in that file is to raise them deliberately.
**Do not apply this number blind** — five agents were adding tests in parallel on
2026-07-24, so re-measure with `node scripts/runTests.mjs` and use the real
total, keeping the documented ~2.5% headroom.

```diff
-const MIN_TEST_FILES = 80;
+// 2026-07-24  +1 file / +17 tests (Stage 4: tests/mealRouter.test.js — the
+//             library→brain router: zero-call invariant, cap-before-call,
+//             cache round-trip, allergen discard, escalation ordering)
+const MIN_TEST_FILES = 81;
```

Measured contribution from Stage 4 alone: **17 tests in 1 file** (verbatim run
output in the S4 report). `MIN_TESTS` should rise by 17 over whatever the
re-measured baseline is.

---

## 2. `backend/prisma/schema.prisma` — make the cache index durable

**Why.** The durable cache today is the recipe library itself: a verified AI
recipe is an ordinary `Recipe` row, so it survives restarts and is found by the
library-first scan. The *fingerprint index* that makes the lookup O(1) is
in-process, so a restart costs a pool scan (never a duplicate generation). That
is correct but leaves two things unrecorded in the database: which constraints
produced a row, and which screens it passed. Both are audit-relevant — "why is
this AI recipe in my library" currently has no answer in the data.

```diff
 model Recipe {
   ...
   source      String   @default("curated") // "curated" | "ai-generated"
+  // Stage 4 — the constraint fingerprint (brain/slotCache.slotFingerprint) that
+  // produced this row. AI rows only; null for curated/imported. Makes the
+  // library→brain cache index durable instead of rebuilt in-process.
+  aiFingerprint String?
+  // Which verification screens this row passed before it was allowed into the
+  // library, and when. An AI row with a null verifiedAt must never be served.
+  aiVerifiedAt  DateTime?
+  aiVerifiedBy  Json?
   ...
+  @@index([aiFingerprint])
 }
```

Migration name: `20260724_stage4_recipe_ai_fingerprint`.

Then in `mealRouter.js`, the cache lookup becomes a query instead of a Map read
(the fit check and pool-filter re-screen on every hit stay exactly as they are —
they are what makes a bucketed key safe):

```js
// deps.cache.get(fingerprint)  ->
const cached = await prisma.recipe.findMany({
  where: { aiFingerprint: fingerprint, aiVerifiedAt: { not: null } },
  include: RECIPE_INCLUDE,
});
```

and `persistRecipe` gains `aiFingerprint` / `aiVerifiedAt` / `aiVerifiedBy` from
the `provenance` object the router already builds.

**Until this lands**, `provenance.verified` is returned in the router's response
but is not persisted — do not claim in the UI that a stored recipe is "verified"
on the strength of the DB alone.

---

## 3. Wiring — `backend/src/lib/weeklyPlanner.js` and/or `backend/src/routes/plans.js`

The router replaces the current "pool miss → generate" path with "pool miss →
cache → generate → verify → cache". `weeklyPlanner.tryAiFallback()` currently
calls `recipeGeneration.generateAndSaveSlotRecipe()` directly, which has no
cache, no tiering, no per-user cap and no post-persist re-screen.

Minimal, behaviour-preserving swap (`weeklyPlanner.js` ~line 316):

```diff
-const generateImpl = aiFallback.generateAndSaveSlotRecipeImpl || require("./recipeGeneration.js").generateAndSaveSlotRecipe;
-const generated = await generateImpl(target, profile, existingRecipeNames);
+const routeImpl = aiFallback.routeMealSlotImpl || require("./mealRouter.js").routeMealSlot;
+const routed = await routeImpl({ target, profile, recipePool: rawRecipePool, existingRecipeNames });
+if (!routed.ok) throw new Error(routed.notice); // the existing catch turns this into an honest unsolved slot
+const generated = routed.recipe;
```

Two notes for whoever wires it:

- the router needs the **raw** pool (it calls `filterRecipePool` itself, because
  the pool builder is the safety boundary and must not be bypassed or
  pre-applied twice by accident). `weeklyPlanner` currently receives an
  already-filtered pool, so thread `rawRecipePool` through
  `buildAiFallbackContext` rather than handing it the filtered one.
- `routed.ok === false` is **not an error** — it carries a `closest-fit` recipe
  and honest copy. A caller that wants the degraded-but-usable behaviour should
  read `routed.recipe` and surface `routed.notice` instead of throwing.

Route-level exposure of the economics (`routerStats()` → cache-hit rate) is a
one-liner on any admin/debug route; no frontend file was touched by S4.

---

## 4. Not done, deliberately

- **No route is wired.** A library fix is not live until its caller changes
  (repo lesson, `feedback_fixes_land_in_libraries_not_products`). Item 3 is the
  wiring; it edits files S4 does not own.
- **No live model call was made.** Every test drives the fake client through
  `llm.__setClient`; `LlmUsage` row count was 12 before and 12 after the run,
  same max timestamp.
- **`tasteTier` on generated rows is the neutral prior**, tagged
  `tasteTierSource: "llm"`. The drafting schema carries no quality claim, so
  inventing a tier would be fabricating a number. `taste.js` already treats null
  and `"decent"` identically, and caps what an `llm` source may assert.
