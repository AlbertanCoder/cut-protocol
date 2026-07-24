# Reddit — browser-verified findings (real posts, real scores)

_2026-07-24. Pulled by driving the owner's own Chrome against `old.reddit.com` (the
one method Reddit serves, since anonymous `.json` scraping is CDN-blocked and its
API needs OAuth). Post titles + scores + comment counts are factual data points;
nothing is reproduced at length. This upgrades the sibling `SYNTHESIS.md` from
"directional proxy sources" to Reddit-cited for the themes below._

Pages read: `r/loseit` top-of-year; `r/loseit` search (app / meal plan / what to
eat); `r/MacroFactor` search (wish / missing / meal plan); `r/foodallergies`
search (app / meal plan / recipe filter); `r/keto` search (app / net carbs /
electrolytes / meal plan); `r/EatCheapAndHealthy` search (app / meal plan / pantry
/ grocery / leftovers); `r/intermittentfasting` search (app / eating window /
timer / macros); `r/cronometer` search (wish / missing / adaptive / feature / meal
plan). **Eight subs / nine pages** — broad. `r/mealprep`, `r/Celiac` and `r/fitness`
remain for a next pass (the OAuth scrubber can also sweep them structured).

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

## Theme 7 — keto: electrolytes dominate, and "keto" plans that aren't keto (validates the ceiling)

r/keto's top-of-year is success-story heavy, but the recurring *operational* pain is
unmistakable and it's electrolytes:
- Nearly every high-scoring plan post lists an electrolyte routine — magnesium /
  potassium / sodium, LMNT or a drink mix "for leg cramps," and the keto-flu /
  constipation / dry-mouth / frequent-urination cluster. This is the strongest
  case for the **electrolyte-dashboard gap** the diet-specific agent flagged.
- **"My Keto meal prep subscription plan has more grams than keto allows in just
  one main meal"** — 90 pts, 81 comments. A paid "keto" meal-prep service shipping
  28 g+ carbs per dinner. This is a direct, real-world validation of Cut Protocol's
  **post-scale keto carb-ceiling enforcement** — the exact failure CP is built to
  prevent.
- **"Annoyed w dietician"** — 152 pts, 116 comments: a professional handed a keto
  user a 190 g-carb plan with canned peaches. Generic tools/people don't respect
  the diet; CP hard-filters it.
- Recurring: the manual burden of tracking **net carbs** and "avoiding hidden sugars
  (like in salad dressings) — it takes brain energy," plus references to r/Volumeeating
  (the **satiety / volume** gap).
- Notable safety upside: a user in recovery wrote that after "a lifetime of feeling
  controlled and imprisoned by my disordered eating, I feel freedom and peace with
  food" — structure can *help*, which is the supportive framing CP aims for.

## Theme 8 — budget & the mental load: pantry-first and "depression meals" (validates cost + wellbeing)

r/EatCheapAndHealthy's **top posts of all time** are dominated by two themes Cut
Protocol touches:
- **Use-what-you-have / don't-waste-food** — "dig through the back of your fridge
  before opening newly-purchased food" (10,047 pts), "soup cubes from scraps"
  (10,971 pts), "use all this before it expires." This is the single loudest
  validation of the **pantry-first / leftovers / food-waste gap** — it is what this
  community *is about*, and CP has no inventory model.
- **"Depression meals" / low-effort when you can't cook** — 8,779 pts and 5,002 pts
  posts about needing cheap, no-chop, shortcut meals when executive function is
  gone. This is the mental-load / "just tell me what to eat" pain from a different
  angle, and it reinforces the wellbeing framing (be supportive, not shaming, when
  someone is struggling to feed themselves).

## Theme 9 — communities are actively BANNING AI logging (reinforces deterministic)

- r/intermittentfasting **"New rule: No AI of any kind going forward"** — 2,399 pts,
  202 comments. The mods formally banned AI, explicitly including **"no AI calorie
  tracking apps or fasting timers."** Combined with r/loseit's 2,519-pt "AI photo
  tracking doesn't work," this is a large community *rejecting* AI logging outright —
  strong support for Cut Protocol's deterministic-over-AI stance.
- Recurring **"food noise"** language (IF "helped me loads with food noise") — the
  same preoccupation the wellbeing check targets.
- People give their eating window a **"+/- 30-minute buffer"** and flex it around
  life/cycle — a lesson for any eating-window feature: make it forgiving, not rigid.

## Theme 10 — even Cronometer's users want the solver (and will pay for it)

r/cronometer — the micronutrient tracker's own community — keeps reaching for the
thing Cronometer doesn't do: build a plan.
- **"Example daily diet that hits almost all targets"** — 97 pts, 63 comments: a
  user hand-assembling a day that hits nearly all macro *and* micro targets in a
  1,500-cal deficit. That is precisely Cut Protocol's solver output, done manually.
- **"I figured out how to create a set of daily and weekly plans and STORE them for
  retrieval"** — 45 pts: users hacking a tracker into a meal-planner.
- **"A few Cronometer feature requests I would genuinely pay Gold for"** — 52 pts:
  explicit willingness-to-pay for features. Plus **"Preview how adding a food affects
  today's macro and micronutrient targets"** (a will-this-fit-my-day preview) and
  **"Hypothetical Days"** (plan-ahead). All point at planning/solving, not tracking.

---

### Net
Every load-bearing claim in `SYNTHESIS.md` that we could reach on Reddit held up
against real, highly-upvoted posts: the solver answers "just tell me what to eat,"
adaptive TDEE answers the plateau/"my TDEE was wrong" pain, the MFP exodus is real,
allergen-exclusion is a wished-for feature people try to build themselves, AI photo
logging is distrusted, keto's operational pain is electrolytes + carb-creep (which
CP's ceiling enforcement targets), budget users beg for pantry-first/anti-waste
tooling, and food-preoccupation / "depression meals" are common enough to justify
the wellbeing check. The gaps also held: restaurant filtering, multi-person
households, electrolyte/satiety views, pantry/leftovers, and (from the broader
scrub) fast logging + mobile.

The clearest *new build ideas* this Reddit pass surfaced, by how loudly they came
up: **(1) pantry-first / use-what-you-have / anti-waste** (top-of-all-time energy
in r/EatCheapAndHealthy), **(2) an electrolyte view for keto**, and **(3) making
the 7-day rolling average the headline number** — the last is low-effort, high-value,
and doubles as an anti-anxiety safety win.
