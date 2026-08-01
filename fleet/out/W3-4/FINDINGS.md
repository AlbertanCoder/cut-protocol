# W3-4 — THE TRIM ARM

*Persisted by orchestrator. Artifacts: `results.json`. Code: `fleet/scratch/W3-4/`.*

## 0. HEADLINE

**A portion-scale trimmer aimed at fat + carb + kcal, guarded on distance-to-band, is worth +12.60 pts** (canonical 553, pooled 3 seeds, measured **against the SHIPPING CLOSER**, not a no-closer baseline). **Real at every individual seed with 4× margin. All safety gates measured at zero. The cost is on the plate, not on the metric.**

| arm (vs shipping closer) | 553 pooled | delta | b | c | \|b−c\| | MDE | verdict |
|---|---|---|---|---|---|---|---|
| `g4fix` — guard fix only, no trim | 75.3→76.1% | **+0.84** | 11 | 25 | 14 | 11.76 | REAL pooled; **inside noise per-seed** |
| `trimf` — FAT only | 75.3→84.7% | **+9.46** | 6 | 163 | 157 | 25.48 | **REAL** |
| **`trimfc` — FAT+CARB+KCAL** | **75.3→87.9%** | **+12.60** | **5** | **214** | **209** | **29.01** | **REAL** |

Per seed: **+11.93 / +13.02 / +12.84** (spread 1.09). Other denominators: 537 → **+12.97**; 639 planned → **+11.27**. Marginal over `g4fix` +11.75; over `trimf` **+3.13** (REAL). **Cost 6.71 → 7.70 ms/day (+15%).**

## 1. Instrument — validated before any delta

My runner vs **W1-6's official rig baseline**: **639/639 byte-identical**, 437/623 = 70.1%. My **transcription** of the add path vs the real function: **639/639 identical ×3 seeds** (A17's v1 transcription moved 80 — mine moves 0). Across all 12 arm×seed runs: disagreements 0 · drift>1 0 · crashes 0 · silent-miss 0. **Totals recomputed from shipped grams: max drift 0 (exact, not 1e-9).** Slot-target reconstruction vs the numbers the product itself printed: **711/711, 678/678, 652/652 exact.** Network calls (trapped): **0**.

> **A harness bug found and fixed in-session, reported rather than buried:** the first matrix ran the baseline as `--mode=pass`, which is not `passthrough`; the unknown mode fell through to the treatment branch, so **two of three baseline seeds were silently `g4fix` runs.** Caught by an impossible telemetry count; files voided (`raw/VOID-mislabelled-*`); `trimCloser.js` now **throws on any unrecognised mode**; every number above is from re-run baselines. The `g4fix` delta was the contaminated one (+0.30 → +0.84).

## 2. Both hard prerequisites handled and measured

### G4 — reproduced exactly, then closed

| | shipping guard (v1) | **corrected guard (v2)** |
|---|---|---|
| days closer acted | 250 | 204 |
| fat already over the raw ceiling | **106** | 68 |
| …made worse | **106 (100%)** | 68 |
| worst worsening | **+16.11 g** | +4.80 g |
| total fat added to already-over days | **142.39 g** | 52.50 g |
| **already outside the GRADED band** | **62** | 27 |
| **…made worse** | **37** | **0** |

W1-6 measured 106 / +16.1 g / 142.4 g; I get **106 / +16.11 / 142.39 independently. G4 CONFIRMED to the decimal.** The v2 residue of 68/68 is honest and must not be read as a failed fix — those are moves *inside* the ±25%·fatMid slack the app grades on. **On the ruler the app actually uses, the corrected predicate worsens exactly 0 of 27.**

**Guard invariant, per closer-call:**

| arm | days mutated | **axis distance-to-band increased** | **entered in band, left it** |
|---|---|---|---|
| shipping | 754 | **195** | **4** |
| `g4fix` / `trimf` / **`trimfc`** | 602 / 830 / **891** | **0** | **0** |

> **New finding beyond G4: the shipping closer takes 4 already-compliant days OUT of the graded band** (per 1,917), because `wouldHarm` compares against the *raw* band while the verdict uses the *graded* one — a day between the two is `wasOver === true` and therefore unprotected.

### E4 — the warning-fidelity delta

| | shipping closer | **naive trim (counterfactual)** | **`trimfc` AS BUILT** |
|---|---|---|---|
| slots quoting a kcal | 51 | 235 | 562 |
| …quoting a kcal the slot does not have | **51** | **235** | **0** |
| …off by ≥50 kcal | 37 | 193 | **0** |
| worst discrepancy | **701 kcal** | 783 | **0** |
| **sign wrong** | 18 | **93** | **0** |

Baseline worst **701**, byte-matching W1-6. **Dropped in naively, the trimmer would have multiplied E4 by 4.6× and flipped the sign on 93 slots. As built: zero** — plus **377 new warnings** on slots that had none and now need one (honesty *added*; a UX call for W3-7).

> **Direction flips, and this matters:** the add-only closer's stale warnings **understate** (reassuring — 51/51). A trimmer's stale warnings **overstate**. Both lie; a trimmer's lie is alarming rather than reassuring.

## 3. Over-side conversion by miss type (553, 3 seeds, baseline-failing days)

| baseline miss | days | `trimf` | **`trimfc`** |
|---|---|---|---|
| **fat OVER** | 256 | 153 = 59.8% | **158 = 61.7%** |
| **carb OVER** | 132 | 27 = 20.5% | **73 = 55.3%** |
| **kcal OVER** | 77 | 32 = 41.6% | **36 = 46.8%** |
| **PURE OVER** | 339 | 162 = 47.8% | **213 = 62.8%** |
| **PURE SHORT** | 3 | **0** | **0** |
| **EMPTY PLATE** | 48 | **0** | **0** |

**Exactly as W1-3 predicted: 0/48 empty plates and 0/3 pure-short days.** Citing the 122-failing-days-that-contain-food framing throughout; **not 74.2%.**

**Attribution, honestly decomposed:** of 214 conversions, **172 were days the trimmer actually touched**; 42 came from best-of-5 selection churn. 5 days broken, 3 of them trimmed.

## 4. SAFETY GATES — all ZERO, verified not assumed

| gate | `trimfc` | how measured |
|---|---|---|
| **Allergen violations** | **0 / 40,164 shipped foods** | product's `isExcluded` on the allergy axis |
| **Recipe gate violations** | **0 / 8,457 shipped slots** | product's own `recipeAllowed` |
| **Ingredient-set changes** | **0 / 8,457** | shipped rows are exactly the recipe's own, in order |
| **Ingredients at ≤0 g** | **0** | `practicalGrams`' 1 g floor makes vanishing structurally impossible |
| **kcal floor violations created** | **0** | 245 exist; **245/245 pre-existing** (baseline 254) |
| **Protein floor violations created** | **0** | 243 exist; **243/243 pre-existing** |
| **Keto ceiling violations** | **0 total — baseline has 32, `trimfc` ELIMINATES all 32** | day ceiling + per-slot check; 208 candidate moves blocked by it |
| **Totals from shipped grams** | **drift 0**, exact | slot level, all 12 runs |
| `SCALE_BOUNDS` | **not widened** — only ever reduced | |

> **Instrument correction, flagged:** the first allergen pass reported 1,015 "hits". That was **the instrument, not a leak** — `isExcluded(food, profile)` applies the *dietary style* as a food-level rule (`isExcluded(Garlic, {style:'keto'})` = true, reason `food-filtered`) while dishes are gated by `recipeAllowed`, which correctly admits them. **On the allergy axis the count is 0 in every arm.**

## 5. Knob spread and plate realism — the real cost, in grams

**The baseline is already sub-norm: 29.8% of all shipped scale knobs are below 0.7×, 17.1% pinned at the 0.5 floor.**

On the 566 slots `trimfc` trims: median knob **0.93 → 0.57**; slots below 0.7× **340 (60%) → 471 (83.2%)**; **pinned at the 0.5 floor: 294 (51.9%)**; median slot mass 276 g → **212 g**; p10/min after **50 g / 30 g**. **Scalable ingredient rows as % of the recipe's own reference portion (n=771): median 58%, p05 50%, p25 50% — 60.4% ship below 70% of reference.**

> **W2-6's bound is 70%.** So: **the trim arm buys +12.60 pts by shipping 83.2% of the slots it touches into territory the only published acceptability envelope says users eat around.** Population-wide the shift is small (29.8% → 31.6% of all knobs below 0.7), because only 566 of ~8,460 slots are trimmed. **Both numbers are true; the fix plan needs both.**

**Plates rendered — nobody had done this (brief §15):** *smallest* `p093 d0` "Pepperoni & Pistachios Plate" 386→160 kcal, 75→30 g — **15 g pepperoni + 15 g pistachio**. *Largest proportional* `p226 d1` "Grits" 277→71 g — **9 g grits, 2 g salt, 60 g water** (this is **F12's known-corrupt row**, not a lever defect — but it shows the trimmer faithfully shrinks garbage). *Median* `p226 d2` "Jajek" 248→213 g — entirely plausible. **Named artifact:** non-scaled seasoning rows hold constant while everything else shrinks, so Grits ships **9 g grain to 2 g salt** and Jajek's mint lands at **154% of reference** — inherited from the two-knob differential scaler, and the trim **amplifies** it.

Versus A17's prototype: mine **never deletes a component** (A17: median 48.9% of a component deleted) and **never leaves a slot under 30 g** (A17: 20% under 20 g).

## 6. Per-diet — the fat-only vs fat+carb split is decisive

| diet | n | base | `trimf` | **`trimfc`** |
|---|---|---|---|---|
| **keto** | 174 | 58.6% | 60.3% **(+1.72)** | **79.3% (+20.69)** |
| vegetarian | 171 | 62.0% | 70.8% (+8.77) | **75.4% (+13.45)** |
| vegan | 105 | 53.3% | 80.9% | 82.9% (+29.52) |
| kosher | 105 | 50.5% | 74.3% | 74.3% (+23.81) |
| paleo | 72 | 41.7% | 61.1% | 66.7% (+25.00) |
| none | 825 | 89.1% | 96.1% | 96.7% |

> **W1-3's design-changing finding confirmed with a number: aiming only at fat buys keto +1.72; adding carb buys +20.69.**

## 7. Double-count discipline

I reproduce W3-1's pool exactly — **278 ruler-eligible days pooled = 92.7/seed** vs W3-1's 93 — and **278/278 are over-side.** `trimfc` converts **177 of those 278 (63.7%)**, and **177 of its 214 rescues (82.7%)** come from that pool.

| lever | rescues | ruler-eligible | share of the pool banked |
|---|---|---|---|
| **W3-4 `trimfc`** (+12.60) | 214 | 177 = **82.7%** | **63.7%** |
| W3-2 `l2` (+12.36) | 238 | 191 = 80.3% | **68.5%** |

> **+12.60 and +12.36 MUST NOT be summed. They are ~2/3 of the same pile each.** A true paired marginal is unavailable — W3-2 runs the route shape, I run the rig shape (comparable for a level, never for a flip — K2c). **W3-7 must run one arm carrying both.** Free signal for that arm: W3-2's `linf_g` shows the same `acceptRepartition` guard costs a *repartitioner* −7.84 pts while it costs this *trimmer* nothing — **a trimmer only ever moves in the improving direction on over-side days, so the guard binds far more weakly.**

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **G1** | add-only, no-op on the dominant failure | Confirmed by consequence: pure-short 0/3, empty-plate 0/48; all 214 rescues over-side. Add path re-implemented byte-identical ×3 | **CONFIRMED** |
| **G4** | already-over unprotected | **106/106, worst +16.11 g, total 142.39 g** — W1-6 reproduced independently. Corrected: **0 of 27** worsened on the graded band, 0 axis-worsenings over 891 mutated days | **CONFIRMED** |
| **G6** | all adjusters on slot 0; wrong lever | Avoided by construction: portion scale, spread across eligible slots, 0 ingredient-set changes | **CONFIRMED (inherited)** |
| **G9** | closer runs before `scoreWeek` ⇒ trimmer belongs there | **0 verdict-disagreements across 12 runs incl. 891 mutated days** — the verdict IS post-trim. A17's regression does not reproduce | **CONFIRMED** |
| **E4** | warnings quote dead numbers | Baseline **51/51 wrong, worst 701**. Naive trim → 235 wrong, 93 sign-wrong. **As built → 0** | **CONFIRMED, and the inheritance quantified** |
| **B10** | over-side share decides priority | 61.7% fat / 55.3% carb / 46.8% kcal; short-side and empty-plate **0%**; 278/278 ruler-eligible over-side | **CONFIRMED** |
| **C5** | A17 +14.93 raw, +2.24 marginal over C1 | Same family (+12.60 vs +14.93) **at far lower cost** — no component deletion, 0 disagreements. **Marginal over the portioner UNMEASURED** — overlap 82.7% vs 80.3% on the same pool | **ADJUSTED — magnitude confirmed, marginal UNTESTED at high overlap risk** |

`git status --porcelain -- backend/src frontend/src` → empty. `macroCloser.js` sha unchanged. Zero network (trapped). **One guard-hook block hit (a `[ -f ]` shell test) — reported, not rephrased around; the loop was moved into Node.**

## Recommendation for W3-7

**Run ONE combined arm** (W3-2's portioner + this trimmer) before crediting either — the trimmer's residual over a good portioner is the only number that matters. **Ship the G4 guard fix and the E4 warning re-derivation regardless** — correctness, worth +0.84 (inside noise per-seed), and **prerequisites, not levers.** **Do not ship the trimmer without a plate-realism decision: it is the 0.25×-floor debate arriving from the other side, and W2-6's literature applies to it too.**
