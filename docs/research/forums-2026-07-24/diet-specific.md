# Diet-Specific Community Research — 2026-07-24

**Sourcing note (honesty):** reddit.com and every Reddit mirror I tried (old.reddit,
redlib/libreddit/safereddit instances) are **unreachable** from this agent's tools —
WebSearch's crawler is blocked from reddit.com and WebFetch returns 403. I did **not**
fabricate Reddit posts. Findings below come from *reachable* 2026 app-review aggregators,
clinical/health sources, and nutrition-app analyses that summarize the same user
complaints. Treat these as directional; a browser-driven Reddit pass is the follow-up.

## 1. Per-diet top wants / pain points (with URLs)

**Keto — net carbs default + electrolytes.** "Sodium, potassium, magnesium loss is the
most common reason new keto users feel terrible in week 2." MyFitnessPal hides
electrolytes without Premium; Lose It!/Lifesum gate net-carb display behind Premium;
user-entry "carb-count drift" (fiber/sugar-alcohol filled only ~64% of the time) silently
breaks ketosis. Sources: clinicalappreport.com/en/rankings/best-calorie-tracking-app-for-keto-2026/,
calorietrackerlab.com/bestof/best-calorie-tracking-app-for-keto-2026/, forums.cronometer.com/discussion/5493.

**Vegan — protein attainment + B12/iron.** Apps "have poor recognition of plant-based
combination meals (tofu stir-fry, lentil curry, Buddha bowls)," suggest animal products by
default, and don't "warn you if you're low on protein, iron, or B12." Sources:
welling.ai/articles/best-vegan-calorie-counter-apps-2026.

**IF — eating-window scheduling.** "Most generic trackers treat your eating window like a
random 24-hour block." Users want the fasting timer merged with the food log and
macro density optimized for a 4–8h window. Source:
nutrition-apps-ranked.com/en/articles/best-nutrition-apps-intermittent-fasting-2026/.

**Low-cal/volume — satiety.** Want big, filling, low-density meals; some apps score meals
1–4 on quality but none optimize a *satiety/volume* score. Sources:
caloriecue.app/blog/volume-eating, reshapeapp.ai/blog/how-to-use-food-volume-for-satiety.

**Carnivore/Paleo — compliance + electrolytes.** Vore review notes electrolyte tracking in
adaptation; complaints of "extremely basic," bad macro import, "no meal plans or recipes."
Sources: voreapp.com/blog/best-carnivore-diet-app, welling.ai/articles/best-calorie-tracking-apps-paleo-2026.

## 2. What Cut Protocol already handles (strengths to lead with)
- 9 diets as **hard** filters + keto carb-ceiling after scaling → beats "retrofit" apps.
- Protein target is a **solver constraint**, not a hope → answers vegan protein-attainment.
- Micros tracked → can surface B12/iron/Mg/K where rivals paywall them.
- Cost + allergy + grocery-list + offline/private → matches budget/privacy asks natively.

## 3. GAPS ranked by frequency
1. **Eating-window / meal-timing scheduling** (IF) — plans are per-day, not time-boxed.
2. **Satiety / volume / energy-density score** (low-cal) — no rival does it; solver could.
3. **Electrolyte dashboard w/ Na/K/Mg targets** (keto + carnivore) — often paywalled elsewhere.
4. **Net-carb-as-default display** (keto) — confirm ceiling shows *net* prominently.
5. **Proactive micronutrient low-warnings** — B12/iron (vegan), Mg/K (keto).
6. **Protein-per-dollar ranking** (budget) — extend existing cost filter.
7. **Plant combo-meal / smart plant-protein guidance** (vegan).

## 4. Safety themes (very-low-cal)
At ~1200 kcal, "micronutrient deficiencies develop invisibly"; sources link tracking apps
to disordered-eating hyperfocus and advise anyone with an ED avoid it. Reinforces Cut
Protocol's **never-suggest-<2000-kcal** rule and argues for an explicit micro-deficiency
warning at low intakes. Sources: dietvsdisease.org/1200-calorie-diet-meal-plan/,
pmc.ncbi.nlm.nih.gov/articles/PMC5700836/ (MyFitnessPal + eating disorders).
