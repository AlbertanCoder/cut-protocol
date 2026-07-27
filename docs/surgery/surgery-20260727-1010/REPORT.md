# REPORT — surgery-20260727-1010

**Mode:** surgeon · **Parent:** surgery-20260727-0217 (receipt v3 `verify-20260727-0254`)
**Head at issue:** `e86c15c` — matches receipt v3 exactly, no drift.
**Head after:** see `git log`; this run added harness commits only.

## The one-sentence version

The cage was built and then caught not binding, so the knife never moved: no
source file was touched, no money was spent, and the surgery is handed forward
to a session that can actually be caged.

## What happened, in order

### M0 — Orient (done, read-only)

Head confirmed at `e86c15c`, branch `fix/audit-remediation`, tree clean apart
from the previous verifier's untracked `verify/` artifacts (left alone — they
belong to the parent run, not this one). Nothing dirty needed preserving, so no
WIP commit was made.

All four incision sites were re-derived against live code and recorded by
**symbol** in `evidence/E5-m0-orient.txt`, because receipt v3 charged the last
surgeon with coordinate rot. Line numbers appear there only where re-derived at
the moment of writing, and are labelled as of-that-moment. Summary:

| Move | File | Symbol | State found |
|---|---|---|---|
| M1 | `weeklyPlanner.js` | `fillGapsWithBrain()` candidate block | predicate has no day-total or tolerance term — V-BLINDSPOT confirmed live |
| M2 | `mealRouter.js` | `routeMealSlot()` rung 3 "THE LIBRARY" | library scan answers before generation — V-SWALLOW confirmed, and under D0 this is now ratified behavior, not a defect |
| M3 | `weeklyPlanner.js` + `plans.js` | `tryAiFallback`, `BRAIN_CALL_CEILING` | governed machinery present and wired; M3 is about what reaches it |
| M4 | `brainRelayConfig.js` | `status()`, `probeRelay()` | `"relay-unreachable"` exists, is returned by `probeRelay()`, and is never returned by `status()` — the P1 overclaim, confirmed |

Baselines were captured before any change: goldens intact
(`evidence/E1`), ledger at 13 rows / \$0.3928 all-time with **zero**
generate-path rows (`evidence/E2`). That ledger figure reproduces receipt v3's
`== MONEY ==` block exactly, via a query written for this run rather than by
reading the previous session's numbers.

### M-HARNESS — built in full (H1–H6)

| Piece | Path | Notes |
|---|---|---|
| Manifest + CURRENT copy | `docs/surgery/surgery-20260727-1010/manifest.json` | copy, not symlink; re-copied on every edit |
| guard-edit (H2) | `.claude/hooks/guard-edit.js` | named incisions only; fail-closed on missing/unparseable manifest |
| guard-bash (H3) | `.claude/hooks/guard-bash.js` | push/reset/rebase/`--force`/`rm -rf`, the golden relock, `:3001`, `dev.db.template`, `PUSH_APPROVED`, key-leak shapes |
| Registration (H4) | `.claude/settings.json` | `PreToolUse` matchers + push/reset/rebase belt in `permissions.deny` |
| pre-push (H5) | `.git/hooks/pre-push` → `.claude/hooks/pre-push-check.js` | refuses unless `docs/surgery/CURRENT/PUSH_APPROVED` reads exactly `go <run_id>` |
| Scripts (H6) | `scripts/surgery/{witness,ledger-delta,goldens-verify,guard-selftest,lock-proof}.js` | authored before the cut, frozen at lock |

### H7 — the proofs, and the failure

There are two separable questions, and passing the first proves nothing about
the second:

**Q1 — do the guards decide correctly when invoked?** `PROVEN-BLOCKS`, 26/26
(`evidence/E0`). Every forbidden act was attempted against the real hook
scripts and refused with the mandated message.

That run also exposed a genuine fail-open, which was fixed and re-proved
before anything else: `backend/tests/` is on the allow list so new test files
can be authored, and that subtree **swallowed `backend/tests/golden/`** — a
plain `Write` could have relocked the goldens while guard-bash was busy
watching the shell. Relocking has to be impossible through every door, not just
the expected one. `backend/tests/golden/` is now sealed to every mode, above
every allow list.

**Q2 — does Claude Code actually invoke them on real tool calls?**
`FAILED-OPEN` (`evidence/E4`).

- An off-manifest `Write` to `backend/src/lib/__guardprobe__.js` **succeeded**.
  The file was confirmed on disk and deleted immediately.
- A `Bash` call carrying a `sk-ant-` shaped literal **executed**.

Root cause, derived rather than assumed: this session's project root is
`C:\Users\<account>` — the operator's home directory — not the repository. Its
loaded `CLAUDE.md` is the home-directory quant-pipeline file, and
`C:\Users\<account>\.claude\settings.json` contains no `hooks` key at all. The
hooks this run authored live in the **repo's** settings file, which was never on
this session's settings chain. A second reason points the same way: Claude Code
snapshots hook configuration at session start, so even a correctly-rooted
session would not pick up hooks written mid-session.

Still binding, and proved: **`.git/hooks/pre-push`** (`evidence/E3`). Git
enforces it regardless of Claude Code — invoked directly, it refused with exit 1
and named the missing approval file.

### H8 — locked anyway

The harness was committed, `locked:true` set, `.claude/` and `scripts/surgery/`
dropped from the allow list, CURRENT re-copied, and the lock proved 13/13
(`evidence/E6`): hook edit, manifest edit, CURRENT copy, settings, harness
scripts and the golden baseline all refused; all four incision sites, new test
files and the run's own docs still open. The lock is a seal, not a shutdown.

Locking despite the binding failure is deliberate. A session restarted in the
repo root loads these hooks **at startup**, which is exactly when they bind —
and it arrives already caged.

### M1–M6 — NOT ATTEMPTED

H7 is explicit: *"any FAILED-OPEN → fix, re-prove. No proof, no surgery."*

The fix is not available from inside this session — it requires a Claude Code
session started in the repository root, after the hooks exist on disk, which
they now do. This session cannot restart itself. Cutting anyway would mean
performing the incisions with the cage provably open, which is the single thing
the harness exists to prevent, and M5 would additionally have spent real money
under guards that had just been shown not to fire.

So: **no source file was modified. No model call was made. \$0.00 spent.**
The ledger is unchanged at 13 rows / \$0.3928, still zero generate-path rows.

## What the resuming session must do

```
cd "C:\Users\<account>\Desktop\cut-protocol"
claude
```

Then, before anything else:

1. `node scripts/surgery/guard-selftest.js` → expect 26/26 (Q1).
2. `node scripts/surgery/lock-proof.js` → expect 13/13.
3. Re-attempt both E4 probes **as real tool calls** (Q2). Only when both refuse
   does the grammar become `PROVEN-BLOCKS` and the surgery open.
4. Then M1 → M6 as written. `witness.js` supports `--dry-run`, which exercises
   boot, auth, profile and cap arming for \$0 — run that before spending.

## Deferred debts, by name

Carried forward from the parent run, untouched here:

- **BRAIN=off false-warning emission.** `resolveSlot` samples ~5 candidates on
  one portion axis while the router scans the pool on two, so slots are warned
  "none fit within tolerance" that the router can demonstrably fit. M2 was to
  neutralize this *inside the pass*; the BRAIN=off emission itself stays as
  explicitly deferred debt.
- **Deterministic-core adoption of free repair, and its relock ceremony.**
  Moving repair into the BRAIN=off core changes golden output by design, so it
  needs an owner-witnessed relock — mechanically impossible for any session
  under this harness, which is correct.
- **VPS relay deploy.** The relay remains a local background process that dies
  with its terminal.
- **`chat.js` governance unification.**
- **The 28 unreviewed pre-existing unpushed commits**, plus a secret scan,
  before anything is pushed public.

New debts opened by this run:

- **The surgery itself** — M1 through M6, all unstarted.
- **`witness.js` is UNRUN.** Authored before the incisions so the instrument
  could not be tuned to its own result, but never executed. Its boot, auth and
  profile paths are therefore unproven; the first session to run it must treat
  that first execution as itself under test.
- **`.git/hooks/pre-push` is machine-local.** `.git/` is not version-controlled,
  so the hook does not survive a clone. A copy ships at
  `scripts/surgery/pre-push.sh` and must be installed by hand.
- **Two manifest gaps in the prompt's own allow list.** `docs/surgery/CURRENT/`
  (required by H1) and `.git/hooks/` (required by H5) were not on it. Resolved
  by writing CURRENT through a file copy before the lock — after which H2 seals
  it — and by noting that `.git/` lies outside version control entirely. Both
  are recorded rather than quietly widened.

## Residual risk register (TRUST-BASED rows, marked not hidden)

D0 immutability, secrets non-exfiltration beyond the pattern list,
symbol-citation discipline, fail-closed direction, timeboxes and smallest-diff
were all held by judgment this run, not by machinery. And this run is the
demonstration of why that distinction matters: the rows that were supposed to be
GUARD-enforced were, in this session, no stronger than the TRUST-BASED ones —
they were held because the occupant chose to hold them, having just proved
nothing would stop it otherwise.

---

## RESUME SESSION — R3 GATE CLOSED (2026-07-27, rooted in the repository)

The mis-rooting is fixed and the harness is proven. The surgery still did not
happen, for a different and better reason: the instrument that was supposed to
measure it is broken, and the run stopped at the gate designed to catch exactly
that.

### R0–R2: the cage bites

`git rev-parse --show-toplevel` resolved to the repository, so the hooks
registered in `.claude/settings.json` were on this session's settings chain for
the first time. Eight forbidden acts were then issued as REAL tool calls — the
distinction that mattered, since prior evidence (E0) could only ever prove hook
LOGIC, never BINDING. All eight were refused with the hooks' own text; zero
FAILED-OPEN; nothing reached disk (C16, C18, `evidence/E7-binding-proof.txt`).

C4 and C5 are now bracketed: true as records of the mis-rooted session, false as
descriptions of the guards. The scripts never changed between the two sessions.
Only the project root did — which is precisely what C6 said (C17).

A ninth, undesigned refusal is recorded honestly in E7: the read-only `ls`
written to VERIFY that nothing had been created was itself blocked, because the
command string contained the approval file's name. The rule is shape-based by
design (the same property that makes the harmless 3001 probe fail), so this is
the design working as specified, not a defect. Cost: one round trip.

Both self-test suites reproduce clean at head `2ffc7a7` — 26/26 and 13/13 (C19).

### R3: the instrument failed, and it fails everywhere

witness.js was authored before the incisions specifically so it could not be
tuned to its own result, and had never been executed (C14). Testing it before
trusting it is the entire point of R3, and R3 earned its place: the witness is
defective in three independent ways.

**What worked, and deserves credit** (C24): the four dev-DB refusal branches;
the pre-flight backup, written and its path printed before anything else ran;
the month-to-date cap correction, which read `$0.3928` already spent and armed
`monthly<=$0.8928` rather than starving the run at `$0.50`; boot on
`127.0.0.1:3999` with 3001 never touched; and a ledger pre-snapshot naming
`cmrzu1bcd0051wlo08nakbblp` — the same newest row C9 reports, re-derived through
a different code path. Everything before authentication is sound.

**Defect 1 — the transport is wrong (C20).** witness.js authenticates with an
`authorization: Bearer <token>` header. The app has no bearer path at all:
`requireAuth` and `optionalAuth` in `backend/src/lib/auth.js` read the session
exclusively from the httpOnly cookie `cutprotocol_session`. Every authenticated
call the witness makes — the profile PUT, the generate POST — would 401 even if
it held a valid token.

**Defect 2 — there is no token to hold (C21).** `POST /api/auth/register`
responds `{ id, email, role }` and issues its session through
`setSessionCookie`. No `token`, no `accessToken`. witness.js's `if (!token)
throw` therefore fires even on a virgin zero-user install where the
registration gate would have opened.

Defects 1 and 2 together mean the witness cannot work against ANY database. Not
"fails on a populated dev.db" — fails, period. Its authenticated path was
authored against an auth model this app does not have.

**Defect 3 — the gate, which is what actually fired (C22).** `POST
/api/auth/register` returned 403. The route permits registration only on a
zero-user install or from a caller holding a live session; the witness
hard-asserts its target is the owner's populated `backend/prisma/dev.db` and
sends no session. The gate is correct, documented, and predates the witness.

**Defect 4 — the failure signal is corrupted (C23).** The error path exits
**127** with a libuv assertion, not the documented 1, because `main().catch()`
disconnects Prisma while the `process.on('exit', shutdown)` handler kills the
spawned server. A crash and a cap breach must never be confusable by exit code;
today they are distinguishable only by reading the text.

### Why no manifest change was proposed

R3 asks for "the exact one-line manifest change for the OWNER". There is no
honest one, and inventing one would be worse than saying so.

The defect is in `scripts/surgery/witness.js`, which is sealed. In
`.claude/hooks/guard-edit.js` the `locked` block testing
`lower.startsWith('scripts/surgery/')` runs and calls `die()` BEFORE
`manifest.allow` is ever read — so adding `"scripts/surgery/witness.js"` to the
allow list is **inert**, which is the obvious wrong fix and is worth naming as
such. The only manifest edit that opens that door is `"locked": false`, which
unseals `.claude/`, both manifests, and every harness script at once: dismantling
the cage to repair one file, and handing this session the power to rewrite its
own guards (C26).

The correct remedy needs no manifest change at all. **The hooks bind this
session's tool calls; they do not bind the owner's editor.** The repair is an
owner-hand edit to witness.js, with the seal left intact and `locked:true`
preserved. The three edit sites are named in `evidence/E8-witness-dryrun.txt`.

### Second, independent blocker

Even with a working witness, R4 could not have proceeded: the body of PROMPT S2
— which R4 states is "pasted below this file", and from which M1–M6 are to be
executed "exactly as written" — was not present in the session input. M1–M6 were
therefore not attempted, and no file under `backend/src/` was modified (C27).

### Debt status changed by this session

- **`witness.js` is UNRUN** — CLOSED as written, REOPENED worse. It has now run,
  and it does not work. Was: "its boot, auth and profile paths are unproven."
  Now: boot proven, auth proven broken.
- **The binding failure (C4/C5/C6)** — CLOSED. Proven bitten, nine refusals.
- **The surgery, M1–M6** — still unstarted, now blocked on two doors rather than
  one.
