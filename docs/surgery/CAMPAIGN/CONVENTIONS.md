# CAMPAIGN CONVENTIONS — artifact naming and block stamping

Standing rules for both sessions. Adopted 2026-07-29T00:32Z on the **owner's
directly typed instruction**: *"Start timestamping the receipts / work orders
so I know which is the latest one, in case I get them mixed up."*

Charter note, logged per the charter's own requirement: the courier protocol
in both charters specifies the fence as
`=== <TYPE> <mission>.<seq> | HEAD <short-sha> ===`. Rule 1 below adds a UTC
stamp to that header. The owner's typed words outrank both charters, and this
change is **additive** — it removes no field and weakens no rule. Logged here
and in the ledger rather than treated as an amendment requiring the
passphrase, because it strengthens traceability rather than relaxing law.

---

## Rule 1 — every couriered block carries a UTC stamp

    === <TYPE> <mission>.<seq> | <UTC> | HEAD <short-sha> ===
    === ORDER M1.1 | 2026-07-29T00:32Z | HEAD a2c2ba5 ===

Stamp format `YYYY-MM-DDTHH:MMZ`. It goes between the sequence and the HEAD so
the eye lands on it without hunting. A paste is then self-identifying even when
it is one of six on a clipboard.

## Rule 2 — every artifact filename leads with its UTC stamp

    <type>-<YYYYMMDDTHHMMZ>-<id>.md

    orders/order-20260729T0032Z-M1.1.md
    verdicts/verdict-20260729T0114Z-M1.1.md
    receipts/receipt-20260729T0200Z-v4.md
    asks/ask-20260729T0032Z-campaign.5.md

A plain directory listing sorts chronologically. **The newest file is the last
line.** No cross-referencing, no opening files to find out which came first.

`checkpoints/` already followed this and is unchanged.

## Rule 3 — the stamp is the authoring moment, and never changes

The stamp records when the artifact was written, not when it was couriered,
committed or read. Artifacts are immutable once written (create-only under the
architect door), so a stamp that changes would mean the file changed.

## Rule 4 — pre-convention artifacts are indexed, not renamed

Everything authored before 2026-07-29T00:32Z carries the old unstamped names.
They are immutable to the architect and will **not** be renamed — renaming
would break every citation already couriered and committed.

Their chronology lives in the **ARTIFACT INDEX** section of `ledger.md`, which
is the one mutable file and therefore the only place a growing index can live.
When in doubt about ordering, the ledger is authoritative.

## Rule 5 — mixed naming is expected and is not a defect

The directory will contain both forms permanently. A file without a stamp is
simply older than 2026-07-29T00:32Z. That is a fact about the campaign's
history, not a mess to be tidied — and tidying it would require exercising the
exact write access that ASK campaign.3 argues should not exist.
