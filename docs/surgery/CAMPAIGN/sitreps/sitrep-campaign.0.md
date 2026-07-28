# SITREP campaign.0

Backfilled to disk 2026-07-28T11:00:39Z. This block was couriered to the
owner BEFORE the architect door existed — the paste preceded the original,
which is itself the fault the block reports. Text below is as couriered.

```
=== SITREP campaign.0 | HEAD b82d577 ===
ROLE   : ARCHITECT (CP_ROLE=architect). Read-and-run only.
ROOT   : C:/Users/<account>/Desktop/cut-protocol          — B0 PASS
BRANCH : fix/audit-remediation · 38 ahead of master · 0 behind · no upstream

B1 — CAGE PROBE. THE CAGE BITES, BUT IT IS NOT A ROLE CAGE.
  probe A  Write .architect-cage-probe.tmp         -> BLOCKED by guard-edit
  probe B  Write docs/surgery/CAMPAIGN/ledger.md   -> BLOCKED by guard-edit

  Probe A blocking is correct. Probe B blocking is a STOP-THE-WORLD fault:
  that path is the ONE door this charter grants me. I cannot write the
  ledger, orders/, verdicts/, receipts/, or checkpoints/. Until it opens the
  campaign has NO black box — every block I emit is paste-only, the disk
  original does not exist, and a closed window loses the campaign. This
  SITREP is itself unsaved.

  Both blocks came from the incision-manifest guard, NOT from role
  enforcement. Role enforcement does not exist: `CP_ROLE` appears in exactly
  two files repo-wide — charter-architect.md and charter-builder.md. The
  hooks never read it. Consequence: a BUILDER session booting right now
  inherits manifest mode `surgeon` and the full Tier-A allow list no matter
  what CP_ROLE says. Roles currently fail OPEN for the builder and fail SHUT
  for me — the exact inversion of M0's intent.

B2 — STATE AS FOUND (repo-derived; paper vs repo discrepancies flagged)

  CAMPAIGN/ skeleton: ABSENT. Contains only the two charters. No ledger, no
  orders/verdicts/receipts/checkpoints. Worse — the directory is UNTRACKED
  (`git ls-files docs/surgery/CAMPAIGN/` is empty; status shows `??`). The
  campaign's own law is not under version control. A `git clean -fd` deletes
  both charters. M0 must commit them.

  Harness: guards are real and manifest-driven. docs/surgery/CURRENT/
  manifest.json = run_id `surgery-20260727-1010`, mode `surgeon`,
  locked TRUE. That is a PHASE ONE run record still serving as live law.

  BRIEFING CLAIMS RE-VERIFIED AGAINST THE REPO — all three CONFIRMED:
  · Live defect. `fillGapsWithBrain()` in weeklyPlanner.js collects
    candidates as exactly `if (!s.recipeId) empty.push(i); else if
    (s.warning) roughs.push(i)`. Slot-emptiness and slot-warning only. No
    day-total term, no tolerance term. The trigger cannot see a full,
    unwarned, out-of-band day.
  · Witness broken. witness.js `api()` sends `authorization: Bearer
    ${token}` and hard-throws when register returns no token. App side,
    `requireAuth` in auth.js reads `req.cookies?.[COOKIE_NAME]`
    (`cutprotocol_session`) EXCLUSIVELY. No bearer path exists. Structural,
    not incidental.
  · Brain never fired. Machine output, `node scripts/surgery/ledger-delta.js`,
    pasted verbatim: `all-time : 13 row(s), $0.3928`, split
    `classify 8 / $0.0026`, `chat 4 / $0.1983`, `create 1 / $0.1919`.
    Zero generate-path rows. Newest `cmrzu1bcd0051wlo08nakbblp`
    2026-07-25T03:51:39.182Z.

  PAPER-VS-REPO DISCREPANCY. The charter's money law says "28 unreviewed
  commits and an unfinished secret-scan stand between this repo and
  daylight." The repo says 38 commits ahead of master — and per CLAUDE.md
  Phase 9 `origin` (AlbertanCoder/cut-protocol) is ALREADY PUBLIC. Daylight
  is not pending; it is here. Only this local branch is dark. The no-push
  law therefore binds harder than written, not softer.

STATUS: BLOCKED at B3. I can plan, read and run. I cannot record.
=== END SITREP campaign.0 ===
```

## Resolution

Owner ratified ASK campaign.1 in full and replaced the manifest by his own
hand. Re-probe at 2026-07-28T11:00:39Z: `CAMPAIGN/` writable, `backend/src/`
still denied, `backend/tests/golden/` still denied. The stop-the-world fault
reported above is CLEARED. Role enforcement itself remains absent — that is
ORDER M0.1.
