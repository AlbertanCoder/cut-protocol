# VERDICT M0.1 — THE WALL

Graded 2026-07-28 · HEAD `08a5b6b` · Tier B · graded against acceptance
A1–A14 frozen at issuance of ORDER M0.1.

**RESULT: PASS on 13 of 14. A10 is HELD, not failed — it is unadjudicable
because it contradicts I2 of the same order. That contradiction is my
defect, not the builder's.**

Every line below came from my own executions in the architect terminal at
`08a5b6b`. No claim was graded on the builder's description of it. I could
not read the builder's CLAIMS block — it arrived corrupted — so this verdict
is derived entirely from the repo, which is how it should have been derived
regardless.

## Grade

| # | Criterion | Result | How I know |
|---|---|---|---|
| A1 | selftest exit 0, 0 failed, total > 26 | PASS | ran it myself: `66 passed, 0 failed, 66 total`, exit 0 |
| A2 | architect CREATE under CAMPAIGN/ → ALLOW | PASS | this file exists |
| A3 | architect EDIT ledger.md → ALLOW | PASS | ledger appended this session |
| A4 | architect EDIT existing CAMPAIGN/orders/ → DENY | PASS | live Edit of `order-M0.1.md` refused |
| A5 | architect Write backend/src/ → DENY | PASS | live probe refused; selftest concurs |
| A6 | architect Write `.claude/hooks/guard-edit.js` → DENY | PASS | live Write refused **while on the manifest allow list** |
| A7 | builder Write `.claude/hooks/` → ALLOW | PASS | commits `efae135`/`59f9aae` touch those files |
| A8 | builder Write backend/src/ → DENY | PASS | selftest |
| A9 | CP_ROLE unset → DENY | PASS | selftest row `role=<unset> … (fail-closed)` |
| A10 | `"  BUILDER  "` → architect-or-tighter | **HELD** | contradicts I2; see below |
| A11 | every role, goldens → DENY | PASS | live probe refused; `GOLDENS INTACT` |
| A12 | architect `git commit` → DENY | PASS | live shell probe refused |
| A13 | `git ls-files docs/surgery/CAMPAIGN/` non-empty | PASS | 7 files |
| A14 | no `backend/src/` change | PASS | `git diff b82d577..HEAD --stat -- backend/src/` empty |

A6 is the criterion that proves the design. `.claude/hooks/guard-edit.js` sits
on the live manifest allow list, and the role door refused it anyway. That is
INTERSECTION demonstrated on the real wire, not asserted in a harness.

## Code read, not skimmed

`resolveRole()` in `.claude/hooks/role.js` — absent, empty, whitespace-only and
unrecognized all return `ARCHITECT`. One shared module required by both gates,
so the two doors cannot drift apart.

`roleGate()` in `.claude/hooks/guard-edit.js` — called only after
`if (!ok) die(...)`, i.e. only once the manifest has already answered yes. It
has **no branch that returns allowed**; every path either returns void or
calls `die()`. It is structurally incapable of widening the manifest. The
builder guarded this with a comment forbidding such a branch from ever being
added, which is the right instinct.

Create-vs-edit is decided by `fs.existsSync`, not by which tool was used — so
a `Write` that would clobber an order is refused on identical footing to an
`Edit` of it. That closes the hole I did not think to specify.

## I1 — the assumption that could have voided this order

Proven TRUE by experiment, not assumed: `present:true, raw:"builder"` observed
in **both** hooks, driven by real tool calls rather than a harness spawning the
hooks itself. The builder also answered a question I never asked — whether a
session can promote itself — and showed it cannot, by two independent
mechanisms. Probe code was temporary and is confirmed absent from both hooks at
`08a5b6b`.

## Deviations I accept, with reasons

**I7, "existing cases must survive."** Four ALLOW cases hardcoded the dead
`surgery-20260727-1010` window and could not survive unmodified — the guard
correctly blocked them once the manifest moved. The builder re-pointed them to
the live window, preserving the assertion while changing the path, and added a
WINDOW preflight so the next window change fails loudly instead of leaving four
confusing reds. That is better than what I ordered.

**A1's stated premise.** I wrote "the 26 cases at HEAD b82d577" implying
26/26 green. The true baseline was 22 passed / 4 failed — because the manifest
replacement *I designed* invalidated those four cases. A1's literal text still
passes (66 > 26). The builder filed the honest baseline in
`evidence/E0-selftest-baseline.txt` rather than quietly repairing it, which is
correct conduct.

## HELD — A10 versus I2

I2 mandates trim + case-fold, under which `"  BUILDER  "` normalizes to
`builder` and is recognized. A10 requires that same value to land
architect-or-tighter. Architect is a strict subset of builder, so no
implementation satisfies both. The criteria set was defective as issued.

The builder implemented I2, flagged the conflict at the site in `role.js`, and
escalated rather than choosing silently. That is exactly right, and I am not
grading it as a miss.

**My recommendation to the owner: I2 stands, A10 is amended.** The trim /
case-fold clause in I2 has no purpose other than accepting this shape; the
threat model here is a forgotten or sloppily-typed variable, not an adversary
— anyone who can set `CP_ROLE` can simply launch the terminal they want.
Silently demoting a padded `BUILDER` to architect would brick the builder
mid-mission with no legible reason, which is the precise hazard I flagged in
this order's own precondition. `"admin"`, `"root"`, `""` and absence all still
fail closed; that is what A10 was actually for.

**I am not self-ratifying this.** Amending a frozen acceptance criterion
rewrites a rule, and I do not get to quietly repair my own defective order and
then pass work against the repaired version. It goes to the owner.

## Finding against the builder — the only one

No `claims.md` and no `ASK M0.1-a` exist anywhere on disk. `git ls-files`
returns only the previous run's claims file. The campaign's persistence law
says the disk is the original and the paste is a copy; for its claims and its
ASK the builder inverted that. The consequence is not theoretical — the pasted
CLAIMS block arrived corrupted, with at least eight lines truncated mid-
sentence, and there is no original to fall back on. I graded from the repo
instead, which worked only because the *evidence* was filed properly.

Remedy required before M1 opens: file `claims-M0.1.md` and `ask-M0.1-a.md` to
disk, then re-courier.

## Standing obligations, unchanged

The window is still open and still covers M1 only. At relock the manifest must
return to `locked:true` **and** retain `docs/surgery/CAMPAIGN/` in `allow`.
witness.js is untouched, exactly as ordered; the architect's right to invoke it
remains an M3 question.
