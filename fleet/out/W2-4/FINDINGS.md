# W2-4 — COMPETITOR TEARDOWN

*Persisted by the orchestrator. Machine artifact: `fleet/out/W2-4/competitors.json`.*

## 1. Promises-vs-reality

**The comparable set is THREE, not five.** MacroFactor has no meal generator (tracker + adaptive coach); Mealime has no day-level macro solve (a per-recipe calorie *filter*). **Quote the finding as "zero of the three comparable products publish a numeric plan-accuracy tolerance" — not "0 of 5", which is wrong in both directions.**

| Product | Stated accuracy claim (quoted) | Admits infeasibility | How | Per-day error shown | Source |
|---|---|---|---|---|---|
| **Eat This Much** *(comparable)* | **None found (numeric).** Marketing: *"Hit your macros and calorie targets every day"*. The only % they publish is for **groceries**: *"we've found the planner to be 80%-90% efficient with using up groceries"* | **Yes — most fully of anyone** | Help article: *"Depending on how strict your settings are, the weekly meal generator can miss macronutrient targets."* Names 9 causal settings. But it is **documentation, not product copy** | Totals yes; explicit miss flag unconfirmed | [help](https://help.eatthismuch.com/help/the-generator-isnt-hitting-my-target-macros-whats-going-on) |
| **StrongrFastr** *(comparable)* | **None found — and an explicit DISCLAIMER:** *"Note that the app does not support hitting exact macronutrient targets."* / *"You can get pretty close… but the app requires a certain degree of flexibility in order to provide users with a meal plan with ample variety."* | **Yes — in product** | *"If your plan doesn't meet your calorie/macro targets, you will see a **red error alert**"* → pin-and-regenerate → *"it may be because your overall settings are so restrictive."* | **Yes — flagged in RED** | [tutorial](https://www.strongrfastr.com/help/meal_plan_tutorial) |
| **Prospre** *(comparable)* | **None found.** Strongest unqualified promise anywhere: *"Why track macros or count calories when you can create a plan to hit your goals **every time**?"* / *"Prospre can create a meal plan that contains **any amount** of calories, protein, fat, and carbs."* Undocumented knob: *"how accurate you need your macros to be"* | **No public infeasibility copy found** | n/a — no documented failure state | Unknown | [features](https://www.prospre.io/features) |
| **MacroFactor** *(not comparable)* | n/a for plans. For **expenditure**: fully validated — *"errors typically fall within the range of 60–240 Calories (median = 135)"*; *"nearly 84% of users have errors below 10% of TDEE"*; n=748, 100 days | n/a | On going over: *"**nothing happens.**"* / *"You won't see a warning on the screen shaming you"* | Miss flag **deliberately absent** | [accuracy](https://macrofactor.com/algorithm-accuracy/) |
| **Mealime** *(not comparable)* | **The only explicit numeric tolerance in the whole teardown** — on a recipe filter: *"All recipes 600 calories (plus or minus 20 calories)"* | n/a | n/a — a filter matching nothing returns an empty list, not a failure | Per-recipe only | [Medium](https://medium.com/mealime/calorie-filters-are-now-available-for-pro-subscribers-b386898ff4cc) |

**Three findings worth more than the table:**
1. **ETM published a measured percentage — for grocery efficiency, not macros.** They are demonstrably willing to publish performance numbers. **They published the one they were proud of. Read the silence on macros as a choice.**
2. **Mealime can publish "±20 calories" precisely because filtering cannot fail.** The three real solvers can't, and don't. **Tolerance is publishable when satisfaction is guaranteed; it becomes unpublishable the moment you commit to a solve.**
3. **"ETM is most open about its algorithm" is STALE.** Their dev blog is a dormant 2013 announcement log — ten posts, zero algorithm content. Their 2026 openness is about *failure modes*, not mechanism. **Don't plan to mine them for design.**

## 2. Three infeasibility copy blocks

Numbers are illustrative placeholders showing required shape; bind each to real solver output. Structural rule throughout: **name the macro, the number, the cause, the option, and the cost of doing nothing.**

### (a) Arithmetically impossible configuration — amber `--warn`, never red

> ### This plan can't be built as configured.
>
> Your targets need **8.4 g protein per 100 kcal**. The densest recipe your filters leave is **6.1 g** — across all 15 that survive. No combination of them reaches 8.4 at any portion size between 0.5× and 2×. This isn't a near miss. It's arithmetic.
>
> Your snack slot has **0 eligible recipes**, so the day is built from 3 meals carrying the full 2,180 kcal.
>
> **Three ways forward, cheapest first:**
>
> **Add a protein source** — One soy-free, gluten-free unflavoured isolate raises the reachable ceiling to about 9.2 g/100 kcal and makes every day this week solvable.
>
> **Review your protein target** — 185 g is 2.4 g/kg. Dropping to 155 g (2.0 g/kg) is inside the evidence-supported range for a cut and clears the wall. Your calorie target does not move.
>
> **Review your restrictions** — Sesame is the narrowest of the five: on its own it removes 41 recipes, 9 of them in the top protein decile. We will not suggest dropping an allergy. Review it only if it was set by preference.
>
> *We won't lower your calorie target to make the math close. 2,180 is your floor (RMR × 0.95).*

Leads with the impossibility, not an apology. Both numbers shown so the claim is checkable. Names the snack-pool zero rather than letting the user infer it. **Explicitly refuses to suggest dropping the allergy.** Closes by making the floor refusal *visible* rather than hidden.

### (b) Fat over, otherwise fine — amber on the fat figure only; the three in-band macros keep `--accent`

> ### Fat over by 14 g. Everything else landed.
>
> Tuesday: **2,412 kcal** against a 2,384 target — in band. **Protein 186 g**, target 180 — met. **Carbs 214 g** against 195–240 — in band. **Fat 88 g** against 55–74 — over by 14.
>
> One slot did it. Dinner's almond-crusted salmon carries 31 g of fat — 35% of the day, in 22% of the calories.
>
> **Swap dinner** — The grilled version drops the day to 71 g fat, inside the band, and holds protein at 184 g.
>
> **Keep it** — 126 kcal above plan for the week. Your remaining six days absorb 21 kcal each. No target changes, and tomorrow already adjusts.

Leads with what *landed*. Every number carries its band, so the verdict is checkable rather than trusted. Attributes the overage to one named slot with its share — converting a verdict into an action. **"Keep it" is first-class with its cost stated.** MacroFactor takes the anti-shaming position by showing *nothing*; **this takes the stronger position of showing the number AND making acceptance legitimate.**

### (c) Snack slot unfillable — neutral `--faint`, deliberately **NOT** amber

> ### No snack today — that's our library, not your settings.
>
> The library has **18 snack recipes in total**. None of them clear vegan + no soy + no sesame. That's a gap on our side.
>
> Your targets weren't affected: the other three slots carried the full 2,384 kcal — breakfast 620, lunch 780, dinner 984 — and all four macros landed in band.
>
> **Add your own snack** — It joins your pool permanently and the solver will use it from the next plan onward.
>
> **Plan 3 meals a day** — Removes the empty slot from your layout. Reversible any time.
>
> *We're authoring snack recipes now, allergen-restricted diets first — that's where the hole is.*

Heading assigns cause in five words, and assigns it to **us**. Publishes the real count (18) because a user who can see 18 can see this isn't about them. States targets were met, pre-empting an empty slot reading as a failed day. **Not amber — nothing went over, nothing missed; colouring this as a warning teaches distrust of a day that was fine.**

## 3. Target-setting norms

**Showing a band is industry practice. Cut Protocol's current configuration — grade a band, display a point — is the unusual one, and the worst of the three available.**

- **ETM:** *"you can adjust your macronutrient targets as either a range or a percentage of your calories"* — and actively counsels **widening**: *"We generally suggest wider ranges… because it allows for significantly greater food variety."*
- **StrongrFastr:** *"setting upper and lower limits"*
- **Cronometer** (norm evidence): Daily Target + Minimum Threshold + Maximum Threshold. Staff: *"You can set a range for your energy and macronutrient targets!"*
- **MacroFactor** (micronutrients): *"a range consisting of a floor, a target, and a ceiling"* — LTI/RDA/UL. **Macros are point values.**
- **Mealime:** per-recipe bands.

**4 of 5 assigned products expose a band somewhere; 5 of 6 including Cronometer.** In **no** examined product is tolerance a hidden constant the way Cut Protocol's is (D8: the ruler is locked by no test). ETM, StrongrFastr and Cronometer all make band width **user-editable**.

**The asymmetry worth noting:** ETM's guidance runs *opposite* to the instinct that a tighter ruler is better — **they tell users to widen, and name the reason (variety).** Same tradeoff StrongrFastr names publicly and the same one F7 calls irreducible. **Three independent products converged on it; two resolve it publicly in favour of variety.**

**Recommendation: show the band.** Displaying a point while grading a band is the only configuration in which **a user cannot tell whether they passed** — it manufactures perceived misses on graded passes and hides genuine misses near the edge. Copy MacroFactor's floor/target/ceiling shape.

**Also:** StrongrFastr and Cronometer both use **RED for over-target on food data**. **Red-on-over is the category default.** Cut Protocol's amber law is a deliberate, defensible, *marketable* divergence — not an eccentricity. MacroFactor's answer (show nothing) is the opposite extreme, forbidden here by "silent target misses are forbidden." **Calm amber + explanation is a third position that, on this evidence, nobody occupies.**

## 4. A defensible accuracy claim

**Is ~77% bad? Unknowable from competitor data — and that is the finding.** No competitor publishes a comparable number. There is no external benchmark.

**Is "85% of satisfiable days within band" strong? Incomparable, and dangerous if published naked:**
1. No competitor publishes a days-in-band rate, so 85% can't be positioned against anything.
2. **"Satisfiable" is a term you define.** Publishing satisfiable-only without the all-days number is exactly **E11's inflation trap**. An external reader cannot audit that exclusion. **A6** already records the rig dropping 16 satisfiable total-failure days from its own denominator.
3. **A5** sets MDE at ~3.5 pts on n≈537. "77.3%" implies precision the instrument lacks. **Publish whole numbers.**

**Recommended wording:**

> On 250 generated user profiles, **77% of days land inside the target band** — calories within ±15%, protein at or above 85% of target, fat and carbs inside their ranges. Days that miss are named in the app, with the macro, the number, and the reason. We publish this because we could not find a single competitor who publishes any macro-compliance rate at all.

Conditions: re-measure on the shipping tree (A3); publish **both** denominators with the exclusion count; never use "satisfiable" undefined; **do not** compare to the academic AMDR figures (11.9%/18.9% — per-*meal*, non-personalised, different ruler); **do not** claim superiority over any named competitor, since none published a number to beat.

**The stronger claim available is not the percentage.** It is: *"We are the only meal planner we could find that publishes how often it hits your macros — and that tells you, in the app, when it didn't."*

## 5. Risks / where I'd be wrong

- **In-app copy is invisible to this method (HIGH).** Every "none found" means *not published on the public web*. StrongrFastr's red alert is documented to exist but its string is screenshot-only; Prospre's accuracy knob is confirmed but its levels are in-app. **Close it with trial accounts on Prospre and StrongrFastr, deliberately over-constrained, screenshotting the failure state.**
- **Quote fidelity (MEDIUM).** Quotes come from a summarising fetch. Load-bearing ones were cross-checked with targeted phrase-location re-fetches (ETM help full text; StrongrFastr disclaimer + red alert to section heading; Mealime ±20; ETM 80–90% and "wider ranges"). Quotes tagged `verify:"single-fetch"` in the JSON — concentrated in **Prospre and MacroFactor** — carry residual paraphrase risk. **Retrieve raw HTML before any of these reaches public marketing.**
- **Absence of a published claim ≠ absence of internal measurement (MEDIUM).** All three comparable products almost certainly measure this internally. Silence is most likely a *marketing* decision. Doesn't weaken "incomparable," but **publishing 77% enters a market where competitors imply 100%.** A real commercial risk — frame it as transparency and pair it with the in-app honesty behaviour, or it reads as a confession.
- **Category error contaminating the table (MEDIUM).** A skimmer will average five incomparable rows. **Always quote "zero of the three comparable products."**
- **No developer forum/Reddit post found for any of the five (MEDIUM).** Reddit is poorly indexed by this tool. **Do not cite "no developer posts exist" as established.**
- Cronometer's under-minimum bar colour is ambiguous (forum says yellow, current article says grey — likely a redesign). The load-bearing part (RED for over-max) is consistent.

## Summary

**Zero of the three comparable products publish any numeric plan-accuracy tolerance.** Only MacroFactor publishes a validated accuracy figure — for **expenditure**, and it has no generator. Mealime's ±20 kcal is the only explicit number, on a filter that cannot fail. StrongrFastr **explicitly disclaims** exact macro accuracy; Prospre promises *"every time"* with zero backing and no documented failure state; ETM publishes 80–90% grocery efficiency and nothing for macros. **Most useful competitor practice: MacroFactor's accuracy-publication *structure*** (stated n, duration, exclusions, full error distribution, named comparator) — **copy the methodology, not the metric.** Showing a band is standard (5 of 6); grading a band while displaying a point is the worst configuration. Red-on-over is the category default, so amber is marketable divergence — and calm-amber-plus-explanation is a position **nobody occupies.** **Publish both denominators with the exclusion count, or it is E11's trap.**
