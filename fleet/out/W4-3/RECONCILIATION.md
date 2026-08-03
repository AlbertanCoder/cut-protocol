# W4-3 — RECONCILIATION

*Read-only on measurements. Every figure below is **re-derived from the recorded artifacts**, not
copied from a prior agent's prose. Nothing was re-solved. Scripts under `fleet/scratch/W4-3/`;
the two `bmrEngine` copies there are for the tree-comparability arm only and touch no product
source (`git status --porcelain -- backend/src frontend/src` shows only the pre-existing
uncommitted `bmrEngine.js` / `PlanTab.jsx`, which W4-3 did not create and did not modify).*

**Evidence tier is marked on every claim.** `MEASURED` = re-derived here from an artifact.
`CONFIRMED-FROM-ARTIFACT` = read out of a recorded machine artifact without re-derivation.
`MODEL ARITHMETIC` = computed by reasoning, not by running anything — the 2026-07-29 audit found
its own failures clustered exactly there, so it is flagged wherever it occurs.

---

## SUMMARY — what closed and what did not

| # | reconciliation | verdict |
|---|---|---|
| 1 | Taxonomy sums + the 92.6 / 74.6 / 94.2 over-side dispute | **CLOSED with exact arithmetic.** Buckets sum at every seed and both shapes. All three over-side numbers correct; bridge shown. One transcription slip in W1-3's rendered table (+1 day). |
| 2 | The six "satisfiable-only" denominators | **CLOSED within families, IRRECONCILABLE across them.** Three populations, two DBs, one of them unrecoverable. See `DENOMINATORS.md`. |
| 3 | 16 / 67 / 495 = 578 vs n=553 vs the 97.2% ceiling | **PARTLY CLOSED.** The 85.6% ↔ 97.2% "contradiction" dissolves: they are the two endpoints of one interval. The bridge to n=553 **does not exist** and cannot be built. |
| 4 | 70.1% vs 77.3% vs 75.0% | **CLOSED exactly.** Same in-band day count, three denominators, one pool-shape swap. Arithmetic below. |
| 5 | The additivity trap | **CLOSED and EXTENDED.** W3-7's decomposition verified to the day. **W3-7's satisfiable denominator is 537, not 553** — its published deltas are 2.98% too large. Five further sum-hazards found; two are live. |

**Highest-value single finding:** `A1/rig/schema.mjs:83` makes refusal pay, and **the one agent
whose number the fleet report will quote as the headline — W3-7 — is the one that published on
the exposed denominator.** §6.

---

## 1. TAXONOMY SUMS AND THE OVER-SIDE DISPUTE

### 1a. Do the buckets sum? **YES — independently reproduced. [MEASURED]**

I re-graded all four W1-2 dumps from raw `achieved` + `target` with a third independent
implementation of Ruler A and bucketed every failing day by its binding axes.

| dump | canonical n | in band | failing | bucket sum | reconciles |
|---|--:|--:|--:|--:|---|
| route s424242 | 553 | 415 | 138 | **138** | ✅ |
| route s20260730 | 553 | 418 | 135 | **135** | ✅ |
| route s8675309 | 553 | 413 | 140 | **140** | ✅ |
| rig s424242 | 553 | 417 | 136 | **136** | ✅ |

Bonus: my re-grade agreed with the stored `verdict.inBand` boolean on **2,212 / 2,212 records,
0 mismatches**. That is now a **third** independent implementation of Ruler A (product · W1-2's
`scoreRulers.mjs` · this) with zero disagreements. **W1-3's claim CONFIRMED.**

**One transcription slip, in W1-3's rendered table only.** The table at
`fleet/out/W1-3/FINDINGS.md:11-23` lists *"4 further multi keys | 1 each"* alongside a separate
`kcal-over / kcal-under | 1 / 1` row, which sums the table to **139**. The measured truth is
**3 further multi keys at 1 each**, and W1-3's own proof line (`48+34+17+16+8+5+3+2+1+1+1+1+1`)
uses exactly five 1s and is **correct at 138**. The underlying `taxonomy.json` is correct.
Fix the table row to "3 further multi keys"; no downstream number changes.

Re-derived route s424242 buckets, in full:

```
fat-over 48 · carb-over 34 · multi kcal-over+fat-over 17 · empty-slot 16
multi kcal-over+fat-over+carb-over 8 · multi fat-over+carb-under 5
multi fat-over+carb-over 3 · multi kcal-over+carb-over 2
multi kcal-over+protein-short+fat-over+carb-over 1 · multi kcal-over+protein-short+carb-over 1
multi protein-short+carb-over 1 · kcal-over 1 · kcal-under 1          = 138 ✅
```

### 1b. 92.6% vs 74.6% vs 94.2% — all three correct. The bridge, exactly. [MEASURED]

The three numbers differ on **two independent axes** — *what is counted* (days or axes) and
*which failing days are in scope* (all, or only those that shipped food) — plus a third,
*which pool shape*.

| # | value | counts | scope | pool shape | re-derived here |
|---|--:|---|---|---|--:|
| **92.6%** | 113/122 | **DAYS**, pure-over | failing days **that contain food** | route | **92.6%** ✅ |
| **94.2%** | 113/120 | **DAYS**, pure-over | failing days that contain food | **rig** | **94.2%** ✅ |
| **74.6%** | 159/213 | **AXES**, over-side, protein excluded | **ALL** failing days, incl. the 16 empty plates | rig | **74.6%** ✅ |

The whole gap is 48 axes. A plate with no food is arithmetically **short on all four macros**;
16 such days × 4 axes = 64 short axes, of which 48 survive the "exclude protein" cut:

```
rig s424242, canonical 553
  failing days                                   136
    ├─ empty plates                               16   → 0 over-axes, 64 short-axes (48 ex-protein)
    └─ failing days containing food              120   → 159 over-axes, 7 short-axes (6 ex-protein)

  AXIS framing, food days only, ex-protein   159 / (159 + 6)   = 96.4%
  AXIS framing, food days only, incl protein 159 / (159 + 7)   = 95.8%
  AXIS framing, ALL failing days, ex-protein 159 / (159 + 54)  = 74.6%   ← the disputed number
  AXIS framing, ALL failing days, incl prot. 159 / (159 + 71)  = 69.1%
  DAY framing,  food days only               113 / 120         = 94.2%
  DAY framing,  ALL failing days             113 / 136         = 83.1%
  DAY framing,  all planned-640 failing      113 / 197*        = 57.4%  (*route: 117/204)
```

**The 48 short axes ARE the entire 74 ↔ 96 gap.** W1-3's reconciliation is exact and its
recommendation stands: **cite 92.6% (or 94.2% on the rig arm), name the denominator out loud as
"failing days that contain food", and never cite 74.2%** — the 16 days that framing adds are empty
plates, which no trimmer and no adder can reach (W3-4 measured 0/48 conversion on exactly those
days, as predicted).

Cross-seed, route: **92.6 / 92.4 / 94.4%** — stable. [MEASURED]

**Where the prompt block's 74.2% came from:** the axis framing on satisfiable-planned with protein
excluded, which measures **74.6%** here. Within 0.4 pt. It is **not wrong; it is the framing that
books 16 zero-food plates as "the solver undershot."**

### 1c. One wording defect worth fixing before W5-1 quotes it

W1-3's ledger headline reads *"94.7% of failing AXES … are pure-over"*. An axis cannot be
"pure-over" — 94.7% is the **over-side share of the 171 failing axes on the 122 food-containing
days**; **92.6% is the pure-over share of DAYS**. Two different quantities, one sentence.

---

## 2. DENOMINATORS

Fully worked in **`fleet/out/W4-3/DENOMINATORS.md`**. Verdict in one paragraph:

**495, 502 and 526 belong to the campaign's HTTP fleet (578 judged days, DB unrecoverable).
536 belongs to the campaign's rig. 537 and 553 belong to this fleet.** Within this fleet, 553 and
537 differ only by denominator (rate factor **1.02979**, since the 16 dropped days are never in
band) and convert exactly. Within the campaign fleet, 495/502/526 differ by *which impossible-tier
rule* is applied and carry **different numerators** (385/392/405), so they do not convert by a
scalar. **Across families there is no conversion factor and there cannot be one** — different
population, different database, different product code.

Two hazards this table exposes that nobody had stated:

1. **495 was published twice with different membership.** The brief's 495 = `578 − 83
   impossible-tier days`, numerator **385**, rate 77.8%. A24's 495 = `578 − 16 proved − 67 unknown`
   = SAT-certified days, numerator **405**. Cardinality coincides because A20's repair split the
   same 83 days into 16 + 67. **On an identically-sized denominator the two rates are 4.0 pt
   apart.** [MEASURED from A2/A3/A24 tables — CONFIRMED-FROM-ARTIFACT]
2. **`judged` is not a fixed denominator even for one instrument.** The campaign rig dropped 17 of
   639 records; this fleet's drops 16. `536` and `537` are the same rule producing different sizes
   on different substrate. A denominator that the treatment can move is not a denominator.

**A4 verdict: CONFIRMED, and violated three times inside this fleet** — (a) the brief's `judged`
count printed under an "all-planned" label; (b) W1-5's "0 of 232" where the satisfiable population
is 218; (c) **W3-7's headline table, labelled "satisfiable", computed on 537**.

---

## 3. THE SATISFIABLE-CUT DEFINITIONS: 16 / 67 / 495 = 578 vs n=553 vs the 97.2% ceiling

### 3a. The "three competing ceilings" are not competing. [MEASURED — arithmetic on A24 §5]

A24's decomposition, read as an interval rather than as point estimates, closes the whole dispute:

```
578 campaign HTTP-fleet days
 ├─  16  PROVABLY infeasible (A20's repaired SCALED + adjusters-at-MAX_GRAMS bound)
 ├─  67  UNKNOWN — no proof of infeasibility AND no certificate of feasibility
 └─ 495  SAT-certified — some arm actually produced an in-band day
                                                          (405 of them in the baseline)

  UPPER bound on any solver's all-days rate   = (578 − 16)/578 = 562/578 = 97.2%
  CERTIFIED-ACHIEVABLE lower bound            =  495      /578 = 495/578 = 85.6%
  width of the uncertainty                    =  67       /578 =           11.6 pt
```

> **85.6% and 97.2% are the two ends of one interval, not two answers to one question.**
> The brief's 85.6% is the *certified floor* on the ceiling; A20's 97.2% is the *upper bound*.
> Per A24 (I9) the move from 91.0% to 97.2% is **a proof that weakened, not a ceiling that rose** —
> 36 days moved INFEASIBLE → UNKNOWN and **gained no certificate**. Nothing became more solvable;
> the study lost the ability to prove 36 days unsolvable. The correct sentence is A24's:
> **"16 days provably impossible; 67 unknown in both directions."** Never average the three
> ceilings (88 / 91.0 / 97.2) — I10 already ruled on that, and this reading shows why: two of them
> are bounds on opposite sides of the same interval.

### 3b. Does it reconcile against n=553? **NO — and the bridge cannot be built.** [MEASURED]

| | campaign 578 | this fleet 553 |
|---|---|---|
| population | HTTP fleet's judged days | 250 personas' satisfiable planned days minus p233 |
| database | **not recoverable** (`CONSOLIDATED-BRIEF.md:642`) | `d9037dce…b623a1`, pinned |
| product code | pre-campaign | post-campaign, plus committed Tier-2 fixes |
| refusals | **excluded** (578 is a *judged* count) | **included** (the 16 are counted as misses) |
| impossible tier | excluded by proof (16) or unknown (67) | excluded by **label** (86 days / 32 personas) |

The two are not the same quantity even in principle: 578 is refusal-free and proof-cut; 553 is
refusal-inclusive and label-cut. **Declared irreconcilable.** Any W5-1 sentence of the form
"we were at X% of the 97.2% ceiling" is a category error.

**What CAN be said on this tree.** The same *proof* method (demanded gate density above the pool's
single-recipe maximum) fires on **18 personas / 54 days**, all IMPOSSIBLE-tier, **0 in band under
either ruler** (`analysis.json → f1.aboveMaxGate`). So:

```
all-days ceiling on THIS tree  ≤ (639 − 54)/639 = 585/639 = 91.55%     [MEASURED]
satisfiable-only ceiling       : NO proof below 100% — the 54 are already outside 553
                                 (matches A3's finding that no proven satisfiable-only
                                  ceiling exists; 4 satisfiable personas exceed pool max on
                                  the NOMINAL ask but 9 of their 10 days land in band under D,
                                  so that is not a proof either)
```

### 3c. The satisfiable cut itself: label vs proof — a near-tie, and that is the news. [MEASURED]

The IMPOSSIBLE tier is a **persona-generator label, not a proof** (W1-2: 10 of 32 produce a
compliant day; 20 of their 86 days land in band = 62.5% among the 14 that are not one-macro
infeasible — *better than the fleet average*). So there are two defensible satisfiable cuts:

| cut | rule | n | in band | rate (route, s424242) |
|---|---|--:|--:|--:|
| **label** (what everyone used) | `tier != IMPOSSIBLE`, minus p233 | **553** | 415 | **75.05%** |
| **proof** | 639 minus only the 18 proven-infeasible personas' 54 days | **585** | 435 | **74.36%** |

**They agree within 0.69 pt.** The label cut discards 20 in-band days *and* 66 failing days, and
the two removals almost exactly cancel. **The cut choice is not a knife-edge for the level** — a
genuinely useful negative result, and the strongest available defence of keeping 553.

---

## 4. OLD-VS-NEW COMPARABILITY: 70.1% ↔ 77.3% ↔ 75.0%

**Same quantity, three denominators, one pool-shape swap. Fully closed.** [MEASURED]

The in-band **day count** is the invariant. Everything else is bookkeeping.

```
RIG shape, seed 424242 — the arm the brief's headline came from
  437 / 623   = 70.14%   judged, ALL tiers                    ← the brief's "70.1%"
   ─ 20 in-band IMPOSSIBLE days,  ─ 86 IMPOSSIBLE days
  417 / 537   = 77.65%   satisfiable-judged                   ← the brief's upper endpoint 77.7%
   + 16 zero-slot satisfiable failures, counted as misses
  417 / 553   = 75.41%   CANONICAL
   + 20 in-band IMPOSSIBLE, + 86 IMPOSSIBLE days, + p233
  437 / 639   = 68.39%   all planned

ROUTE shape (production, applyFilterStack ON), seed 424242
  435 / 623   = 69.82%  ·  415 / 537 = 77.28%  ·  415 / 553 = 75.05%  ·  435 / 640 = 67.97%
```

Three moves, each priced:

| move | effect on the rate | size |
|---|---|--:|
| drop the IMPOSSIBLE tier (623 → 537) | numerator −20, denominator −86 | **+7.46 pt** |
| restore the 16 zero-slot failures (537 → 553) | numerator +0, denominator +16 | **−2.23 pt** |
| rig → route pool shape (K2c) | 437 → 435 in band | **−0.32 pt** |

**Two labelling errors, both already ADJUSTED by W1-2 and confirmed here:**
1. The brief calls 437/623 **"all-planned-days"**. It is not. It is `judged`. All-planned is
   **68.4% (rig) / 68.0% (route)** — the brief's headline is **1.7–2.1 pt high** on its own label.
2. The prompt block's *"83/250 personas engineered-unsatisfiable"* is wrong: 578 − 495 = **83
   DAYS**, from **32 personas** (A3: 18 + 14). [MEASURED from A3's own sub-kind table]

**A1 verdict: ADJUSTED — number byte-exact, denominator label wrong.**
**A2 verdict: CONFIRMED at the level, ADJUSTED on the spread** (0.9 pt on the shipping ruler, not
0.4–0.5; the brief's spread is what *Ruler D* yields — measured 0.47–0.56).

---

## 5. THE ADDITIVITY TRAP

### 5a. W3-7's decomposition: verified to the day — with a denominator correction. [MEASURED]

I pulled the in-band counts out of all 24 of W3-7's own `dump-*.report.md` files and pooled them.

| arm | in-band (pooled) | net days vs base | Δ on **537** (as W3-7 published) | Δ on **553** (canonical) |
|---|--:|--:|--:|--:|
| base | 1246 | — | — | — |
| c14 | 1350 | +104 | +6.46 | **+6.27** |
| c2 | 1375 | +129 | +8.01 | **+7.78** |
| **c14+c2 (portioner)** | 1427 | **+181** | **+11.24** | **+10.91** |
| **trim** | 1449 | **+203** | **+12.60** | **+12.24** |
| **c14+c2+trim** | **1487** | **+241** | **+14.96** | **+14.53** |
| b20 | 1282 | +36 | +2.23 | **+2.17** |
| c14+c2+b20 | 1439 | +193 | +11.98 | **+11.63** |

**The additivity arithmetic holds exactly, on either denominator:**

```
                        on 537 (published)     on 553 (canonical)
portioner alone              +11.24                 +10.91      (181 days)
trim alone                   +12.60                 +12.24      (203 days)
                             ───────                ───────
naive sum                    +23.84                 +23.15      (384 days)
MEASURED COMBINED            +14.96                 +14.53      (241 days)
                             ───────                ───────
LOST TO OVERLAP               +8.88                  +8.62      (143 days)
overlap share                 37.2%                  37.2%      ← denominator-invariant
overstatement factor          1.593×                 1.593×     ← denominator-invariant
residual: trim over portioner  +3.72                  +3.62      (60 days)
residual: portioner over trim  +2.36                  +2.29      (38 days)
```

**W3-7's structural conclusion is CONFIRMED exactly.** The overlap share (37%) and the
overstatement factor (59%) are ratios and are invariant to the denominator choice — those are the
robust numbers and W5-1 should quote them.

### 5b. Three corrections to W3-7. [MEASURED]

1. **Its "satisfiable" denominator is 537, not 553.** `n=1,611 = 537 × 3`. Its base of 77.34%
   *is* W1-2's satisfiable-**judged** figure. Every published delta is therefore **2.98% too
   large**, and the level 92.30% is **89.63%** on the canonical denominator.
2. **"trim alone reproduces W3-4's +12.60 EXACTLY. Two agents, same substrate, exact agreement."
   — this is a coincidence, and the substrates differ.** W3-4 ran the **rig** shape and got
   **209 net days on 1,659 = +12.60**. W3-7 ran the **route** shape and got **203 net days on
   1,611 = +12.60**. Different numerator, different denominator, same quotient to three figures.
   The honest cross-check is **W3-4's own 537 line: +12.97 (rig) vs W3-7's +12.60 (route) — 0.37 pt
   apart**, consistent with K2c's pool-shape difference and *not* an exact agreement.
3. **W3-2 and W3-7 ARE in exact agreement, and nobody said so.** On 553, W3-7's portioner arms
   give **+6.27 / +7.78 / +10.91** — byte-identical to W3-2's published **+6.27 / +7.78 / +10.91**,
   and the day counts match W3-2's own b/c ledger exactly (`c=149−b=45 = 104`; `179−50 = 129`;
   `220−39 = 181`). Two agents, same arms, same flips. Likewise W3-7's b20 on 553 = **+2.17** =
   W3-5's ADAPT→FIX20 **+2.17**, and W3-7's c2 level on 553 = **82.88%** = W3-5's "C2 @ 5 week
   attempts 82.88%". **The whole W3-2 / W3-5 / W3-7 family reconciles to the day once every number
   is put on 553.**

### 5c. Was W3-7's `judged` membership stable across arms? **Yes — verified, not assumed.** [MEASURED]

All 24 W3-7 dumps report **`empty` = 16 per seed** and `in-band(judged) == in-band(planned)` in
every arm. No arm gained a single point by refusing a day. So W3-7's *deltas* are honest despite
the exposed denominator; only their *magnitude* is inflated by the 1.0298 factor. **The exposure is
real but was not exploited.**

### 5d. Every other place two deltas were summed, or could be

| # | sum | status |
|---|---|---|
| 1 | portioner + trim (W3-7) | **MEASURED as a combined arm.** 37% overlap. ✅ |
| 2 | C14 + C2 (W3-2) | **MEASURED as a combined arm.** 6.27 + 7.78 = 14.05 naive vs **10.91** measured — **22.4% overlap**. Reported correctly (`c2 marginal over c14 = +4.64` ✓). ✅ |
| 3 | C2 + C6 (W3-5, claim C11) | **MEASURED.** 7.78 + 1.08 = 8.86 naive vs **8.98** measured; interaction **+0.12 pp**. Genuinely additive — the one place summing is safe, and it was tested rather than assumed. ✅ |
| 4 | **W3-5's recommended stack: "C2 + flat 20 ⇒ ~+10 pts"** | **NAIVE SUM — FLAG.** 7.78 + 2.17 = 9.95. W3-7 measured b20's marginal **over a portioner at +0.72**, not +2.17. The two-lever stack was never run; the true value is likely **≈ +8.5**, and the overstatement grows if C14 is added. **W5-1 must not carry "~+10" as a measured number.** |
| 5 | **W3-6's +7.72 added to the W3-7 stack** | **UNMEASURED, HIGH RISK — FLAG.** W3-6's snack insertion rescues **99 of 145 days on `fat:over`** — the same bucket the trim converts at 61.7% and the portioner banks 81.4% of. Naive sum on 553 = 14.53 + 7.72 = **+22.25**, against W1-6's hard union cap of +22.95 for *all six* levers. Overlap ≥30% is near-certain; **no combined arm exists.** |
| 6 | **Ruler change + solver lever** | **PARTIALLY MEASURED — FLAG.** W3-1's ruler-eligible pool is 93 days/seed; W3-2's C14+C2 banks **64.2%** of it and W3-4's trim **63.7%**. E35k (+2.77) and R35k (+2.17) target that identical pool. **E35k + the stack is not +17.3.** W3-1, W3-2 and W3-4 all flagged this independently; no agent has run the joint arm. |
| 7 | W3-3's LNS +2.95 on top of the stack | **UNMEASURED.** W3-3 predicts compression by its own inverted-U table (headroom peaks at 2–3 in-band days of 7 and collapses to 0 at 7/7); the stack pushes weeks rightward. Expect **well under +2.95**; do not sum. |
| 8 | trim (+12.24) + L₂ portioner (+12.36→ +12.00 on 553) | **EXPLICITLY REFUSED by W3-4** (overlap 82.7% vs 80.3% on the same 279-day pool). W3-7 substituted C14+C2 for L₂, so **the trim × L₂ overlap remains unmeasured.** Correct call, open question. |
| 9 | A24's I1 cap | **CONFIRMED as the discipline.** Baseline satisfiable misses cap the union of *all* levers at **+22.95 pts**; the naive sum of six gross gains was +58.77 = **2.56× arithmetically impossible.** |

---

## 6. THE INSTRUMENT SCORES ITSELF — exposure, quantified

`A1/rig/schema.mjs:83`: `judged: filled.length > 0`. Sixteen satisfiable **total failures** —
every one of them a day the solver could not fill at all — leave the denominator. `dayDump.mjs:514`
reproduces the rule deliberately so the two instruments stay comparable, and `dayDump.mjs:38-42`
documents it, but the rule is still live wherever a `judged` denominator is quoted.

**Priced on this tree** (route, canonical satisfiable population, all three seeds):

| headline denominator | today | refuse every out-of-band day | phantom gain |
|---|--:|--:|--:|
| **537 satisfiable-judged** | 77.28 / 77.84 / 76.91% | 100% | **+22.72 / +22.16 / +23.09 pt** |
| 623 judged, all tiers | 69.82% | 100% | **+30.18 pt** (W1-4's number, reproduced) |
| **553 canonical** | 75.05 / 75.59 / 74.68% | unchanged | **+0.00** |
| **640 planned** | 67.97% | unchanged | **+0.00** |

**Which of this run's headlines are exposed:**

| headline | denominator | exposure |
|---|---|---|
| **W3-7 "combined +14.96 pp / 92.30%"** — *the number W5-1 will quote* | **537** | **level +2.67 pt inflated (89.63% canonical); delta +0.43 pt inflated (+14.53 canonical); up to +22.7 pt of unexploited refusal headroom.** Membership verified invariant, so nothing was gamed — but the number is quoted on a scoreboard the player controls. |
| the brief's **70.1% = 437/623** | 623 | +30.18 pt of headroom; also mislabelled "all-planned" |
| **77.3 / 77.7 / 77.8%** (W1-1, W1-2, W1-6) | 537 | +22.2–23.1 pt of headroom; +2.23 pt standing inflation |
| **W1-6's closer +2.79** | 537 | delta safe **by mechanism** — `macroCloser.js:116` requires a host slot with a `recipeId`, so the closer structurally cannot empty a slot. The *level* (77.7%) is still inflated. |
| W3-1, W3-2, W3-3, W3-4, W3-5, W3-6, W1-3 | **553** | **none** on this channel |
| W1-4, W2-5 | 640 / fixed-planned | **none** — both agents measured the channel rather than being exposed to it |

**A second, independent refusal channel that no denominator catches.** W3-3 found that **24 of the
oracle's 163 rescued days (14.7%) ship FEWER filled meals than the baseline day at the same
calendar index** — dropping a meal removes calories from an over-target day and walks it back
inside the ±15% kcal band. Those days still have `slotsFilled > 0`, so `judged` keeps them and
`planned` keeps them: **both safe denominators are blind to partial refusal.** In-band days
carrying an unfilled slot go 4.36% (baseline) → 7.01% (oracle). LNS is clean (0 of 50).
**Recommended co-report alongside any day-rate: total filled slots.** W3-7's arms are clean here
too (empty meal slots pinned at 150/6,651 across every arm in W3-5's and W3-6's parallel checks),
but nobody published it for the combined arm.

**Recommendation, one line:** adopt W1-4's K1 verbatim — **headline on ALL PLANNED DAYS (640) with
the canonical 553 beside it, `unjudged: base N → arm M` on every A/B line, and filled-slot totals
as a third column.** Then refusal stops paying on both channels.

---

## 7. TWO STRUCTURAL CLAIMS, ADJUDICATED

### 7a. "95.7% of passing days touch a bound, so pinning is not a diagnostic"

**CONCLUSION CONFIRMED. THE NUMBER BELONGS TO A DIFFERENT ARM.** [MEASURED]

95.7% is from `D10-FINDINGS.md:448` and describes **a campaign treatment arm** (473/494), against a
**baseline of 74.1%** stated in the same sentence. On this tree, at baseline, pooled 3 seeds,
canonical days that contain food:

| | passing (n=1,246) | failing (n=365) |
|---|--:|--:|
| touching the 0.5× or 2.0× scale bound | **964 = 77.4%** | **351 = 96.2%** |

So the campaign's *baseline* 74.1% reproduces here as **77.4%**, and 95.7% is the arm, not the
population. But the conclusion is right, and there is a sharper way to say it:

```
P(fail | day touches a bound)      = 351 / 1315 = 26.7%
P(fail | day touches NO bound)     =  14 /  296 =  4.7%
base rate of failure                = 365 / 1611 = 22.7%
```

> **Pinning's ABSENCE is a strong pass signal (95.3% pass). Pinning's PRESENCE is nearly
> uninformative (73.3% still pass, against a 77.3% base rate).** As a failure diagnostic it moves
> the posterior by 4 points. **Do not build a diagnosis, a warning, or a lever-priority on it.**

### 7b. "`SCORE_WEIGHTS` is structurally inert; `dayTolerance` is the real best-of-5 key"

**BOTH CONFIRMED — and the proof is two independent structural facts, not a measurement.**
[MEASURED on the source; W3-3's counterfactual is the empirical leg]

```
mealSolver.js:127   const SCORE_WEIGHTS = { kcal: 0.46, protein: 0.3, fat: 0.12, carb: 0.12 };
                    → consumed ONLY by scoreDay(), which produces matchPct → scoreWeek.avgMatch

mealSolver.js:611   const ok = dayInTolerance(tol);        // tol = dayTolerance(target, exactTotals)
mealSolver.js:613   if (ok) daysInTolerance++;             // ← the metric, and the selection key

mealSolver.js:686   || score.daysInTolerance > best.score.daysInTolerance     ← PRIMARY key
mealSolver.js:690-692  ... && score.avgMatch > best.score.avgMatch            ← TIE-BREAK only
mealSolver.js:697   && best.score.daysInTolerance === best.score.days.length
                    && best.score.avgMatch >= 95 ... break;                   ← early exit
```

1. `avgMatch` is reached **only** when `daysInTolerance` is already tied. Re-weighting changes
   *which* of several equally-compliant weeks wins — it cannot change how many days are compliant.
2. The early exit's `avgMatch >= 95` clause is gated behind `daysInTolerance === days.length`, i.e.
   an already-perfect week. Nothing further can improve the metric, so an earlier or later break
   cannot move it either. (The one theoretical residue — a different attempt count perturbing a
   later window's shared variety ledger — is **structurally unreachable on this population**:
   all 250 personas are 1-day or 1-week, so `twoPass` fires on 0.0% of slots.)
3. W3-3's empirical leg: the tie-break decides **40.1% of winners** (four times as often as the
   primary key), and selecting on `avgMatch` alone **loses 36 days and gains 0**.

**Verdict: C8 = 0.00 is a proof, not a measurement.** Do not spend on `SCORE_WEIGHTS`. The lever
that actually decides best-of-5 is `dayTolerance` — which is also the ruler — which is why W2-1's
"the ruler is one `Math.max` from being the objective" is the load-bearing observation in that lane.

---

## 8. THE TREE COLUMN — the comparability finding nobody has priced

**Every number in this fleet was measured against the fat/carb prescription committed at HEAD.
The working tree carries an uncommitted rewrite of it.** `backend/src/lib/bmrEngine.js`
(+145/−25) replaces the LBM-anchored fat band `lbm × 0.34…0.40` with an **energy-anchored** one
(`FAT_PCT_ENERGY_MID = 0.25`, half-width 3/37, hard-floored at `0.30 × lbm` on **every published
edge** via a new `fatBandFor()`), and carbs are the leftover, so **the carb band moves too**.

### Fidelity check first [MEASURED]

I extracted `git show HEAD:backend/src/lib/bmrEngine.js` and the working-tree copy into
`fleet/scratch/W4-3/`, then re-ran `computeMacros(profile, startWeightKg, energy.targetKcal)` for
every persona-day in the three canonical dumps:

> **HEAD reproduces the stored target on 1,917 / 1,917 records — 0 mismatches.**
> That *proves* (not assumes) which ruler the fleet was measured on.

### What the uncommitted change does, holding every shipped plate byte-identical [MEASURED]

| | HEAD ruler | **working tree** |
|---|--:|--:|
| **canonical 553, pooled 3 seeds** | 1246/1659 = **75.11%** | 1215/1659 = **73.24%** |
| satisfiable-judged 537 | 77.34% | 75.42% |
| planned − degenerate 639 | 68.18% | 65.94% |
| **paired flips** | — | **b = 115 (pass→fail), c = 84 (fail→pass)**; \|b−c\| = 31 vs A5 floor 27.65 → **REAL at 95%** |

**The level moves −1.87 pt. The composition moves 12.0%** — 199 of 1,659 day-verdicts change.

| | HEAD | working tree |
|---|--:|--:|
| fat-band midpoint vs HEAD (250 personas) | — | **UP for 141, DOWN for 104**, same for 5 |
| carb-band midpoint | — | **DOWN for 141, UP for 85**, same for 24 |
| mean fat-band width | 11.48 g | 10.70 g |
| **`fat-under` failing days (pooled)** | **0** — W1-3's "fat-short alone: 0 days at every denominator" | **35** |
| compliant days above AMDR 35 %E, **non-keto** | 43 pooled = **14.3/seed** | 11 pooled = **3.7/seed** |
| compliant days below `0.30 × lbm` essential fat | 1 | 1 |
| keto | 102/174 = 58.6% | 102/174 = **58.6% (unchanged)** |
| paleo | 41.7% | **22.2%** |
| halal | 100% | **66.7%** |
| kosher | 50.5% | **58.1%** |
| vegetarian | 62.0% | **66.1%** |
| none | 88.6% | 86.4% |

**Three consequences the fix plan must carry:**

1. **The one-sidedness of the failure is a property of HEAD's ruler, not of the solver.**
   `fat-under` goes from *structurally zero* to 35 pooled days. W1-3's "fat-only misses 48/48
   OVER" and W1-6's "one day in 120 is fixable by adding" describe HEAD. **On the working tree the
   trim arm's design premise is weaker** — still dominant, but no longer near-total.
2. **The rewrite subsumes ~74% of what W3-1's E35k was for.** E35k's entire justification is
   "Ruler A certifies days whose fat exceeds every published reference." That count drops
   **14.3 → 3.7 non-keto days/seed** for free, because the new graded window sits at roughly
   **16.7 – 33.3 %E** by construction (`0.669×` to `1.331×` a 25 %E midpoint) instead of straddling
   AMDR. **Shipping both would double-book the correctness argument.**
3. **Paleo and halal are the casualties** — exactly the diets W3-1 predicted a %E ceiling would
   hurt. −19.5 pt and −33.3 pt respectively, both far past any MDE. These are per-diet cells with
   small n (24 and 12 days/seed), so treat as direction, not magnitude.

⚠️ **This is a RE-GRADE, not a re-solve.** The solver would aim at the new bands and recover part
of the loss; the true post-change baseline requires re-running `dayDump.mjs`. **Nobody should quote
73.24% as the new baseline** — it is the bound on how much a fixed set of plates loses when the
ruler moves under it, and the honest headline is the **12.0% verdict churn**, not the −1.87 pt.

### One further tree hazard, unmeasured

`frontend/src/components/PlanTab.jsx` (+192/−…) and a new
`backend/prisma/migrations/20260802034419_plan_verdict_persistence/` are also uncommitted. The
migration name says a day-verdict column is being added — which would close W1-4's E2 and unblock
W2-5. **No fleet number depends on either, but W5-1 must not describe E2 as open without checking
whether that migration has landed.**

---

## 9. RESIDUAL — three things that did not close

1. **The campaign's 578-day population cannot be reconciled to this fleet's 640.** Its DB is
   unrecoverable. Everything inherited from it is a *level* on a different substrate. **Cite the
   campaign for mechanism, never for magnitude.** [declared irreconcilable]
2. **W1-5's B7 comparison mixes instruments.** "Pool ceiling 57.26% vs solver 6.2%" puts a locally
   measured exhaustive slot count next to **the brief's 6.2%**, measured elsewhere. W1-5 flags the
   nominal-vs-carry-forward caveat but not the cross-instrument one. The 2× headroom conclusion is
   directionally safe; the ratio is not a measured ratio. [MODEL ARITHMETIC on one side]
3. **`495` will keep being ambiguous** until someone renames A24's bucket. Recommend
   **"SAT-certified 495"** always written with the word *certified*, and the brief's 495 retired in
   favour of A3's 526 (which at least has a stated proof rule).
