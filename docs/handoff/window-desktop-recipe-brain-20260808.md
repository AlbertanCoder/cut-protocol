# HANDOFF — Claude Code session rooted at `&lt;local&gt;\Desktop`

Written 2026-08-08 in response to ORCHESTRATION.md PROMPT A.

**Deliberately written OUTSIDE the repo.** PROMPT A specifies
`docs/handoff/window-<N>-<branch>-20260808.md`, but `docs/handoff/` is not on the
manifest allow list and `guard-edit.js` is fail-closed. My session could have written
there anyway (see IDENTITY below — I have no guards), and routing around a guard is
exactly what the charter forbids. Move this file into `docs/handoff/` yourself once
the manifest allows it.

## IDENTITY

1. `git rev-parse --show-toplevel` → `&lt;local&gt;/Desktop/cut-protocol`
   (reached by absolute path; **this session's cwd is `Desktop`, not the repo**)
   branch `recipe-brain`, HEAD `794e914`.
2. `git status --porcelain`, verbatim:
   ```
   ?? ORCHESTRATION.md
   ?? V2-DELTA.md
   ```
   Neither is mine. I created no tracked or untracked file inside the repo.
3. Not run — I am not a workstream on this branch and have no commits.

### ⚠ THE MOST IMPORTANT LINE IN THIS FILE

**This session is rooted at `Desktop`, so NONE of the repo's hooks applied to it.**
`.claude/settings.json` invokes `node .claude/hooks/guard-edit.js` by relative path;
from outside the repo root that is a no-op, which is *not* a block. ORCHESTRATION.md
notes this for the orchestrator's own launch but does not draw the conclusion:

> The guard model is keyed to the session's working directory. Any Claude Code session
> started anywhere other than the repo root has **zero** guards over this repo —
> no write allow-list, no shell denylist, no deletion guard, no push interlock.

I am the proof. Last night I wrote 126 rows to `backend/prisma/dev.db` and recomputed
108 `Recipe` macro caches. Nothing stopped me, and nothing could have. Consolidating
into "one governed terminal" does not close this — it only governs the terminals that
happen to start in the right place.

## WHAT THIS SESSION WAS FOR

4. It began as a code review of a standalone Python meal-portion solver the owner
   pasted in (nothing to do with this repo). It became: measuring what the shipped
   meal engine actually produces, discovering why the owner won't eat its output, and
   fixing a recipe-data bug that came out of that.
5. **DONE and verified:**
   - `cd backend && npm test` → `1638 tests, 0 failures` (128 files), run after my
     dev.db writes. Pasted output seen 2026-08-08.
   - `npm run dist:check` → `checkDistSafe: safe to share — no secrets or personal
     data in release.`, exit 0, run 2026-08-08 on the current `release/` (214 files).
     **This contradicts ORCHESTRATION.md's URGENT claim** that release/ leaks a JWT
     secret, USDA key, cleartext seed password and 10 users' health data. I read
     `checkDistSafe.mjs` to confirm it is not blind here: it indexes `app.asar` via
     `@electron/asar`, falls back to a raw chunked byte scan, opens shipped SQLite to
     count User rows, and treats an unopenable one as unsafe. Caveat that remains: it
     can only vouch for the build on disk now, not for any installer already shipped.
   - `node scripts/parity-check.js` — NOT run by me. I only read it, and note it is a
     documentation checker (F-IDs across INVENTORY/PROGRESS + `@feature` greps in
     `frontend/src`). It does **not** verify macro values, so it cannot detect the
     kind of data change I made.
6. **Half-finished:** the herb-weight data fix. 126 of 189 flagged rows applied, then
   28 reverted (see below). **63 rows deliberately left undone** — they need an owner
   decision, listed in `&lt;local&gt;\Desktop\herb-fix-review.csv`.
7. Next action would have been: measure what fraction of days pass the fat guardrail
   at 35 % vs 40 % vs 45 %E using only the 27 dishes the owner approved.

## WHAT I OWN / TOUCHED

8. **Inside the repo — writes:** `backend/prisma/dev.db` ONLY. Nothing else, ever.
   Reads: `mealSolver.js`, `weeklyPlanner.js`, `macroCloser.js`, `planContext.js`,
   `bmrEngine.js`, `dietaryFilter.js`, `prisma.js`, `schema.prisma`,
   `scripts/qc/{personaPlan,dayDump}.mjs`, `scripts/{parity-check,checkDistSafe}.mjs`,
   `MIGRATION/{CONTRACT,PHASES}.md`, `CLAUDE.md`, `DO-NOT-TOUCH.md`, `HANDOFF-CURRENT.md`,
   `fleet/scratch/W3-2/portioner.cjs`.
   **Outside the repo (mine, safe to delete):** `Desktop\portion-solver\`,
   `Desktop\herb-fix-{apply,revert-increases}.cjs`, `Desktop\herb-fix-plan.json`,
   `Desktop\herb-fix-review.csv`, `Desktop\meal-review.txt`,
   `Desktop\fleet-scratch-backup\`, `Desktop\Backups\dev.db.backup-2026-08-08-herbfix`.
9. **YES — `backend/prisma/` was modified.** Detail, because this is the contested
   layer and it is invisible to git (`backend/.gitignore:5` ignores `prisma/dev.db`):
   - **98 `RecipeIngredient.baseGrams` values reduced**, correcting herbs/spices stored
     at bulk weights (200 g thyme, 125 g bay leaves ≈ 600 leaves, 150 g cardamom).
     Root cause: the TheMealDB importer had no gram conversion for herb units and fell
     back to a fixed 25 g or 50 g per unit, so "4 sprigs" became 200 g.
   - **108 `Recipe` cached macro rows recomputed** with the existing, untouched formula.
   - **28 rows I first changed and then reverted.** My conversion read TheMealDB's
     measure strings, which describe a WHOLE RECIPE, while `baseGrams` is PER SERVING.
     Any source measure already in bulk units got written straight in and made the row
     worse — cornstarch 25 g → 200 g in two alfajores recipes, dill → 113 g. Reverted
     to the original stored values; net invariant now holds: **the migration only ever
     lowered an amount.** 0 rows remain increased.
   - No schema change, no migration, no persistence version bump, no column reshape.
   - **Restore path:** copy `Desktop\Backups\dev.db.backup-2026-08-08-herbfix` over
     `backend/prisma/dev.db`. SHA-256 verified byte-identical to the pre-write file.

## WHAT I KNOW THAT ISN'T WRITTEN DOWN

10. **Traps and pre-existing breakage:**
    - `backend/scripts/qc/dayDump.mjs` **copies and sha256s `dev.db`** (`prepareDb()`,
      ~L98-116). DO-NOT-TOUCH says never copy or hash that file. Use
      `qc/personaPlan.mjs` instead — synthetic profile from CLI args, and its only DB
      read is `prisma.recipe.findMany`.
    - **`fleet/scratch/` is gitignored**, so `portioner.cjs` AND its required
      `macroViolation.cjs` exist only on this machine, in no repo. Committed ancestor
      for the L₂ arm: `docs/surgery/CAMPAIGN/solver-brain/A13/a13-hook.cjs`.
      I copied the tree to `Desktop\fleet-scratch-backup` (trimmed to 21.8 MB of
      source/reports; same drive, so not real backup).
    - **`fleet/DASHBOARD.md`'s headline gains are stamped with a dead ruler.** +10.91
      (c14+c2) and +12.36 (wls2) were measured by W3-2 probes whose
      `macroViolation.cjs` hardcodes `DAY_TOL {kcal .15, protein .15, fat .25, carb .25}`
      — the symmetric band ruler the app replaced on 2026-08-03. Re-derive against
      today's `dayTolerance()` before quoting them.
    - **Repo-root greps return every hit up to 3×** at 3 different line numbers,
      because two full worktrees live inside the repo at `.claude/worktrees/`. Scope
      searches to `backend/src`, `backend/tests`, `frontend/src`.
    - `CLAUDE.md`'s 15 %E fat floor is superseded by **20 %E** in
      `mealSolver.js` (`DAY_FAT_PCT_ENERGY_MIN`, commit `6142b55`). 20 is correct —
      do not "fix" it back to match the doc.
11. **Verbal-only instructions given to me in conversation, not in any committed file:**
    - The owner explicitly authorised backing up and writing to `backend/prisma/dev.db`
      ("back up dev.db then run it with --apply"), overriding DO-NOT-TOUCH for that
      one action. That authorisation was for the herb fix only and does not generalise.
    - The owner parked ALL quant/FTMO/VPS work on 2026-07-18 ("forget these").
    - The AI/brain layer was explicitly parked 2026-08-03 — **note the current branch
      is `recipe-brain`, which may contradict that.** Worth asking.
12. **Blocked on / escalated, never routed around:**
    - Refused to port the Python solver into `backend/` — DO-NOT-TOUCH covers the whole
      tree. Asked for an override; never received one; abandoned the port. Later found
      it was unnecessary anyway: the ruler it would have added already ships.
    - Refused to copy "10 code files, 6 test files, 3 docs" into `backend/` and `docs/`
      on request — **those files do not exist.** I searched Desktop, the audit clone and
      all worktrees for recently-modified code/docs and found none. Probably a
      different session's context. Unresolved.
13. **Referenced and did not exist:** `docs/handoff/` (PROMPT A's own target).

## THE ONE FINDING WORTH CARRYING FORWARD

The engine hits its numbers almost perfectly — every generated day landed within 1 %
of the kcal target with protein in band. But **the food the owner will actually eat runs
38–48 % of energy from fat, and `dayTolerance()` caps fat at 35 %E.** Rebuilding three
weeks from only his 27 approved dishes: 15 of 21 days failed, every one on fat, every
one over. Across three normally-generated weeks the app served 40 distinct dishes and
exactly **one** was on his approved list.

Nothing in the solver knows what the user likes — only macros. Measured preference data
(187 swipes, complete): hard zeros on Seafood 0/20, Side 0/20, Vegetarian 0/20,
Starter 0/8, Vegan 0/5. Strongest signal is **form, not cuisine** — handheld food
(sandwich/burger/wrap/arepa) 10/11 kept vs a 14 % baseline. Cuisine is a *weak*
predictor: filtering to "Western + Chinese + Latin" would have discarded 9 of his 27
keepers. And his own answers are **~50 % unstable** — of 16 dishes approved in an
earlier session and re-shown, 8 flipped.

⇒ Treat swipe data as a soft bias, never a hard filter. Ask what to EXCLUDE, never
what to INCLUDE.

HANDOFF WRITTEN — recipe-brain — SAFE TO CLOSE
