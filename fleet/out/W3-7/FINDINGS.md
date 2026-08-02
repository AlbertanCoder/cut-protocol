# W3-7 — best-stack-probe · THE COMBINED ARM

**Recovered 2026-08-01.** W3-7 was the agent that died: the run was killed at
22:29 on 2026-07-31 while writing its last arm's dumps, and it never produced
this file. **Every arm had already completed at all three seeds.** The answer was
on disk for a day. This file is the write-up, assembled from those artifacts —
no new solving was done, and nothing here is re-derived from a different tree.

Provenance carried by every dump: git SHA `962ac882…` on `fleet/measure-2026-08`,
**working tree clean, 0 porcelain entries**; DB sha256 `d9037dce…b623a1` with
copy MATCH; food fingerprint `b961ac3afbdf3f53` (14,151 foods / 910 recipes);
persona file sha256 `e564b1dd…57704e`; pool shape **route (applyFilterStack ON)**;
ruler **product/dayTolerance+dayInTolerance**; BRAIN off, network calls 0.

> ⚠️ These arms were measured on the **pre-fix tree**. The Tier 2 fixes (G4, G6,
> E4) landed afterwards and changed `macroCloser.js` — which `trimCloser.js`
> derives from. The **structural** conclusion below is robust; the **absolute
> point values must be re-measured** on the current tree before anything ships.

## THE ANSWER — the two big levers do NOT add

Pooled over the three canonical seeds (424242 / 20260730 / 8675309).

| arm | satisfiable (n=1,611) | Δ | all-planned (n=1,920) | Δ |
|---|---|---|---|---|
| base | 1,246 · 77.34% | — | 1,307 · 68.07% | — |
| c14 (in-gate steering) | 1,350 · 83.80% | +6.46 | 1,419 · 73.91% | +5.83 |
| c2 (smallest-first) | 1,375 · 85.35% | +8.01 | 1,443 · 75.16% | +7.08 |
| **c14+c2 (portioner)** | 1,427 · 88.58% | **+11.24** | 1,502 · 78.23% | +10.16 |
| **trim (fat+carb)** | 1,449 · 89.94% | **+12.60** | 1,517 · 79.01% | +10.94 |
| **c14+c2+trim (COMBINED)** | **1,487 · 92.30%** | **+14.96** | **1,566 · 81.56%** | **+13.49** |
| b20 (attempt budget 20) | 1,282 · 79.58% | +2.23 | 1,344 · 70.00% | +1.93 |
| c14+c2+b20 | 1,439 · 89.32% | +11.98 | 1,514 · 78.85% | +10.78 |

### Additivity — the question that blocked everything

```
portioner alone      +11.24 pp
trim alone           +12.60 pp
                     ────────
naive sum            +23.84 pp
MEASURED COMBINED    +14.96 pp
                     ────────
LOST TO OVERLAP       +8.88 pp      ← 37% of the naive sum evaporates
```

**Adding them would have overstated the gain by 59%.** W3-4's instruction —
*"run ONE combined arm before crediting either"* — was correct and load-bearing.

Per seed, the overlap loss is **+8.94 / +8.75 / +8.94 pp** — a 0.19 pp spread
across three independent seeds. The combined arm beats **both** single arms at
**every** seed, and the naive sum overstates at **every** seed. This is not a
noise artifact.

### The residuals — what each lever is actually worth once you have the other

| | residual |
|---|---|
| **trim, on top of a good portioner** | **+3.72 pp** |
| **portioner, on top of trim** | **+2.36 pp** |

This is the number that should drive sequencing, not the standalone figures.
Trim alone reads as the bigger lever (+12.60 vs +11.24), and it stays the better
*first* move — but its marginal value collapses from +12.60 to **+3.72** once
the portioner exists.

### `trim` alone reproduces W3-4 exactly

W3-4 published **+12.60 pts**. This independent pooling of W3-7's dumps gives
**+12.60**. Two agents, same substrate, exact agreement.

## Secondary result — the attempt budget is close to worthless on top of the portioner

`b20` alone is +2.23 pp. Added to the portioner it moves +11.24 → +11.98, i.e.
**+0.74 pp for a 20× per-slot attempt budget.** That corroborates W3-5's finding
that the budget knob is inside the noise and is the worst ratio measured. It
should not be raised.

## What this changes for the project

At base, **68.07% of all planned days land in band** — roughly one day in three
misses. The full combined stack takes that to **81.56%** — roughly one day in
five. That is a real, large improvement and it is **not** a solved problem.

The remaining ~18% is where the fleet's *other* findings point: snack starvation
is **authoring, not search** (135 of 141 empty snack slots arithmetically
unfillable a priori), and 17 of 30 vegan personas have no qualifying snack at
all. **No solver lever reaches those days.**

## Artifacts

`fleet/out/W3-7/*.report.md` and `stats-*.json` (copied from the run). The 24
per-day JSONL dumps (~3.4 MB each, ~80 MB total) remain in
`fleet/scratch/W3-7/`, which is gitignored by design — every number above is
recomputable from the committed reports.
