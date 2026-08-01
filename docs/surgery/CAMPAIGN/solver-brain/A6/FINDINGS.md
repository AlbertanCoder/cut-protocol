# A6 — Industry convention: how shipping apps define "hit your macros"

*Agent A6. Written to disk by the fleet coordinator from A6's returned deliverable —
the subagent could not create this file itself (see Blocker). Content is A6's.*

## Lead finding (null result)

**No consumer app surveyed publishes a per-macro tolerance for fat.** Not a loose
one, not a tight one — none. Exactly one app publishes a numeric tolerance of any
kind (Fitia, ±10 %, calories only). Zero compute and display a days-in-band hit
rate. Cut Protocol's 70.1 % has **no published competitor number to compare
against in either direction.** MEASURED (documentary — every source below fetched
and quoted).

## Table

| App | kcal tolerance | Per-macro tolerance | Fat graded as tightly as protein? | Hit rate reported? | Source |
|---|---|---|---|---|---|
| **Fitia** | **±10 %**, green in / yellow out | not published | not published | No — colour band only | [1] |
| **MacroFactor** | none, by design | none | n/a | **No, explicitly refuses** | [2][3] |
| **Carbon** | not published | "within the optimal range", never numerically defined | not published | Self-reported weekly, not computed | [4] |
| **Eat This Much** | user-set range; docs say "around" target | user-defined; docs *recommend* "fairly loose ranges" | No app-imposed band | No | [5][6] |
| **Cronometer** | user-set "Daily Target" + "Maximum Threshold" | user-defined | No app-imposed band | No | [7] UNVERIFIED as official — user forum post, no staff reply |
| **Prospre** | not published | user picks "how accurate you need your macros to be"; levels never defined | not published | not published | [8] |
| **RP Diet Coach** | not published | not published | not published | not published | [9] |
| **Strongr Fastr** | not published | upper/lower limits, user-set | not published | No | UNVERIFIED — claim appeared in search summary, absent from fetched page |
| **IIFYM convention** (not an app) | — | **+5 g over / −10 g under, per macro** | Yes — same gram rule all three | No | [10] |

## The comparability verdict — and a correction to the mission brief

The assignment anticipated Cut Protocol grading fat *tightly*. It does not.

DERIVED, from `mealSolver.js` (`DAY_FAT_TOLERANCE_PCT = 0.25`; `bandMiss()`
divides the overshoot by the band **midpoint**):

```
mid = (0.34 + 0.40)/2 = 0.37·lbm ; allowance = 0.25 × 0.37 = 0.0925·lbm
pass window = [0.34 − 0.0925, 0.40 + 0.0925] = [0.2475, 0.4925]·lbm
half-width / mid = (0.03 + 0.0925)/0.37 = ±33.1 %
```

The **±8 % is the band; the grading tolerance is ±33.1 %.** The code says so
itself: judging strictly inside the band *"would fail nearly every real plan and
make the flag meaningless."*

Against the only published per-macro gram convention [10], on a 145 lb-LBM user
(fat midpoint 53.6 g): IIFYM passes **43.6–58.6 g** (15 g wide); Cut Protocol
passes **35.9–71.4 g** (35.5 g wide). Cut Protocol's fat gate is roughly **2.4×
wider**. ESTIMATED — a survey of real user LBM values would test whether that
ratio holds across the population.

So the framing "is Cut Protocol too strict on fat?" is answered **no**, and the
more useful question is the inverse: 70.1 % is being scored against a fat gate
looser than the flexible-dieting convention, which makes the number *flattering*,
not harsh. Tightening it would lower the score.

**Corroboration:** the ±33.1 % figure rests on `lo − 0.25·mid = 0.2475·lbm`. A4
independently landed on the identical `0.2475·lbm` figure without coordination.
Arithmetic corroborated across two agents.

**Contradiction logged (BRIEF rule 12):** a third-party review claimed MacroFactor
"shows your adherence rate." MacroFactor's own dashboard page denies it — habit
streaks, not adherence rates [3]. Several 2026 "best macro app" pages
(macro-trackers.com, hootfitness, nutriscan, caleye, nutrola) read as generated
SEO content and one cites a "120-day Macro Tracker Lab study" that could not be
located. **Not cited. Treat that whole tier as contaminated** if another agent
surfaces it.

## Blocker

The harness refused report-file writes from the subagent, so this file could not
be created by A6 itself. A4 hit the same block. Deliverable returned as text and
persisted by the coordinator. The one number is in `CLAIMS.tsv`.

## Citations

[1] "What Do the Green and Yellow Colors on the Calorie Bar Mean?", Fitia, n.d.,
https://fitia.app/help/articles/calorie-bar-green-yellow — "Your daily calorie
target always includes a ±10% margin… Lower limit: 1,800 kcal, Upper limit:
2,200 kcal."
[2] Nuckols, Greg. "What Do We Mean When We Call MacroFactor 'Adherence
Neutral'?", MacroFactor, upd. 12 Sep 2025, https://macrofactor.com/adherence-neutral/
— "won't provide negative feedback… if you exceed your calorie or macronutrient
allotments." The "~300 calories" figure on that page is a *user's* self-set
standard, not a shipped rule.
[3] Kekelishvili, Rebecca. "MacroFactor Delivers on the Next-Generation Macro
Tracking…", MacroFactor, upd. 25 Sep 2024, https://macrofactor.com/dashboard-revamp/
— streaks favour "the habit of tracking… over perfection."
[4] "What is the Carbon Diet Coach and How it Works?", Carbon Diet Coach, n.d.,
https://www.joincarbon.com/how-it-works
[5] "Eat This Much, your personal diet assistant", n.d.,
https://www.eatthismuch.com/how-to/ — "around 2000 calories"; recommends "fairly
loose ranges."
[6] "Eat This Much Tutorial #2…", ETM Blog, n.d.,
https://blog.eatthismuch.com/eat-this-much-tutorial-2-editing-and-creating-your-nutrition-target-profiles/
[7] "Target range for macros", Cronometer forum #5721, 2023,
https://forums.cronometer.com/discussion/5721/target-range-for-macros — user
"Beat": "set a 'Daily Target' and 'Maximum Treshold'." **UNVERIFIED as official.**
[8] "Features", Prospre, n.d., https://www.prospre.io/features
[9] "We Changed The RP Diet Coach App — Here's Why!", RP Strength, 29 Sep 2025,
https://rpstrength.com/blogs/podcasts/we-changed-the-rp-diet-coach-app-heres-why —
contains no tolerance definition.
[10] Julson, Erica (MS, RDN, CLT). "IIFYM Guide", Healthline, 14 Jun 2023,
https://www.healthline.com/nutrition/iifym-guide — "As long as you don't go over
each macronutrient by more than 5 grams, or under by more than 10 grams, you
should still see results."

**CONFIRMED** — the question was answerable and is answered: the market publishes
essentially no fat tolerance, so Cut Protocol's 70.1 % is not comparable to any
published figure; and Cut Protocol's fat gate is ±33.1 % of midpoint, not ±8 %,
making it ~2.4× looser than the IIFYM +5 g/−10 g convention.
