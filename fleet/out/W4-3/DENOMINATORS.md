# W4-3 — THE DEFINITIVE DENOMINATOR TABLE

*Every number in this file is re-derived from the recorded artifacts. No rig was re-run.
Scripts: `fleet/scratch/W4-3/{regrade-tree,regrade-tax}.mjs` + inline Node over
`fleet/out/W1-2/daydump-route-s{424242,20260730,8675309}.jsonl` and
`fleet/out/W3-7/dump-*.report.md`. `BRAIN=off` not applicable — nothing was solved.*

**Read this first.** Six values (495 / 502 / 526 / 536 / 537 / 553) have all been called
"satisfiable-only" in this corpus. They belong to **three different populations measured on
three different instruments against two different databases**. Only the last three come from
this fleet, and only two of those are interchangeable by arithmetic. There is **no conversion
factor across families** — a rate on one is not convertible to a rate on another, at all.

---

## FAMILY 1 — THIS FLEET (`fleet/measure-2026-08`)

Population: **250 personas → 640 planned persona-days**. DB `d9037dce…b623a1` (14,151 Food /
910 Recipe, fingerprint `b961ac3afbdf3f53`). Personas `e564b1dd…57704e`. Ruler = `dayTolerance`
as committed at HEAD. Instrument `backend/scripts/qc/dayDump.mjs`.

| n | name | membership rule | published by | what it INCLUDES | what it EXCLUDES |
|--:|---|---|---|---|---|
| **640** | `planned` | every record `dayDump` emits | W1-2, W1-4 (K1), every W3-7 report | all 250 personas, the 32 IMPOSSIBLE, the 16 zero-slot failures, the degenerate config | nothing |
| **639** | `planned − degenerate` | minus p233's 0-slot meal config | the rig (`runRig.mjs` emits no record for p233), W1-6 | as above | p233 (1 day) |
| **623** | `judged`, all tiers | `slotsFilled > 0` — `A1/rig/schema.mjs:83`, mirrored at `dayDump.mjs:514` | **the brief's 437/623 = 70.1%**, W1-1, W3-7 reports | the 86 IMPOSSIBLE-tier days | **16 satisfiable total failures** (p005×7, p018×5, p115×4) + p233 |
| **554** | `satisfiable-planned` | `tier != IMPOSSIBLE` | W1-2 §6 (F1 table only) | p233 | the 86 IMPOSSIBLE days |
| **553** | **`satisfiable-planned − degenerate` — CANONICAL** | above, minus p233 | W1-3, W3-1, W3-2, W3-3, W3-4, W3-5, W3-6 | **the 16 total failures, counted as misses** | 86 IMPOSSIBLE + p233 |
| **537** | `satisfiable-judged` | `judged ∧ tier != IMPOSSIBLE` | W1-1, W1-2, W1-6, **W3-7 (its entire headline table)** | — | **the 16 — this is A6's hole** |
| *585* | *`provable-satisfiable-planned`* | *639 minus only the 18 personas with a proof of infeasibility (54 days)* | *nobody — derived here as the alternative cut* | *the 14 label-only IMPOSSIBLE personas (32 days, 20 in band)* | *the 54 proven-impossible days* |

**Verified reconciliations** (`fleet/out/W1-2/analysis.json` → `denominatorCensus`, re-checked here
on all three seeds):

```
planned 640 = judged 623 + unjudged 17
planned 640 = satisfiable-planned 554 + impossible 86
satisfiable-planned 554 = satisfiable-judged 537 + unjudgedSat 16 + degenerate 1
```

### Conversion factors WITHIN family 1

The in-band day count `X` is **identical** on 553 and 537 (the 16 dropped days are never in band,
by construction — a plate with no food cannot be in band). So the two differ by denominator alone:

| from → to | rate factor | delta factor | measured at baseline (route, pooled 3 seeds, X = 1246) |
|---|---|---|---|
| **553 → 537** | × 553/537 = **1.02979** | × **1.02979** | 75.11% → **77.34%** (**+2.23 pt**) |
| **537 → 553** | × 0.97107 | × 0.97107 | 77.34% → 75.11% |
| 553 → 639/640 | numerator **+20** (IMPOSSIBLE days that land in band), denominator +86/+87 | — | 75.11% → 68.18% / 68.07% |
| 623 → 537 | numerator −20, denominator −86 | — | 69.82% → 77.28% (**+7.46 pt**, s424242) |

> **The 553→537 inflation is not a constant — it grows with the treatment.**
> `inflation = X · 16 / (537 · 553) = X · 5.3866e-5` pt.
> At the baseline X = 415.3/seed it is **+2.24 pt**. At W3-7's combined arm X = 495.7/seed it is
> **+2.67 pt**. A treatment that improves the numerator is *also* paid a growing denominator bonus.

### The three seeds, one table (route shape, re-derived)

| seed | in band | /553 | /537 | /623 (all tiers) | /640 |
|---|--:|--:|--:|--:|--:|
| 424242 | 415 (sat) · 435 (all) | **75.05%** | 77.28% | 69.82% | 67.97% |
| 20260730 | 418 · 439 | **75.59%** | 77.84% | 70.47% | 68.59% |
| 8675309 | 413 · 433 | **74.68%** | 76.91% | 69.50% | 67.66% |
| **pooled** | 1246 · 1307 | **75.11%** | **77.34%** | 69.93% | 68.07% |

Rig shape (`--nostack`), s424242 only: 417 sat / 437 all → **75.41% / 77.65% / 70.14% / 68.28%**.
**437/623 = 70.14% is the brief's headline, reproduced byte-exact by W1-1 and again here.**

---

## FAMILY 2 — THE CAMPAIGN HTTP FLEET (2026-07)

Population: **578 judged days**. DB **not recoverable** (the fleet recorded no hash;
`CONSOLIDATED-BRIEF.md:642`). Pre-repair for the 385-numerator rows, post-repair for the 405 rows.
**Nothing in this family converts to family 1.**

| n | name | membership rule | numerator | rate | source |
|--:|---|---|--:|--:|---|
| **578** | all judged days | the HTTP fleet's whole output | 385 (pre-repair) / **405** (post-repair) | 66.6% / **70.07%** | A2, A15, A20, A24 |
| **495** | brief's satisfiable-only | 578 − **83 impossible-tier days** | **385** | **77.8%** | brief, reproduced by A2 |
| **502** | A2's satisfiable-only | 495 + the **7 forge-error personas'** days restored (`p028 p066 p080 p083 p103 p160 p212`) | **392** | **78.1%** | `A2/FINDINGS.md:144` |
| **526** | A3's satisfiable-only | 578 − **52 PROVEN-impossible days** (the tier is over-inclusive by 31) | **405** | **77.0%** | `A3/FINDINGS.md:9-16`, A15, A20, A22 |
| **495** | **A24's SAT-certified — A DIFFERENT SET** | 578 − 16 proved-infeasible − 67 unknown | **405** | *81.8% — never published as a rate* | `A24/FINDINGS.md:52-63` |

> ⚠️ **495 has been published with two different membership rules and two different numerators.**
> The cardinalities coincide because A20's repair split the brief's 83 impossible-tier days into
> exactly **16 proved + 67 unknown**, so `578 − 83` and `578 − 16 − 67` are the same subtraction.
> They are **not the same claim**: the brief's 495 is "days not in the engineered-impossible tier";
> A24's 495 is "days for which some arm in the campaign actually produced an in-band result."
> **385/495 = 77.8% and 405/495 = 81.8% are 4.0 pt apart on an identically-sized denominator.**

---

## FAMILY 3 — THE CAMPAIGN RIG (2026-07)

Same instrument as family 1 (`A1/rig/runRig.mjs`), different DB (`e55f52e5…`, per A24's
129/129 header audit) and pre-campaign product code.

| n | name | numerator | rate | source |
|--:|---|--:|--:|---|
| **622** | `judged`, all tiers | 413 + impossible | — | `A24/FINDINGS.md:35-40` |
| **536** | `satisfiable-judged` | **413** | **77.05%** | A24 §3, brief |

> **536 vs 537 is one day, and the day is the point.** Both runs emit 639 records. The campaign's
> rig dropped **17** of them as unjudged; this fleet's drops **16**. The size of `judged` is
> **substrate-dependent** — it is not a fixed denominator even for the same instrument on the same
> population. 413/536 = 77.05% and 417/537 = 77.65% differ by 0.60 pt, of which 0.14 pt is pure
> denominator.

---

## THE SELF-SCORING DEFECT, PRICED

`A1/rig/schema.mjs:83` — `judged: filled.length > 0`. A day with no filled slot leaves the
denominator entirely. **Refusing a day therefore raises the reported rate.**

Measured on this tree (route, s424242, canonical satisfiable population):

| denominator | today | if the solver refused all 122 of its out-of-band satisfiable-judged days |
|---|--:|--:|
| **537 (satisfiable-judged)** | 415/537 = 77.28% | 415/415 = **100.00%** — **+22.72 pt of pure phantom** |
| **553 (canonical)** | 415/553 = **75.05%** | 415/553 = **75.05%** — **+0.00** |
| 623 (judged, all tiers) | 435/623 = 69.82% | 435/435 = 100% — **+30.18 pt** (W1-4's figure, reproduced) |
| 640 (planned) | 435/640 = 67.97% | 435/640 = **67.97%** — **+0.00** |

Per-seed refusal headroom on 537: **+22.72 / +22.16 / +23.09 pt**.

**Rule that follows:** any denominator whose membership is conditional on the solver's own output
is a scoreboard the player controls. `553` and `640` fix membership at plan creation and are the
only two safe headline denominators in this corpus. This is the same conclusion W1-4 reached from
the honesty side (K1) and W2-5 reached from the weekly-metric side ("the denominator IS the gaming
resistance") — three independent lanes, one rule.

---

## WHICH FLEET AGENT USED WHICH

| agent | primary denominator | co-reported | exposed to the refusal channel? |
|---|---|---|---|
| W1-1 | 537 + 623 | 640 | **level yes**; membership not re-checked across arms |
| W1-2 | **553** (declared canonical) | 640/639/623/554/537 | no — all six published side by side |
| W1-3 | **553** | 537, 640, 639 | no |
| W1-4 | **640** (K1 mandates it, bans `judged`) | 553, 537 | no — it *measured* the channel |
| W1-5 | slots / personas / recipes (not day-rates) | — | n/a; **but see the 232-vs-218 error below** |
| W1-6 | **537** | 623, 639 | **level yes**, delta safe by mechanism (the closer needs a host slot with a `recipeId`, so it cannot empty one) |
| W2-5 | week-personas (65) × 3 | judged vs fixed-planned | no — it *measured* the channel (+4.0 vs −6.2) |
| W3-1 | **553** | 537, 640 | no |
| W3-2 | **553** | — | no |
| W3-3 | **553** | 640, 537 | no for zero-slot; **yes for a second channel it found itself** (14.7% of oracle rescues ship fewer meals) |
| W3-4 | **553** | 537, 639 | no |
| W3-5 | **553** | 640, 537 | no — explicitly verified `judged` membership byte-identical across all 11 arms |
| W3-6 | **553** | vegan segment on 35 sat-judged | no |
| **W3-7** | **537** — *its entire headline table* | 640 (as "all-planned") | **level yes, delta yes (×1.0298)**; membership verified invariant here (see RECONCILIATION §5) |

**One denominator error inside this fleet, already caught by W1-2 and confirmed here:**
`W1-5/FINDINGS.md:207,239` publishes F1 as **"0 of 232"**. 232 = 250 − 18, a self-referential
denominator (it subtracts the numerator's own cohort from the population). The satisfiable
population is **218** (`analysis.json → f1.satisfiableAll.personas = 218`). **Publish 0 of 218.**
