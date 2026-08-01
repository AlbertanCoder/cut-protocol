# W2-6 — FRESH SWEEP + CONTRARIAN PASS

*Persisted by the orchestrator. Machine artifacts: `fleet/out/W2-6/sweep.json`, `rulershape.mjs`, `rulershape.json` (250/250 personas, 0 skipped).*

Marks: `[SRC]` cited source · `[CODE]` read in this repo · `[MEAS]` **measured on the real fleet** · `[JUDGE]` judgement · `[NO SOURCE]` looked, found nothing.

## PART 1 — FRESH SWEEP (2025–2026)

**P1-1 · New optimisation approaches.** The only 2026 primary paper on this exact problem is the MIGP paper W2-1 already has ([arXiv:2605.13849](https://arxiv.org/abs/2605.13849)). Integer serving variables + GP deviations, HiGHS, 13 ms at 8 foods. → **Changes nothing.** No second approach exists. **The field is thinner than it looks.**

**P1-2 · Multi-objective / RL recommenders.** A 2024–2026 strand optimises Pareto fronts over {preference, health, diversity} — [MOPI-HFRS / MORL-A2C](https://arxiv.org/pdf/2606.23603), and a Nutrients 2024 RL system ([PMC10857145](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857145/)) with a measured result: n=1000 simulated users, the **nutrition-focused baseline scored 0.94 nutrition but 2.8/5 acceptance; the balanced policy scored 0.90 nutrition and 4.5/5 acceptance. 4% of nutrition score bought 61% more acceptance.** → **Changes something.** The only quantified precedent that maximising compliance *alone* costs acceptance. Feeds contrarian C. **Simulated users, so weak.**

**P1-3 · Rounding-aware / integer optimisation (K6).** MIGP vs solve-then-round over 810 instances: median objective **0.141 vs 0.529**, median max macro deviation **6.3% vs 21.6%**, strictly better in **66%, never worse.** Mechanism the authors name: **GP deviation variables absorb the integrality gap.** → **Changes something.** Best external warrant for K6 and for W2-1's "score on rounded grams." Their 21.6% is the same order as this codebase's carb rounding max of **63.2%.** **It does NOT warrant integer food servings as decision variables** — that is the "625 g chicken with 2 g pine nuts" generator.

**P1-4 · LLM meal planning — is there a MEASURED result? Yes, three, and they answer the BRAIN question.** `[SRC]`

| Study | Design | Result |
|---|---|---|
| [NutriGen, arXiv:2502.20601](https://arxiv.org/abs/2502.20601) | LLM **+ curated DB**, not LLM alone | 1.55% / 3.68% error — **calories only**, no per-macro number published |
| [Frontiers Nutr. 2026, PMC13017289](https://pmc.ncbi.nlm.nih.gov/articles/PMC13017289/) | 5 models, 60 three-day plans, vs dietitian | energy bias **695 kcal** (d=1.79); **fat 41.5–44.5%E** vs 25–35%; **carb −114.6 g**, 32.4–36.3%E vs 45–65% |
| [Food Sci. Nutr. 2025, PMC12267882](https://pmc.ncbi.nlm.nih.gov/articles/PMC12267882/) | 54 ChatGPT-4o menus vs dietitian | carb 16–23%E vs ~52%; fat 48–57%E; satfat 15.6% vs 10% max; **same prompt drifted 2180 → 1762 kcal between runs** |

→ **Changes something, decisively: `BRAIN=off` is MORE right in 2026, not less.** Every measured study shows the same signature — **fat over, carbs under, energy unreliable, non-reproducible. That is Cut Protocol's own dominant failure mode** (B1: 97 over / 1 short). **An LLM in the critical path imports a bias pointing the same direction as the bug being fixed**, and breaks determinism (K4/goldens). Defensible LLM roles are all outside the path: copy, naming, ingredient decomposition, explanation.

**P1-5 · Open-source planners with readable solvers.** Thin: [cdm319/macro-meal-planner](https://github.com/cdm319/macro-meal-planner) (self-described proof-of-concept), [petretiandrea](https://github.com/petretiandrea/meal-planner/) (GA), [parkjan4/DietOptimization](https://github.com/parkjan4/DietOptimization) (Gurobi — commercial, unusable). → **Changes nothing.** None solves *bounded multipliers on fixed recipe bundles scored on rounded grams.* **Reinforces W2-1's hand-roll.**

**P1-6 · A benchmark for meal-plan macro compliance — CONFIRMED, none exists.** [NutriBench](https://arxiv.org/html/2407.12843v2) (11,857 meals) is a nutrition *estimation* benchmark; its Acc@7.5 metric is scored on **carbohydrate only** across all 12 models even though protein/fat/kcal labels exist. Best model 66.82%; **three professional nutritionists scored 45.16–47.22%** on 72 queries. [MealRec](https://arxiv.org/pdf/2205.12133) has no macro-target axis. → **Changes something, as licence not instruction.** There is no external yardstick, so **these numbers cannot be benchmarked against anyone and must never be described as such.** It also means **A4's denominator discipline and K8's golden-is-theatre finding are the only things keeping the fleet's numbers meaningful.** Side benefit: **45–47% is a useful human anchor for how hard macro precision is.**

## PART 2 — THE CONTRARIAN PASS

### Contrarian A — against the floor-ruler / any ruler change · **VERDICT: PARTLY HOLDS**

Measured on the real 250 personas through the real `bmrEngine` (`rulershape.mjs`). **The result adjudicates D-3 differently than either side framed it.**

> **The brief refuted a WIDTH claim. The prompt made a POSITION claim. They were arguing past each other.**

*The brief is right on width.* Effective half-width ±33.11%; [Helms/Aragon/Fitschen](https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/) prescribe 15–30%E, relative half-width **33.3%**. **"Too tight" is dead.** `[SRC+CODE]`

*The prompt is right on position — measured, in both directions at once:* `[MEAS]`

| | vs AMDR 20–35%E | vs Helms 15–30%E |
|---|---|---|
| graded **ceiling** below the reference ceiling | **159/250 (63.6%)** | 104/250 (41.6%) |
| graded **floor** below the reference floor | **199/250 (79.6%)** | 102/250 (40.8%) |

**The whole window is shifted down.** It **rejects days both references accept** and **accepts days both references reject.** Median graded window **16.0%E … 32.0%E**.

**The ruler contradicts the engine's own safety constant for 92.8% of personas.** `ESSENTIAL_FAT_PER_LB_LBM = 0.30` (`bmrEngine.js:286`), but the graded floor is `fatLo − 0.25·fatMid` = **0.2475 × lbm**. **232/250 personas are graded compliant below the engine's own essential-fat floor.** `[MEAS+CODE]` Worth ~0 points (B1 is 97 over / 1 short) — **ship for honesty, like C10.**

**The +4.0/+5.0 number does NOT bound a floor ruler.** `[MEAS]` ±50% widening moves the ceiling 0.4925 → **0.5856** g/lb LBM (a **19%** loosening). A floor ruler lets kcalHi + protein floor + carb floor bind instead — **median implicit/explicit ratio 1.90×, a 90% loosening.** B5's median over-fat day (~+74.5% of a 28%E ask ≈ 0.65 g/lb LBM) sits **above** the widened ceiling and **inside** the floor ruler. **Different instruments, different numbers.** *(W1-2 subsequently measured Ruler D at **+8.9 pts net** — consistent with this.)*

**On the design question — the sources say the fat ceiling is a *displacement* constraint, not a physiological one.** Helms justifies the upper end entirely by what fat crowds out: 15–20%E *"can be deemed appropriate if higher percentages would reduce carbohydrate or protein below ideal ranges"*, ordering protein → fat → *"Carbohydrate: remaining."* [ISSN 2017 #5](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/): *"A wide range of dietary approaches (low-fat to low-carbohydrate/ketogenic, and all points between) can be similarly effective."* [NASEM 2024](https://www.ncbi.nlm.nih.gov/books/NBK610333/) records that the AMDR's ancestor 30%E cap was set *"in the absence of data to support the supposition"*, and that [the AMDR was never an individual-assessment tool — *"the DRIs are not therapeutic values"*](https://www.ncbi.nlm.nih.gov/books/NBK610328/). **`[NO SOURCE]` — no primary source prescribes an independent upper fat bound for an individual on a controlled energy budget with protein and carb floors in place.**

**BUT "ceiling enforced only implicitly via the calorie budget" FAILS on this codebase, measurably.** `[MEAS]` Remove the explicit ceiling and the implicit one lands at **53.0%E median** (p05 47.4%E) — **250/250 personas above AMDR's 35%E.** Repair the carb floor to the engine's own `NONKETO_CARB_FLOOR_G = 50` and it only reaches **45.2%E**, still **241/250** above 35%E. **The reason is I6:** graded carb floor **133.5 g** median against `carbLo` **182 g**, with **28 non-keto personas graded below 50 g**. **Helms's displacement logic only works if the displaced thing is actually defended. It isn't.**

**And the band's endpoints have no source.** `[NO SOURCE + CODE]` `0.34–0.40` matches the coaching figure of 0.3–0.4 g fat per pound of **total bodyweight**, where **0.3 is quoted as a MINIMUM** and the pair is a starting recommendation, **never a two-sided grading band.** Cut Protocol re-anchored it to **lean** mass and grades failure on both sides. **Anchor defect too:** `fatMid` is fixed in grams while `targetKcal` falls with the deficit, so **prescribed fat %E RISES as the cut deepens** — backwards from every source, all of which express fat as %E.

The floor itself *is* supported, just not by its name: true EFA need is ~5–25 g/d, far below 0.30×lbm. Its real warrant is **hormonal** — [Whittaker & Wu 2021](https://www.sciencedirect.com/science/article/abs/pii/S0960076021000716): total T **SMD −0.38** (p=0.04), free T −0.37 (p=0.005), DHT −0.30 (p=0.03) on low-fat vs high-fat. `[SRC]`

**Recommended instrument:** kcal ±15% unchanged · protein floor unchanged · **fat floor at 0.30×lbm** (the engine's own constant) · **fat ceiling RE-ANCHORED to %E, not g/lb LBM** (35%E per AMDR is looser for 159/250, **tighter for 91**; 30%E per Helms is looser for 104, tighter for 146) · **carb floor repaired to `carbLo`/50 g** · keto ceiling hard. **Metric effect unmeasured here — it is a re-grade, so W3-1 can settle it cheaply, as its own arm.**

*Where the contrarian loses:* "the fat band is too tight" and "the ruler is a major lever" are **both dead.** Width matches Helms to within 0.2 pp, the low side is 1 failing day in 98, and **no re-grade of any shape touches the 66.6% of out-of-band days (E3) that fail on something other than the ruler.**

### Contrarian B — against repartition / a smarter portioner · **VERDICT: PARTLY HOLDS**

Strongly on **sequencing** and on the **0.25× floor**; **fails** as an argument for skipping the portioner.

**The bound-miss pattern is a SELECTION signal.** `[JUDGE, grounded in B3/B4/B7/F6]` 66/70 bound misses at the **0.5× floor** = *"less than half a serving of this dish."* **22.5% want a negative bundle** = *"remove this dish."* **That is not a portioning answer that got clamped; it is arithmetic saying wrong recipe.** And **6.2% realised vs 57.3% available** is a shortlist surfacing roughly **one ninth** of the feasible dishes. B3 explains why: the portioning solve is **provably blind to fat and carb**, so candidates are ranked by a rule that **cannot see the axis they fail on.** F6 compounds it. **HOLDS: a better portioner optimises inside an empty box.**

**But this is an argument about ORDER, not about whether to build it.** The cheapest composition-aware *selection* rule is *"rank candidates by best achievable in-box portioning under the 4-macro objective"* — **which needs the portioner as a subroutine.** W2-1's `macroViolation.js` + `achievement()` is the same artifact either way. **Correct sequencing: shared violation function → candidate RANKING → then portion search.** That ordering is also the one that can clear A5's 3.5-pt floor, because **selection effects are large and portioning effects are small.**

**PLATE REALISM — there IS quantitative literature, nobody has cited it, and it says 0.25× is out of bounds.** `[SRC]` The [norm-range model](https://pmc.ncbi.nlm.nih.gov/articles/PMC6333281/) (n=60, n=46, portions varied in 10% steps, judged "normal") is the only published acceptability envelope. Ranges judged normal by ≥60%: pasta **70–120%**, curry 80–160%, porridge 100–150%, cake+ice cream 90–170%, crisps 130–190%. **The lowest "normal" bound across all five foods is 70% of reference.** Cut Protocol's *existing* 0.5× floor is **already below every measured one**; **0.25× is 2.8× below the most permissive**, and the prototype shipped **35.5% of slots there.**

**The behavioural half is the part that matters:** participants intended to **compensate — eat additional food — for portions judged smaller than normal**, and to eat only part of portions judged larger. **A portioner that buys macro compliance by shipping sub-norm portions does not buy compliance. It buys a plan the user eats around: the metric improves and the outcome does not.** Corroborating: [FDA RACC (21 CFR 101.12)](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.12) is a free per-category realism table set from the mean/median/mode of consumed amount per eating occasion, **and nothing here uses it**; [unit bias (Geier, Rozin & Doros 2006)](https://journals.sagepub.com/doi/10.1111/j.1467-9280.2006.01738.x) explains why sub-unit portions read as *wrong* rather than as *small*.

*Transfer caveat, plainly:* that study judges whole single-dish portions visually, n small, **stated intention not behaviour.** Cut Protocol scales bundles *within* a dish, a more forgiving object. **Direction solid; 70% is not a threshold.**

**Is the honest fix "fewer, better recipes"? FAILS as a general thesis.** r = **−0.001** on the satisfiable population; F2's wider −0.057 is worth ~3.4 pts against a 3.45-pt floor and may measure zero. **The library-weakness thesis measures as nothing for compliance.** The library's real defects (18 snack recipes, 53–57 gluten-free pastas hidden from celiacs, 47 unservable recipes) are **safety and product-quality bugs that deserve fixing on their own merits, with no points estimate attached.** One narrow exception: **F5's snack slot** — 141 of 193 empty slots are snacks and `slotAttemptBudget` exceeds candidate count for every diet, so **those misses are provably pool-caused and no optimiser touches them.**

### Contrarian C — against the whole framing · **VERDICT: PARTLY HOLDS**

Right as the solver's internal objective; **wrong as the product headline and wrong as this fleet's sole success criterion.**

**Two of the four graded macros have no measured outcome consequence once the other two are set.** `[SRC]` [ISSN 2017 #5](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/): a wide range of approaches is *similarly effective*, and **no isocaloric protein-matched inpatient comparison has shown a fat-loss advantage either way.** Cut Protocol grades four macros with equal standing; **the evidence says energy and protein carry the outcome and the fat/carb *split*, within reason, does not.** Half the grading dimensions are ornamental with respect to the thing the user came for.

**The measured predictor is adherence, not plan precision.** `[SRC]` [Dansinger 2005 JAMA](https://pubmed.ncbi.nlm.nih.gov/15632335/): 1-year weight loss comparable across Atkins/Ornish/WW/Zone, **adherence the only strong predictor.** [Digital self-monitoring meta-analysis](https://onlinelibrary.wiley.com/doi/10.1111/obr.13306): high adherence **4.2%** of baseline lost vs **1.9%** low. Adherence in *supervised* trials runs 82–91% — **even under supervision one meal in eight is not the prescribed meal.** Add P1-2's 0.94→0.90 nutrition for 2.8→4.5 acceptance, and the trade-off points away from compliance-maximising.

**Where the contrarian FAILS.** (a) The daily predicate is the app's own promise. (b) A weekly-average metric is gameable, and this codebase has a **proven** inflation trap (E11: **+27.94 pts, 186 false refusals, zero behaviour change**). (c) **Keto is a hard carve-out** — ketosis is a daily phenomenon; the keto carb ceiling can **never** be averaged. (d) The bands are the honesty surface; *"unsolvable and why"* needs a per-day predicate to be about.

**Concrete proposal.** Keep the daily 4-macro predicate as the **solver objective** and per-day honesty surface. Make the **headline** energy + protein (7-day mean kcal ±5% AND ≥6/7 protein-floor days), keto carb ceiling daily and hard. **What the app stops headlining: per-day fat/carb band compliance.** Acceptable on ISSN #5 — **provided the fat floor and carb floor stay hard daily gates**, since those are the terms with real physiological warrant. **What is NOT acceptable is deleting the daily predicate: it is the only instrument that can say "this day cannot be built."**
*(⚠️ Note: W2-5 independently measured the specific headline proposed here — "7-day mean kcal ±5%" — and found it **hides 47 out-of-band days across 17 of 43 passing weeks with 0 false alarms.** Take contrarian C's framing; **take W2-5's metric form, not this one.**)*

## What I'd tell the team to stop doing

1. **Stop quoting +4.0/+5.0 as the value of a floor ruler.** Measured: ±50% widening = **19%** looser ceiling; floor ruler = **90%** looser (ratio 1.90×). **W3-1 must run ruler D as its own arm.**
2. **Stop treating the 0.25× portion floor as a live candidate.** Lowest measured "normal" bound is **70% of reference**; 0.5× is already below all five foods measured. Below the norm range the measured intention is **compensatory eating** — the arm improves the plan metric by the same mechanism that destroys the plate outcome. Single seed, 35.5% of slots, **zero plates rendered.**
3. **Stop calling `ESSENTIAL_FAT_PER_LB_LBM` an essential-fat constant, and stop grading 232/250 personas below it.** It's a **hormonal** floor — which is fine, but say so.
4. **Stop considering an LLM anywhere near the solver's critical path.** Every measured study reports fat-over/carb-under/non-reproducible — **the same direction as the bug.**
5. **Stop selling library authoring as a compliance lever** (r = −0.001). Fix H3/F12/F5 on their own merits, **with no points attached.**

## Risks / where I'd be wrong

- **%E figures are computed at nominal `targetKcal`.** A day landing at the top of the ±15% band has lower fat %E than shown. Direction unaffected, magnitude soft by a few points.
- **Case A is a *nutritional* argument, not a metric one.** A 35%E ceiling is looser for 159 personas and **tighter for 91** — the net could be small or negative. **Not measured.**
- **The norm-range study is the weakest link carrying the heaviest load in case B.** n=60/46, visual, **intention not behaviour**, whole dishes not bundles. **If someone renders the 0.25× plates and they look fine, case B drops from "predicted harm" to "unmeasured risk."**
- **CFRL's acceptance trade-off is simulated users.** Suggestive only.
- **I lean on B7's 6.2%-vs-57.3% pair without verifying they share a denominator.** A4 published five non-interchangeable denominators. **W4-3 should reconcile those two before anyone reorders the fix plan on my say-so** — if they come from different denominators, my central case-B claim weakens sharply.
- Helms 2014 is twelve years old and a **narrative review**, not a guideline. Leaned on heavily because it is the best population match.
- **I measured zero compliance points.** Everything here is a property of the *ruler and the targets*, not of the solver's output.

## Summary

**Contrarian A PARTLY HOLDS and reframes D-3:** the brief refuted a *width* claim, the prompt made a *position* claim. Width matches Helms (±33.11% vs 33.3%); **position is wrong in both directions** — ceiling below AMDR for 159/250, floor below AMDR for 199/250, and **232/250 graded compliant below the engine's own essential-fat floor.** The +4.0/+5.0 figure **does not bound a floor ruler** (19% vs 90% loosening). But a **pure** floor ruler fails on nutrition (implicit ceiling = 53.0%E median, 250/250 above AMDR) — **the fix is to re-anchor the ceiling to %E, not delete it.** **Contrarian B PARTLY HOLDS:** selection binds before portioning (6.2% vs 57.3%; 22.5% negative bundles) ⇒ build the shared violation function → **ranking first** → portioner second; and **the 0.25× floor should be killed on the literature, not deferred.** **Contrarian C PARTLY HOLDS:** the fat/carb split is inert for body composition once energy and protein are set — move the *headline*, keep the daily predicate. **`BRAIN=off` confirmed more strongly than in 2025.** **No meal-plan macro-compliance benchmark exists.** **The single most important thing the fleet might have wrong: it is about to rank levers using a shortlist metric (6.2%) and a pool metric (57.3%) whose denominators nobody has reconciled. W4-3 must reconcile that pair before the fix plan is ordered.**
