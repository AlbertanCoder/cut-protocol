# Handoff — saas-launch / teardown session — 2026-08-08

**No window number was assigned to this session** (the whole ORCHESTRATION.md document was
pasted, not a numbered PROMPT A). Using `9` plus HEAD sha `5ae57f4` as the disambiguator,
per the collision rule in PROMPT A. If another window claims 9, this file is still uniquely
named by the sha.

**Filename branch is `saas-launch`, but the checkout is `recipe-brain`** — see IDENTITY.
All of this session's work belongs to `saas-launch`; the working directory was moved out
from under it by another session.

---

## IDENTITY

**1.**
```
git rev-parse --show-toplevel   <repo root — absolute path redacted, public repo>
git branch --show-current       recipe-brain
git rev-parse --short HEAD      5ae57f4
```

**This session never chose `recipe-brain`.** It worked on `saas-launch` and committed
`d47316b` there. Between that commit and now, another session checked the main worktree
over to `recipe-brain`. `d47316b` survives on `saas-launch` and is the merge-base of
`recipe-brain`, so nothing was lost.

**2. `git status --porcelain` — verbatim:**
```
 M backend/src/lib/aiRecipeClient.js
 M backend/src/lib/recipeGeneration.js
?? backend/data/recipeSources.json
?? backend/src/lib/recipeBrain/
?? backend/tests/recipeBrain/
?? docs/recipe-brain.md
?? docs/surgery/PROMPT-S-recipe-brain.md
?? docs/surgery/PROMPT-V-recipe-brain.md
```
**None of this is mine.** Every line belongs to the `recipe-brain` session. I cannot say
whether any of it is finished — I did not write it and did not read it. Ask that window.

My own working-tree changes are all committed; I left nothing uncommitted.

**3. `git log --oneline saas-launch` (last relevant):**
```
d47316b fix(engine): /weighins/summary averages seven DAYS, not seven rows   <- mine
8a63af6 saas: BUILD_PLAN — Stage 5/6 tooling done (1633 green); runbook D-E
```

---

## WHAT I WAS DOING

**4.** An adversarial teardown of the product as a business — recon, cost model, safety
audit, positioning, pricing, roadmap — then executing the first correctness fix off the
resulting plan. Two deliverables: `TEARDOWN-2026-08-06.md` and commit `d47316b`.

**5. DONE AND VERIFIED.** Commit `d47316b`, one logical change:

`backend/src/routes/weighins.js` now calls `bmrEngine.trailingAverage()` instead of
`entries.slice(-7)`. The route's "7-day average" was the last seven **rows**, so a
3×/week weigher got a window spanning ~16 calendar days. Not cosmetic — `resolveEnergy()`
feeds that weight into `computeEnergy()`, so every BMR formula, the TDEE, the derived
target and all four macro ranges were built on it.

Commands actually run, with results:
- `node --test tests/weighinsSummaryTrailingAverage.test.js` → **5/5 pass**
- `npm test` (backend, full) → **1638 tests, 0 failures** (was 1633; +5 new)
- `npm run lint` (frontend) → clean in the file I touched; pre-existing warnings elsewhere
  (`Parts.jsx:240`, `TodayTab.jsx:374`, several `only-export-components`) — **not mine,
  present before this session**
- `npm run build` (frontend) → **built in 706ms**, only the pre-existing >500 kB chunk warning

**Measured side effect, from the test's own `[target-drift]` log line:** on the fixture,
the corrected weight moves the derived daily target **2400 → 1999 kcal**. A 401 kcal/day
error was live in every install.

Also shipped in that commit: `avg7Meta` (count / windowDays / fromDate / toDate / stale /
staleDays) added **additively** to `/weighins/summary`, so `avg7Kg` keeps its
bare-number-or-null contract and no frontend consumer needed changing.

**6. HALF-FINISHED: nothing.** I deliberately stopped before the companion commit — see
item 12. There is no partial edit anywhere in the tree from me.

**7. NEXT ACTION I WOULD HAVE TAKEN** — and why you should probably *not* just run it:
fix the two remaining `slice(-7)` sites, `backend/src/lib/adaptiveTarget.js:144` and
`backend/src/lib/weightNow.js:10`, and re-base the golden baseline. **Do not do this
without reading item 12 first.**

---

## WHAT I OWN

**8. Files modified (all committed in `d47316b`):**
- `backend/src/routes/weighins.js`
- `backend/tests/weighinsSummaryTrailingAverage.test.js` (new, 214 lines)
- `frontend/src/components/TrendTab.jsx` (comment only — corrected a comment that claimed
  the server field was still row-based, which was true until `d47316b` and is now false)

**Files I intend to modify and have NOT touched:**
- `backend/src/lib/adaptiveTarget.js` (line 144, `upto.slice(-7)`)
- `backend/src/lib/weightNow.js` (line 10, `weighins.slice(-7)`)
- whichever golden baseline covers the derived-number chain

**Untracked files I created, which are at the same risk as `V2-DELTA.md`:**
- `TEARDOWN-2026-08-06.md` — **UNTRACKED.** ~500 lines: the full teardown, the LLM cost
  arithmetic, the safety verification, positioning/pricing/roadmap. **ORCHESTRATION.md's
  MISSION 1 names `V2-DELTA.md` as the only untracked-and-precious file. It is not.
  This one is in exactly the same category and should be committed in the same pass.**

**9. Contested files — yes, two of the six named:**
- `backend/src/lib/` — **not yet, but next.** `adaptiveTarget.js:144` and `weightNow.js:10`.
  Note `.claude/settings.json` on this branch denies `Edit(backend/src/lib/**)`, which is
  MISSION 1 item 3 — that denial blocks my next commit from the main worktree.
- Not `backend/prisma/`, not `index.css`, not `App.jsx`, not `Sidebar.jsx`, not `CLAUDE.md`.
- I did modify `frontend/src/components/TrendTab.jsx` (3 comment lines, 226–231).
  **`ux/simplify-2026-08` rewrites every frontend screen — assume it collides.**

---

## WHAT I KNOW THAT ISN'T WRITTEN DOWN

**10. Traps, gotchas, and things already broken before I touched them.**

The highest-value one first:

- **`ux/simplify-2026-08` (83 commits) and `campaign-2026-07` (55 commits) do NOT contain
  `d47316b`.** Verified: `git merge-base --is-ancestor d47316b <branch>` fails for both.
  If either wins a sequencing call and lands by replacing files, **the seven-day fix is
  silently reverted and the 401 kcal/day error comes back.** `ux/simplify` rewrites
  `TrendTab.jsx`, which is one of the three files in that commit. This is not in
  ORCHESTRATION.md and it belongs in MISSION 2's verdict table as a hard constraint on the
  abandon/port calls.

- **The golden-fixture collision.** `b90b5b7 migration(phase-1): golden fixtures — lock the
  whole derived-number chain` landed 17 minutes before I was going to change what that
  chain outputs — 11 profiles under `MIGRATION/golden/`, plus
  `backend/tests/golden/migrationGolden.test.js` and a 305-line fixture set. Those fixtures
  were captured with `adaptiveTarget.js:144` and `weightNow.js:10` **still row-based**, i.e.
  they lock in the bug for the two sites I have not fixed yet. Fixing those sites will fail
  those fixtures. Per ORCHESTRATION.md's own escalation rule — "a golden fixture that fails,
  stop everything, that means the math moved" — this one is *expected* to fail and the
  re-base is legitimate. **Somebody has to tell the orchestrator that in advance**, or the
  rule will correctly halt work on a change that is correct.
  Silver lining: 11 profiles is far better re-base coverage than the single baseline I had.

- **`bmrEngine.trailingAverage()` is the pattern, not the exception.** It was written,
  documented, and unit-tested, and had **zero production callers** while three separate
  files carried their own `slice(-7)`. `d47316b` fixed one of three. The repo's own 2026-07-24
  battle plan names this exact failure mode — "nine findings are the same failure: built
  correctly, never wired up." Assume it is still true elsewhere. A passing unit test proves
  a function works, never that anything calls it.

- **`scripts/scanSecrets.mjs:84` returns early on any file containing a NUL byte**, and
  `backend/src/lib/dietaryFilter.js` (122 KB, the allergen vocabulary, the most
  safety-critical source in the repo) contains 3 NUL bytes. It is therefore permanently
  exempt from the secret scan — and `backend/tests/scanSecrets.test.js:50` **asserts that
  the skip is correct**, so a green suite actively defends the exemption. Recorded in
  `CLAUDE.md`, never fixed.

- **`ScreenBoundary` is written, documented in `DO-NOT-TOUCH.md`, and mounted nowhere.**
  `grep ScreenBoundary frontend/src/App.jsx` → no matches. One render crash blanks the app
  including nav. One line to fix.

- **Account deletion is impossible by schema.** `backend/prisma/schema.prisma:68–75` — six
  relations default to `onDelete: Restrict`, so `prisma.user.delete()` throws P2003 for any
  user with a profile, weigh-in, plan, cart item, recipe or training plan (i.e. all of them).
  Six more tables carry a bare `userId` with no FK at all.

- **The global LLM cost cap does not scale with revenue.** `backend/src/lib/brain/config.js:28`
  — `monthlyUsd: 15` **globally, across all users**. AI recipe drafting runs on
  `claude-opus-5` ($5/$25 per MTok) at ~$0.16/generation, so $15 buys ~94 generations for
  the entire customer base. At 50 subscribers that is 1.9 each per month before everyone
  degrades to the deterministic fallback. Mitigation costs nothing: **do not set
  `ANTHROPIC_API_KEY` on the deploy** and the whole path is cleanly absent instead of
  intermittently broken.

- **No transactional email, no scheduler, no error monitoring, anywhere.** No
  `nodemailer`/`resend`/`@sendgrid`/`postmark`, no `node-cron`/`bullmq`/`agenda`, no Sentry
  (it appears only in `roadmap/` docs and a transitive `package-lock` entry). Consequence:
  **nothing in this system can execute at a time the user did not personally initiate.**
  `passwordReset.js` is deliberately local-file-based — correct for desktop, meaningless on
  a hosted deploy.

- **The AI-generation path has a user-toggleable allergen override** that defeats
  `exclusionGate.js`. Fine for a single-user desktop app; it is the sharpest liability edge
  in the repo the moment strangers pay. One boolean to remove on web.

**11. Instructions given in conversation and NOT in any committed file** — the highest-value
section, per PROMPT A. All of these are owner-approved verbally and exist nowhere on disk:

1. **The agreed order of work.** Correctness block → deploy → recruit 20 strangers → build
   the paid path during the 14-day wait. Owner said "Start" to exactly this.
2. **The falsifiable gate.** ≥6 of 20 open the app on day 14, AND ≥10 of 20 log 3+ weigh-ins.
   Below either line: **do not proceed to billing.** Interview 5 either way.
3. **Trial length is load-bearing, not arbitrary.** 14 days, because `expenditureEstimator`
   needs ~2 weeks of weigh-ins before `adaptive.applied` flips true. A 7-day trial ends
   before the product's only real differentiator has fired.
4. **PRICING IS AN OPEN OWNER DECISION AND BLOCKS WORK.** `BUILD_PLAN.md` marks
   $24.99/mo + $125/yr as locked, "do not relitigate." The teardown recommends
   **$14.99/mo + $119/yr + 14-day trial** with the reasoning. **Unresolved.** Nobody should
   change `pricing-section.jsx` or create Lemon Squeezy variants until the owner rules.
   Creating LS products at the wrong price is expensive to undo — test-mode products do not
   carry over to live.
5. **The wedge changed.** Away from "beginners" (the product is a precision instrument;
   beginners are the most price-sensitive, highest-churn, best-served-free segment) toward
   **men 28–45 in a deliberate 8–16 week cut who already track macros and are sick of
   logging.** Marketing voice is the owner's own story — construction by day — not the engine.
6. **Skip Lemon Squeezy entirely for the 20-stranger test.** The cohort is free. The code is
   already written; the dashboard clicks wait.
7. **Send the test cohort's day-3 and day-14 emails by hand.** ~40 emails. Tests the copy
   before automating it.
8. **Stop-building list, owner-acknowledged:** Brain/LLM coach (~35 files), AI recipe
   generation, the Electron/desktop shell, micronutrients, the Compare dialog, and Design v2
   passes 2/3 and 3/3.

**12. BLOCKED ON — and this is why I stopped rather than finishing:**

- **The main worktree is checked out to another session's branch with its uncommitted work
  in it.** I will not `git checkout` out from under a live session. I have no isolated
  worktree for `saas-launch`.
- **The golden-fixture collision above** — landing my next commit now breaks 11 fixtures
  committed 17 minutes earlier, and neither party could tell whether a moved number is my
  fix working or their lock being wrong.
- **`.claude/settings.json` on this branch denies `Edit(backend/src/lib/**)`** — exactly the
  two files my next commit needs. This is ORCHESTRATION.md MISSION 1 item 3; I did not try
  to route around it.
- **Owner decision owed on pricing** (item 11.4).
- **Owner dashboard work owed**: Supabase project + Google OAuth client + Railway deploy
  (`BUILD_PLAN.md` Runbook Parts A–C). Nothing downstream — not the test, not billing, not
  one user — happens before it. Open since 2026-08-06.

**13. Files referenced that turned out not to exist:**
- **The fridge/pantry-constrained solver does not exist.** `grep -i "pantry|fridge|onHand"`
  over `backend/src` matches only `foodCategories.js`, where "pantry" is a grocery-store
  aisle label. It has been described as a product differentiator; it is not implemented.
- **The linear-programming portion solver is not in this repo.** The real
  `scipy.optimize.linprog` implementation is a standalone 4-file prototype in a local
  off-repo `portion-solver/` directory (absolute path redacted — public repo). The
  shipping solver (`mealSolver.js`) is
  candidate generation + weighted scoring + bounded portion scaling. No LP.
- **`docs/DISCLAIMER.md` exists but is not in the installer allowlist, so it has never
  shipped anywhere.** Admitted in `CLAUDE.md`'s own archive section.
- `frontend/public/terms.html` and `privacy.html` exist but contain literal
  `[SUPPORT EMAIL]`, `[DATE]`, `[REGION]` placeholders.

---

## THINGS I NOW THINK WERE WRONG, OR WOULD DO DIFFERENTLY

- **I should have created an isolated worktree before starting**, not worked in the main
  checkout. The repo already had three worktrees and a documented pattern for it. Working
  in the shared directory is why my next commit is now blocked behind someone else's branch.
- **The `TrendTab.jsx` comment edit did not need to be in that commit.** It is correct and
  I stand by the content, but bundling a frontend file into a backend correctness commit
  widened the collision surface with `ux/simplify-2026-08` for no functional gain.
- **`TEARDOWN-2026-08-06.md` should have been committed the moment it was written.** It has
  sat untracked for two days for no reason. Same mistake `V2-DELTA.md` is being rescued from.
- **Unverified:** I have not re-run the suite since `d47316b`, and five commits have landed
  on this branch since. I am reporting the numbers from when I ran them, not from now.

---

## CORROBORATION FOR ORCHESTRATION.md's OWN CLAIMS

Independently verified from this window, 2026-08-08:

| Claim | Verdict |
|---|---|
| No launcher exists (`.bat`/`.cmd`/`.ps1`) | **Confirmed** — zero outside `node_modules`/`.git` |
| `ux/simplify-2026-08` 83 ahead | **Confirmed** exactly |
| `backup/pre-scrub-2026-08-04` 106 ahead | **Confirmed** exactly |
| `campaign-2026-07` 55 ahead | **Confirmed** exactly |
| `fix/audit-remediation` 54 ahead | **Confirmed** exactly |
| `V2-DELTA.md` untracked | **Confirmed** |
| `BATTLE-PLAN.md` says "delete 12 branches / 10 worktrees, zero unmerged work" | **Confirmed present and now false.** `git worktree list` shows 4, not 10, and ~300 commits are unmerged. MISSION 1 item 4 is correct to neutralise it |
| `CLAUDE.md` "dark is the shipped default" vs Phase 4 shipping light at `5ae57f4` | **Confirmed** — `5ae57f4` is titled "ship warm paper as the default" |

---

`docs/handoff/window-9-saas-launch-20260808.md`

HANDOFF WRITTEN — saas-launch (checkout: recipe-brain) — SAFE TO CLOSE
