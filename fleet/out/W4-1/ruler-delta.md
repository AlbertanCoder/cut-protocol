# W4-1 — RULER DELTA: what the uncommitted fat rewrite does to compliance scoring

**The number nobody had.** `backend/src/lib/bmrEngine.js` is modified and
uncommitted on the working tree: fat moves from a fixed `lbmLb × 0.34…0.40`
g/lb-LBM band to an energy-anchored share of the calorie target
(`FAT_PCT_ENERGY_MID = 0.25`, half-width `3/37`, floored at
`ESSENTIAL_FAT_PER_LB_LBM = 0.30 × lbmLb` via a new `fatBandFor`). Fat is one of
the four macros the compliance ruler grades, and carbs are the leftover, so
**this edit moves the ruler under every number the fleet has published.**

> ⚠️ **This measurement is NOT the W1-2 / W3-1 / W3-7 reproduction.** Those are
> in `VERDICTS.md` and were all taken with the **stock** `bmrEngine.js`. Nothing
> below may be quoted as a correction to them. Both arms here are labelled with
> their bmrEngine sha256, always.

## Isolation — why this is the rewrite and nothing else

`bmrEngine.js` is **byte-identical at `8cd1480` (W1-2's commit), `962ac88`
(W3-7's commit) and `748c524` (HEAD)** — sha `0328fa4d…` at all three. The only
version that differs is the uncommitted working-tree copy, sha `9978d09e…`. So
the rewrite can be isolated exactly, with no commit-range confound.

Both arms run in the clean detached worktree at `962ac88`
(`git status --porcelain` = 1 untracked dir, no tracked modifications), on the
**canonical DB `d9037dce…b623a1`** (food fingerprint `b961ac3a…`, 14,151 foods /
910 recipes), same 250 personas, same seeds, same RNG, same pool shape (route,
`applyFilterStack` ON). `BRAIN=off`; network calls **0**, trapped not assumed.

| arm | bmrEngine | sha256 | what it is |
|---|---|---|---|
| **armP** | committed | `0328fa4d…` | the tree every fleet number was measured on |
| **armF** | uncommitted working copy | `9978d09e…` | the fat rewrite |

The swap is done by `fleet/out/W4-1/dayDumpAlt.mjs`, a copy of
`backend/scripts/qc/dayDump.mjs` whose **only** difference is a `--bmr=<path>`
override plus a provenance stamp (`diff` against the original is 3 hunks, all
shown in `VERDICTS.md`). `bmrEngine` has three relative sibling requires
(`activityData`, `dates`, `bmrCitations`, all unchanged `962ac88..HEAD`), so
each version is loaded from a probe directory under `fleet/scratch/W4-1/` with
one-line shims re-exporting the worktree's real siblings. **Nothing under
`backend/src/**` was written in either tree.**

**Instrument self-check.** `dayDumpAlt.mjs --bmr=<shimmed OLD copy>` vs stock
`dayDump.mjs`, seed 424242: **640/640 records identical, 0 verdict flips**, the
only differing field being `solveMs` (wall-clock). The override plumbing
contributes exactly zero, so every difference below is the rewrite.

## What actually moved

Per-persona targets, pooled over 3 seeds (n = 1,920 day-records):

| target field | records changed |
|---|--:|
| `kcal` | **0** |
| `proteinLo` / `proteinHi` | **0** |
| `keto` flag | **0** |
| `fatLo` / `fatMid` / `fatHi` | 611 / 612 / 601 of 640 per seed |
| `carbLo` / `carbMid` / `carbHi` | 545 of 640 per seed |

Energy and protein are untouched; fat moves on 96% of days and carb (the
leftover) on 85%. Illustrative, one 200 lb / 20% BF male (LBM 160 lb):

| targetKcal | OLD fat band | NEW fat band | OLD carbMid | NEW carbMid |
|---:|---|---|---:|---:|
| 3,200 | 54–64 g | 82–96 g | 451 | 384 |
| 2,400 | 54–64 g | 62–72 g | 251 | 233 |
| 2,000 | 54–64 g | 51–61 g | 151 | 158 |
| 1,600 | 54–64 g | 48–52 g (floor binds) | 51 | 72 |

The old band is **constant across a 2× calorie range** — that is the defect the
rewrite targets.

## THE HEADLINE — and it decomposes the opposite way to expectation

A full re-run confounds two things: the rewrite changes what the ruler **grades
against**, and it changes what the solver **aims at**. They are separated here by
grading the OLD run's *achieved* macros (identical plates, identical food)
against the NEW targets — `fleet/out/W4-1/regrade.mjs`, using the product's own
`mealSolver.dayTolerance` / `dayInTolerance`, not a transcription.

*Control: re-grading OLD plates against OLD targets reproduces the stored
verdict on **0 mismatches** across all judged records, all 3 seeds.*

Pooled over seeds 424242 / 20260730 / 8675309:

| denominator | n | armP | REGRADE<br>(new ruler, old plates) | armF<br>(re-solved) | **ruler-only** | **solver response** | **TOTAL** |
|---|--:|--:|--:|--:|--:|--:|--:|
| all-planned | 1,920 | 68.07% | 65.83% | 71.93% | **−2.24** | +6.09 | **+3.85** |
| judged | 1,869 | 69.93% | 67.63% | 73.89% | −2.30 | +6.26 | +3.96 |
| **satisfiable-planned − degenerate (CANONICAL)** | **1,659** | **75.11%** | **73.24%** | **79.63%** | **−1.87** | **+6.39** | **+4.52** |
| satisfiable-judged | 1,611 | 77.34% | 75.42% | 82.00% | −1.92 | +6.58 | +4.66 |

> **The new ruler is HARDER, not looser.** On identical plates it costs
> **−1.87 pts** (canonical n=1,659). The entire +4.52 gain — and more — comes
> from the solver being handed a target it can actually reach: **+6.39 pts.**

Per seed on the canonical denominator, armP → armF: 75.05→79.75, 75.59→79.75,
74.68→79.39 — **+4.70 / +4.16 / +4.70**. Real at every seed against W1-2's
0.9-pt cross-seed noise and the ≥3.5-pt MDE for churning treatments; the paired
total step clears the A5 floor at every individual seed
(|b−c| = 26/23/26 vs floors 14.67/15.06/16.86).

### This is a re-calibration, not an inflation event

W3-1's own test: *"a ruler change that gains points and whose b-term is zero
should be treated as an inflation event until proven otherwise; a ruler change
whose b-term is a third of its c-term is a re-calibration."*

Ruler step, pooled, canonical n=1,659: **b = 115** (days that passed and now
fail), **c = 84** (days that failed and now pass), net **−31**, |b−c| = 31 vs
A5 floor 27.65 — clears pooled, does not clear at any single seed. **b/c = 1.37.**
Not merely two-sided: the b-term is the *larger* one. The rewrite fails **more**
of the plates the app already ships than it rescues. Nothing about it resembles
B / D / A15, whose b-terms are ~0 by construction.

Flip causes (pooled): rescued by fat 68 · carb 16 · both 0 ‖ lost by fat 96 ·
carb 13 · both 6. The action is on the fat axis in both directions.

**A6 trap check.** Refused days (satisfiable, slots requested, nothing filled)
are **48 in both arms**. Neither arm buys a point by refusing more, so
`schema.mjs:83`'s self-scoring hole is inert for this comparison. The `judged`
and `planned` rows above move together, which is the signature of that.

## The nutritional side — the reason to ship it, independent of the points

W3-1's D4 finding reproduced exactly on armP and then re-measured on armF
(satisfiable arm, per seed):

| | armP | armF |
|---|--:|--:|
| compliant days / seed | 415.3 | 440.3 |
| …whose fat exceeds **AMDR 35 %E** | **48.3 (11.6%)** | **35.0 (7.9%)** |
| of those, non-keto (all-planned arm) | **18.0 / seed** | **0.3 / seed** |
| prescribed non-keto targets above AMDR 35 %E (n=232) | 9 | **1** |
| prescribed non-keto targets below AMDR 20 %E (n=232) | **55** | **0** |
| median fat %E of compliant non-keto days | 24.9% | 26.7% |

*(48.3 / 415.3 = 11.6% is W3-1's published D4 output number, reproduced to the
decimal. The residual 35.0 under armF is **keto**, whose high fat %E is the
diet's definition — the rewrite deliberately exempts the keto branch.)*

**The rewrite moves the prescription inside AMDR: 55 non-keto targets that were
below 20 %E become 0, and non-keto compliant days above 35 %E fall from 18.0 to
0.3 per seed.** That is a correctness result, and it is why the −1.87-pt ruler
cost is the right trade rather than a regression.

## What this means for every published fleet number

1. **No fleet number is refuted.** W1-2, W3-1 and W3-7 all reproduce exactly on
   the stock engine (`VERDICTS.md`). The rewrite is a *future* substrate, not a
   correction to the past one.
2. **Every absolute level shifts by roughly +4.5 pts when the rewrite lands**
   (canonical denominator). The baseline becomes ≈ **79.6%**, not 75.1%.
3. **The 24.89-pt gap becomes ≈ 20.4 pts**, so W3-1's decomposition must be
   re-run — its 16.82-pt ruler ceiling and 8.08-pt solver-irreducible share are
   both measured against fat/carb bands that have moved.
4. **W3-7's +14.96 must be re-measured**, exactly as its own header warns. It was
   measured against a 75.11% base; the base is now ≈79.63% and the levers' target
   pool has changed shape (fat-over was 82 of 82 one-sided on armP).
5. **W3-1's recommended instruments are partly overtaken.** E35k (+2.77) and
   R35k (+2.17) exist to pull the *graded* fat ceiling toward AMDR. The rewrite
   already moves the *prescription* there (55 → 0 below 20 %E; 9 → 1 above 35 %E),
   so those two must be re-priced on the new bands before anyone stacks them.

## Artifacts

```
fleet/out/W4-1/dayDumpAlt.mjs            the --bmr override harness (3-hunk diff vs dayDump.mjs)
fleet/out/W4-1/bmrEngine.OLD.js          0328fa4d…  (== 8cd1480 == 962ac88 == HEAD)
fleet/out/W4-1/bmrEngine.NEW.js          9978d09e…  (uncommitted working copy)
fleet/out/W4-1/daydump-armP-s{seed}.jsonl        stock engine, 3 seeds
fleet/out/W4-1/daydump-armF-s{seed}.jsonl        fat rewrite, 3 seeds
fleet/out/W4-1/daydump-selfcheck-s424242.jsonl   override plumbing self-check
fleet/out/W4-1/regrade.mjs -> regrade-s{seed}.json    the 3-arm decomposition
fleet/out/W4-1/cmpDumps.mjs -> cmp-armP-vs-armF-s{seed}.json
fleet/out/W4-1/poolArms.mjs -> pooled-fatrewrite.json
```

```bash
# armP (stock)
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=424242 --label=armP --agent=W4-1 \
  --out=<repo>/fleet/out/W4-1/daydump-armP-s424242.jsonl          # run in the 962ac88 worktree

# armF (fat rewrite)
BRAIN=off node fleet/out/W4-1/dayDumpAlt.mjs --seed=424242 --label=armF --agent=W4-1 \
  --bmr=<worktree>/fleet/scratch/W4-1/libNEW/bmrEngine.js \
  --out=<repo>/fleet/out/W4-1/daydump-armF-s424242.jsonl

# decomposition
node fleet/out/W4-1/regrade.mjs --old=…armP-s424242.jsonl --new=…armF-s424242.jsonl \
  --json=fleet/out/W4-1/regrade-s424242.json
```
