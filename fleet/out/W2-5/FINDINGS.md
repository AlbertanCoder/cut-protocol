# W2-5 — WEEKLY / ROLLING ADHERENCE METRIC

*Persisted by the orchestrator. Machine artifact: `fleet/out/W2-5/metric-designs.json` + `weekmetric.mjs`, `weekmetric2.mjs`.*

**This lane became research PLUS measurement.** W1-1's day dumps contain **65 personas on a 7-day horizon** — the only cohort that can exercise a 7-day metric — so every candidate metric was run against **real data across 3 seeds** instead of argued from literature alone.

## Precedent table

| Domain | Metric | Exact definition | Threshold / window | Source |
|---|---|---|---|---|
| CGM | TIR / TAR / TBR | % of readings in 70–180 mg/dL, **split by direction**, stacked bar summing to 100% | >70% TIR, <25% TAR, <4% <70, <1% <54; **14 days** at ≥70% wear | [PMC7076978](https://pmc.ncbi.nlm.nih.gov/articles/PMC7076978/) · [Battelino 2019](https://pubmed.ncbi.nlm.nih.gov/31177185/) |
| CGM display | AGP report | Summary metrics **+ modal day + the individual daily traces**, one page | n/a | [NBK538967](https://www.ncbi.nlm.nih.gov/books/NBK538967/) |
| Medication | **PDC** | days covered / days in period; overlap **shifted forward**, capped at 100%; plan rate = % of patients ≥ threshold, **not mean PDC** | ≥80%; period **≥91 days** | [PQA](https://www.pqaalliance.org/adherence-measures) · [PMC6287024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6287024/) |
| Medication | MPR (**deprecated**) | days supply / days in period; early refills counted → **can exceed 100%** | ≥80% | [JMCP 2019](https://www.jmcp.org/doi/10.18553/jmcp.2019.25.10.1073) |
| UK primary care | QOF exception reporting | practices may **exclude patients from the denominator** | median 5.3% excluded | [Doran NEJM 2008](https://www.nejm.org/doi/full/10.1056/NEJMsa0800310) |
| P4P theory | Threshold vs continuous | single cutoff → discontinuous incentive; only those *just below* are motivated | recommends tiers or **"eliminate targets altogether"** | [PMC3535413](https://pmc.ncbi.nlm.nih.gov/articles/PMC3535413/) |
| Macro coaching | Carbon | *"compliant when you meet two things: your **minimum protein target** [and] your **total calorie target**."* Carbs/fat flexible | 7-day check-in; non-compliant → **hold** targets | [Carbon](https://help.joincarbon.com/en/articles/6004813-the-importance-of-compliance) |
| Macro coaching | MacroFactor — **no score at all** | "adherence neutral": nothing that would *"cajole… or shame"* | none by design | [MacroFactor](https://macrofactor.com/adherence-neutral/) |
| Macro coaching | MacroFactor — rollover | app does **not** auto-average or roll over kcal | manual only, discouraged | [help](https://help.macrofactorapp.com/en/articles/108-how-to-adjust-calorie-targets-to-account-for-overages-or-to-roll-over-unused-calories) |
| Consumer | WW Points | daily budget + weekly bucket; **≤4 unused pts/day** roll over; weeklies **reset, never compound** | 4 pt/day cap | [WW](https://www.weightwatchers.com/us/blog/how-it-works/rollovers) |
| Trials | Self-monitoring tiers | rare <33% / inconsistent 33–66% / consistent >66% of days | **graded, not a cliff** | [PMC9159560](https://pmc.ncbi.nlm.nih.gov/articles/PMC9159560/) |

**Two things stand out. Nobody uses a 7-day window** — CGM needs 14, PDC needs 91, and [Basiotis 1987](https://jn.nutrition.org/article/S0022-3166(23)08345-1/abstract) found **31+ days** of records to pin an individual's usual energy intake within 10%. And **MPR was deprecated for exactly the defect being proposed here**: surplus in one window inflating the score.

## What I measured (65 week-personas, 439 judged days, 3 seeds)

- **"7-day mean kcal within ±5%" hides 47 out-of-band days.** 43 of 64 weeks pass; **17 of those contain a bad day.** False alarms: **0.** It is one-directional — **it can only ever make things look better than they are.**
- **MAD does not fix it.** Mean-absolute-deviation recovers **5 of 47.** Failure is 83% one-sided (fat **77 over / 0 short**; carb 72 over / 1 short), so **there is barely any cancellation to prevent.** Rejecting this "obvious fix" matters as much as rejecting the original.
- **A kcal+protein headline is blind to ~half the failures.** **46–49%** of bad days have kcal *and* protein both fine (3 seeds) — the weekly form of E3.
- **E11, measured directly.** Refusing the worst day of every week: judged-only denominator **66.1 → 70.1% (+4.0 pts, zero behaviour change)**. Fixed planned-days denominator: **66.1 → 59.9% (−6.2 pts).** **The denominator IS the gaming resistance.**
- **Denominator ladder:** all-planned 63.74 / judged-only 66.06 / complete-days-only 70.76 — **7.0 free points.**
- **Severity is thrown away by any flat count:** fat overage beyond tolerance runs median **57.7%**, p90 **113.8%**, **max 258.9%**; 48 of 77 fat-over days exceed 2× tolerance.
- **3-state composition is stable:** in 66.1 / over 21.6 / short 3.4 / both 8.9, within ~1.5 pts across seeds.

## Recommended design — M6 + M9

3-state day composition over a denominator **fixed at plan creation**, on a **28-day** rolling window.

```
For each PLANNED day -> exactly one of:
  IN    = dayInTolerance(t)
  OVER  = any band macro over,  none short
  SHORT = any macro short/below floor, none over
  BOTH  = both directions present
Report all four as % of PLANNED days. Sums to 100%.
A refused / empty / unsolved day counts as NOT in band. The denominator NEVER shrinks.
```

**Companions:** a **severity tier** (an OVER day is level 2 if any band macro exceeds 2× tolerance — fat/carb overPct > 0.50, |kcalΔ| > 0.30); a **protein floor count** ("floor met on N of M planned days" — count only, no mean, no threshold); optionally an **uncoloured energy ledger** (signed kcal sum vs plan, no verdict).

**Why each choice defeats a specific exploit:** fixed denominator turns refusal from **+4.0 into −6.2** (E11 by construction, not intention) · counts-not-means kills the 47-day concealment · directional split stops "improving" by trading an over-day for an under-day · summing to 100% makes a dropped day **shrink the bar** instead of silently helping · no threshold means no cliff to optimise against · 28 days stops the noise-swinging.

**Implementation is cheap — but BLOCKED.** `dayTolerance()` (`mealSolver.js:229`) already returns signed per-direction fields (`kcalDeltaPct`, `proteinShortPct`, `fatShortPct/fatOverPct`, `carbShortPct/carbOverPct`), so the classification is a pure function of what exists. **The blocker is E2: no day-verdict is persisted** (`schema.prisma:493-527` has no column; `genMeta` is React state at `PlanTab.jsx:750`). **Persist the verdict first, or don't build this.**

## Metrics rejected

| Rejected | Why |
|---|---|
| 7-day mean kcal ±5% | **47 hidden bad days across 17 of 43 passing weeks, 0 false alarms.** Blind to half of failures. MPR was deprecated for this exact defect. |
| 7-day MAD of kcal | Recovers 5 of 47. **The compromise that looks like a fix and isn't.** |
| ≥6 of 7 protein-floor days | Unbounded free 7th day (1% short scores as 100% short); converts a floor into a budget; **cliff flips on noise — P(7/7)=16.5% at an unchanged true rate.** |
| Days-in-band over **judged** days | **Disqualified. +4.0 pts for refusing days.** Reproduces A6 and E11. |
| Days-in-band over **complete** days | Worse: **+7.0 pts** of free movement. |
| Any single composite score | A scalar necessarily averages a specific bad day away — the silent miss the constitution forbids. |
| Any ≥80%-style pass threshold | PDC's 80% works because a third party acts on it over 91+ days. **Take PDC's anti-banking discipline; leave its cliff.** |
| Weekly protein **mean** | No banking mechanism, and measured: **no surplus to bank** (median weekly ratio 1.005). Costs a hidden **32.9%-short day**, buys nothing. |
| Streaks / "perfect week" | Constitution bans engagement bait; also the documented route to abandoning logging. |
| Replacing the per-day verdict | **Non-negotiable. Additive context only.** |

## Display

A **28-cell day strip** above a **4-segment stacked bar**. Each cell is one planned day; hover/click reveals that day's existing `dayMissLine()` text **verbatim** — the specific bad day is always one interaction away and is **never aggregated out of existence.** Empty/refused days render as outlined cells **with their reason**, visibly occupying the denominator. **The bar's width IS the denominator.**

**Colour:** in-band `--accent` (the only green; "on-target" is a sanctioned meaning) · over `--warn` amber (law b — **never red**) · level-2 severity as an **opacity + hairline** step, not a new hue and **not a shadow** · short as neutral `--faint` on `--card-2` · **no `--red` anywhere** · **no `--protein/--carb/--fat`** borrowed for day states (law c).

**Copy:** *"In band on 19 of 28 planned days"* — plain count first, **never a grade.** Below 14 planned days, show the raw count and **withhold the rate entirely** (CGM data-sufficiency discipline). **Banned:** "you're on track this week" while any day in the window is out of band; any phrasing implying an under-day earns an over-day; any week-over-week delta.

## Protein vs energy — they need different treatment

**Energy averages.** Matched-weekly-deficit intermittent vs continuous restriction meta-analyses find comparable outcomes — WMD **−0.61 kg** (95% CI −1.70 to 0.47, p=0.87), no significant difference in fat mass or FFM ([J Transl Med](https://translational-medicine.biomedcentral.com/articles/10.1186/s12967-018-1748-4), [Obesity](https://onlinelibrary.wiley.com/doi/10.1002/oby.23023)). **Adipose is a real buffer; the ledger carries forward.**

**Protein does not.** There is no protein storage depot; excess is deaminated and oxidised. And measured in Cut Protocol's own plans there is *nothing to average with*: **median weekly protein ratio 1.0053** of midpoint, only 1 of 64 weeks above 120%. **A weekly protein mean would give the user zero flexibility while permitting a 32.9%-short day inside a "compliant" week.**

Two complications not hidden: [Trommelen 2023](https://www.cell.com/cell-reports-medicine/fulltext/S2666-3791(23)00540-2) shows the anabolic response has *"no upper limit in magnitude and duration,"* weakening the within-day 20 g ceiling story — **though it says nothing about multi-day banking.** [Hudson 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7285146/) is deliberately equivocal on distribution: *"it appears more important to ensure adequate total daily protein intake"* — but **that review addresses only within-day distribution. No direct evidence either way was found on between-day protein averaging.** The verdict rests on mechanism plus Cut Protocol's own measured absence of surplus, **not on a trial.**

Also carried: day-to-day energy *variability* is independently associated with worse body composition at equal mean intake (n=220; body-fat coefficient 10.5, p<0.01; [PMC11241088](https://pmc.ncbi.nlm.nih.gov/articles/PMC11241088/)) — cross-sectional and self-reported, so it supports only *"don't celebrate variance,"* not more.

## Risks / where I'd be wrong

- **Biggest gap: I measured *solver-generated* days, not *logged* days.** The proposal is about what users actually ate. A real logging distribution is wider, which **should make concealment worse** — but that was not measured and is not claimed.
- **Gap L threatens the 28-day window specifically:** the adaptive target drifts ±500 kcal from week 3, outside the ±15% gate. **A rolling window spanning a target change measures against a moving ruler.** Unmodelled.
- **n=64 weeks.** Directions are seed-stable; magnitudes could move.
- **MAD may deserve rehabilitation later.** It is useless *because* failure is one-sided today. **If the trim arm lands and failure becomes two-sided, re-test.**
- **MacroFactor says ship nothing, and they are the most credible operator here.** The partial disagreement rests on Cut Protocol *prescribing* the plans, so it owes an account of how its own plans performed. **If this ever renders as a grade rather than an instrument reading, they're right and I'm wrong.**
- **If anyone wires this into scoring or target adjustment**, every exploit above returns with real consequences.

## Summary

**Recommended: 3-state day composition (in/over/short/both) over a denominator fixed at plan creation, 28-day window**, plus a severity tier, a protein-floor day count, and **no score anywhere.** Top gaming risk is **denominator erosion**, measured at **+4.0 pts** for refusing the worst day of each week under a judged-only denominator — **defeated by construction**: a fixed planned-days denominator turns that same refusal into **−6.2 pts** and visibly shrinks the bar. **The proposed "7-day mean kcal ±5%" hides 47 out-of-band days across 17 of 43 passing weeks with 0 false alarms — a pure concealment device — and MAD recovers only 5 of them.** A kcal+protein headline is blind to 46–49% of failing days. **7 days is statistically indefensible** (95% CI ≈ ±28 pts; P(7/7)=16.5% at an unchanged 77.3% rate); no mature analogue uses a window under 14 days. **Energy averages across days; protein does not.** **Blocked on E2 — persist the day verdict first. Ship it narrowly, as an instrument reading, never as a grade. If it becomes a score, don't ship at all.**
