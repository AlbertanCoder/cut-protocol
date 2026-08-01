# A15 — Ruler variants, re-scored without re-solving

*Agent A15. Persisted to disk by the fleet coordinator from A15's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A15's.
A15's scripts, JSON/JSONL artifacts and 19 `CLAIMS.tsv` rows DID land.*

**Null result first: the ruler is not where the gap lives. At most 4.0 of the 23.0 missing
points on the satisfiable denominator are reachable by any change to the fat rule — and only
by widening it to ±50 %, which is 1.83× the NASEM AMDR relative half-width. A15 did NOT find
a large ruler effect. A12 stands, unchallenged.**

## Instrument (all MEASURED)

Re-graded the fixed day set from `qa-fleet-20260729-2032/results.jsonl`; no solve, no DB, no
rig. Per C15 **one source only** — the HTTP fleet, 578 judged / 526 satisfiable (A3's C7
buckets). A1's rig (622/536) is not blended in anywhere.

- Baseline reproduces **405/578 = 70.1 %** and **405/526 = 77.0 %**, with **0** disagreements
  against the verdicts the run recorded. Gate passed.
- Bands reconstructed via `bmrEngine.js` read-only match the run's recorded bands on **0/212**
  personas mismatched.
- Fat variants are parameterized as `mid × (1 ± E)`. This is *algebraically identical* to the
  shipping rule, because `[fatLo − 0.25·mid, fatHi + 0.25·mid]` is symmetric about mid;
  verified **0 mismatches** at per-persona `E = h/mid + 0.25`. This handles C2/A12 correctly:
  **baseline E is 31.9–34.4 % on the default path but 35.5–36.1 % on the keto/carb-floored
  path** (50 keto days, 19 carb-floored). `0.34…0.40` was never applied to keto.
- One transcription knife-edge disclosed: `p135` `lbm×1.14 = 232.49979…`, a `Math.round` tie
  flipping `proteinLo` by 1 g. 1 of 212 personas, protein only; every baseline number uses the
  real `computeMacros`, so nothing above is affected.

## The table — satisfiable-only (526) primary, all-days (578) secondary

| # | Variant | Sat in-band | Sat % (Wilson 95 %) | Δ pts | All-days % | Δ pts | b / c |
|---|---|---|---|---|---|---|---|
| — | **Baseline** (effective ±33.1 %) | 405/526 | **77.0** (73.2–80.4) | — | 70.1 | — | 0/0 |
| 2 | Fat ±10 % — **TIGHTEN** | 261/526 | 49.6 (45.4–53.9) | **−27.4** | 45.2 | −24.9 | 0/144 |
| 2 | Fat ±15 % — **TIGHTEN** | 322/526 | 61.2 (57.0–65.3) | **−15.8** | 55.7 | −14.4 | 0/83 |
| 2 | Fat ±20 % — **TIGHTEN** | 360/526 | 68.4 (64.3–72.3) | **−8.6** | 62.3 | −7.8 | 0/45 |
| 2 | Fat ±25 % — **TIGHTEN** | 379/526 | 72.1 (68.1–75.7) | **−4.9** | 65.6 | −4.5 | 0/26 |
| 3 | Fat ±40 % — loosen | 415/526 | 78.9 (75.2–82.2) | +1.9 | 71.8 | +1.7 | 10/0 |
| 3 | Fat ±50 % — loosen | 426/526 | 81.0 (77.4–84.1) | **+4.0** | 73.7 | +3.6 | 21/0 |
| 4 | A4: + fat floor 20 % of energy | 371/526 | 70.5 (66.5–74.3) | **−6.5** | 64.2 | −5.9 | 0/34 |
| 5 | A4 C3: + floor 0.30 g/lb LBM | 405/526 | **77.0** (73.2–80.4) | **0.0** | 70.1 | 0.0 | **0/0** |
| 6 | C12: `CARB_MIDPOINT_BUFFER_G=0` | 419/526 | 79.7 (76.0–82.9) | +2.7 | 72.5 | +2.4 | 14/0 |
| 7 | AMDR %-of-energy, all 3 macros | 103/526 | 19.6 (16.4–23.2) | **−57.4** | 18.2 | −51.9 | 18/320 |

**The mission prompt's variants 1–4 are all tightenings and every one destroys the metric.**
Confirms C1 from a third direction.

**On C14:** every variant except AMDR is strictly **one-directional** (b=0 or c=0), so it sits
in C14's rule-2 regime — floor ≈ 9 flipped days / 1.5 pts, not 3.45. Fat ±40 % (10 days) is
marginal; ±50 % (21) and carb-buffer (14) clear it. Because this is a paired re-grade of a
*fixed* day set under a *deterministic* rule, the discordant counts are **exact** — there is no
solver sampling noise at all. The Wilson intervals bound only generalization to the day
population, not the deltas.

## Variant 5 — the C3 answer is **zero**, and that tempers C3

How many currently-passing days pass while under the app's own `ESSENTIAL_FAT_PER_LB_LBM = 0.3`?
**Zero.** Raising the floor to that constant flips **not one day** (b=c=0 — identically zero, a
stronger statement than "not significant").

- 18 of 578 days sit below 0.30·lbm; **all 18 already fail** baseline, and all are `fat = 0 g`
  empty-plan days (e.g. `p005`, three unfilled slots — A2's POOL_EXHAUSTED).
- Days occupying the actual C3 hole, fat ∈ [0.2475, 0.30)·lbm: **0 of 578**.
- Realized fat is p5 = 0.321, p50 = 0.401 g/lb LBM — the whole distribution sits *above* the hole.

**A4's C3 defect is real in the code and has zero realized incidence in this population.** Same
shape as C13's latent style leak: a true correctness finding, not a live one. Reported as a
correctness fact independent of compliance.

## Why the fat misses cannot be ruled away

Of 121 satisfiable misses, 81 fail the fat rule; 42 fail on fat *alone*, and **42 of 42 are
OVER the band — none is short.** (Corroborates C9: the closer can only add, so it structurally
cannot touch the largest bucket.)

These are not near-misses. Effective E needed to rescue the 81: **p25 = 45 %, p50 = 75 %,
p90 = 121 %.** E=50 % rescues 23/81; you need E=100 % — fat graded anywhere from 0 to ~0.74 g/lb
LBM — to rescue 68/81. That is not a tolerance; it is the absence of one.

## Variant 7 — AMDR collapses because the *prescription* is not AMDR-shaped

19.6 % is **not** a solver indictment. Among the 526 satisfiable days the app's own prescribed
midpoints violate AMDR before any food is chosen: **carb midpoint below 45 %E on 419 days,
protein midpoint above 35 %E on 245, fat midpoint below 20 %E on 96.** This quantifies A4 §4:
fat is LBM-anchored while every guideline is energy-anchored, and it bites on **96/526 (18.3 %)**
of satisfiable days. AMDR is not a drop-in ruler for a high-protein deficit app.

## Variant 6 — the one number that is NOT a pure ruler change

`CARB_MIDPOINT_BUFFER_G` feeds **both** the band and the solver's aim. Re-scoring holds the
plans fixed and moves only the band, so **+2.7 pts is the band-shift component only** — the true
effect needs a re-solve (A13/A21 territory). All 14 gained days are carb-over rescues, consistent
with A2/C9's over-band dominance. Largest single-diet movement in the whole table:
**vegetarian 37→45 (+8 of the 14)**, the corner C11 flagged.

## The headline question

Gap on the satisfiable denominator = 121 days = 23.0 pts. Ruler-attributable: **≤ 4.0 pts
(17 %)**, available only at a fat gate no guideline supports. Every defensible ruler change —
the AMDR-derived 20 %-energy floor (−6.5), the essential-fat floor (0.0), any tightening (−4.9
to −27.4) — **costs points or changes nothing. ~19 of 23 points are solver or pool.**

**No contradiction with A12.** A12 measured ruler *coherence* (0.0 points); A15 measured ruler
*width sensitivity* and finds ≤4 points, obtainable only by widening past every published
guideline. Two different questions, same direction.

## Integrity rule 1 — held separately, as briefed

Everything above is **sensitivity measurement, not recommendation**. A15 is not licensed to and
does not recommend widening anything to raise a score; the two loosening rows exist only to give
the curve its shape. Note the direction of travel: the nutritionally-motivated changes A4 derived
(energy floor, essential-fat floor) **tighten or do nothing**. Whether the ruler should change is
a nutrition question and **the owner's call** — decided on A4's citations, not on this table.

## Blockers / notes

- `rm` of a scratch file was denied by the guard (C6's `-f` rule family). Recorded, not
  circumvented; `A15/A15-run1-check.json` remains on disk as a harmless duplicate.
- Could not create `FINDINGS.md` (C4) — returned as text.
- Day totals in `results.jsonl` are integer-rounded where the grader summed raw (A12 §4:
  divergence ≤1 g, flips only exact-boundary days). Baseline nonetheless reproduces the recorded
  verdicts **exactly**, so no day in this set sits on such a boundary.

**Artifacts:** `A15/A15-rescore.mjs`, `A15-decompose.mjs`, `A15-variants.json`, `A15-days.jsonl`;
19 rows in `CLAIMS.tsv`.

**CONFIRMED** — the measurement was reached and reproduces baseline exactly; it confirms C1's
re-baselining and A12's finding, and falsifies the mission prompt's "the ruler is too tight on
fat" premise.
