# CAMPAIGN CONVENTIONS v2 — LOCAL TIME LEADS

**SUPERSEDES `CONVENTIONS.md` in full.** Adopted 2026-07-28 18:40 MDT
(2026-07-29T00:40Z) on the owner's typed instruction: *"The timestamp seems to
not be the right time, can you fix it."*

Read this file, not `CONVENTIONS.md`. That file is retained as the record of
what was adopted at 18:32 MDT and is wrong about time zone only; its Rules 3,
4 and 5 survive verbatim below.

---

## What was wrong

Nothing about the clock. Diagnosed against the machine:

    local   2026-07-28 18:40:19   (Mountain, DST active, -0600)
    utc     2026-07-29T00:40:19Z
    git     a2c2ba5  2026-07-28 18:29:17 -0600

v1 stamped everything in **UTC**. Mountain time is UTC−6 in summer, so from
6:00 PM local onward UTC has already rolled into the next calendar day. An
evening's work filed itself under **July 29** while the owner was still
working on **July 28**.

The convention existed so the owner could tell which artifact was latest. A
scheme that files tonight under tomorrow's date defeats that purpose in the
exact case it was written for — a late session, which is when confusion is
most likely. The times were accurate and unusable, which is a failure.

## Rule 1 — fences carry LOCAL time first, UTC in parentheses

    === <TYPE> <mission>.<seq> | <local> (<utc>) | HEAD <sha> ===
    === ORDER M1.1 | 2026-07-28 18:40 MDT (00:40Z) | HEAD a2c2ba5 ===

Local leads because a human reads it. UTC rides along so a cold third-session
auditor, or a reader in another zone, is never guessing. The parenthetical may
drop the date when it is the same UTC day; when UTC has rolled over, write it
in full — `(2026-07-29T00:40Z)` — so the rollover is visible rather than
surprising.

## Rule 2 — filenames lead with LOCAL date and time

    <type>-<YYYYMMDD-HHMM>-<id>.md

    orders/order-20260728-1840-M1.1.md
    verdicts/verdict-20260728-1912-M1.1.md
    receipts/receipt-20260729-0900-v4.md

Local, no zone suffix in the name — the campaign runs on one machine in one
zone, and the ledger carries both times for anything that needs resolving.

A directory listing sorts chronologically and the dates match the days the
owner remembers working. **Newest is the last line.**

DST caveat, stated rather than engineered around: the one-hour shift in
November can make two artifacts inside that hour sort by name in the wrong
order. Missions are hours or days apart, so this is theoretical — and the
ledger's ARTIFACT INDEX is authoritative for ordering in any dispute.

## Rule 3 — the stamp is the authoring moment, and never changes

Unchanged from v1. Not courier time, not commit time. Artifacts are immutable
once written, so a stamp that moved would mean a file that moved.

## Rule 4 — nothing already written is renamed

Unchanged from v1, and now it bites twice: the artifacts named in UTC stay
named in UTC. Renaming would break every citation already couriered and
committed, and would require exactly the write access ASK campaign.3 argues
should not exist.

The ledger's **ARTIFACT INDEX** now carries BOTH times per artifact, so a
UTC-named file can be mapped to the local day it was actually written.

## Rule 5 — mixed naming is permanent and is not a defect

Three forms will coexist: unstamped (before 18:32 MDT), UTC-stamped (18:32 to
18:40 MDT — a window of one file), and local-stamped (after). That is a fact
about this campaign's history. Tidying it would require the write access
campaign.3 argues against.

## Cost paid to fix this, recorded deliberately

`CONVENTIONS.md` could not be edited. The architect door is create-only, so
correcting a convention costs a whole new file and a supersession note rather
than a two-line edit.

That is the create-only rule working as designed — the black box cannot be
quietly rewritten, including by the role that wrote it and including when the
rewrite would be honest. The cost is real and it is the price of the property.
Noted here so that nobody later mistakes the file proliferation for sloppiness.
