# D10 — The prior-art audit: what is already known, what died, and what the tree actually contains

**Scope.** The entire `solver-brain` corpus (REPORT.md, five CORRECTIONS files, STATUS.md,
BRIEF.md, `CLAIMS.tsv`, all 24 `FINDINGS.md`), the research brief, both campaign prompts,
and the working tree's uncommitted diff. Read-only. Nothing edited, no DB touched.

**How to use this.** Sections 1–5 are the "what is already known" block for the new build
prompt. **Section 6 is the state the builder inherits and it is not HEAD.** Read section 6
first if you are about to touch code.

**Standing lesson the corpus arrived at twice, from two directions:** *determinism is
reproducibility, not validity.* Every number below reproduces. Several of them are still
wrong, and the corpus says which.

---

## 0. Parsing warnings for anyone reading the primary sources

Four traps in the source material itself. All four are load-bearing.

| trap | detail |
|---|---|
| **`CLAIMS.tsv` is append-only and contains RETRACTED rows with no flag column** | 385 data rows + 1 header (the DoD's "386" counts the header). Row 332 (`A19 no-roll count does not reproduce`) is **retracted** by row 336. Rows 287–288 (`+0.78 / +23.00` laundering deltas) are **superseded** by rows 322–323 (`+4.94 / +5.72 / +27.94`). There is no status column. **Rule: later rows from the same agent supersede earlier ones; you must read the rows whose `claim` begins `CORRECTION`/`RETRACTION` to know which.** A naive parse surfaces dead numbers as live. |
| **Two ledger rows are defective and the report does not quote them** | A20's KPI-1 row transcribes the level as `77.00 %`; it is **72.06 %** (the `+0.00` delta is correct, and `A20/FINDINGS.md:17,22` is right). A20's P7 confusion matrix `16/0/0/0/90/405` **sums to 511, not 578** — it omits 67 UNKNOWN-accepted days. Both caught by A22; A24 repaired the second. |
| **A9 and A25 contributed zero `CLAIMS.tsv` rows** | A9 was blocked from copying the DB (C6) and self-reports that *"no number here was produced by running code"* — its role counts are quoted from a **stale** `schema.prisma:454` comment and are superseded by A10's measurement. A25 never wrote a `FINDINGS.md` at all. 23 of 25 agents have ledger rows. |
| **`A21/FINDINGS.md` was written after A22 closed** | A22 explicitly records *"A21's FINDINGS.md is ABSENT from disk at A22 close of work… No A21 prose was read, so no A21 interpretation is endorsed."* A21's prose exists now (4,513 bytes) but **is not covered by A22's replay** — only A21's raw arms are. A24 did read it. |

---

## 1. THE SETTLED-FACTS LEDGER

Measured, replicated where the corpus says so, uncontradicted at close of study. **State
these; do not re-derive them.** Tier tags are the corpus's own.

### 1.1 The baseline, and which instrument may be cited for what

| fact | value | tier | source |
|---|---|---|---|
| HTTP fleet, all 578 days | **405/578 = 70.07 %** | MEASURED | fleet `qa-fleet-20260729-2032`; A15 re-graded it with **0 disagreements** |
| HTTP fleet, satisfiable-only | **405/526 = 77.0 %** | MEASURED | A3; reproduced exactly by A15 and A22 |
| A1's rig, satisfiable-only | **413/536 = 77.1 %** (s424242) | MEASURED | A1; A22 reproduced from its own DB copy, b=0 c=0 |
| A1's rig, all judged | **434/622 = 69.8 %** | MEASURED | A1 |
| Cross-seed spread of the rig baseline | **0.9 pts** satisfiable / **0.6 pts** all-days | MEASURED | A1, 3 seeds (77.1 / 77.8 / 78.0) |
| Rig no-op A/B | **+0.00, b=0 c=0, 639/639 byte-identical** | MEASURED | A1; independently reproduced by A13, A14, A17, A18, A19 |
| Cross-agent baseline identity at s424242 | **639/639 identical** across A13/A16/A17/A19/A21 | MEASURED | A21 |

**C15, binding: cite the HTTP fleet for a LEVEL, the rig only for DELTAS between its own
runs.** The rig judges 622 days where the fleet judges 578, from four documented deviations
(`startDayOfWeek` pinned to 0, free-text exclusions not applied, no HTTP layer, adjusters
re-assembled). Two instruments landing within a point is corroboration, not the same
measurement. **Never mix them in one table.**

### 1.2 C14 — the discrimination floor. This governs every verdict.

**A churning treatment (b>0 and c>0) needs |Δ| ≳ 3.5 pts before it may be called real.**
DERIVED by A1 from a *measured* positive control: pool thinned to 2-of-3 moved satisfiable-only
**−2.05 pts with a paired 95 % interval still spanning zero**; McNemar b=50 c=39 n=536 →
half-width **3.45 pts**.

- A one-directional treatment (b=0) is floored instead at ~1.5 pts / **~9 flipped days**.
- **A delta between those floors is UNRESOLVED, not small.** That is a statement about n, not
  about the mechanism.
- Use `compare.v2.mjs`, never `compare.mjs` (v1 reports only the unpaired interval, ±5 pts at
  n≈620). **And ignore `compare.v2.mjs`'s own `VERDICT` line** — it still applies the pre-C14
  ±1.5 floor and printed "clears the noise floor" for the exact +3.36 delta that then failed to
  replicate at two seeds (A14). A24 verified **no agent harvested it**.

### 1.3 Where compliance is decided, and by what

| fact | value | tier | source |
|---|---|---|---|
| **Every `mealSolver.js` edit measures 0.00 pts; every `weeklyPlanner.js` edit moves the number** | 5 weight arms + day-hinge all 0.00; slot-hinge −4.29, first-fit −24.81 | MEASURED | A18 |
| `SCORE_WEIGHTS` (`mealSolver.js:127`) **structurally cannot** change the in-band count | reshuffles **180–220 of 639 days**, moves **0.00 pts in all 5 arms**; predicted **b == c**, observed b==c in **6 of 6** | MEASURED + DERIVED mechanism | A18 |
| Why: week selection consults it only *after* `daysInTolerance` ties | `mealSolver.js:686` then `:691` via `avgMatch` | DERIVED | A18 |
| The solver has **two** knobs per slot, both fully consumed by a 2×2 linear solve for kcal and protein | residual freedom for fat/carb is **exactly zero** | DERIVED from code | A9, confirmed A10 |
| One-knob degenerate branch coverage | **204/910 recipes = 22.4 %**; 419/2525 satisfiable served slots = 16.6 % | MEASURED | A13 (A10's "200" is the no-protein-role subset) |
| Days with ≥1 one-knob slot land in band **8.3 pts less often** | 73.3 % (214/292) vs 81.6 % (199/244) — observational, confounded | MEASURED | A13 |
| `solveGeneral` is executed by **zero product paths**, BRAIN on or off | 1 call site, always k=2 | MEASURED | A10 |
| The 200-iteration cap in `solveGeneral` is **not converged** | 5,000 iters strictly lower residual on **8,109/11,072 pairs (73.2 %)** | MEASURED (paired proxy) | A10 |

**Correction to C8 that survives (A18, MEASURED):** `KCAL_TOLERANCE_PCT=0.15` /
`PROTEIN_TOLERANCE_PCT=0.12` live at **`weeklyPlanner.js:67/:74`** and are *imported* by
`mealSolver.js:13-14` — C8 named the right values and lines but the wrong file. And **the slot
*objective* is 4-macro** (fat+carb enter via `compositionDistance` at `weeklyPlanner.js:465-471`,
which sorts before `worstRatio` at `:651` and can early-accept at `:642`); **only the slot
*gate* is 2-macro.** That distinction is exactly why A13's amber cost appears (§1.5).

**Also settled (A18):** the protein overshoot hinge A10 recommended is **already shipped** in
both live objectives (`mealSolver.js:150`, `weeklyPlanner.js:427`). Not a candidate change.

### 1.4 The failure mode is ONE thing, measured five ways

| measurement | value | tier | source |
|---|---|---|---|
| Satisfiable misses binding on the portion bound | **70/110 = 63.6 %** | MEASURED | A2 |
| Of those 70: blocked at the **0.5× FLOOR** vs the 2.0× ceiling | **66 floor / 0 ceiling-only / 4 both** | MEASURED | A2 |
| The divergent "625 g chicken + 2 g pine nuts" shape | **54/2432 = 2.2 %** of filled slots | MEASURED | A2 |
| Protein-short and kcal-out as **sole** binding constraint | **0 days each** | MEASURED | A2 |
| Fat-only misses that are OVER the band | **42 of 42; zero short** | MEASURED | A15 |
| Baseline fat-failing judged days | **97 OVER / 1 SHORT (99.0 %)** | MEASURED | A17 |
| Days rescued by day-selection that had been OVER band | **83/83** dayN, **27/27** dayNstrict | MEASURED, 3 seeds | A19 |
| The macro closer can only ADD | gap list built from shortfalls only (`macroCloser.js:130/133/135`); `wouldHarm` only blocks | DERIVED from code | A9 |
| Missed days failing 2+ macros simultaneously | **97/173 = 56.1 %** | MEASURED | A2 |

**The one-sentence version: the dominant failure is that days come out TOO BIG, and every
mechanism that makes them smaller claims the same ~15 points.** That is C23, and §2.4 shows the
overlap was measured rather than assumed.

### 1.5 The one lever that is REAL, and its price

**A13's `wls2` — a 2-knob, 4-macro, tolerance-normalised weighted-least-squares portioning
objective with the protein hinge.**

| fact | value | tier |
|---|---|---|
| Satisfiable-only delta, s424242 | **+14.74 [+11.40, +18.08]**, b=8 c=87, χ²=64.04 | MEASURED |
| Replicated | **+14.37** (s20260730, b=5 c=82), **+13.99** (s8675309, b=5 c=80) | MEASURED, 3 seeds |
| Independently reproduced by A22 **from its own arms** | +14.74, b=8 c=87 — identical to 2 dp | MEASURED |
| **Negative control that defends it** | a re-portioning objective on **kcal alone**, same rig/seed/hook: **+0.00 (b=5 c=5)** | MEASURED (A22) |
| Where the gain comes from — ablation | 4-macro L2 at optimizer weights **+9.51** → + tolerance-normalised weights **+14.74** → + per-role knobs **+15.11** | MEASURED |
| The weights, not the knobs | tolerance-normalised vs `{kcal:1,protein:1,fat:0.1,carb:0.1}`: **+5.60** (b=10 c=40) | MEASURED |
| n-knob over 2-knob | **+0.37 / +0.18 / −0.37** across 3 seeds, mean +0.06 — **UNRESOLVED**; 97.6 % of the gain is at today's DoF | MEASURED |
| Per-macro pass rates, baseline → wls2 | kcal 95.0→98.1, protein 99.6→99.8, **fat 84.9→94.6**, **carb 89.0→97.0** | MEASURED |
| Fat-over-band satisfiable days | **255 → 152** | MEASURED |
| Slots filled (refusal-gaming check) | 2525 → 2524 — unchanged | MEASURED |
| `SCALE_BOUNDS` integrity across 67,158 solves | minKnob 0.500000, maxKnob 2.000000, **0 out of box** | MEASURED |

**The intervention is passing an argument that already exists.** `weeklyPlanner.js:451`
computes the fat/carb composition target and scores with it at L468–469, then **discards it**
before `scaleRecipe(recipe, kcalTarget, proteinTarget)` at L394 portions the plate.

**Its price, which may not be dropped: slot-level warnings RISE while day misses fall.**
Filled warned satisfiable slots **341 → 405** (13.5 → 16.0 %). The per-slot *gate* is
kcal+protein only, so it flags slots the 4-macro portioner deliberately detuned. **More amber
on days that now pass** — a customer-visible regression in signal quality, not a lost warning.
`floor25w` returns it to **343**.

### 1.6 The load-bearing properties, as they actually stand

| property | status | evidence |
|---|---|---|
| **0 kcal drift** | **Intact.** 0 across every arm in every agent's instrument line | MEASURED, universal |
| **Honesty-on-miss** | **Intact, and attacked independently.** 48 of 173 fleet misses carry **no slot warning** — but **48 of 48** carry plan-level `diagnosisFeasible=false`. **Corollary: `diagnose()` is the SOLE honesty signal on 27.7 % of missed days** | MEASURED (A24) |
| **0 confirmed allergen leaks** | **Intact as measured — but never verified by the instrument the fleet believed was verifying it.** See §3.3 | see C19 |
| The one real honesty regression | **A17's trimmer only**: 1 verdict disagreement + 1 silent miss (`p237#6`, EASY, style `none`: engine claims `inBand=true, matchPct=87`, grader says false, `hasWarning=false hasDiagnosis=false`) against baseline 0/0. Reproduced by A22 | MEASURED |
| Baseline's "5 oracle leaks" | **All 5 are false positives.** 4× "Peanut Butter" matching a tree-nut alias (`oracle.mjs:59` lists `"nut butter"` under `nuts`; `:68` aliases tree nuts to nuts), 1× "Egg Plants" matching the vegan egg term | MEASURED (A16, confirmed A21) |
| No lever moved a denominator | **622 judged / 536 satisfiable-judged in all 14 headline arms** | MEASURED (A24) |
| The DB discontinuity did not land | **129 of 129** comparison arms carry `dbHash e55f52e53658a086 / foodFingerprint 423e7279ed6af641 / poolRaw 910 / foodRows 14151` | MEASURED (A24) |

### 1.7 The ruler is not where the gap lives

| fact | value | tier | source |
|---|---|---|---|
| Grader/engine joint satisfiability | **250/250 profiles.** Ruler incoherence contributes **0.0 points** of the gap | MEASURED | A12 |
| Ruler-attributable share of the 23.0-pt satisfiable gap | **≤ 4.0 pts (17.4 %)**, obtainable only at a fat gate of **±50 %** = 1.83× the NASEM AMDR half-width | DERIVED from measured variants | A15, reproduced A22 |
| Every mission-prompt fat variant (±10/±15/±20/±25 %) is a **tightening** from the true ±33.1 % | −27.4 / −15.8 / −8.6 / −4.9 pts, b=0 in all four | MEASURED | A15 |
| A4's essential-fat floor (0.30 g/lb LBM) applied as a rule | **±0.0 pts, b=0 c=0 — identically zero.** 0 of 578 days occupy the C3 hole `[0.2475, 0.30)·lbm` | MEASURED | A15 |
| AMDR as a drop-in ruler | **−57.4 pts.** Not a solver indictment: the app's own *prescription* violates AMDR before food is chosen (carb midpoint <45 %E on 419/526 days) | MEASURED | A15 |
| Fat misses are not near-misses | effective E to rescue the 81 fat-failing days: p25=45 %, p50=75 %, p90=121 %. E=50 % rescues 23/81 | MEASURED | A15 |
| The UI disagrees with the grader | fat drawn as a **floor with no ceiling** while the grader fails above ~77 g; kcal ring ambers at 100 % vs grader 115 % (mean 334 kcal window). **Two screens can disagree about the same day** | MEASURED | A12 |
| Keto uses a different fat rule | `fatMid × 0.9…1.12` (`bmrEngine.js:313`), ±10.9 % nominal / ~±35.9 % effective. `0.34…0.40` **was never applied to keto** | MEASURED | A4, A12, A15 |

### 1.8 Pool facts

| fact | value | tier | source |
|---|---|---|---|
| Library size | **910 recipes / 14,151 Food rows** | MEASURED | A11, A10 |
| Satisfiable personas that are **pool-limited** by a convex-hull reachability test | **5 of 218 = 2.3 %** (4 vegetarian, 1 carnivore); **zero** for keto, vegan, paleo, kosher, halal, mediterranean, none | MEASURED | A11 |
| Of the 23 all-population pool-limited cases, engineered-impossible vegans | **18** | MEASURED | A11 |
| **The pool is fattier and less protein-dense than every target** | target protein median **8.16 g/100 kcal** vs pool medians none 5.39 / vegan 5.08 / **vegetarian 3.25**; target fat median 2.60 vs pool ~4.0–4.2 | MEASURED | A11 |
| Keto is the counter-example | smallest mainstream pool (53) and the **highest** in-band density (29.0 %, 92.7 % fat-OK) — solver-limited | MEASURED | A11 |
| Pure-style pool sizes | none 910 / med 814 / halal 758 / kosher 680 / vegetarian 401 / vegan 169 / paleo 167 / keto 53 / carnivore 3 | MEASURED | A11 |
| Vegan whole-food protein ceiling under the killer stack | best staple **pepitas at 5.81 g/100 kcal** against a required **7.98–8.63** → **27–33 % short**, and a full day of pepitas is **158 g fat against a 51–60 g band** | MEASURED | A7 |
| Carnivore + keto misses bind on POOL_EXHAUSTED, not pinning | **20/27 = 74.1 %** | MEASURED | A2 |

### 1.9 Search budget

| fact | value | tier | source |
|---|---|---|---|
| The attempts curve is flat after ~12 | att1 70.1 / att2 73.3 / att5 77.1 / att12 80.4 / att20 80.8 / att30 81.7 | MEASURED | A14 |
| att12 pooled over 3 seeds | **+2.24 [+1.04, +3.44]**, b=31 c=67, n=1608 — **below C14's floor** | MEASURED | A14 |
| The per-slot cap of 20 is correctly placed | cap40 **+0.62 [−0.52, +1.76]** pooled n=1608; cap12 −1.68; cap8 −4.10 | MEASURED | A14 |
| The per-slot floor of 5 is **too low** | floor12 **+1.12 [+0.24, +2.00]** pooled, b=17 c=35, at ×1.17 draws; positive 3/3 seeds | MEASURED | A14 |
| floor12 is surgical | pool 0–60: **+15.00 pts** (b=2 c=11); pools 140–300 and 300+: **b=0 c=0 exactly** | MEASURED | A14 |
| **Wall-clock cost is unusable** | two arms *proven identical* (same mean budget 20.00, same 9,773 `slotCalls`, 0 of 639 rows differing) logged 34.9 s vs 78.7 s | MEASURED instrument fault | A14 |

**Quote all cost in deterministic candidate draws, never in seconds.** Base = 133k draws.

### 1.10 Refusal

| fact | value | tier | source |
|---|---|---|---|
| **The app has no refusal path.** `diagnose()` labels a delivered plan; it never withholds | `mealSolver.js:296/:308`, every caller still ships | MEASURED | A8 |
| A **sound** pre-solve refusal exists: P7, the repaired bound | refuses **16 days**, TR 16 / **FR 0** / UR 0, precision **100 %**, recall **16/52 = 30.8 %** | MEASURED | A20 |
| What it buys | **+0.00 pts.** It converts 16 silent failures into 16 explained refusals | MEASURED | A20 |
| The non-circular support for FR=0 | those personas were **solved 310 times across 2 instruments / 6 runs and landed in band 0 times** → exact one-sided 95 % upper bound on FR rate **0.96 %**; plus **0 infinite-density and 0 supra-physical (>0.25 g/kcal) rows** in 910 recipes / 14,151 foods | MEASURED | A20 |
| Every refused day is vegan | **52/52** | MEASURED | A20 |
| `P1_emptyPool` (`afterDiet===0`), the only already-implemented exact check | fires on **0 of 578** days | MEASURED | A20 |

### 1.11 Citations

**A23: zero fabricated citations across A4–A8. 20 of 20 external sources located, fetched and
confirmed to say what was claimed.** Three real corrections, all carried forward:

1. A7's nutritional-yeast provenance is **LABEL, not USDA-VERIFIED** (the source reads *"Bob's
   Red Mill brand, manufacturer reported values"*); the cited **FDC id 1946780 returns 404**.
2. A5's *"goal-programming MMKP / structurally Leung 1995"* is **DERIVED — no source classifies
   Cut Protocol.** Must not be rendered as a literature classification.
3. A6's contaminated SEO tier (macro-trackers.com et al.) is self-published and **propagated
   nowhere** — grep over all of `docs/surgery/CAMPAIGN` returns those domains only in the flag
   itself.

Also settled: **no consumer app surveyed publishes a per-macro fat tolerance, and none reports
a days-in-band hit rate** (A6, 8 apps). 70.1 % is comparable to no published figure in either
direction. And **no published diet-optimisation study reports a days-in-band number** — the
literature optimises cost or deviation and reports *feasibility*, a different quantity (A5).

---

## 2. THE CONTRADICTION LEDGER

The highest-value section. Every live disagreement, its current resolution, and whether the
survivor is sound. **The corpus's own discipline is to show competing figures and defend a
pick, never to average them.** That is followed here.

### 2.1 The all-days ceiling: 88 % → 91.0 % → 97.2 %

| ceiling | source | tier | status |
|---|---|---|---|
| **"near 88 %"** | mission prompt §3 + `BRIEF.md` | asserted | **DEAD.** Not reproducible from its own 83-day count: 495/578 = **85.6 %** (A3, DERIVED; A8 landed on 85.6 % independently). Two errors, not one — the tier is *also* over-counted |
| **91.0 %** (526/578) | A3 / C7 | DERIVED | **Superseded as a bound** |
| **97.2 %** (562/578) | A20 repaired | MEASURED bounds → DERIVED | **The survivor.** Reproduced independently by A22 (16 days, 562/578) |

**What the dead term actually broke — state this precisely, the corpus does.**
`A3-classify-all.mjs:50` and `A3-prove-infeasible.mjs:57` compute the food side of the bound as
`f.kcalPer100g > 0 && f.proteinPer100g > 0 ? … : 0`. The Prisma `Food` model has **no such
columns** (`kcal`/`protein`), so **the expression evaluates to 0 across all 14,151 rows**
(A20 MEASURED; A22 reproduced independently on its own DB copy, `PRAGMA table_info(Food)` has
neither column, real max protein density **0.2751 g/kcal**).

**But A3's operative SCALED bound is recipe-only *by construction* (`:62`
`pool.filter(isMealEligible)`), so the dead term never entered it.** A3's prose overclaimed
("recipes *and* foods — the macro closer may add one"); the arithmetic did not. So **91.0 % was
not wrong because of the dead term — it was wrong because it omitted the macro closer
entirely.** A20 repaired it (SCALED + every surviving adjuster at its full `MAX_GRAMS`
ceiling) and the provable impossible set fell 52 → 16 days, 16 → 10 personas.

**Is the survivor sound? Yes as a bound, and it must be stated as one.** 97.2 % is an *upper*
bound: it says only 16 days are provably impossible. It is **not** a claim that 562 days are
achievable — and A24 (I9) is emphatic that it is **a proof that WEAKENED, not a ceiling that
rose.** 36 days moved INFEASIBLE → **UNKNOWN**, not INFEASIBLE → satisfiable. They gained no
certificate.

**The honest sentence, and the one the new prompt should carry:**
> **16 days are provably impossible; 67 days are unknown in both directions.**

Two further caveats that ride with it and may not be dropped:

- **A3's own caveat, retained by A20:** *the relaxation proves impossibility only, never
  feasibility.* Both bounds ignore fat and carbs, and A2 measured 19 of 110 satisfiable misses
  binding on exactly those. A real ceiling under 100 % may exist; it is just not *structural*.
- **The 97.2 % bound lets every adjuster reach its full `MAX_GRAMS` ceiling.** Whether the
  closer would realistically add 180 g of anything is a **product question A20 did not test**.

### 2.2 The impossible tier: 83 → 52 → 16 provable + 67 unknown

**What is true, and it is a three-bucket decomposition, not a single number** (A24, DERIVED
from `A20/A20-day-labels.jsonl`; this is the repair of A20's matrix that summed to 511):

| bucket | days | in band | miss |
|---|---|---|---|
| **INFEASIBLE — proved** (A20's repaired bound) | **16** | 0 | 16 |
| **UNKNOWN** — 36 days that lost their proof + 31 prior | **67** | 0 | 67 |
| **SAT-certified** — an in-band plan exists | **495** | **405** | 90 |
| **TOTAL** | **578** | **405 = 70.07 %** | 173 |

**The "0 in band" against the 67 UNKNOWN days is TAUTOLOGICAL and must not be read as evidence
of infeasibility** — a certificate *is* an in-band day, so any day with an in-band observation
is SAT-certified by construction.

Provenance of each figure:

- **83** — the tier label in `personas.mjs:248`, which is `weighted(r, [['every-protein-walled', 55], ['floor-vs-rate', 45]])`. **Two constructions, only the first unsatisfiable.** `every-protein-walled` lands **0 of 53** days in band; `floor-vs-rate` lands **20 of 30 (66.7 %)**. A construction cannot be unsatisfiable by design and pass two thirds of its days. Independently corroborated by A1 from a different population construction and call path: the IMPOSSIBLE tier produced **21 of 86 judged days in band**.
- **52** — A3's SCALED proof (16 personas). Falsification check: **0 of 52** landed in band.
- **16** — A20's repaired bound (10 personas). p030, p051, p059, p211, p222, p227 lose their proof.
- **67 UNKNOWN** = the 36 that lost their proof + the 31 A3 restored to the denominator (526 − 495).

**Contested at the margin, disclosed rather than resolved:** A3 flags **p175** — SCALED bound
clears the floor by 7.9 g (8.8 %) yet it scored 0/1 days. *"If impossible: 53 days, ceiling
90.8 %."* A3 reports 52 because 52 is what it proved. (ESTIMATED.)

### 2.3 The declared asymmetry: denominator from A3, ceiling from A20

**This looks like a double standard and the report defends it as C21's discipline.**
The denominator is A3's **526**; the ceiling is A20's **repaired** bound. Keeping them separate
is the point, because **A20 measured that using one object as both the ruling denominator and
the refusal predicate launders +4.94 pts** (§4, P4).

**The cost is stated rather than hidden:** A20's repair implies a *stricter* satisfiable
denominator of **562**, on which the same baseline reads **72.06 %** (MEASURED) — **five points
worse.** 526 is kept for three reasons: (1) it is C7's ruling, corroborated by A1 and reproduced
by A22; (2) every Phase-4 delta was measured on it or its rig analogue, and re-basing would
require re-running the fleet; (3) promoting the 36 freed days to "satisfiable" asserts a
feasibility nothing measured — those personas were solved 310 times and landed in band 0 times.

**And the choice does not change the answer.** A21 measured its headline across **4 denominators
× 3 seeds**: spread **1.99 pts** (DERIVED).

### 2.4 A13's `wls2` (+14.74) vs A17's trimmer (+14.93) — measured, not assumed

**C23 called them "near-certainly the same effect reached from two directions." That was an
assumption when C23 was written. It was subsequently MEASURED.**

| measurement | value | source |
|---|---|---|
| wls2 rescues / trim rescues / **both** | 87 / 84 / **72** | A24, from `A21-overlap-s424242.json` |
| union | **99** | A24 |
| Jaccard | **0.727** | A24 |
| naive sum vs union | 171 vs 99 → **42.1 % double-counted** | A24 |
| **Trimmer's marginal contribution over wls2** | **+2.24 pts on 12 days — BELOW C14's 3.5 floor → UNRESOLVED** | A24 (I2) |

**Answer: the overlap is measured. Caveats: one seed (424242), and it was measured by A24 from
A21's overlap artifact — not by A13 or A17.**

**Do not mix A22's and A24's overlap numbers — they count different things.** A22 reports
*net* gains (wls2 +79 / conc8 +56 / trim +80 = 215 days, stack nets 96, overstate **2.24×**);
A24 reports *gross* rescues (87 / 61 / 84). Both are in the corpus. Quote one convention.

Corroborating the "single failure mode" reading from four independent directions: A15
(42/42 fat-only misses OVER), A17 (97 OVER / 1 SHORT), A19 (83/83 rescued were OVER), A21
(under the stack: fat OVER 81→17, carb OVER 53→11, **fat SHORT 0 in all eight arms measured**).

### 2.5 A21's "best stack" — overstated as "combined"

**It contains 2 of 6 levers.** Identified by signature, because `runRig.mjs:214` records
`treatment.NAME || path.basename(tp)` — only the `--treatment` module. A13-class levers ship as
a `NODE_OPTIONS --require` preload the header **cannot** name.

| signature | base | wls2 | conc8 | **stack** | floor25 | reading |
|---|---|---|---|---|---|---|
| `A16-conc*` slots | 0 | 0 | 358 | **321** | 0 | pool lever **IN** |
| min(protein,sides)Scale | 0.5 | 0.5 | 0.5 | **0.5** | 0.25 | 0.5× floor **NOT moved** |
| slots protein≠sides | 2088 | 2525 | 2286 | **2661** | 2203 | 4-macro portioner **IN** |
| filled warned slots | 341 | 405 | 242 | **293** | 202 | A13's warning cost **IN** |

**Stack = A16 concentrate-recipes N=8 + a `wls2`-equivalent 4-macro portioner. The trimmer,
att12 and the 0.25× floor are OUT.**

**NOT REACHED:** the exact invocation was never written to disk — no run script, no shell log in
`A21/`. `a13-hook-v2.cjs` and `-v3.cjs` at `A13_FLOOR=0.5` cannot be separated; they are
behaviourally identical. **Unreproducible as specified** (A24, I7).

**And the stack is beaten by an arm that needed no pool change:** `floor25w` **520/536 =
97.01 %** vs stack **509/536 = 94.96 %**; paired stack → floor25w **+2.05 [+0.65, +3.46]**,
b=2 c=13 — **below C14's floor, so not distinguishable from zero**. `floor25w` has no replicate
seed (§5).

**Marginals within the stack (MEASURED, A21):** `conc8 → stack` **+7.46 [+4.90, +10.02]** (the
portioner added to the pool lever); `wls2 → stack` **+3.17 [+1.44, +4.90]** (the pool lever
added to the portioner) — **below C14's floor**.

### 2.6 A7's "zero vegan protein-concentrate rows" — falsified evidence, surviving conclusion, RELOCATED wall

**Falsified (A20, MEASURED):** `Seaweed, spirulina, dried` is **57.5 g protein/100 g** and
returns `isExcluded = false` for p073 (vegan + soy + gluten + legumes + nuts + sesame); **180 g
clears all 16 protein floors.** `Nutritional powder mix, protein, NFS` (78.1 g P/100 g) and an
Isopure row also pass the vegan gate. A7's name-based search (`rice protein`, `nutritional
yeast`, `torula`, `chlorella`, `pea protein`, …) was correct on each name it tried and **missed
spirulina because spirulina was not on the list.**

**Does the conclusion survive? Yes — A20 says it is *strengthened*, and it MOVES.** A7 said
"library problem, not botany." A20 locates the wall precisely and it is **narrower than a
library**:

> `planContext.js:167-178` `ADJUSTER_CANDIDATES` is a **hardcoded ten-name list**, and all four
> protein entries — chicken, Greek yogurt, tofu, lentils — die to vegan + soy + legumes.
> **0 of 4 protein adjusters survive for 16/16 refused personas.** The whole 29.2 g closer
> ceiling is oats, rice, potato, avocado.

**The refusal is a claim about a ten-line constant, not about food. One name added dissolves
every remaining proof — so a refusal shipped today is wrong after that edit.**

**And this does NOT license "one row fixes the tier."** A16 measured the outcome separately:
IMPOSSIBLE tier n=86 judged, baseline 21 in band (24.4 %) → conc-N8 **24** (27.9 %), gained 4
lost 1. **61 of the 65 baseline IMPOSSIBLE misses survive one concentrate row.** So *"one row
dissolves the BOUND"* (A20) and *"one row does not rescue the TIER"* (A16) are both true and are
different statements. Do not collapse them.

**A7's own harness error, self-caught and recorded:** v1 used `styleExcludedByMetadata`, the
metadata arm only, ranking seal, whale and whey as top "vegan" survivors — a **46 % swing
produced entirely by A7's own harness** (6,772 → 4,634 rows). Caught by a sanity probe, not
because the number looked wrong.

### 2.7 The verifiers that agreed with defects — there are THREE, and the first is `oracle.mjs`

**C20 asked A24 to note this was "the second time." A24 found three and stated it as a
pattern.** In chronological order of discovery:

| # | verifier | what it agreed with | caught by |
|---|---|---|---|
| **1** | **`oracle.mjs`** — mandated by C16 as *the* defence against the engine grading itself | Reported **0 leaks on 309 `Sea cucumber, yane (Alaska Native)` placements** across 277 vegan + 32 vegetarian plans. Catches **1 of 13** C13 rows (A17) — amended to **2 of 13** by A22 (`Squirrel, ground, MEAT` and `Seal, bearded (Oogruk), MEAT`, both only via the literal token `meat`) | A17, amended A22 → issued as **C19** |
| **2** | **A20's own `A20-bound-audit.mjs:54`** | Copied A3's dead field names, so its **"212/212 agrees with A3" was agreement on a shared bug, not corroboration** | **A20, against itself**, under integrity rule 7 → **C20** |
| **3** | **A16's `A16-leakcheck-v2.mjs`** | Silently inspected **2,552 of 2,910 slots** (resolved only its own catalogue ids; reported `unknown-ids 358`) | **A16, against itself**; closed by `A16-conc-leakcheck.mjs` — 358/358, 0 leaks |

**A24's statement of the pattern, and it is the study's most uncomfortable finding:**
> **Every independent verifier in this study was built from the same vocabulary as the thing it
> verified.** Determinism is not validity — the same lesson `HARNESS-INCIDENT.md` records,
> arrived at again from a different direction.

**Distinguish these from the instrument faults that WERE caught before they contaminated
anything** — those are the reason to believe the rest:

| fault | caught by | outcome |
|---|---|---|
| A17's closer re-implementation **v1** silently discarded additions 2 and 3 (`out.indexOf(target)` returned −1 after round 1) | A17's own **passthrough control** (559/639 vs the required 639/639) | Caught before any delta was reported. v2 is 639/639 byte-identical to the shipping closer |
| A7's v1 metadata-arm harness (46 % swing) | A7's own sanity probe | Corrected 6,772 → 4,634 |
| A1's `compare.mjs` v1 reported only the unpaired interval (±5 pts at n≈620) | A1, **before shipping** | `compare.v2.mjs` adds the paired McNemar interval |
| `compare.v2.mjs`'s `VERDICT` line still applies the pre-C14 ±1.5 floor | A14 | A24 verified **no agent harvested it** |
| A22's **predecessor** filed A19's no-roll count as not reproducing, comparing against a histogram over a different day set | **A22, against itself** | Row retracted. **A19 was right** |
| A14's wall-clock cost contaminated by machine load | A14 | All costs re-quoted in deterministic candidate draws |

### 2.8 The remaining live disagreements, carried openly

| disagreement | resolution status |
|---|---|
| **A2 vs A3 — how many days to restore** | 7 (A2, 392/502 = 78.1 %) vs **31 (A3, 405/526 = 77.0 %)**. **A3's is the ruling**; A2's is under-corrected. A2 and the brief bracket the true figure; neither is it |
| **A3 vs A11 — what "pool-limited" counts** | **Both stand; they measure different things.** A3: 140 days by a *pool-size vs slot-count* test. A11: 5 of 218 satisfiable personas (2.3 %) by a *convex-hull reachability* test. **The report must never present either as "the" pool-limited number without naming its test.** And A3's own figure is unstable (§5, I11) |
| **A3 vs A7 — is the vegan wall structural or authored** | **Both stand.** A3 proves 52 days impossible against *this library*; A7 argues one authored concentrate row would clear it. A20 relocates the wall to `ADJUSTER_CANDIDATES` (§2.6). The report must say **which sense of "impossible"** it means |
| **A13 vs A21 — do warnings rise or fall** | **RESOLVED, and neither agent was wrong.** A13 counted **filled** slots (341→405); `A21-denoms.json` counted **all** slots (389→454). The gap is exactly the unfilled slots (48 base, 49 wls2), **every one of which carries a warning** (48/48, 49/49). The stack's *fall* 389→316 is base-vs-stack, not a test of the portioner: on filled slots conc8 alone drops to 242 and the stack rises back to **293**. **A13's cost is intact inside the stack, masked by the pool lever** |
| **A11 vs the brief — protein or fat is the binding macro** | **Not reconciled, and should not be smoothed.** A11: protein is the binding *ratio* (failure axis on every vegetarian pool-limited case; protein-ok density below fat-ok density in 6 of 9 styles) — **A11 tags this ESTIMATED as a causal claim.** A2/A15/A17/A19: the observed failure *direction* is fat-OVER, overwhelmingly. These are compatible surfaces of one pool defect — A16's mechanism ties them: the 8 concentrate recipes are **high-protein, LOW-FAT snacks** (fat density 0.54–0.91 g/100 kcal against a 2.32 target centroid), and *"one low-fat high-protein snack per day is what buys +10.45 pts"* |
| **A15 vs A12 — is the ruler implicated** | **No contradiction, same direction.** A12 measured ruler *coherence* (0.0 points); A15 measured ruler *width sensitivity* (≤4 points, only past every published guideline) |
| **A4 vs A15 on C3** | **Both stand.** A4 found a real defect in code (effective pass floor 0.2475·lbm sits **17.5 % below** `ESSENTIAL_FAT_PER_LB_LBM = 0.3`). A15 measured its realized incidence at **exactly zero**: 0 of 578 days occupy the hole; the 18 days below 0.30·lbm all already fail and are all `fat = 0` empty-plan days. **A correctness finding, not a live one** — same shape as C13's latent leak |
| **A5's "never worse" sub-prediction** | **FALSIFIED.** dayN lost **34** previously-in-band days across 3 seeds, because days share a week-level variety budget the diet-LP analogue has no equivalent for |
| **A16 vs a C11 reading** | **A16 contradicts C11 as an authoring instruction.** Of vegetarian-N68's 54 gained days, **44.4 % land on `dietStyle=none`** and only **9.3 % (5 days) on vegetarian**; vegetarian personas themselves move **+1.7 pts (b=4 c=5) — UNRESOLVED**. C11 is right that vegetarian is the thinnest pool and wrong as a purchasing instruction. C11 **is** corroborated on keto: zero synthetic rows admitted, zero days gained, in all five arms |

---

## 3. THE DEAD-CLAIMS LIST

**Premises the new prompt must not resurrect.** Each with what killed it.

### 3.1 From the mission prompt and BRIEF

| dead claim | what killed it |
|---|---|
| **"Fat is graded at ±8 %, tighter than any published dietary guideline expresses"** | The effective gate is **±33.1 %** — `bandMiss()` divides by the **midpoint**, and `DAY_FAT_TOLERANCE_PCT = 0.25` stacks on top: pass window `[0.2475, 0.4925]·lbm`, half-width/mid = 0.1225/0.37. That is **4.08× the nominal band** and **LOOSER than the NASEM AMDR's ±27.3 %**, and ~**2.4× wider** than the only published per-macro gram convention (IIFYM +5 g/−10 g). **Four independent derivations: A4, A6, A12 and the coordinator reading `mealSolver.js:205-250`.** A6 and A4 landed on the identical `0.2475·lbm` without coordination. **Tightening fat would LOWER the 70.1 %.** Any lever that raises the number by relaxing fat is pushing on an already-loose constraint |
| **"83 days are structurally impossible; ceiling near 88 %"** | The tier holds two constructions; one lands 20 of 30 days in band. And 495/578 = **85.6 %**, so 88 % never followed from the prompt's own count either. See §2.2 |
| **"Pinning is the diagnostic — the highest-prior mechanism in the study"** | Under the winning arm **95.7 % of days that PASS touch a bound** (473/494, vs 74.1 % at baseline). Pinning is not even monotone across arms: it ranges 27–62 % while compliance ranges 77–97 %. **A property nearly every successful day has cannot indicate failure.** A10 saw the inversion first on a paired proxy; A13 reproduced it on the shipping solve path. The underlying statistic is REAL — A13 reproduced the brief's own motivating pair on an independent path (**40.1 %** of slots vs 39.3 %, **71.3 %** of missed slots vs 68.3 %) — **only its interpretation was wrong** |
| **"The 2.0× ceiling binds; widening the bounds gives 625 g chicken with 2 g pine nuts"** | **The binding end is the FLOOR.** 66 of 70 pinned days needed the day **SMALLER** and were blocked at 0.5×; **0 were blocked at the ceiling alone.** The divergent shape the objection describes is **2.2 % of filled slots.** A2 first; A14 independently found the same lower-bound story on the attempt budget (the *floor* of 5 is the unmoved knob). **The customer-acceptability objection to widening the CEILING is real and A5 corroborates it from 80 years of diet-LP literature; neither is evidence about the FLOOR** — a point A5's own coordinator note flags as open |
| **"A flat budget of 20 starves thin pools"** | Not observable under current code. The thinnest stratum is where depth gains **most**: flat20 on the 60 thinnest days is **+16.67 pts** (b=2 c=12), the largest gain of any stratum; pools above 300 move **b=0 c=0 exactly** |
| **"`solveGeneral`'s weights are the objective to sweep"** | **Unreachable at `BRAIN=off` — zero product paths.** A18's hook **failed loud** (`1 edit requested, 0 applied`, EXIT=3) rather than silently measuring nothing. Its live analogue `SCORE_WEIGHTS` provably cannot change the in-band count |
| **"The macro closer's gate fires on 240 of 2,432 slots (9.9 %)"** | Wrong denominator. `macroCloser.js:116` selects **one host slot per day**, so the structural cap on any per-filled-slot rate is 622/2818 = **22.1 %**. The real rate is **957 of 2,072 invocations = 46.2 %** — the per-slot framing understates it **~4.5×** |

### 3.2 From the research brief

| dead claim | what killed it |
|---|---|
| **"The adaptive (pool-scaled) budget bought 53.3 → 60.4"** | A14 measures `flat14` **equivalent to adaptive at equal mean depth** (15.08): **+0.12 [−1.62, +1.87]**, b=101 c=103, pooled n=1608. **The gain was DEPTH, not pool-scaling.** The `n/10` scaling in `slotAttemptBudget` is not what paid |
| **H1 "the ruler may be wrong; the fat band is ±8 %"** | See §3.1 row 1 and §1.7. ≤4.0 of 23.0 points are ruler-attributable, only at ±50 % |
| **H3 "the macro closer is under-used"** | The closer is **structurally unable** to fix the largest bucket. It builds its gap list from **shortfalls only** and `wouldHarm` only ever blocks — **no path in the module reduces anything** — while 97 of 98 fat-failing days are OVER. Widening its candidate set is **+0.19 (unresolved)**, gains land 9-of-10 in the refusal tier, **and it leaks** |
| **H4 "restricted diets are pool-limited"** | Only **2.3 %** of satisfiable personas are pool-limited by a hull test. The weak corners are **solver-limited**. Keto is the counter-example: smallest pool, highest in-band density |

### 3.3 Instrument and verification claims

| dead claim | what killed it |
|---|---|
| **"`oracle.mjs` verifies leak-freedom"** | **It misses 12 of 13 C13 rows** (A17) / **11 of 13** (A22's amendment — 2 caught, both only via the literal token `meat`), and **reported 0 leaks on an arm that placed Sea cucumber 309 times.** Also: **4 of its 5 baseline "leaks" are false positives** (`oracle.mjs:59` lists `"nut butter"` under `nuts`, `:68` aliases tree nuts to nuts → "Peanut Butter" flags as a tree nut, against `CLAUDE.md`'s own rule that peanuts ≠ tree nuts); the 5th is "Egg Plants" matching the vegan egg term. And `oracle.mjs:54` deliberately omits bare `"flour"` from the gluten list, so it would not have caught a Self-raising Flour row reaching a gluten-excluding persona. **RULE: "oracle says zero" is NECESSARY, NOT SUFFICIENT. Any leak claim on a pool, gate or candidate-set change must ALSO check the candidate set BY NAME against C13's list.** A16 received C19 mid-flight, re-checked by name (70 distinct Food names, 0 hits), and **downgraded its own leak claim from verified to necessary-condition-only** |
| **"A20's audit agrees with A3, 212/212"** | Agreement on a shared bug. Self-reported by A20 |
| **"A19's oracle bound is 87.7 % / +10.6 headroom"** | Mixed denominators — numerator on **planned** days (553/639), denominator on **judged** days (536/622). Judged-consistent: **86.9 % (466/536), headroom +9.9**, and 78.5 % all-judged. **A19's DELTAS are unaffected; only the bound moves** |
| **STATUS.md's own instruction: "A19's oracle bound is the number A25 should keep"** | **That instruction is wrong** and is corrected in REPORT.md §3.1 rather than quietly dropped. Use **86.9 % / +9.9** |
| **A20's ledger row "KPI-1 +0.00 pts (77.00 % both)"** | Transcription defect. The **delta reproduces**; the level is **72.06 % (405/562)**. 77.00 % is P4's level at n=526 |
| **A20's P7 confusion matrix as a ledger row** | Sums to **511**, not 578 — omits the 67 UNKNOWN-accepted days. A20's *prose* is not defective; the ledger row is |
| **A22's row "A19 no-roll count does not reproduce"** | **Retracted by A22 against itself.** 553 − 470 = **83, exactly 15.0 %**. The predecessor compared against histogram bucket 0 (147) over all 639 planned days — the wrong denominator. **A19 was right** |
| **"The baseline has 5 allergen leaks"** | All 5 are oracle false positives (§1.6) |

### 3.4 Levers that are dead

| lever | why |
|---|---|
| **n-knob per-role portioning** | **+0.37 / +0.18 / −0.37** over 2-knob across 3 seeds — unresolved. **97.6 % of the n-knob gain is already available at today's degrees of freedom.** It also raises any-knob pinning 39.4 → 61.5 % and puts 17.7 % of slots past a 3× role-scale spread (vs baseline 8.4 %) |
| **Per-role scale boxes** (veg 0.75–2.0, fat 0.5–1.5) | **−0.56 pts** (b=12 c=9), UNRESOLVED. Still worse than baseline on spread |
| **`SCORE_WEIGHTS` retune** | 0.00 pts in all 5 arms, structurally (b==c in 6 of 6) |
| **Closer candidate-set widening** | +0.19 unresolved; **9 of 10 gained days in the refusal tier**; **realized C13 leak — AUTOMATIC FAIL under integrity rule 2** |
| **A19's `dayNstrict`** | **+1.68 (b=0 c=9) at all three seeds — and all 9 days are already `wls2`'s.** Marginal value **+0.00 pts / 0 days. Fully subsumed** |
| **Naive `dayN` (unconstrained day harvesting)** | Breaks the variety contract: 189 days switched, 28 windows breached the repeat cap, **24/250 customers ended with `varietyCapHeld=false`**, 177 consecutive-day duplicate slots. And it **lost 34** previously-in-band days |
| **Raising `attempts` above 12, or raising the per-slot cap above 20** | 12→30 buys +1.30 pts for 2.27× draws; cap40 is a clean null at n=1608. **The only arm reaching 3.5 pts on a divisor change (`cap200div2`, +3.54) costs 5.98× the draws — uneconomic, single seed** |
| **Ruler widening as a compliance lever** | ±50 % is 1.83× the NASEM AMDR half-width, supported by no published guideline. **Not this study's call, and not a solver lever.** A15 explicitly refuses to recommend it |
| **A17's trimmer as a SECOND ~15-point lever** | Marginal over `wls2` is **+2.24 on 12 days**, below C14. And **disqualified as prototyped** by the honesty regression (§1.6) |

---

## 4. THE INFLATION TRAPS — forbid these explicitly

### 4.1 C21 — the self-scoring trap. Refusal is not compliance.

A20 priced three ways to raise the headline by **refusing** days rather than planning them.
All three are MEASURED. **All three are forbidden.**

| predicate | Δ pts (KPI-1 on C7's denominator) | false refusals | precision |
|---|---|---|---|
| **P4** — ship **A3's own SCALED bound** as the refusal rule | **+4.94** | 0 by construction, **36 unproven** | 100 % (tautologically — the ruling denominator and the refusal predicate are *the same object*) |
| **P5** — refuse the engineered IMPOSSIBLE tier wholesale | **+5.72** | **28 certificated days** (+3 unknown) — wrong on **37.3 %** of the tier | 36.4 % |
| **P6** — **re-badge the existing `diagnose()`** | **+27.94** and a **perfect 100 % KPI with zero behaviour change** | **186** | **7.9 %** |
| **P7 — the SOUND repaired bound** | **+0.00** | **0** | **100 %** |

- **P4 is the sharpest trap and nobody flagged it before A20.** It clears C14's 3.5-pt floor,
  so it would read as a real result.
- **P6 is worse than C21 states, per A24:** `diagnose()` is the **sole** honesty signal on
  **27.7 % of missed days**, so re-badging it **converts the honesty mechanism itself into a
  denominator filter.** A8 named this route ("relabelling") before A20 priced it.
- **The sound path buys nothing and that is the honest pitch.** It converts 16 silent failures
  into 16 explained refusals.

**Rules to carry verbatim into the new prompt:**
1. **No lever may count a refused day as a compliant one.**
2. Any stack including a refusal path reports compliance **on the denominator that existed
   before the refusal**, and reports refusal precision/recall **separately**.
3. Ground truth for a refusal path comes from accumulated certificates, **never from the app's
   own `diagnose()`** — that is the engine grading itself.
4. **Audit every delta for hidden denominator movement, not just for band-widening.**
   *(A24 did: 622 judged / 536 satisfiable-judged in all 14 headline arms. No lever moved a
   denominator. Hold that property.)*

**A8's three named gaming routes, all still live as hazards:** denominator laundering (every
refused day leaves KPI-1's denominator — refusing the worst-fitting 20 % raises it with zero
solver improvement); refusal-as-success (a single-scalar KPI counting TR as a win means refusing
*everything* scores exactly the infeasible share); and relabelling. Guards: a **fixed benchmark
cohort**, publish FR/TR counts beside every KPI-1 figure, and report KPI-3 as a **triple**
`(TA, TR, errors)`, never as one scalar.

### 4.2 NEVER SUM THE LEVER TABLE

**The hard arithmetic cap, MEASURED (A24, I1):** baseline satisfiable misses are **123 of 536**,
so **the union of ALL levers cannot exceed +22.95 pts.**

**The naive sum of the six measured gross gains is arithmetically impossible by 2.56×:**

```
wls2 87 + trim 84 + conc8 61 + floor25 43 + att12 31 + dayNst 9
  = 315 days = +58.77 pts   against a hard cap of +22.95 pts
```

**Measured overlaps that collapse the sum:**

| pair | overlap | marginal | verdict |
|---|---|---|---|
| `wls2` ∩ `trim` | **72 of 84** (J=0.727) | +2.24 pts / 12 d | UNRESOLVED |
| `wls2` ∩ `dayNstrict` | **9 of 9 — 100 %** | **+0.00 / 0 d** | **subsumed, dead** |
| `wls2` ∩ `att12` | **27 of 31** | +0.75 / 4 d | UNRESOLVED |
| `wls2` ∩ `conc8` | **52 of 61** | conc8→stack **+7.46**; wls2→stack **+3.17** (below C14) | — |
| `wls2` ∩ `floor25` | 36 of 43 standalone… | **…but STACKED it is +28 days = SUPER-additive.** Standalone-unique understates it **4×** | the one exception |

**`floor25` is the one lever whose overlap arithmetic runs the other way — note it, because a
blanket "levers overlap, discount everything" rule would get this one wrong.**

### 4.3 The other inflation vectors A24 named

| vector | discipline |
|---|---|
| **Chaining a rig DELTA onto a fleet LEVEL** | C15. A24 checked and found **no agent did it** — the one instance of the vector is **STATUS.md's own "~4 recipes = 85 %"** headline. Do not repeat it |
| **Quoting A16's "~4 recipes = 85 %" as MEASURED** | It is **ESTIMATED**: it needs a **`Food` row that does not exist**, at **LABEL** tier, whose cited **FDC id returns 404**, plus ~4 authored recipes optimised straight onto the measured target centroid with no taste, cost or repeat-fatigue constraint. **A16's own words: "upper bound, not a forecast — a human author aiming less precisely needs MORE rows."** Restate as *1 unauthored row + 4 recipes* |
| **Quoting 97.0 % without its price** | `floor25w` ships **35.5 % of served satisfiable slots below the old 0.5× floor** and **10.4 % of plates past a 4× role-scale spread**. **Keep the number and the quarter-portion price in the same sentence** |
| **Averaging the three ceilings** | Forbidden. Name one, defend it, show the others and reject them for stated cause |
| **Double-counting against the PRIOR campaign** | **Checked and negative.** 129 of 129 arms carry the post-campaign fingerprint; every Phase-4 delta is paired against a baseline that already contains all five applied levers. **A13's `wls2` is not composition-aware sampling re-sold** — sampling weights `pickRecipe`, `wls2` changes `scaleRecipe`; different call sites, and A22's kcal-only control returns +0.00 through the same hook |
| **Multiple comparisons** | A18 ran 11 arms at one seed and correctly reported that **no correction was needed** — the largest positive delta was **+0.75**, and the only two arms past 3.5 pts were **pre-registered negative controls** |
| **Re-running a surprising result until it looks normal** | Integrity rule 13. Record the surprise and its seed, then investigate the instrument |

---

## 5. THE UNMEASURED LIST

Everything the corpus flagged as not measured / estimated / single-seed, with who owns it and
what would settle it. **Single-seed results are labelled as such throughout.**

### 5.1 The two that bound the headline

| # | question | why open | what settles it | owner |
|---|---|---|---|---|
| **1** | **Is the 0.25× portion floor servable?** | **The rig records scale ratios, not GRAMS.** A13 measured 35.5 % of served slots below the old floor and labelled acceptability **ESTIMATED — "unacceptable for some plates until someone renders them"** | Render the 5th-percentile plates at 0.25× and put them in front of the owner. **A product judgment, not a measurement — and it gates the study's highest arm** | A13 / owner |
| **2** | **Does 97.0 % replicate?** | `floor25w` exists at **ONE SEED.** Only `A13-floor25w-s424242.jsonl` is on disk. **A22 re-ran the same seed — that is reproducibility, not replication** (integrity rule 8) | Run `floor25w` at seeds **20260730** and **8675309** through A1's rig. **One command each.** A24 issued this as I8 | A13 |

### 5.2 Structural unknowns

| # | question | status |
|---|---|---|
| **3** | **The 67 UNKNOWN days** | No proof of impossibility, no certificate of satisfiability. **"0 in band" for them is tautological.** This is where the ceiling uncertainty lives. Either a tighter bound proves them infeasible, or one in-band plan certifies each. A20/A24 own it |
| **4** | **How many days are pool-limited?** | **NOT MEASURED — quote the range, never the point.** A3's own sensitivity table spans **25 to 145 days** as the cut moves 10→100; `A3-final-split.mjs:24` gives **140** while `A3-classify-all.mjs:90` gives **62**. Only 140 is in the ledger. Settling it needs a definition ruling on `afterStack` **before** a count. A22 flagged it; A24 issued it as I11 |
| **5** | **Adjuster-placed foods and leaks** | **Every leak check in this study is STRUCTURALLY BLIND to adjuster-placed foods.** The rig's slot record is `slotType, slotIndex, recipeId, proteinScale, sidesScale, pinnedLo, pinnedHi, kcal, protein, warning` — **no ingredient names, no adjuster field.** A16 states it plainly: a text scan returning 0 is evidence the JSONL never records them, **not evidence of absence**. Fix: add an adjuster field to the rig's slot schema and re-run the C13 by-name check across all arms |
| **9** | **Would the closer realistically add 180 g?** | A20's repaired bound lets every surviving adjuster reach its full `MAX_GRAMS` ceiling. Whether that is a plan anyone would eat is a **product question A20 did not test.** Render it, as with #1 |
| **10** | **A21's stack, exactly as run** | The invocation was **never written to disk** — no run script, no shell log. Composition is DERIVED by signature. Re-run from a written command. A24 issued this as I7 |
| **12** | **Whether the ruler should change** | **Deliberately not answered.** A15 measured sensitivity; A4 measured defensibility; **the two point opposite ways** — the nutritionally-motivated changes A4 derived (20 %-energy fat floor: −6.5 pts; essential-fat floor: 0.0) **tighten or do nothing.** The owner's call, on A4's citations, **not** on A15's table |

### 5.3 Under-powered — unresolved, not small

| # | arm | figure | what it needs |
|---|---|---|---|
| **6** | A18's `s-fallbackcomp` (give the no-fit fallback rank a fat/carb term) | **+0.75 at BOTH seeds**, c>b both times, both intervals span zero | A third seed and a larger n. **A18 names it the only arm worth that** |
| **7** | A14's attempt floor 5→12 | **+1.12 [+0.24, +2.00]** pooled at n=1608 | **n ≈ 6,400 satisfiable days** — 4× the pooled sample (A14 computed it) |
| **8** | A15's `CARB_MIDPOINT_BUFFER_G = 0` | **+2.7 pts is the BAND-SHIFT COMPONENT ONLY.** The constant feeds both the band **and the solver's aim**, and re-scoring holds the plans fixed | A **re-solve** with the buffer at 0, in A13/A21 territory |
| **11** | A13's k=2 vs k=5 at scale | +0.37, b=8 c=10 | Larger n — **low value**, since 97.6 % of the gain is already available |
| — | A13's protein hinge removal | **−2.99** (b=25 c=9) — UNRESOLVED under C14 | more n |
| — | A13's per-role boxes | **−0.56** (b=12 c=9) — UNRESOLVED | more n |

### 5.4 Single-seed results — label these as points, not estimates

| arm | seeds | note |
|---|---|---|
| **A13 `floor25w` (97.01 %) and `floor25` alone (+4.29)** | **1** (424242) | The study's highest arm and its only pinning-reducing arm |
| **A13 `roleb`** | 1 | |
| **A16's NINE whole-food arms** (vegetarian N5–N68, vegan N5–N40) | **1** | A16 states it: *"all nine whole-food arms are single-seed points, not estimates."* Every one has c ≫ b and \|Δ\| ≥ 4.29, so **the direction is safe; the exact knee position is unreplicated.** Only the concentrate arm replicated (conc-N4: +7.84 at s424242, +8.21 at s20260730 — delta spread **0.37 pts**) |
| **A14 att20 (+3.73), att30 (+4.66), cap8, cap60div5, cap200div2, floor8, floor20, floor40** | 1 | **Read as upper bounds, not estimates** — att12 lost **45 %** of its primary-seed magnitude on replication (+3.36 → +1.49 / +1.87) |
| **A17's trimmer honesty regression** | the regression appears at **s424242 (1/1)** and **NOT at s20260730 (0/0)** | A22 reproduced the s424242 result. A17 argues it is structural (the trimmer mutates totals *after* the warning is formed), not a one-off — **that argument is DERIVED, the incidence is single-seed** |
| **The A13∩A17 and A13∩A16 overlap decompositions** | 1 (424242) | From `A21-overlap-s424242.json` |

### 5.5 Derivations never independently verified

| claim | status |
|---|---|
| **A13 did NOT run `oracle.mjs`** | A13 argues the C16 obligation does not transfer (the treatment replaces scale arithmetic *inside* `scaleRecipe`, downstream of `filterRecipePool`, never altering ingredient identity) — **but that is DERIVED from the code path, not measured.** STATUS.md instructed A22/A24 not to accept it unverified. **Partially closed:** A21 ran a C13 by-name check over the stack (which contains a `wls2`-equivalent) — 384 distinct Food names, 1 hit, "Palm Hearts" matching term `heart`, **a false positive present identically in the baseline** |
| **A9's role counts** | Quoted from a `schema.prisma` comment, not measured (A9 was blocked from copying the DB and appended **zero** ledger rows). **Superseded by A10's measurement**, which found the schema comment **stale** |
| **A10's levels** | A **paired recipe×target proxy** over 11,072 pairs including pairings the real solver would never make. **Only the DELTAS are meaningful; the levels are not comparable to days-in-band** |
| **A11's "protein is the binding axis"** | **ESTIMATED as a causal claim** by A11 itself |
| **A9 §3's round2 label-vs-grams observation** | ESTIMATED, worth checking: `applyScales:356` round2's the stored scale *labels* while grams come from raw factors, so the persisted label can disagree with shipped grams by up to 0.005×. Totals are recomputed from grams, so no kcal drift is implied |
| **A4's two unfetched sources** | Thomas/Erdman/Burke 2016 and Whittaker & Wu 2021 — **correctly labelled UNVERIFIED and used as support for nothing.** A23 confirmed no overreach |
| **A6's Cronometer and Strongr Fastr rows** | UNVERIFIED as official (a user forum post with no staff reply; a claim absent from the fetched page). A6 tagged both |
| **The cause of the 07:30 session termination** | **NOT DETERMINED.** No Windows event-log entries in the window, no scheduled task. The runner never wrote its completion footer for **any** of three runs |
| **A25's provenance** | **A25 did not finish.** It wrote REPORT §§1–3 and died mid-table at 07:30:59; `A25/` holds no artifacts and **no `A25/FINDINGS.md` exists.** §§3.1 and 4–7 were written afterwards in a separate synthesis session from the 24 artifacts. **It is synthesis, not a 25th agent's independent analysis, and says so** |

---

## 6. THE UNCOMMITTED-WORK INVENTORY

**Read this before touching code. The builder does not start from HEAD, and does not start from
the state the corpus measured either.**

### 6.1 The three-way state mismatch — new, and load-bearing

| | fleet's measurement state | working tree now |
|---|---|---|
| git HEAD | **`0d3eaa5`** | **`f414f8b`** — two commits ahead |
| `backend/prisma/dev.db` | **`e55f52e53658a086`** | **`d9037dce9754b452`** |
| `backend/data/foodOverrides.json` | dirty (uncommitted) | **CLEAN — committed in `257cbec`** |
| solver code (`weeklyPlanner`, `planContext`, `mealSolver`, `plans.js`, `macroCloser.js`) | dirty | **STILL DIRTY — unchanged since 2026-07-30 14:32** |

**What moved, provably:**

- **`257cbec`** *"fix(food): restore provenance on 200 rows whose macros were another food's"*
  (2026-07-31 06:59) added **204 lines / 199 macro entries** to `backend/data/foodOverrides.json`.
- **`backend/prisma/dev.db.backup-provenance149-20260731-055003`** exists (05:50), and the live
  DB hash changed at **05:53** — i.e. `applyFoodOverrides.mjs --apply` (itself untracked) wrote
  **149 rows** into the live database.
- **`f414f8b`** added `docs/make-it-work-prompt.md` only.

**The corrections are large and land on staples the solver portions constantly:**

| food | was carrying | corrected to |
|---|---|---|
| Chicken Breast | BREADED TENDERS, 263 kcal | **120 kcal**, 22.5 P |
| Potatoes | POTATO BREAD, 266 kcal | **77 kcal** |
| Carrots | DEHYDRATED carrot, 341 kcal (8×) | **41 kcal** |
| Tomato / Tomatoes / Tinned Tomatos | TOMATO POWDER, 302 kcal (17×) | **18 kcal** |
| Tofu | TOFU YOGURT, 94 kcal | **144 kcal**, 17.3 P |
| Rice | RICE CRACKER, 416 kcal | **365 kcal** |
| Mint | NESTLE AFTER EIGHT CANDY, 432 kcal (10×) | **44 kcal** |
| Pepper | BANANA PEPPER vegetable, 27 kcal | **251 kcal** (peppercorn) |

**Consequence, stated at the tier the evidence supports (INFERRED — not measured by anyone):**
**every number in the corpus was measured on a food dataset that no longer exists on disk.**
`foodFingerprint 423e7279ed6af641` no longer describes the live DB. The quantities most at risk
are precisely the ones A11, A7, A3, A20 and A16 measured — pool protein-per-kcal and
fat-per-kcal distributions, whole-food density ceilings, and infeasibility bounds — because the
corrections systematically **lower** kcal on vegetables and **raise** protein density on
chicken. **Chicken Breast, Tofu, Potatoes and Rice are also four of the ten
`ADJUSTER_CANDIDATES`, and Potato/Rice/Chicken Breast are the golden-test fixture foods.**

**What would settle it:** re-run the 250-persona fleet at the current tree and compare against
405/578. **Do not assume the baseline is still ~70 %.** The build prompt's own Stage 0 says to
confirm ~70 % ± 1.5 and *"if you do not reproduce it, you have inherited a different state than
this prompt describes — stop and reconcile."* That warning is now more likely to fire than not.

**The fleet's dataset is recoverable.** Every agent working copy still hashes
`e55f52e53658a086` — verified on `A13/dev.db`, `A16/`, `A17/`, `A21/`, `A22/`. Any re-measurement
that must be comparable to the corpus should run against one of those, **not** against
`backend/prisma/dev.db`.

### 6.2 What the uncommitted diff changes, function by function

`git diff --stat`: **10 modified files, 715 insertions / 308 deletions**, plus **4 untracked
code files** (868 lines).

> **Note:** the existing build prompt's Stage 0 lists *"11 modified files … `foodOverrides.json`"*.
> **That list is stale** — `foodOverrides.json` is now committed. It is 10 modified + 4 untracked.

#### `backend/src/lib/macroCloser.js` — **UNTRACKED, 183 lines, the whole module**

The 65.9 → 70.1 lever. Exports `closeDayMacros`, `MAX_GRAMS`, `MIN_GRAMS`.

| element | detail | why the corpus cares |
|---|---|---|
| `MAX_GRAMS = { fat: 25, carb: 160, protein: 180 }` | per-day ceilings | **A20's repaired 97.2 % bound uses exactly these ceilings.** The bound's soundness is a property of this constant |
| `MIN_GRAMS = 4`, `practical(g)` | 5 g steps ≥20 g, whole grams below | mirrors `weeklyPlanner.practicalGrams` |
| `wouldHarm(totals, dailyTarget, food, grams)` | blocks any addition that pushes kcal past ×1.15, or pushes fat/carb from inside its band to outside, or breaks keto's zero-upward carb allowance | **`allCandsHarmful` is 43.9 % of the closer's 2,072 invocations** — A17 measured `wouldHarm`, not the 10-row list, as the binding gate |
| `closeDayMacros({slots, dailyTarget, adjusters})` L116 | `const host = slots.find(s => s.recipeId && !s.locked && …)` — **ONE host slot per day** | **This is A17's 4.5× denominator finding.** The premise "9.9 % of slots" was computed against a denominator the closer cannot reach |
| L128 `for (let round = 0; round < 3; round++)` | ≤3 additions | `capReached` is 4.3 % of invocations |
| L130 / L133 / L135 | gap list built from **`Math.max(0, proteinMid − totals.protein)`** and `fat.short` / `carb.short` — **shortfalls only** | **This is C9 in the source. No path in the module reduces anything.** `noGap` (which includes *every* over-band day) is **47.4 %** of invocations |
| backoff `[grams, ×0.6, ×0.3]` | tries smaller amounts rather than harming | |
| purity | no DB, no clock, no RNG; **empty `adjusters` ⇒ untouched day** | why every existing golden stayed byte-identical |

#### `backend/src/lib/planContext.js` — **+67**

- **New imports:** `isExcluded`, `FOOD_GATE_SELECT` (exclusionGate.js); `macroTrustIssue` (foodValidation.js).
- **New `ADJUSTER_CANDIDATES`** — **this is the ten-name constant A20 identified as the wall**, at the exact lines A20 cited (`:167-178`):
  - fat: Olive Oil · Butter · Avocado
  - carb: White rice, cooked · Potatoes · Oats
  - protein: **Chicken breast, cooked, skinless · Greek Yogurt · Tofu · Lentils**
  - **All four protein entries die to vegan + soy + legumes. 0 of 4 survive for 16/16 refused personas.**
- **New `loadAdjusterFoods()`** — module-level memoised (`let _adjusterFoods = null`) Prisma
  `findMany` on `name IN (...)`, keyed lowercase, first-wins on duplicates. *(Process-level cache:
  harmless for the desktop's single DB, a hazard for any harness that swaps `DATABASE_URL`
  mid-process. Each rig run is its own process, so the fleet was unaffected.)*
- **New `loadAdjusters(profile)`** — drops any row failing `macroTrustIssue`, then any row
  `isExcluded(food, profile)`; returns `[{role, food}]`. **Allergy safety is structural** — same
  gate every recipe surface uses, no second vocabulary.
- **`planContext(userId)`** now awaits `loadAdjusters(profile)` and returns `adjusters`.

#### `backend/src/lib/weeklyPlanner.js` — **+112 / −~10.** The compliance-bearing file.

| change | detail |
|---|---|
| **new import** | `closeDayMacros` from `./macroCloser.js` |
| **`MAX_SLOT_ATTEMPTS = 5` split** | → `MIN_SLOT_ATTEMPTS = 5` + `MAX_SLOT_ATTEMPTS = 20` |
| **new `slotAttemptBudget(poolSize)`** | `max(5, min(20, floor(n/10)))`. **A14's lever surface** — its `floor12` recommendation is exactly `max(12, …)` here, worth **+1.12 pooled** and **+15.00 pts on the 60 thinnest days**. **The in-file comment claiming a flat 20 starves thin pools is FALSIFIED by A14** (thin pools gain most, +16.67), and **the pool-scaling itself buys ~nothing over a flat 14** (+0.12 [−1.62, +1.87]) |
| **new `COMPOSITION_BIAS_K = 4` + `compositionWeight(r, target)`** | compares **calorie shares** of fat and carb against the slot's targets; returns `1/(1 + 4·meanAbsDiff)`; returns **1 (exact no-op)** when there is no composition target. The 49.3 → 53.3 lever |
| **`pickRecipe(...)`** | gains an 8th param `compTarget = null`; multiplies the draw weight by `comp`. **A24 confirmed this is a DIFFERENT call site from A13's `wls2`** — sampling weights `pickRecipe`, `wls2` changes `scaleRecipe`. Not the same lever re-sold |
| **`resolveSlot(...)`** | computes `attemptBudget = slotAttemptBudget(recipePool.length)`, loops to it, and passes `composed ? target : null` into `pickRecipe` |
| **`solveDay(...)`** | gains a **12th** param `adjusters = null`; **as its last step** calls `closeDayMacros({slots: results, dailyTarget, adjusters})` and returns `closed.slots`. **This seam is exactly why A17's trimmer produced a verdict disagreement: the closer runs AFTER the slot loop has formed its warnings.** Any subtraction mechanism must be computed **inside** the verdict, not after it |
| **`generateWeekPlan(...)`** | destructures `adjusters = null` from options, threads it to `solveDay` |

**What the diff does NOT change, and this is the point:**
`scaleRecipe` (L394) still takes only `(recipe, kcalTarget, proteinTarget)`. `applyScales` (L334)
still hard-codes `ing.role === "protein" ? proteinScale : sidesScale`.
**`SCALE_BOUNDS = { min: 0.5, max: 2 }` is untouched.**
**Neither A13's `wls2` objective nor its 0.25× floor is in the tree.** The study's single real
lever is **not** implemented anywhere on disk outside A13's in-memory `NODE_OPTIONS --require`
hook.

#### `backend/src/lib/mealSolver.js` — **+4, and that is all**

`generateHorizonPlan({...})` gains `adjusters = null` and passes it into each window's
`generateBestWeekPlan`. **No solver arithmetic changed** — a direct corroboration of A18's
finding that `mealSolver.js` is a reporting/pass-through layer and compliance is decided in
`weeklyPlanner.js`.

#### `backend/src/routes/plans.js` — **2 edits**

`POST /generate` destructures `adjusters` from `planContext(req.userId)` and passes it into
`generateHorizonPlan`.

#### `backend/src/lib/allergenTaxonomy.js` — **+122**

- **`nightshades.nameKeywords` extended:** perogi/perogies/pierogi/pierogies, gnocchi, hash
  brown(s), tater, tots, rosti/rösti, latke(s); plus colour-qualified peppers (red/green/yellow/
  orange/sweet) and flake forms (pepper flakes, red pepper flakes, chilli/chili flakes, crushed
  red pepper). Motivation in-file: a customer was **offered** "Grilled Chicken Breast & Perogies"
  at 99 % match against a nightshade wall and refused it; chasing that offer found **3 customers
  already SERVED a hidden nightshade**.
- **Bare `"pepper"` still deliberately absent**, and the note now carries the measurement that
  justifies it: the `Pepper` Food row is used in **81 recipes at a median of 0.25 g** — i.e.
  peppercorn — and is now typed as such in `foodOverrides.json`.
- **Four NEW `TIER_COMMON` taxonomy rows:** `pork`, `beef`, `lamb` (single-species meat rows,
  **deliberately NOT folded into `red meat`**, because resolving "no pork" to the alpha-gal family
  would silently delete beef and lamb too) and `cilantro` (OR6A2 genetic aversion; **leaf forms
  only, seed deliberately excluded**).
- **Motivation, measured:** `resolveTaxonomyTerm("pork")` returned **NULL**, so the term degraded
  to a literal substring match on the food NAME — blocking "Pork tenderloin" while shipping Bacon,
  Chorizo, Lard and Pepperoni. **12 of the 46 customers who typed "pork" were served pork.**
  "beef" was worse: it blocked nothing but names containing "beef", so "Sirloin steak, cooked,
  lean" went straight through.

**Important scope note for the new build:** this widens the **taxonomy term resolver**. It does
**NOT** address **C13's latent style-gate leak** — `isExcluded(food, {dietaryStyle:'vegan'})`
still returning `false` for Squirrel, Groundhog, Armadillo, Wild pig, Heart, Owl, **Sea
cucumber**, Ceviche, Hog maws, Bear, Dove and `Nutritional powder mix (Isopure)`. **Verify before
assuming C13 is closed. It is a different code path.**

#### `backend/src/routes/profile.js` — **+74. Not a solver change, but it changes the POPULATION.**

- New `GAIN_INTENT_KG = 0.5`.
- New **`gainDirectionGate(candidate, body)`** — returns **400** when
  `goalWeightKg − startWeightKg > 0.5 kg`. **A refusal, not an acknowledgement gate**, because
  the app has no surplus path at all.
- **Deliberately scoped to `body.goalWeightKg` / `body.rateLbPerWeek` and NOT to
  `startWeightKg`** — the in-file comment records that the first version fired on a start-weight
  edit and `tests/profileSafetyGates.test.js` caught it: *"a tracker you cannot tell the truth to
  is worthless."* **A real weight is a fact and is never refused; only the prescription is gated.**
- Wired as **GATE 3** in `PUT /` after `goalWeightGate`. Exported; `SAFETY_GATES` gains
  `GAIN_INTENT_KG`.
- Motivation in-file, from the same campaign: **50 of 50 affected profiles** — one customer in
  five — were being prescribed a silent deficit against a gain goal; worst case a 19-year-old at
  BMI 18.2 asking to gain, handed **1,200 kcal**, below her own BMR.

**Why the new build must care:** this gate can **400 a persona at profile-set time**, which
changes the denominator. A3 already recorded **p100, p155, p219** as `profile-blocked-400` — *in
the 250, not in the 578*. **Whether this gate widens that set is NOT MEASURED.** Check it before
comparing any new fleet run to 405/578.

#### `backend/tests/golden/engine-baseline.golden.json` — **289 in / 289 out**

Wholesale regeneration of the golden week (Tofu & Potato → Chicken & Rice; new Beef & Potato and
Salmon & Rice slots). **Day 1 now ships three EMPTY meal slots carrying `"No eligible meal recipe
left for this slot."`** — the golden fixture now bakes in a pool-exhausted day. **Whether that is
correct-and-honest or a regression the golden froze is not determined by anything in the corpus.
Flag it; do not assume.**

#### `backend/tests/horizonGeneration.test.js` — **+30 / −6**

`classifyBinding` snack test. Two changes, both documented in-file as the test catching up with a
real improvement: (1) the variety plan is now built for the scenario's own `mealConfig` — it
previously inherited `base.variety` computed from `{meals:3, snacks:0}`, **so the assertion passed
only because of the order `classifyBinding` evaluates its branches in** (a real test defect);
(2) snack demand raised **2/day → 4/day** because the snack library grew **9 → 18** recipes, so
`snackEligible × horizonCap = 18 × 5 = 90` now genuinely covers 2/day (56 slots) and 3/day (84).

#### `backend/tests/solverHonesty.test.js` — **+14 / −2**

The 6/7-week fixture's protein band retuned **230–250 → 195–215**. **Assertions unchanged.**
Reason recorded in-file: after composition-aware sampling landed, the old band **maxed at 5/7
across all 40 seeds** — the test would have gone vacuous **in the STRICT direction**, which its
own guard refused to allow. At 195–215, **10 of 40 seeds land exactly 6/7** and outcomes range
2/7–7/7.

#### `docs/surgery/CAMPAIGN/ledger.md` — **+18**

Campaign governance entries for 2026-07-29. Not code.

#### `backend/scripts/*.mjs` — **UNTRACKED, 685 lines, all `--apply`-gated and idempotent**

| script | lines | what it does |
|---|---|---|
| **`applyFoodOverrides.mjs`** | 201 | Pushes `foodOverrides.json` into the `Food` table **and recomputes cached macros on every Recipe using a changed row.** Backs up `dev.db` first. **This is the script that moved the live DB on 07-31 (`backup-provenance149`).** Deliberately narrow — it does NOT run `fixFoodData.mjs`'s 200-group duplicate merge, so the fix is reviewable and revertible on its own |
| **`backfillIngredientMetadata.mjs`** | 208 | Fills the three never-populated columns: `RecipeIngredient.scalable` (**260 / 7,024 set** → 99.4 % of herb rows get MULTIPLIED), `Recipe.mealCategory` (**169 / 889 set** → a condiment served as dinner), `RecipeIngredient.role` (**35 % of oil rows say "carb"** → drives protein-vs-sides scaling). Produced 105 g of rosemary, 1.1 kg of spring onions, 19 g of salt in one dish, **13 g of cabbage inside a cabbage stew** |
| **`seedGapRecipes.mjs`** | 276 | Authors **real** recipes into the measured-empty niches: snacks (**9 in the whole library, 0 surviving a vegan filter**), keto (**12 of 34 failing keto days had NO FOOD AT ALL**), `none` (**51 lost days, 61 % fat-OVER**), vegan (**92 % of failing days fail on protein, median 75 % below midpoint**). **No invented nutrition** — every ingredient resolves to an existing `Food` row passing `macroTrustIssue()`, macros are computed not typed. **This is the real-authoring counterpart to A16's SIMULATED concentrate route** |

Also untracked: `docs/surgery/CAMPAIGN/solver-brain/`, `solver-deepdive/`, `qa/`, the three
campaign prompts, the two systems-audit handoffs, and
`docs/surgery/surgery-20260727-0217/verify/`. **The entire research corpus is uncommitted.**

### 6.3 What is at risk, and where the 29.3 points actually live

**The 40.8 → 70.1 arc is split between uncommitted CODE and applied DB STATE:**

| step | Δ | lives in | committed? |
|---|---|---|---|
| Food-row corrections + 3 backfilled columns | 40.8 → 49.3 | `dev.db` state + `foodOverrides.json` + `backfillIngredientMetadata.mjs` | overrides **YES**; script **NO**; DB state is DB state |
| Composition-aware sampling | 49.3 → 53.3 | `weeklyPlanner.js` `compositionWeight` / `pickRecipe` | **NO** |
| Adaptive slot-attempt budget | 53.3 → 60.4 | `weeklyPlanner.js` `slotAttemptBudget` | **NO** — *(and A14: the gain was **depth**, not pool-scaling)* |
| Staple un-quarantine + 21 recipes | 60.4 → 65.9 | `dev.db` state + `seedGapRecipes.mjs` | script **NO** |
| **Macro closer** | 65.9 → **70.1** | `macroCloser.js` + `planContext.js` + `weeklyPlanner.js` + `mealSolver.js` + `plans.js` | **NO** |

**Roughly 20.8 of the 29.3 points are uncommitted source. A `git checkout`, `git stash`, branch
switch or worktree change destroys them.**

**The staging hazard is known and documented:** `.claude/hooks/guard-bash.js` reads `CP_ROLE` via
`role.js` and **fails closed to `architect`; architects do not stage.** The hook's own docs state
a shell mutation does not survive the tool call. **If blocked, stop and ask the owner to relaunch
with `CP_ROLE=builder`. A guard block is a stop sign, not a puzzle.** Related guard behaviours
recorded by the fleet, so they are not rediscovered: `guard-bash.js` denies `--force` and bare
`-f` (so `cp -f`, `Copy-Item -Force` and even `[ -f "$d" ]` trip it — **plain `cp` is fine**);
everything under `docs/surgery/CAMPAIGN/` is **create-only**, so corrections ship as new files;
and the fleet sandbox blocks any command whose text merely *quotes* the live DB path.

**And the newer risk the corpus could not have seen:** the tree is now **fleet-era solver code +
post-fleet food data**. **No measurement anywhere in this corpus was taken on that combination.**

---

## 7. THE FIVE SENTENCES THE NEW PROMPT SHOULD OPEN WITH

1. **The one real lever is A13's `wls2`** — a 2-knob, 4-macro, tolerance-normalised
   weighted-least-squares portioning objective at `weeklyPlanner.js:394/:451`, worth
   **+14.74 pts [+11.40, +18.08]** satisfiable-only, replicated at three seeds, reproduced
   independently by A22, and defended by a kcal-only negative control at **+0.00 (b=5 c=5)**.
   **It is not in the tree.** It costs slot-level amber: filled warned slots **341 → 405**.
2. **The failure mode is that days come out TOO BIG**, blocked at the **0.5× floor** (66 of 70),
   failing **OVER** on fat (42/42, 97/98, 83/83). The macro closer **structurally cannot fix it**
   — it only adds. Every mechanism that makes days smaller claims the same ~15 points, and
   **their overlap is measured: 72 of 84 shared, union 99, marginal +2.24 → unresolved.**
3. **Never sum the lever table.** Baseline satisfiable misses are 123 of 536, so the union of all
   levers caps at **+22.95 pts**; the naive sum is +58.77 — **2.56× impossible.**
4. **Refusal is not compliance.** Re-badging `diagnose()` buys **+27.94 pts and a perfect KPI with
   zero behaviour change**, at 186 false refusals; shipping A3's own bound as the refusal rule
   launders **+4.94**. The **sound** predicate buys **+0.00** and is still the right thing to ship.
5. **Every independent verifier in this study was built from the same vocabulary as the thing it
   verified** — `oracle.mjs` reported 0 leaks on 309 sea-cucumber placements, A20's audit copied
   A3's dead field names, A16's leakcheck silently inspected 88 % of its slots. **Determinism is
   reproducibility, not validity. Check your instrument by name, not by running it again.**
