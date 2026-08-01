# A14 — Search-budget re-sweep under current code

*Agent A14. Persisted to disk by the fleet coordinator from A14's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`; A14 re-confirmed the block
is still in force). Content is A14's. A14's 39 comparison JSONs in `A14/cmp/` and 19
`CLAIMS.tsv` rows DID land.*

**Zero new solves in this resume session.** All 25 arms were measured 2026-07-30. 43/43 JSONL files carry `dbHash e55f52e53658a086`, `foodFingerprint 423e7279ed6af641`, poolRaw 910, foodRows 14151 — one dataset, no boundary. `A14/dev.db` untouched since 07-30 21:29, `checkdb.mjs` never invoked (C18 clean). MEASURED: `A14-base-s424242` is byte-identical to `A1-baseline-s424242` on 639/639 rows — the rig is a verified no-op against A1.

All deltas below are **paired McNemar, satisfiable-only** (`compare.v2.mjs`, cross-validated against `A14-analyze.mjs` — every single-seed b/c agrees exactly). Three knobs are separated: **attempts** (week restarts), **cap** (upper arm of `max(5,min(20,n/10))`, bites only pools >200), **floor** (lower arm, bites only pools <120).

---

## 1. LEAD — the prior negative result SURVIVES. Attempts are still flat after ~12.

| attempts | prior campaign | A14, satisfiable-only s424242 |
|---|---|---|
| 1 | — | 70.1 % |
| 2 | — | 73.3 % |
| 5 (default) | 53.3 % | **77.1 %** |
| 12 | 60.2 % | 80.4 % |
| 20 | 60.4 % | 80.8 % |
| 30 | 61.8 % | 81.7 % |

Prior marginal gains +6.9 / +0.2 / +1.4. Mine **+3.36 / +0.37 / +0.93**. The *shape* is unchanged and the knee is still ~12. What moved is amplitude: the 5→12 step **halved**. The macro closer and the staple un-quarantine raised the floor and left less for extra restarts to find. 12→30 buys **+1.30 pts for 2.27× the candidate draws** — under C14's 3.5-pt floor.

**Replication kills the single-seed reading.** att12 = +3.36 (s424242) but +1.49 (s20260730) and +1.87 (s8675309); pooled n=1608 it is **+2.24 [+1.04, +3.44]**, b=31 c=67 — real, under 3.5. att20 (+3.73) and att30 (+4.66) are **single-seed points**; since att12 lost 45 % of its primary-seed magnitude on replication, read them as upper bounds, not estimates.

## 2. CONTRADICTION — "deep search starves thin pools" is not observable under current code

The prior campaign reported a flat budget of 20 dropping a 36-recipe fixture 6/7 → 4/7 days. Measured now, the thin-pool stratum is where flat20 gains **most**:

| pool size (recipes) | days | base | flat20 | delta | b | c |
|---|---|---|---|---|---|---|
| 0–60 | 60 | 48.3 % | 65.0 % | **+16.67** | 2 | 12 |
| 60–140 | 72 | 69.4 % | 72.2 % | +2.78 | 2 | 4 |
| 140–300 | 161 | 71.4 % | 70.8 % | −0.62 | 9 | 8 |
| 300+ | 243 | 90.1 % | 90.1 % | 0.00 | 0 | 0 |

`floor12` isolates this cleanly — it touches only pools <120 by construction, and the strata confirm it: **b=0 c=0 exactly** in both bins above 140, +15.00 pts (b=2 c=11) on the 60 thinnest days. Thin pools were starved by too **little** depth, not too much.

## 3. The cap of 20 is correctly placed. The floor of 5 is not.

| arm | rule | seeds | b | c | delta [95 % CI] | draws |
|---|---|---|---|---|---|---|
| cap8 | `min(…,8)` | 1 | 45 | 23 | −4.10 [−7.10, −1.11] | ×0.58 |
| cap12 | `min(…,12)` | 3 | 107 | 80 | −1.68 [−3.34, −0.01] | ×0.75 |
| **cap40** | `min(…,40)` | 3 | 39 | 49 | **+0.62 [−0.52, +1.76]** | ×1.29 |
| cap60div5 | `min(…,60)`, n/5 | 1 | 28 | 41 | +2.43 [−0.61, +5.46] | ×2.22 |
| cap200div2 | `min(…,200)`, n/2 | 1 | 28 | 47 | +3.54 [+0.39, +6.70] | ×5.98 |
| floor8 | `max(8,…)` | 1 | 5 | 11 | +1.12 [−0.34, +2.58] | ×1.07 |
| **floor12** | `max(12,…)` | 3 | 17 | 35 | **+1.12 [+0.24, +2.00]** | ×1.17 |
| floor20 | `max(20,…)` | 1 | 13 | 24 | +2.05 [−0.17, +4.27] | ×1.46 |
| floor40 | `max(40,…)` | 1 | 23 | 38 | +2.80 [−0.05, +5.64] | ×2.84 |
| flat14 | flat 14 | 3 | 101 | 103 | +0.12 [−1.62, +1.87] | ×1.05 |
| flat5 | flat 5 | 3 | 231 | 74 | −9.76 [−11.84, −7.69] | ×0.45 |

**Cap:** raising 20→40 is a clean null at n=1608 across three seeds; lowering it costs real compliance (cap8's pool-300+ stratum: −7.00 pts, b=23 c=6). 20 sits on the plateau edge.
**Floor:** raising 5→12 is positive in 3/3 seeds, b<c in 3/3, at +17 % draws.
**Adaptivity itself buys ~nothing:** flat 14 ≡ the adaptive rule (mean depth 15.08) at +0.12.
Only `cap200div2` reaches 3.5 pts, at 6× cost — uneconomic.

## 4. Cost — wall-clock is unusable; use candidate draws

MEASURED instrument fault: `flat20` and `floor20` are the **same effective rule** (both mean budget 20.00, both 9773 `slotCalls`, **0 of 639 rows differ**) yet logged `WALLCLOCK 34.9s` and `78.7s` — 2.25×. `solveMs` measured machine load during a 90-minute sweep, not the treatment. All costs above are deterministic Σ(slotCalls × meanBudget); base = 133k draws.

## 5. Recommendation

Change `max(5, min(20, n/10))` → **`max(12, min(20, n/10))`**. +1.12 pts pooled (n=1608) for +17 % draws — the only lever in the sweep that is nearly free. It sits under the 1.5-pt practical floor as a headline number, but its character is one-directional (b=17 vs c=35) and its effect is confined to the 60 thinnest days, where it is +15 pts. Resolving it to the 3.5-pt standard would need ~n=6,400 satisfiable days (4× the pooled sample). Do **not** raise the cap, and do **not** raise attempts — both are paying full price for sub-floor returns.

## 6. Note for A22 / A24

`compare.v2.mjs`'s own `VERDICT` line still applies the **pre-C14 ±1.5 pt floor** — it printed *"clears the +/-1.5 pt noise floor"* for att12 at s424242 (+3.36), the exact delta that then failed to replicate at two other seeds. Do not harvest that line as a verdict.

A24 note: attempts and the per-slot cap are levers the desktop campaign already applied, and this sweep reproduces their null. The floor is the one knob nobody moved.

The prior campaign's flat-after-12 attempts curve holds under current code; its thin-pool starvation mechanism does not.

**CONFIRMED**
