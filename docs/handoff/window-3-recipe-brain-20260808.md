# Handoff — WINDOW 3 — 2026-08-08 (amended PROMPT A)

**Path used: `docs/handoff/` — the preferred one. No guard block. See item 4, which is
the whole reason that sentence is interesting.**

**This is the same session that wrote `window-9-saas-launch-20260808.md`.** It was told
"you are WINDOW 3" and pointed at the amended prompt, so it is answering again under the
new numbering. Window 9 is the long form — the teardown findings, the full trap list,
the corroboration table — and is committed. **This file does not repeat it.** It covers:
the new question 4, what has changed since window 9 was written, and which of window 9's
open items are now closed. Dedupe against window 9, do not read them as two sessions.

---

## IDENTITY

**1.**
```
git rev-parse --show-toplevel   <repo root — absolute path redacted, public repo>
git branch --show-current       recipe-brain
git rev-parse --short HEAD      2de33be
```
This session's own work is on `saas-launch` (`d47316b`). The main worktree was checked
over to `recipe-brain` by another session while this one was idle; that is a fact about
the checkout, not about what this window did.

**2. `git status --porcelain` — verbatim:**
```
```
**Empty.** Clean tree, nothing modified, nothing untracked. When window 9 was written
this same command returned 8 lines of another session's in-flight work; that has all
since been committed by somebody. Nothing of mine is uncommitted, and nothing of mine
is pending.

**3. `git log --oneline -6`** (no `origin/saas-launch` ref — nothing is pushed):
```
2de33be docs(orchestration): amend PROMPT B — missions 0 and 1 are already done
e547224 docs: neutralise the branch-deletion instruction, reconcile CLAUDE.md
ae7df6d chore(permissions): drop the backend/src/lib/** denies — MISSION 1 item 3 closed
9dba8d0 docs(orchestration): resolve MISSION 1 item 3 — analysis, not the edit
d0dd279 docs(handoff): fix the redaction placeholder rendering
6b4bf3a docs(handoff): sweep in the handoff that was stranded outside the repo
```
None of these six are mine. My only commit is `d47316b`, on `saas-launch`.

**4. DID THE GUARDS BIND? — No. This terminal is ungoverned.**

This is the question the amendment was added for, so here is the evidence rather than a
verdict.

`CP_ROLE` is **unset** in this terminal (`$env:CP_ROLE` → empty). Per `role.js` that
fails closed to **architect**, and per the amended prompt's own table architect means
`docs/handoff/` → BLOCK and `git commit` → BLOCK.

Three independent things happened that contradict that:

| Action | Table predicts | What actually happened |
|---|---|---|
| Write `docs/handoff/window-9-...md`, `CP_ROLE` unset | **BLOCK** (role door) | Succeeded, silently |
| `git commit` → `d47316b` | **BLOCK** | Succeeded |
| Edits to `backend/src/routes/weighins.js`, `frontend/src/components/TrendTab.jsx`, `BATTLE-PLAN.md`, `TEARDOWN-2026-08-06.md` while the live manifest was `campaign-p2-m0` (2026-07-28), whose allow list contained none of those paths | **BLOCK** | All succeeded |

Three signals, all the same direction: **no hook ever fired in this terminal.** It is the
table's third row — "no hooks (launched outside repo root)". I do not know the directory
it was launched from; the effect is all I can attest to.

**What I did NOT do, deliberately:** I did not run a probe write against a hard-denied
path (`backend/tests/golden/`, `.claude/`) to confirm. Under the hypothesis being tested
— hooks absent — a probe *succeeds*, which means it leaves junk in a sealed directory
that `guard-migration.js` then forbids anyone from cleaning up. The three natural
experiments above are already conclusive and cost nothing.

**Why this matters beyond one window:** a successful write proves nothing on its own, and
that is exactly the ambiguity the amendment names. Every artifact this session produced —
including `d47316b`, which touched `backend/src/` — was produced **outside the harness**.
If the orchestrator is reasoning about which changes were guard-vetted, none of mine were.

---

## WHAT I WAS DOING

**5.** An adversarial teardown of the product as a business (recon, LLM cost model, safety
audit, positioning, pricing, roadmap), then executing the first correctness fix off the
resulting plan. Deliverables: `TEARDOWN-2026-08-06.md` and commit `d47316b`.

**6. DONE AND VERIFIED** — full detail in window 9. Summary and the commands actually run:

`d47316b` — `/weighins/summary` now calls `bmrEngine.trailingAverage()` instead of
`entries.slice(-7)`. The "7-day average" was the last seven **rows**; a 3×/week weigher
got a ~16-day window. `resolveEnergy()` feeds that weight into `computeEnergy()`, so every
BMR formula, the TDEE, the derived target and all four macro ranges were built on it.

- `node --test tests/weighinsSummaryTrailingAverage.test.js` → **5/5 pass**
- `npm test` (backend, full) → **1638 tests, 0 failures** (was 1633)
- `npm run lint` (frontend) → clean in the touched file; pre-existing warnings elsewhere
- `npm run build` (frontend) → **built in 706ms**

**UNVERIFIED, and it matters:** those numbers are from 2026-08-06. **Six commits have
landed since and I have not re-run anything.** Do not quote 1638/0 as current.

**7. HALF-FINISHED: nothing.** No partial edit of mine exists anywhere. I stopped
cleanly before the companion commit rather than leaving it mid-flight.

**8. NEXT ACTION I WOULD HAVE TAKEN.** Fix the two surviving `slice(-7)` sites and
re-base the goldens. **Both are still live, verified just now:**
```
backend/src/lib/adaptiveTarget.js:144   const last7 = upto.slice(-7);
backend/src/lib/weightNow.js:10         const last7 = weighins.slice(-7);
```
Read item 11 before running it. This is a calculation change and therefore an
ESCALATE-NEVER-DECIDE item under the standing law.

---

## WHAT I OWN

**9. Modified (all in `d47316b`, on `saas-launch`):** `backend/src/routes/weighins.js` ·
`backend/tests/weighinsSummaryTrailingAverage.test.js` (new) ·
`frontend/src/components/TrendTab.jsx` (comment only, lines 226–231).

**Intend to modify, untouched:** `backend/src/lib/adaptiveTarget.js:144` ·
`backend/src/lib/weightNow.js:10` · whichever goldens cover the derived-number chain.

**Also authored, now committed by the sweep (was untracked when window 9 flagged it):**
`TEARDOWN-2026-08-06.md`. **CLOSED** — confirmed TRACKED.

**10. Contested files.** `backend/src/lib/` — **not yet, but next**, the two lines above.
`frontend/src/components/TrendTab.jsx` — 3 comment lines, already landed. Not
`backend/prisma/`, not `index.css`, not `App.jsx`, not `Sidebar.jsx`, not `CLAUDE.md`.

---

## WHAT I KNOW THAT ISN'T WRITTEN DOWN

**11. Traps — only what is NEW or STILL OPEN since window 9.** The full list is there;
this is the delta, because a stale repeat is worse than a pointer.

**STILL OPEN — and the highest-value item in this file:**

- **`ux/simplify-2026-08` and `campaign-2026-07` still do not contain `d47316b`.**
  Re-verified minutes ago; unchanged since window 9. `ux/simplify` rewrites every frontend
  screen including `TrendTab.jsx`, one of the three files in that commit. **If either lands
  by replacing files, the seven-day fix is silently reverted and a 401 kcal/day error
  returns to every install.** This is a hard constraint on MISSION 2's abandon/port
  verdicts, not a preference. It is still not written in ORCHESTRATION.md.

- **The golden-fixture collision is now sharper, not resolved.** `b90b5b7`'s 11 profiles
  under `MIGRATION/golden/` were captured with `adaptiveTarget.js:144` and
  `weightNow.js:10` **still row-based** — they lock in the bug at the two sites nobody has
  fixed. Fixing those sites **will** fail those fixtures, correctly. The standing law says
  a failing golden fixture halts everything because the math moved; here the math moving is
  the entire point. **Somebody has to tell the orchestrator in advance**, or the rule will
  correctly stop a correct change. Compounding it: the new manifest hard-denies
  `backend/tests/golden/` above every allow list and every mode
  (`guard-edit.js:138`), so a governed session **cannot** re-base them at all. That is
  right for safety and it means this fix needs an explicit owner-hand step, not a widening.

- **`bmrEngine.trailingAverage()` is the pattern, not the exception.** Written, documented,
  unit-tested, and it had **zero production callers** while three files carried their own
  `slice(-7)`. One of three is fixed. A passing unit test proves a function works, never
  that anything calls it — the repo's own 2026-07-24 plan named this exact failure mode
  ("nine findings are the same failure: built correctly, never wired up") and it is still
  true. Worth a repo-wide sweep for other correct-but-uncalled primitives.

- **`scripts/scanSecrets.mjs:84` returns early on any file containing a NUL byte**, and
  `backend/src/lib/dietaryFilter.js` (the allergen vocabulary) has 3 — so the most
  safety-critical file in the repo is permanently exempt from the secret scan, and
  `backend/tests/scanSecrets.test.js:50` asserts that skip is correct. A green suite
  defends the hole.

- **`ScreenBoundary` written, documented in `DO-NOT-TOUCH.md`, mounted nowhere.** One line.

- **Account deletion impossible by schema** (`schema.prisma:68–75`, six `onDelete: Restrict`).

- **`brain/config.js:28` — the LLM cost cap is $15/month GLOBAL, across all users**, on
  `claude-opus-5` at ~$0.16/generation. ~94 generations for the entire customer base.
  Costless mitigation: do not set `ANTHROPIC_API_KEY` on the deploy.

- **No email, no scheduler, no error monitoring anywhere.** Nothing in this system can
  execute at a time a user did not personally initiate.

**CLOSED since window 9** — do not re-raise:
- `TEARDOWN-2026-08-06.md` untracked → now TRACKED
- `V2-DELTA.md` untracked → now TRACKED
- `.claude/settings.json` denying `Edit(backend/src/lib/**)` → dropped in `ae7df6d`
- `BATTLE-PLAN.md`'s "delete 12 branches / 10 worktrees, zero unmerged work" → neutralised
  in `e547224`
- The stale `campaign-p2-m0` manifest → replaced; `docs/handoff/` now granted

**12. Verbal-only instructions — none of these are in any committed file, and they die
with this window.** Unchanged from window 9 and repeated here **because item 12.4 is
still blocking and repetition is cheaper than a wrong price in a live payment system:**

1. **Agreed order of work:** correctness block → deploy → recruit 20 strangers → build the
   paid path during the 14-day wait. Owner said "Start" to exactly this.
2. **The falsifiable gate:** ≥6 of 20 open the app on day 14 AND ≥10 of 20 log 3+
   weigh-ins. Below either line, **do not proceed to billing.** Interview 5 either way.
3. **Trial length is load-bearing:** 14 days, because `expenditureEstimator` needs ~2 weeks
   of weigh-ins before `adaptive.applied` flips true. A 7-day trial ends before the only
   real differentiator has fired.
4. **PRICING IS AN UNRESOLVED OWNER DECISION AND BLOCKS WORK.** `BUILD_PLAN.md` marks
   $24.99/mo + $125/yr "locked, do not relitigate." The teardown recommends **$14.99/mo +
   $119/yr + 14-day trial**, with reasoning. **Nobody has ruled.** Do not touch
   `pricing-section.jsx` or create Lemon Squeezy variants until they do — test-mode LS
   products do not carry over to live, so a wrong price is expensive to undo.
5. **The wedge changed** from "beginners" to **men 28–45 in a deliberate 8–16 week cut who
   already track macros and are sick of logging.** Marketing voice is the owner's own story,
   not the engine.
6. **Skip Lemon Squeezy entirely for the 20-stranger test.** The cohort is free.
7. **Send the cohort's day-3 and day-14 emails by hand** (~40). Test the copy before
   automating it.
8. **Stop-building list, owner-acknowledged:** Brain/LLM coach (~35 files), AI recipe
   generation, Electron/desktop shell, micronutrients, Compare dialog, Design v2 passes
   2/3 and 3/3.

**13. BLOCKED ON — current, several of window 9's are now cleared:**

- **Owner decision on pricing** (12.4). Still open. Blocks Stage 3 onward.
- **Owner dashboard work**: Supabase project + Google OAuth client + Railway deploy
  (`BUILD_PLAN.md` Runbook Parts A–C). Nothing downstream happens first. Open since
  2026-08-06.
- **The golden re-base needs an owner-hand step** — `backend/tests/golden/` is hard-denied
  in every mode, by design.
- **Not blocked any more:** the `settings.json` `backend/src/lib/**` denial (`ae7df6d`), the
  stale manifest (replaced), the dirty working tree (clean now).

**14. Files referenced that turned out not to exist:**
- **The fridge/pantry-constrained solver does not exist.** `grep -i "pantry|fridge|onHand"`
  over `backend/src` hits only `foodCategories.js`, where "pantry" is a grocery aisle label.
  It has been described as a differentiator; it is not implemented.
- **The linear-programming portion solver is not in this repo** — it is a standalone 4-file
  prototype on the Desktop, outside the tree. The shipping `mealSolver.js` is candidate
  generation + weighted scoring + bounded scaling. No LP.
- **`docs/DISCLAIMER.md` exists but is not in the installer allowlist**, so it has never
  shipped anywhere.
- `frontend/public/terms.html` / `privacy.html` still contain literal `[SUPPORT EMAIL]`,
  `[DATE]`, `[REGION]`.

---

## WHAT I NOW THINK WAS WRONG

- **I worked in the main checkout instead of an isolated worktree.** The repo already had
  three worktrees and a documented pattern. That single choice is why my next commit ended
  up queued behind another session's branch.
- **`TrendTab.jsx` did not belong in `d47316b`.** The comment is correct and I stand by it,
  but bundling a frontend file into a backend correctness commit widened the collision
  surface with `ux/simplify-2026-08` for zero functional gain — and `ux/simplify` is
  precisely the branch that would silently revert that commit.
- **I let `TEARDOWN-2026-08-06.md` sit untracked for two days** for no reason, the same
  mistake `V2-DELTA.md` had to be rescued from. Someone else's sweep fixed it.
- **I assumed the guards were protecting me.** They were not, and I only established that
  when the amended prompt asked directly. Every artifact this session produced was
  ungoverned.

---

`docs/handoff/window-3-recipe-brain-20260808.md`

HANDOFF WRITTEN — recipe-brain — SAFE TO CLOSE
