# ORDER M0.1 — THE WALL

Issued 2026-07-28T11:00:39Z · HEAD b82d577 · **TIER B** (harness/scaffolding)
Window: manifest `campaign-p2-m0`, `locked:false`, owner-ratified. The window
covers M0 and M1 only and closes with an owner relock.

## Mission

Make role real. Today `CP_ROLE` exists in exactly two files repo-wide — the
two charters — and no hook reads it. The architect is restrained only by its
own discipline; the builder is restrained not at all by role. Fix that in the
harness, where it binds whether or not a session chooses to cooperate.

## PRECONDITION — do this before writing anything, and paste the result

Your own B0. In YOUR terminal, confirm `CP_ROLE` reads `builder`. If it is
absent or wrong, STOP and raise an ASK — do not proceed. Reason: the moment
this gate lands, a builder terminal without the env var fails closed to
architect restrictions and cannot commit its own work. That would strand this
mission mid-cut, and only the owner's hand could recover it.

## THE LAW THIS GATE MUST OBEY

**Permissions INTERSECT, never union.** Effective write set = (manifest allow
list) ∩ (role door). A role may only narrow what the manifest grants. No role
may widen it, and no role may reach past the goldens hard-deny. If you find
yourself writing code that lets a role permit something the manifest denies,
you have inverted the law — stop.

## INCISIONS — outcomes, you own the how

**I1 — Prove the mechanism before building on it.** The entire design assumes
`process.env.CP_ROLE` is visible inside a PreToolUse hook child process.
Demonstrate that empirically first and file the evidence. If the assumption is
FALSE, this order is void — stop and raise an ASK rather than inventing a
substitute channel. Do not skip this because it seems obvious; it is the
single load-bearing assumption under M0.

**I2 — Role resolution, fail-closed.** Read `CP_ROLE`, normalized (trim,
case-fold). Recognized: `architect`, `builder`. Absent, empty, whitespace, or
unrecognized → resolve to the ARCHITECT door or tighter. A forgotten env var
must never mint an unbound builder.

**I3 — The architect door.** Under `guard-edit`, role `architect` may:
  · CREATE new files under `docs/surgery/CAMPAIGN/` — allowed
  · EDIT `docs/surgery/CAMPAIGN/ledger.md` — allowed (append-only by charter)
  · modify ANY other already-existing file, anywhere — DENIED
  · write anywhere outside `docs/surgery/CAMPAIGN/` — DENIED
NOTE, and this is an architect ruling you are to implement as written: the
charter grants "new files under CAMPAIGN/" while also declaring `ledger.md`
append-only, which requires editing an existing file. The resolution above
carves out exactly one mutable file. Its consequence is deliberate and
desirable — orders, verdicts, receipts and checkpoints become mechanically
immutable once written. The black box cannot be doctored after the fact, by
me or by anyone wearing my role.

**I4 — The builder door.** Role `builder` keeps today's behaviour: the
manifest allow list governs, goldens hard-deny stands, `locked` seals stand.
Role adds no permission. If builder behaviour changes at all, you have
widened something — see THE LAW.

**I5 — The shell gate.** Under `guard-bash`, role `architect` is denied
repo-mutating git: `add`, `commit`, `checkout`, `switch`, `stash`, `tag`,
`merge`, `cherry-pick`, and branch deletion. The architect reads and runs; the
builder commits. Existing deny rules stay for every role.
DEFERRED, deliberately, not overlooked: whether the architect may invoke
`witness.js` is an M3 question and is NOT decided here. Leave witness
handling exactly as it is.

**I6 — Put the campaign under version control.** `docs/surgery/CAMPAIGN/` is
untracked; a `git clean -fd` currently deletes both charters and the ledger.
Commit the directory.

**I7 — Grow the selftest.** `scripts/surgery/guard-selftest.js` gains cases
covering the matrix below. Its existing cases must all still pass.

## PRE-REGISTERED ACCEPTANCE — adjudicated by machine, graded by me

A1  `node scripts/surgery/guard-selftest.js` exits 0, `0 failed`, total
    strictly greater than the 26 cases at HEAD b82d577.
A2  CP_ROLE=architect · Write NEW file under `docs/surgery/CAMPAIGN/` → ALLOW
A3  CP_ROLE=architect · Edit `docs/surgery/CAMPAIGN/ledger.md` → ALLOW
A4  CP_ROLE=architect · Edit an EXISTING file under `CAMPAIGN/orders/` → DENY
A5  CP_ROLE=architect · Write `backend/src/lib/x.js` → DENY
A6  CP_ROLE=architect · Write `.claude/hooks/guard-edit.js` → DENY
    (on the manifest allow list, denied by role — proves INTERSECTION)
A7  CP_ROLE=builder · Write `.claude/hooks/guard-edit.js` → ALLOW
A8  CP_ROLE=builder · Write `backend/src/lib/x.js` → DENY (not on manifest)
A9  CP_ROLE unset · Write `.claude/hooks/guard-edit.js` → DENY
A10 CP_ROLE=`  BUILDER  ` / `admin` / `` → each resolves architect-or-tighter
A11 every role · Write `backend/tests/golden/anything` → DENY
A12 CP_ROLE=architect · Bash `git commit -m x` → DENY; CP_ROLE=builder → ALLOW
A13 `git ls-files docs/surgery/CAMPAIGN/` returns non-empty
A14 No file under `backend/src/` modified: `git diff b82d577..HEAD --stat --
    backend/src/` is empty

## REPRODUCTION — run these, paste output verbatim into CLAIMS

    node scripts/surgery/guard-selftest.js
    git ls-files docs/surgery/CAMPAIGN/
    git diff b82d577..HEAD --stat -- backend/src/
    git log --oneline b82d577..HEAD

Plus the I1 evidence, and one LIVE probe from your own terminal: a real Edit
tool call to a manifest-allowed path, showing the builder door passes in
practice and not merely in the selftest harness.

## OUT OF SCOPE

witness.js (that is M1), anything under `backend/src/`, the goldens, the
relock (owner's hand, after M1). Do not touch the manifest — it is your
authorization, not your material.

## CLOSING

Commit small and often; your commits are your checkpoints. Emit
`CLAIMS M0.1` when done — falsifiable sentences, artifacts by path, symbols
not line numbers. Certify nothing. I run the probes myself and grade against
A1–A14 as written above, which are frozen as of this issuance.
