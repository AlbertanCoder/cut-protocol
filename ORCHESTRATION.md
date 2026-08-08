# ORCHESTRATION — consolidating many terminals into one

Written 2026-08-08 from a three-agent survey of this repo. Two prompts below.

**Read this first, because it changes the order of operations you asked for.**

You asked for a fleet that tackles everything in parallel. You cannot start there.
The survey found **10 active workstreams sharing files** and roughly **300 unmerged
commits**. Five separate streams intend to modify `PlanTab.jsx`; four claim
`App.jsx`; `ux/simplify-2026-08` rewrites every frontend screen (+14,619 lines) and
collides with all nine others. Fanning agents into that state multiplies collisions
instead of resolving them.

So: **PROMPT A** extracts what every existing terminal knows, onto disk. **PROMPT B**
starts one orchestrator whose *first* mission is sequencing — deciding what wins and
in what order — and which only fans out onto the slices proven independent.

---

## What already exists — do not rebuild it

| Piece | Where | State |
|---|---|---|
| Role resolver (architect/builder) | `.claude/hooks/role.js` | Works. `CP_ROLE` env var, fail-closed to architect |
| Write allow-list, fail-closed | `.claude/hooks/guard-edit.js` + `docs/surgery/CURRENT/manifest.json` | Logic works; **manifest is 10 days stale and blocks every current path** |
| Shell denylist | `.claude/hooks/guard-bash.js` | Works, but 5 documented false positives + 1 false negative. Do not extend this pattern |
| Deletion guard | `.claude/hooks/guard-migration.js` | Added 2026-08-07, live |
| Owner-only push interlock | `.claude/hooks/pre-push-check.js` | Works. Refuses unless `docs/surgery/CURRENT/PUSH_APPROVED` reads exactly `go <run_id>` |
| Append-only record filter | `scripts/surgery/pre-commit.sh` → `.git/hooks/pre-commit` | Installed. Blocks M/D/R under `docs/surgery/CAMPAIGN/` |
| Guard regression harness | `scripts/surgery/guard-selftest.js` | **74/74 green as of 2026-08-08** |
| Courier + ledger conventions | `docs/surgery/CAMPAIGN/charter-{architect,builder}.md`, `CONVENTIONS-2.md` | Complete and worth reusing verbatim |
| Fleet decomposition patterns | `fleet/PROMPT.md`, `fleet/state.json`, `docs/surgery/CAMPAIGN/SOLVER-BRAIN-fleet-prompt.md` | Real, proven, documented failure modes |
| Turnkey subagent fan-out | `.claude/commands/fleet-review.md` | Live, runnable today |

**Missing:** the launcher. No `.bat`, `.cmd` or `.ps1` exists anywhere in the tree, and
no `claude -p` invocation is recorded in any file. Its quota-wait and log-numbering
fixes are unrecoverable. That is the one thing genuinely worth writing new.

## Failure modes this repo already paid for — design around them

- **Quota kills unattended runs.** A run died 3 minutes before reset and the launcher
  treated the wall as an ordinary failure: **7.5 hours of nothing.** Wait it out, never retry.
- **600s background-task ceiling** silently killed a whole agent with zero output.
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` to wait indefinitely.
- **Relative paths poison shared state.** Two agents used a relative cookie jar and one
  read the other's session — reported as a cross-account data leak that wasn't real.
  Every per-agent path absolute. Every DB copy absolute.
- **Write artifacts as you go, not at the end.** The single decision that saved two
  dead runs. If the session dies at 4am, what's on disk is the deliverable.
- **Never sum two agents' deltas.** Naive summing overstated a result by 2.56×.
- **Verifier monoculture.** Every independent verifier in one study was built from the
  same vocabulary as the thing it verified, and all of them missed the same bug.
- **Port 3001 is the owner's live app.** Agents use 3900–3999 only. Enforced in `guard-bash.js:61`.

---

# PROMPT A — paste into EVERY existing terminal

Same text into every window. It asks the session to describe itself, so nothing needs
customising — EXCEPT the window number on the first line, which must be different in
each one. That number is the only thing stopping two windows on the same branch from
writing the same file and silently overwriting each other's handoff.

You can paste into all your windows at once. They only read git and write one file each.

```
You are WINDOW 1.     <-- CHANGE THIS NUMBER IN EVERY TERMINAL. 1, 2, 3, ...

STOP whatever you are doing. Do not start new work. Do not commit anything.

You are one of several Claude Code sessions running against this repo, and we are
consolidating into a single orchestrated terminal. Your only job now is to write
down everything you know that is not already on disk, so the next session does not
have to rediscover it.

WRITE IT TO A FILE FIRST, then show it to me. The file is the original; the paste is
a copy. Path: docs/handoff/window-<N>-<branch-name>-20260808.md, using YOUR window
number from the first line above. Other sessions are writing their own files in that
directory at the same time — if the name you were going to use already exists, do not
overwrite it; add your short HEAD sha to the name and say so.
(run `ls docs/` first; create `docs/handoff/` if it does not exist.)

Answer all of these. "I don't know" is a valid and useful answer — guessing is not.

IDENTITY
1. `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse --short HEAD`.
2. `git status --porcelain` — verbatim. For every modified or untracked file, one line
   on what the change is and whether it is finished.
3. `git log --oneline origin/saas-launch..HEAD` if that ref exists, else the last 10 commits.

WHAT YOU WERE DOING
4. In two sentences: what was this session for?
5. What is DONE and verified? Name the command you ran and its result. If you did not
   run it, say so — "lint and build are green" is only true if you ran them.
6. What is half-finished? Be specific about which file and which function.
7. What is the very next action you would have taken?

WHAT YOU OWN
8. List every file you have modified or intend to modify. This is the collision list —
   another stream may be in the same file, so completeness matters more than brevity.
9. Did you modify anything under `backend/src/lib/`, `backend/prisma/`,
   `frontend/src/index.css`, `App.jsx`, `Sidebar.jsx`, or `CLAUDE.md`? These are the
   contested files. Name the exact lines if so.

WHAT YOU KNOW THAT ISN'T WRITTEN DOWN
10. Any trap, gotcha, or dead end you hit and worked around. Especially: anything you
    discovered was already broken before you touched it.
11. Any instruction you were given in conversation that is not in a committed file.
    This is the highest-value item here — verbal-only rules die with your window.
12. Anything you were BLOCKED on, and by what: a guard hook, a permission prompt, a
    missing credential, a decision you needed from the owner.
13. Any file you referenced that turned out not to exist.

HONESTY REQUIREMENTS
- Do not describe intended work as completed work.
- Do not restate a plan document back to me; I have those. Tell me what you know that
  the documents do not.
- If you have been running a long time and are unsure whether something landed, say
  "unverified" rather than picking the flattering answer.
- If you made a change you now think was wrong, say so plainly. That is the single most
  useful sentence you can write.

Finish by printing the file path and `HANDOFF WRITTEN — <branch> — SAFE TO CLOSE`.
Then stop. Do not do anything else.
```

---

# PROMPT B — the new orchestrator terminal

## Launch it like this (PowerShell, from the repo root — this matters)

```powershell
cd C:\Users\SHADHUNTER\Desktop\cut-protocol
$env:CP_ROLE = "builder"                                # must be set BEFORE claude starts
$env:CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "0"         # or 600s silently kills agents
claude
```

Three things about that, all load-bearing:

- **From the repo root, or the hooks silently do nothing.** `.claude/settings.json` runs
  `node .claude/hooks/guard-edit.js` — a relative path. From any other directory node
  exits 1, which is not a block, and every guard in this repo becomes decorative. This
  exact mistake already stopped one campaign cold, and it is why my own Phase 0 writes
  landed on paths the manifest forbids.
- **`CP_ROLE` cannot be set from inside the session.** Absent, you get `architect`, which
  cannot `git add` or `git commit`. An orchestrator that cannot commit is useless.
- **The manifest will block you** until the owner updates it — see mission 0 below.

## Then paste this

```
You are the single orchestrator for the Cut Protocol repo. Several parallel Claude Code
sessions have just been consolidated into you. Your job is to get this project pointed
in one direction.

READ FIRST, IN THIS ORDER, BEFORE PLANNING ANYTHING:
  1. ORCHESTRATION.md              — why you exist and what already exists
  2. docs/handoff/*.md             — every terminal's handoff (written today)
  3. CLAUDE.md                     — standing rules. NOTE: it currently contradicts
                                     itself; see mission 1
  4. DO-NOT-TOUCH.md               — header and scope only
  5. MIGRATION/CONTRACT.md         — the six hard constraints, which bind you
  6. BATTLE-PLAN.md, BUILD_PLAN.md, V2-DELTA.md, fleet/PROGRESS.md, MIGRATION/PROGRESS.md

Then state back to me, in under 20 lines: every active workstream, the files each
claims, and every file claimed by more than one. Do not plan until you have done that.

## THE STANDING LAW

- Constraint set: MIGRATION/CONTRACT.md's six constraints apply to you and to every
  agent you spawn. Never change a calorie/macro/TDEE/BMR/target/portion calculation.
  Never delete a file — append it to MIGRATION/DELETE-CANDIDATES.md instead. Never
  reshape a persisted key.
- A guard block is a stop sign, not a puzzle. Record it, report it, never route around it.
- Your subagents are you: same role, same laws, same door.
- Numbers come from commands, pasted verbatim. Never from your own arithmetic.
- Write every artifact to disk BEFORE reporting it. If you die at 4am, disk is the deliverable.
- Ports 3900–3999 only. Port 3001 is the owner's live app and is never touched.
- Never sum two agents' deltas. Overlapping gains are not additive.

## MISSION 0 — unblock yourself (report, do not self-grant)

`docs/surgery/CURRENT/manifest.json` is a stale run identity from 2026-07-28. Its allow
list does not include `MIGRATION/`, `scripts/`, `CLAUDE.md`, `frontend/src/`, or
`backend/src/` — i.e. every path the current work needs. `guard-edit.js` is fail-closed,
so from the repo root your writes will be refused.

Do NOT edit the manifest yourself. Print the exact JSON you need and ask the owner to
paste it. Then run `node scripts/surgery/guard-selftest.js` and confirm it still passes
(it was 74/74 on 2026-08-08). If it does not, stop.

## MISSION 1 — stop the bleeding. Serial. Do this before any planning.

Four things are actively losing work or actively wrong. Fix them in this order:

1. `V2-DELTA.md` is UNTRACKED and is the only record of 8 confirmed payment defects.
   Its own header says the original was already wiped once. Commit it. Nothing else in
   this mission matters if that file disappears.
2. `CLAUDE.md` contradicts itself. It carries a block saying "Active on branch
   light-migration only" while checked out on another branch, and standing rule 2 plus
   reconciliation #3 still say "dark is the shipped default" — which stopped being true
   at commit 5ae57f4 when Phase 4 shipped light. Reconcile it. Flag to the owner; do not
   silently rewrite a rules file.
3. `.claude/settings.json` on this branch denies `Edit(backend/src/lib/**)` and
   `Edit(backend/prisma/schema.prisma)`. That was correct for a UI migration and is now
   blocking the payment work from the main worktree. Report the conflict and ask which
   scope wins; do not just widen it.
4. `BATTLE-PLAN.md` contains "delete 12 branches and 10 worktrees — zero unmerged work
   exists." That was true on 2026-07-24 and is now false by roughly 300 commits across
   ux/simplify-2026-08 (83 ahead), backup/pre-scrub-2026-08-04 (106), campaign-2026-07
   (55) and fix/audit-remediation (54). Neutralise that instruction with a dated
   correction in place. Do not delete anything.

Report MISSION 1 COMPLETE with the commit sha before continuing.

## MISSION 2 — sequence, don't parallelise

Produce `docs/orchestration/SEQUENCE.md` containing:

  · A table: workstream → files owned → who else claims them → verdict
    (LAND NOW / REBASE FIRST / PORT FORWARD / ABANDON, with one line of reasoning).
  · The SERIAL SPINE: the ordered list of things that must happen one at a time because
    they share files. Justify each ordering.
  · The PARALLEL SLICES: work provably touching no file another slice touches.
  · For each abandon-or-port call, name what is lost. `ux/simplify-2026-08` is 83 commits
    of real audit remediation across every screen; a 700-line rewrite of the same file
    another stream added 9 lines to cannot be merged, only re-implemented. Say which and
    why, and let the owner decide.

Then STOP and get the owner's sign-off on SEQUENCE.md. Do not execute it.

The survey identified these as genuinely independent — verify each yourself before
trusting it, and re-derive the file lists rather than believing this list:
  · packaging allowlist inversion — root package.json build.files, scripts/*.mjs
    (URGENT: the built installer in release/ leaks a JWT secret, a USDA key, a cleartext
    seed password and 10 users' health data)
  · V2-DELTA BLOCK 4 — webhook hardening, backend only, no frontend file
  · V2-DELTA BLOCK 5 — legal/copy, frontend/public/*.html only
  · light-migration Phases 5 and 6 — create new directories, touch no existing screen
  · fleet W5-2 — writes only fleet/*
  · cp-prefix-baseline worktree — read-only measurement pin, writes only fleet/out/

## MISSION 3 — only now, fan out

For each PARALLEL SLICE the owner approved, spawn one agent. Per agent:
  · an ID, a falsifiable question, a method, and a definition of done
  · its own git worktree, absolute path, if it writes source
  · one output directory, written incrementally: docs/orchestration/out/<id>/FINDINGS.md
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
  · any persistence version bump or migration
  · widening a permission or editing the manifest
  · a golden fixture that fails — stop everything, that means the math moved
```

---

## Order of operations

1. Paste **PROMPT A** into every open terminal — all of them, at the same time is fine.
   Change the window number on the first line in each. Close each window once it prints
   `SAFE TO CLOSE`.

   Closing a window does **not** lose uncommitted code. Working-tree changes live on disk
   in the worktree, not in the terminal — the `apps-editing` worktree's uncommitted nav
   work will still be there afterwards. What dies with the window is only the
   conversation, which is exactly what the handoff is capturing.
2. Commit the handoffs (`docs/handoff/`) — that is now your only record of what those
   windows knew.
3. Open one terminal with the PowerShell block above. Paste **PROMPT B**.
4. Expect to be asked for a manifest paste in mission 0. That is correct behaviour, not a bug.
5. Do not approve MISSION 3 until you have read SEQUENCE.md yourself. The abandon calls
   in it are the only genuinely irreversible decisions in this whole exercise.
