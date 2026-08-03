# W4-1 — ADVERSARIAL REPRODUCTION OF THE THREE LOAD-BEARING NUMBERS

**All three CONFIRMED. Zero deviations. Not one gap exceeded 0.1 pp — none exceeded 0.00 pp.**

| # | number | recorded | reproduced | Δ | verdict |
|---|---|--:|--:|--:|---|
| 1 | **W1-2 baseline** — Ruler A, satisfiable-judged (n=537) | 77.3% | **77.28%** | 0.00 | **CONFIRMED** |
| | …satisfiable-planned − degenerate (n=553) | 75.0% | **75.05%** | 0.00 | **CONFIRMED** |
| 2 | **W3-1 ruler share** — defensible re-grade | +2.2 … +2.8 | **E35k +2.77 · R35k +2.17** | 0.00 | **CONFIRMED** |
| | …solver share (n=553, 3 seeds) | ≈22 pts | **22.12 pts** | 0.00 | **CONFIRMED** |
| 3 | **W3-7 best-stack** — combined arm (n=1,611) | +14.96 pp | **+14.96 pp** | 0.00 | **CONFIRMED** |
| | …naive sum / overlap lost | +23.84 / 8.88 | **+23.84 / 8.88** | 0.00 | **CONFIRMED** |

Separately measured and reported in **`ruler-delta.md`**: the uncommitted fat
rewrite moves the canonical baseline **75.11% → 79.63% (+4.52 pp)**, decomposing
into a **−1.87 pt stricter ruler** and a **+6.39 pt solver response**.

---

## 0. Environment, and the two substrate traps I had to route around

**`git log -1` before and after this agent's work: `748c524b77c548…` both times.
HEAD did not move.** Working tree at exit carries exactly the entries it carried
at entry, plus my own `fleet/out/W4-1/`. The pre-existing uncommitted work was
**never touched** — `backend/src/lib/bmrEngine.js` still hashes `9978d09e…`,
byte-identical to the copy I took at the start. No stash, no checkout, no revert.

Node v24.13.0 · `BRAIN=off` on every run · **network calls 0 across all 19 runs**,
trapped at `dayDump.mjs:341-346` (http/https/fetch replaced with throwing
counters) and printed in every report — measured, not assumed. No network
primitive appears anywhere in `hook.cjs`, `trimCloser7.js`, `portioner.cjs` or
`dayDumpAlt.mjs`.

### TRAP 1 — the working tree is not byte-clean, and the dirty file is in the ruler

`backend/src/lib/bmrEngine.js` is modified and uncommitted: the fat-prescription
rewrite. **Fat is one of the four macros the ruler grades**, so a naive re-run on
the current tree would have produced different numbers and a false REFUTED.

Handled by reproducing everything at the commit it was recorded at, in the clean
detached worktree `C:/Users/<account>/worktrees/cp-prefix-baseline` @ `962ac88`.
The main tree was never modified.

**The commit choice is provable, not assumed.** W1-2 recorded at `8cd1480`; W3-7
at `962ac88`. `git diff --stat 8cd1480 962ac88 -- backend/src backend/scripts
backend/prisma` is **empty** — solve-relevant source is identical across the two,
so the single `962ac88` worktree is a valid substrate for both. Further,
`bmrEngine.js` is byte-identical at `8cd1480`, `962ac88` **and** `748c524`
(HEAD) — sha `0328fa4d…` at all three. The rewrite exists *only* in the working
tree, so it is cleanly separable.

### TRAP 2 — the shared DB has drifted off canonical, and nobody flagged it

| DB | sha256 | canonical? |
|---|---|---|
| `backend/prisma/dev.db` (main tree, today) | `fb67a37f7f7890e6…` | **NO** |
| `backend/prisma/dev.db.pre-verdict-migration-backup` | `d9037dce…b623a1` | yes |
| worktree `962ac88` copy | `d9037dce…b623a1` | yes |
| `fleet/scratch/W3-7/dev.db` | `d9037dce…b623a1` | yes |

The main tree's DB no longer matches the `d9037dce…` recorded in `state.json` —
consistent with the uncommitted `20260802034419_plan_verdict_persistence`
migration having been applied. **Every measurement in this report used the
canonical `d9037dce…` DB**, hash-verified in each dump header (`DB copy sha256
… MATCH`), food fingerprint `b961ac3a…`, 14,151 foods / 910 recipes.

> **Standing warning for W4-2/W4-3/W5:** any full-fleet run executed in the main
> tree *today* is on a different substrate than every W1/W3 number. This is
> exactly W1-2 §5's rule ("a stored baseline reproduces iff `dbSha256` +
> `foodFingerprint` + `personasSha256` + `poolShape` + solve-relevant source are
> unchanged") firing for real.

---

## 1. W1-2 BASELINE — **CONFIRMED**, byte-exact

**Recorded** (`fleet/out/W1-2/BASELINE.md`): Ruler A satisfiable **77.3%** (537
judged) / **75.0%** (553 planned); Ruler D 86.4% / 83.9%; all-days A 69.8% /
68.0%; canonical denominator **n = 553**.

**Command** (per seed, in the `962ac88` worktree):

```bash
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=<S> --label=armP --agent=W4-1 \
  --out=<repo>/fleet/out/W4-1/daydump-armP-s<S>.jsonl
node fleet/out/W1-2/scoreRulers.mjs <the three dumps> --json=fleet/out/W4-1/scored-armP.json
```

Seeds 424242 / 20260730 / 8675309. **Fresh solve — no stored baseline reused.**

| seed | denominator | n | **Ruler A** | recorded | **Ruler D** | recorded |
|---|---|--:|--:|--:|--:|--:|
| 424242 | satisfiable-judged | 537 | **415 = 77.28%** | 77.3% ✓ | **464 = 86.4%** | 86.4% ✓ |
| | sat-planned − degen | **553** | **415 = 75.05%** | 75.0% ✓ | 464 = 83.9% | 83.9% ✓ |
| | all-planned | 640 | 435 = 67.97% | 68.0% ✓ | 488 = 76.3% | 76.3% ✓ |
| 20260730 | satisfiable-judged | 537 | **418 = 77.84%** | 77.8% ✓ | 463 = 86.2% | 86.2% ✓ |
| | sat-planned − degen | 553 | 418 = 75.59% | 75.6% ✓ | 463 = 83.7% | 83.7% ✓ |
| 8675309 | satisfiable-judged | 537 | **413 = 76.91%** | 76.9% ✓ | 461 = 85.8% | 85.8% ✓ |
| | sat-planned − degen | 553 | 413 = 74.68% | 74.7% ✓ | 461 = 83.4% | 83.4% ✓ |

**Record-level comparison against W1-2's own committed dumps**
(`fleet/out/W4-1/cmpDumps.mjs`, provenance block excluded):

| seed | records | verdict flips b / c | denominator deltas | fields differing |
|---|--:|--:|---|---|
| 424242 | 640 / 640 shared | **0 / 0** | 0.00 pp on all six | `solveMs` only |
| 20260730 | 640 / 640 | **0 / 0** | 0.00 pp on all six | `solveMs` only |
| 8675309 | 640 / 640 | **0 / 0** | 0.00 pp on all six | `solveMs` only |

**1,920 of 1,920 records identical apart from wall-clock timing.** Also
reproduced exactly: unjudged 17, satisfiable total-failures 16, degenerate 1,
closer-fired days 254/259/262, the full 22-bucket binding-miss histogram, the
Ruler A→D flip census (420 / 15 / 68 / 137 at s424242, all 15 A-pass/D-fail being
`carb<carbLo`, and the single `fat<essential` day at s8675309), and the integrity
triple `rulerA-vs-stored 0 · stored-AND 0 · lbm-recon-fail 0`.

### Naming the denominator (the fleet's own §A4 rule)

The brief handed to me reads *"77.3% satisfiable / 75.0% planned, canonical
denominator n=553"*. **Those are two different denominators and only the second
is 553.** Both confirmed, on their own:

- **77.3% = 415/537**, `satisfiable-judged` — drops 16 satisfiable total-failure days.
- **75.0% = 415/553**, `satisfiable-planned − degenerate` — W1-2's recommended canonical.

`scoreRulers.mjs` as shipped prints `satisfiable-planned 415/554 = 74.9%`
(n = 554, *including* the degenerate zero-slot day p233). The canonical 553 row is
derived by subtracting it. 415/554 = 74.91%, 415/553 = 75.05% — a 0.14 pp gap
that is purely which of two adjacent denominators you name. Not a discrepancy;
recorded so nobody re-derives it as one.

### A6 self-scoring trap — checked, inert

`A1/rig/schema.mjs:83` drops zero-slot days from `judged`, so refusing more days
raises the reported rate. Refused days (satisfiable, slots requested, nothing
filled) are **48 pooled in every arm I measured** — armP, armF, and all eight
W3-7 arms. No arm banks a point by refusing. The trap is real and it did not fire
on any number in this report.

---

## 2. W3-1 RULER SHARE — **CONFIRMED**, all 20 rulers

**Recorded**: ruler ≈ **+2.2 to +2.8 pts**, solver ≈ **22 pts**; level 75.11%,
gap 24.89; ruler-Z ceiling +16.82; solver-irreducible 8.08.

**Command**, run twice — once on W3-1's own inputs, once on my fresh solve:

```bash
node fleet/out/W3-1/scoreRulerSet.mjs <3 dumps> --json=fleet/out/W4-1/ruler-share-{orig,armP}.json
```

| quantity | recorded | on W1-2's dumps | **on my fresh Arm P dumps** |
|---|--:|--:|--:|
| level A, n=553 pooled | 75.11% | 75.11% | **75.11%** |
| gap to 100% | 24.89 | 24.89 | **24.89** |
| ruler Z (arithmetic ceiling) | +16.82 | +16.82 | **+16.82** |
| solver-irreducible (kcal/protein) | 8.08 | 8.08 | **8.08** |
| **E35k** (best defensible) | **+2.77** | +2.77 | **+2.77** (b/c 43/89) |
| **R35k** | **+2.17** | +2.17 | **+2.17** (b/c 97/133) |
| B / D / A15 / NOFAT | +9.34 / +8.56 / +5.36 / +9.40 | same | **same** |
| F (carb-floor repair) | −0.30 | −0.30 | **−0.30** (b=5, c=0) |
| cross-seed spread A / D / R35k / E35k | 0.91 / 0.55 / 0.73 / 2.35 | same | **same** |
| D3 integrity | 1,920/1,920, 0 mismatches | 0 | **0** |

**All 20 rulers × 6 denominators × 3 seeds reproduce identically on both input
sets.** The headline sentence regenerates verbatim from the tool.

Decomposition confirmed: 24.89 = **8.08** solver-irreducible + **16.82** ruler-eligible
ceiling; largest defensible re-grade **+2.77**; therefore ruler share ≈ +2…+3 and
**solver share = 24.89 − 2.77 = 22.12 pts**.

Secondary D4 output figure also reproduced to the decimal: **Ruler A grades 48.3
days/seed compliant (of 415.3 satisfiable passes = 11.6%) whose fat exceeds AMDR's
35 %E.** (An earlier count of 54.0/seed in my working notes was the *all-planned*
arm, not the satisfiable arm — reconciled, not a discrepancy.)

---

## 3. W3-7 BEST-STACK — **CONFIRMED** twice over

**Recorded**: portioner +11.24, trim +12.60, naive sum +23.84, **measured
combined +14.96**, 8.88 pp (37%) lost to overlap, 59% overstatement, residuals
+3.72 / +2.36, all-planned 68.07% → 81.56%. Measured on the **pre-fix tree at
`962ac88`**.

W3-7 was the agent that was killed mid-run and whose report was assembled a day
later from artifacts on disk. That makes it the one number most in need of an
independent re-run, so I did both:

**(a) Re-derivation from its own dumps**, with my own scorer
(`poolArms.mjs`, not W3-7's `score.mjs`) —
`fleet/out/W4-1/pooled-W37-original.json`.

**(b) A LIVE RE-RUN — 12 full-fleet solves from scratch** in the `962ac88`
worktree, using the recorded harness:

```bash
BRAIN=off node fleet/scratch/W3-7/runAll.mjs --arms=base,c14_c2,trim,c14_c2_trim
# spawns: node --require fleet/scratch/W3-7/hook.cjs backend/scripts/qc/dayDump.mjs \
#           --seed=<S> --agent=W3-7 --label=<arm> --quiet --out=dump-<arm>-s<S>.jsonl
```

Harness staged into the worktree with sha-verified copies of `hook.cjs`,
`trimCloser7.js`, `runAll.mjs`, `score.mjs`, `W3-2/portioner.cjs`,
`W3-2/macroViolation.cjs` and the canonical scratch DB.

| arm | recorded (n=1,611) | **(a) re-derived** | **(b) live re-run** |
|---|--:|--:|--:|
| base | 1,246 · 77.34% | 1,246 · 77.34% | **1,246 · 77.34%** |
| c14 | 1,350 · 83.80% (+6.46) | +6.46 | — |
| c2 | 1,375 · 85.35% (+8.01) | +8.01 | — |
| **c14+c2 portioner** | 1,427 · 88.58% (**+11.24**) | **+11.24** | **1,427 · 88.58% (+11.24)** |
| **trim** | 1,449 · 89.94% (**+12.60**) | **+12.60** | **1,449 · 89.94% (+12.60)** |
| **c14+c2+trim COMBINED** | 1,487 · 92.30% (**+14.96**) | **+14.96** | **1,487 · 92.30% (+14.96)** |
| b20 | 1,282 · 79.58% (+2.23) | +2.2346 | — |
| c14+c2+b20 | 1,439 · 89.32% (+11.98) | +11.98 | — |

Additivity, live re-run vs recorded — every figure to 2 dp:

| | recorded | **live re-run** |
|---|--:|--:|
| naive sum | +23.84 | **+23.84** |
| measured combined | +14.96 | **+14.96** |
| lost to overlap | 8.88 (37%) | **8.88 (37%)** |
| overstatement of the naive sum | 59% | **59%** |
| residual trim \| portioner | +3.72 | **+3.72** |
| residual portioner \| trim | +2.36 | **+2.36** |
| b20 on top of the portioner | +0.74 | **+0.74** |
| all-planned base → combined | 68.07% → 81.56% | **68.07% → 81.56%** |
| per-seed overlap loss | +8.94 / +8.75 / +8.94 | **+8.94 / +8.75 / +8.94** |

**Record-level, live re-run vs the killed run's dumps** (seed 424242, all four arms):
640/640 shared, **0 verdict flips**, 0.00 pp on all six denominators, and the only
differing field is `solveMs`. The killed run's artifacts were sound; W3-7's
recovered write-up is an accurate reading of them.

Paired significance on the canonical denominator (n=1,659): portioner b=39/c=220,
trim b=10/c=213, **combined b=12/c=253** — all clear the A5 floor by ~8×.

### One denominator caveat, not a deduction

**+14.96 pp is on `satisfiable-judged`, n = 1,611** — the A6 denominator. On
W1-2's *recommended canonical* n = 1,659 the same arm is **+14.52 pp**, and on
all-planned n = 1,920 it is **+13.49 pp**. All three are in W3-7's own artifacts
(the first two columns of its table); the headline simply quotes the first. Since
refusals are constant at 48 across all eight arms, the A6 trap is not inflating
it — but the number should travel with its denominator.

---

## 4. What surprised me

1. **The reproduction is exact to a degree I did not expect.** Across 1,920
   baseline records + 2,560 W3-7 records, at a different commit, in a different
   working tree, at a different git dirtiness state, the only field that ever
   moved was `solveMs`. W1-2's claim A3 ("the instrument is exactly
   deterministic") holds under harder conditions than it was tested on.
2. **`personasSha256` is checkout-dependent and therefore not an identity.** The
   worktree's `personas.jsonl` hashes `8d98e2e0…`, the main tree's `e564b1dd…`.
   The worktree file is 294,846 bytes vs 294,596 — exactly **250 extra bytes, one
   CR per persona**: a CRLF checkout. Strip the CRs and both hash `e564b1dd…`,
   and `JSON.parse` tolerates the trailing CR so the solves are identical. Same
   effect on `bmrEngine.js` (`a948db12…` in the worktree vs `0328fa4d…` from
   `git show`). **An agent comparing `personasSha256` across a worktree will
   wrongly conclude the population changed.** Compare CR-stripped, or compare
   parsed content.
3. **The shared DB has drifted off canonical and nothing announced it** (Trap 2
   above). The canonical bytes survive in
   `dev.db.pre-verdict-migration-backup` — do not delete it.
4. **The fat rewrite makes the ruler stricter, not looser.** I expected a
   loosening (that is what every prior ruler proposal did). On identical plates it
   *costs* −1.87 pts, with b=115 vs c=84 — the b-term is the **larger** one, the
   exact inverse of the B/D/A15 inflation signature. The +4.52 net is bought
   entirely by the solver, not by the grader. Detail in `ruler-delta.md`.
5. **The combined arm's most alarming-looking telemetry is actually its best
   evidence** — I nearly filed it as an open defect, so it is worth recording
   correctly. `stats-c14_c2_trim-*.json` reports
   `reconLiveVsReplay {n: 4020, agree: 547}` — **13.6% agreement**, against
   **100%** (5734/5734, 5699/5699, 5542/5542) on `trim` alone. Both reproduced
   exactly in my re-run, all three seeds.

   That counter is not a fault: it is a *deliberate check* on the one edit W3-7
   made to W3-4's trimmer (`trimCloser7.js:444-466`). W3-4 reconstructed each
   slot's target by replaying `weeklyPlanner.js:889-931`, which walks slots in
   **array order**; C2 (smallest-first) re-sorts `openIdx`, so the carry-forward
   runs in a different order and the replay stops matching. W3-7 switched to
   reading the target the solver *actually* solved against and kept the replay
   only as telemetry. The 13.6% is that divergence being measured.

   **The useful reading: a naive C2 + TRIM stack that kept W3-4's replay would
   have mis-derived the slot target on ~86% of slots and reintroduced the E4
   stale-warning defect in the alarming direction.** W3-7's single code change
   was load-bearing and the telemetry proves it fired. Anyone implementing this
   stack for real must carry that change, and should treat `reconLiveVsReplay`
   near 100% on a C2-enabled arm as the signal that they have *not*.

---

## 5. Artifacts

```
fleet/out/W4-1/VERDICTS.md                       this file
fleet/out/W4-1/ruler-delta.md                    the fat rewrite's effect on scoring
fleet/out/W4-1/daydump-armP-s{424242,20260730,8675309}.jsonl   + .report.md   W1-2 reproduction (fresh solve)
fleet/out/W4-1/daydump-armF-s{…}.jsonl           + .report.md   fat-rewrite arm
fleet/out/W4-1/daydump-selfcheck-s424242.jsonl   + .report.md   override-plumbing self-check
fleet/out/W4-1/scored-orig.json  scored-armP.json               W1-2 scoreRulers output
fleet/out/W4-1/ruler-share-orig.json  ruler-share-armP.json     W3-1 scoreRulerSet output
fleet/out/W4-1/pooled-W37-original.json                         W3-7 re-derived from its own dumps
fleet/out/W4-1/pooled-W37-rerun.json                            W3-7 LIVE re-run, 12 solves
fleet/out/W4-1/pooled-fatrewrite.json                           armP vs armF pooled
fleet/out/W4-1/regrade-s{…}.json                                ruler / solver decomposition
fleet/out/W4-1/cmp-W12-vs-armP-s{…}.json                        record-level, W1-2 vs my re-run
fleet/out/W4-1/cmp-W37-{arm}-s424242.json                       record-level, W3-7 vs my re-run
fleet/out/W4-1/cmp-selfcheck.json                               record-level, alt harness vs stock
fleet/out/W4-1/cmpDumps.mjs  poolArms.mjs  regrade.mjs  dayDumpAlt.mjs        my instruments
fleet/out/W4-1/bmrEngine.OLD.js  bmrEngine.NEW.js                            both engine versions
```

Live re-run day-dumps (24 files, ~82 MB) remain at
`C:/Users/<account>/worktrees/cp-prefix-baseline/fleet/scratch/W3-7/` — outside
the repo, as scratch. Every number above is recomputable from the committed JSON.

**No product source was modified in any tree.** `git status --porcelain --
backend/src frontend/src` in the main tree returns exactly the two pre-existing
entries (`bmrEngine.js`, `PlanTab.jsx`) that were there before this agent started,
both byte-unchanged. The worktree carries only untracked files under `fleet/`.
