# ASK M0.1-b — the architect can write to the black box but cannot persist it

**To:** the owner, with the architect to advise.
**From:** the builder · raised at HEAD `c7f7bcc`
**Status:** OPEN. Not blocking M0.1, which is closed. Blocking-adjacent for M1.
**Filed to disk first, couriered second** — applying VERDICT M0.1's finding
rather than repeating it in a new shape.

## What I OBSERVED

Immediately after filing the M0.1 remedy:

    git status --short
     M docs/surgery/CAMPAIGN/ledger.md
     M docs/surgery/CURRENT/manifest.json
    ?? docs/surgery/CAMPAIGN/checkpoints/checkpoint-2026-07-28T1130Z.md
    ?? docs/surgery/CAMPAIGN/verdicts/
    ?? docs/surgery/surgery-20260727-0217/verify/

**VERDICT M0.1 itself is untracked.** So is the 1130Z checkpoint. The ledger
append is unstaged. All three are the architect's work from this session, and
none of it is committed.

## Why it happened — the two orders interact

- **I6** put `docs/surgery/CAMPAIGN/` under version control, because a
  `git clean -fd` would otherwise delete the campaign's own law.
- **I5** denied the architect `git add` and `git commit`.

Both were correct in isolation. Together they mean **every artifact the
architect creates is born unpersisted and stays that way until a builder
commits it.** The architect can author the black box; it cannot save it. A
`git clean -fd` right now destroys the verdict that grades this mission, and
the architect has no mechanical means to prevent that.

This is the exact hazard I6 was ordered to close, reopened one layer up by I5.
It is not a defect in either incision. It is a gap in the seam between them,
and neither of us specified who closes it.

## A second instance of the same class, stated evenhandedly

`ASK campaign.2` is not on disk. `docs/surgery/CAMPAIGN/asks/` contains only
`ask-campaign.1.md`. It reached me as a paste, and its fence carried a
truncated stamp — `=== ASK campaign.2 | HEAD 0` — which is a Law-3 violation on
the wire.

I raise this **not** as a counter-charge. The finding against me was correct and
I have remedied it. I raise it because it shows the defect is structural rather
than personal: the same failure appeared on both sides of the wire within one
exchange, and the side that had just diagnosed it could not fix its own instance
because I5 removed the means. A rule that only one role can obey is not yet a
rule.

## Options, for the owner's ruling

1. **Builder commits the architect's artifacts on sight** — a standing duty,
   no order needed per item. Simple, and matches who holds `git commit`. Cost:
   the builder routinely commits material it did not author and must not edit.
   Mitigation: commit as found, never modify — exactly how I6 was executed.
2. **Each mission ends with an explicit persistence step** in the order. Tidier
   in principle; fails exactly when a session dies mid-mission, which is the
   case the persistence law exists for.
3. **Narrow I5** to permit the architect `git add`/`git commit` restricted to
   `docs/surgery/CAMPAIGN/`. Restores its autonomy, but weakens a guard that was
   just proved to bite, and pathspec-scoped git is not reliably enforceable from
   a command-string pattern match. **I recommend against this**, and note that I
   am the party who would gain nothing either way.

**My recommendation: option 1.** It needs no new machinery, it cannot be
forgotten at the end of a mission, and it keeps the commit key in exactly one
hand. If ratified I will treat it as standing and will not ask again per
artifact.

## What I have NOT done

I have not committed the verdict, the checkpoint or the ledger append. That is
unordered work on another role's evidence, and the architect's instruction was
to hold. They are safe as long as nobody runs `git clean`. Say the word and it
is one commit.
