# A12 — Ruler coherence: `computeMacros()` vs `dayTolerance()` vs the UI

*Agent A12. Persisted to disk by the fleet coordinator from A12's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A12's.
A12's data artifacts and its 10 `CLAIMS.tsv` rows DID land.*

**Null result first: the grader is internally satisfiable for every profile tested.**
`dayTolerance()`'s four rules are never jointly empty. Across the canonical 250 personas,
the minimum calorie total reachable at all three macro floors is **70.4 % of target on
average, 74.1 % worst case** — it must be ≤115 % to be feasible. **250/250 feasible.** No
incoherence between `computeMacros()` and `dayTolerance()` can account for any part of the
70.1 % gap. **The gap is real.** [MEASURED]

The incoherence is entirely between the **backend pair and the customer-facing UI**.

### Method

`A12/a12-coherence.mjs` imports `bmrEngine.js` read-only, replays `dayTolerance()`'s
constants transcribed from `mealSolver.js:210-256`, over the 250 personas in
`qa-fleet-20260729-2032/personas.jsonl`. No DB, no solve, no writes to `backend/src/`.

## 1. Macro midpoints do not sum to the calorie target [DERIVED]

`bmrEngine.js:326` — `carbMid = Math.round(...) - CARB_MIDPOINT_BUFFER_G`, with
`CARB_MIDPOINT_BUFFER_G = 25` (line 268). 25 g × 4 = 100 kcal removed by construction.

| statistic | value |
|---|---|
| mean midpoint deficit vs `targetKcal` | **+89.4 kcal (4.4 % of target)** |
| median / p10 / p90 | +100 / +15 / +102 kcal |
| min / max | −14 / +102 kcal |
| non-keto mean (232) | ≈ +100 kcal |
| keto mean (18) | +6 kcal |
| midpoint sums breaking the ±15 % kcal rule | **0 / 250** |

A day hitting all three macro midpoints lands 4.4 % light on calories — inside tolerance,
but it **spends 29 % of the one-sided 15 % kcal allowance before the solver makes a single
choice.** A bias, not a contradiction. The engine discloses it: `macroKcalGap` (line 346)
equals the deficit exactly (p000: 100).

Consequence: for **39/250 (15.6 %)** personas the maximum calories obtainable inside all
three *displayed* bands is **below `targetKcal`** (worst −19 kcal). Escapable in practice
only because the fat rail is drawn with no ceiling (§2).

## 2. Three surfaces, three different rulers [MEASURED — code quotes]

`TodayTab.jsx:135-137` draws `kind="range"` for protein and carbs, `kind="floor"` for fat.
`Parts.jsx:123`: `"Over a FLOOR is not a fault at all."` `Parts.jsx:151`:
`const over = ceil != null && eaten > ceil`.

| macro | what the customer sees | what `dayTolerance()` does | divergence (mean, 250) |
|---|---|---|---|
| **calories** | `TodayTab.jsx:860` `kcalPct > 1` → amber **"Over by N — swap a slot"** | passes to **+15 %** | **334 kcal** where Today says over and Plan says in tolerance |
| **fat (over)** | **floor only** — `"min 53 g"`, no ceiling, never amber | **fails** above `fatHi + 0.25×fMid` ≈ **77 g** | **grader fails, customer sees no fault** — 14.4 g above displayed `fatHi` |
| **fat (under)** | amber below `fatLo` | passes | **16.4 g** below the displayed minimum still passes |
| **carbs** | amber above `carbHi` | passes to `carbHi + 0.25×cMid` | **+50 g (200 kcal)** graded pass, shown amber |
| **protein (over)** | amber above `proteinHi`, a11y `", above the range"` | **over is never a miss** | unbounded |
| **protein (under)** | floor tick at `proteinLo` | passes to `0.85×pMid` | **19.3 g** below the displayed floor still passes |

Both error directions exist. Calories, carbs, protein-over: **the grader passes a day the
customer reads as a miss.** Fat-over: **the grader fails a day the UI renders as fine** —
the only warning is the server's `dayMissLine`, so one screen can show a green fat rail
beside a warning that fat is off.

`PlanTab.jsx:449-452` renders `d.inTolerance` / `d.matchPct` straight from the server, so
**Plan agrees with the grader by construction; Today does not.** The two screens can
disagree about the same day.

Independent corroboration: A12's fat ceiling of `0.4925 × lbm` and floor of `0.2475 × lbm`
match A4's independently-derived ±33.1 % effective window exactly. Two agents, two routes,
same arithmetic. (Three, with A6 and the coordinator — see C1.)

## 3. Keto [MEASURED]

- `bmrEngine.js:314` prescribes `carbMid: 25`, but `bandMiss()` grades on
  `(carbLo+carbHi)/2 = (10+30)/2 =` **20 g**. Prescribed centre ≠ graded centre.
- `EngineTab.jsx:121` displays `macros.carbMid ?? (carbLo+carbHi)/2` → shows **25 g** where
  the grader centres on 20 g.
- Zero upward allowance (`mealSolver.js:241`) coincides exactly with the UI's amber at
  `> carbHi = 30 g`. **Keto carbs are the one coherent pair in the app** — by accident,
  because the ceiling and the band top are the same number.
- **The UI never states the keto asymmetry.** The rail is byte-identical to a non-keto rail
  carrying 25 % of slack.

## 4. Checked and clean — the negatives

| check | result |
|---|---|
| **Floor clamping** | **CLEAN.** `planContext.js:227` `computeMacros(profile, weightNowKg, reconciled.target)` receives the already-clamped target (`bmrEngine.js:235` `const target = Math.max(raw, floor)`). 60/250 personas floored; all bands derived from the clamped number. No mismatch. |
| **Rounding / units** | Both grader call sites (`mealSolver.js:395-399`, `483-487`) sum **raw unrounded** slot values; display rounds. Divergence ≤1 g / ≤1 kcal — can only flip a verdict exactly on a boundary. The 5 g portion rounding is upstream of both and affects them identically. |
| **Carb-floored pathology** | `carbMid = Math.max(0, ...)` (`bmrEngine.js:344`) could emit `carbMid = 0`, giving a non-keto customer a graded carb window of 0–13.5 g. **Does not occur here:** 9/250 carb-floored, all `carbMid ≈ 49-50`. Code path exists; population never reaches it. |

## 5. Magnitude — how many of the 70.1 points?

| item | points | tag |
|---|---|---|
| grader / `computeMacros` incoherence | **0.0** — box feasible 250/250 | DERIVED |
| UI / grader divergence | **0.0** — the UI does not feed the metric; `dayTolerance()` alone scores it | DERIVED |
| ~89 kcal midpoint bias | **unquantified, plausibly non-zero** — shifts the solver's aim 4.4 % below target. Test: re-score the 578 days with `CARB_MIDPOINT_BUFFER_G = 0`. **Flagged to A15 as a band variant worth scoring.** | ESTIMATED |

**The ruler is coherent where it is measured and incoherent where it is shown.** None of the
incoherence inflates or deflates 70.1 %. All of it is a customer-trust defect: the app grades
on one rule and paints another.

## Contradiction with the BRIEF

BRIEF states fat is `lbm_lb × 0.34…0.40`. True for non-keto (`bmrEngine.js:322-323`). **On
keto it is not** — fat is `max(essential, balance) × 0.9 … × 1.12` (`bmrEngine.js:308-313`),
which for the 18 keto personas ran **fatLo 197 – fatHi 245 g** (p019, target 2608). Any agent
applying `0.34…0.40` to keto profiles will compute the wrong band. (Independently
corroborates A4's C2.)

## Artifacts on disk

- `A12/a12-coherence.mjs`
- `A12/a12-per-persona.json`
- `A12/a12-summary.json`
- 10 rows appended to `CLAIMS.tsv`

**CONFIRMED** — incoherence found, but entirely at the UI boundary; the grader/engine pair is
coherent and contributes 0.0 points to the 70.1 %.
