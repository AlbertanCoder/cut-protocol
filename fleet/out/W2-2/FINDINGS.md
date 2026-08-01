# W2-2 — SELECTION PRECEDENTS (online research)

*Persisted by the orchestrator (subagent harness blocks report-file writes). No source modified; no commits.*

Tags: `[SOURCED]` external lit w/ URL · `[CODE]` read from this repo w/ file:line · `[DERIVED]` arithmetic on numbers not measured here · `[JUDGEMENT]` opinion, no source. **No benchmark was run.**

## 0. Headline

1. **24.5%@k=20 is an *n-best oracle rate*.** That is its real name, with a 40-year reporting convention attached, which exists precisely because the number gets misquoted. `[SOURCED]`
2. **The 20 attempts are worth ~2.5 independent ones.** Falls out of the corpus's own two numbers; explains C6, C12 and the 20→40 result simultaneously. `[DERIVED]`
3. **The candidate days are not columns.** They are path-dependent fragments generated under a mutable ledger. Every precedent in target 1 assumes independently-feasible columns. **The set-partitioning frame is not "hard" here — it is *unavailable* until that changes.** `[CODE]`

And the fleet already owns the negative result: **C7 — "A19 variety-safe day harvesting: +1.68 gross, +0.00 marginal — SUBSUMED, dead."** Someone already built the realised version of this bound and got nothing marginal. **Any recommendation must explain why it would do better, or admit it would not.**

## 1. What the codebase actually is (read, not assumed) `[CODE]`

| Fact | Where |
|---|---|
| Attempts loop: solve week, `scoreWeek`, keep best whole week | `mealSolver.js:655-701` |
| Selection key: `daysInTolerance`, then `floorDaysMet`, then `avgMatch` | `mealSolver.js:685-691` |
| `scoreWeek` = **a sum over days** | `mealSolver.js:588-638` |
| Variety cap enforced *inside* the slot search via a live counter | `weeklyPlanner.js:183-186` |
| Counter **mutated as each slot ships** | `weeklyPlanner.js:602-605` |
| Horizon cap `perWeekCap + (w−1)`, `distinctFloor = ceil(slots/cap)` | `weeklyPlanner.js:976-983` |
| Slot weights depend on **meal index, never calendar day** | `weeklyPlanner.js:145-149` |
| Carry-forward **within-day only** | `weeklyPlanner.js:106-111` |
| `usedYesterday` is a **soft 0.15× draw discount**, not a constraint | `weeklyPlanner.js:279` |
| Template suppression is an **unconditional** multiplicative prior | `weeklyPlanner.js:220-223, :281` |
| **Grocery coherence absent from the solver** — zero `grocer` matches | `mealSolver.js` |

**Four corrections to the task's framing:**

**(a) The objective is modular.** `daysInTolerance = Σ_d 1[day in band]`, `avgMatch = (1/7)Σ_d match_d`. **No cross-day term exists in the score.** This drives everything in §3.

**(b) "Leftovers make days non-independent" is true of the *constraints*, not the *objective*.** Batch cooking is `BATCH_REPEAT_CAP` replacing `DEFAULT_REPEAT_CAP` — it **widens the feasible region and leaves the score untouched**. Nothing anywhere awards points for cooking once and eating twice. `[CODE]` Load-bearing: a supermodular objective would kill every guarantee in §3, and there isn't one.

**(c) Grocery coherence is not a constraint cherry-picking can break, because the solver has never heard of it.** `[CODE]` Real user-facing quality, unmodelled externality. It degrades equally in every configuration — a reason to distrust the plan, not the selection.

**(d) The only genuine cross-day coupling is `usageCount` vs `repeatCap`.** Locks ride through every attempt identically (`mealSolver.js:648-653`), `priorUsage` is week-level and shared, carry-forward is within-day. **One constraint — a counter and a comparison.**

### 1.2 The bad news: these are not columns
`eligibleRecipes` filters against a `usageCount` that days 1..d−1 *of the same attempt* already wrote to. A Wednesday from attempt 3 was generated **conditional on attempt 3's Monday and Tuesday.** `[CODE]`

Every technique in §2 assumes candidates are **independently feasible** (an airline pairing is legal on its own; the master enforces only coverage + side constraints). `[SOURCED]` **Cut Protocol's days lack that property.** Splicing attempt 3's Wednesday next to attempt 1's Monday yields a week no attempt validated, against a ledger that never existed.

**`[JUDGEMENT]` This is the actual blocker, and it isn't the one the brief named.** The brief worried about leftovers and groceries. **The real obstacle is that the day generator is stateful.**

## 2. The named technique (target 1)

**The suspicion is correct.** "Generate many candidate sub-solutions, then have a master problem choose a compatible subset" is the **set-partitioning master problem**; generating candidates on demand is **column generation**; in branch-and-bound, **branch-and-price**. `[SOURCED]`

- [Barnhart et al. (1998), *Branch-and-Price*, Oper. Res. 46(3)](https://pubsonline.informs.org/doi/abs/10.1287/opre.46.3.316)
- [Desrosiers & Lübbecke, *A Primer in Column Generation*](https://link.springer.com/chapter/10.1007/0-387-25486-2_1) · [Lübbecke & Desrosiers (2005)](https://pubsonline.informs.org/doi/10.1287/opre.1050.0234)
- Canonical instance is **airline crew pairing** — [EMS](https://ems.press/content/book-chapter-files/27279) · [Springer](https://link.springer.com/chapter/10.1007/3-540-27170-8_16)
- [Set partitioning with side constraints](https://www.sciencedirect.com/science/article/pii/S219243762030042X)

| Crew pairing | Cut Protocol |
|---|---|
| Flight leg to cover | Calendar day to fill |
| Pairing (legal multi-day trip) | Candidate day (legal slot set) |
| Column cost | `1 − 1[day in tolerance]` |
| Cover each flight exactly once | One candidate per calendar day |
| Side constraints on master | `Σ_days usage(recipe) ≤ repeatCap` |
| Pricing subproblem | `solveDay` |

**`[JUDGEMENT]` Right frame for the selector — but its precondition is violated today. Cut Protocol currently has the master problem's selection step (best-of-N) and none of its structure.**

**The other framings:**
- **GRASP / multi-start** — [Springer](https://link.springer.com/chapter/10.1007/0-306-48056-5_8) · [Resende & Ribeiro](http://profs.ic.uff.br/~celso/artigos/resende-ribeiro-GRASP-HMH3.pdf) — **this is what `generateBestWeekPlan` already is**, minus the local-search phase. `[JUDGEMENT]` The missing half is far cheaper to add than a master problem.
- **Restarts / portfolios** — [Luby et al.](https://www.sciencedirect.com/science/article/abs/pii/0020019093900299) · [Horvitz](https://erichorvitz.com/drestart.pdf). These answer *"how long before restarting"* — a **runtime** question. Yours is a **quality** question. Wrong frame.
- **Bet-and-run** — the one restart idea that transfers directly. [Fischetti & Monaci, *Exploiting Erraticism in Search*](https://arxiv.org/abs/1609.03993) · [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/4082) — `[JUDGEMENT]` a *realisable* policy that never produces a spliced object.
- **LNS / ruin-and-recreate** (Shaw 1998, Ropke & Pisinger 2006; [survey](https://www.sciencedirect.com/science/article/abs/pii/S0305054822001654)) — **`[JUDGEMENT]` best practical fit in the whole list.** Destroying two days and re-solving them *against the surviving ledger* is exactly "keep the good days, improve the bad ones" minus the splice. **Smallest change too: `solveDay` already accepts a `usageCount` map.**
- **Lagrangian decomposition** — theoretically clean (the multiplier on recipe *r* is literally "cost of using *r* once more this week", feedable to `pickRecipe`), but far more machinery than the measured headroom justifies. `[JUDGEMENT]`

## 3. Decision rule for safe cherry-picking (target 2)

**The theorem.** For a **modular** objective over the independent sets of a **matroid**, greedy is exactly optimal — and matroids are the *only* independence systems where that holds for every weight function (Rado–Edmonds). `[SOURCED]` [Conforti & Cornuéjols (1984)](https://www.sciencedirect.com/science/article/pii/0166218X84900039) · submodular+matroid drops to ½, [Fisher/Nemhauser/Wolsey (1978)](https://link.springer.com/article/10.1007/BF01588971)

"Pick one candidate from each day's list" is a **partition matroid**. So *absent the repeat cap*, per-day cherry-picking would be **provably optimal** and 24.5% exactly achievable. The cap breaks it: `Σ_d usage_r(day_d) ≤ cap` is a **packing** constraint; partition-matroid ∩ packing is NP-hard in general. **`[JUDGEMENT]` I explicitly do NOT claim matroid intersection — nicer story, false.**

### THE RULE — cherry-pick, then check, and let the check decide
Exact, not heuristic, because the objective is modular:

> **f(best feasible week) ≤ Σ_d max_c f_d(c)** — the oracle bound — **attained iff the per-day argmax selection satisfies the repeat cap.**

1. **Cherry-pick** the argmax candidate per calendar day under the existing key.
2. **Check**: accumulate `usageCount` over the 7 chosen days vs `repeatCapFor(options)`. ~35 map increments — **cheaper than one slot solve.**
3. **Passes → ship, and you may state it is optimal over the candidate set.** Not "probably fine": it *attains the upper bound*, so nothing can beat it. Same bound-attainment argument column generation uses to certify LP optimality. `[SOURCED]`
4. **Fails → a coordinating pass is mandatory.** Cherry-picking without one is exactly the feared defect.

**Conditions for step 3 — 6 of 7 hold today:**

| Condition | Status |
|---|---|
| Objective is a sum over days, no cross-day term | ✅ `mealSolver.js:588-638` |
| Slot targets don't vary by calendar day | ✅ `weeklyPlanner.js:145-149` |
| Carry-forward contained within a day | ✅ `:106-111` |
| Locked slots identical across attempts | ✅ `mealSolver.js:648-653` |
| `priorUsage` identical across attempts | ✅ same options object |
| No reward for repetition in the score | ✅ batch only widens the cap |
| **Candidate days independently feasible** | ❌ **violated (§1.2)** |

**The coordinating pass, cheapest first:**
**(i) Free permutation.** The objective is invariant to *which* weekday a candidate lands on ⇒ assignment is a **zero-cost degree of freedom**. Use it to minimise `usedYesterday` adjacency repeats — the one coherence property splicing silently tramples. **Costs nothing.** Valid within a uniform-target window; re-verify across horizon windows.
**(ii) Exact master.** 7×20 = 140 binaries, 7 "exactly one" rows, plus one capacity row per *violated* recipe (typically 0–3). Solvable exactly in well under a millisecond. Right answer; needs §1.2 fixed first.
**(iii) LNS repair** — keep the best whole week, destroy *d* worst days, re-solve against the surviving `usageCount`. **Never leaves the feasible region, no new solver. `[JUDGEMENT]` This is what I'd build.**
**(iv) Do NOT ship naive greedy-with-skip** ("argmax; if it breaks the cap take the runner-up"). No guarantee, **silently converts a bound into an unquantified heuristic** — precisely the shape that produces a number someone later quotes as 24.5%.

## 4. Variety without suppressing the compliant recipes (target 3)

**The defect, precisely.** `pickRecipe` (`weeklyPlanner.js:274-292`) multiplies factors. Two are **conditional on the set so far**: `discount = usedToday ? 0.02 : usedYesterday ? 0.15 : 1`, and `priorDiscount(priorUsage, r.id)`. One is **unconditional on anything**: `real = isGeneratedTemplate(r) ? 0.35 : 1`. `[CODE]`

**`[JUDGEMENT]` The defect is the word *unconditional*.** The harm defended against — "a week of near-clones" (comment at `:212-219`) — is a property of a **set** containing several templates. The rule is applied to **every draw including the first**, when the week holds zero templates and no clone risk exists. Against F6 (templates 9.71 P/2.12 F per 100 kcal; pool 5.28/4.73; target 8.16/2.60), **every first draw pays a compliance tax for insurance that only has value from the second or third template on. That is F7 stated mechanically.**

It is also the **wrong similarity key**: the 158 templates are clones of each other because they share the `"High-Protein {protein} & {veg} with {carb}"` skeleton (`:222`). Two templates differing in protein *and* carb are not near-clones. **Provenance is a proxy for cloneness — a bad one, which is why it also catches the only compliant items.**

**The design — three layers, none touching the first draw:**

**Layer 1 — make the penalty conditional (MMR structure).** Replace the constant with a term reading the plan-so-far, exactly as `usedToday`/`usedYesterday` already do:
`templateWeight = 1 / (1 + λ · templatesSoFar / max(1, slotsFilled))`.
At `templatesSoFar = 0` this returns **1.0** — the first template drawn at full weight, which is the whole point — degrading toward and past 0.35 as clones accumulate. This is Maximal Marginal Relevance. [Carbonell & Goldstein, SIGIR 1998](https://dl.acm.org/doi/10.1145/290941.291025)

**Layer 2 — diversify on content, not provenance (DPP structure).** Key the penalty on `(primary protein, carb base, cuisine)` — the display taxonomy this repo already computes for the Recipes tab — not on `source === "ai-generated"`. [Chen, Zhang & Zhou, NeurIPS 2018](https://arxiv.org/abs/1709.05135) · [Kulesza & Taskar](https://arxiv.org/abs/1207.6083)

**Layer 3 — a quota, not a multiplier (published practice; the recommendation).** The school-lunch optimisation literature expresses variety as **hard weekly frequency caps at item *and category* level** — verbatim: `Entrées ≤ 1`, `Beef ≤ 2`, `Chicken ≤ 2`, `Fruits and vegetables ≤ 2`. `[SOURCED]` [PMC10410403](https://pmc.ncbi.nlm.nih.gov/articles/PMC10410403/) Cut Protocol has the item-level version (`repeatCap`) and **no category-level version**, approximating one with a soft multiplier. `[JUDGEMENT]` **Add `maxTemplatesPerWeek` (better: a cap per protein-family) to `eligibleRecipes` and delete `GENERATED_TEMPLATE_WEIGHT`. A quota costs exactly zero compliance until it binds; a 0.35× multiplier costs compliance on every draw forever.** Also *calibrated recommendations* — [Steck, RecSys 2018](https://dl.acm.org/doi/pdf/10.1145/3240323.3240372)

**Not recommended:** MAP-Elites / QD ([Mouret & Clune](https://arxiv.org/abs/1504.04909)) is the right frame for **authoring** — an archive of the best recipe per (protein-density, fat-density) cell — which F7 says is the only real dissolution. Wrong tool for the draw loop.

**Honest limit:** F6 tiers the causal step **ESTIMATED**. F2 puts the density gap at ≈3.4 pts against a 3.45-pt detection floor; A5 requires ≥3.5 pts. **`[JUDGEMENT]` This may measure exactly zero, and must be A/B'd against its own freshly-run baseline (A3). The case for shipping it is that it removes a known mechanical conflict — a correctness argument, not a points argument, and it must be reported as one.**

## 5. Reporting the bound honestly (target 5)

**It is an oracle rate. Use that word.** The convention is 40 years old in n-best reranking for ASR/MT: report **1-best** (what ships), **oracle** (best hypothesis in the n-best list, chosen knowing the reference), and the **gap**; the oracle is universally understood as *the ceiling reranking cannot exceed*, never a result. `[SOURCED]` Worked examples: [ASR top-1 19.10% WER vs oracle 12.87% at N=10](https://arxiv.org/html/2409.09554v2); [MT oracle beats top-1 by ~10 BLEU](https://www.cs.jhu.edu/~kevinduh/papers/duh08boost.pdf).

Mapped: 1-best (k=1) **10.8%** · oracle (k=20) **24.5%** · gap **13.7 pp** · realised by a cap-feasible selector **not yet measured**, and C7's +0.00 marginal is the only datapoint.

**Recommended template**, phrased to survive being quoted out of context:
> *"Oracle (upper bound, post-hoc per-day selection, ignores the weekly repeat cap): 24.5% at k=20. Realised by a cap-feasible selector: MEASURED-VALUE. The oracle is not achievable by any policy that respects the repeat cap and is reported only to bound the headroom."*

**The parenthetical is not decoration. It is what stops the number migrating.**

### 5.2 The bound is smaller than it looks — their own numbers prove it `[DERIVED]`
If per-day success were **independent** across attempts at p = 0.108, best-of-20 = `1 − 0.892^20` = **89.8%**. Observed: **24.5%**. Solving `1 − (1−0.108)^m = 0.245`:

> **m ≈ 2.46. Twenty attempts are worth about two and a half independent ones.**

The draws are massively positively correlated — exactly what you expect when the binding constraint is the **pool**, not the **search**, which the corpus says repeatedly: B7 (6.2% of slots find anything within `COMPOSITION_GOOD_ENOUGH`), F5 (18 snack recipes; budget exceeds candidate count ⇒ searched exhaustively), F12 (94.3% of the food library inert).

**This one number explains three measurements at once:** C6 (5→12 attempts = +1.12 — buying fractions of an effective attempt); 20→40 = +1.74 pp (heavy saturation); C12 (reorder at 1 attempt beats baseline at 5 — order changes *which* region is searched, volume re-searches the same one). Extrapolating at the measured 1.74 pp/doubling — generous, since the rate is decaying — **k=320 reaches only ~31.5%.** Reaching 40% needs m ≈ 4.47, i.e. roughly doubling the search's effective diversity, **which no amount of k delivers.**

**`[JUDGEMENT]` The conclusion is not "cherry-pick better." It is "attempts are the wrong axis, and the corpus already said so."**

### 5.3 Selection-bias caveat
A max over k candidates **on the same sample used to select them** is upward-biased for fresh data — winner's curse. [Cawley & Talbot, JMLR 11 (2010)](https://www.jmlr.org/papers/v11/cawley10a.html) `[SOURCED]` `[JUDGEMENT]` Weaker here than usual (the verdict is a hard deterministic 4-macro test, not a noisy estimate) but not zero: A2 reports 0.4–0.5 pt cross-seed spread. **Re-run the baseline on its own seeds (A3), and re-compute the oracle on a held-out seed before believing 24.5% transfers.**

### 5.4 The rule this must not violate
**No lever may count a refused day as a compliant one.** A selector that "improves" the number by picking days the cap would refuse is the **E11 inflation trap** (re-badging bought +27.94 pts with 186 false refusals and zero behaviour change) in different clothes. **`[JUDGEMENT]` Any realised measurement must publish the naive cherry-pick's cap-violation rate alongside it. High violation rate + high reported delta = the same fact twice.**

## 6. Meal-planning precedent (target 4) `[SOURCED]`

Real, old, stable vocabulary. [Balintfy, *Menu planning by computer* (CACM 1964)](https://www.dcs.gla.ac.uk/~pat/jchoco/dietProblem/papers/menu-p255-balintfy.pdf) · [Lancaster's history](https://www.sciencedirect.com/science/article/abs/pii/037722179290345A) · [survey](https://thescipub.com/pdf/jcssp.2016.582.596.pdf)

| Family | Meaning | Cut Protocol |
|---|---|---|
| **Nutritional** | nutrient bounds per day/period | `dayTolerance` — strong |
| **Structural** | required menu shape | `mealConfig` slots — strong |
| **Variety** | frequency caps + minimum spacing | `repeatCap`, item-level only — **partial** |
| **Compatibility/gastronomic** | colour, texture, flavour clash, no two starches | **absent** |

Balintfy's own system is *"preference and compatibility maximized menu planning and scheduling"* ([Springer](https://link.springer.com/article/10.1007/BF01609000)), whose scheduling half is *"an integer program consisting of several transportation problems linked by weekly nutritional constraints,"* solved by branch-and-bound with **Lagrangian relaxation**. **`[JUDGEMENT]` That is the same decomposition this document argues for, published in the 1970s.**

**Measured accuracy — some, and it is not compliance-rate shaped.** School-lunch multi-objective study: baseline weekly cost $6.79 vs $6.70 budget, 1,744 kcal/lunch, HEI 84; MIN-DEV raises intake up to 27%, HEI up to 19% (16 pts), cuts cost $0.87/wk and GWP 67%; solver = Excel Simplex. [PMC10410403](https://pmc.ncbi.nlm.nih.gov/articles/PMC10410403/) Others: [Brazil workers' MIP](https://pmc.ncbi.nlm.nih.gov/articles/PMC10026400/) · [Malaysian binary IP](https://scialert.net/fulltext/?doi=jas.2015.1239.1244) · [recipe-based diet planning](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/A582EB0B7B33754C4EEE25A6FCCE446F/S0007114595001206a.pdf/a-recipe-based-diet-planning-modelling-system.pdf) · [US Patent 7,090,638](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7090638)

**`[JUDGEMENT]` Nobody publishes a days-in-band compliance rate against a personalised macro target on an uncurated library.** The institutional literature optimises *cost* subject to nutrition as a hard constraint, on curated item lists where feasibility is assumed. **No source found** for a directly comparable published accuracy figure.

## 7. What this changes for Cut Protocol `[JUDGEMENT]`

**Predicted realised delta: +0 to +3 pts, most likely indistinguishable from zero** (bound 24.5%, gap 13.7 pp). Four reasons, descending strength:

1. **Already measured.** C7: **+0.00 marginal.** Everything below explains why.
2. **m ≈ 2.46.** A selector cannot select diversity the generator didn't produce.
3. **Feasibility loss.** The oracle ignores the cap; a legal selector pays days back. On thin pools it is severe — keto has 4 snack-eligible recipes, so 4 × cap 2 = 8 servings for 7 snack slots. **The cap is near-tight before selection starts.**
4. **A5's floor.** A churning treatment needs **≥3.5 pts** on n≈537. A +0–3 pt effect is formally **not measurable on this instrument.**

**Where the effort pays instead:** C1 (`wls2` portioning **+14.74**), C2 (smallest-slot-first **+8.27**, one line), C12. All upstream of selection. And mechanically, **fixing the portioner *shrinks* selection's headroom** — oracle gain is largest when per-attempt success sits mid-range and attempts decorrelate; push p up with C1+C2 and the oracle at any k compresses toward the 1-best. **Selection is the last lever, not the first, and if C1/C2 land it may have nothing left to pull.**

**If built anyway, in this order:** (1) add the **free permutation** — zero risk, zero cost, do it regardless; (2) **instrument the cap-violation rate** per diet offline — cheap, decides everything downstream, and §5.4 requires it published beside any delta; (3) ship **LNS repair, not a master problem**; (4) only if (2) shows violations rare and (3) measures ≥3.5 pts, make days into real columns and add the exact master; (5) separately, the **variety quota** — judge as correctness, **expect zero points.**

## 8. Risks / where I'd be wrong

1. **The 10.8% and 24.5% may not share a denominator.** A4 publishes **five** non-interchangeable ones; A6 shows the rig drops 16 satisfiable total-failure days. **m ≈ 2.46 assumes they share one. If they don't, the derivation is void.** Most likely way this report is wrong; **checkable in minutes** by whoever owns the lab measurement.
2. **The solver was never run here.** Code reading + literature only. The **cap-violation rate — the number the decision rule turns on — is unmeasured by me and by everyone.**
3. **"Leftovers don't enter the objective" could be wrong at a call site not read.** `scoreWeek`/`scoreDay`/`repeatCapFor` were verified. **Any leftover bonus makes the objective supermodular and kills §3's guarantee instantly.**
4. **Free permutation assumes uniform daily targets** — true within a window; the entire horizon path is unmeasured (`twoPass` fires on 0.0%), so it is flagged rather than assumed.
5. **The variety redesign may lose more than it gains.** The 0.35× exists for a measured complaint. Making it conditional *will* put more templates in more weeks. **If monotony perception tracks absolute count rather than proportion, a badly-tuned quota is worse than the multiplier.** Plate realism and perceived monotony are both unmeasured.
6. **Set partitioning may be over-engineering.** I recommend **against** building it (§7 step 4). **If someone reads §2 as an endorsement and builds a master problem for a +0–3 pt lever, this document caused harm.** The endorsement is of the *frame for thinking*; the recommendation is LNS.
7. **My prediction could be beaten by a better generator.** §7 argues the *selector* can't win because the *candidates* are correlated. **Decorrelate generation — genuinely different search orders per attempt, per C2/C12 — and m rises**, making the oracle worth chasing. That would make §7 wrong in the most useful way, and it is the one experiment I'd run with budget for exactly one.
8. **No source found** for a published system reporting days-in-band compliance on an uncurated library.
