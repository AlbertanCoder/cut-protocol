# SITREP campaign.1 — the cage is sound; the mission has not started

2026-07-28 20:09 MDT (2026-07-29T02:09Z) · HEAD `b7aa1dd` · architect

## A20 — PASS. M0.2 closes at 19 of 24.

Verified by my own runs at `b7aa1dd`:

    one commit, 3 files, 215 insertions
    ledger.md  21 insertions, 0 deletions   (append-only, machine-confirmed)
    verdict-20260728-2005-M0.2.md  first and only appearance in history
    content intact, including the sentence praising the builder and the ASK
    saying the owner may reasonably decline

The builder probed all three files BLOCKED to itself through the Edit door
**immediately before staging**, so the denial is timestamped ahead of the
commit rather than asserted after it. Then it committed all three.

**I1 closed the write door and I2 kept the commit door open, on the same three
files, in the same minute.** That is the whole of G2, and the commit contains
the verdict grading the mission plus the ASK asking the owner to unblock the
one incision the builder could not make. It can preserve both and alter
neither.

Remaining UNMET: A13–A16, A24 — the pre-commit hook, blocked on two manifest
lines only the owner's hand can add (ASK campaign.5).

## The thing I have to say plainly

The campaign began at `b82d577` at 05:03 this morning. It is now 20:09. In
that time:

    M0   The Wall .................. CLOSED, verified
    M0.2 Black box + TRUTH ......... CLOSED 19/24, verified
    M1   Heal the instrument ....... NEVER OPENED
    M2   The Trigger ............... NOT STARTED
    M3   The Witness runs .......... NOT STARTED
    RECEIPT v4 ..................... OWED

**Every hour has gone into the cage and the record. Zero product work.**

The Phase Two defect sits exactly where it sat at boot: `fillGapsWithBrain()`
in `weeklyPlanner.js` still collects candidates with `if (!s.recipeId) …
else if (s.warning) …`, still has no day-total or tolerance term, and still
cannot see a full, unwarned, out-of-band day. Not one line of the actual
mission has been touched. `witness.js` is still broken in the way the boot
briefing described.

## Was it worth it — honestly, both sides

**For:** grading M2 against a harness we believed contained writes, when it did
not, would have produced worthless evidence. The black box was unpersisted and
editable by the party it graded — verdicts on Tier A product surgery would not
have survived audit. Both were real, both are now fixed, and neither would have
surfaced without the probing.

**Against:** the harness work is generating its own work faster than it closes
it. G6, G7 and G7b all live in `scripts/scanSecrets.mjs`, which has nothing to
do with the witness criterion. Five ASKs and six gates have been opened;
Phase Two's actual surgery has not begun. This is drifting from "make the
evidence trustworthy" into "improve the tooling," and the second is unbounded.

I am the one who opened most of those gates. The drift is mine to name.

## Recommendation

1. **Close M0.2 at 19/24.** G3 is belt to G2's braces. Take ASK campaign.5 if
   the two lines are cheap; decline it without regret if not.
2. **Park G6, G7, G7b as a pre-push backlog item.** They block a *clean push*,
   not the mission, and nothing has ever been pushed — 48 commits, no remote.
   They are real and they are not on the critical path.
3. **Open M1 now** — heal `witness.js`. Tier B, inside the current window,
   frozen calibration clauses guarded. It is the last prerequisite for M3 and
   the window is already open for it.
4. **Relock after M1**, owner's hand, passphrase-gated.
5. **Then M2** — the actual Phase Two surgery, Tier A, inside the relocked
   cage where the allow list already covers the incision sites.

That sequence spends the open window on the only thing left that needs it, and
returns the campaign to the mission it was convened for.

## What I need from the owner

- ASK campaign.5 — two manifest lines, or a decline. Either is fine.
- A word on the recommendation above, particularly parking the scanner work.
- Nothing else. M1 needs no ruling; I can order it the moment the sequence is
  agreed.

## Standing

Nothing in flight. Both sessions holding. `role.js` untouched since the ruling.
The window remains `locked:false`; the relock stays the owner's hand and stays
passphrase-gated at the moment it happens.
