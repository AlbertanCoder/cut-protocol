# ASK M0.1-a — I2 and A10 of ORDER M0.1 contradict each other

**To:** the owner, for ratification. The architect advises; the ruling is the
owner's, because this amends a rule.
**From:** the builder · mission M0.1 · raised at HEAD `08a5b6b`
**Status at filing:** OPEN. Implemented per I2. Not blocking; nothing else in
M0.1 depended on it.

**This file is the ORIGINAL.** Filed to disk as remedy under VERDICT M0.1's
single finding — the first courier of this ASK existed only as a paste, and the
paste corrupted in transit.

## The contradiction, quoted from the order as filed on disk

    I2   "Read CP_ROLE, normalized (trim, case-fold). Recognized: architect,
          builder."
         -> "  BUILDER  " normalizes to "builder" and IS recognized.

    A10  "CP_ROLE='  BUILDER  ' / 'admin' / '' -> each resolves
          architect-or-tighter"
         -> "  BUILDER  " must NOT be recognized.

These cannot both hold. Architect is a **strict subset** of builder in this
window — builder reaches the whole manifest, architect reaches create-only
`CAMPAIGN/` plus `ledger.md` — so there is no verdict that is simultaneously
"builder" and "architect-or-tighter".

`"admin"`, `"root"`, `""` and absence are unaffected. They fail closed under
either reading.

## What was built, and why

**Implemented I2.** I2 specifies the mechanism, and its trim/case-fold clause
has no purpose other than accepting exactly this shape. A rule that normalizes a
value and then rejects the normalized value is not normalizing.

The choice was not treated as settled:

- flagged in a comment at the site in `role.js`, naming this ASK;
- the selftest row is labelled `(I2 reading)` so it reads as contested rather
  than as decided;
- escalated here rather than absorbed silently.

## The real question, which is not about string handling

**Should a malformed role fail closed even when its intent is obvious?**

- Under **I2**: a terminal launched with a stray space still gets its intended
  door. Forgiving about shape, strict about value.
- Under **A10**: sloppiness is itself treated as suspicious and costs the
  smaller door. Stricter, and closer to this campaign's temperament.

## The architect's recommendation, recorded here for the owner's convenience

From `docs/surgery/CAMPAIGN/verdicts/verdict-M0.1.md`: **I2 stands, A10 is
amended.** Its reasoning — the threat model is a forgotten or sloppily-typed
variable, not an adversary, since anyone who can set `CP_ROLE` can simply launch
whichever terminal they want; and silently demoting a padded `BUILDER` to
architect would strand the builder mid-mission, unable to commit, with no
legible reason, which is the precise hazard ORDER M0.1's own precondition
warned about.

The architect explicitly declined to self-ratify this, on the grounds that it
would be repairing its own defective order and then grading work against the
repaired version.

The builder holds no strong view and will implement either ruling.

## Cost of reversal

Two lines, no other file affected:

1. `.claude/hooks/role.js` — drop `.trim().toLowerCase()` from recognition in
   `resolveRole()`.
2. `scripts/surgery/guard-selftest.js` — flip the two normalization rows from
   ALLOW to BLOCK.

## Timing — this has a clock on it

The ruling is needed **before the window relocks**. `role.js` sits inside the
seal once `campaign-p2-m0` closes, and after that a two-line change costs an
unseal instead of an edit.

## Disposition

Awaiting the owner's word. `role.js` will not be changed pre-emptively in
either direction.
