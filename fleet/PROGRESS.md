# FLEET PROGRESS — measure-2026-08

Run started: 2026-07-31. Orchestrator: Claude Code, fully autonomous.
Ledger: `fleet/state.json` (authoritative). This file is the human-readable mirror.

**Resume protocol:** read `fleet/state.json`, skip every agent whose `status` is
`done`, restart the first agent that is not. Artifacts under `fleet/out/<agent-id>/`
stand alone — a dead run loses momentum, never evidence.

## Status

Regenerated from `fleet/state.json` on 2026-08-01. **20 of 25 agents done, 5 pending.**
Headlines are condensed from the ledger's `headline` field; the ledger's full text is
the record, this table is the index.

| Wave | Agent | Name | Status | Headline |
|---|---|---|---|---|
| W0 | W0-1 | preflight-rescue | **done** | Rescue `75baddd` + 56 MB bundle (push guard-blocked). DB pinned. Brief distilled to ~90 claims; brief **contradicts** the prompt block. TRIAGE T-1 filed. |
| W1 | W1-1 | harness-truth | **done** | Built `dayDump.mjs`/`scoreDays.mjs`. Baseline **77.3% sat / 68.0% all-planned**; `--nostack` reproduces 437/623 = 70.1% byte-exact. A6 confirmed (16 days); **new** A6+ (p233 emits no record) and K2c (`applyFilterStack` dropped). |
| W1 | W1-2 | re-baseline | **done** | **THE BASELINE.** Ruler A 77.3% satisfiable (537 judged) / 75.0% planned; Ruler D 86.4%/83.9%. Reproduced W1-1 **byte-exact 640/640, 0 flips** at a different SHA. Canonical denominator = satisfiable-planned minus degenerate, **n=553**. Cross-seed spread 0.9pt ⇒ treat <3pts single-seed as unmeasured. Ruler D makes **keto worse** (−2.1). |
| W1 | W1-3 | taxonomy | **done** | Reconciled the over-side dispute **exactly** — all three numbers are correct on different denominators. **92.6% of failing days that contain food are pure-over** (W3-4 must cite that, not 74.6%). Buckets sum exactly at every denominator. **NEW: carb, not fat, is the largest overage mass** (20,495 g vs 8,594 g) — a fat-only trimmer leaves the bigger pile. B9 named: the worst offender is **the snack**. B5 conclusion **refuted**. |
| W1 | W1-4 | honesty-detection | **done** | **ADJUDICATION: the brief wins.** Premise true (`mealSolver.js:443` hardcodes `feasible:false`) but the conclusion is **refuted** — all 3 call sites are gated. **False-surrender rate 0.00%** at all 3 seeds (prompt claimed 95.8%); precision 100%, recall 98.73%. Reproduced E5–E7, D6, E9, E10. **The real defect is persistence and display:** no day-verdict column exists, TodayTab matches `/warning/i` on zero lines and draws fat as `kind=floor`, so an over-fat day renders as a met floor. |
| W1 | W1-5 | pool-census | **done** | Snack starvation is **authoring, not search** (135/141 empty snack slots unfillable a priori). Vegan gap **still open** for 17/30 personas. Density thesis **measures zero** (r=−0.001). H3: 57/57 GF-pasta recipes hidden from celiacs. |
| W1 | W1-6 | closer-audit | **done** | Closer = **+2.79 pts**, real at 3 seeds. Add-only confirmed verbatim; **strict no-op on 94.2% of failing days**. G1–G9 all confirmed. **94.2% of failing days are PURE OVER** ⇒ trim arm is the lever. |
| W2 | W2-1 | repartition-practice | **done** | `dayTolerance()` **is already a Chebyshev norm** — one `Math.max` from being the objective. Recommends augmented L∞ GP, no runtime dep, filter-acceptance guard. Found 2 new `brain/optimizer.js` bugs. |
| W2 | W2-2 | selection-precedents | **done** | Set-partitioning is the right frame but its **precondition fails** (days aren't columns). Recommends LNS. **20 attempts ≈ 2.46 independent ones.** Predicts realised +0–3 pts. |
| W2 | W2-3 | vegan-snack-market | **done** | The target box is a **fat problem, not a protein problem**: ≥32.6%E protein AND ≤23.4%E fat kills the entire nut/seed category by 3.4x. Only working architecture = near-zero-fat pulse/veg base + nutritional yeast. 12 dishes proposed, 11 wall-safe, Pd 2.5–3.8x the vegan median. **NEW SAFETY → TRIAGE T-3:** peanut-allergic users are **not** protected from **lupin**; the cross-reaction is documented in prose with no code consuming it. |
| W2 | W2-4 | competitor-teardown | **done** | **Zero of the three** comparable products (Eat This Much, StrongrFastr, Prospre) publish any numeric plan-accuracy tolerance — quote **0-of-3, not 0-of-5**. Showing a **band** is industry standard (5 of 6); grading a band while **displaying a point** is the worst configuration. Red-on-over is the category default ⇒ **calm-amber-plus-explanation is a position nobody occupies.** |
| W2 | W2-5 | weekly-metric | **done** | The proposed 7-day mean kcal ±5% **hides 47 out-of-band days** across 17 of 43 passing weeks with **zero false alarms** — a pure concealment device. **The denominator is the gaming resistance** (E11 = +4.0pts judged-only vs −6.2 fixed-planned). 7 days is statistically indefensible (95% CI ±28pts). Recommends 3-state day composition, 28-day window, **no score**. **Blocked on E2: no day verdict is persisted.** |
| W2 | W2-6 | fresh-sweep | **done** | Reframes D-3 with measurement: the brief refuted a **width** claim, the prompt made a **position** claim — they argued past each other. Width matches Helms (33.11% vs 33.3%); **position is wrong in both directions**, and **232/250 personas are graded compliant below the engine's own essential-fat floor**. A pure floor ruler **fails on nutrition** — re-anchor the ceiling to %E, don't delete it. BRAIN=off confirmed more right in 2026. |
| W3 | W3-1 | ruler-share | **done** | **THE DECOMPOSITION:** ruler share ≈ **+2.2 to +2.8 pts**, **solver share ≈ 22 pts** (n=553, gap 24.89). Arithmetic ceiling for any fat/carb re-grade is +16.82; 8.08pts miss kcal/protein entirely. Big ruler numbers are real but **inadmissible** — B/D/A15 are all bought by deleting the fat ceiling. Prompt right on diagnosis, brief right on prescription. Recommends E35k (+2.77) then R35k (+2.17). |
| W3 | W3-2 | repartition-probe | **done** | Found `wls2` on disk (`A13/a13-hook.cjs:187`), confirming W2-1's inference — but **W2-1's mechanism is refuted:** L∞ gains **less** than L2 and raises warned slots ~3x more; its `acceptRepartition` guard blocks **91.9% of improving moves** and costs −7.84pts. **Winners: C14 +6.27 (cheapest arm, 4.87 ms/day), C2 +7.78, C14+C2 = +10.91** at ~0 warned cost and 30% faster. C4 floor25 unshippable. |
| W3 | W3-3 | selection-probe | **done** | **Structural fact nobody noticed:** 185 of 250 personas ask for a **one-day** plan, where best-of-N is already the per-day argmax — cherry-picking is worth **zero on 74% of the population**. Cap-violation rate **94.36%** of week personas. **LNS = +2.95 for +15.7% work**, 0 cap breaches, 0 regressions, beating a 2.4x attempt budget. **Free permutation:** adjacency 496→5 (−99%) at exactly zero compliance cost. D5 sharpened into a proof that `SCORE_WEIGHTS` cannot move the metric. |
| W3 | W3-4 | trim-probe | **done** | **TRIM ARM = +12.60 pts** (canonical 553, pooled 3 seeds, measured **against the shipping closer**), real at every seed with 4x margin, +15% cost. Fat-only would have been +9.46 — W1-3's carb finding was decisive (keto +1.72 → +20.69). **All safety gates zero and verified:** allergen 0/40164, recipe-gate 0/8457, floors created 0, gram drift 0. **The real cost is the plate:** 83.2% of trimmed slots land below 0.7x reference. **+12.60 and +12.36 must not be summed.** |
| W3 | W3-5 | attempts-curve | **done** | **Knee = 20** on the per-slot budget; 20→40 is +0.24pp, **inside noise** (refutes the prompt's +1.74pp). Disambiguated two knobs both called "attempts". **NEW: the shipping adaptive rule is a net harm (−2.17pp)** and the entire loss lands on **vegan (−11.43) and keto (−9.77)** — the diets its own docstring claims to protect. Measured effective m = 1.92: W2-2's 2.46 is **void as arithmetic**, right as a conclusion. C11 refuted. Only 49.37% of the canonical denominator is addressable at all. |
| W3 | W3-6 | vegan-niche-probe | **done** | Inserted 1 food + 10 snack recipes on a **scratch DB** (real DB verified byte-identical); three throw-guards fire before any write. **+7.72pt (arm A) / +8.92 (arm B)**, not noise — **but the gain is FAT, not protein**: 99 of 145 rescued days were fat:over, and 550 of 562 placements **displaced a fattier snack** rather than filling an empty slot. Empty snack slots 141→45/seed. **Leaks 0 in both arms with a firing positive control**, so the zero is informative. Arm A's wall coverage is **zero** — the nutritional-yeast brand decides the wall. |
| W3 | W3-7 | best-stack-probe | **done** | **RECOVERED 2026-08-01** from artifacts the killed run had already written (commit `b7ceff3`). **THE COMBINED ARM:** portioner (c14+c2) +11.24pp, trim +12.60pp, **naive sum +23.84pp vs measured combined +14.96pp** — 8.88pp (37%) lost to overlap, so adding them would have **overstated by 59%**. Residuals: trim over a good portioner +3.72pp; portioner over trim +2.36pp. All-planned 68.07% → 81.56%. Measured on the **pre-fix tree** (`962ac88`); absolute values need re-measuring post-Tier-2. |
| W4 | W4-1 | reproduce | pending | |
| W4 | W4-2 | laws-sweep | pending | |
| W4 | W4-3 | reconcile | pending | |
| W4b | — | adaptive expansion | *not recorded in state.json* | The ledger has no `W4b` entry; this row is a placeholder carried from the original plan, not a status. |
| W5 | W5-1 | fleet-report | pending | |
| W5 | W5-2 | next-prompt | pending | |

## Log

- 2026-07-31 — Run initialized. State ledger + progress mirror created before any other work.
- 2026-08-01 — **Mirror regenerated from `fleet/state.json`.** This file had been left at
  its 2026-07-31 20:29 state and was listing 13 agents as `pending` that the ledger
  records as `done` — W1-2, W1-3, W1-4, W2-3, W2-4, W2-5, W2-6 and all seven of W3.
  A stale mirror of an authoritative ledger is worse than no mirror: the resume
  protocol points at `state.json`, but a human reading this table would have
  re-run finished work. Table rebuilt from the ledger; no status was written for
  anything the ledger does not record.
- 2026-08-01 — W3-7 (best-stack-probe) **recovered** from the artifacts its killed run
  had already written; committed `b7ceff3` at 20:09 −0600. Waves W0–W3 are complete
  (20 of 25 agents `done`); W4 and W5 (5 agents) remain `pending`.
- 2026-08-01 — **Ledger discrepancy, not repaired here** (`state.json` is not this
  file's to edit): `run.agentsSpawned` reads **18** while 20 agents carry
  `status: "done"`, and `run.currentWave` still reads `"W1-3/W1-4 then W3"` after
  W3 finished. The per-agent `status` fields are the part the resume protocol
  consumes and they are consistent; the two `run`-header fields are stale summary.
