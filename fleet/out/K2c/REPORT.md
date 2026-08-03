# K2c — the rig and `runSolve` drop `applyFilterStack`

Agent K2c · 2026-08-01 · branch `fleet/measure-2026-08` · nothing committed.
Every number below carries its command and seed. Verdicts and pool filters are
imported from product code; no ruler was invented here.

## Verdict

CONFIRMED and FIXED. The fleet's characterisation holds: **level-inert,
day-pairing-fatal**. The headline level moves by at most 2 days in 623 (0.3pp),
while 32 of 250 personas were solving a materially different problem.

Two NEW findings came out of it, one of them a P0 that is not mine to fix —
see "Findings for the fleet".

## 1 · The defect, verified

`routes/plans.js:271-277` narrows the pool in THREE stages:
`filterRecipePool -> applyPrepFilter -> applyFilterStack`. The rig and
`backend/scripts/qc/runSolve.mjs` did the first two. There were **two
independent breaks**, and fixing either alone leaves the gap fully open:

1. `runRig.loadPersonas` hand-rolled its `filters` literal and never copied
   `maxCostCad` / `maxComplexity` / `minTaste` out of `personas.jsonl`. With all
   three null, `applyFilterStack` returns the pool untouched
   (`mealSolver.js:47-50`) — so a rig that called it would still measure nothing.
   Measured: with the legacy filters, the stack changes **0 of 250** pools.
2. `applyFilterStack` was never called at all.

Cap census over the 250 personas: **39 set a cap** (23 `maxCostCad`,
17 `maxComplexity`, 0 `minTaste`); **32 are affected**, 7 are inert (their cap
binds nothing): p010, p060, p064, p083, p105, p128, p154.

Pooled recipe-slots across the fleet: **86,411 -> 82,795 (-4.18%)**.

```
node docs/surgery/CAMPAIGN/solver-brain/A1/rig/poolGap.mjs --out=fleet/out/K2c/poolgap-rows.jsonl
```

### The 32 affected personas

| persona | tier | cap | afterPrep | afterStack | delta |
|---|---|---|---|---|---|
| p039 | HARD | maxCostCad=3 | 152 | 38 | -75.0% |
| p034 | HARD | maxCostCad=3 | 250 | 69 | -72.4% |
| p129 | EASY | maxCostCad=3 | 337 | 106 | -68.5% |
| p079 | HARD | maxCostCad=5 | 35 | 13 | -62.9% |
| p240 | EASY | maxComplexity=2 | 910 | 347 | -61.9% |
| p194 | EASY | maxComplexity=2 | 610 | 294 | -51.8% |
| p095 | EASY | maxCostCad=5 | 122 | 60 | -50.8% |
| p015 | EASY | maxCostCad=5 | 642 | 334 | -48.0% |
| p173 | EASY | maxCostCad=3 | 169 | 91 | -46.2% |
| p243 | EASY | maxCostCad=5 | 577 | 318 | -44.9% |
| p127 | HARD | maxCostCad=3 | 110 | 64 | -41.8% |
| p148 | EASY | maxCostCad=5 | 160 | 94 | -41.3% |
| p048 | EASY | maxCostCad=5 | 603 | 370 | -38.6% |
| p007 | EASY | maxCostCad=5 | 534 | 342 | -36.0% |
| p027 | IMPOSSIBLE | maxComplexity=3 | 20 | 13 | -35.0% |
| p201 | EASY | maxComplexity=4 | 53 | 35 | -34.0% |
| p158 | EASY | maxCostCad=5 | 450 | 304 | -32.4% |
| p085 | ROBUSTNESS | maxComplexity=2 | 296 | 212 | -28.4% |
| p125 | ROBUSTNESS | maxCostCad=8, maxComplexity=5 | 345 | 263 | -23.8% |
| p174 | HARD | maxComplexity=3 | 131 | 105 | -19.8% |
| p146 | HARD | maxCostCad=8 | 149 | 122 | -18.1% |
| p137 | EASY | maxCostCad=8 | 910 | 752 | -17.4% |
| p190 | EASY | maxCostCad=8 | 712 | 606 | -14.9% |
| p179 | EASY | maxComplexity=5 | 642 | 558 | -13.1% |
| p001 | EASY | maxCostCad=8 | 70 | 61 | -12.9% |
| p205 | EASY | maxCostCad=8 | 459 | 401 | -12.6% |
| p207 | EASY | maxCostCad=8 | 493 | 432 | -12.4% |
| p133 | IMPOSSIBLE | maxComplexity=5 | 20 | 18 | -10.0% |
| p220 | IMPOSSIBLE | maxCostCad=5 | 20 | 18 | -10.0% |
| p036 | EASY | maxCostCad=8 | 365 | 332 | -9.0% |
| p142 | EASY | maxCostCad=8 | 401 | 367 | -8.5% |
| p112 | EASY | maxComplexity=5 | 217 | 209 | -3.7% |

## 2 · The fix

Three files, all inside the K2c allocation. No product source touched.

| File | Change |
|---|---|
| `A1/rig/personas.mjs` | NEW. The rig's single persona loader, extracted from `runRig.mjs`. Builds `filters` with the product's own `planContext.parseFilters` — the same call `routes/plans.js:264` makes — so there is no second filter vocabulary to drift. Also exports `rigLegacyFilters()`, the pre-fix literal, kept so the defect is re-measurable rather than merely described. |
| `A1/rig/runRig.mjs` | Imports that loader; adds the third narrowing stage; `counts` now carries `afterStack` + `stackExplain` (which `classifyBinding`, `mealSolver.js:1085`, needs to name a cost/complexity cap instead of blaming prep); `run.poolShape` stamped on every record; `--nostack` reproduces the pre-fix shape, same flag name and meaning as `dayDump.mjs`. |
| `backend/scripts/qc/runSolve.mjs` | Adds `applyFilterStack` to its documented call sequence, with `afterStack`/`stackExplain` in `counts`. Inert today by construction — `genProfile.mjs` sets none of the three caps — but the instrument no longer DEPENDS on that staying true. |
| `A1/rig/poolGap.mjs` | NEW. The evidence above, re-runnable, plus the regression contract. |

Adopting `parseFilters` is a **strict superset**, verified not asserted:
`poolGap.mjs` compares it against `rigLegacyFilters()` field-by-field across all
250 personas and fails the run if anything other than the three cap fields
moved. Measured: **0 drift**.

`node --test tests/qc/invariants.test.js` — **9/9 pass** (incl. determinism and
the solver-purity check), run against an isolated DB copy.

## 3 · Did the headline level move? No.

Both arms, 250 personas, pinned DB `d9037dce…`, `BRAIN=off`, three canonical seeds.

```
node .../rig/runRig.mjs --agent=K2c --pop=personas --seed=<SEED> [--nostack] --quiet --out=fleet/out/K2c/<arm>-s<SEED>.jsonl
```

| seed | before (no stack) | after (stack ON) | delta |
|---|---|---|---|
| 424242 | 469/623 = 75.3% | 467/623 = 75.0% | **-0.3pp** (2 days) |
| 20260730 | 469/623 = 75.3% | 469/623 = 75.3% | **0.0pp** |
| 8675309 | 469/623 = 75.3% | 468/623 = 75.1% | **-0.2pp** (1 day) |

**The fix is surgical, and that is the load-bearing result.** On all three
seeds: the 218 unaffected personas' plans are **byte-identical** between arms —
**0 days changed** — and **all 32** affected personas move. The level is inert;
the per-persona problem being solved was not. Within the 32 on seed 424242 the
level goes 81.3% -> 78.8% (65/80 -> 63/80).

Determinism was re-established before any of this was believed: two independent
`--nostack` runs at seed 424242 are byte-identical across all 639 days.

## 4 · Findings for the fleet

### P0 — the shared `dev.db` left the pinned baseline mid-session, and I was not the one who moved it

`backend/prisma/dev.db` is now **`fb67a37f7f7890e6…`**, not the pinned
`d9037dce9754b452…`. Cause is visible in the tree: an untracked migration
`backend/prisma/migrations/20260802034419_plan_verdict_persistence/` and a
`dev.db.pre-verdict-migration-backup` (= `d9037dce…`) written at 21:41 today.
**Any measurement pinned to `d9037dce` can no longer be reproduced from the
shared file** — only from that backup or an existing agent copy. I never wrote
to the shared file; my copy still hashes `d9037dce…`.

### P1 — the pinned sha256 does not name the state that was measured

The hash covers `dev.db` only. SQLite here runs in WAL mode, so committed pages
can live in `dev.db-wal`, which the hash does not cover. Two runs can both
truthfully report `dbHash d9037dce` and read **different data**.

Concretely: `dayDump.mjs`'s header quotes this same finding as "32 personas,
p039 123 -> 37, 4.1% of pooled slots". Against the pinned main file alone the
same 32 personas measure **p039 152 -> 38, -4.18%**. My first `poolGap` run
reproduced dayDump's numbers exactly — because it happened to copy a live `-wal`
mid-migration. The persona SET is identical in both states, so the FINDING is
robust; the magnitudes are not, and neither is any baseline quoted without its
WAL.

### P2 — `dbcopy.mjs` mutates an existing agent copy on REUSE

`prepareAgentDb` deletes the copy's `-wal`/`-shm` when the SHARED file has none
(`dbcopy.mjs`, sidecar loop). On a *reused* copy that silently discards
WAL-resident pages a previous run read — so a scratch DB is not a stable
snapshot across invocations. This is exactly what contaminated my first
measurement run; I discarded it and re-measured. `dayDump.mjs` has the same
sidecar logic. I did not change it: it is load-bearing for other agents today
and the correct fix (copy-once-then-freeze, or hash main+wal together) is a
fleet-wide decision, not a K2c one.

## 5 · Files

Data (all in `fleet/out/K2c/`): `poolgap-rows.jsonl` (250 rows, per-persona pool
at each stage), `before-*`/`after-*` day dumps for the three seeds,
`before-nostack-s424242-REPLICATE.jsonl` + `-REP2.jsonl` (the determinism
control).

Not committed, not pushed. `backend/prisma/dev.db` never opened by this agent.
