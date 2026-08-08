# HANDOFF — Cut Protocol

**This file contains TASKS, METHOD and TRAPS. It contains no state.**

That is the whole design, and it is a correction. Every previous version of this
file carried a "state of the tree" section, and every one of them went stale
within hours and then misled the next session:

- it reported a carry-over mechanism as available by reusing an existing cap.
  That cap belongs to a weekly weigh-in-driven TDEE walk. Nothing banked a
  residual. A session believed it and planned around it.
- it said "8 tests failing" and listed two changes as uncommitted. Both were
  committed, and the suite was at 2. Its designated FIRST ACTION was a no-op.
- its headline failure census — the premise the whole ruler reframe rested on —
  described the *previous* ruler. Re-derived on the tree it shipped with, the
  order inverts.
- `HANDOFF.md` (2026-07-19) is the same file one generation earlier. It opens
  with its own STALE SNAPSHOT banner. Kept for decision history; do not read it
  as current.

**The rule, stated once: if a sentence would be falsified by a commit, it does
not belong in this file.** Anything below that starts to read like status is a
bug in the file, not information.

---

## State — fetch it, never read it here

```
git status                      what is dirty
git log --oneline -20           what has landed
cd backend && npm test          what passes            (expect 0 failures)
git rev-list --count origin/master..HEAD    how far ahead of the public remote
```

Fleet level, when you need it, is a run and not a recollection:

```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=<what> --agent=<DIR> --quiet
```

Always quote **satisfiable AND all-planned together**, stamped with seed count,
denominator, ruler, pool shape and tree. A rate with no ruler on it cannot be
compared to anything, and `judged` (n=537) is a banned denominator on its own —
it rewards refusing days.

---

## Tasks

Owner's standing instruction: **commit each item separately, do not push.**
Pushing is the owner's hand only.

### Needs the owner, not a session
- `git push` — and note the public branch is `fleet/ruler-fixes-2026-08`, a
  scrubbed lineage with different SHAs from local. Update it by re-running the
  same `filter-repo` scrub on a clone; it is deterministic and fast-forwards.
- Which food each of the 5 wrong-macro rows actually means (the data half).
- Anything under `docs/surgery/CAMPAIGN/` — append-only, hook-enforced.

### Open
1. **`.claude/worktrees/` histories still carry the account name** — 394 files
   across two full checkouts on other branches. The main repo's tracked history
   is clean; those are separate repos and were not touched.
2. **Fibre has no term in the solver, and cannot get one yet.** It is dropped at
   the recipe boundary (`Recipe`/`PlanSlot` cache only kcal/P/F/C). 65% of green
   days land under 30 g, worst observed 3.0 g. Blocked on `Food.fiber` being
   `Float @default(0)` — 5,565 rows read zero, including blueberries — so a gate
   built today fails open on exactly the foods it should reward. Make the column
   nullable first (via `migrate diff` + `migrate deploy`, never `migrate dev`).
   A reported line is safe now; a gate is not.
3. **No per-food daily gram cap.** `SCALE_BOUNDS` bounds a recipe multiplier, not
   a food's total across a day. A real green day ships 1,025 g of chicken breast.
4. **Batch cooking as a first-class mode.** Mostly deletion: the 2×/week variety
   cap becomes a setting, the 0.35× repeat penalty goes.
5. **The 5 wrong-macro rows, code half.** Teach `macroTrustIssue` the missing
   prefixes so rows whose own `dataQuality` says *"NEEDS A HUMAN DECISION"* stop
   being served as verified fact.
6. **`Profile` has no `goal` column**, so the ruler cannot be goal-parameterised
   and the four-goals product decision is unimplementable as stated. Needs a
   migration.
7. **`docs/DISCLAIMER.md` is not in the installer allowlist, so it never ships.**
   The app prescribes ~2 g/kg protein and floor-clamped calorie targets.
8. **API keys named in the 2026-07-29 systems audit still want rotating.**
9. **Body fat still drives lean mass** — and therefore the fat band and
   `proteinHi` — from a 21%/28% assumption when unmeasured. Only the *graded*
   protein floor was moved off it. The rest is unaddressed and unmeasured.

### Do not re-attempt without reading the note at the call site
- **Re-aiming the search at the graded range.** Measured −3.2 pp. The full
  argument, the numbers, and why it is wrong are in `weeklyPlanner.js` above
  `compositionWeight`, with the losing arm at `fleet/out/REAIM/`.
- **The trim arm.** Obsolete by design, not deferred.

---

## Method — non-negotiable, it has caught real errors

- **Reproduce before fixing.** Reports on this tree have been wrong repeatedly.
  Do not trust one, including this file's task list.
- **Every test must be verified to FAIL against the pre-fix source.** Extract the
  old file into `backend/src/lib/`, point a copied test at it, run, delete both.
  A test written after a fix and never run against the bug proves nothing.
- **An appealing argument built on a correct number is still often wrong.** Two
  changes in one session were implemented on strong-looking evidence, measured,
  and reverted: re-aiming the search (−3.2 pp) and lowering `proteinLo` (−0.18
  g/kg delivered protein). In both cases the motivating statistic was accurate
  and the inference from it was not. Budget for measuring your own good ideas.
- **A satisfied constraint is not an unnecessary one.** "67% of failing days had
  fat inside the guardrail, so the fat pull buys nothing" — they had fat inside
  the guardrail *because* the pull put it there.
- **Loosening a threshold mechanically raises a pass rate.** That is arithmetic,
  never evidence. Justify the threshold; report the delta as the size of the
  affected population, not as an improvement.
- **Count distinct things.** `git grep <commits>` returns file×commit pairs; an
  unchanged blob appears in every later tree. A "172 files still leaking" scare
  was 2 distinct paths.
- **Both directions on any exclusion change.** An over-block is a bug; a leak is
  worse.
- **Arm-check every claim** — what was examined and what was not. A pass over a
  near-empty scope is inconclusive, never clean.
- **One change per commit**, message explaining *why* and what the test catches.

---

## Traps — verified, will bite

- **`prisma migrate dev` WILL DEMAND A FULL DATABASE RESET.** Three migrations
  carry checksum drift. Use `migrate diff` + `migrate deploy`, and back up first.
- **`dev.db` is the owner's real data.** Copy it; never open the shared file.
  `backend/scripts/qc/dayDump.mjs` shows the isolation pattern.
- **A recursive delete follows Windows junctions.** `git worktree remove` emptied
  all three `node_modules` on 2026-08-01, and an `mklink /J` + `rm -rf` on
  2026-08-04 came within one command of repeating it. Verify no junction remains
  *before* deleting any tree you linked into.
- **A `.pyc` embeds the absolute source path it was compiled from**, so it leaks
  the account name and survives text scrubbing because it is binary.
  `__pycache__/` is now ignored; check for others.
- **`git filter-repo` prompts** when it has run on the repo before
  (`.git/filter-repo/already_ran`) and dies on EOF. Pipe `echo y |`.
- **`dietaryFilter.js` contains 3 NUL bytes**, so grep reports "Binary file …
  matches" with no lines. Use `grep -a` / `rg --text` / Read. It is also
  permanently exempt from the secret scan, and a test asserts that exemption.
- **The repo is CRLF.** An LF-only patch silently fails to match.
- **A parallel session can revert your working-tree edits.** Commit through a
  temp index without moving HEAD if one may be running.
- **The pinned DB hash never described the state.** SQLite runs WAL, so committed
  pages live in `dev.db-wal`, which the sha256 does not cover.
- **`docs/surgery/CAMPAIGN/` is append-only**, enforced by a pre-commit hook —
  which is deletable from any shell. Do not describe it as stronger than that.
- **`.claude/worktrees/` holds full checkouts on other branches.** Every
  path-based search returns three copies of every file at three commits.

---

## Binding product decisions

Decisions, not status — they survive commits. Pruned to what is still undone or
still constrains the work.

- **Portion realism is a hard requirement.** Half portions read as broken.
- **Never a blank day** — ship the nearest plan, labelled honestly. Currently
  violated: 17–18 days per fleet seed ship with zero slots filled.
- **All four cooking modes** — cook-once-reheat, batch-components, assembly-only,
  full-cooking. *Gap: nothing in the schema knows whether a dish reheats well.*
- **Built for anyone**, not just the owner. Every decision is a default with an
  override, never a constant.
- **Voice: instrument, data-driven.** No commentary, no cheerleading, no
  streak-shaming. No red on food data; over target is calm amber and states the
  remedy.
- **Logging: one-tap "ate as planned" plus per-meal check-off.**
- **Recipe library: gate PASSED.** Do not spend time curating.
- **DEFERRED — the AI/brain layer.** Do not re-raise unprompted.
