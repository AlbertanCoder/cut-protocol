# PROMPT B (amended 2026-08-08) — the orchestrator

You were pointed here by a one-line paste. Read this whole file, then do it.
It replaces the PROMPT B block in ORCHESTRATION.md, which is now partly stale.

---

## STATE OF PLAY — read before anything, this is what changed today

**MISSION 0 is COMPLETE. Do not re-run it.** The manifest was drafted, tested against
the real guard in a throwaway worktree, and installed by the owner's hand.

- Live manifest: `orchestration-2026-08-08`, `mode: surgeon`, `locked: true`, 19 allow
  entries. Installed at `f8d5995`, widened for `docs/qc/` at `a8011f1`.
- `guard-selftest` is **74/74** on `recipe-brain`. Its fixtures had to be re-pointed
  first — MISSION 0's "confirm it still passes 74/74" gate was unsatisfiable as written,
  because the suite hardcoded `CLAUDE.md`, `package.json` and `backend/src/lib/` as
  OFF-manifest negative controls and MISSION 0 requires granting exactly those. See
  `docs/orchestration/manifest-proposed-2026-08-08.json` → `_selftest_status`.
- `master` and `claude/apps-editing` are **72/74**. The two failures are the architect
  immutability cases, which need real `docs/surgery/CAMPAIGN/` artifacts on disk; that
  directory is 1,388 files and 1.4 GB and was deliberately not copied to those branches.
- `ux/simplify-2026-08` runs its own window, `ux-simplify-2026-08`, 74/74. Leave it alone.

**MISSION 1 is COMPLETE, all four items.** Do not redo them; verify if you like.

1. `V2-DELTA.md` committed — and the version you will read is a MERGE. The file that was
   untracked turned out to be a 2026-08-08 reconstruction; the 2026-08-06 original was
   recovered from `stash@{0}` and the two were merged at `092eabb`.
2. `CLAUDE.md` reconciled at `e547224` — scope line and theme default, both flagged in
   place, neither reworded.
3. `.claude/settings.json` resolved at `ae7df6d` — the `backend/src/lib/**` denies are
   gone, by the owner's hand. Analysis in `docs/orchestration/DECISION-settings-scope-2026-08-08.md`.
4. `BATTLE-PLAN.md` neutralised at `e547224` — dated correction in place, nothing deleted.

**Your first task is therefore MISSION 2.**

---

## Corrections to ORCHESTRATION.md itself

- **`docs/handoff/` is NOT a census.** It holds two files and NEITHER came from the
  consolidation paste. One is from a session that was rooted outside the repo; one is
  from a window that was ungoverned and does not say so. Every other terminal produced
  nothing — they were closed, or never received the paste. Treat the directory as two
  data points, not as "every terminal's handoff". Do not infer that unlisted workstreams
  are inactive.
- **`recipe-brain` is an 11th workstream** and is not in the survey — it was created
  after it. It is the branch you are most likely checked out on.
- **The URGENT `release/` claim in MISSION 2 does not hold.** `npm run dist:check`
  returns "safe to share — no secrets or personal data in release", exit 0, and
  `checkDistSafe.mjs` is not blind here (indexes `app.asar`, falls back to a raw chunked
  byte scan, opens shipped SQLite, treats an unreadable one as unsafe). It can only vouch
  for the build on disk, not for an installer already distributed. Do not put it at the
  head of the queue.
- **The commit counts are base-dependent.** 83/106/55/54 are measured against
  `saas-launch`/`light-migration`. Against `master` they are 106/120/69/68, and there are
  **28 local branches, 4 worktrees, and 14 branches with unmerged work** ranging 1 to 195
  commits. Never sum them; they overlap heavily.
- **A launcher partially exists.** `docs/surgery/CAMPAIGN/solver-brain/STATUS.md:735-741`
  names `solver-brain-fleet.bat` and documents its completion-footer contract. Rebuild
  from that rather than from zero.

---

## Two hard constraints for the MISSION 2 verdict table

Both were discovered by a window that has since closed. Neither is in ORCHESTRATION.md.

1. **`ux/simplify-2026-08` and `campaign-2026-07` do not contain `d47316b`.** Verified by
   `git merge-base --is-ancestor`. `d47316b` fixed `/weighins/summary` to average seven
   DAYS rather than seven rows — a live 401 kcal/day error. `ux/simplify` rewrites every
   frontend screen including `TrendTab.jsx`, one of the three files in that commit. If
   either branch lands by replacing files, the fix is silently reverted. This is a
   constraint on the abandon/port calls, not a preference.
2. **`b90b5b7`'s 11 golden fixtures lock the bug, not just the behaviour.** They were
   captured with `adaptiveTarget.js:144` and `weightNow.js:10` still row-based. Fixing
   those two sites WILL fail those fixtures. THE STANDING LAW says a failing golden
   fixture halts everything because the math moved — here the math moving is the point,
   and the re-base is legitimate, but it needs the owner's sign-off in the same sitting.
   Without this warning the rule correctly halts a correct change.

---

## THE STANDING LAW

- Constraint set: `MIGRATION/CONTRACT.md`'s six constraints apply to you and to every
  agent you spawn. Never change a calorie/macro/TDEE/BMR/target/portion calculation.
  Never delete a file — append it to `MIGRATION/DELETE-CANDIDATES.md` instead. Never
  reshape a persisted key. Note the 2026-08-08 scope correction at the top of `CLAUDE.md`:
  those rules bind on every branch that descends from `light-migration`, which includes
  `recipe-brain`.
- A guard block is a stop sign, not a puzzle. Record it, report it, never route around it.
- Your subagents are you: same role, same laws, same door.
- Numbers come from commands, pasted verbatim. Never from your own arithmetic.
- Write every artifact to disk BEFORE reporting it. If you die at 4am, disk is the deliverable.
- Ports 3900–3999 only. Port 3001 is the owner's live app and is never touched.
- Never sum two agents' deltas. Overlapping gains are not additive.
- **Nothing has been pushed.** Every commit from 2026-08-08 is local, across four branches.
  Pushing is the owner's hand only.

---

## MISSION 2 — sequence, don't parallelise

Produce `docs/orchestration/SEQUENCE.md` containing:

  · A table: workstream → files owned → who else claims them → verdict
    (LAND NOW / REBASE FIRST / PORT FORWARD / ABANDON, with one line of reasoning).
    Include `recipe-brain`. Carry the two hard constraints above into the verdicts.
  · The SERIAL SPINE: the ordered list of things that must happen one at a time because
    they share files. Justify each ordering.
  · The PARALLEL SLICES: work provably touching no file another slice touches.
  · For each abandon-or-port call, name what is lost. `ux/simplify-2026-08` is 106 commits
    ahead of master of real audit remediation across every screen; a 700-line rewrite of a
    file another stream added 9 lines to cannot be merged, only re-implemented. Say which
    and why, and let the owner decide.

Then STOP and get the owner's sign-off on SEQUENCE.md. Do not execute it.

Candidate independent slices — verify each yourself and re-derive the file lists:
  · packaging allowlist inversion — root `package.json`, `scripts/*.mjs`
    (NOT urgent — see the correction above)
  · V2-DELTA BLOCK 4 — webhook hardening, backend only, no frontend file
  · V2-DELTA BLOCK 5 — legal/copy, `frontend/public/*.html` only
  · light-migration Phases 5 and 6 — create new directories, touch no existing screen
  · fleet W5-2 — writes only `fleet/*`
  · cp-prefix-baseline worktree — read-only measurement pin, writes only `fleet/out/`

## MISSION 3 — only now, fan out

For each PARALLEL SLICE the owner approved, spawn one agent. Per agent:
  · an ID, a falsifiable question, a method, and a definition of done
  · its own git worktree, absolute path, if it writes source
  · one output directory, written incrementally: `docs/orchestration/out/<id>/FINDINGS.md`
  · a concurrency cap of 5, and a tool-call ceiling
  · a closing verdict: CONFIRMED / FALSIFIED / NOT REACHED — why

Maintain `docs/orchestration/state.json` as the authoritative ledger: per-agent status,
artifacts, headline. Mirror it to a human-readable progress file, and never let the
mirror go stale — a stale mirror of an authoritative ledger is worse than no mirror.

Before synthesising anything, run an adversarial pass: a separate agent that tries to
FALSIFY each finding, and a completeness agent that asks what was not looked at. The
synthesiser may not introduce a number that does not already appear in an agent's
FINDINGS.md.

## WHAT TO ESCALATE, NEVER DECIDE

  · abandoning unmerged work
  · any change to a calculation
  · any persistence version bump or migration — `backend/prisma/` is off the manifest
    precisely so this must be escalated
  · widening a permission or editing the manifest — the manifest is `locked: true` and
    `docs/surgery/CURRENT/` is not on the allow list, so you cannot self-grant. Print the
    JSON and ask, per the `_widenings` format already in the manifest
  · a golden fixture that fails — stop everything, that means the math moved. EXCEPT the
    `adaptiveTarget.js` / `weightNow.js` case named above, which is expected and needs
    owner sign-off rather than a halt

## Owner decisions already outstanding — do not relitigate, just surface them

  · **Pricing** — `BUILD_PLAN.md` locks $24.99/mo + $125/yr; the teardown recommends
    $14.99 + $119 + 14-day trial. Nobody may create Lemon Squeezy variants until ruled.
  · **Supabase project + Google OAuth client + Railway deploy** — owed since 2026-08-06.
    Nothing downstream moves without it.
  · **`recipe-brain` vs the 2026-08-03 decision to park the AI/brain layer.** Asked twice,
    never answered.
  · **The two remaining `slice(-7)` sites** — now editable, and gated on the fixture
    re-base above.

## First response

State back, in under 20 lines: every active workstream, the files each claims, and every
file claimed by more than one. Say explicitly which of those you learned from a handoff
and which you inferred from git — the handoff directory covers two windows out of at
least eleven. Do not plan until you have done that.
