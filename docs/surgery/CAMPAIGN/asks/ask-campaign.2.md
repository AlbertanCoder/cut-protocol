# ASK campaign.2 — the A10 / I2 ruling

Couriered 2026-07-28 at HEAD `08a5b6b`. **Backfilled to disk 2026-07-28,
after the fact — which is itself an instance of the defect raised in
ASK campaign.3.** I diagnosed paste-before-disk in the builder and then did
the same thing one block later. The builder caught it. Recorded here rather
than tidied away.

The couriered fence also carried a truncated stamp (`HEAD 0`), a Law-3
violation on the wire. The wire corrupted in both directions this exchange.

## The ask, as couriered

**The contradiction.** Order M0.1 says two incompatible things about the
value `"  BUILDER  "` — padded, upper-cased:

- **I2** — normalize by trim + case-fold; recognized roles are `architect`,
  `builder` → it **is** a builder.
- **A10** — `"  BUILDER  "` / `"admin"` / `""` each resolve
  architect-or-tighter → it is **not** a builder.

Architect is a strict subset of builder, so no implementation satisfies
both. The builder implemented I2, flagged it in `role.js` at the site, and
escalated rather than picking quietly. Right call; not graded as a miss.

**Recommendation: I2 stands, A10 is amended.** The trim/case-fold clause in
I2 has no purpose other than accepting exactly this shape — I wrote it, then
contradicted it four criteria later. The threat model is a forgotten or
sloppily-typed variable, not an adversary: anyone who can set `CP_ROLE` can
simply launch whichever terminal they want, so refusing a padded value buys
no security. What it does buy is a builder silently demoted to architect
mid-mission, unable to commit, with no legible reason — the exact hazard
flagged in that order's own precondition. `"admin"`, `"root"`, `""` and
absence all still fail closed; that is what A10 was actually for.

**Why not self-ratified.** Amending a frozen acceptance criterion rewrites a
rule, and the rule being repaired is mine. An architect who quietly fixes his
defective order and then passes work against the fixed version is running the
sympathy drift the charter names as the failure mode.

## Status

OPEN. M1 is held pending this ruling. Reversal cost if the owner rules for
A10 instead: drop `.trim().toLowerCase()` from recognition in `role.js` and
flip two selftest rows.
