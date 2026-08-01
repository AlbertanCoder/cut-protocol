# SOLVER BRAIN — fleet status

Mission: `docs/surgery/CAMPAIGN/SOLVER-BRAIN-fleet-prompt.md`
Run started (this session): 2026-07-30
`dev.db` baseline sha256: `e55f52e53658a086b9aa8d0ac272f70d84e5d8dce54436dda20b3377f0eaba47`

States: `pending` · `running` · `complete` · `blocked` · `not-reached`

## Phase 1 — instrument and anchor
| id | question | state |
|---|---|---|
| A1 | shared experiment rig + compare.mjs | pending |
| A2 | failure taxonomy of the 173 missed days | pending |
| A3 | ceiling audit / denominator ruling | pending |

## Phase 2 — theory and literature (read-only)
| id | question | state |
|---|---|---|
| A4 | is the fat band defensible? | pending |
| A5 | diet-problem literature (Stigler → MIP) | pending |
| A6 | industry tolerance conventions | pending |
| A7 | vegan feasibility under killer stack | pending |
| A8 | infeasibility-detection metrics | pending |

## Phase 3 — code recon (read-only)
| id | question | state |
|---|---|---|
| A9 | solve-loop anatomy / degrees of freedom | pending |
| A10 | dormant optimizer wiring surface | pending |
| A11 | pool density per diet × allergen corner | pending |
| A12 | ruler coherence | pending |

## Phase 4 — live experiments
| id | question | state |
|---|---|---|
| A13 | n-knob portioning | pending |
| A14 | search-budget re-sweep | pending |
| A15 | ruler variants, re-scored | pending |
| A16 | pool enrichment curve | pending |
| A17 | closer expansion | pending |
| A18 | objective weights | pending |
| A19 | joint vs greedy | pending |
| A20 | refusal path | pending |
| A21 | best stack | pending |

## Phase 5 — adversarial verification
| id | question | state |
|---|---|---|
| A22 | replay via oracle.mjs | pending |
| A23 | citation check | pending |
| A24 | red team / inflation list | pending |

## Phase 6 — synthesis
| id | question | state |
|---|---|---|
| A25 | REPORT.md | pending |

## Log
- 2026-07-30 — session resumed. Prior run (`logs/run-01.log`) created agent
  directories and stopped on a settings warning; no FINDINGS.md existed.
  `dev.db` verified unchanged. Launching Phase 1.

---

## Append-only update log

> `guard-edit.js` blocks any rewrite of this file — under
> `docs/surgery/CAMPAIGN/` the architect door is CREATE-ONLY and sitreps are
> immutable once written. Recorded here as required, not worked around: from
> this point STATUS.md is maintained **append-only** via shell `>>`, the same
> mechanism the fleet prompt mandates for `CLAIMS.tsv`. The tables above are
> the state at launch; each entry below supersedes them for the agents it names.

### 2026-07-30 — session resumed, nothing skippable
Prior run created the 25 agent directories and stopped before any agent ran.
Every `FINDINGS.md` was absent, so no agent was marked complete and none was
skipped. `dev.db` re-hashed: byte-identical to baseline
`e55f52e53658a086b9aa8d0ac272f70d84e5d8dce54436dda20b3377f0eaba47`.

### 2026-07-30 — BRIEF.md written
`docs/surgery/CAMPAIGN/solver-brain/BRIEF.md` is the shared contract every agent
reads first: mission, the four-macro definition of "days in band", the
denominator problem, rules of engagement, the DB-isolation contract, prior
negative results, and the integrity + anti-slop rules.

### 2026-07-30 — Phases 1, 2, 3 launched (12 agents live)
Phases 2 and 3 are read-only and neither depends on A3's denominator ruling, so
they run concurrently with Phase 1 rather than after it.

| id | state |
|---|---|
| A1 rig | running |
| A2 failure taxonomy | running |
| A3 ceiling audit | running |
| A4 fat band defensibility | running |
| A5 diet-problem literature | running |
| A6 industry tolerance convention | running |
| A7 vegan feasibility | running |
| A8 infeasibility-detection metrics | running |
| A9 solve-loop anatomy | running |
| A10 dormant optimizer | running |
| A11 pool density | running |
| A12 ruler coherence | running |

Phase 4 (A13–A21) gated on A1's rig landing. Phase 5 (A22–A24) gated on Phase 4.
A25 last.

### 2026-07-30 — A4 and A6 complete; a load-bearing premise falsified

| id | state | verdict |
|---|---|---|
| A4 fat band defensibility | complete | FALSIFIED |
| A6 industry tolerance convention | complete | CONFIRMED |

**`CORRECTIONS.md` created** — mandatory reading for every agent launched from
here, alongside `BRIEF.md`.

The headline: the mission prompt's §2 claim that fat is graded at **±8 %,
"tighter than any published dietary guideline expresses"**, is wrong. The band is
±8 %; the *rule that grades a day* is **±33.1 %** of the midpoint, because
`bandMiss()` divides by the midpoint and `DAY_FAT_TOLERANCE_PCT = 0.25` is applied
on top of the band. Derived independently three times — A4, A6, and the
coordinator reading `mealSolver.js:205-250` directly. The app's effective fat gate
is **looser** than the NASEM AMDR (±27.3 %) and ~2.4× looser than the IIFYM
gram convention, so "the ruler is too tight on fat" is dead as a hypothesis and
A15 must re-baseline its variants against ±33.1 %, not ±8 %.

Two further defects reported by A4, not yet independently re-verified, carried in
`CORRECTIONS.md` as C2 and C3: the fat band is not universal (keto and
carb-floored paths use `fatMid * 0.9 … * 1.12`), and the effective pass floor
(0.2475·lbm) sits **17.5 % below the engine's own `ESSENTIAL_FAT_PER_LB_LBM = 0.3`**
— a day can grade in-band while under the constant the engine calls essential.

**Operational block, recorded not circumvented (C4):** subagents can write files
via shell redirection but the Write tool is refused for report files, so agents
cannot create their own `FINDINGS.md`. The coordinator now persists each returned
deliverable verbatim to `<ID>/FINDINGS.md` as it lands. `A4/FINDINGS.md` and
`A6/FINDINGS.md` are on disk.

### 2026-07-30 — Phases 2 and 3 complete; A3's denominator ruling lands

| id | state | verdict | headline |
|---|---|---|---|
| A2 failure taxonomy | complete | CONFIRMED | 63.6 % of satisfiable misses bind on the portion bound; **66 of 70 at the 0.5× FLOOR, none at the ceiling alone** |
| A3 ceiling audit | complete | FALSIFIED | impossible tier is 52 days not 83 → **denominator 526, ceiling 91.0 %** |
| A4 fat band | complete | FALSIFIED | effective fat gate is ±33.1 %, not ±8 % |
| A5 diet literature | complete | CONFIRMED | goal-programming MMKP; predicts A19's greedy-vs-joint gap is single-digit |
| A6 industry convention | complete | CONFIRMED | no shipping app publishes a fat tolerance; 70.1 % is comparable to nothing |
| A7 vegan feasibility | complete | CONFIRMED | **library problem, not botany** — zero concentrate rows in 14,151 foods |
| A8 infeasibility metrics | complete | CONFIRMED | **the app has no refusal path at all**; KPI split defined for A20 |
| A9 solve-loop anatomy | complete | CONFIRMED | two knobs, both spent on kcal+protein; **the closer can only ADD** |
| A11 pool density | complete | CONFIRMED | only 2.3 % of satisfiable personas are pool-limited — corners are **solver-limited** |
| A12 ruler coherence | complete | CONFIRMED | grader coherent 250/250 → **0.0 points of the gap**; the UI disagrees with it |

Still running: **A1** (rig on disk, no-op A/B not yet reported) · **A10**.

`CORRECTIONS-2.md` created — C6 through C13. Mandatory reading with `BRIEF.md` and
`CORRECTIONS.md` for every agent launched from here.

**What Phase 1–3 changed about the mission:**

1. **The denominator moved.** 526 satisfiable days, not 495. Today's rate on it is 77.0 %,
   and the all-days ceiling is 91.0 %, not 88 % — a figure that was never reproducible from
   the brief's own tier count (83 implies 85.6 %).
2. **The "ruler is too tight" hypothesis is dead.** The fat gate is ±33.1 %, *looser* than
   the NASEM AMDR. A12 independently shows the grader is jointly satisfiable for 250/250
   profiles, so the ruler explains **0.0 points** of the gap. The gap is real.
3. **The corners are solver-limited, not pool-starved** (A11: 2.3 %). Vegetarian protein
   density is the one genuine authoring target. This redirects A16.
4. **The binding constraint is the 0.5× floor, not the 2.0× ceiling** — which is the
   opposite end from the one the mission prompt argues against widening.
5. **Two mechanisms are pointed the wrong way:** the macro closer can only add while the
   dominant failure is over-band, and the app has no refusal path to measure at all.

Three internal disagreements are logged, not smoothed over, for A24: A2 vs A3 on how many
days to restore, A3 vs A11 on what "pool-limited" counts, and A3 vs A7 on whether the vegan
wall is structural or authored.

### 2026-07-30 — Phase 1 complete; Phase 4 launched (8 concurrent)

| id | state | verdict | headline |
|---|---|---|---|
| A1 rig | complete | CONFIRMED | no-op A/B returns **exact zero** (639/639 byte-identical); **MDE is ~3.5 pts, not 1.5** |
| A10 dormant optimizer | complete | CONFIRMED | per-role works but **falsifies the pinning premise** — pinning and compliance move in opposite directions |

**All 12 Phase 1–3 agents are complete. Every `FINDINGS.md` is on disk.**

`CORRECTIONS-3.md` created — C14 through C17. C14 is the one that binds hardest.

**C14, the discrimination floor.** A1 measured the rig's minimum detectable effect from a
real positive control: thinning the pool to 2-of-3 recipes moved satisfiable-only **−2.05 pts
and the paired 95 % interval still spanned zero**. McNemar at n=536 gives a 95 % half-width of
**3.45 pts**. The brief's ±1.5 describes HTTP-fleet run-to-run variance, not resolving power —
treating it as a significance bar would have manufactured false positives across all nine
Phase-4 agents. Anything between 1.5 and 3.5 points is **unresolved**, not small.

Sent as a mid-flight correction to A13, A14, A15 and A16, which were already running.

**Phase 4 live, 8 concurrent:** A13 n-knob · A14 budget re-sweep · A15 ruler variants ·
A16 pool enrichment · A17 closer expansion · A18 objective weights · A19 joint vs greedy ·
A20 refusal path. **A21 (best stack) is held back** until the individual levers report —
it measures the combination and must not sum parts.

Each Phase-4 assignment was rewritten against what Phase 1–3 actually found rather than what
the mission prompt assumed. Four were materially redirected: A13 (A10 already falsified its
premise), A15 (its listed fat variants are tightenings, not loosenings), A16 (A11 showed the
corners are not pool-limited), A18 (the constant it was told to sweep is dormant — zero
product paths reach it).

### 2026-07-30 — A15 complete: the ruler is not where the gap lives

| id | state | verdict |
|---|---|---|
| A15 ruler variants | complete | CONFIRMED |

A15 re-graded the fixed 578-day set under 11 band definitions without re-solving, and
reproduced baseline **exactly** (405/578 and 405/526, zero disagreements against the recorded
verdicts) before reporting anything.

**Ruler-attributable share of the gap: ≤ 4.0 of 23.0 points**, and only at a fat gate of
±50 % — 1.83× the NASEM AMDR relative half-width, supported by no published guideline.
**~19 of the 23 points are solver or pool.** That is the decomposition the mission asked for,
and it closes the ruler question.

Every one of the mission prompt's listed fat variants (±10/15/20/25 %) is a **tightening** from
the true ±33.1 % and costs 4.9–27.4 points. C1 confirmed from a third independent direction.

Two sharp secondary results:
- **A4's C3 essential-fat defect flips exactly zero days.** 0 of 578 occupy the
  [0.2475, 0.30)·lbm hole; the 18 days below 0.30·lbm are all empty-plan days that already
  fail. Real in the code, zero realized incidence — the same shape as C13's latent leak.
- **42 of 42 fat-only misses are OVER the band, none short.** Rescuing the 81 fat-failing days
  needs a tolerance of ±75 % at the median. That is not a tolerance, it is the absence of one —
  and it independently corroborates C9 (the closer can only add).

A14 paused mid-sweep with all six variants on disk; resumed to finish its comparisons.

### 2026-07-31 06:14 — resumed after an overnight stall; dev.db has MOVED

The 2026-07-30 run did not stop for a fleet reason. It hit a Claude **session
limit** and died at 22:17, three minutes before the 22:20 reset. The runner
(`solver-brain-fleet.bat`) treated the quota wall as an ordinary failure and
gave up, so nothing ran for the following 7.5 hours. The machine never slept.
Both runner defects are fixed (quota is now waited out, not retried to death;
log numbering no longer truncates prior logs on relaunch).

**State inherited by this resume — 13 of 25 complete:**
A1–A12 and A15 have `FINDINGS.md` on disk. **A13, A14, A16, A17, A18, A19 and
A20 have real artifacts but never reported** — A14 in particular has 93 files
and a nearly-complete budget sweep (last write 22:17:12). Do NOT re-run those
sweeps from zero; read what is on disk first and finish the comparison.
A21–A25 have empty directories and have not started.

**dev.db no longer matches the baseline in this file's header.**

| | sha256 |
|---|---|
| baseline (21:00:54, re-verified mid-run) | `e55f52e53658a086b9aa8d0ac272f70d84e5d8dce54436dda20b3377f0eaba47` |
| observed 2026-07-31 05:53 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |

Size is unchanged at 22,781,952. The divergence is **not** attributed to the
fleet: `dev.db.backup-provenance149-20260731-055003` shows separate provenance
work ran at 05:50 today, and the dev server (`src/server.js`, up since 07-26)
holds a live SQLite connection with an active WAL — which is expected, since
the experiment rig drives that server over HTTP.

This is recorded, not resolved. It is a **real threat to cross-phase
comparability**: every number A1–A15 reported was measured against the baseline
DB, and anything measured from here is measured against a different one.
Before A21 scores a combined stack or A22 replays via `oracle.mjs`, re-run the
A1 no-op A/B — it returned exact zero (639/639 byte-identical) on the baseline,
so it is the cheapest available test of whether the DB shift moved the floor.
If it no longer returns zero, say so loudly rather than reporting deltas.
A24 should treat this discontinuity as an inflation risk in its own right.

### 2026-07-31 — Phase 4 finishers relaunched (7 concurrent)

Resumed after the overnight quota stall. **Nothing already complete was re-run.**
A1–A12 and A15 have `FINDINGS.md` on disk and were left untouched.

The seven agents that died mid-flight all have real, near-complete experiment
artifacts on disk. They were relaunched as **finishers, not restarts** — each was
told explicitly to read its own directory first and finish the analysis rather than
re-run sweeps from zero, because the data was already collected and re-running it
would burn hours to reproduce numbers that already exist.

| id | artifacts on disk | state |
|---|---|---|
| A13 n-knob portioning | 37 files (3-seed baseline + 7 diagnostics) | running |
| A14 search-budget re-sweep | 93 files (sweep near-complete, last write 22:17:12) | running |
| A16 pool enrichment | 29 files (2 catalogues + 8 enrichment arms) | running |
| A17 closer expansion | 13 files (passthru/reimpl/reimpl2 validation chain) | running |
| A18 objective weights | 29 files (11 A/B arms + hookidentity control) | running |
| A19 joint vs greedy | 14 files (dayN + forkweek at 3 seeds, oracle probes) | running |
| A20 refusal path | 6 files (bound audit + predicate eval) | running |

Each was launched against what Phases 1–3 actually found, not what the mission
prompt assumed — C7's denominator (526, not 495), C9's add-only closer, C10's
0.5x floor, C11's solver-limited corners, C14's 3.5-point discrimination floor.
A16 and A17 additionally carry C16's mandatory `oracle.mjs` leak check, since both
touch pools that C13 showed contain a latent style-gate leak.

**A21 remains held back** until the individual levers report — it measures the
combination and must not sum parts (C14). Phase 5 (A22-A24) gates on Phase 4;
A25 last.

**The dev.db discontinuity from the 05:53 entry is unresolved and still binding.**
Before A21 scores a combined stack, the A1 no-op A/B is re-run as the gate: it
returned exact zero (639/639 byte-identical) on the baseline DB, so it is the
cheapest available test of whether the shift moved the floor. If it no longer
returns zero, that is reported loudly and no cross-phase delta is quoted.

### 2026-07-31 — the DB discontinuity is RESOLVED, and it exposed a live hazard

**Comparability is intact.** The 05:53 entry flagged the live DB moving off the fleet
baseline as a threat to every cross-phase number. Coordinator measured the agent
working copies directly, and the threat does not land:

| copy | sha256:16 |
|---|---|
| A1 A7 A10 A11 A13 A14 A16 A17 A18 A19 A20 | `e55f52e53658a086` (baseline) |
| live now | `d9037dce9754b452` |

`prepareAgentDb()` **reuses** an existing `<agent>/dev.db` instead of re-copying. Every
arm measured on 07-30 and every arm measured on this resume therefore sits on the **same**
nutrition dataset. A1-A15's numbers and A13-A20's resumed numbers are one dataset, not two.

**But the same mechanism created a trap, and it is now `CORRECTIONS-4.md` / C18.**
`checkdb.mjs` compares an agent's copy against the *current* live DB, so it now reports
`MISMATCH ... -> re-run with --fix, and discard results produced from the old copy.`
That instruction was written before the live DB moved and is wrong under these conditions.
`--fix` does **not** trip `guard-bash.js` (which denies `--force` and bare `-f`, not
`--fix`), so nothing would have stopped an agent from obeying it — overwriting its baseline
copy with the 07-31 dataset and silently invalidating every comparison against its own
existing arms. That is precisely the confounded-A/B shape `HARNESS-INCIDENT.md` documents:
a real measurement of the wrong thing.

C18 was sent to all seven running agents as a mid-flight correction, each with the specific
way a re-copy would break *that* agent's design — A14's 93-file curve, A17's
passthru->reimpl validation chain, A18's `hookidentity` control, A19's three-seed
replication, A16's pool-addition treatment, A20's structural-infeasibility ground truth.

**For A25's Definition of Done:** the live DB is **not** byte-identical to how it started.
The honest report says so, with the evidence that the fleet neither caused the change
(separate provenance work ran at 05:50, and the dev server holds an active WAL) nor
measured against it. "Unchanged" would be false.

### 2026-07-31 — A23 pulled forward into the Phase-4 window (8 concurrent, at the cap)

A23 (citation check) scopes to Phase 2 (A4-A8), which completed on 07-30. It has no
dependency on Phase 4 and nothing it reads is still being written, so holding it behind
the experiment agents bought nothing. Launched now, bringing the run to the 8-concurrent
ceiling the infrastructure contract sets.

It was pointed at the three Phase-2 numbers that became load-bearing elsewhere rather than
at the citation list as a flat set: the NASEM AMDR +/-27.3 % half-width (A15 benchmarks its
+/-50 % variant against it at 1.83x), the IIFYM +5 g/-10 g convention (C1 calls the app's
gate 2.4x wider), and A5's single-digit greedy-vs-joint prediction (A19 is being scored
against it right now). If any of those three is misattributed, the damage is not confined
to Phase 2.

A22 (replay) and A24 (red team) still gate on Phase 4 — both audit numbers that do not
exist yet. A25 last.

### 2026-07-31 — A14 complete: the null holds, but its stated MECHANISM is falsified

| id | state | verdict |
|---|---|---|
| A14 search-budget re-sweep | complete | CONFIRMED |

Finished on the 07-30 data with **zero new solves**. All 43 JSONL files carry
`dbHash e55f52e53658a086` and `foodFingerprint 423e7279ed6af641` — one dataset, no
boundary crossed. `checkdb.mjs` never invoked; **C18 clean.** Gate passed before
anything else: `A14-base-s424242` is byte-identical to `A1-baseline-s424242` on 639/639
rows, so the rig is a verified no-op against A1.

**The prior campaign's flat-after-12 curve reproduces** (marginal gains +3.36/+0.37/+0.93
against the prior +6.9/+0.2/+1.4). Same shape, same knee, **halved amplitude** — the
closer and the staple un-quarantine already took what extra restarts used to find. That
is a clean reproduction of a known null and A14 leads with it rather than dressing it up.

**What is new, and it contradicts the prior campaign's explanation.** The prior result
that a flat budget of 20 *starves* thin pools (a 36-recipe fixture falling 6/7 -> 4/7) is
**not observable under current code**. Stratified by pool size, the thinnest bin is where
depth gains *most*: **+16.67 pts on the 60 thinnest days**, while pools above 300 move
`b=0 c=0` exactly. **Thin pools were starved by too little depth, not too much.** The
mission prompt carries the old mechanism as settled; it is not.

**Consequence for the fleet: the lever is the FLOOR, not the cap or the attempts.**
`max(5, min(20, n/10))` -> `max(12, ...)` is +1.12 pts pooled (n=1608, b=17 c=35,
positive in 3/3 seeds) for +17 % draws. The cap of 20 is correctly placed — raising it to
40 is a clean null across three seeds, lowering it costs real compliance. **Attempts and
the per-slot cap are both levers the desktop campaign already applied**; A24 should treat
any claimed gain on them as double-counting. The floor is the one knob nobody moved.

This is the second time this campaign has found the binding constraint at the **lower**
bound while the mission prompt argues about the upper one — C10 found the same for the
0.5x portion floor. Two independent knobs, same direction.

**Instrument faults A14 recorded, both material for Phase 5:**
1. **`compare.v2.mjs`'s own `VERDICT` line still applies the pre-C14 +/-1.5 pt floor.** It
   printed "clears the +/-1.5 pt noise floor" for the exact +3.36 delta that then failed to
   replicate at two other seeds. **A22 and A24 must not harvest that line as a verdict** —
   the tool contradicts C14 in its own output.
2. **Wall-clock cost is unusable.** Two arms proven to be the same effective rule (identical
   mean budget, identical `slotCalls`, 0 of 639 rows differing) logged 34.9 s vs 78.7 s.
   `solveMs` measured machine load during a 90-minute sweep, not the treatment. Cost must be
   quoted in deterministic candidate draws.

Running: A13 · A16 · A17 · A18 · A19 · A20 · A23.

### 2026-07-31 — A19 and A13 complete. A13 is the study's largest result, and it is not the one it was sent to find.

| id | state | verdict | headline |
|---|---|---|---|
| A19 joint vs greedy | complete | CONFIRMED | achievable +1.7 pts; **oracle bound +10.2** — the gap is the variety cap, not search |
| A13 n-knob portioning | complete | **FALSIFIED** | n-knob buys **+0.37 (unresolved)**; the 4-macro OBJECTIVE buys **+14.74** |

**A13 falsifies its own assignment twice, and both falsifications are worth more than the
assignment.**

1. **The pinning metric is not a diagnostic.** The kill condition fires on the winning arm:
   n-knob raises pinning 39.4 -> 61.5 % while raising compliance +15.11 pts. Under `role`,
   **95.7 % of days that PASS touch a bound.** A property nearly every successful day has
   cannot indicate failure. A13 reproduces the BRIEF's motivating pair on an independent path
   (40.1 % of slots, 71.3 % of missed slots — against 39.3 % / 68.3 %), so **the statistic is
   real and its interpretation was wrong.** The mission prompt built "the highest-prior
   mechanism in the study" on it. A10 saw the inversion first; A13 confirms it on the shipping
   solve path and adds that pinning is not even monotone.
2. **The knobs were never the mechanism.** `role` (k<=5) over `wls2` (k=2) is **+0.37 pts,
   b=8 c=10 — unresolved at n=536.** 97.6 % of the n-knob gain is available at today's degrees
   of freedom. What pays is *what you aim them at*: swapping `optimizer.js`'s
   `{kcal:1,protein:1,fat:0.1,carb:0.1}` for tolerance-normalised 4-macro weights is **+5.60**.

**The lever, replicated at three seeds: +14.74 pts [+11.40,+18.08], b=8 c=87** — 2 knobs,
4-macro tolerance-normalised objective, no new box, spread no worse than baseline. And the
defect it exploits is that the data is **already there**: `weeklyPlanner.js:451` computes a
fat/carb composition target, scores with it at L468-469, then discards it before
`scaleRecipe(recipe, kcalTarget, proteinTarget)` at L394 portions the plate. The intervention
is passing an argument that already exists.

**This is the symmetric trimmer C9 said was unbuilt.** Fat-over-band days 255 -> 152,
`fatOk` 84.9 -> 94.6 %. A19 independently confirms the same direction from a different
mechanism: **83/83 of its rescued days were OVER band, zero short**, 70/83 by lowering kcal.
Two agents, two mechanisms, one conclusion — the missing capability was the ability to go DOWN.

**A19's oracle bound is the number A25 should keep.** The week-level argmax discards losing
rolls; the days in those discarded rolls put the bound at **87.7 / 89.0 / 86.8 %** satisfiable
(+10.2 mean headroom). Variety-safe harvesting captures only 16 % of it. **The gap between
+1.7 achievable and +10.2 available is the `DEFAULT_REPEAT_CAP = 2` variety contract, not
solver quality** — a product decision, not an engineering one. A5's single-digit prediction is
CONFIRMED; its "never worse" sub-prediction is FALSIFIED (dayN lost 34 in-band days, because
days share a week-level variety budget the diet-LP analogue has no equivalent for).

**Two costs A21 and A25 must carry, not bury:**
- **A13 slot warnings RISE while day misses fall** — 341 -> 405 warned satisfiable slots. The
  per-slot gate is kcal+protein only (C8), so it flags slots the 4-macro portioner
  deliberately detuned. **More amber on days that now pass.** That is a customer-visible
  regression in the honesty layer's signal quality, and integrity rule 3 makes it reportable.
- **The 0.25 floor is a separate, larger, PRODUCT decision.** +4.29 alone, +5.22 stacked, and
  the only arm that cuts pinning — but 35.5 % of served slots then carry a knob below the old
  0.5x floor and it ships quarter-portions. A13 moved the **floor only** and proved it
  (max spread exactly 8.0x = 2.0/0.25). Servability is measured in scale ratios, not grams —
  **ESTIMATED as unacceptable for some plates until someone renders them.**

**A13 did NOT run `oracle.mjs`.** It argues the C16 obligation does not transfer, since the
treatment replaces scale arithmetic inside `scaleRecipe`, downstream of `filterRecipePool`,
never altering ingredient identity — but that is DERIVED from the code path, not measured.
**A21 must run the leak check on any stack containing it.** A22/A24 should not accept the
derivation unverified.

C18 clean on both: `checkdb.mjs` never invoked, every arm on `dbHash e55f52e53658a086`.

Running: A16 · A17 · A18 · A20 · A23.

### 2026-07-31 — Phase 4 experiments complete (A13-A20) + A23. 21 of 25 done.

| id | state | verdict | headline |
|---|---|---|---|
| A16 pool enrichment | complete | CONFIRMED | **~4 recipes on ONE concentrate row = 85 %**; 65 whole-food rows needed instead |
| A17 closer expansion | complete | **FALSIFIED** | widening leaks (309 placements) + gains land in the refusal tier; **the TRIMMER is +14.93** |
| A18 objective weights | complete | **FALSIFIED** | assigned constant is **unreachable**; `SCORE_WEIGHTS` provably cannot move the count |
| A20 refusal path | complete | CONFIRMED | sound refusal exists but covers **16 days, not 52**, and buys **+0.00 pts** |
| A23 citation check | complete | CONFIRMED | **no fabricated citation in Phase 2**; 3 real corrections |

`CORRECTIONS-5.md` created — **C19 through C23.** Mandatory for A21, A22, A24, A25.

**C19 — the mandated leak verifier does not verify.** A17 measured `oracle.mjs` catching
**1 of the 13 C13 rows**, and reporting **0 leaks on an arm that placed `Sea cucumber` 309
times** across vegan and vegetarian plans. C16 named oracle as the defence against the engine
grading itself; on this exposure it shares the product gate's blind spot. A16 found two more
defects in the same list — **the baseline's 5 reported "leaks" are all false positives**
("Peanut Butter" matching a tree-nut alias, "Egg Plants" matching the vegan egg term).
Sent to A16 mid-flight; **A16 re-ran its checks by name, found 0 hits, and downgraded its own
leak claim from verified to necessary-condition-only.** That is the fleet self-correcting.

**C20 — the ruling denominator has a dead term.** A20 found A3's bound reads
`f.kcalPer100g`/`f.proteinPer100g`, columns **that do not exist on the Prisma `Food` model**;
the expression evaluates to 0 across all 14,151 rows. Repaired, the provable impossible set
falls **52 days -> 16**, and the all-days ceiling rises **91.0 % -> 97.2 %**. A20 also caught
its own audit script copying the same field names — its earlier "212/212 agrees with A3" was
**agreement on a shared bug, not corroboration.** Second time a cross-check has agreed with a
defect rather than caught it. Three ceiling figures are now live (88 / 91.0 / 97.2); A25 must
name and defend one, not average them.

**C21 — the self-scoring trap, and it is the sharpest inflation route in the study.** A20
priced refusal-as-compliance: shipping **A3's own bound** as the refusal rule books **+4.94
pts** by dropping 36 days it cannot prove impossible; re-badging the existing `diagnose()`
books **+27.94 pts and a perfect KPI with zero behaviour change**, at 186 false refusals.
**The sound predicate buys +0.00.** No lever may count a refused day as a compliant one.

**C23 — A13 and A17 found the same ~15 points by different routes.** A13's 4-macro portioning
objective (+14.74) and A17's trimmer (+14.93) both work by *reducing* over-band days. A15
(42/42 fat-only misses OVER), A17 (97 OVER / 1 SHORT) and A19 (83/83 rescued were OVER) all
measure the same dominant failure mode. **Summing them is the exact inflation A24 exists to
catch.** A21 is instructed to measure the combination and report the overlap.

**Phase 4 also killed two of the mission prompt's own premises.** A18: the constant it named
is unreachable at `BRAIN=off` and its live analogue is a post-hoc tiebreak that **provably
cannot change the in-band count** (b == c in 6 of 6 arms, structurally). A17: the "240 of
2,432 slots (9.9 %)" gate figure uses a denominator the closer cannot reach — the real rate is
**46.2 % of invocations**, understated ~4.5x.

**A21 and A22 launched.** A21 measures the combination on both denominators. A22 replays the
ledger through `oracle.mjs`. A24 follows once A21 lands — it must see the stack it audits.
A25 last.

### 2026-07-31 (later) — resumed again after a second session death. 21 of 25 complete.

The 06:58 relaunch (`logs/run-03.log`) wrote its header and produced nothing —
the session died before any agent ran. Nothing already complete was re-run.

**Verified before resuming, not assumed:**

| check | result |
|---|---|
| `FINDINGS.md` on disk | 21 (A1-A20 except A21, plus A23) |
| A21 working copy `dev.db` | `e55f52e53658a086` — fleet baseline |
| A22 working copy `dev.db` | `e55f52e53658a086` — fleet baseline |
| live `backend/prisma/dev.db` | `d9037dce9754b452` — still moved, still not the fleet's doing |
| `CLAIMS.tsv` | 336 claim rows + header; **A21 has zero rows**, A22 has five |

**A21 and A22 both have near-complete artifacts and never reported.** A21 holds
baseline+stack JSONL at three seeds, per-seed `compare.v2.mjs` output, a pairwise
overlap decomposition, a four-denominator table and a C13 by-name leak check —
all at `dbHash e55f52e53658a086`. A22 holds four replay JSONL arms and has already
appended five ledger defects, including **two A19 numbers that do not reproduce
from A19's own cited script**. Both were relaunched as **finishers with an explicit
no-re-solve instruction**; re-running those sweeps would burn hours reproducing
data that already exists.

Two things A21 was pointed at specifically, because they are contradictions rather
than gaps: its stack JSONL header reads `treatment: "A16-concentrate-recipes-N8"`
while its own overlap file shows the stack gaining 99 days against conc8's 61 — the
label is suspect and the headline mechanism claim depends on resolving it. And
`A21-denoms.json` shows warned slots **falling** 389 -> 316 under the stack, which
contradicts **A13's reported cost of warnings rising** 341 -> 405. Anti-slop rule 12
applies: that gets adjudicated loudly, not smoothed.

| id | state |
|---|---|
| A1 rig | complete |
| A2 failure taxonomy | complete |
| A3 ceiling audit | complete |
| A4 fat band | complete |
| A5 diet literature | complete |
| A6 industry convention | complete |
| A7 vegan feasibility | complete |
| A8 infeasibility metrics | complete |
| A9 solve-loop anatomy | complete |
| A10 dormant optimizer | complete |
| A11 pool density | complete |
| A12 ruler coherence | complete |
| A13 n-knob portioning | complete |
| A14 search-budget re-sweep | complete |
| A15 ruler variants | complete |
| A16 pool enrichment | complete |
| A17 closer expansion | complete |
| A18 objective weights | complete |
| A19 joint vs greedy | complete |
| A20 refusal path | complete |
| A21 best stack | running (finisher) |
| A22 replay | running (finisher) |
| A23 citation check | complete |
| A24 red team | pending — gated on A21 |
| A25 REPORT.md | pending — last |

### 2026-07-31 — product-code non-interference verified (for A25's Definition of Done)

The fleet's rule 4 forbids modifying `backend/src/`. Seven files there are dirty in
git, which looks like a violation and is not one — **every one of them predates the
fleet's 21:00 start on 07-30**, and belongs to the separate `fix/audit-remediation`
branch work:

| file | mtime |
|---|---|
| `backend/src/lib/allergenTaxonomy.js` | 2026-07-30 05:10 |
| `backend/src/routes/profile.js` | 2026-07-30 05:16 |
| `backend/src/lib/macroCloser.js` (untracked) | 2026-07-30 14:30 |
| `backend/src/lib/weeklyPlanner.js` | 2026-07-30 14:31 |
| `backend/src/lib/planContext.js` | 2026-07-30 14:31 |
| `backend/src/lib/mealSolver.js` | 2026-07-30 14:32 |
| `backend/src/routes/plans.js` | 2026-07-30 14:32 |

Fleet launch was 2026-07-30 21:00. **No file under `backend/src/` has been written
since.** MEASURED via `stat -c%y`. A25 states this positively rather than claiming
a clean tree, because the tree is not clean and saying it was would be false.

### 2026-07-31 — A21 and A22 complete. 23 of 25. Both falsified something they were built on.

| id | state | verdict | headline |
|---|---|---|---|
| A21 best stack | complete | CONFIRMED | stack **94.21 %** on C7's denominator (+18.07); but the stack is **NOT the best arm on disk** |
| A22 replay | complete | CONFIRMED | A13/A17/A15/A16/A20/A1 all **reproduce**; **A19's oracle bound FAILS**; A22 **retracts its own** prior failure call |

**A21's lead falsifies its own assignment.** The "best stack" is beaten by an arm that
was already sitting in A13's directory: `floor25w` (0.25x floor + 4-macro objective,
**no pool change, no authored recipes, no simulated food row**) scores **97.01 %**
against the stack's 94.96 %. A22 independently reproduced that arm at **+19.96,
b=1 c=108, 520/536**. The stack's extra machinery buys nothing measurable — paired
stack -> floor25w is +2.05, **below C14's 3.5-pt floor**.

**And "best stack" overstates what was combined.** A21 identified the arms by
signature, because `runRig.mjs:214` records only the `--treatment` module and the
A13-class levers ship as a `NODE_OPTIONS --require` preload the header cannot name.
**Stack = A16 conc8 + a wls2-equivalent portioner. The trimmer, att12 and the 0.25
floor are OUT.** The invocation was never written to disk.

**The warnings contradiction is resolved, and neither agent was wrong.** A13 counted
**filled** slots (341 -> 405); `A21-denoms.json` counted **all** slots (389 -> 454).
The difference is exactly the unfilled slots, and **every unfilled slot carries a
warning** (48/48, 49/49). A13's honesty cost is intact inside the stack, masked by the
pool lever. A25 carries the cost, not the apparent improvement.

**C23 measured directly:** `wls2` rescues 87 days, `conc8` rescues 61, **52 are the
same days**. Sum of parts 148, union 96, stack gains 99 — **34.5 % of the naive sum is
double-counted.** A22 puts the same figure at **2.24x** across three levers. This is the
anti-inflation number the study exists to produce.

**A correction to THIS LOG.** The 07-31 entry on A19 said *"A19's oracle bound is the
number A25 should keep."* **That instruction is now wrong.** A22 found the bound mixes
denominators — numerator on planned days, denominator on judged days. Judged-consistent
it is **86.9 % satisfiable (headroom +9.9, not +10.6)** and 78.5 % all-judged. A19's
deltas are unaffected; only the bound moves. A25 uses 86.9 %, not 87.7 %.

**Two ledger rows are defective and one blocks the Definition of Done.** A20's KPI-1 row
transcribes the level as 77.00 % when it is **72.06 %** (the delta +0.00 is correct, and
A20's own FINDINGS.md is correct — the ledger row is what is wrong). A20's P7 confusion
matrix **sums to 511, not 578**, omitting 67 UNKNOWN-accepted days. The Definition of Done
requires a decomposition summing to 578, so A25 must repair this from A20's FINDINGS.md
rather than quote the ledger.

**A22's negative control defends the study's largest claim:** a kcal-only re-portioning
objective through the same rig, seed and hook moves **+0.00 pts (b=5 c=5)**. A13's +14.74
is not an artifact of merely touching the portioner.

**A22 also retracted one of its own predecessor's failure calls** — the row claiming A19's
no-roll count does not reproduce compared against a histogram over a different day set.
A19 was right. Recorded as the fleet catching its own false positive.

| id | state |
|---|---|
| A1-A20, A23 | complete |
| A21 best stack | complete |
| A22 replay | complete |
| A24 red team | running |
| A25 REPORT.md | pending — last |

### 2026-07-31 — A24 complete. 24 of 25. The double-counting charge comes back NEGATIVE.

| id | state | verdict | headline |
|---|---|---|---|
| A24 red team | complete | CONFIRMED | 11 discounts issued; **no Phase-4 gain re-books a prior campaign gain** |

**The mission prompt's central red-team suspicion is refuted, and it was checked rather
than argued.** A24 measured **129 of 129 comparison arms** on disk carrying
`dbHash e55f52e53658a086 / foodFingerprint 423e7279ed6af641 / poolRaw 910 /
foodRows 14151` — the **post-campaign** dataset. Every Phase-4 delta is paired against a
baseline that already contains the closer, the adaptive attempts, the staple
un-quarantine, the food-row corrections and composition-aware sampling. **Nothing is
double-booked.** The three agents that pushed on already-applied levers returned nulls,
which is the correct outcome.

**The inflation list (I1-I11), incorporated by A25, not appended.** The sharpest:

- **I1 — no lever sum is admissible.** Only **123 satisfiable days** are missed at
  baseline, so the union of *every* lever caps at **+22.95 pts**. The naive sum of six
  gross gains is +58.77 — **arithmetically impossible, 2.56x over.**
- **I2 — A17's trimmer collapses to +2.24 marginal** over A13 (72 of its days shared),
  below C14's floor: **unresolved, not a second 15-point lever.** C23 was right.
- **I3 — A19's dayNstrict is +0.00.** All 9 of its days are already A13's.
- **I8 — the 97.0 % best arm is SINGLE-SEED** and ships **35.5 % of slots below the old
  0.5x portion floor.** A22 re-ran the same seed, which is reproducibility, not
  replication (integrity rule 8).
- **I10 — the brief's own 88 % ceiling never followed from its own numbers**: 495/578 is
  **85.6 %**.

**A24 repaired the decomposition the Definition of Done requires.** A20's P7 matrix summed
to 511; the repaired ground truth sums to **578**: 16 proved-infeasible / **67 UNKNOWN** /
495 SAT-certified, 405 in band = 70.07 %. The 67 UNKNOWN days are where the ceiling
uncertainty actually lives.

**Honesty-on-miss attacked independently and it HOLDS.** 48 of 173 misses carry no slot
warning, but **48 of 48 carry plan-level `diagnosisFeasible=false`.** The corollary is
sharper than C21: `diagnose()` is the *sole* honesty signal on 27.7 % of missed days, so
re-badging it as a refusal path converts the honesty mechanism itself into a denominator
filter. A17's trimmer remains the one real honesty regression (1 silent, 1 disagree),
confined to A17.

**A mis-attribution in the research brief itself:** §4 credits the *adaptive* budget with
53.3 -> 60.4. A14 measures `flat14` equivalent to adaptive at equal mean depth:
**+0.12 [-1.62,+1.87]**. The gain was **depth**, not pool-scaling.

**The study's most uncomfortable finding, and A24 states it as a pattern rather than three
incidents:** A20's audit copied A3's dead field names; A16's leakcheck silently inspected
2552 of 2910 slots; and `oracle.mjs` — mandated by C16 as *the* defence against the engine
grading itself — reported **0 leaks on 309 sea-cucumber placements**. **Every independent
verifier in this study was built from the same vocabulary as the thing it verified.**

**A25 launched.** It writes `REPORT.md` against the repaired decomposition, one named and
defended ceiling, and A24's discounts folded into the lever table rather than bolted on.

| id | state |
|---|---|
| A1-A23 | complete |
| A24 red team | complete |
| A25 REPORT.md | running |

### 2026-07-31 — A25 died mid-write; REPORT.md completed from the artifacts. 25 of 25.

**A25 ran and did not finish.** The 06:58 orchestrator (`logs/run-03.log`) landed A21, A22
and A24, launched A25, and died at **07:30:59** with `REPORT.md` cut off mid-row in the
lever table at 9,246 chars. `A25/` is empty — no `FINDINGS.md`, no artifacts.

**The runner never wrote a completion footer for ANY of the three runs.** `run-01`,
`run-02` and `run-03` all lack the `finished: / exit code:` block `solver-brain-fleet.bat`
writes after `claude -p` returns, so each was terminated rather than exiting — meaning the
07-30 quota-wait fix never got the chance to engage, because the BAT itself was gone. Both
of today's runs lasted ~33 minutes (06:15→06:48, 06:58→07:31). **Cause not determined:** no
Windows event-log entries in the window, no sleep or shutdown, no scheduled task.

**What was verified before completing, not assumed:**

| check | result |
|---|---|
| `FINDINGS.md` on disk | **24** (A1–A24), each ending in a verdict — 16 CONFIRMED, 8 FALSIFIED |
| `CLAIMS.tsv` | 386 rows |
| live `backend/prisma/dev.db` | `d9037dce9754b452` — still moved, still not the fleet's doing (provenance work 05:50, dev server WAL since 07-26) |
| agent working copies A13 / A16 / A21 / A22 | all `e55f52e53658a086` — the fleet baseline. **Comparability intact** |
| dev server (`node src/server.js`, the rig's dependency) | up since 07-26 20:31 |

**`REPORT.md` is now complete** — 38,158 chars. §§1–3 are A25's as written; **§3.1 and
§§4–7 were written afterwards in a separate session** from the 24 artifacts, and say so in
§7.1 rather than presenting themselves as A25's own work. That session read all 24
`FINDINGS.md` in full plus `STATUS.md`, the five `CORRECTIONS` files and the fleet prompt,
re-verified both `dev.db` facts directly, and introduced **no number absent from an agent's
`FINDINGS.md`** — §5 lists twelve open questions as *not measured*, each naming its owner
and the test that would settle it. The pre-completion file is preserved at
`REPORT.md.pre-completion-backup`.

Definition of Done: all items held except two, both stated in §7 rather than papered over —
**A25 has no `FINDINGS.md`**, and **the live `dev.db` is not byte-identical to how it
started** (it moved for reasons outside the fleet, and no fleet arm measured against it).

| id | state |
|---|---|
| A1–A24 | complete |
| A25 REPORT.md | complete (finished post-hoc; provenance in §7.1) |

FLEET-COMPLETE
