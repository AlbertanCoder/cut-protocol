# Positioning — written down once, honestly

Per CUT_PROTOCOL_DIRECTIVE.md §9. Provenance discipline: rows marked
**[verified 2026-07-24]** carry claims verified against vendor materials for
the in-app CompareDialog (its header documents the sourcing rules); rows
marked **[web 2026-08-19]** come from third-party reviews found today
(sources at the bottom) — secondary sources, weaker; rows marked
**[unverified recall]** are exactly that. Re-verify before quoting any of
this in marketing.

## The honest edge, in one sentence

Most apps *log* what you ate or *suggest* meals loosely; Cut Protocol
*prescribes* plans whose numbers are machine-verified to the gram — every
day re-checked post-rounding against ±50 kcal / ±7 g protein / ±7 g fat /
±10 g net-carb bands — with hard, fail-closed allergen guarantees
(0 violations across 210 measured person-days; docs/PERSONA_REPORT.md).
Precision + safety is the moat; polish is not (yet).

## Competitor matrix

| App | What it actually does well | Pricing | Where its meal GENERATION is weak |
|---|---|---|---|
| **Eat This Much** — the nearest competitor | The only real automated macro-target planner at scale; calorie precision praised; 4.7★ iOS, 22k+ reviews **[web 2026-08-19]** | ~US$5/mo annual, ~US$9 month-to-month **[web 2026-08-19]** | Reviewers consistently hit recipe repetition by week 3, bland generated meals, oversized grocery lists **[web 2026-08-19]**. No hard allergen guarantee published; tolerance/verification model not user-visible. |
| **MacroFactor** | Best-in-class adaptive TDEE from logged intake + weight trend; serious tracker **[verified 2026-07-24]** | subscription, ~US$6–12/mo **[unverified recall]** | It is a *logger* — it does not generate meal plans at all. |
| **MyFitnessPal** | Enormous food database, barcode scanning, brand recognition **[verified 2026-07-24]** | free tier + Premium **[verified 2026-07-24]** | Meal *planner* exists on the paid tier but is suggestion-shaped: no gram-verified day assembly, no hard allergen wall (their own disclaimers put allergen burden on the user). |
| **Cronometer** | Micronutrient depth nobody else matches; lab-grade data sourcing **[verified 2026-07-24]** | free tier + Gold | No generation — tracking only. |
| **Lose It** | Friendly logging, photo features **[verified 2026-07-24]** | free tier + Premium | Meal planning is loose suggestions on the paid tier; nothing verified to targets. |
| **Lifesum** | Polished UX; Premium adds custom macro targets and template meal plans **[web 2026-08-19]** | ~US$3.75–10/mo, region-variable **[web 2026-08-19]** | Plans are curated templates, not solved to the user's numbers; no per-day verification. |
| **Mealime** | Clean curated recipes, fast weeknight planning **[web 2026-08-19]** | Pro ~US$5.99/mo **[web 2026-08-19]** | Personalization is shallow: no macro solving; nutrition data itself sits behind Pro; narrow library. |
| **PlateJoy** | (was: personalized weekly plans w/ macros + medical diets) | — | **Reported shut down July 2025 [web 2026-08-19]** — one fewer generator in the market. |

## Where Cut Protocol deliberately does not compete (v1)

Social features · barcode-scanning arms race (a manual-UPC lookup exists;
that is enough) · wearable sync · content libraries / recipe blogging.

## The Eat This Much note

The operator already uses Eat This Much — *as a logger only*, which is
itself the market thesis in one anecdote: the generation isn't trusted, the
logging is. A CSV/import bridge from ETM is a later nice-to-have; noted,
not built.

## What would falsify this positioning

- If Eat This Much ships verified-to-the-gram day assembly with a published
  allergen guarantee, the moat narrows to safety + the fail-closed gate.
- If the pool stays thin in the corners (vegan+GF, keto), "prescribes" reads
  as "prescribes the same six dinners" — the exact repetition complaint that
  keeps ETM users logging instead of planning. Pool depth is product work,
  not marketing work (docs/PERSONA_REPORT.md tracks it).

Sources (web 2026-08-19):
[promealplan ETM review](https://www.promealplan.com/en/blog/eat-this-much-review-2026) ·
[ultimatemealplans ETM review](https://ultimatemealplans.com/reviews/eat-this-much) ·
[thesunrisedigest Mealime review](https://thesunrisedigest.com/eat/mealime-review-2026/) ·
[mealfan meal-planning services](https://mealfan.com/best-meal-planning-services/) ·
[nutriscan Lifesum pricing](https://nutriscan.app/blog/posts/lifesum-premium-worth-it-2026-meal-plans-macros-cost-6ffc879a6c)
