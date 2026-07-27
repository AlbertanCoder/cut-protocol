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
