# A5 — The diet problem: literature, and which formulation class this app is in

*Agent A5. Persisted to disk by the fleet coordinator from A5's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A5's.
A5 did successfully append its `CLAIMS.tsv` lines.*

## Lead null result

**No published diet-optimisation study A5 could fetch reports a "days-in-band" number
comparable to Cut Protocol's 70.1 %.** The literature optimises *cost* or *deviation from
an observed diet* subject to nutrients as constraints, and reports **feasibility** (did a
solution exist), not **compliance** (how close totals landed). These are different
quantities. Any fleet agent who finds a "published 85 % compliance" figure should assume it
measures something else until proven otherwise.

## 1. Which formulation class this app is — MEASURED, from the code

Read in full: `backend/src/lib/weeklyPlanner.js` and `backend/src/lib/mealSolver.js`. Given
a chosen recipe, all four macros are **linear** in the two scale variables. So:

| element | location | verbatim quote |
|---|---|---|
| 2 continuous portion vars, boxed | weeklyPlanner.js:58 | `const SCALE_BOUNDS = { min: 0.5, max: 2 };` |
| solved as a 2×2 linear system | weeklyPlanner.js:404 | `const det = proteinBundle.protein * restBundle.kcal` |
| then **independently** clamped | weeklyPlanner.js:413 | `proteinScale = clamp((remainingProtein * restBundle.kcal` |
| grams discretised after solving | weeklyPlanner.js:310 | `if (raw >= 20) return Math.round(raw / 5) * 5;` |
| week-level cardinality coupling | weeklyPlanner.js:61 | `const DEFAULT_REPEAT_CAP = 2;` |
| hard per-portion diet law | weeklyPlanner.js:385 | `for (let s = scaled.sidesScale - CARB_CEILING_STEP;` |
| greedy sequential filling | weeklyPlanner.js:934 | `const result = await resolveSlot(effectiveTarget, recipePool` |
| pool-scaled sampling budget | weeklyPlanner.js:104 | `Math.min(MAX_SLOT_ATTEMPTS, Math.floor(n / 10))` |
| four-macro hard verdict | mealSolver.js:256 | `const dayInTolerance = (t) => t.kcalOk && t.proteinOk` |
| keto asymmetry | mealSolver.js:241 | `const carbOverAllowance = dailyTarget.keto ? 0 :` |
| randomised restarts, best-of-5 | mealSolver.js:658 | `const attempts = options.attempts ?? 5;` |

**Class (DERIVED):** a **multi-dimensional multiple-choice knapsack (MMKP) with
semi-continuous multipliers** — a MILP. Four "resource" dimensions, but two-sided bands
rather than one-sided capacities, which makes it structurally a **goal-programming MMKP**.
Allergen/dietary exclusions are *not* constraints in the optimisation — they reduce the
ground set upstream, which is why they cost feasibility but no solve time.

This is structurally **Leung, Wanitprapha & Quinn (1995)**: mixed-integer programming over
**895 recipes** as decision units, generating **weekly** plans. Cut Protocol's 889-recipe
weekly recipe-level MIP is the same problem, 31 years on. MMKP is **NP-hard in the strong
sense** (Htiouech & Alzaidi 2017).

### Two structural facts theory cares about

**(a) 2 degrees of freedom against 4 goals.** The continuous variables move kcal and
protein; they cannot independently move fat and carb. The code says so itself at
weeklyPlanner.js:438 — `only way to steer them is WHICH dish gets picked`. **Fat and carb
compliance is therefore purely combinatorial**, decided entirely by the discrete selection.

**(b) Independent clamping is not projection.** When the 2×2 solution falls outside
`[0.5, 2]²`, clamping each variable separately does **not** yield the best feasible point of
that box — that requires re-solving the 1-D problem on the active face. This is a candidate
mechanism behind the brief's "68.3 % of missed slots pinned at a bound", and it is cheap for
someone to test.

## 2. What the literature reports

| source | instance | constraints | result |
|---|---|---|---|
| Stigler 1945 / NEOS | 77 foods | 9 nutrients | heuristic $39.93/yr vs LP optimum $39.69 — canonical instance is tiny, heuristic gap 0.6 % |
| van Dooren 2018 (52 studies, 2000–2016) | population diets | **5–37 nutrient constraints** | *"The vitamin D constraint was the most difficult to fulfill, followed by sodium, magnesium, and saturated fatty acids"* — binding constraints are few and identifiable |
| van Dooren 2018 | — | acceptability | *"Introducing cultural acceptability constraints increased the cost three times"*; *"no study has provided the ultimate solution to calculating acceptability"* |
| Maillot et al. 2010 | 1,171 individuals | **32 nutrients** | a feasible individual diet obtained **for every participant**; in ~half, **fewer than 5 usual foods were replaced** |
| Aguilera Moreno 2026 (preprint) | 810 instances, 30 USDA foods | 9 configs | **soft-target MIGP: 100 % feasible; hard-constraint IP on the same instances: 48 %.** MIGP strictly beat goal-programming-plus-post-hoc-rounding in **66 %** of cases, never worse. Solve **<100 ms** |
| Sklan & Dariel 1993 | basic-food selections | not extractable | MILP; integers are *"foods typically consumed as whole units"* |

**What makes an instance infeasible, per the literature:** not the nutrient count. It is
(i) a small number of individually hard nutrients, and (ii) **acceptability constraints** —
the bounds that stop the optimiser shipping 5 kg of liver.

**Direct mapping (ESTIMATED):** `SCALE_BOUNDS = {min:0.5, max:2}` *is* Cut Protocol's
acceptability constraint, and the customer rejection quoted in the brief ("625 g chicken
with 2 g pine nuts") is precisely the failure acceptability bounds exist to prevent. The
literature's verdict is that this constraint is where feasibility dies — and that **relaxing
it is not a fix, it is a return to the inedible optimum.** The brief's instinct to refuse
widening matches 80 years of published practice.

> *Coordinator note, and a genuine tension in the fleet's evidence:* A2 measured that **66 of
> 70 bound-pinned days are pinned at the 0.5× FLOOR, not the 2.0× ceiling**, and that the
> divergent "625 g chicken" shape is only 2.2 % of filled slots. A5's literature argument
> defends the *ceiling*. Whether the same argument defends the *floor* — making portions
> smaller, not larger — is not settled by these sources and should be treated as open by
> A21/A24/A25.

**Soft vs hard.** The dominant published treatment of nutrient targets is **goal programming
with deviation variables**, not hard bounds. `dayTolerance()`'s hard four-way AND is the
minority choice, and the 100 %-vs-48 % figure quantifies what that costs *as a solver
acceptance rule*. **This does not license widening the bands** (integrity rule 1; bands are
A4's question). The narrow actionable reading: the *internal* objective could be
deviation-minimising while the *grading* stays a hard verdict.

## 3. Prediction for A19 (greedy sequential vs joint solve) — ESTIMATED

**A5 predicts A19 measures a SMALL gap: single-digit percentage points on days-in-band.**

The falsifiable reasoning: **a joint solve does not relax a box constraint.** If 68.3 % of
missed slots are pinned at 0.5× or 2.0×, those slots are infeasible under *any* method
respecting the same box — greedy, MILP, or exhaustive. Joint optimisation can only recover
the residual: days that failed because per-slot-acceptable errors *accumulated*, which the
±30 % capped carry-forward (`CARRY_CAP_PCT = 0.3`) only partly absorbs.

Sub-predictions, each checkable:

1. The gap should be **concentrated in fat and carb** band misses, not kcal/protein —
   kcal/protein already get within-day residual correction, while fat/carb get only
   candidate *ranking* (`compositionDistance` is explicitly *"NOT a gate"*).
2. Days failing on **kcal alone** should show near-zero joint-solve gain.
3. The literature analogue for decomposed-plus-rounded vs joint is 66 % of instances
   strictly improved, **never worse** — expect a weak Pareto improvement.

**If A19 measures a gap >10 points, this prediction is FALSIFIED** and the 68.3 %
bound-pinned statistic should be re-derived before the gap is believed.

## 4. Contradiction with the brief

The brief treats 85 % as open at 4 constraints. van Dooren's 52 studies run 5–37 constraints
and still report feasible solutions routinely; Maillot got 1,171/1,171 at 32 nutrients.
**Constraint count is not this app's problem.** Its problem is *degrees of freedom*:
published diet LPs give the optimiser continuous free quantities over hundreds of foods;
Cut Protocol allows **2 bounded continuous variables per slot** over a discrete menu.
Comparing on constraint count flatters this app and misleads. Compare on DOF.

## Blockers

- **Guard block (recorded, not worked around):** `fleet-sandbox.js` blocked reading a
  WebFetch-cached PDF under `~/.claude/projects/`. Stopped there.
- **Harness block:** writing `A5/FINDINGS.md` was refused as a report file. `CLAIMS.tsv`
  appended successfully.
- Dantzig (1990), Garille & Gass (2001), and the Sklan and Leung full texts are
  scanned/paywalled PDFs that did not parse. Bibliographic records verified; **body content
  UNVERIFIED — could not fetch.** The Sklan and Leung *abstracts* came from PubMed.
- MDPI MCKP review (2025) → **403**; Donkor et al. 2023 → **402**. Not cited.
- A repeated "M-HEU finds 96 % of optimal" MMKP figure appeared only in a search-engine
  summary. **UNVERIFIED — could not fetch primary source. Not cited.**

## Citations

1. *The Diet Problem* · George B. Dantzig · 1990 · Interfaces 20(4):43–47 ·
   https://dl.acm.org/doi/10.1287/inte.20.4.43 — bibliographic only; full text did not parse
2. *The Diet Problem* (Stigler instance = 9 equations / 77 unknowns; $39.93 vs $39.69) ·
   NEOS Guide, Univ. of Wisconsin-Madison · undated ·
   https://neos-guide.org/case-studies/om/the-diet-problem/
3. *A Review of the Use of Linear Programming to Optimize Diets, Nutritiously, Economically
   and Environmentally* · Corné van Dooren · 2018 · Frontiers in Nutrition 5:48 ·
   https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2018.00048/full
4. *Individual diet modeling translates nutrient recommendations into realistic and
   individual-specific food choices* · Maillot, Vieux, Amiot, Darmon · 2010 · Am J Clin Nutr
   91(2):421–30 · https://pubmed.ncbi.nlm.nih.gov/19939986/
5. *Diet planning for humans using mixed-integer linear programming* · Sklan & Dariel · 1993
   · Br J Nutr 70(1):27–35 · https://pubmed.ncbi.nlm.nih.gov/8399108/
6. *A recipe-based, diet-planning modelling system* · Leung, Wanitprapha, Quinn · 1995 ·
   Br J Nutr 74(2):151–62 · https://pubmed.ncbi.nlm.nih.gov/7547833/
7. *Mixed Integer Goal Programming for Personalized Meal Optimization with User-Defined
   Serving Granularity* · Francisco Aguilera Moreno · 2026 · arXiv:2605.13849 ·
   https://arxiv.org/abs/2605.13849 — **single-author preprint, not peer-reviewed;** fetched
   page reported "March 12, 2026" against a 2605 (May 2026) arXiv ID — discrepancy noted,
   unresolved
8. *Smart Agents for the Multidimensional Multi-choice Knapsack Problem* · Htiouech &
   Alzaidi · 2017 · Int. J. Computer Applications 174(6) ·
   https://ijcaonline.org/archives/volume174/number6/28409-2017915404/

**CONFIRMED**
