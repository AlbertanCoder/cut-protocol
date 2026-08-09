# PLAN — the one terminal

You are the only session working on this repo. There are no others. Do not spawn
agent fleets, do not write new prompt documents, do not build process.

## The mission, in one line

Get 20 strangers using a deployed Cut Protocol for 14 days, and find out whether 6 of
them come back on day 14.

That line is from `BATTLE-PLAN.md` v2 — which is **uncommitted, inside `stash@{0}`**.
Read it with `git show 'stash@{0}:BATTLE-PLAN.md'`. The committed `BATTLE-PLAN.md` is
the older 2026-07-24 version. Do not drop that stash.

## How you work

**One task. Finish it. Show me. Wait for a yes. Then the next one.**

Never start the next task without a yes. If a task turns out to be three tasks, say so
and do the first one.

Four more rules, each of which was learned expensively:

1. **Verify against the repo, never against a document.** Every planning file here has
   been wrong about something. Yesterday: the URGENT installer leak was false, "zero
   unmerged work exists" was false by 200 commits, and "ux/simplify rewrites every
   screen" was false — its own commits are allergen fixes and one frontend file. Sessions
   read documents instead of the repo and the errors compounded for three weeks.
2. **Numbers come from commands you ran**, pasted verbatim. Never from arithmetic.
3. **A guard block is a stop sign.** Report it, don't reword around it, don't try another
   door. If it blocks something legitimate, say so and stop.
4. **Never delete anything.** Move it, or list it in `MIGRATION/DELETE-CANDIDATES.md`.

## The steps

### 1. Open the app
Nobody has looked at it since the light theme shipped. `npm start` from the repo root.
Click every screen. Write down what's broken. Fix it. This is first because it is cheap
and because everything after it assumes the app works.

### 2. Fix the calorie bug
The 7-day weight average uses the last seven **rows**, not seven **days** — 401 kcal/day
wrong on the fixture. One of three sites is fixed (`d47316b`). Two remain:
`backend/src/lib/adaptiveTarget.js:144` and `backend/src/lib/weightNow.js:10`.

Read the trap about golden fixtures below before you touch either.

### 3. One trunk
`recipe-brain` already contains `ui-restyle`, `fleet/measure`, `saas-launch` and
`light-migration` — four of the ten "workstreams" are one line of descent, not rivals.
Merge it to `master`, tag the other branches so nothing is lost, stop maintaining them.
`docs/orchestration/SEQUENCE.md` has the measured overlap; the two side branches share
100% of their code files with the trunk, so no file-level merge is possible on them —
ask me before porting anything by hand.

### 4. Deploy
Supabase project, Google OAuth client, Railway. `BUILD_PLAN.md` Runbook Parts A–C is the
click-by-click. Several steps are mine to do in a browser — tell me exactly which, one at
a time, and wait.

### 5. The paid path
`V2-DELTA.md` P0 items 1–8, then the trial. Two of them need Prisma migrations, which are
deliberately off-limits to you — see the traps.

### 6. Twenty people
Recruit, run 14 days, measure the two numbers: how many open it on day 14, how many log
three or more weigh-ins.

## Traps — all measured, none guessed

- **Guards only bind from the repo root with `CP_ROLE=builder`.** Five sessions ran
  yesterday believing they were governed; none were. If you are ever unsure, a write that
  succeeds proves nothing.
- **`backend/prisma/` is off the manifest on purpose.** Migrations must be escalated to
  me, not self-granted. Steps 5 needs this — expect the block, report it, don't work
  around it.
- **`backend/tests/golden/` is sealed to every role.** `MIGRATION/golden/` is not.
- **Fixing step 2 will fail golden fixtures, and that is correct.** They were captured
  while the bug was live, so they currently lock the bug in. A failing golden normally
  means STOP — this one case is expected. Show me the diff and get a yes before re-basing.
- **`backend/prisma/dev.db` is my real database.** Back it up and verify the sha before
  any write. Changes there are invisible to `git status`.
- **Pushing needs `docs/surgery/CURRENT/PUSH_APPROVED`,** written by my hand, containing
  `go <run_id>` from the live manifest. Ask; don't create it.
- **`guard-bash.js` false-positives** on the golden filename as a substring of any
  command — it blocks reads and even commit messages that mention it. Patch ready to paste
  at `docs/orchestration/GUARD-NARROWING-PROPOSAL.md`. Ask me to apply it if it bites.
- **Raise the test tripwire floors in the same commit that adds tests.** They drifted to
  108/1450 while the suite was at 129/1653 — 21 files could have been deleted with CI
  green. It has already happened twice.
- **Current suite: 135 files, 1712 tests, 0 failures.** Any other number you read in a
  document is stale.

## What I owe you, and nothing moves without it

- **Pricing** — $24.99/mo + $125/yr is locked in `BUILD_PLAN.md`; the teardown recommends
  $14.99 + $119 + a 14-day trial. Do not create Lemon Squeezy products until I rule.
- **Supabase + Google + Railway signups** — browser work only I can do.
- **Is the AI brain layer parked?** I parked it 2026-08-03 and then a third brain landed.
  Ask me once, early, before you sequence around it.
- **Sign-off on the golden re-base** in step 2.

## Stop and ask, always

Anything that deletes, any change to a calculation, any migration, any spend, any push,
any widening of your own permissions. When in doubt it is a stop.

## First thing you say to me

Confirm which branch you are on, that `CP_ROLE` is set, and that `npm test` still reports
135 files / 1712 tests / 0 failures. Then start step 1. Nothing else.
