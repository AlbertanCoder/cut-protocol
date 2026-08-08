# PROMPT S — RECIPE BRAIN INTEGRATION (the surgeon)

Forged under the TENTH POINT STANDING ORDER. Paste into Claude Code at the repo
root. Run to completion, then hand `claims.md` + `evidence/` to a FRESH session
running PROMPT V. Do not paste V's output back into this session.

---

## MISSION

The Recipe Brain library exists and is tested but is wired to nothing. Land it
on this machine, connect it to the solver, expose it through routes and one UI
surface, prove the durable cache actually writes and reads, and measure what it
buys — without changing what "on target" means anywhere.

## LEASH

`STOP.` · `Named incisions only.` · `Resume the moves.` A guard block is a stop
sign, not a puzzle: report it, never rephrase around it.

## GRAMMAR

You emit **CLAIMS**. The words VERIFIED, FALSIFIED and UNVERIFIABLE are banned
from your entire vocabulary — they belong to a verifier that did none of this
work. One falsifiable sentence per claim, artifacts by path:

```
CLAIM(C-OFF): with BRAIN=off the solver's plan output is byte-identical to
  pre-integration — artifacts: evidence/E2-off-diff.txt, evidence/E2-goldens.txt
```

A claim without a re-derivable artifact is auto-falsified. Null results are
**pre-authorized**: "the free arm moved coverage 0.0pp" is a finding, not a
failure, and reporting it honestly is the job. Every uncertainty resolves
**fail-closed**.

---

## M-HARNESS (first move — before any incision)

**A0.** Consult the installed Claude Code hooks/settings docs and adapt the
templates below to the syntax this version accepts. The SPEC is binding; the
syntax is whatever works. A8 catches syntax rot, because a guard that does not
visibly block does not exist.

**A1.** `docs/surgery/<run_id>/manifest.json` + a stable `docs/surgery/CURRENT`
pointer. `run_id` = `surgery-recipe-brain-<YYYYMMDD-HHMM>`. Allow list:

```
backend/src/lib/recipeBrain/
backend/tests/recipeBrain/
backend/data/recipeSources.json
backend/src/lib/aiRecipeClient.js
backend/src/lib/recipeGeneration.js
backend/src/lib/weeklyPlanner.js
backend/src/routes/recipes.js
backend/src/routes/plans.js
backend/scripts/runTests.mjs
backend/scripts/qc/
frontend/src/components/RecipesTab.jsx
frontend/src/components/PlanTab.jsx
frontend/src/components/ui/
frontend/src/lib/api.js
docs/recipe-brain.md
docs/surgery/<run_id>/
scripts/surgery/
.claude/
PROGRESS.md
CLAUDE.md
```

`.claude/` and `scripts/surgery/` are allowed ONLY during M-HARNESS (see A9).
`PUSH_APPROVED` is never on the manifest.

**A2.** PreToolUse hook on `Edit|Write|MultiEdit|NotebookEdit` —
`.claude/hooks/guard-edit.sh`: read the tool input's file path, resolve relative
to the repo root, allow only if it starts with a manifest entry; otherwise print
`BLOCKED: <path> is not on the incision manifest.` to stderr and `exit 2`.

**A3.** PreToolUse hook on `Bash` — `.claude/hooks/guard-bash.sh`, deny list
forged for THIS phase:

```
git +push · git +reset · git +rebase · --force · rm +-rf
prisma +migrate +reset · prisma +db +push
<the goldens relock invocation, verbatim>
:3001 | port +3001                 # the live app is sacred
<packaged DB filename>             # read-only forever
PUSH_APPROVED                      # only the owner's hand writes this
cat +[^ ]*\.env | printenv +[A-Z_]*(KEY|ANTHROPIC) | sk-ant-
```

M7 needs live model calls — they go through `scripts/surgery/witness.sh` (A6)
and nowhere else, so no carve-out is needed in this list.

**A4.** Register both hooks in `.claude/settings.json` AND deny push/reset/rebase
via permission rules. Two locks, one door.

**A5.** `.git/hooks/pre-push`: refuse unless
`docs/surgery/CURRENT/PUSH_APPROVED` contains exactly `go <run_id>`.

**A6.** `scripts/surgery/witness.sh` is the ONLY path to live spend. It must:
assert the target DB is the dev DB and refuse otherwise; back the dev DB up
first; export the cap variables the pre-call guard consumes (**≤ 60 calls, ≤
$3.00** for this phase's M7 sample — nothing else in this phase spends);
stamp t0/t1; and print the ledger delta via `scripts/surgery/ledger-delta.sh`,
a SQL query, so you never do arithmetic you are judged on. If the pre-call guard
does not read env caps, wiring it becomes a named incision.

**A7.** `scripts/surgery/goldens-verify.sh` exits non-zero on any byte diff. The
relock invocation is in A3's deny list for the whole phase: relock is not
forbidden, it is impossible.

**A8. GUARD PROOFS — the cage gets its own control run.** Before M1, attempt one
forbidden action per guard: edit an off-manifest file, `git push --dry-run`, echo
a string containing `sk-ant-FAKE`, invoke the relock, probe port 3001, write
`PUSH_APPROVED`. Paste every refusal verbatim into `evidence/E0-guardproofs.txt`.
Grammar per guard: `PROVEN-BLOCKS` / `FAILED-OPEN`. Any FAILED-OPEN → fix and
re-prove before any incision. **No proof, no surgery.**

**A9.** Commit the harness, remove `.claude/` and `scripts/surgery/` from the
allow list, then prove the lock: attempt to edit a hook, paste the block.

---

## THE MOVES

Bounds: one move at a time, verify, commit. Never two moves in one commit.

### M1 — LAND THE LIBRARY

Branch `recipe-brain` off **current HEAD** (your uncommitted campaign work is
preserved — do not stash it, do not branch off origin/master).

The delivered files were authored against GitHub `master` 8796f5f. This machine
is ahead. So: drop in the new files, then **re-verify every import seam against
THIS repo**, not against the version they were written for. Named seams to
re-check by reading the actual export lists here:

| recipeBrain imports | from |
|---|---|
| `scaleRecipe, enforceScaledCarbCeiling, practicalGrams, eligibleRecipes, estimateSlotTarget, SCALE_BOUNDS, KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT` | `weeklyPlanner.js` |
| `buildBias` | `mealSolver.js` |
| `scoreRecipe, explainPool, buildCostCache` | `recipeCost.js` |
| `filterRecipePool` | `planContext.js` |
| `verifyDraft, MODEL_LADDER, ESCALATABLE, PRE_CALL_REFUSALS` | `mealRouter.js` |
| `solvePortions`, `hashInputs`, `normTerms/KCAL_BUCKET/PROTEIN_BUCKET`, `clampProposedTier` | `brain/optimizer.js`, `brain/cache.js`, `brain/slotCache.js`, `brain/taste.js` |
| `recipeExceedsKetoCeiling` | `dietaryFilter.js` |
| `persistRecipe, defaultLoadFoods, RECIPE_INCLUDE` | `recipeGeneration.js` |
| `resolveIngredient` | `ingredientResolver.js` |

If a signature here differs from what the library expects, **adapt the library to
this repo** — never the reverse, and never by re-implementing the function.

Re-apply by hand the three additive edits (they may conflict with campaign work):
`aiRecipeClient.buildPrompt` optional spec-hint params; `recipeGeneration.persistRecipe`
optional `aiFingerprint`/`aiVerifiedAt`/`aiVerifiedBy`; `scripts/runTests.mjs`
tripwire floors re-measured from a real run.

No migration: `20260724120000_stage3_4_recipe_filters_and_ai_fingerprint` already
created the columns. Confirm that on THIS schema before relying on it.

`CLAIM(C-LAND)`: the suite runs green at N files / M tests with the recipeBrain
files present and the floors re-measured — artifact: full run output.

### M2 — THE SOLVER SEAM

Wire `recipeBrain.routeSlotCompat` as `aiFallback.routeMealSlotImpl` on the
solver's unattended path (injection at the call site — do NOT edit
`weeklyPlanner`'s internals). Behind an env flag `RECIPE_BRAIN` = `on|off`,
default **off**.

`CLAIM(C-OFF)`: with `RECIPE_BRAIN=off` AND `BRAIN=off`, plan generation output
is byte-identical to pre-integration on the same seed — artifacts: a diff of two
runs + `goldens-verify.sh` output.
`CLAIM(C-SEAM)`: with `RECIPE_BRAIN=on` and `BRAIN=off`, a slot the library
cannot fill returns the recipe brain's honest degrade carrying a named binding
constraint, and zero model calls occur — artifact: run log + ledger delta = 0 rows.

### M3 — ROUTES

`POST /api/recipes/brain/solve` (one spec → one sourced recipe, returns the full
attempt trail) and gap-fill threaded into the existing day-options path behind
the same flag. Same governance discipline as every other route: gated, capped,
ledgered, honest 503 with no key.

`CLAIM(C-ROUTES)`: keyless boot serves both routes with an honest refusal and no
crash — artifact: request/response transcript.

### M4 — THE DURABLE CACHE, LIVE

Prove on a real dev DB that a verified generated recipe writes `aiFingerprint` +
`aiVerifiedAt` + `aiVerifiedBy`, and that a second identical request is served
from that row **after a process restart** with zero model calls. This is the
first code in the project's history to use those columns.

`CLAIM(C-DURABLE)`: fingerprint written, row served post-restart, ledger delta
between the two requests = 0 — artifacts: SQL dump of the row, two run logs,
ledger-delta output.

### M5 — THE UI SURFACE

One surface, AURORA RINGLIGHT laws binding (green scarcity, no red on food, fixed
macro triad, elevation is lightness). Minimum: the dials already exist in
`FilterControls` — add sourcing **provenance** to the plan/recipe rows (library /
cached / imported / AI, using the existing badge vocabulary, never green), and
the honest degrade line with its named binding constraint where a slot missed.
Desktop-first. No new colour tokens.

`CLAIM(C-UI)`: a fresh throwaway account walks wizard → generate → sees a
sourcing badge and, on a missed slot, the named binding constraint — artifacts:
screenshots at 1568px, oxlint + vite build output.

### M6 — WEB DILIGENCE (report only — ship it disabled)

For each of the three sites in `backend/data/recipeSources.json`: fetch
`robots.txt`, read the terms of use, and record what each permits and forbids for
automated retrieval. Write a findings table into the receipt. **Change no
`enabled` flag** — that is the owner's call after reading your table.

`CLAIM(C-WEB)`: all three sites remain `enabled: false` and the channel is a
proven no-op in that state — artifacts: findings table, registry diff (empty),
a test run showing zero fetches.

### M7 — MEASURE

Two arms on the 250-persona fleet, identical seeds, reported as the 2×2
(all-days / satisfiable-only × ruler A / floor ruler), per-diet:

- **FREE ARM, full fleet, $0** — `RECIPE_BRAIN=on`, generation OFF. Measures what
  matrix ranking + the guarded repartition + the cache buy with no spend.
- **PAID SAMPLE, capped** — ~40 gap days through `witness.sh` under its ≤60-call /
  ≤$3.00 cap. Estimate only; say so.

Also report the router counters: cache-hit rate, free rate, discarded drafts,
and the repartition accept/reject ratio.

`CLAIM(C-FREE)`: free-arm delta vs the pre-integration baseline on identical
seeds is X.Xpp all-days / Y.Ypp satisfiable — artifacts: both run JSONLs, the
scoring script, the DB macro fingerprint.
`CLAIM(C-PAID)`: the capped sample filled N of M gaps at $Z — artifacts: witness
log, ledger-delta SQL output.
`CLAIM(C-SAFE)`: zero allergen leaks and zero floor breaches across both arms —
artifact: the sweep output.

---

## STOP HERE

Write `docs/surgery/<run_id>/claims.md` and an `evidence/` index. Do not write a
verdict. Do not summarise your own quality. Do not push — the pre-push hook will
refuse you, and that is correct.

---

## APPENDIX — ENFORCEMENT MAP

| rule | held by |
|---|---|
| named incisions only | GUARD(guard-edit) |
| no push / reset / rebase / force | GUARD(guard-bash) + permission rules + GUARD(pre-push) |
| no secrets echoed or read | GUARD(guard-bash) |
| the live app on :3001 is untouchable | GUARD(guard-bash) |
| goldens are never relocked | GUARD(guard-bash) + VERIFIER(goldens-verify re-run) |
| spend ≤ 60 calls / ≤ $3.00 | GUARD(witness.sh caps) + console key cap + VERIFIER(own ledger SQL) |
| the surgeon cannot weaken its own cage | GUARD(A9 lock) + its own proof |
| BRAIN=off is byte-identical | VERIFIER(re-run + goldens) |
| no allergen reaches a plate | VERIFIER(own transitive DB query, every brain-filled slot) |
| every displayed number traces to Food rows | VERIFIER(own recomputation) |
| coverage deltas are real | VERIFIER(own re-scoring from the JSONLs) |
| web sites stay disabled | VERIFIER(registry diff) |
| adapt the library to this repo, never re-implement a solver function | TRUST-BASED — "is this the same function or a fork of it" is judgment |
| choose the smaller, clearer diff | TRUST-BASED — taste, not a hook |
| UI honours the colour laws | TRUST-BASED — a linter can catch hexes, not meaning |

Three TRUST-BASED rows. That is the residual risk register, marked rather than
hidden.

**END PROMPT S**
