# BRIEF-CLAIMS — every load-bearing inherited claim, and who tests it

**Source of truth:** `docs/surgery/CAMPAIGN/solver-deepdive/CONSOLIDATED-BRIEF.md`
sha256 `efdbe1a1b80c5110b071f4ebbd095201b6345320b09be907a3d3bdf88955d488`, 646 lines,
read in full by W0-1 on 2026-07-31.

**Every fleet agent reads this file at start.** Where the brief and the condensed
block in `fleet/PROMPT.md` disagree, **the brief wins** (prompt's own instruction).
The divergences are logged in `fleet/DECISIONS.md` D-3 and are substantial — the
prompt's block is materially out of date, most importantly on the ruler and on the
honesty bug.

**Verdict column is filled by W5-1**, using each agent's measured number:
`CONFIRMED` (within noise) · `ADJUSTED` (same direction, different magnitude) ·
`REFUTED` (wrong direction or absent) · `UNTESTED` (fleet did not reach it).

**Evidence tiers from the brief are carried through:** MEASURED / DERIVED /
ESTIMATED / INFERRED. A claim the brief itself tiers below MEASURED cannot be
"confirmed" by agreement alone — say so.

---

## A. Level and denominator

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| A1 | Current compliance level on this tree + this DB | **70.1%** all-planned-days (two instruments: 405/578 re-score, 437/623 fresh solve) | W1-2 | |
| A2 | Satisfiable-only level | **77.3–77.7%**, cross-seed spread 0.4–0.5 pt, 3 seeds | W1-2 | |
| A3 | Stored baselines are not a valid comparison arm; every A/B re-runs its own baseline | 514/639 day records changed content since A1's baseline; 52 verdict flips (b=24 c=28, noise) | W1-2, W4-1 | |
| A4 | Denominators are never interchangeable | Published: **495, 502, 526** (fleet) and **536, 537** (rig) | W4-3 | |
| A5 | Minimum detectable effect: real at 95% iff `\|b−c\| > 1.96·√(b+c)` | churning treatments need **≥3.5 pts** on n≈537; 77→79% is NOT measurable | W4-3, all probes | |
| A6 | The rig drops its own hardest cases | `A1/rig/schema.mjs:83` `judged: filled.length>0` → **16 satisfiable total-failure days** excluded from the denominator | W1-1, W4-3 | |
| A7 | Population is `personas.mjs`/`personas.jsonl`, definitively; `genProfile` over-samples carnivore **13×** | 250/250 cross-checked, 0 mismatches | W0-1 (located, byte-exact) | **CONFIRMED** — 250 rows, sha256 `e564b1dd…57704e` |

## B. The diagnosis — overshoot

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| B1 | The solver **overshoots**; failure is one-sided | fat-failing days **97 over / 1 short**; fat-only misses **42/42 over**; rescued days **83/83 over** | W1-3 | |
| B2 | Accept gate is 2-macro, verdict is 4-macro | `weeklyPlanner.js:630,:634,:651` | W1-3, W1-6 | |
| B3 | Portioning solve is provably blind to fat/carb | 250 trials → **207/207 byte-identical grams**, max fat diff **exactly 0** | W3-2 | |
| B4 | The clamp is not a solve | exact solution outside the box **77.5%**; of those **94.8%** strictly worse on the solver's own rule; **13.7%** of pairs had a feasible in-gate point the clamp missed | W3-2 | |
| B5 | Nothing penalises oversize except calories (`proteinShortfallPct` one-sided) | **50.9%** over protein by >12% unpenalised; median fat vs a 28%E ask **+74.5%**; a-priori geometry near-symmetric (22.98 low vs 20.23 high) ⇒ **asymmetry is created by the search** | W1-3, W3-4 | |
| B6 | Closest-miss fallback spends the fat | 17.9% of slots but **51.5%** of all fat overage (6.6 g/slot vs 1.2) | W1-3 | |
| B7 | Shortlist binds, not the search | only **6.2%** of slots find anything within `COMPOSITION_GOOD_ENOUGH`; median best distance 0.203 | W1-5 | |
| B8 | Small slots cannot be filled | 0–150 kcal: **32.0%** unsolved, median fat **+108.1%**; 500–700 kcal: 1.4%, +1.5% | W1-3 | |
| B9 | Worst offender scheduled last; day never recovers | cumulative fat ratio 1.13→…→**1.40** monotone; 238 slots solved with `fatTarget` floored to 0 still ship median 8.4 g | W1-3, W3-2 | |
| B10 | **% of misses that are OVER-side** — decides TRIM-arm priority | prompt block says 74.2%; brief's shape says overshoot is near-total | W1-3 | |

## C. Levers — measured effects (NEVER SUM: hard cap **+22.95 pts**; naive sum +58.77 = 2.56× impossible)

| # | Lever | Brief's Δ (satisfiable-only) | Tested by | Verdict |
|---|---|---|---|---|
| C1 | **A13 `wls2`** 4-macro tolerance-normalised portioning | **+14.74** [+11.40,+18.08] b=8 c=87, 3 seeds, **pre-repair DB**, not on disk | W3-2 | |
| C2 | **D2 solve slots smallest-first** | **+8.27** [+6.49,+10.05] pooled; independent re-grade +9.33; **one line** | W3-2 | |
| C3 | A16 protein-concentrate / snack enrichment | +10.45 gross; **+7.46** marginal over C1 | W3-6 | |
| C4 | A13 `floor25` 0.25× portion floor atop C1 | +19.96 total, **+5.22 marginal**, SINGLE SEED; ships **35.5%** of slots below the old floor | W3-2 (plate realism unmeasured) | |
| C5 | A17 macro trimmer | +14.93 raw, **+2.24 marginal** over C1 (72/84 days shared) | W3-4 | |
| C6 | A14 attempt-budget floor 5→12 | **+1.12** pooled | W3-5 | |
| C7 | A19 variety-safe day harvesting | +1.68 gross, **+0.00 marginal** — SUBSUMED, dead | W3-3 | |
| C8 | A18 `SCORE_WEIGHTS` retune | **0.00**, b==c in 6/6 arms — DEAD structurally | — (do not spend) | |
| C9 | A15 ruler widening (fat ±50%) | **+4.0 max** — not a solver lever | W3-1 | |
| C10 | A20 sound refusal | **+0.00** — ship for honesty, not points | W1-4 | |
| C11 | Interaction C2+C6 is **sub-additive** | +9.33, not +10.45 | W3-5 | |
| C12 | C2 at **1 attempt** (79.9%) beats baseline at 5 attempts (77.1%) | | W3-3, W3-5 | |
| C13 | D1 one-knob back-substitution | in-gate **35.81% → 42.91%**, 83 rescues / 0 regressions; **per-(recipe,target) pair, NOT days-in-band** | W3-2 | |
| C14 | D1 in-gate composition steering | **97.6%** of gate-passing slots have a strictly better composition point (carb err median 14.19g→0.87g); **cannot raise warned-slot count** | W3-2 | |

## D. The ruler — where the prompt block and the brief COLLIDE

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| D1 | **"The ruler is too tight" is DEAD** | fat gate effective half-width **±33.11%**, WIDER than AMDR's 27.3%; widening to ±50% buys **≤+4.0 pts** | W3-1 | |
| D2 | ⚠️ **The prompt's condensed block asserts the opposite** (fat band "wrong both directions", floor-ruler A→D flips 6.33→23.97%). **The brief supersedes it.** W3-1 must report the ruler share and say plainly which framing the real data supports. | — | W3-1, W5-1 | |
| D3 | Tolerance algebra (hand-derived, differential-tested on 578 real + 84,800 synthetic + 8 degenerate, **0 disagreements**) | kcal ±15% sym · protein ≥0.85·pMid **one-sided, no ceiling** · fat `[fatLo−0.25·fatMid, fatHi+0.25·fatMid]` · carb `[carbLo−0.25·carbMid, carbHi+A·carbMid]`, A = keto?0:0.25 | W3-1 | |
| D4 | "Looser than AMDR" is right on width, misleading on **position** | graded window **14.6%E…29.0%E** vs AMDR 20–35%E — admits days below the AMDR floor, rejects days inside AMDR | W3-1 | |
| D5 | `dayTolerance` decides; `SCORE_WEIGHTS` only reports | `dayTolerance()` is primary selection key of best-of-5 (`:686`) and early exit (`:696`); **36%** of runs exhausted all 5; `scoreDay`'s range fields are **dead, zero consumers** | W3-3 | |
| D6 | `compositionReach()` is **unsound** | evaluates at exact kcal while day needs ±15% ⇒ `unreachable` false-fires both directions by ~15% | W1-4 | |
| D7 | `classifyBinding` lies **15.2%** of the time (machine key only; prose stays truthful) | PROTEIN_DENSITY at `:1121` evaluated before composition branch `:1131` | W1-3, W1-4 | |
| D8 | The ruler is **not locked by any test** | `solverMacroTolerance.test.js:51-63` computes expected boundary from the constant it tests — passes at any value | W4-3 | |

## E. Honesty — the prompt block is STALE here

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| E1 | ⚠️ Prompt block: "`diagnoseFromResult` returns `feasible:false` unconditionally, 41/41 perfect weeks mislabeled, false-surrender 95.8%". **Brief says this is FIXED and says DO NOT RE-FIX.** | brief: **0 silent misses, 0 verdict disagreements, 173/173 carry a binding key, 65/65 runs with a miss carried a diagnosis** | W1-4 | |
| E2 | Persistence throws the verdict away | `Plan`/`PlanSlot` (`schema.prisma:493-527`) have **no day-verdict column**; `genMeta` is React state (`PlanTab.jsx:750`) — gone on tab switch | W1-4 | |
| E3 | The surviving 2-macro slot warning **structurally cannot fire** on most bad days | **66.6%** of out-of-band days have kcal AND protein both fine; **30.6%** of bad days end fully silent; `TodayTab` never renders `slot.warning` at all | W1-4 | |
| E4 | Warnings quote numbers that no longer exist | closer mutates at `macroCloser.js:159-162` after warning formed at `weeklyPlanner.js:661-671`; **33 of 621** adjusted slots quote a stale kcal (31 off by ≥50, worst **684**); warning **understates** overshoot | W1-4, W1-6 | |
| E5 | Silent-miss vector: non-finite target → **half portion**, `warning:null` | `clamp` at `:294` falls to `min` = 0.5; an *infinite* ask yields the *smallest* plate; reachable from `brain/tools.js:74` | W1-4 | |
| E6 | Silent-miss vector: locked slot at 100% of budget | floors `budgetKcal` to 0 ⇒ gate passes unconditionally ⇒ **2953 kcal on a 2000 kcal day, 123 g fat on a 55–65 band, zero warnings**; invisible to fleet (0/250 personas lock) | W1-4 | |
| E7 | Silent-miss vector: below-floor solves clamped silently | result object has **no field matching** `/pin\|bound\|clamp\|limit\|floor\|ceil/`; floor-pinned land median **+19.3%** over (p90 +54.6%) | W1-4 | |
| E8 | Server trusts client `warning` | `/accept-day` + `/apply` take `warning` from the client (`plans.js:110`); `/place-recipe` writes **`warning:null` hardcoded** (`:625`) | W1-4, W4-2 | |
| E9 | `/day-options` ranks a miss above a pass and is **entirely unbenchmarked** | sorts on `matchPct` alone (`:504`); a 16%-protein-short day scores **95** and is offered first; in-tolerance day scores 77 | W1-4 | |
| E10 | `alternatesForSlot` never sorts, yet both call sites call it `best` | `options[0]` not best-scoring in **134/200 draws (67%)** | W1-4 | |
| E11 | Re-badging `diagnose()` buys **+27.94 pts** and a perfect KPI with **186 false refusals and zero behaviour change** — the inflation trap | | W4-3 (must audit every probe for it) | |

## F. The library / pool

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| F1 | Target-side infeasibility explains **≈0 points** | **248/250 (99.2%)** personas expressible under the app's own rule; exact LP/HiGHS | W1-5, W1-2 | |
| F2 | Density gap real but **nearly inert** | r(demanded density, in-band) = **−0.057**; worth **≈3.4 pts** against a **3.45-pt detection floor** ⇒ may measure ZERO | W1-5 | |
| F3 | **A third of the pool is unservable** | `weeklyPlanner.js:185` bars dessert/beverage/bread/condiment ⇒ **163 recipes (17.9%)** placeable in no slot | W1-5 | |
| F4 | ⚠️ This **invalidates A11's per-diet density table** — vegetarian meal-eligible median is **5.30, not 3.25**; "author vegetarian desserts" changes **nothing** (they're already barred) | | W1-5 | |
| F5 | **The snack slot is starving** | **18 snack-eligible recipes in the entire library** (vegan 5, keto 4, carnivore 1); only 2/18 meet target fat median; snack-pool fat density 5.58 = worst in library at **2.1× target**; **141 of 193 empty slots are snacks**; `slotAttemptBudget` exceeds candidate count for every diet ⇒ **searched exhaustively, no fallback ⇒ misses are provably pool-caused** | W1-5, W3-6 | |
| F6 | The solver **suppresses the only recipes in the target box** | `GENERATED_TEMPLATE_WEIGHT = 0.35` (`:220`) down-weights 158 High-Protein templates. Templates **9.71 g P / 2.12 g F** per 100 kcal vs rest of pool 5.28/4.73 vs target 8.16/2.60. Removing it moves target-corner draw mass **12.7%→21.7%** (P(≥1 of 5) 49.3%→70.5%). Draw mass MEASURED, causal step **ESTIMATED** | W1-5, W4b | |
| F7 | Anti-monotony rule and compliance target are in **direct conflict**; only authoring dissolves it | | W5-1 | |
| F8 | Pool attrition is honest; **gate precision is NOT the headroom** | gate removes 56.1%; precision defects **0.5 pp**; fixing all 30 named false exclusions recovers **+4.8 mean recipes and exactly 0 for the 42 most-starved profiles** | W1-5 | |
| F9 | Keto's 5.8% survival is **recipe supply, not filtering** | all 857 keto exclusions are the whole-recipe carb ceiling; **1 of 49** keto meal recipes clears the fat band; **do not attack keto with protein** | W1-5 | |
| F10 | Recipe caches are **clean** — "recompute caches" is a no-op | worst kcal drift **0.19%** after the 07-31 repass | W1-5 | |
| F11 | **81 food rows remain genuinely untrustworthy** (not 230) | all 81 used in recipes; 146 recipes touched; 39 draw >25% of protein from one. Still shipping: **Raw tiger prawns 56.5 g carb/100 g** (prawns have no carbohydrate), **Star Anise 337 kcal / 17.6 g P** (43% of Beef Pho's calories), Lamb Stock 193 kcal/100 g | W1-5 | |
| F12 | **47 meal recipes can never serve any slot** at 0.5–2× | Tahini Lentils stored as **11,825 kcal / 8,920 g**; Grits as **13 kcal**. **94.3% of the food library is inert to the solver** | W1-5 | |

## G. The macro closer (the cloud never saw this file)

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| G1 | **Add-only, and a strict no-op on the dominant failure** | every write is `+=` (`macroCloser.js:130-135`); 4,000-day fuzz, **0 reduction events**; on fat-over / kcal+25% / carb-over returns `added:(nothing)`, delta 0/0/0/0 | W1-6 | |
| G2 | Reachability wall | **10 rows of 14,151 = 0.07%**. Protein ≥40 g/100g: 87 exist, **0 reachable**. Carb ≥60 & fat ≤3: 628 exist, **0 reachable**. vegan+soy+legumes max protein delivery **0.0 g**. Keto has **zero** carb adjusters in every configuration | W1-6 | |
| G3 | The **hardcoded list** is the constraint, not the gate | `ADJUSTER_CANDIDATES` = ten names at `planContext.js:167-178`; gate binds in exactly one place (18 vegan profiles) | W1-6 | **CONFIRMED (structure)** — W0-1 read the 10-name constant |
| G4 | `wouldHarm` has a hole | `check()` returns `isOver && !wasOver` (`:86-91`) — an **already** out-of-band macro is unprotected; measured: closing protein pushed fat 95→100.2 g against a 55–70 band. Its own docstring says *"'No worse' is the whole rule."* | W1-6 | |
| G5 | `_adjusterFoods` has **no invalidation path** | `invalidateRecipeLibrary()` (`planContext.js:96-100`) clears three caches, not this one ⇒ a **quarantined** row keeps being served for the process lifetime | W1-6 | |
| G6 | **All adjusters land on slot 0** | 353 g appended to a 300 kcal breakfast → **922 kcal**, scale knobs untouched — reintroduces the "625 g chicken" defect the module exists to prevent | W1-6 | |
| G7 | **Scope surprise:** the closer runs on exactly ONE surface (`/plans/generate`) | `generateDayCandidates` calls `solveDay` with 11 positional args omitting `adjusters` (`mealSolver.js:496`, `:531`) ⇒ Plan tab's day-options card and week Generate have **different solving capability** | W1-6 | |
| G8 | `macroCloser.js` was **untracked in git with zero tests**; 8 of 10 adjusters are `source:"manual"`, `fdcId:null` | | W0-1 | **CONFIRMED (git)** — untracked at run start; now rescued in `campaign-2026-07` |
| G9 | Day-level ordering is already correct (closer runs before `scoreWeek`, `mealSolver.js:680`) ⇒ **A17's disqualifying regression does not apply to the shipping closer; a trimmer belongs exactly there** | | W3-4 | |

## H. Safety (not compliance)

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| H1 | **Allergen columns 100% NULL ⇒ gate fails OPEN**; Isopure (whey isolate) ALLOWED for whey/dairy/milk/vegan | 14,151/14,151 NULL | W0-1 | **CONFIRMED — see `fleet/TRIAGE.md` T-1.** 14,151/14,151 NULL reproduced; 13 of 17 powder rows fail open; **0 reachable** (0 recipe uses, 0 in adjuster list) ⇒ P1-latent |
| H2 | Paired USDA categories over-fire | `"dairy and egg products" → ["dairy","egg"]` ⇒ egg-allergic user loses **every cheese and cream dish**; `"finfish and shellfish"` cross-fires **Shrimp→fish across 32 recipes**; the code comment's "name is checked first" precedence **does not exist** (`:1802` is a plain union) | W4-2 | |
| H3 | Gluten-free guard covers `flour`/`tortilla`/`cereal` but **not `pasta`/`noodle`** | excludes all **57 High-Protein …Lentil/Chickpea Pasta** recipes from celiacs — **and they are gluten-free**. The library's best high-protein assets are hidden from those who most need them | W1-5, W4-2 | |
| H4 | Corrupted rows are laundered into allergen evidence | `Cinnamon` carries `fdcId 171849 "Bread, cinnamon"` → Baked Products → gluten, **across 38 recipes**. **Fix the rows, not the gate** | W1-5 | |
| H5 | Other false exclusions | `Ground Nut Oil`→tree nuts (**peanut↔tree-nut conflation is live in the gate**, not only in `oracle.mjs`); `Kidney Beans`→vegan (organ-meat keyword); `flax eggs`, `vegan butter`, `Oyster Mushrooms`, `soya milk` (`"soy"` word-boundary never reaches `"soya"`) | W4-2 | |
| H6 | Style lattice is **sound** — leave it alone | `vegan ⊆ vegetarian ⊆ none`, `carnivore ⊆ none`, **0 violations** over 910 recipes + 14,151 foods, computed as allowed-sets not read from test assertions. Step-text probe is not the cost (91–99% of exclusions rest on a real ingredient row) | W4-2 | |
| H7 | ⚠️ **D6 states against itself:** its method reads what was *removed* and is **structurally incapable of finding leaks.** Nothing in the corpus is evidence the gate is safe | | W4-2, W5-1 | |

## I. Target correctness bugs (not compliance bugs)

| # | Claim | Brief's number | Tested by | Verdict |
|---|---|---|---|---|
| I1 | **`ASSUMED_BODY_FAT_PCT = {M:21,F:28}` used for 147 of 250 personas**, 86 at BMI≥30 | protein prescription collapses to constant g/kg **total** bodyweight (2.081 M / 1.897 F); vs Deurenberg median inflation **+21.1%**, **+32.2%** at BMI≥30, max **+96.1%** (p004: 273.5 g vs 139.5 g) | W1-5, W4b | |
| I2 | **Sharpest number in the study:** 37 of those 147 demand a protein density above the pool's p90. **Under corrected lean mass that count is ZERO** | | W1-5, W4b | |
| I3 | It compounds — LBM-anchored numerator up, `RMR×0.95` denominator down | **106 of 250** prescribed **>35%E protein**, max 53.5%E; **all 9 carb-floored personas are assumed-BF and all 9 are female** — failure mode is **sex-skewed** | W1-5 | |
| I4 | **The constant is fine — do not touch it.** The *input* is broken | `lbmLb×1.14/1.25` = 2.513–2.756 g/kg LBM, inside Helms/Aragon/Fitschen 2.3–3.1. **Safety tension:** Deurenberg alone drops 8 of 147 below 1.2 g/kg actual (worst 0.97) ⇒ any fix must pair a better BF estimate with an absolute ≈1.2 g/kg-actual floor | W5-1 | |
| I5 | **The ask does not add up to itself** | `CARB_MIDPOINT_BUFFER_G = 25` ⇒ macro midpoints sum median **99.5 kcal below** `targetKcal` = **29.8%** of the one-sided allowance spent pre-solve (p90 47.9%). Only reachable via positive-Atwater-residual recipes: **269/910** qualify; nominal ask **unreachable for 59/250** even fully relaxed. Correctness and metric agree here (A15 +2.7 pts) | W1-5, W4b | |
| I6 | Carb floor graded at **half** the engine's own floor | `NONKETO_CARB_FLOOR_G = 50` but emitted band `carbMid±12` with a further −0.25·cMid ⇒ **all 9 carb-floored personas graded at 24.8–25.5 g**; 28/232 non-keto sit below 50 g | W3-1 | |
| I7 | Slot carry-forward can manufacture an impossible ask | `:917-918` clamps kcal and protein **independently** at ±30% ⇒ ratio unclamped, up to **1.857×** the day's density. Nominal **0/250** above pool max; worst-case carry **29/250 above pool MAX**, 99/250 above p99 | W1-3 | |
| I8 | Yet turning carry-forward **off measures +0.00** [−2.93,+2.93], b=c=32 — contradicting the code's own comment at `:106-111` | | W4b (only if triggered) | |

## J. Dead — do NOT spend budget here (brief §11)

`SCORE_WEIGHTS` retuning (b==c 6/6) · "ruler is too tight" · "2.0× ceiling binds"
(**66 of 70 bound misses are at the 0.5× FLOOR**) · role tagging as a lever
(+0.0 to +0.6, naive retag **−2.1 to −3.2**) · authoring vegetarian desserts
(already barred) · `oracle.mjs` as a leak verifier (**11 of 25**, and the misses
are the high-protein rows) · the "83-day impossible tier" (**16 proved / 67
unknown / 495 SAT-certified**) · recompute recipe caches (no-op) · attacking keto
with protein · gate precision as headroom · "`/generate` drops the diagnosis"
(**stale — fixed, do not re-fix**) · widening `SCALE_BOUNDS` (refused; 7
consumers, 6 hardcoded).

## K. Instrument hazards every agent must respect

- **K1 NUL bytes** in `dietaryFilter.js` (757:7, 760:27/34), `scripts/qc/fuzz.mjs`,
  `tests/librarySync.test.js` make them **invisible to `rg`/Grep tool/`scanSecrets.mjs`
  — silently.** **Every negative claim made about those files via Grep is VOID.**
  Use `git grep`, `Read`, or Node. *(W0-1 hit this live: `grep -n "^export"` on
  `dietaryFilter.js` returned nothing; a Node import listed 40 exports.)*
- **K2** `runSolve.mjs` omits horizons **and** adjusters (74% of requests solved as
  the wrong shape); `mc.mjs` grades with a **third incompatible ruler** (5% kcal,
  no fat/carb term). Do not mix its numbers with "days in band."
- **K3** `oracle.mjs`'s `acceptOk` is ±5% kcal with no fat/carb term and **must
  never share a table with "days in band."** Oracle-zero is **not** a leak pass.
- **K4 Solver purity is not actually enforced:** `invariants.test.js:106` greps for
  `Math.random(` as a **call**; `mealSolver.js:461`, `:823`, `:1358` evade it with
  bare references ⇒ `/day-options`, `/alternates`, `solveOneMeal` run on **ambient
  RNG**. Determinism claims must be re-verified per surface, not assumed.
- **K5** `CLAIMS.tsv` is append-only with retracted rows and **no status column**
  (row 332 retracted by 336; 287–288 superseded by 322–323). A naive parse
  **resurfaces dead numbers as live.**
- **K6** Composition is **2–10× more rounding-sensitive** than calories (carb p95
  6.15%, max 63.2%) ⇒ any fat/carb-aware portioner must score on **rounded** grams.
- **K7** `brain/optimizer.js:54-73` is a **second independent transcription** of the
  k=2 solve with its own bounds; `tests/brain/optimizer.golden.test.js` asserts
  parity ⇒ changing `weeklyPlanner` alone breaks it.
- **K8** The golden (`engine-baseline.golden.json`) is **theatre** — locks 3/7 days
  in tolerance, 5/21 slots empty, identical across improvement *and* regression;
  documented response to both is `REGEN`. It will fail on any solver change and has
  **no quality axis.**

## L. Named gaps — do NOT fill with assumption (brief §15)

`twoPass` fires on **0.0%** of slots (all 250 personas are 1-day or 1-week ⇒ one
window; the entire second pass, freshness sort, horizon repeat cap and all
cross-window logic are **completely unmeasured**) · **the adaptive target never
fired** — every number in the corpus describes the solver against a **formula**
target, while real users get the adaptive one from week 3, drifting ±500 kcal over
28 days (outside the ±15% gate) · `/day-options` unbenchmarked · locked slots at
population scale (0/250) · **plate realism in grams — nobody has rendered the
plates** · whether the 07-31 repass changed any prior *delta* · whether softening
`GENERATED_TEMPLATE_WEIGHT` gains or loses days · metric effect of corrected
body-fat (needs a **re-solve**, not a re-grade; may measure zero) · the exact
`dev.db` behind 405/578 is **not recoverable** · **leaks** (no method used was
capable of finding one).
