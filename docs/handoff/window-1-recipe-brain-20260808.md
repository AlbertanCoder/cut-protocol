# HANDOFF — WINDOW 1 — `recipe-brain`

Written 2026-08-08 per `docs/orchestration/PROMPT-A-amended.md`.

**Path used: `docs/handoff/` (the preferred one). No guard block was returned —
and that fact is itself evidence, not reassurance. See question 4.**

> **DEDUPLICATION NOTICE — read before counting windows.**
> `docs/handoff/window-desktop-recipe-brain-20260808.md` (swept in by commit
> `6b4bf3a`) is **this same session's earlier draft**, written before the amended
> prompt existed. It is not a second window. This file supersedes it: same session,
> same knowledge, now answering the amended 14 questions including the new item 4.
> Count us as one window, not two.

---

## IDENTITY

**1.**
```
git rev-parse --show-toplevel  → (home)/Desktop/cut-protocol
git branch --show-current      → recipe-brain
git rev-parse --short HEAD     → 2de33be
```
Note the toplevel is reached by absolute path. **This session's working directory is
`Desktop`, not the repo root.** That single fact governs everything in question 4.

**2.** `git status --porcelain` — verbatim:
```
```
Empty. The tree is clean. Nothing of mine is pending, because I have never created or
modified a tracked file in this repo. (Earlier today the same command returned
`?? ORCHESTRATION.md` and `?? V2-DELTA.md`; both have since been committed by another
window — `V2-DELTA.md` is safe, which was MISSION 1 item 1.)

**3.** `origin/saas-launch` does not exist as a ref here. Last 10 commits — **none are
mine**:
```
2de33be docs(orchestration): amend PROMPT B — missions 0 and 1 are already done
e547224 docs: neutralise the branch-deletion instruction, reconcile CLAUDE.md
ae7df6d chore(permissions): drop the backend/src/lib/** denies — MISSION 1 item 3 closed
9dba8d0 docs(orchestration): resolve MISSION 1 item 3 — analysis, not the edit
d0dd279 docs(handoff): fix the redaction placeholder rendering
6b4bf3a docs(handoff): sweep in the handoff that was stranded outside the repo
66ca6f1 docs(orchestration): amend PROMPT A so it survives an architect window
a8011f1 harness(surgery): grant docs/qc/ — the escalation from 5c2645f, resolved
f8d5995 harness(surgery): install the orchestration-2026-08-08 window, selftest green
22989f7 docs(orchestration): draft the MISSION 0 manifest, with the CURRENT carve-out
```

**4. Did `CP_ROLE` get set, and did the guards actually bind? — NO, THEY DID NOT BIND.**

`CP_ROLE` is unset. But role is the wrong variable here, because **no hook ran at all**.
`.claude/settings.json` invokes `node .claude/hooks/guard-edit.js` by *relative* path;
this session's cwd is `Desktop`, so that resolves to nothing, node exits 1, and an
exit-1 is not a block. Every guard in this repo was decorative for me.

The amended prompt is right that a successful write proves nothing on its own. So here
is **positive proof** instead of an absence:

> On 2026-08-08 I wrote 126 rows to **`backend/prisma/dev.db`**. At that moment the
> manifest allow list was the stale 2026-07-28 one: `.claude/hooks/`,
> `.claude/settings.json`, `scripts/surgery/{witness,guard-selftest,pre-commit}`,
> `.git/hooks/pre-commit`, `docs/surgery/CAMPAIGN/`, `docs/surgery/campaign-p2-m0/`,
> `fleet/`, `backend/scripts/qc/`. **`backend/prisma/` was not on it.** A governed
> session would have been refused. I was not. Therefore the guards did not bind.

`backend/prisma/` is still absent from the *new* allow list, so that same write would
still be refused from a governed terminal today. **The hole is not that the manifest was
stale. The hole is that a session launched outside the repo root has no manifest at
all** — no write allow-list, no shell denylist, no deletion guard, no push interlock.
ORCHESTRATION.md notes the relative-path trap for the orchestrator's own launch but
does not draw this conclusion. Consolidating into one governed terminal does not
prevent an *ungoverned* one, and I am the proof that one existed.

---

## WHAT THIS SESSION WAS FOR

**5.** It began as a code review of a standalone Python meal-portion solver the owner
pasted in — unrelated to this repo. It became: measuring what the shipped meal engine
actually produces, finding out why the owner will not eat its output, and repairing a
recipe-data bug that discovery exposed.

**6. DONE and verified — commands I actually ran, with their results:**

| Command | Result |
|---|---|
| `cd backend && npm test` | `1638 tests, 0 failures` across 128 files — run **after** my dev.db writes |
| `npm run dist:check` | `checkDistSafe: safe to share — no secrets or personal data in release.` exit 0, on the current `release/` (214 files) |
| `node herb-fix-apply.cjs --apply` | 126 ingredient rows updated, 108 recipe macro caches recomputed |
| `node herb-fix-revert-increases.cjs --apply` | 28 rows restored |

**On `dist:check` — this contradicts ORCHESTRATION.md's URGENT claim** that the built
installer leaks a JWT secret, a USDA key, a cleartext seed password and 10 users'
health data. Before relaying the pass I read `scripts/checkDistSafe.mjs` to check it
was not blind: it indexes `app.asar` via `@electron/asar`, falls back to a raw chunked
byte scan so the archive is never a blind spot, opens shipped SQLite files to count
`User` rows, and treats an unopenable one as unsafe. It is a real verifier. **Residual
risk it cannot speak to: any installer already distributed from an earlier build.**

**NOT run by me, so I claim nothing about them:** `npm run build`, `npm run lint`,
`node scripts/parity-check.js`, `node scripts/surgery/guard-selftest.js`. I read
`parity-check.js` and note it checks F-IDs and `@feature` comments in `frontend/src` —
it is a *documentation* checker and cannot detect a data change like mine.

**7. Half-finished:** the herb-weight repair. 189 rows flagged, 126 applied, 28 of those
reverted, **63 deliberately left undone** because they need an owner decision — 34 whose
source measure was a bare garnish instruction ("Chopped", "To serve") and 29 with no
usable source at all. They are itemised in `(local)\Desktop\herb-fix-review.csv`, which
is **outside the repo and unbacked-up**.

**8. Next action would have been:** measure what fraction of days pass the fat guardrail
at 35 % vs 40 % vs 45 %E using only the 27 dishes the owner approved — i.e. turn the
finding in the last section of this file into a decidable number. Not started.

---

## WHAT I OWN

**9. Files modified inside the repo: exactly one — `backend/prisma/dev.db`.** Nothing
else, ever. No source file, no test, no config, no doc except this handoff.

Read-only (for the collision list, since reading is not owning): `mealSolver.js`,
`weeklyPlanner.js`, `macroCloser.js`, `planContext.js`, `bmrEngine.js`,
`dietaryFilter.js`, `prisma.js`, `schema.prisma`, `scripts/qc/{personaPlan,dayDump}.mjs`,
`scripts/{parity-check,checkDistSafe}.mjs`, `MIGRATION/{CONTRACT,PHASES}.md`,
`CLAUDE.md`, `DO-NOT-TOUCH.md`, `HANDOFF-CURRENT.md`, `fleet/scratch/W3-2/portioner.cjs`,
`docs/surgery/CURRENT/manifest.json`, `.claude/hooks/guard-edit.js`.

Artifacts outside the repo (mine; safe to delete, but see the warning in item 11):
`(local)\Desktop\portion-solver\`, `herb-fix-apply.cjs`, `herb-fix-revert-increases.cjs`,
`herb-fix-plan.json`, `herb-fix-review.csv`, `meal-review.txt`, `fleet-scratch-backup\`,
`Backups\dev.db.backup-2026-08-08-herbfix`.

**10. YES — `backend/prisma/` was modified.** It is invisible to `git status`
(`backend/.gitignore:5` ignores `prisma/dev.db`), so it will not appear in any diff
the orchestrator runs. Detail:

- **98 `RecipeIngredient.baseGrams` values reduced.** Herbs and spices stored at bulk
  weights — 200 g thyme, 125 g bay leaves (≈600 leaves), 150 g cardamom. Root cause:
  the TheMealDB importer had no gram conversion for herb units and fell back to a fixed
  25 g or 50 g per unit, so "4 sprigs" became 200 g.
- **108 `Recipe` cached macro rows recomputed**, using the existing untouched formula.
  No calculation code was altered — MIGRATION/CONTRACT constraint 2 is about
  calculations, and I changed data, not formulae.
- **28 rows changed and then reverted — my error, stated plainly.** My conversion read
  TheMealDB's measure strings, which describe a WHOLE RECIPE, while `baseGrams` is PER
  SERVING. Any source measure already expressed in bulk units went straight in and made
  the row *worse*: cornstarch 25 g → 200 g in two alfajores recipes, dill → 113 g,
  coriander → 85 g. I caught it in my own output, reverted all 28 to their original
  stored values, and recomputed those caches. Net invariant now holds: **the migration
  only ever lowered an amount; 0 rows remain increased.**
- No schema change, no migration, no persistence version bump, no column reshape.
- **Restore path:** copy `(local)\Desktop\Backups\dev.db.backup-2026-08-08-herbfix` over
  `backend/prisma/dev.db`. SHA-256 verified byte-identical to the pre-write file.
- **The per-serving vs per-recipe confusion may be wider than herbs.** If TheMealDB
  quantities were imported whole-recipe throughout, other ingredients are inflated the
  same way. I only examined herbs and spices. **Unverified and worth a real look.**

---

## WHAT I KNOW THAT ISN'T WRITTEN DOWN

**11. Traps, and things already broken before I arrived:**

- **`backend/scripts/qc/dayDump.mjs` copies and sha256s `dev.db`** (`prepareDb()`,
  ~L98-116). `DO-NOT-TOUCH.md` says never open, copy, hash or delete that file. The
  script is on the manifest allow list. That is a live contradiction between two
  governing documents. Use `qc/personaPlan.mjs` instead — synthetic profile from CLI
  args, and its only DB read is `prisma.recipe.findMany`.
- **`fleet/scratch/` is gitignored**, so `portioner.cjs` *and* its required
  `macroViolation.cjs` exist only on this machine, in no repo. Committed ancestor for
  the L₂ arm only: `docs/surgery/CAMPAIGN/solver-brain/A13/a13-hook.cjs`. I copied the
  tree to `(local)\Desktop\fleet-scratch-backup` (trimmed to 21.8 MB of source and
  reports) — **same physical drive, so that is not a real backup.**
- **`fleet/DASHBOARD.md`'s headline gains are stamped with a dead ruler.** +10.91
  (c14+c2) and +12.36 (wls2 L₂) were measured by W3-2 probes whose `macroViolation.cjs`
  hardcodes `DAY_TOL {kcal .15, protein .15, fat .25, carb .25}` — the symmetric band
  ruler the app replaced on **2026-08-03**. Probe mtimes are 2026-07-31. Re-derive
  against today's `dayTolerance()` before quoting either number.
- **Repo-root greps return every hit up to 3×** at 3 different line numbers, because two
  full worktrees live inside the repo at `.claude/worktrees/`. Scope every search to
  `backend/src`, `backend/tests` or `frontend/src`. This poisoned my own first search.
- **`CLAUDE.md`'s 15 %E fat floor is superseded by 20 %E** in `mealSolver.js`
  (`DAY_FAT_PCT_ENERGY_MIN`, commit `6142b55`), and **20 is the correct value** — the
  in-file rationale is that at 15 the grader blessed days the engine would never
  prescribe, and best-of-N then drifts to the loosest admissible edge. Do not "fix" the
  code back to match the doc.
- **Sub-gram ingredient rows are CORRECT, not corrupt.** 0.9 g salt, 0.2 g black pepper
  are real per-serving seasoning amounts displayed as "1 g" by `practicalGrams`' 1 g
  floor. I initially called these a bug; they are not. Only the *bulk* rows were wrong.

**12. Verbal-only instructions given to me in conversation, in no committed file:**

- The owner **explicitly authorised** backing up and writing to `backend/prisma/dev.db`
  ("back up dev.db then run it with --apply"), overriding `DO-NOT-TOUCH.md` for that one
  action. **That authorisation was for the herb fix only and does not generalise.**
- All quant / FTMO / VPS work was parked 2026-07-18 ("forget these").
- **The AI / brain layer was explicitly parked by the owner on 2026-08-03**, with the
  instruction not to re-raise it unprompted. **The current branch is `recipe-brain`.**
  That may be a deliberate reversal or an unnoticed contradiction — worth one question
  to the owner before an orchestrator sequences around it.
- The owner's stated quit triggers for this product: numbers he doesn't believe ·
  friction to get a plan · food he won't eat · the app drifting from reality.

**13. Blocked on, and never routed around:**

- **Refused to port the Python solver into `backend/`** — `DO-NOT-TOUCH.md` covers the
  whole tree. Asked the owner for an explicit override; never received one; abandoned
  it. Subsequently discovered the port was unnecessary anyway: the ruler it would have
  added already ships in `mealSolver.js`.
- **Refused to copy "10 code files, 6 test files, 3 docs" into `backend/` and `docs/`**
  when asked, because **those files do not exist.** I searched the Desktop, the
  `cut-protocol-audit` clone and all worktrees for recently-modified code and docs and
  found nothing matching. Probably another session's context leaking into this one.
  **Still unresolved — if another window is missing 19 files, this is the thread.**
- Declined to run `dayDump.mjs` at all, on the DO-NOT-TOUCH grounds in item 11.

**14. Files I referenced that turned out not to exist:** `docs/handoff/` (PROMPT A's own
original target, before the manifest amendment); the 19 files in item 13.

---

## THE ONE FINDING WORTH CARRYING FORWARD

The engine hits its numbers almost perfectly — every generated day landed within 1 % of
its kcal target with protein in band. But **the food the owner will actually eat runs
38–48 % of energy from fat, and `dayTolerance()` caps fat at 35 %E.**

Rebuilding three weeks from only his 27 approved dishes: **15 of 21 days failed, every
one on fat, every one over.** Across three normally-generated weeks the app served 40
distinct dishes and **exactly one** was on his approved list.

Nothing in the solver knows what the user likes — only macros. Measured preference data
(187 swipes, complete): hard zeros on Seafood 0/20, Side 0/20, Vegetarian 0/20,
Starter 0/8, Vegan 0/5. The strongest signal is **form, not origin** — handheld food
(sandwich / burger / wrap / arepa) scored 10/11 against a 14 % baseline. Cuisine is a
*weak* predictor: filtering to "Western + Chinese + Latin" would have discarded 9 of his
27 keepers. And his answers are **~50 % unstable** — of 16 dishes approved in an earlier
session and re-shown in the deck, 8 flipped.

⇒ Treat swipe data as a soft bias, never a hard filter. Ask what to EXCLUDE, never what
to INCLUDE. And do not ship copy claiming the app understands anyone's taste.

---

HANDOFF WRITTEN — recipe-brain — SAFE TO CLOSE
