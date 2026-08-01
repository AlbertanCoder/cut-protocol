# D2 — the slot loop: targeting, day assembly, search strategy

*Territory: `backend/src/lib/weeklyPlanner.js`'s `solveDay`/`resolveSlot` loop, plus the
day/week/horizon layering above it. NOT `scaleRecipe`'s algebra (D1), NOT `macroCloser.js` (D3).*

**Headline.** The within-day slot chain is solved in the order `buildSlots` emits it —
all meals, then all snacks (`weeklyPlanner.js:145-157`). That puts the **smallest** slot
(snack, weight 0.4) **last**, where it must absorb the day's accumulated residual with the
least capacity to do so. Solving the same slots **smallest-first** instead — a one-line
reordering that changes no target, no gate, no pool and no ruler — is worth
**+8.77 / +8.40 / +7.65 points satisfiable-only at three seeds** (b=15/17/14, c=62/62/55;
all three paired 95 % intervals exclude zero and clear C14's 3.5-pt floor), while running
**8.4 % fewer candidate draws** than the baseline. Days finishing above `fatHi` fall
290 → 195; total fat delivered above `fatHi` falls 4376 g → 2991 g. The denominator does
not move (622 judged, 3011 slots, 2818 filled, 193 unfilled — identical in both arms), so
this is not C21's self-scoring trap.

---

## 0. Provenance, and why you may believe the numbers

| | |
|---|---|
| DB | `solver-brain/D2/dev.db`, **plain-copied from `A1/dev.db`**, `sha256:16 = e55f52e53658a086` — the fleet baseline, not the moved live DB (C18). Live DB verified still `d9037dce9754b452`, mtime 07-31 05:53, untouched by me. |
| Rig | `solver-deepdive/D2/D2-run.mjs`, a fork of `A1/rig/runRig.mjs` with two additions only: `globalThis.__D2_PERSONA` and a per-persona telemetry drain. |
| **Rig no-op proof (MEASURED)** | My baseline is **byte-identical to `A1/A1-baseline-s424242.jsonl` on 639/639 day records** (`run` header and `solveMs` excluded). 434/622 = 69.8 % all-days, 413/536 = 77.1 % satisfiable — A1's and A18's exact figures. |
| Instrumentation | `D2-hook.cjs` — the A18 technique: `Module._extensions[".js"]` rewrites source **text in memory**, 11 anchors, fails loud (exit 3) if any anchor is not present exactly once. `backend/src` never opened for write; `git status` on `backend/` shows only the `M` flags that predate this session (mtimes 2026-07-30), and `weeklyPlanner.js`/`mealSolver.js` are untouched. |
| Instrument checks | verdict-disagreements 0, kcal-drift>1 0, crashes 0, invalid records 0, **silent-miss 0** on every run reported here. |
| Population | the 250 `qa-fleet-20260729-2032` personas. **185 ask for 1 day, 65 for 1 week; 0 ask for a multi-week horizon; 0 carry locked slots; 0 enable batch repeats.** That gap is §8. |

**Independent re-grade (the verification-shape rule).** The campaign has twice produced
cross-checks that agreed with a defect because they reused the system's own helpers
(C20). So the headline was re-graded with a band rule re-derived by hand from C1's spec
(miss as a fraction of the band **midpoint**; 15/15/25/25), importing nothing from
`mealSolver.js`:

| | product grader | my independent grader | agreement |
|---|---|---|---|
| base | 413/536 = 77.1 % | 417/536 = 77.8 % | 532/536 |
| order-asc | 460/536 = 85.8 % | 467/536 = 87.1 % | 529/536 |
| **delta** | **+8.77** | **+9.33** | — |

Same sign, same magnitude. The residual 4–7 day disagreement is the keto carb branch
(zero upward allowance), which I deliberately did not reimplement.

---

## 1. The current algorithm, end to end

### 1.1 Horizon → windows → weeks

`generateHorizonPlan` (`mealSolver.js:1173`) splits N calendar days into per-week
day-index windows via `horizonWindows` (`:942`) and calls `generateBestWeekPlan` once per
window. Between windows it narrows the pool by the horizon repeat cap
(`:1218-1220`, admission ceiling at `:1208`) and builds `priorUsage` from the weeks
already solved plus the user's plan history (`:1236`). **For every persona in the graded
population there is exactly one window**, so everything cross-window is untested here.

### 1.2 Best-of-N week (`mealSolver.js:655-759`)

- `attempts = options.attempts ?? 5` (`:658`).
- Each attempt is a full `generateWeekPlan` with `aiFallback` stripped (`:679`).
- Selection (`:685-691`): `daysInTolerance` first, then (protein-priority mode only)
  `floorDaysMet`, then `avgMatch`. `SCORE_WEIGHTS` enters only through `avgMatch`, which
  is why A18 measured it at exactly 0.00 pts — **confirmed, do not re-sweep it.**
- Early break (`:696-697`): every day in tolerance **and** `avgMatch >= 95`.
- MEASURED at seed 424242: of 249 windows, **130 run 1 attempt, 96 run all 5**; the
  winner is attempt 0 for 160 windows and a later attempt for 89. Total week solves 669.
- MEASURED, the price of the greedy pass: `attempts=1` scores **376/536 = 70.1 %**
  satisfiable against `attempts=5`'s 413/536. Best-of-5 buys **+6.90 pts
  [+4.01, +9.79], b=14 c=51** — i.e. the system currently spends ~5× the compute
  re-rolling dice to paper over a day-assembly defect.

### 1.3 Day order inside a week (`weeklyPlanner.js:995`)

`for (const day of shuffled(dayIndices, rng))` — days are solved in **randomised** order
sharing one `usageCount`, then re-sorted to calendar order for the return (`:1002-1003`).
**Consequence nobody has flagged:** `prevDayRecipeIds` (`:1000`) is therefore the
previously-**solved** day, not the calendar-previous day. The `usedYesterday` 0.15
discount in `pickRecipe` (`:279`) is applied against a random other day of the week. It
is a soft discount so nothing breaks, but the rule the code names is not the rule it
implements. (DERIVED, `:995-1001`.)

### 1.4 Slot targets — the split (`weeklyPlanner.js:145-175`)

`buildSlots` assigns **fixed weights**, not meal-config-driven ratios:

| slot | weight |
|---|---|
| meal, only one | 1 |
| meal, first of ≥2 | 0.9 |
| meal, middle | 1 |
| meal, last | 1.15 |
| snack (every one) | 0.4 |

`targetsForSlots` then gives each slot `share = weight / (sum of that day's weights)` and
sets `kcalTarget = dailyTarget.kcal × share`, `proteinTarget = midpoint(proteinLo, proteinHi) × share`.
Fat and carb are **absent** at this layer.

`solveDay` re-derives the split over the *open* slots after banking locks
(`:887-900`), and only there attaches `fatShare`/`carbShare` from
`bandMidpoint(fatLo, fatHi)` and `carbMid ?? bandMidpoint(carbLo, carbHi)` (`:860-863`,
`:891-899`). So a slot target carries fat/carb **only** when it comes through `solveDay`.
`regenerateOneSlot` (`:1010`), `alternatesForSlot` (`mealSolver.js:821`) and
`fillGapsWithBrain` (`:744-746`) all build targets straight from `targetsForSlots` and
therefore solve **fat-blind and carry-blind** — see §3.

### 1.5 Budget propagation — it works, and it is not the problem

At slot *i* (`:906-932`):

```
remainingWeight = Σ weights of slots i..n-1
share           = weight_i / remainingWeight
proposedKcal    = (budgetKcal − dayAchievedKcal) × share
effectiveKcal   = clamp(proposedKcal, nominal_i × 0.7, nominal_i × 1.3)   // CARRY_CAP_PCT = 0.3
```

`dayAchieved*` accumulates the **true** shipped macros (`:940-943`), so the remaining
budget is genuinely live. Fat and carb get the same carry-forward **uncapped**
(`:930-931`).

MEASURED over 3011 shipped slots: the kcal clamp binds **down** on 3.8 % and **up** on
5.0 %; 91.1 % are unclamped. When the down-clamp binds it suppresses a median of 55 kcal
of correction (p90 247, max 766). Protein: 4.6 % down, 8.4 % up.

**Two probes say the carry cap is nearly non-load-bearing (MEASURED, single seed):**

| arm | Δ satisfiable | paired 95 % | b | c |
|---|---|---|---|---|
| `CARRY_CAP_PCT 0.3 → 0` (carry-forward OFF, static shares) | **+0.00** | [−2.93, +2.93] | 32 | 32 |
| `CARRY_CAP_PCT 0.3 → 0.9` (nearly uncapped) | +1.31 | [−0.59, +3.20] | 10 | 17 |

**This contradicts the code's own comment at `:106-111`**, which justifies the mechanism
with *"Monte Carlo, 500 trials, real pool, 2026-07-13: without it day-level kcal p95 ~79 %
off, worst 2.5-3×."* Under current code, turning the entire within-day carry-forward off
costs **nothing measurable** — the macro closer and the staple un-quarantine that landed
since have absorbed whatever it was protecting. Do not spend the fix budget on this knob;
also do not delete it on my one seed alone.

### 1.6 Per-slot search (`resolveSlot`, `weeklyPlanner.js:591-676`)

Greedy, sampling-with-replacement-excluded, **no backtracking anywhere**.

```
attemptBudget = max(5, min(20, poolSize/10))                    // :102-105
passes        = priorUsage?.size ? [priorUsage, null] : [null]  // :607
for each pass:
  for attempt in 0..attemptBudget-1:
     candidates = eligibleRecipes(pool, slotType, usageCount, repeatCap) minus `tried`
     recipe     = pickRecipe(candidates, …)      // weighted random draw
     tried.add(recipe.id)                        // `tried` is SHARED ACROSS PASSES
     scaled     = enforceScaledCarbCeiling(scaleRecipe(recipe, kcalTarget, proteinTarget))
     if !scaled → ceilingRejects++, continue
     worstRatio = max(kcalOff/0.15, proteinShort/0.12)
     best       = argmin worstRatio                              // FAT AND CARB ABSENT
     if kcalOff ≤ 0.15 and proteinShort ≤ 0.12:                  // THE GATE — 2 macros
        if !passUsage && !composed        → SHIP (first fit)
        fits.push({recipe, comp, prior, worstRatio})
        if !passUsage && comp ≤ 0.05      → SHIP (COMPOSITION_GOOD_ENOUGH early exit)
  if fits: sort by (prior, comp, worstRatio) → SHIP fits[0]
if aiFallback → SHIP
if best       → SHIP the closest miss, with a warning              // FAT AND CARB ABSENT
else unsolved
```

**Draw weighting** (`pickRecipe` `:274-292`) multiplies: protein-density proximity
`1/(|Δratio|+0.015)` × same-day repeat 0.02 / yesterday 0.15 / else 1 × user bias ×
`GENERATED_TEMPLATE_WEIGHT` 0.35 for templates × `compositionWeight` (`:251-272`,
`1/(1+4·meanShareDiff)`) × `priorDiscount`.

**MEASURED exit mix, 3011 shipped slots, seed 424242:**

| exit | n | share | median fat delivered vs its own fat ask |
|---|---|---|---|
| `fitsort` (best composition among the fits) | 2092 | 69.5 % | +7.4 % |
| **`closestmiss`** (nothing passed the gate) | 540 | **17.9 %** | **+105.4 %** |
| `unsolved` | 193 | 6.4 % | — |
| `goodenough` (early exit) | 186 | 6.2 % | +0.4 % |
| `ai` | 0 | 0 % (BRAIN=off) | — |

Other measured search facts:

- `composed` is **true on 100 %** of shipped slots. The composition machinery is armed.
- `twoPass` (cross-week memory) is armed on **0 %** — see §8.
- **66.2 % of slots exhaust `attemptBudget` without finding a good-enough fit.**
  Mean 12.1 candidates tried; mean 6.8 fits per composed slot.
- **Only 6.2 % of slots find any candidate within `COMPOSITION_GOOD_ENOUGH` (0.05) of
  their fat/carb ask.** `compBest ≤ 0.05` on 0.0 % of `fitsort` exits by construction (any
  such candidate would have taken the early exit at `:642`); among `fitsort` slots the
  median best-available `comp` is **0.203** — the best of ~7 fits is a median 20 % off.
  The other 24.3 % (`closestmiss` + `unsolved`) had no passing candidate at all. Since
  `passUsage` is null here, `fits.sort` at `:651` reduces to sorting by `comp`, so the
  loop is already choosing the minimum-`comp` fit: **the binding constraint is the
  shortlist, not the choice made from it.**
- All 193 `unsolved` slots have `tried === 0` — nothing was eligible at all (repeat cap ×
  slot-type filter exhausted the pool), 141 of them snacks. **Unsolved is a pool/variety
  problem, not a search-depth problem.** `ceilingRejects > 0` on only 14 slots.

### 1.7 Day close

`closeDayMacros` runs once, after every slot is committed (`:951`). MEASURED: it changes
245 of 640 shipped day-solves (38.3 %); when it fires it adds a median 45.5 kcal and
0.6 g fat, and it is **never negative on any of the 245** — an independent confirmation of
C9 from a different instrument.

---

## 2. Every irrevocable commit point

Ordered outermost-in. None of these is ever revisited.

| # | Commit | Site | Why it cannot be walked back |
|---|---|---|---|
| 1 | **Window pool narrowing** by horizon usage | `mealSolver.js:1218-1220` | A dish spent in window 0 is gone for window 1+, whatever window 1 needs. |
| 2 | **Week attempt discarded** | `mealSolver.js:685-692` | Selection keeps one whole week by `daysInTolerance`; a losing roll's good *days* are thrown away. A19 bounds the loss at **+10.2 pts** (any-roll-in-band 87–89 % vs 77 %); the variety-safe harvest recovers 16 % of it. |
| 3 | **Day order** | `weeklyPlanner.js:995` | `shuffled` is drawn once; the day that got the freshest pool keeps it. |
| 4 | **Locked slots banked** | `:873-882` | Locks consume budget first; if they exceed it the open slots are solved against zero — §5. |
| 5 | **Nominal share** | `:894-900` | Computed once from fixed weights. The split never adapts to what the pool can actually deliver into a slot of that size (§4). |
| 6 | **`tried` is monotone across both passes** | `:595`, `:611` | A candidate rejected in pass 1 can never be reconsidered in pass 2 — the pass-2 doc comment at `:568-570` promises a dish "comes back", which is only true if it was never drawn. |
| 7 | **`usageCount` incremented on ship** | `:603`, `:662`, `:510` | Even a warned closest-miss consumes a slot of that dish's weekly allowance. Only `fillGapsWithBrain` (`:802-805`) ever refunds one. |
| 8 | **THE SLOT SHIPS** | `:633`, `:642`, `:652`, `:668` | This is the one that matters. Once `ship()` returns there is no operator anywhere that can un-choose a dish or re-scale a *previous* slot. Every later slot can only add. |
| 9 | **Closest-miss ranked on 2 macros** | `:628-629`, `:661-671` | `worstRatio = max(kcalOff/0.15, proteinShort/0.12)`. `best` is chosen before fat/carb exist in the expression. 17.9 % of shipped slots take this path. |
| 10 | **The day closes** | `:951` | `closeDayMacros` can only ADD (C9, re-confirmed §1.7). A day that has overshot is finished. |
| 11 | **A swap** | `:1007-1033`, `mealSolver.js:821-863` | `regenerateOneSlot`/`alternatesForSlot` solve against the **static** nominal share with **no** fat/carb target and **no** knowledge of what the rest of the day achieved. `hasCompositionTarget` is false, so it is first-fit-wins. Swapping one slot cannot rebalance the day and does not try. |
| 12 | **Brain gap-fill** | `:739-822` | Targets are recomputed from `targetsForSlots` (`:744-746`) — again static shares, no fat/carb, no carry. A brain-filled gap is sized for a day that may already be 400 kcal over. |

### Why a greedy forward pass overshoots — the measured chain

1. **The gate is 2-macro; the verdict is 4-macro.** `resolveSlot` admits on kcal ±15 % and
   protein-shortfall ≤12 % (`:630`). Fat and carb never gate anything; they only *rank*
   candidates that already passed (`:634`, `:651`). This is C8, and it is the precondition
   for everything below.
2. **Scaling cannot change a dish's fat-per-kcal much.** So the only fat lever is *which*
   dish — i.e. the shortlist.
3. **The shortlist cannot deliver.** Median best-available `comp` is 0.203; only 6.2 % of
   slots find anything within 5 %.
4. **Small slots cannot deliver at all.** MEASURED, by the slot's nominal kcal:

   | nominal kcal | n | unsolved | closest-miss | pinned 0.5× | **median fat vs its ask** |
   |---|---|---|---|---|---|
   | 0–150 | 169 | 32.0 % | 40.8 % | 45.6 % | **+108.1 %** |
   | 150–250 | 550 | 11.5 % | 34.0 % | 51.1 % | **+89.1 %** |
   | 250–350 | 463 | 6.0 % | 23.1 % | 26.8 % | +21.4 % |
   | 350–500 | 678 | 4.6 % | 11.1 % | 15.0 % | +6.8 % |
   | 500–700 | 708 | 1.4 % | 8.5 % | 12.0 % | +1.5 % |
   | 700+ | 443 | 1.6 % | 9.5 % | 10.2 % | −2.6 % |

   A slot under ~250 kcal is a different product from a slot over 500. Below 250 the
   library has nothing that fits inside the 0.5× floor, so the slot either empties or
   ships roughly **twice** the fat it was asked for. This is A2's 0.5×-floor finding
   (C10) resolved to the variable that predicts it.
5. **The closest-miss fallback is where the fat is actually spent.** On the 290 day-solves
   finishing above `fatHi`: `closestmiss` slots are **24.6 % of the slots** but contribute
   **4345 g of the 8443 g (51.5 %)** of slot-level fat overage — 6.6 g/slot against
   1.2 g/slot for every other exit. For scale, the total day-level excess over `fatHi`
   across those days is **4244 g**. The fallback alone spends more than the whole overage.
6. **And the day never recovers.** Cumulative fat on fat-over days, as a ratio of what the
   day should have spent by that point: **1.13 after slot 0 → 1.17 → 1.19 → 1.26 → 1.29 →
   1.32 → 1.40**. Monotone. The fat carry-forward at `:930-931` re-ranks correctly (238
   slots are solved with `fatTarget` already floored to 0) but still ships a median
   **8.4 g** into a budget of zero, because ranking a shortlist that contains nothing lean
   cannot produce a lean dish.
7. **The worst offender is scheduled last.** `buildSlots` appends snacks after meals, so
   the 0.4-weight slot — the one that structurally cannot hit its fat ask — is solved when
   the budget is already spent and **nothing comes after it to compensate**. Meanwhile the
   1.15-weight meal, which lands within ±1.5 % of its fat ask and has 500–700 kcal of
   absorption capacity, is solved third of four, before the error exists.

   Per-config, MEASURED (median fat delivered vs the slot's own ask):

   | config | pos 0 | 1 | 2 | 3 | 4 | 5 |
   |---|---|---|---|---|---|---|
   | 3m+2s | +1.5 % | +3.6 % | +3.9 % | **+64.5 %** (snack) | **+123.5 %** (snack) | — |
   | 4m+1s | +1.3 % | +6.6 % | +3.6 % | −0.7 % | **+44.9 %** (snack) | — |
   | 5m+1s | +0.9 % | +2.2 % | +10.1 % | +15.1 % | +15.6 % | **+105.2 %** (snack) |

8. **There is a last-slot penalty over and above size.** Matched on nominal kcal, last
   slots vs every other position: unsolved 14.3 % vs 9.2 % (150–250 kcal), 8.2 % vs 5.2 %
   (250–350), 10.6 % vs 3.9 % (350–500); closest-miss 32.0 % vs 7.6 % (500–700). The last
   slot faces both the depleted variety ledger and the residual budget.

---

## 3. The fix that follows, measured

**Solve the day's open slots in ascending weight order** — equivalently, snacks before
meals. Baseline already emits meals in non-decreasing weight (0.9, 1, …, 1.15) and then
drops to 0.4 for snacks, so an ascending sort changes **only** snack-bearing days.

Two independent implementations, both measured:

- `openIdx.sort((a,b) => dayTargets[a].weight - dayTargets[b].weight)` before
  `weeklyPlanner.js:887`. Preserves the stored slot array order (`results[openIdx[i]]`).
- Emitting the snack loop before the meal loop in `buildSlots` (`:145-157`).

They produce **identical results** (+8.77, b=15, c=62, same discordant days) — the
mechanism is the solve order and nothing else.

| arm | seed | satisfiable | Δ pts | paired 95 % | b | c |
|---|---|---|---|---|---|---|
| order-asc | 424242 | 413 → 460 / 536 | **+8.77** | [+5.65, +11.89] | 15 | 62 |
| order-asc | 20260730 | 417 → 462 / 536 | **+8.40** | [+5.22, +11.57] | 17 | 62 |
| order-asc | 8675309 | 418 → 459 / 536 | **+7.65** | [+4.68, +10.62] | 14 | 55 |
| **pooled** | 3 seeds, n=1608 | | **+8.27** | [+6.49, +10.05] | **46** | **179** |

**The dose-response is the proof of mechanism.** Sliced by snacks/day (seed 424242):

| snacks/day | days | base | arm | Δ pts | b | c |
|---|---|---|---|---|---|---|
| 0 | 122 | 80.3 % | 80.3 % | **0.00** | **0** | **0** |
| 1 | 272 | 75.4 % | 78.7 % | +3.31 | 9 | 18 |
| 2 | 172 | 57.6 % | 76.2 % | **+18.60** | 5 | 37 |
| 3 | 56 | 57.1 % | 71.4 % | +14.29 | 1 | 9 |

Zero effect, zero churn, on exactly the days where the treatment is a no-op. Everything
else scales with the number of small slots.

**Integrity (all MEASURED, seed 424242):**

| | base | order-asc |
|---|---|---|
| judged days / planned days | 622 / 639 | 622 / 639 |
| slots total / filled / **unfilled** | 3011 / 2818 / **193** | 3011 / 2818 / **193** |
| silent misses | 0 | 0 |
| days above `fatHi` · total g above `fatHi` | 290 · 4376 g | **195 · 2991 g** |
| fat-over / fat-short miss days | 97 / 1 | **64 / 1** |
| carb-over / kcal-over miss days | 90 / 28 | 80 / 17 |
| **warned slots** | 733 | **780 (+6.4 %)** |
| slots pinned at 0.5× | 25.3 % | 28.0 % |
| candidate draws · week solves | 104 812 · 669 | **96 042 · 616** |

Two costs that may not be dropped:

1. **Warned slots rise 733 → 780** while day misses fall. Same character as A13's cost
   (C23): the per-slot warning is generated by a 2-macro gate, so it flags slots the
   4-macro outcome deliberately traded. **More amber on days that now pass.** A shipped
   version should reconcile the slot warning with the day verdict, not just accept it.
2. **0.5×-pinned portions rise 25.3 % → 28.0 %.** Portion realism, not compliance. Worth
   a look before shipping.

### Interaction with the levers already on the table

| arm | Δ satisfiable, s424242 | b | c |
|---|---|---|---|
| A14's `MIN_SLOT_ATTEMPTS 5 → 12` alone | +1.68 [+0.18, +3.18] | 4 | 13 |
| order-asc alone | +8.77 [+5.65, +11.89] | 15 | 62 |
| **both together** | **+9.33 [+6.15, +12.50]** | 15 | 65 |

Sub-additive — 9.33, not 10.45. C14/C23's warning holds; measure the stack, never add the
parts. (My floor12 arm also independently reproduces A14's direction and rough size.)

**The ordering fix is worth MORE without the week re-rolls:** at `attempts=1` it is
**+9.70 pts [+6.33, +13.07], b=19 c=71**, and `order-asc @ attempts=1` (428/536 = 79.9 %)
**beats baseline @ attempts=5** (413/536 = 77.1 %). One correctly-ordered greedy pass beats
five wrongly-ordered ones. Best-of-N has been partially masking this defect, at 5× the cost.

---

## 4. Where a deeper fix has to go, if +8 is not enough

The ordering change removes the *scheduling* of the defect. It does not remove the defect:
a sub-250 kcal slot still ships ~2× its fat ask; the ordering just puts capacity behind it.
The three structural levers left in my territory, in descending measured value:

1. **Give the closest-miss fallback a fat/carb term** (`:628-629`, `:661`). This is A18's
   `s-fallbackcomp`, measured at +0.75 pts at two seeds, both intervals spanning zero —
   *unresolved, not small*. My §2.5 explains why it should be bigger than that reads:
   the path carries 51.5 % of all slot-level fat overage. A18 changed only the *rank*
   among losers; the fat is spent because every loser is fat-heavy, which points at
   widening the shortlist for those slots rather than re-ranking it.
2. **Adaptive slot sizing.** `buildSlots`'s weights are constants. A day whose pool has
   nothing under 350 kcal should not be asked for a 190 kcal snack; the honest options are
   to fold the snack's budget into the meals or to declare it. Nothing in the code can
   currently do either. Untested.
3. **A day-level trimmer / re-solve.** A13 and A17 both reach ~+15 pts by *reducing*
   over-band days (C23 — the same effect twice). My cumulative-fat path (§2.6) says the
   day is already 13 % over after slot 0, so a trimmer and the ordering fix are attacking
   the same mass from opposite ends. **Do not add +8.3 and +15.** Measure the combination.

---

## 5. Locked slots, variety caps, batch cooking

### 5.1 A real defect in the locked path — the gate silently disarms

**Zero of 250 personas carry a locked slot**, so this is invisible to every fleet number.
Probed directly (`D2-lockprobe.mjs`, 910-recipe pool, 2000 kcal / 140–160 P / 55–65 F day,
3 meals + 1 snack, `solveDay` called directly):

| scenario | day total | fat | open slots warned |
|---|---|---|---|
| no lock (control) | 1996 kcal (−0 %) | 64 g (band 55–65) | 0 |
| lock meal#0 at 1200 kcal (60 % of day) | 2001 kcal (0 %) | 62 g | 0 |
| **lock meal#0 at 2000 kcal (100 %)** | **2953 kcal (+48 %)** | **123 g** | **0** |
| **lock meal#0 at 2600 kcal (130 %)** | **3553 kcal (+78 %)** | **153 g** | **0** |

The mechanism (DERIVED, verified by the probe):

- `budgetKcal = Math.max(0, dailyTarget.kcal − lockedKcal)` (`:889`) floors at 0, so every
  open slot gets `kcalTarget = 0` and `proteinTarget = 0`.
- `kcalOffPct` returns **0** when `target <= 0` (`:420-422`); `proteinShortfallPct` does
  the same (`:426-428`). **The accept gate at `:630` therefore passes unconditionally.**
- `budgetFat`/`budgetCarb` floor to 0 too, so `fatShare = carbShare = 0`,
  `hasCompositionTarget` is false (`:451`), `composed` is false — and the branch at `:633`
  **ships the very first candidate drawn**.
- `targetRatio = 0` (`:592`), so `pickRecipe`'s `1/(|ratio−0|+0.015)` term biases toward
  the **lowest-protein-density** dish in the pool.
- Every shipped slot carries `warning: null` (`ship()` at `:602-605`). A 48 %-over day with
  **no slot-level warning at all**. The week diagnosis still fires, so this is not a silent
  miss by the rig's definition — but the slot honesty layer is gone.
- The 100 % and 130 % scenarios produce **identical** open slots: the solver cannot tell
  the difference between "exactly spent" and "30 % over", because both floor to zero.

`routes/plans.js:294-298` filters locked slots only for diet compliance and window
membership. There is **no total-budget guard anywhere**. A user who locks one large meal
reaches this.

MEASURED in the graded population as the closest analogue: 34 shipped slots (1.1 %) were
solved when `dayAchievedKcal` already exceeded `budgetKcal`; all 34 were clamped to the
0.7× floor and asked for a meal the day had no room for.

### 5.2 What the variety contract costs in compliance

| arm | Δ satisfiable | b | c | note |
|---|---|---|---|---|
| `DEFAULT_REPEAT_CAP 2 → 4` (= batch-cooking) | +4.85 [+1.82, +7.88] | 22 | 48 | judged 536 → 540 |
| `DEFAULT_REPEAT_CAP 2 → 999` (no cap) | +8.77 [+5.78, +11.76] | 12 | 59 | judged 536 → 546 |

Single seed each; and **the denominator moves** (previously-empty slots get filled, so
previously-unjudged days become judged). Read them as a **bound on what the weekly variety
cap costs**, not as levers — roughly **+8.8 pts is the whole variety contract**, and
batch-cooking already recovers over half of it for users who opt in. Consistent with A19's
finding that the 1.7-vs-10.2-pt gap in day harvesting "is the variety contract, not the
search". 141 of the 193 empty slots are snacks, so the variety cap and the small-slot
problem are the same wound.

Batch cooking is enabled for **0 of 250 personas**, so `BATCH_REPEAT_CAP` (`:62`) is
untested by the fleet; my repeat4 arm simulates it by moving the default.

---

## 6. What a fix must preserve

- **Purity.** `tests/qc/invariants.test.js` "1C purity" forbids `Math.random`, `Date.now`
  and `new Date` in `mealSolver.js` and `weeklyPlanner.js`. Every clock and RNG is
  injected (`:781-785` documents why). Any new tie-break or re-solve must be a pure
  function of `(rng, inputs)`.
- **Determinism / goldens.** Same seed ⇒ byte-identical output. `Array.prototype.sort` is
  stable in V8, so the ordering fix is deterministic; anything using `Set`/`Map` iteration
  order must be ordered explicitly.
- **Byte-identity where nothing changed.** The codebase repeatedly guarantees "the
  unlocked path is byte-identical to before" (`:886`), "an untagged pool behaves exactly as
  before" (`:374`), "no composition target ⇒ returns 1 ⇒ byte-identical" (`:249`). The
  ordering fix satisfies this by accident (0-snack days: 0.00 pts, b=0, c=0). A fix that
  cannot state such an invariant will be hard to land.
- **Pool membership = compliance.** Nothing below `planContext.filterRecipePool` may widen
  a pool. `generateHorizonPlan` states the rule at `mealSolver.js:1215-1217`. C19: an
  `oracle.mjs` "0 leaks" is necessary but **not sufficient** — check candidate sets by name
  against C13's list.
- **Locked slots are constraints, not substitutions** (`:838-851`,
  `mealSolver.js:648-654`). A re-solve or trimmer must not touch a locked slot's macros.
- **The variety contract:** per-week `DEFAULT_REPEAT_CAP = 2` / `BATCH_REPEAT_CAP = 4`
  (`:61-62`), the sub-linear horizon cap `perWeek + weeks − 1` (`mealSolver.js:972`), the
  `distinctFloor` check, and the soft-not-hard character of every freshness discount
  (`:203-205`). A19 already showed day harvesting breaks this if it is not respected.
- **Honesty:** an out-of-band day must carry a warning or a diagnosis; the day verdict must
  be computed **after** any mutation (C23's disqualification of A17's prototype). If a fix
  makes the 2-macro slot warning disagree with the 4-macro day verdict more often (as
  order-asc does, +47 warned slots), that reconciliation is part of the fix, not a follow-up.
- **Performance.** Use candidate draws, not wall clock — A14 measured `solveMs` reporting
  2.25× between two runs that were byte-identical (`flat20` vs `floor20`). Baseline is
  **104 812 draws / 669 week solves** for 250 personas. The ordering fix comes in at
  **96 042 / 616** — cheaper. A14's cap of 20 sits on the plateau; do not raise it.

---

## 7. Corrections to prior fleet material

1. **`weeklyPlanner.js:106-111`'s justification for `CARRY_CAP_PCT` no longer holds.**
   Turning the within-day carry-forward completely off measures **+0.00 pts
   [−2.93, +2.93], b=32 c=32**. The comment's "without it day-level kcal p95 ~79 % off" is
   a 2026-07-13 measurement that current code does not reproduce.
2. **`weeklyPlanner.js:75-81`'s attempt-budget numbers are stale.** The comment quotes
   5 → 53.3 %, 12 → 60.2 %, 20 → 60.4 %. A14 re-measured 77.1 / 80.4 / 80.8 and I reproduce
   A14. The *shape* survives; the levels in the comment do not.
3. **A2/C10 is right that the 0.5× floor binds, and I can name the predictor.** It is not
   diffuse: it is **slot nominal kcal**. Below 250 kcal, 45–51 % of slots pin at 0.5× and
   median fat overshoot is +89 to +108 %; above 500 kcal it is +1.5 % and −2.6 %. A
   sub-0.5× floor is one answer; **not asking for a 190 kcal slot in the first place** is
   another, and nobody has priced it.
4. **A18 §5 ("compliance is decided in `weeklyPlanner.js`'s slot loop") is confirmed and
   sharpened.** The single largest lever found anywhere in this campaign so far is not a
   constant — it is the **order the loop visits its slots in**, which no prior agent
   examined.
5. **`prevDayRecipeIds` does not mean "yesterday"** after the L4 day randomisation
   (`:995-1001`). Cosmetic today; a trap for anyone reasoning about the variety rules.
6. **A19's oracle bound and my ordering result are not additive.** A19's +10.2-pt bound
   comes from picking better *days* out of the rolls the current ordering produces. Fixing
   the ordering changes the rolls. Re-derive the bound after any ordering change.

---

## 8. What I could NOT determine — named

1. **Anything cross-window.** All 250 personas are 1-day or 1-week horizons ⇒ exactly one
   window ⇒ `priorUsage` is always empty ⇒ **`twoPass` fires on 0.0 % of slots.** So the
   entire second search pass, the freshness-first sort key at `:651`, the horizon repeat
   cap, `admissionCeiling`, and the cross-window pool narrowing are **completely
   unmeasured**. Note the code fact this hides: when `priorUsage` is non-empty the search
   budget silently **doubles** (two passes × `attemptBudget`) *and* composition is demoted
   below freshness in the sort. A month-horizon plan therefore searches differently from a
   week one, in a direction nobody has priced. **A fleet that wants month plans to work
   needs a population that asks for them.**
2. **Locked slots at population scale.** 0 of 250 personas. §5.1's defect is proven by
   direct call, but I cannot say how often real users over-lock a day, and I did not
   measure the compliance cost of ordinary (non-degenerate) locks.
3. **Batch cooking as shipped.** 0 of 250 personas set `allowBatchRepeats`; my repeat4 arm
   moves `DEFAULT_REPEAT_CAP` instead, which is the same arithmetic but not the same code
   path (`repeatCapFor`, `:113-116`).
4. **The AI/brain path.** `BRAIN=off` throughout; `ai` exits = 0. `fillGapsWithBrain`'s
   static-share, fat-blind targeting (§2, row 12) is a **code reading, not a measurement**.
5. **`order-asc` at more than three seeds, and on non-persona populations.** Three seeds,
   one dataset (`e55f52e53658a086`), one population construction. The effect is large and
   one-directional (b≪c in 3/3), but C15 applies: these are **deltas between my own runs**,
   not levels comparable to the HTTP fleet's 70.1 %.
6. **Whether `CARRY_CAP_PCT` can be deleted.** My carry-off arm is one seed. A +0.00 with
   b=c=32 says "not load-bearing at this seed", not "safe to remove".
7. **The right ordering rule in general.** I tested ascending and descending weight.
   Ascending wins; descending is noise (+0.93). I did **not** test ordering by *pool
   fitness* (e.g. hardest-to-fill slot first regardless of size), which is the natural
   generalisation and may beat both.
8. **Portion realism of the extra 0.5×-pinned slots** (25.3 % → 28.0 %). That is a product
   judgement, not a solver measurement, and I did not make it.

---

## 9. Artifacts (all under `docs/surgery/CAMPAIGN/solver-deepdive/D2/`)

| file | what |
|---|---|
| `D2-hook.cjs` | in-memory instrumentation + treatment patcher, fail-loud, 11 anchors |
| `D2-run.mjs` | rig fork; emits `<label>.jsonl` (A1 schema), `.slots.jsonl` (per-slot telemetry), `.daysolve.jsonl` |
| `D2-analyze.mjs`, `D2-analyze2.mjs` | the aggregations in §1–§2 |
| `D2-check.mjs` | integrity + mechanism check for an arm (denominator, honesty, fat path, slices) |
| `D2-lockprobe.mjs` | §5.1, direct `solveDay` call with over-budget locks |
| `D2-probes.sh`, `D2-edits-snackfirst.json` | the treatment definitions |
| `D2-base-s{424242,20260730,8675309}.jsonl` (+ `.slots`, `.daysolve`) | baselines |
| `D2-order-asc-s*.jsonl`, `D2-snackfirst-s424242.jsonl` | the headline arm and its independent reimplementation |
| `D2-{order-desc,carry-off,carry-wide,floor12,asc-floor12,repeat4,repeat999,att1-base,att1-asc}-s424242.jsonl` | the other arms |
| `D2-ab-*.json` | `compare.v2.mjs` output for every arm |

DB: `solver-brain/D2/dev.db` (`e55f52e53658a086`) — placed there because `dbcopy.mjs`
resolves agent copies under `solver-brain/<id>/`. Copied from `A1/dev.db`, never from the
live DB. `checkdb.mjs` never invoked; `--fix` never run (C18).
