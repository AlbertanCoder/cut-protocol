# Calorie/Cut App Wants & Pain Points — Forum Research (2026-07-24)

**Sourcing note:** reddit.com and old.reddit.com are BLOCKED for both WebSearch and WebFetch in this
environment (confirmed — not a query problem). No Reddit thread could be read directly, so no Reddit
posts are quoted here. Findings are drawn from reachable adjacent sources: Cronometer forums, TeamBlind,
AlternativeTo reviews, MyFitnessPal's own community, app-store/press coverage, and macro-planner review
sites. All URLs cited. Nothing invented.

## 1. Top 10 wants / most-common pain points
1. **Barcode scanner / fast logging pulled behind paywall** — huge backlash when MFP moved barcode
   scanning to Premium (Oct 2022); "longtime users threaten to move on," flagged as an *accessibility*
   need for dyslexic users. [xda](https://www.xda-developers.com/myfitnesspals-barcode-scanner-behind-a-paywall/)
2. **Logging is tedious / "food-log fatigue"** — people burn out entering every meal; market is racing to
   AI photo/voice logging ("3.5x faster"). [mynetdiary](https://www.mynetdiary.com/food-log.html), [ateamfit](https://ateamfit.substack.com/p/why-food-logging-feels-like-a-hassle)
3. **Corrupt / inaccurate food database** — "dozens of 'chicken breast' options and all of them are
   different"; user-submitted entries wrong. [cronometer forum](https://forums.cronometer.com/discussion/comment/18204)
4. **Subscription resentment + ads** — Premium ~$80–100/yr, "shell of itself," ads interrupt logging,
   2.7/5 on AlternativeTo. [alternativeto](https://alternativeto.net/software/myfitnesspal/about)
5. **Decision fatigue — "just tell me what to eat"** — strong demand for planners that hit macros for you
   (Eat This Much, Macrostax, MacroPath). [organicauthority](https://www.organicauthority.com/meal-plans/meal-plan-generator-macros)
6. **Offline / private / local-first / no account** — a whole app category now sells exactly this. [useprotrack](https://useprotrack.com/blog/best-offline-private-calorie-tracker-apps), [foodnoms](https://foodnoms.com/vs/myfitnesspal)
7. **Micronutrient tracking** (vitamins/minerals), not just macros. [cronometer forum](https://forums.cronometer.com/discussion/comment/18204)
8. **Static goals that don't adapt / plateaus** — target that worked stops working; people want auto-
   recalculated TDEE. [fitia](https://fitia.app/learn/article/why-calorie-target-keeps-changing-tdee/), [macrofactor](https://macrofactor.com/problems-with-calorie-counting/)
9. **Auto grocery list + on-budget shopping** — "finally on budget with my groceries." [prospre](https://www.prospre.io/), [strongrfastr](https://www.strongrfastr.com/macro-meal-planner)
10. **Bugs / bloat / broken sync** — MFP "cluttered," Apple Health sync drops food names/timestamps,
    6-month-old unfixed bugs. [teamblind](https://www.teamblind.com/post/what-is-up-with-myfitnesspal-uanggkfy), [foodnoms](https://foodnoms.com/vs/myfitnesspal)

## 2. What Cut Protocol ALREADY covers (honest)
- #5 decision fatigue — **core strength.** Deterministic solver *is* the "just tell me what to eat" ask.
- #6 offline/private/local-first — **direct match**, and a genuine differentiator vs cloud incumbents.
- #7 micronutrients — covered (micro rollup).
- #8 adaptive goals — covered (adaptive TDEE from weigh-ins + BMR safety floor). Directly answers plateaus.
- #9 grocery list — covered, with *real purchase units* (better than most).
- #4 ads/subscription — no ads, local = strong implicit answer.
- #3 database quality — partial: curated recipe library + URL import avoids crowd-sourced garbage, but
  isn't a broad branded/restaurant food DB.

## 3. GAPS (ranked by how often the want appeared)
1. **Fast descriptive LOGGING (barcode / photo / voice)** — the #1 thing MFP refugees want. Cut Protocol
   is *prescriptive* (plans what to eat); it has no way to quickly capture what you *actually* ate. Biggest gap.
2. **Mobile.** Every logging want is phone-first ("30 sec right after eating"). Cut Protocol is DESKTOP —
   nobody logs a restaurant meal from a laptop. Platform mismatch for the mass pain point.
3. **Large branded/restaurant food database + barcode DB.** Recipe library ≠ real-world eating-out coverage.
4. **Wearable / Apple Health / Fitbit sync.** Local-only = no integration; recurring expectation.
5. **Meal variety.** Solver planners are exactly the ones accused of "chicken and broccoli, third week
   straight." Cut Protocol must prove its library + taste filters avoid this, or it inherits the complaint.
6. **Real-life flexibility / eating out** — plans assume adherence; users want graceful handling of
   impulse/social meals. (Some, notably, explicitly want NO social/community — mixed signal.)

## 4. Safety / harm themes (relevant)
Strong, recurring, and evidence-backed. One study: 74.3% used calorie apps and **73.1% said the app
contributed to eating-disorder symptoms**. [therapist.com](https://therapist.com/disorders/eating-disorders/calorie-counting-apps/)
Named triggers: red/color "warning" numbers driving guilt, food moralization ("good/bad" foods),
loss of hunger cues, obsessive rigidity, over-restriction (menstrual loss, bingeing).
Implication for Cut Protocol: its **plan-first model sidesteps the log-every-bite guilt loop** (a real
safety *advantage*), and the sub-2000 kcal / BMR floor is protective. BUT the weigh-in **"verdict"** and
adaptive-cut logic can still moralize/over-restrict. Recommend: neutral verdict language, a hard deficit
floor, and never framing a heavier weigh-in as failure.
