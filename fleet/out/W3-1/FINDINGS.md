# W3-1 — RULER SHARE vs SOLVER SHARE

*Persisted by the orchestrator. Machine artifacts: `ruler-share.json` (431 KB), `decompose.json` (204 KB), `scoreRulerSet.mjs`, `decompose.mjs`. Pure re-scoring of the pinned dumps — no re-solve, no DB, no RNG, no network. 20 rulers × 6 denominators × 3 seeds.*

## A. The ruler table

Every ruler is `kcal AND protein AND fatTerm AND carbTerm`; **kcal (±15% sym) and protein (≥0.85·pMid, one-sided) are never varied.**

| id | fat term | carb term |
|---|---|---|
| **A** | `[fatLo−0.25·fatMid, fatHi+0.25·fatMid]` | `[carbLo−0.25·carbMid, carbHi+K·carbMid]`, K=keto?0:0.25 |
| **B** | ≥ round(0.30·lbmLb), **no ceiling** | as A |
| **C** | as A | ≥ carbLo, no non-keto ceiling, keto ceiling kept |
| **D** | B's fat | C's carb (= W1-2's Ruler D) |
| **E35 / E30** | A's floor, ceiling = 35%E / 30%E | as A |
| **E35k** | A's floor, ceiling 35%E **non-keto only; keto keeps A's band** | as A |
| **F** | as A | A but non-keto low bound = max(carbLo−0.25·carbMid, **50**) |
| **R35k** | ≥0.30·lbm AND ≤35%E **keto-exempt** | ≥max(carbLo,50); keto ceiling hard; no non-keto ceiling |
| **A15** | fat allowance widened to ±0.50·fatMid | as A |
| **Z** | *dropped* | *dropped* — **bound, not a proposal** |

**Levels, mean of 3 seeds:**

| ruler | **sat-planned−degen (553)** | sat-judged (537) | planned (640) | pooled b/c vs A | A5 floor | clears? |
|---|--:|--:|--:|---|--:|---|
| **A** | **75.11** | 77.34 | 68.07 | — | — | — |
| B | 84.45 | 86.97 | 76.30 | 1 / 156 | 24.56 | YES |
| C | 76.01 | 78.27 | 69.27 | 54 / 69 | 21.74 | **no** |
| **D** | **83.67** | 86.16 | 76.04 | 55 / 197 | 31.11 | YES |
| E35 | 71.73 | 73.87 | 64.27 | 145 / 89 | 29.98 | YES (**negative**) |
| E30 | 58.59 | 60.33 | 51.15 | 311 / 37 | 36.56 | YES (**negative**) |
| **E35k** | **77.88** | 80.20 | 69.90 | 43 / 89 | 22.52 | YES |
| F | 74.80 | 77.03 | 67.81 | 5 / 0 | 4.38 | marginal |
| **R35k** | **77.28** | 79.58 | 69.74 | 97 / 133 | 29.72 | YES |
| A15 | 80.47 | 82.87 | 72.76 | 0 / 89 | 18.49 | YES |
| NOFAT | 84.51 | 87.03 | 76.36 | 0 / 156 | 24.48 | YES |
| **Z** | **91.92** | 94.66 | 83.18 | 0 / 279 | 32.74 | YES |

Cross-seed spread on 553: A **0.91**, D 0.55, R35k 0.73, **E35k 2.35** (loosest — **must be quoted pooled**).

**Independent-instrument agreement.** `scoreDays.mjs` at s424242 returns `product-recomputed` 415/537, `fatwide:0.5` 442/537, `carbwide:0.5` 426/537, `nofat` 463/537, `nocarb` 449/537 — **byte-identical** to A, A15, A15c, NOFAT, NOCARB. **Two independent implementations, zero disagreements.**

## B. THE HEADLINE DECOMPOSITION

> **On n=553 (`satisfiable-planned − degenerate`), pooled over seeds 424242/20260730/8675309, the level is 75.11% and the gap to 100% is 24.89 pts; of that, at most 16.82 pts sit on days whose only failure is fat and/or carb (ruler Z — the arithmetic ceiling of any conceivable fat/carb re-grade), 8.08 pts sit on days that also miss kcal or protein and are untouchable by any ruler, and the largest *nutritionally defensible* re-grade measures +2.77 pts — so the RULER's recoverable share of the real gap is ≈ +2 to +3 pts and the SOLVER owns the other ≈ 22 pts.**

```
gap to 100%                                      24.89 pts  (138 days)
├─ SOLVER-IRREDUCIBLE (miss kcal and/or protein)  8.08 pts  ( 44.7 d)
│    kcal only 26.3 · protein only 1.3 · both 17.0
└─ RULER-ELIGIBLE ceiling (pass kcal+protein,     16.82 pts ( 93.0 d)
   fail only fat/carb) — ruler Z
     fat only 52.0 · carb only 33.7 · both 7.3
     ── of that ceiling, actually banked by:
        E35k (defensible)   +2.77    B (indefensible)  +9.34
        R35k (defensible)   +2.17    D (indefensible)  +8.56
        F   (correctness)   −0.30    A15               +5.36
```

Gap is 22.66 pts on `satisfiable-judged` (537) and 31.93 pts on `planned` (640).

**⚠️ Double-count guard.** All 93 ruler-eligible days are **over-side** (`missSide`: over 88.3, mixed 4.7, **short 0**), `bindingMissKey` `fat:over` 52.0 / `carb:over` 33.7. **These are exactly the days C1, C2 and C5 target. A ruler change and a solver lever cannot both bank them.**

| ships | level | remaining gap for ALL solver levers |
|---|--:|--:|
| A (today) | 75.11% | **24.89 pts** |
| E35k | 77.88% | 22.12 pts |
| A15 | 80.47% | 19.53 pts |
| D | 83.67% | **16.33 pts** |

**If Ruler D ever ships, C1's +14.74 and C2's +8.27 (both measured under A) must be re-measured — under D there are only 16.33 pts left in total.**

## C. Adjudicating C9 / D1 / D2 — the discrepancy, mechanically

| instrument | ceiling as a multiple of A's | loosening | Δ pts (553) |
|---|--:|--:|--:|
| A15 `fatwide:0.5` | `fatHi + 0.50·fatMid` = **1.188×** | **+18.8%** | **+5.36** |
| Ruler D implicit ceiling | **1.616×** | +61.6% | +8.56 |
| B / NOFAT (no ceiling) | ∞ | ∞ | **+9.34 / +9.40** |

W2-6's "1.90× / 90%" is reproduced **exactly** by the variant computing the implicit ceiling against the *graded* carb floor: **1.9318×**. Four defensible formulas span **1.12×–1.93×**; every one is **≥6× the widening A15 buys.**

**Day-level proof (553, s424242).** 82 days fail A on fat-over. Median overshoot **1.26× A's ceiling**, p90 **1.72×**. A15's ceiling sits at 1.188× → rescues **31 of 82.** The floor-ruler's implicit ceiling sits at 1.60× → rescues **74 of 82.** *The overshoot distribution straddles A15's ceiling and clears it at the median.* **That is the whole discrepancy: +4.0/+5.0 bounds a widening, not a deletion.**

- brief C9 **"≤+4.0 max" → REFUTED as a cap.** Direct re-grade is **+5.36 pooled** (b=0, c=89, A5 floor 18.49). Low by ~1.4 pts and, worse, **quoted as bounding *any* ruler move.**
- W1-1's **+5.0 → CONFIRMED** (A15 on satisfiable-judged; my cell +5.53).
- W1-2's **+8.9/+9.1 for Ruler D → CONFIRMED byte-exact** (+8.56 pooled on 553, 464/553 = 83.9% at s424242).

**Verdict on "the ruler is not a lever":** it **survives, but only once "lever" is read as "a defensible instrument."** **The brief's conclusion is right and its reasoning is wrong.** A widening is worth +5.4; a floor ruler is worth +8.6 to +9.3 — **more than double the brief's cap, and measurable by any threshold.** What kills it is not size, it is **admissibility**: B and D buy their points by deleting the fat ceiling, and the resulting compliant set grades **70.7 days above AMDR's 35%E** (up from A's 48.3). **The brief said the ruler is too small to matter; the data says it is large enough to matter and not defensible in the form that makes it large.**

## D. D3 — tolerance algebra verified

Ruler A recomputed from stored `achieved` + `target` matches the solver's stored booleans on **1,920/1,920 records** (3 seeds × 640), **0 day-level and 0 per-macro mismatches.** LBM reconstruction proven exact on **1,920/1,920.** **D3 CONFIRMED verbatim,** including the keto `A = 0` over-allowance.

**The `hasBand` edge case — measured, narrower than the brief implies.** Records with `fatHi === 0` or non-finite: **0/1,920**. Carb: **0/1,920**.
- **Carb can never be unjudged** — non-keto `carbHi = carbMid + 12 ≥ 12`; keto `carbHi = 30`. **Structurally closed.**
- **Fat requires `lbmLb < 1.25 lb`** — i.e. not a human.

**Latent, not live — but it fails OPEN:** `fatOk: !fatBand || (…)` grades a bandless target *compliant*. `brain/constraints.js:47` writes `dailyTarget.fatLo ?? null`, so the codebase contemplates absent bands, and E5's non-finite-target vector reaches `dayTolerance`. **Adjacent flag:** `routes/plans.js:471` echoes `dailyTarget` **without `keto`, `carbMid`, or `proteinMid`** — anything round-tripping that object into a solve **loses the keto carb law and gets K = 0.25 instead of 0.**

## E. D4 — position, not width. All of W2-6's numbers reproduced independently

Computed from the dump's own stored targets (250/250, 0 drift), **not** from `rulershape.mjs`:

| quantity | W2-6 | **W3-1** | |
|---|---|---|---|
| effective half-width, non-keto | ±33.11% | **±33.17%** | ✓ (Helms 33.3%) |
| median graded window | 16.0…32.0 %E | **16.00…31.90 %E** | ✓ |
| ceiling below AMDR 35%E | 159/250 | **159/250** | ✓ |
| floor below AMDR 20%E | 199/250 | **199/250** | ✓ |
| ceiling below Helms 30%E | 104/250 | **104/250** | ✓ |
| floor below Helms 15%E | 102/250 | **102/250** | ✓ |
| graded compliant below `ESSENTIAL_FAT_PER_LB_LBM` | 232/250 | **232/250 — and it is *every* non-keto persona** (232 non-keto, 0 keto) | ✓ + sharpened |

The 232 is structural: the graded floor is `0.34·lbm − 0.25·0.37·lbm = **0.2475·lbm** = 82.5% of the engine's own constant`, for **every** non-keto persona without exception.

**D4 upgraded from targets to OUTPUT — the number nobody had:**

> **Ruler A grades 48.3 days compliant (mean, of 415.3) whose fat exceeds AMDR's 35%E — 11.6% of everything it passes. It grades 116.7 days (28.1%) above Helms's 30%E.** Under B/D that rises to 70.7 / 68.3. It also passes **1.7 days below 50 g non-keto carb** and 0.3 below 0.30·lbm fat.

**I6:** median graded carb floor **119.25 g** vs `carbLo` **163 g**; **28 of 232** non-keto graded below 50 g. Recomputing the engine's own `carbFloored` branch gives **exactly 9 personas**, graded **24.75–25.50 g**, **9/9 female, 9/9 assumed-body-fat** (I3's sex-skew confirmed). *(A naive `carbMid ≤ 50` test returns 11; the brief's 9 is right.)*

## F. The honest recommendation, priced

**The %E frontier is the finding.** Sweeping the fat ceiling, pooled, n=553:

| ceiling | E (no keto carve-out) | **EK (keto-exempt)** | RK (keto-exempt + floors) |
|---|--:|--:|--:|
| 30%E (Helms) | −16.51 | −10.37 | −11.63 |
| **35%E (AMDR)** | **−3.38** | **+2.77** | **+2.17** |
| 37.5%E | +0.00 (b=c=116) | +6.15 | +4.94 |
| 40%E | +1.02 | +7.17 | +6.08 |
| 60%E | +5.91 | +9.40 | +8.26 |

1. **A %E-anchored ceiling breaks even at 37.5%E without a keto carve-out — above AMDR.** W2-6 flagged this net as unknown; **it is negative at both reference values.** E30 costs **−16.51**; E35 costs **−3.38**. **This is the arm nobody had run and it does not go the way the recommendation assumed.**
2. **W2-6's instrument as literally written DESTROYS keto.** E35/R35 take keto from 58 planned days / 33–35 compliant to **exactly 0.0%**, at every seed. Keto fat is **~65%E by construction** (`bmrEngine.js:307`); keto's median graded window is **40.1…85.0 %E.** **The carve-out is not optional — it is the difference between −3.38 and +2.77.**

**Recommended instrument — R35k, a correctness fix that happens to pay:**

| term | value | measured effect |
|---|---|---|
| kcal | ±15% — **unchanged** | — |
| protein | ≥0.85·pMid — **unchanged** | — |
| fat floor | **≥ round(0.30·lbmLb)** | **exactly 0 days, all seeds. Free.** |
| fat ceiling | **≤35%E, non-keto only; keto keeps A's band** | b=97 / c=133 |
| carb floor | **≥ max(carbLo, 50)** non-keto | b≈13–19/seed |
| carb ceiling | keto **hard**; no non-keto ceiling | c≈20–24/seed |
| **net** | | **+2.17 pts** (553) / +2.24 (537) / +1.67 (640); b/c 97/133 vs floor 29.72 — **clears** |

**The narrower variant E35k** (ceiling only, floors and carb band untouched) buys **+2.77** with *smaller* churn (43/89) and no carb-band change — **it is the better first move**, though its 2.35-pt seed spread demands pooled quoting.

**Per-diet risks, named:**

| diet | A | E35k | R35k | note |
|---|--:|--:|--:|---|
| keto (58 d) | 58.6% | **58.6% (0/0)** | 56.9% | carve-out holds it flat; **R35's −58.6 is the failure mode** |
| **paleo (24 d)** | 41.7% | **29.2–33.3%** | 33.3–37.5% | **the real casualty** — a high-fat diet against a 35%E ceiling |
| vegetarian (57 d) | 62.0% | 63.8% | **88.3%** | R35k's carb-ceiling drop is worth ~+25 pts here |
| vegan (35 d) | 54.3% | 67.6% | 66.7% | gains |
| none (275 d) | 88.6% | 91.6% | 86.3% | E35k gains, R35k loses |

Ruler D's profile is the mirror image: vegetarian **+35**, paleo **+27**, vegan **+28**, keto **−1.7**.

**Ruler F — repair the carb floor to 50 g. DO IT.** Cost **−0.30 pts** (b=5, c=0; |b−c|=5 vs an A5 floor of 4.38 — real but hair-thin). It removes **1.7 mean compliant days sitting below the engine's own non-keto carb floor** — days the app currently certifies as on-plan while they are, **by the engine's own definition, silently ketogenic. 0.3 pts for a correctness bug is the cheapest item in the entire fix plan.**

### The honesty question, head on

**Is a looser ruler E11's inflation trap in a ruler costume?**

**For B, D, NOFAT and A15 — YES, structurally.** Their b-term is ~0 **by construction**: they only ever *add* passes. They stop declaring **48–54 misses per seed**, and **21–22 of those days are above AMDR's 35%E fat**, while **0** involve any change to what lands on the plate. That is E11's signature exactly. **Ruler D would let the app tell 64 days per seed "you're on target" that today it correctly flags, and 22 of those carry fat above every published reference range.**

**For E35k / R35k it is the opposite, and that is the point.** They are **two-sided**: E35k *removes* 18 currently-compliant days and *adds* 27. **The 18 removed are precisely the non-keto days A grades compliant while above AMDR — A's false passes. The 27 added are days A rejects that sit inside AMDR — A's false fails.** The compliant set's nutritional audit goes from **48.3 days above 35%E → 0 non-keto days above 35%E**, and **1.7 days below 50 g carb → 0.** **The app declares MORE misses where they are deserved and fewer where they are not.**

> **The test that separates them: a ruler change that gains points and whose b-term is zero should be treated as an inflation event until proven otherwise; a ruler change whose b-term is a third of its c-term is a re-calibration.** That cleanly separates B/D/A15 from E35k/R35k.

**Honest caveat:** **+2.77 is barely above the noise floor** (single-seed spread 2.35 pts). **Nobody should ship E35k for the points.** Ship it because the app currently certifies **48 days per seed** as compliant while their fat exceeds every reference range it could cite, and grades **100% of its non-keto users against a floor 17.5% below its own `ESSENTIAL_FAT_PER_LB_LBM`.** The +2.77 is what it costs — nothing.

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **D1** | ruler-too-tight DEAD; ±33.11%; widening ≤+4.0 | half-width **±33.17% CONFIRMED**; cap **wrong** — A15 **+5.36**, floor ruler **+8.56 to +9.34**. Conclusion survives only on *admissibility*: B/D grade **70.7 days above AMDR** vs A's 48.3 | **ADJUSTED** — conclusion holds, cap REFUTED, reasoning wrong |
| **D2** | prompt asserts the opposite | **Prompt's direction right, magnitude wrong.** Position wrong in both directions; a floor ruler *is* a big lever (+8.56). But 6.33→23.97% is not reproducible on any denominator. **The two were never in contradiction: the brief measured a *widening*, the prompt described a *floor ruler*, differing 6× in loosening (1.188× vs 1.616–1.932×)** | **BOTH PARTLY** — data supports the **prompt on diagnosis**, the **brief on prescription** |
| **D3** | the algebra | **1,920/1,920, 0 mismatches, 0 per-macro, 0 LBM failures.** `hasBand` hole **0/1,920 live**, structurally unreachable on carb, fails **OPEN** | **CONFIRMED** (exact); edge case latent |
| **D4** | position; window **14.6…29.0 %E** | Position **CONFIRMED**; the brief's *window* endpoints are wrong — measured **16.00…31.90 %E**. All six counts reproduced exactly. **Extended to output: A grades 48.3 days/seed (11.6% of its passes) above AMDR** | **CONFIRMED (claim) / ADJUSTED (endpoints ~1.4–2.9 pts low)** |
| **C9** | +4.0 max, not a solver lever | **+5.36 pooled**, b=0/c=89. Mechanism measured: A15 loosens **18.8%**, floor ruler **61.6–93.2%**; 82 fat-over days at median **1.26×** ⇒ A15 rescues **31/82**, floor ruler **74/82** | **ADJUSTED** — cap REFUTED; "not a lever" holds only for defensible instruments |
| **I6** | half the engine's floor; 9 at 24.8–25.5 g; 28/232 | **CONFIRMED exactly.** 9 personas at **24.75–25.50 g** = **49.5–51.0%** of `NONKETO_CARB_FLOOR_G`; **9/9 female, 9/9 assumed-BF**; 28/232. **Repair costs −0.30 pts** | **CONFIRMED — and now priced** |

## Summary

**Ruler share ≈ +2.2 to +2.8 pts. Solver share ≈ 22 pts** (n=553, 3 seeds, level 75.11%, gap 24.89). Arithmetic ceiling for *any* fat/carb re-grade is **+16.82**; **8.08 pts** miss kcal/protein and no ruler can touch them. The big ruler numbers are real but **inadmissible** (B +9.34, D +8.56, A15 +5.36 — all bought by deleting or inflating the fat ceiling). **The prompt is right on diagnosis, the brief right on prescription; they were never in contradiction — 19% loosening vs 62–93%.** C9's "+4.0 max" is **refuted** (+5.36) and never bounded a floor ruler at all. D3 confirmed exactly; D4 confirmed and extended to output (**A grades 11.6% of its passes above AMDR**). **Recommended: E35k first (+2.77), then R35k (+2.17), plus F (−0.30).** W2-6's instrument as written **destroys keto (58 days → 0.0%)**; paleo is the other casualty. **B/D/A15 are E11 in a ruler costume (b≈0); E35k/R35k are two-sided re-calibrations.** **Ship the ruler change for correctness, never for the points — and re-measure every solver lever under whatever ruler ships.**
