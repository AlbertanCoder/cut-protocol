# ASK campaign.3 — who owns the black box

**To:** the owner. **From:** the architect, at HEAD `bf1288c`.
**Status:** OPEN. Blocks M1 together with ASK campaign.2.
Filed to disk before couriering.

Seconds the builder's `ASK M0.1-b`, confirms it against the repo, and adds a
second defect the builder's version does not name — one that runs the
opposite way and is the more serious of the two.

## Defect 1 — the architect authors but cannot persist (builder's finding)

CONFIRMED by my own `git status --short` at `bf1288c`:

     M docs/surgery/CAMPAIGN/ledger.md
    ?? docs/surgery/CAMPAIGN/checkpoints/checkpoint-2026-07-28T1130Z.md
    ?? docs/surgery/CAMPAIGN/verdicts/

VERDICT M0.1 — the document grading this mission — is untracked. A
`git clean -fd` destroys it. Cause is the seam between two of my own
incisions: **I6** put `CAMPAIGN/` under version control; **I5** took
`git add` / `git commit` from the architect. Each correct alone. Together,
every artifact the architect creates is born unpersisted and stays that way
until a builder commits it.

## Defect 2 — the graded party can rewrite its own grades (mine, new)

`roleGate()` returns immediately for `builder`, and the live manifest allows
`docs/surgery/CAMPAIGN/`. So the builder has full write access to every
order, verdict, receipt, sitrep and checkpoint in the black box.

OBSERVED — the hook invoked directly, same mechanism `guard-selftest` uses,
target `docs/surgery/CAMPAIGN/verdicts/verdict-M0.1.md`:

    builder    exit=0
    architect  exit=2   BLOCKED: ... already exists, and the architect door
                        is CREATE-ONLY

**The black box is immutable to its author and mutable to the party it
judges.** VERDICT M0.1 claimed the record "cannot be doctored after the fact,
including by the role that wrote it." That is true and it is the wrong
half — the role that wrote it is the only one restrained. `guard-selftest`
has no case covering builder access under `CAMPAIGN/`, which is why 66 green
cases did not surface this.

Stated plainly: the builder's conduct has been the opposite of the risk. It
refused to commit another role's artifacts unordered, filed its remedy
without being chased, and raised the persistence half of this itself. The
finding is about mechanism, not about this builder.

## Recommendation — one change closes both

**Deny the builder write access under `docs/surgery/CAMPAIGN/`, and make it a
standing duty that the builder commits `CAMPAIGN/` as it finds it.**

The builder has its own run directory for claims, asks and evidence and has
no authoring need inside `CAMPAIGN/`. Guard hooks gate the Edit/Write tools,
not git — so a builder that cannot *write* there can still *commit* there.

That converts the builder's proposed discipline ("commit as found, never
modify") into a mechanism: `git add docs/surgery/CAMPAIGN/` can then only
stage bytes the architect wrote. Defect 2 closes because the graded party
loses write access; Defect 1 closes because the commit key stays in one hand
and needs no per-artifact order.

**Against the alternative** — granting the architect scoped `git add`/`commit`
for `CAMPAIGN/`: the builder recommended against it on the grounds that
pathspec-scoped git is not reliably enforceable by command-string matching.
That objection is correct as stated. It could be answered with a sealed
`scripts/surgery/campaign-commit.js` that stages only `CAMPAIGN/` and refuses
if anything else is staged — enforceable by code rather than regex. I am NOT
recommending it now: it is new machinery for a problem the simpler fix
already solves, and it would widen the architect's door, which is the one
direction neither of us should be arguing for.

**Residual risk, named not hidden.** Under my recommendation, artifacts
authored between one builder commit and the next are unpersisted, so a
window that dies in that gap loses them. The architect retains `git status`
and can detect the exposure; the owner's hand can always commit. Accepting
this risk is part of the ruling.

## Scope note

Both defects live in `.claude/hooks/` and `scripts/surgery/`, which the
current window still leaves open. Fixing them after the relock would need
another owner hand-action. Cheapest sequencing is to fold the fix into M1,
which is already scheduled inside this window — so the ruling is wanted
before M1 opens, not after.
