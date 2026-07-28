# CLAIMS M0.1 — THE WALL

Builder · mission M0.1 · TIER B · window `campaign-p2-m0`
Opening HEAD `b82d577` → closing HEAD `08a5b6b` · branch `fix/audit-remediation`

**This file is the ORIGINAL. Any pasted copy is a copy.** It exists because it
should have existed before the first courier run: the pasted CLAIMS blocks
arrived at the architect corrupted, with lines truncated mid-sentence, and
there was no original on disk to fall back on. The architect graded from the
repo instead, which worked only because the evidence files were filed properly.
Filed as remedy under VERDICT M0.1's single finding, which is accepted without
argument.

Nothing below is a verdict. Every line is a claim, and claims are decided by
the architect's own fresh runs.

---

## C1 — I1: `CP_ROLE` IS visible inside a PreToolUse hook child process

**OBSERVED.** The order is not void; M0 was clear to proceed.

Repro: temporary probe in **both** already-registered hooks, driven by real
`Write` / `Edit` / shell tool calls.

    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":32740,"ppid":27688,...}
    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":4936,"ppid":35952,...}
    {"hook":"guard-edit","present":true,"raw":"builder","typeof_raw":"string","pid":26792,"ppid":24948,...}
    {"hook":"guard-bash","present":true,"raw":"builder","typeof_raw":"string","pid":3940,"ppid":30124,...}

Artifact: `evidence/I1-cp-role-visible-in-hook.md`, raw log
`evidence/I1-hook-env-probe.jsonl`.

Two method points that carry the weight:

- The probe went into **already-registered** hooks. A newly registered hook
  would never have fired — registration is snapshotted at session start, which
  is on the record from run `surgery-20260727-1010`.
- The probe was driven by **real tool calls**, not by a harness spawning the
  hooks itself. A harness spawn would only have proved that the harness passes
  its own environment down, which is not the question.

## C2 — A session cannot promote itself

**OBSERVED.** Not ordered; answered anyway, because if a session could rewrite
its own `CP_ROLE` from inside a tool call the wall would be decorative.

    call 1:  $env:CP_ROLE = 'architect'   OBSERVED -> shell now claims: [architect]
    call 2:  same variable                OBSERVED -> next call, shell sees: [builder]
             hook child, same call        OBSERVED -> "raw":"builder"

Two independent mechanisms: shell state does not survive the tool call, and the
hook hangs off the Claude Code process rather than the shell, so even a
persistent shell mutation would not be in its parent chain.

**Honest limit.** This proves the mechanism works, not that it cannot be
defeated. Whoever launches the terminal chooses the role — the same trust model
the manifest already runs on. What is excluded is the accident and the
in-session shortcut.

## C3 — FALSIFICATION: the selftest baseline was 22/4, not 26/26

**OBSERVED, before a single line was written.**

    node scripts/surgery/guard-selftest.js   ->  22 passed, 4 failed, 26 total, exit 1

Four ALLOW cases hardcoded the dead `surgery-20260727-1010` window; the live
manifest is `campaign-p2-m0`, and the guard correctly blocked all four. **The
guard was right and the test was stale.**

This put A1 ("0 failed") and I7 ("existing cases must survive") in literal
conflict at issuance. Resolved by re-pointing those four cases to the live allow
list: each case's ASSERTION is unchanged — "a path the manifest grants is
allowed" — and only the path data moved, because the window moved under it.
Every BLOCK case survives verbatim.

The rot was also made loud rather than merely fixed: a WINDOW preflight case now
fails with an explicit "expectations are stale, re-point them" whenever the
manifest moves on, instead of leaving four reds that look like a broken guard.

Artifact: `evidence/E0-selftest-baseline.txt`.

## C4 — A1: selftest exits 0, 0 failed, 66 total

**OBSERVED.**

    node scripts/surgery/guard-selftest.js
    guard-selftest: 66 passed, 0 failed, 66 total
    exit 0

Artifact: `evidence/I7-selftest-after.txt` (redirected machine output, not
retyped).

## C5 — A6/A7: the INTERSECTION holds

**OBSERVED.** Same path, on the manifest allow list in both rows:

    PASS want=BLOCK got=BLOCK role="architect"  ROLE architect · WRITE on-manifest hook (INTERSECTION)
      -> BLOCKED: .claude/hooks/guard-edit.js is outside the architect door — that role
         may write only under docs/surgery/CAMPAIGN/. A role NARROWS the incision
         manifest and never widens it, so being on the allow list is not enough on its own.
    PASS want=ALLOW got=ALLOW role="builder"    ROLE builder · WRITE on-manifest hook (INTERSECTION)

`roleGate()` is invoked only after `if (!ok) die(...)` — after the manifest has
already answered yes — and contains no branch that returns allowed. Every path
either returns void or calls `die()`. It is structurally incapable of widening.

## C6 — A2/A3/A4: the architect door is create-only, ledger excepted

**OBSERVED.** CREATE new file under `CAMPAIGN/` → ALLOW · EDIT `ledger.md` →
ALLOW · EDIT existing `orders/order-M0.1.md` → BLOCK · EDIT existing
`charter-builder.md` → BLOCK.

Create-vs-edit is decided by existence on disk (`fs.existsSync`), not by which
tool was used, so a `Write` that would clobber an existing order is refused on
identical footing to an `Edit` of it.

## C7 — A9/A10: fail-closed

**OBSERVED.** `<unset>`, `""`, `"   "`, `"admin"`, `"surgeon"` each landed on
the architect door and were BLOCKED writing an on-manifest hook. Block messages
name both what was claimed and what it resolved to, so a demotion is never
silent.

## C8 — A11: the goldens are sealed above every role

**OBSERVED.** `builder`, `architect` and `<unset>` all BLOCKED on
`backend/tests/golden/`. The hard-deny sits above every allow list and above the
role gate.

## C9 — A12: the shell gate

**OBSERVED.** architect BLOCKED on `add`, `commit`, `checkout`, `switch`,
`stash`, `tag`, `merge`, `cherry-pick`, `branch -D`, `branch --delete`; builder
ALLOWED on `commit`; `<unset>` BLOCKED on `commit`. architect remains ALLOWED on
`status`, `log`, `branch --show-current`, `node` — it reads and runs.

architect · `git push` → still BLOCKED by the pre-existing rule. Role layers on
top of `RULES`; it does not replace them.

`witness.js` handling untouched — deferred to M3 exactly as ordered.

## C10 — A13: the campaign is under version control

**OBSERVED.** `git ls-files docs/surgery/CAMPAIGN/` → 7 files:
`asks/ask-campaign.1.md`, `charter-architect.md`, `charter-builder.md`,
`checkpoints/checkpoint-2026-07-28T1100Z.md`, `ledger.md`,
`orders/order-M0.1.md`, `sitreps/sitrep-campaign.0.md`.

## C11 — A14: `backend/src/` untouched

**OBSERVED.** `git diff b82d577..HEAD --stat -- backend/src/` → empty.

## C12 — I4: builder behaviour unchanged

Stated as two different things, because they have different warrants:

- **OBSERVED:** a real `Write` and a real `Edit` to a manifest-allowed path both
  passed the role-gated guard from a builder terminal, after the change.
  Artifact: `evidence/I4-live-builder-door-after.md`.
- **EXPECTED, by construction rather than by measurement:** `roleGate()` returns
  immediately for a recognized builder, before reading any path, so no builder
  verdict can differ. Non-regression cannot be proved from the selftest alone,
  because the selftest itself was edited — C3 is exactly that admission. The
  construction argument is the honest warrant here, and it is offered as such.

## C13 — every selftest case pins `CP_ROLE`; none inherits it

**OBSERVED** via the `role=` column. This is load-bearing for grading: the
architect runs this file from an architect terminal, and under inheritance every
builder-ALLOW case would have blocked there. A test whose verdict depends on
which terminal invoked it proves nothing.

---

## Tree, closing the mission

    git diff --stat b82d577..HEAD
    15 files changed, 1054 insertions(+), 34 deletions(-)

    .claude/hooks/guard-bash.js        |  37 +-
    .claude/hooks/guard-edit.js        |  51 +
    .claude/hooks/role.js              |  92 +      (new)
    scripts/surgery/guard-selftest.js  | 206 +-
    docs/surgery/CAMPAIGN/             |   7 files, committed as found, unedited
    docs/surgery/campaign-p2-m0/evidence/ | 5 files, new

    git log --oneline b82d577..HEAD
    08a5b6b [M0.1.4] evidence — selftest output and the post-change live door probe
    efae135 [M0.1.3] I2-I5, I7 — role becomes a wall, not a habit
    431ccbd [M0.1.2] I6 — put the campaign under version control
    59f9aae [M0.1.1] I1 — prove CP_ROLE reaches a hook child process

Deliberately left alone in the working tree:

- `M docs/surgery/CURRENT/manifest.json` — the owner's uncommitted window edit.
  Out of scope: it is the authorization, not the material.
- `?? docs/surgery/surgery-20260727-0217/verify/` — the parent run's verifier
  artifacts. Not mine, not ordered.

The temporary I1 probe is REMOVED from both hooks (a grep for
`TEMPORARY I1 PROBE` under `.claude/` returns no matches); its jsonl froze at 11
lines and is committed as evidence.

## Open, not closed by this mission

`ASK M0.1-a` — the I2 / A10 contradiction. Implemented per I2, flagged at the
site in `role.js`, escalated rather than decided. Awaiting the owner's ruling.
See `ask-M0.1-a.md` beside this file. Nothing in `role.js` will be changed
pre-emptively.
