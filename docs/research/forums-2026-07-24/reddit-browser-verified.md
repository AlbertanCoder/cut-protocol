# Reddit — browser-verified findings (real posts, real scores)

_2026-07-24. Pulled by driving the owner's own Chrome against `old.reddit.com` (the
one method Reddit serves, since anonymous `.json` scraping is CDN-blocked and its
API needs OAuth). Post titles + scores + comment counts are factual data points;
nothing is reproduced at length. This upgrades the sibling `SYNTHESIS.md` from
"directional proxy sources" to Reddit-cited for the themes below._

Pages read this pass: `r/loseit` top-of-year; `r/loseit` search (app / meal plan /
what to eat); `r/MacroFactor` search (wish / missing / meal plan); `r/foodallergies`
search (app / meal plan / recipe filter). More subs remain (the scrubber and the
browser can both continue) — this is a solid first pass, not the whole of Reddit.

## Theme 1 — "just tell me what to eat" / decision fatigue (validates the SOLVER)

- r/loseit **"Who else is annoyed that every second of every day revolves around
  food?"** — 348 pts, 127 comments. Food preoccupation, meal-planning as an
  all-day mental load. The exact burden a solver removes — and an ED-adjacent
  safety signal (see Theme 5).
- r/loseit **"I am so sick of trying to lose weight…"** — 700 pts. Burnout with the
  daily grind of planning/shopping/prepping/tracking.
- r/MacroFactor **"Life changing tip I found out from this subreddit"** — 786 pts,
  and it's a manual method for back-calculating exact grams of food to hit a
  calorie number. People are doing by hand, and upvoting 786×, the arithmetic Cut
  Protocol's solver does automatically. Strongest single confirmation that the
  solver answers a real, high-demand job.

## Theme 2 — adaptive TDEE (validates CP's adaptive engine)

- r/loseit **"Warning for morbidly obese: My TDEE was all wrong. (vent)"** — 315
  pts, 94 comments. Static calculators mislead; people want expenditure that
  learns from their real data. That is Cut Protocol's adaptive TDEE.
- r/loseit **"[Update] Not losing weight despite calorie deficit"** — 4,488 pts (top
  of year). The plateau-anxiety pain adaptive TDEE exists to calm.

## Theme 3 — the MyFitnessPal migration is live (validates the positioning)

- r/loseit **"Myfitnesspal replacement recommendations"** — 283 pts, 215 comments.
  An active, high-engagement thread of people leaving MFP and asking what to use.
  This is the audience Cut Protocol's "no subscription, no ads, private, and it
  *plans* your meals" answer is for.

## Theme 4 — allergen-filtered planning is wished-for and self-built (validates the moat)

r/foodallergies users repeatedly try to build, or hunt for, the exact feature Cut
Protocol already ships — true allergen *exclusion* filtering:
- **"Website with recipes filterable on allergens"** — 43 pts; a developer with
  allergies proposing to build it.
- **"Life of parents who have ANA allergic kids is so hard… we can build a database
  … so people can just [filter safe foods]"** — 23 pts, 32 comments.
- **"New App for Recipe Searching based on Food Allergies"**, **"Where can I find
  recipes filtered (excluding) by allergies?"**, **"Uno Allergy: A Web App for
  People with Food Allergies"** — recurring, small-but-repeated demand.
- Gaps this surfaces for CP: **restaurant filtering** ("Is there even any hope for
  restaurants?", 9 pts) and **multi-person / allergic-kid households** — both
  things CP does not yet do.

## Theme 5 — AI photo logging is hyped but distrusted (validates deterministic)

- r/loseit **"I checked whether 'AI photo calorie tracking' actually works by testing
  5 models against my kitchen scale. This stuff doesn't work."** — 2,519 pts, 211
  comments. The market's shiny logging feature is widely seen as inaccurate — an
  argument *for* Cut Protocol's deterministic, from-real-grams approach over
  guess-from-a-photo.

## Theme 6 — food preoccupation as a safety signal (validates the wellbeing work)

The 348-pt "food revolves around every second" thread and the general "all-consuming"
framing are the disordered-eating-adjacent pattern the new SCOFF wellbeing check and
the no-red / calorie-floor design are meant for. Real, upvoted, and common.

---

### Net
Every load-bearing claim in `SYNTHESIS.md` that we could reach on Reddit held up
against real, highly-upvoted posts: the solver answers "just tell me what to eat,"
adaptive TDEE answers the plateau/"my TDEE was wrong" pain, the MFP exodus is real,
allergen-exclusion is a wished-for feature people try to build themselves, AI photo
logging is distrusted, and food-preoccupation is common enough to justify the
wellbeing check. The gaps also held: restaurant filtering, multi-person households,
and (from the broader scrub) fast logging + mobile.
