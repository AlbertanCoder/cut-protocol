# Cut Protocol — Allergies 2.0 / Five Filters / Any-Horizon / Library→Brain Router

Execution log for the owner's master prompt, run autonomously 2026-07-24.
Every status here is backed by real command output, not assertion.

---

## STAGE 0 — Make it launch, and PROVE it. ✅ COMPLETE

**Root cause, in one sentence (the spec asks for exactly this):** the app didn't
open because three separate faults stacked — `Cut Protocol.exe` had been moved
out of its own application folder so the Start Menu shortcut pointed at nothing,
the Jul 19 build it pointed to died during startup on a pruned `effect` module,
and the migration that would have upgraded it created a `UNIQUE INDEX` on
`Food.fdcId` without deduplicating first.

**Corrections to the spec's premises** (it was written against a stale snapshot):

| Spec claim | Measured reality |
|---|---|
| "200+ uncommitted files" | 1 modified, 5 untracked — the tree was committed and pushed hours earlier |
| "four edited already-applied migration files" | **One** (`20260722045659`), the dedupe |
| "confirm whether the runner keys on NAME or re-validates checksums" | Answered: **name only**, `desktopBootstrap.js:310-319`; it never validates checksums of applied migrations — which is precisely why editing that migration was safe |
| Stage 4: "generate-drafts is a second LLM stack NOT behind the brain gate" | **Already closed** (`brain-stack-1`), with a structural test that fails if any new route escapes governance |

**Proven, both launch modes:**
- Packaged build boots (`packaged=true`), migrated the real installed DB
  **13 → 24 migrations** with duplicate `fdcId` groups **194 → 0** and
  **zero rows lost** (Food 973, Recipe 634, RecipeIngredient 6224, Plan 2,
  PlanSlot 63, TrainingExercise 72 — all identical before/after; FK check 0).
- API answers: `{"needsSetup":false}` 200.
- Dev mode boots and serves on `127.0.0.1:3001`.

**Also fixed in Stage 0:**
- `/auth/me` returned **404** for a session whose user no longer exists. The
  client treats only 401 as an auth failure, so a 404 fell into the "server
  never answered" bucket and rendered *"Can't reach the app's server / user not
  found / You are not signed out"* — three contradictory claims, a Retry that
  could never succeed, and no route to sign-in. Now 401 + cookie cleared.
- Both distribution gates (`distPrecheck`, `checkDistSafe`) were failing builds
  on a phantom email. They scanned the SQLite file as raw text, so the regex
  straddled a real `Recipe.source` value (`themealdb-import`) and adjacent cuid
  noise reading as `@p.fffff`. Both now confirm candidates against actual
  columns. Verified a real address still blocks the build.
- `runTests.mjs` could not parse its own summary when `node --test` colourised
  output — it reported TRIPWIRE on a suite that passed 926/926. ANSI codes are
  now stripped before matching.

---

## PREREQUISITE (inserted before Stage 1) ✅ COMPLETE

Stage 1 instructs: enforce via "name keywords, USDA `fdcCategory`, and OFF
`allergenTags`/`mayContain` — **USE them**."

Those columns existed and were **0% populated on all 14,122 foods**. A taxonomy
keyed on them would have matched nothing while the name probe kept firing —
a safety net wired to an empty table, which is the most dangerous possible
shape for an allergy feature.

Backfilled `fdcCategory` from the **local** cache (`backend/data/fdc-cache/fdc-index.json`,
13,545 records) — no API, no network, no key. **13,516 candidates, 13,516
matched, 0 misses.**

Newly caught leaks, measured:

| Food | Allergen | Why the name alone failed |
|---|---|---|
| `Cinnamon` | gluten | renamed from "Bread, cinnamon" — rename destroyed the only name evidence |
| `Oatmeal` | gluten | renamed from "Bread, oatmeal" — same |
| `Rolls, hard (includes kaiser)` | gluten | no listed token in the name |
| `Dessert topping, pressurized` | dairy | hidden casein |

Pool effect: gluten 449 → 437, eggs 652 → 632.

`allergenTags`/`mayContain` remain 0% — correct, they only arrive via barcode
import, and that write path is verified working end to end.

---

## STAGE 1 — Allergies 2.0 · IN PROGRESS
## STAGE 2 — Any-horizon generation · IN PROGRESS
## STAGE 3 — The five filters · IN PROGRESS
## STAGE 4 — Library→Brain router · IN PROGRESS
## STAGE 5 — Progress UX · PENDING
## STAGE 6 — Agent gauntlet · PENDING

_Updated as each stage's DoD is met._
