# Adaptive TDEE — methodology

**Status:** shipped, v1 (`adaptive-expenditure-1.0`)
**Code:** `backend/src/lib/expenditureEstimator.js` (pure math) ·
`backend/src/lib/adaptiveTarget.js` (app seam) ·
`backend/tests/expenditureEstimator.test.js` (32 tests) ·
`backend/scripts/benchmarkAdaptiveTdee.js` (self-benchmark) ·
`backend/scripts/verifyAdaptiveTdee.js` (live fixture)
**Screen:** Engine → §2b "Adaptive burn — what your intake and your scale say"

This document exists so a stranger can check the work: the model, every
assumption, the smoothing, the measured error, and the ways it is known to be
wrong. If something here disagrees with the code, the code is the bug.

---

## 1. The problem with what came before

Before this, Cut Protocol re-derived your calorie target on every weigh-in by
feeding the newest weight back into the BMR formulas:

```
weight changes → BMR formulas re-run → TDEE = BMR × occupation + training → target
```

That is a **point substitution into a population equation**. It updates, but it
cannot *learn*. If the formula thinks you burn 2,500 and you actually burn
2,900, this loop returns 2,500 forever — a slightly different 2,500 as your
weight drifts, but never 2,900. The scale was being used as an input to the
formula rather than as evidence against it. It was also an automatic,
unannounced target change: not logged, not visible, not reversible.

## 2. The model

Conservation of energy over a window:

```
intake − expenditure = ρ · (rate of change of body mass)
```

Rearranged, with the weight trend measured rather than assumed:

```
expenditure = mean logged intake − ρ · (weight-trend slope, kg/day)
```

- `ρ = 7,716 kcal/kg` (3,500 kcal/lb × 2.20462 — the same Wishnofsky constant
  `bmrEngine.js` already uses to turn a lb/week rate into a daily deficit, so
  the two halves of the app cannot disagree).
- The slope is **negative when losing**, so `− ρ · slope` is positive and
  expenditure comes out above intake. The sign convention is asserted in both
  directions by unit test.

The **reconciliation** shown on screen is this same identity, arranged as
predicted-vs-actual:

| | |
|---|---|
| what the formula predicted the scale would do | `(mean intake − formula TDEE) / ρ × days` |
| what the scale trend actually did | `slope × days` |
| the gap | the difference, in kg and in kcal/day |

That gap **is** the correction. It is not a heuristic nudge; it is the
arithmetic difference between the model's prediction and the observation, and
`gap kcal/day = (data estimate − formula TDEE)` is asserted by unit test.

## 3. Smoothing — how the two series are read

### Weight → trend slope

Robust, exponentially weighted linear regression over up to **56 days**:

- **Exponential weight**, half-life **21 days**: `w = 0.5^((today − day)/21)`.
  A rolling average would lag real change (metabolic adaptation, a new job); a
  short window would be all noise. Exponential weighting tracks change while
  still using old data at reduced weight.
- **Huber reweighting** (k = 1.345, 4 IRLS passes) on top of that. One
  sodium-loaded Saturday gets down-weighted, never deleted. Unit test: a
  synthetic +2.2 kg spike moves the final expenditure estimate by <120 kcal.
- **Never endpoint differencing.** Two weights, however far apart, carry two
  independent water errors. A regression over every point in the window is the
  minimum-variance alternative.
- **Robust residual scale** (1.4826 × MAD), floored at 0.10 kg — no real scale
  and real body is quieter than that, and a fake-quiet series would otherwise
  produce a fake-tight error bar.

### Intake → mean

Exponentially weighted (same half-life) **Huber-robust** mean over the logged
days, with two protections:

- **Unlogged days are never zero.** They are excluded from the mean and charged
  as uncertainty (§4). Zero-filling would be catastrophic: it drives estimated
  expenditure down, which drives the target down, which is the exact direction
  that hurts a user.
- **Partial logs are detected and dropped.** A day logged below 50% of the
  window's median logged intake is read as "breakfast entered, rest forgotten",
  not as a genuine near-fast. Such days are removed from the mean and counted
  as *unlogged* — so they widen the error bar instead of corrupting the point
  estimate. This was found by a failing unit test: a single 300 kcal partial
  day pulled a 2,400 kcal mean down to 2,307, a 93 kcal error in the dangerous
  direction.

## 4. Uncertainty — five terms, added in quadrature

| term | what it is |
|---|---|
| `weightTrendKcal` | `ρ × SE(slope)` — scale/water noise, autocorrelation-corrected |
| `intakeMeanKcal` | SE of the weighted intake mean |
| `unloggedDaysKcal` | `500 × (1 − effective coverage)` — bias risk from days you didn't log |
| `tissueCompositionKcal` | `0.10 × ρ × |slope|` — we do not know *your* ρ |
| `modelErrorKcal` | flat 75 — the linear balance model is itself an approximation |

**Autocorrelation correction.** Water weight carries day to day. Positively
autocorrelated residuals make the textbook regression SE too narrow. The
lag-1 autocorrelation φ is estimated from the residuals themselves (over
consecutive *calendar-day* pairs only), bias-corrected by `+1/n_pairs`
(Marriott–Pope), clamped to [0, 0.9], and the slope variance inflated by
`(1+φ)/(1−φ)`, capped at 4×. Both φ and the inflation factor are shown on the
Engine screen.

This correction exists because the self-benchmark caught the problem: the
nominal 68% interval was covering only ~54% of cases. See §7.

## 5. Shrinkage — why a weak signal moves the target only a little

The estimate is combined with the formula TDEE as a Bayesian prior, weighted by
precision:

```
E_posterior = (prior/σ_prior² + data/σ_data²) / (1/σ_prior² + 1/σ_data²)
```

`σ_prior = 497 kcal`. That is not invented: published static prediction
equations have a **median absolute error of ~335 kcal**, and for a normal error
distribution `median|e| = 0.6745σ`, so `σ = 335/0.6745 ≈ 497`. Using the
published figure keeps the shrinkage auditable.

The consequence is the behaviour you want for free: thin or noisy data →
`σ_data` large → the estimate stays near the formula; clean 6-week data →
`σ_data` ≈ 150 → the data carries ~90% of the weight. The screen shows that
percentage.

## 6. When it refuses to answer

Hard gates. Below **any** of these the status is `insufficient`, no number is
produced, and the target falls back to the formula:

| gate | value |
|---|---|
| days of overlapping weight + intake data | ≥ 21 |
| weigh-ins in the window | ≥ 14 |
| complete logged days | ≥ 14 |
| effective logging coverage | ≥ 60% |
| days since last weigh-in | ≤ 10 |

Past the gates, `provisional` until 28 days / 21 weigh-ins / 80% coverage /
σ_data ≤ 250, then `confident`. Both statuses are applied to the target — the
shrinkage already damps a weak signal — but the label is shown either way.

**The 21-day floor was set by measurement, not taste.** At 14 days the
estimator's median error was 289 kcal against a 350 kcal static baseline (a
marginal win), and the replayed adjustment ledger showed it moving a real
target by **+651 kcal one week and −460 the next**. A number that unstable is
worse than no number. Raising the floor to 21 days removed the whipsaw
entirely (the same fixture then moved +219, +23, +57, +87 as it converged).

Two more rails:

- **±30% deviation cap.** The estimate may not claim the formula is more than
  30% wrong. A larger apparent gap is far more likely a broken scale or a
  broken food log than a metabolism that far off — the screen says so.
- **The safety floor is untouched.** `max(RMR×0.95, 1500 M / 1200 F, user
  floor)` still clamps the target, and the floor block is shown, never hidden.

## 7. Self-benchmark — the actual measured error

`node backend/scripts/benchmarkAdaptiveTdee.js --users 1000`

1,000 synthetic users per scenario, seeded and reproducible. Each has a **known
true expenditure**; the estimator sees only what a real user would produce.

**The simulated world** (disagree with any specific number — they are all knobs
in the script header):

- true expenditure `= formula TDEE + N(0, 497)` — calibrated so the static
  baseline reproduces its published ~335 kcal median error *by construction*.
  The static column is the reference point, not a discovery.
- body mass moves by `(intake − expenditure)/ρ_true`, with
  `ρ_true = 7716 × N(1, 8%)` — the estimator's fixed ρ is deliberately wrong
- observed weight `= mass + AR(1) water (φ=0.7, σ=0.45 kg) + 5% sodium spikes
  (~1 kg) + N(0, 0.1) scale noise`
- weigh-ins on ~85% of days; food logged on ~90%, of which ~5% are partial logs;
  reported intake carries `N(0, 120)` noise
- **open loop**: intake follows a fixed target, so the measured error is the
  estimator's, not a feedback artefact

### Scenario A — honest logging, stable metabolism

median absolute error, kcal/day:

| days | applied | adaptive | p90 | static baseline | p90 | 68% CI actually covers |
|---:|---:|---:|---:|---:|---:|---:|
| 14 | 0% | *withheld* | — | 352 | 817 | — |
| 21 | 76% | **205** | 472 | 352 | 834 | 60% |
| 28 | 100% | **155** | 387 | 359 | 849 | 65% |
| 42 | 100% | **121** | 308 | 378 | 882 | 67% |
| 56 | 100% | **93** | 271 | 394 | 917 | 72% |

**Headline: 155 kcal median absolute error at 28 days, against 359 kcal for the
static formula on the same users.** Reference points: MacroFactor publishes
~135 kcal at 3–4 weeks, static formulas ~335 kcal. So this lands between the
two, closer to the adaptive reference — on synthetic data, which is the honest
caveat attached to every number in this table.

### Scenario B — 8% metabolic adaptation across the window

155 → **157** at 28 days, **126** at 42. The exponential half-life keeps it
tracking; there is a small lag, visible as the flattening of the improvement
curve versus scenario A.

### Scenarios C and D — systematic under-reporting

This is the important honest result, and it is a **known limitation, not a bug**:

| | 28 days: vs TRUE burn | 28 days: vs burn in *reported* units |
|---|---:|---:|
| C — 15% under-report | **290** | **179** |
| D — 25% under-report | **453** | **184** |

If you log 15% less than you eat, the estimator returns an expenditure ~15%
low. It cannot do otherwise: under-reporting and low expenditure are
*observationally identical* from intake + weight alone.

But look at the right-hand column. What it recovers accurately is **expenditure
expressed in the units you log in** — and that is precisely the quantity a
target must be set in. Set a target of "2,100 as you log it" for someone who
under-logs 15%, and they eat 2,470, which is exactly the deficit intended. The
weight trend still comes out right. What is *not* right is the displayed burn
number, which will read low. The screen therefore never claims the number is
your metabolic rate; it says "what your intake and your scale say".

### Interval calibration — measured, and imperfect

The nominal 68% interval empirically covers **60% at 21 days, 65% at 28, 67% at
42, 72% at 56**. It is **mildly optimistic at short windows**. The
autocorrelation correction and the model-error floor were both added because
the benchmark measured this (54% before, 65% after at 28 days); the residual
gap is not fully closed. Read the band as indicative, not as a guarantee.

### Live end-to-end check

`node backend/scripts/verifyAdaptiveTdee.js` builds a throwaway 45-day account
whose true burn is 380 kcal above the formula:

```
formula TDEE 2,510  ·  true burn 2,948
recovered      2,919   → error  29 kcal
formula-only          → error 438 kcal
Profile.targetKcal in DB = 2,419 = the number on screen
```

## 8. Known failure modes

1. **Systematic under-reporting is invisible.** §7 C/D. Mitigation: the
   displayed number is framed as "what your intake and scale say", never as
   your metabolic rate.
2. **Selective logging is worse than no logging.** Logging only your good days
   biases the intake mean low. The coverage gate and the `unloggedDaysKcal`
   term charge for it but cannot correct it — the missing days are missing
   *non-randomly*, and nothing in the data reveals by how much.
3. **ρ is an assumption.** 7,716 kcal/kg is mixed-tissue Wishnofsky. Very lean
   or very obese users, or anyone gaining muscle while losing fat, have a
   different real ρ. Charged as 10% relative uncertainty; not corrected.
4. **Big glycogen/water regime changes break the window.** Starting or stopping
   keto, a creatine load, a week of high sodium — these move body mass by
   kilograms with no energy-store change. The Huber weighting absorbs single
   days, not a sustained shift, which will read as a real expenditure change
   until the half-life carries it out of the window.
5. **The interval is mildly optimistic at short windows.** §7.
6. **The first three weeks get nothing.** Deliberate (§6). A user who wants an
   adaptive number on day 10 will be told no.
7. **Menstrual-cycle water retention is unmodelled.** For cycling users a
   ~28-day water rhythm sits near the estimator's window length — the worst
   possible period for aliasing. Not handled in v1.
8. **The benchmark is synthetic.** Every number in §7 comes from a simulator
   whose assumptions are listed above. It validates the *estimator*, not the
   *world model*. Real-user error will differ, and no real-user validation has
   been done.

## 9. Logged, visible, reversible

The constitution requires every automatic adjustment to be all three.

- **Logged.** `buildLedger()` replays the estimator at weekly checkpoints back
  to the profile start date and returns, per week: the formula TDEE, the burn
  used, the target, the change from the previous week, and — when it withheld —
  the reason. Rendered as a table on the Engine screen.
- **Visible.** The whole chain is on screen: window and coverage, mean intake,
  trend slope, predicted vs actual, the gap, the raw data estimate, the shrunk
  posterior, the five uncertainty terms, the resulting target, and what the
  target would have been from the formula alone.
- **Reversible.** The estimate is **derived state, stored nowhere**. It is
  recomputed from your weigh-ins and food log on every read. That is stronger
  than a stored log: correct or delete the entry that caused an adjustment and
  the adjustment un-happens on the next recompute (unit-tested). Beyond that:
  `ADAPTIVE_TDEE=off` in the environment reverts every target in the install to
  the formula, immediately and completely.

### Outstanding schema request

A per-account in-app on/off switch needs **one column**:

```prisma
model Profile {
  // ...
  adaptiveTdee Boolean @default(true)
}
```

The code already reads it (`adaptiveTarget.adaptiveEnabled()` treats
`profile.adaptiveTdee === false` as off; today the field is `undefined`, so it
is inert), and the behaviour is already unit-tested. It was **not added** —
`schema.prisma` is a shared locked base. Until it lands, per-user reversibility
is the derived-state property above plus the install-wide env switch, and the
Engine screen says exactly that rather than showing a switch that does nothing.

## 10. Reproducing everything

```bash
cd backend
node --test tests/expenditureEstimator.test.js      # 32 unit tests
npm test                                            # full suite, 425 tests (393 pre-existing + 32)
node scripts/benchmarkAdaptiveTdee.js --users 1000  # the §7 tables
node scripts/verifyAdaptiveTdee.js                  # live DB fixture (dev only)
```
