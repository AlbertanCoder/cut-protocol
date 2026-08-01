# SOLVER BRAIN — mid-flight corrections, part 4

*Continues `CORRECTIONS.md`, `-2` and `-3` (all immutable once written).
**Every Phase-4, Phase-5 and Phase-6 agent reads all four.***

---

## C18 — DO NOT RUN `checkdb.mjs --fix`. The live DB moved; your copy is the correct one.

**Status: coordinator, MEASURED, 2026-07-31. Binding on A13–A25. This is the sharpest
active hazard in the run.**

The live `backend/prisma/dev.db` changed between the 2026-07-30 fleet run and this
resume:

| | sha256:16 | when |
|---|---|---|
| fleet baseline | `e55f52e53658a086` | 07-30 21:00, re-verified mid-run |
| live now | `d9037dce9754b452` | 07-31 05:53 |

The divergence is **not** attributable to the fleet. Separate provenance work ran at
05:50 today (`dev.db.backup-provenance149-20260731-055003`), and the dev server has held
a live SQLite connection with an active WAL since 07-26.

**Every agent working copy is still the baseline.** Measured 2026-07-31:

```
A1 A7 A10 A11 A13 A14 A16 A17 A18 A19 A20  ->  all e55f52e53658a086
```

`prepareAgentDb()` **reuses** an existing `<agent>/dev.db` rather than re-copying, so
every arm any agent measured on 07-30, and every arm measured now, sits on the **same**
baseline DB. **Cross-phase comparability is intact.** A1–A15's numbers and A13–A20's
resumed numbers are on one nutrition dataset.

**The hazard:** `checkdb.mjs` compares your copy against the *current* live DB. It will
now report

```
MISMATCH  <id>/dev.db is NOT a copy of the current backend/prisma/dev.db
  -> re-run with --fix, and discard results produced from the old copy.
```

**That instruction was written before the live DB moved and is wrong under these
conditions.** `--fix` does not trip `guard-bash.js` (which denies `--force` and bare
`-f`, not `--fix`), so nothing will stop you. Running it would copy the **07-31** DB over
your baseline copy and make your new arms incomparable with your own 07-30 arms — a
confounded A/B of exactly the shape the HARNESS-INCIDENT describes: a real measurement of
the wrong thing.

**The rules:**

1. **Do not run `checkdb.mjs --fix`.** If you already ran it, say so loudly in your
   FINDINGS and mark every arm measured after it as **not comparable** to your earlier
   arms. Do not quote a delta across that boundary.
2. A `MISMATCH` report from `checkdb.mjs` is **expected and correct** right now. It is not
   a reason to re-copy. Record it and continue.
3. **Do not re-copy the live DB by any other route either** (`cp`, `dbcopy.mjs`,
   `prepareAgentDb(..., {force:true})`).
4. If you have no `dev.db` in your directory at all, a plain `cp` of the live DB gives you
   the **07-31** dataset, not the baseline — say so, and treat your numbers as levels on a
   different dataset, never as deltas against another agent's.

**For A22 (replay):** the ledger's 07-30 numbers reproduce only against the baseline DB.
Replay from the agent copies, not from `backend/prisma/dev.db`.

**For A24 (red team):** this discontinuity was a live inflation risk and is recorded as
one. The mitigation is that it did not land — but verify that independently rather than
taking this note's word for it.

**For A25:** the Definition of Done requires stating that the live `dev.db` is
byte-identical to how it started. **It is not, and the honest report says so** — with the
evidence above that the fleet did not cause it and did not measure against it. Do not
write "unchanged".
