# ASK campaign.1 — and its ratification

Couriered 2026-07-28, backfilled to disk 2026-07-28T11:00:39Z.

## The ask, as couriered

Two decisions for the owner; neither takeable by any session.

**The bootstrap knot, derived.** In `guard-edit.js` the order of operations
is: goldens hard-deny FIRST, then the `if (locked)` seal, THEN the allow
list. So while `locked:true`, `.claude/` and `scripts/surgery/` die in the
seal ABOVE the allow list — adding them to `allow` is inert, dead code never
reached. The manifest and `docs/surgery/CURRENT/` are sealed too, so no
session can edit its way out. M0 needs `.claude/hooks/`; M1 needs
`scripts/surgery/witness.js`; both sealed, and the seal is self-defending.
Exactly one actor can open it: the owner.

It need not be all-or-nothing. `locked:false` drops only those four sealed
prefixes; the allow list still governs, and the goldens hard-deny sits ABOVE
the lock, so `backend/tests/golden/` is unwritable in every state. An
unlocked manifest with a TIGHT allow list is a narrow, auditable window.

**DECISION 1 — resequencing.** Charter order M0→M1→M2→M3 needs a separate
unlock for M0 and another for M1. Both are Tier B harness/instrument work.
Proposed: ONE window — owner unlocks → builder does M0 + M1 → architect
diff-reviews every byte → owner relocks → M2 (Tier A) and M3 run inside the
relocked cage, where the allow list already covers the incision sites. One
hand-action instead of two; the dangerous window bounded by a single signed
review.

**DECISION 2 — the hand-action.** Owner replaces
`docs/surgery/CURRENT/manifest.json` with run_id `campaign-p2-m0`, mode
`surgeon`, `locked:false`, allow = [`.claude/hooks/`,
`.claude/settings.json`, `scripts/surgery/witness.js`,
`scripts/surgery/guard-selftest.js`, `docs/surgery/CAMPAIGN/`,
`docs/surgery/campaign-p2-m0/`].

Permits: the two hook scripts, the settings that register them, the broken
witness, the selftest that must grow role cases, the architect door, the
run's evidence dir. Still forbids: ALL of `backend/src/`, and the goldens
unconditionally.

**Standing requirement.** `docs/surgery/CAMPAIGN/` must appear in the `allow`
list of EVERY manifest from here on. Drop it at relock and the architect goes
mute. CAMPAIGN/ is not under CURRENT/, so the seal does not touch it — the
allow entry is the only thing holding that door open.

**Risk named, not hidden.** Inside this window `.claude/` is writable, so the
cage can in principle be weakened by its occupant. Mitigations: window covers
two missions only; guard-selftest (26 cases) must still pass plus new role
cases; architect reads every byte of the hook diff before recommending
relock.

## Ratification

Owner ratified BOTH decisions and typed the campaign passphrase bare in the
terminal, outside any fence — valid authority under the charter's override
clause. Manifest verified on disk at 2026-07-28T11:00:39Z as a byte-match to
the proposal above.

Ledger consequence: the relock ceremony at the end of M1 MUST restore
`locked:true` and MUST retain `docs/surgery/CAMPAIGN/` in `allow`. Both are
architect obligations at that checkpoint.
