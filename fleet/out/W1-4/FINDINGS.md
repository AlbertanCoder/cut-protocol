# W1-4 — HONESTY DETECTION

*Persisted by the orchestrator. Machine artifacts: `honesty.json` (42 KB), `analysis.json`, `repro.json`, `d6.json`, `e6.json`, `kpi.json` + scripts.*

## ⚖️ THE ADJUDICATION — stated first

**THE BRIEF WINS. The prompt's premise is true; its conclusion is false.**

| | |
|---|---|
| **`diagnoseFromResult` returns `feasible:false` unconditionally** | ✅ **TRUE on this tree.** `mealSolver.js:443` — the function spans `:379-444` and has **exactly one `return`**, hardcoding `feasible: false`. No path returns `true`. (The prompt's `:405` is stale; located by symbol as instructed.) |
| **"41/41 perfect weeks mislabeled, precision 4.2%, false-surrender 95.8%"** | ❌ **REFUTED.** **171 of 171 converged runs carry `diagnosis: null`.** Measured false-surrender: **0.00%**, at all three seeds. |

**Why both are true: every call site is gated.**
- `mealSolver.js:562-567` — `needDiagnosis` (`:548-559`), else `diagnosis: null`
- `mealSolver.js:754-756` — `anyDayMissed || anyUnfilledSlot || floorMissed || noDaysAtAll`, else `null`
- `mealSolver.js:1296-1322` — `anyMissed || unfilledSlots>0 || varietyBreached`, else `null`

**A converged run never reaches `:443`.** `feasible:false` is not a feasibility claim about clean weeks — it is a constant on an object that **only exists when something genuinely missed.** The brief's *"Do not fix this"* is correct. **Do not touch the gating.**

**Residual defect (real, but not the 95.8% claim):** `feasible:false` is **severity-free**. A week that landed 6/7 days and a week with an empty pool carry the identical flag, and `PlanTab.jsx:388` renders both as `infeasible`. `diagnose()` at `:369` computes a real `feasible: reasons.length === 0`; **`diagnoseFromResult` discards its own `preSolve`'s verdict.** Fix = **graded severity, not gating.**

## A. THE 2×2 (250 `/generate` runs, seed 424242, route shape)

|  | **declared** | **silent** |
|---|--:|--:|
| **oracle-infeasible** (missed) | **78** (TP) | **1** (FN) |
| **oracle-feasible** (converged) | **0** (FP) | **171** (TN) |

**Precision 100.0% · Recall 98.73% · False-surrender 0.00% · Specificity 100%**
**Certified false-surrenders (declared ∧ converged): ZERO.** Cross-seed: 0/76/1/173 and 0/79/1/170 — the zero is stable.

Day level (n=640): in-band+declared 139 · in-band+silent 296 · out+declared 204 · **out+silent 1**. The 139 is not mislabelling: 89 are days whose own *slot* missed while the day still landed; 50 inherit a diagnosis earned by a **different day of the same week.**

**Silent-miss count: 1 — `p233#0`**, the 0-slot config. Reproduces W1-1's A6+; the corpus's only `declared === false`.

## B. Detection per tier — both denominators

| cohort | n | declared | rate | converged | false-surr | silent |
|---|--:|--:|--:|--:|--:|--:|
| **18 provable** (`aboveMax_gate`) | 18 | 18 | **100%** | 0 | 0 | 0 |
| **32 IMPOSSIBLE label** | 32 | 24 | **75.0%** | 8 | 0 | 0 |
| 14 label-only (not provable) | 14 | 6 | 42.9% | **8** | 0 | 0 |
| satisfiable | 218 | 54 | 24.8% | 163 | 0 | 1 |

**Scoring against the label alone would damn the detector for the wrong reason.** The 8 "undetected" IMPOSSIBLE personas **converged** — silence is *correct*. **On the provable set detection is perfect: 18/18, and 0 of their 54 days ever landed in band.**

## C. Vector reproductions

**E5 — REPRODUCED, ADJUSTED.** `weeklyPlanner.js:294` `clamp` falls to `min` = 0.5. `NaN` and `undefined` kcalTarget both ship a **0.5× half portion, `warning: null` — fully silent.** `Infinity` ships the *same* half portion (880.7 → 440.4 kcal) but emits a **malformed warning with empty parens**: `closest was "Cast-Iron Sirloin…" ().` — because `NaN > 0.15` is false for both miss tests, so `misses[]` is empty. Brief said `null`; this tree yields a degenerate string. **An infinite ask produces the smallest plate.** Reachable at `brain/tools.js:74` — only `recipeId` is validated.

**E6 — REPRODUCED, WORSE THAN THE BRIEF.** Exact cliff at `weeklyPlanner.js:889`:

| lock | budgetKcal | open slots ship | **warnings** |
|---|--:|---|--:|
| 99% | 20 | 1,813 kcal | **20** |
| **100%** | **0** | **2,623 kcal, 90.5 g fat** | **0** |
| 130% / 200% | 0 | **byte-identical** (same 20 recipe ids) | **0** |

Day total **4,623 kcal on a 2,000 kcal target, silent** (brief: 2,953). `kcalOffPct(0,x)` and `proteinShortfallPct(0,x)` both return 0 via their `target > 0 ? … : 0` guard (`:420-428`) ⇒ the `:630` gate passes on the **first** draw. **The 9%-over day carries 20 warnings; the 131%-over day carries none.** 0/250 personas lock ⇒ **invisible to every fleet number.**

**E7 — REPRODUCED.** Shipped keys `[recipeId, warning, proteinScale, sidesScale, ingredients, kcal, protein, fat, carb]` — **zero match `/pin|bound|clamp|limit|floor|ceil/`.** Real dump: **796 lo-pinned / 524 hi-pinned of 3,011 slots**; days with a lo-pin are in band **63.3% vs 86.4%** unpinned — a **23.1-pt gap.** The kcal *number* is declared; the *cause* ("this dish cannot go smaller") never is.

**D6 — REPRODUCED END-TO-END, UNSOUND BY COUNTEREXAMPLE.** `classifyBinding` emitted verbatim:
> *"every one of the 30 compliant dishes carries less fat than your 60-80 g range allows — at 2000 kcal they land between 41 and 41 g … **no mix of these recipes reaches the band**."*

**That sentence is false.** The same pool at **2,300 kcal** (inside the ±15% gate) delivers **47.1 g fat**, and `dayTolerance` grades that day **4/4 in band.** `:1047-1048` evaluates at the exact target while the day needs ±15% ⇒ strict subset ⇒ **false-fires ~15% in both directions.**

**E9 — mechanism CONFIRMED, magnitude ADJUSTED DOWN.** `matchPct` is the only sort key (`:503-505`); `inTolerance` is computed at `:482-490` and **never consulted.** Measured **2 of 194 runs (1.03%)**, both 1-point inversions (85 v 84; 83 v 82) — not the brief's 95 v 77. **But in both, the first in-tolerance candidate sat at rank 3 of 3** — the default pick is the non-compliant one. Compounds with W1-6's finding that `/day-options` also lacks the closer.

**E10 — REPRODUCED, ADJUSTED DOWN.** `alternatesForSlot` (`:821-863`) has **0 `.sort()` calls**; `mealSolver.js:1388` and `plans.js:260` both call `options[0]` `best`. **504 of 1,126 draws (44.76%)** — brief said 67% of 200. Mean gap 4.26 pts, **max 44.**

## D. E2 + E3 — where the honesty actually breaks

**E2 CONFIRMED VERBATIM.** `Plan` (`schema.prisma:493-505`) and `PlanSlot` (`:506-527`) have **no day-verdict and no diagnosis column.** `genMeta` is `useState(null)` at `PlanTab.jsx:750` with **exactly 2 writes, both inside `generate()`** (`:877`, `:890`). Tab switch, reload or restart → **the entire miss narration is gone. The plan survives; the verdict on it does not.**

**E3 — CONFIRMED on the canonical denominator** (the brief's 66.6% reconciles precisely once the denominator is named — A4 hazard, live):

| denominator | out-of-band days | **kcal+protein both fine** | no slot warning | fully silent |
|---|--:|--:|--:|--:|
| planned (640) | 205 | 45.85% | 10.73% | 0.49% |
| **canonical 553** | 138 | **65.22%** ← the brief's 66.6% | 14.49% | **0%** |
| satisfiable-judged (537) | 122 | 73.77% | 16.39% | 0% |

The 2-macro trigger (`weeklyPlanner.js:661-671`) **structurally cannot fire on 65.2% of bad days.** The **"30.6% fully silent" does not reproduce on any of the six denominators** — ADJUSTED to 14.49% (no slot warning) / 0% (fully silent). **But that 0% depends entirely on the run diagnosis, which E2 proves is never persisted.**

**Two display findings, both verified NUL-safe via Node byte-read (hazard K1):**
1. **`TodayTab.jsx` matches `/warning/i` on ZERO lines** of 55,843 bytes. `PlanSlot.warning` — the only honesty signal that survives a restart — **renders on exactly one screen, and it is not the daily one.**
2. **`TodayTab.jsx:137` draws fat as `kind="floor"`.** At `:92` `ceil` is `null` for a floor ⇒ `:93` `over` is **always false** ⇒ `:110` can never tint amber. **Fat is the dominant failure macro, and the solver grades it two-sided at `:250`. An over-fat day renders as a met floor — visually a success.** `:76-87` shows this is deliberate ⇒ **a product decision to reconcile, not a bug.**

**E8 CONFIRMED VERBATIM.** `plans.js:110` takes `warning` from the client — **the only un-recomputed field** on that path (recipeId pool-checked, ingredients ownership-checked, grams bounds-checked to 400, macros recomputed from raw Food rows, scales clamped). `:625` hardcodes `warning: null` while **its sibling at `:669-678` does it correctly in the same file**, with a comment citing the constitution. `setGenMeta` never cleared on mutation ⇒ after a swap the card shows the **pre-edit** week.

## E. C10 + E11 — the inflation trap in this tree's arithmetic

**C10 CONFIRMED: a sound refusal measures exactly +0.00.** The 18 provable personas contribute **0 in-band days of 54**, so refusing them moves the numerator by zero on ALL PLANNED DAYS.

| refused | `judged` rate | **ALL PLANNED** |
|--:|--:|--:|
| 0 | 69.82% | **67.97%** |
| 100 | 83.17% | **67.97%** |
| **188** | **100.00%** | **67.97%** |

> **Refusing all 188 out-of-band judged days scores a perfect 100% and exactly +0.00 on planned. Max gain: +30.18 pts of pure phantom.**

### Recommended KPI set — no lever can score by refusing

| KPI | current | target | why refusal-proof |
|---|---|---|---|
| **K1 Compliance / ALL PLANNED DAYS** | 435/640 = **67.97%**; 415/553 = **75.05%** | ≥82% canonical | Refusal keeps the day in the denominator, removes it from the numerator ⇒ strictly **lowers** it. **`judged` is BANNED as a headline — it IS the +30.18 lever** |
| **K2 Silent-miss count** (absolute, never a rate) | **1** (p233) | **0** | A refused day is still planned and still owes a reason |
| **K3 Persisted-signal coverage** ⭐ | **85.51%** | 100% | More refusals = more days needing a persisted signal. **The only KPI failing today — and it fails on E2, not diagnosis** |
| **K4 False-surrender count** | **0** | 0 | Direct counterweight to K2; a lever cannot game both |
| **K5 Warning fidelity** | 6.0% stale (W1-6 E4) | 0% | Refusal doesn't touch it; only recomputing warnings does |
| **K6 Refusal soundness** | 18/18 provable refused | 100% justified | Every extra refusal must be justified or the ratio drops |

**Mandatory co-report:** K1 on ALL PLANNED DAYS **first** *and* as the closing line, with `unjudged: baseline N → treatment M` beside it.

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **E1** | 0 silent misses; diagnosis is fine; DO NOT re-fix | `feasible:false` at `:443` **real but gated**; **0 false surrenders**, precision 100%, recall 98.73%, **1** silent miss | **CONFIRMED — brief upheld, prompt's 95.8% REFUTED** |
| **E2** | no day-verdict column; `genMeta` React state | verbatim; 2 `setGenMeta` calls, both in `generate()` | **CONFIRMED** |
| **E3** | 66.6% / 30.6% / TodayTab | **65.22%** on canonical 553 ✓; **14.49%** no-warning, **0%** fully silent ✗; TodayTab **0 lines** match `/warning/i` ✓; fat rail can never tint ✓ | **CONFIRMED (66.6%) / REFUTED (30.6%) / CONFIRMED (display)** |
| **E4** | 33/621 stale kcal | W1-6 owns: **15/250 = 6.0%**, worst 701 with sign wrong | **ADJUSTED** (inherited) |
| **E5** | `clamp` → 0.5, `warning:null` | NaN/undefined → **silent half portion**; Infinity → half portion + **malformed empty-paren warning** | **CONFIRMED, sub-detail ADJUSTED** |
| **E6** | 2953 kcal, 123 g fat, 0 warnings | **4,623 kcal**, 0 warnings; 100/130/200% byte-identical; 99% → 20 warnings | **CONFIRMED — WORSE** |
| **E7** | no pin field; +19.3% median | **0 keys** match the regex; 796 lo-pins; pinned days in band **63.3% vs 86.4%** | **CONFIRMED** |
| **E8** | client `warning`; `:625` null | `:110` the only un-recomputed field; `:625` hardcoded vs `:669-678` correct | **CONFIRMED** |
| **E9** | 95 offered over 77 | mechanism exact; **2/194 = 1.03%**, in-tolerance at rank 3/3 | **CONFIRMED (mechanism) / ADJUSTED ↓** |
| **E10** | 134/200 = 67% | **504/1,126 = 44.76%**, max gap 44; **0 sorts** | **CONFIRMED, ADJUSTED ↓** |
| **E11** | +27.94 phantom, 186 false refusals | **+30.18 on `judged`, +0.00 on planned**, 188 refusals | **CONFIRMED** |
| **D6** | unsound, false-fires ~15% | **Counterexample: 4/4 in-band day at 2,300 kcal / 47.1 g fat** while the app says "no mix reaches the band" | **CONFIRMED — proven, not argued** |
| **C10** | +0.00, ship for honesty | 18 provable contribute **0 of 54** in-band days ⇒ **exactly +0.00** | **CONFIRMED** |
| **D7** | lies 15.2% | **11/94 = 11.7%**; `:1121` before `:1131` | **CONFIRMED (structure) / ADJUSTED ↓** |

`git status --porcelain -- backend/src frontend/src` → empty. `dev.db` unchanged. `networkCallsAttempted = 0` (trapped and counted, not assumed). Solves ran against an isolated copy. Hazard K1 respected — every negative claim about frontend files made via **Node byte-reads**, not Grep.

## Summary

**Unconditional `feasible:false` exists on this tree (`mealSolver.js:443`, one return, no `true` path) — but all three call sites are gated, so it never touches a clean run. False-surrender rate: 0.00%, stable at three seeds; the prompt's 95.8% is refuted by 95.8 points.** Precision 100%, recall 98.73%; 171/171 converged runs correctly carry `diagnosis: null`. **Silent-miss count: 1** (p233, the 0-slot config). Detection is **18/18 = 100% on the provable set**; the 8 label-only "misses" **converged**, so silence was correct. Reproduced: E5, E6 (**4,623 kcal silent**), E7, D6 (by counterexample), E9, E10. **The real honesty defect is persistence and display, exactly as the brief says — diagnosis is sound; nothing writes it down.** Sharpest new finding: **`TodayTab` renders zero warnings and draws fat as a floor that can never tint** — the dominant failure macro is invisible on the daily screen. **Inflation trap: +30.18 pts free on `judged`, +0.00 on planned — pin the headline to ALL PLANNED DAYS and refusal stops paying.**
