# Agent 10 handoff — fleet finding `brain-stack-1` (P0) + the placeholder-guard follow-on

Wave 7, branch `qc/overnight-2026-07-23`. Owned files only:
`backend/src/routes/recipes.js`, `backend/src/lib/aiRecipeClient.js`,
`backend/src/lib/brain/**`, `backend/src/lib/recipeGeneration.js`,
`backend/tests/brain*`, `backend/tests/recipeGeneration.test.js`,
new `backend/tests/aiGovernance*` / `recipeDrafts*`.

## Status

`brain-stack-1`: **OPEN → CLOSED.** `POST /api/recipes/generate-drafts` now runs
under the same seven controls as `/api/brain`, applied by one shared wrapper
(`backend/src/lib/brain/governance.js`) rather than re-wired per route.
`backend/tests/aiGovernanceStructure.test.js` fails the build if a future module
reaches the model transport without coming through that wrapper.

Orchestrator's follow-on (placeholder share on the unattended save path): done,
see `generateAndSaveSlotRecipe()` in `backend/src/lib/recipeGeneration.js` and
`backend/tests/recipeDraftsPlaceholderGuard.test.js`.

## Requests outside Agent 10's ownership

### 1. `backend/.env` — the local build is ARMED (owner's machine, not a code bug)
`.env` line 20 is `BRAIN=on` and `ANTHROPIC_API_KEY` is populated. Prisma loads
`.env` into `process.env` on require, so **any** process that touches the DB —
including the test runner — inherits `BRAIN=on`. Consequences:

- The brain is NOT dormant on this machine. `mealSolver.js:436`'s critic pass
  fires whenever a `profile` is passed to `generateDayCandidates`, which means a
  test that supplies a profile makes a real, billed call. (No such test exists
  today; nothing in Agent 10's work made one.)
- The drafting route is armed here too (BRAIN=on satisfies its gate). That is
  the *intended* behaviour for the owner's own machine — but a tester build must
  ship with no key and no `BRAIN` / `AI_RECIPE_DRAFTS` value.

**Ask:** (a) decide whether `BRAIN=on` is deliberate; (b) have the test runner
(`backend/scripts/runTests.mjs`, not Agent 10's file) export
`BRAIN=off` and `ANTHROPIC_API_KEY=` before spawning `node --test`, so no suite
can ever bill the owner's account by accident.

### 2. Frontend (`frontend/src/components/RecipesTab.jsx`, `frontend/src/lib/api.js`)
A new endpoint exists: **`GET /api/recipes/ai-status`** →
`{ enabled: boolean, reason: "no-api-key" | "feature-off" | null }`. It mirrors
`GET /api/brain/status`. The Generate button should consult it and render
"AI drafting is off in this build" instead of offering a button that 503s.

The drafts endpoint's error bodies now carry a machine-readable `code`:
`llm-disabled` (503) · `input-refused` (400) · `cost-cap` (429) ·
`llm-timeout` (504) · `output-guard` (502). Worth surfacing distinctly —
"you've hit today's AI budget" is a different message from "that request was
refused".

The success body gained two additive fields alongside `drafts` /
`droppedForAllergies`: `droppedForShape` (drafts the model returned malformed)
and `allergenOverrides` (violations kept because the user ticked the loud
override). Nothing existing changed shape.

Also still open from Agent 03's handoff: each resolved ingredient now carries
`status` / `needsReview` / `confidence` / `candidates` / `reason` / `extras` /
`requestedName`. The DraftCard can turn the red "no macro data" line into a
"did you mean…" picker — the data is on the wire now.

### 3. `backend/src/lib/recipeImporter.js` (not owned)
Same request Agent 03 made: forward the resolver's `reason` into `importNotes`
and carry `candidates` onto the ingredient. `recipeGeneration.js` now does this;
the importer still drops them.

### 4. `backend/prisma/schema.prisma` (Agent 04)
AI provenance is currently expressed with the existing `Recipe.source =
"ai-generated"` (now whitelisted in `persistRecipe`, so a caller typo cannot
label an AI row "curated"). There is no column for "AI-authored **and not yet
verified by a human**". If that distinction matters for the library UI, it wants
a nullable boolean/enum on `Recipe` — a schema change Agent 10 did not make.

### 5. `backend/scripts/runTests.mjs` (not owned)
Three test files added (`aiGovernance.test.js`, `aiGovernanceStructure.test.js`,
`recipeDraftsPlaceholderGuard.test.js`, +50 tests). The floors are minimums so
nothing breaks, but they should be raised once the fleet's files have landed.

### 6. Queued work inside `brain/**` (Agent 10's own files, deliberately not done)
`tailor.js`, `selector.js` and `create.js` reach the transport with **no cost
cap**. They are registered in `LLM_CALL_SITES` as `costControl: "none",
dormant: true`, and test **S4** proves the dormancy claim on every run: the
moment anything outside `src/lib/brain/` calls `tailorRecipe()`, `proposeDay()`
or `generateRecipe()`, that test fails and names the caller. Wiring them through
`governedModelCall()` was left out on purpose — their default `runLoop` would
then construct the Prisma-backed ledger inside `tests/brain/brainMock.test.js`,
which would write `LlmUsage` rows into `backend/prisma/dev.db` during a test
run. Do it together with a ledger injection in that suite.
