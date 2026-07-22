# Solver benchmark — does Cut Protocol actually never miss silently?

Cut Protocol's rarest claim is not that it plans meals. Competitors do that.
It is that the solver **publishes an honest match % and declares "unsolvable —
and why"**, where the market leader silently ships a plan that misses your
targets. That claim was unproven. This is the attempt to prove it, break it,
and fix what broke.

- **Harness:** `backend/scripts/solverBenchmark.mjs` (`npm run bench:solver`)
- **Gate:** `npm run bench:solver:check` — exits non-zero on any silent miss,
  any unsolvable week shipped without a reason, or any 0 g ingredient
- **Raw output:** [`latest.json`](latest.json) / [`latest.md`](latest.md) ·
  pre-fix comparison: [`before-fixes.json`](before-fixes.json) /
  [`before-fixes.md`](before-fixes.md)
- **Regression tests:** `backend/tests/solverHonesty.test.js` (20 tests) —
  the structural properties below are locked there, not just measured here

---

## ⚠️ Read this before quoting any number

**Every absolute nutritional number in this document is PROVISIONAL.**

The food table is mid-repair. A fuzzy name-match import put roughly **242 of
864 foods' macros on the wrong row**, and ~97% of recipes reference at least
one affected food. A separate workstream is fixing it. Until that lands:

- **Do not quote** match %, kcal deltas, protein shortfalls, "clean week"
  rates, or feasibility rates as facts about the product. They are facts about
  *this snapshot of a knowingly corrupt table*.
- **Do quote** the structural findings. "Does the solver ever miss silently?",
  "does variety collapse by week 3?", "are there degenerate slots?", "does
  portion rounding delete ingredients?" are properties of the solver's
  behaviour. They hold whatever the macro values are, and the regression tests
  that lock them use synthetic fixtures with known-correct macros.

**Re-run after the repair.** The harness is deterministic (seeded RNG) and
records a `macroFingerprint` of the whole food table in its output, so a
re-run is provably against different input.

> Data note: the fingerprint moved *during* this session — the DB went from
> 864 to 867 foods at 21:04–21:09 local, three rows tagged `source: community`
> written by another process. Both runs published here were re-taken
> back-to-back afterwards and share fingerprint `63df8f91539fac08`
> (889 recipes / 867 foods). If `backend/prisma/dev.db` is being written by a
> parallel workstream, benchmark reproducibility depends on knowing that.

---

## What was run

| | |
|---|---|
| grid | 1,260 scenarios = 5 calorie/macro targets × 9 dietary styles × 7 allergy sets × 4 max-prep caps, with meal structure (3+1 / 4+0 / 3+2 / 2+1) rotating across the grid |
| horizon | 4 consecutive weeks per scenario — 5,040 week solves, 35,280 day-results, 141,120 slots |
| path exercised | the real one: `computeMacros` → `filterRecipePool` → `applyPrepFilter` → `generateBestWeekPlan`, exactly as `POST /plans/generate` calls it, plus `generateDayCandidates` for the day-picker surface |
| determinism | seeded mulberry32, `BRAIN=off` — same DB + same seed reproduces byte-identical numbers |
| runtime | ~185 s |

Targets come from the app's own macro engine on synthetic body shapes
(1,500 kcal small female cut → 3,200 kcal large male bulk). Nothing
user-specific is hardcoded.

---

## The headline result

**No silent misses — 0 of 35,280 day-results, before or after.** The solver
was already labelling every rough slot. That part of the claim was real.

But the claim was **not real where it counts**, and the benchmark found four
ways it was quietly false:

| Structural defect found | Before | After |
|---|---|---|
| Weeks that published a **per-day match %** | **0 / 5,040** | **5,040 / 5,040** |
| Weeks short of 7 clean days that shipped **with no reason given** | **300** | **0** |
| Ingredients shipped at **0 g** (deleted from the plate and the shopping list) | **22,803 / 564,618 (4.0%)** | **0** |
| Scenarios that genuinely repeat by week 3 **with no warning up front** | **656 / 1,260** | **1 / 1,260** |

### 1. The match % existed and was shown to nobody

The solver computed an honest score on every generate and threw the useful
half away. `scoreWeek` returned one **average** across seven days, so a week
with one day 18% under target and six perfect days reported "89%, 7 days" —
indistinguishable from a week that was actually fine.

Worse, the average never reached the screen either. The server sent
`meta.score = { daysInTolerance, avgMatch }` (an object) and `PlanTab.jsx`
read `typeof meta.score === "number"`. **The app's single headline honesty
number rendered as nothing, on every generate, forever.**

Fixed: `scoreWeek` now publishes a row per day — match %, kcal delta, protein
shortfall, and a plain-English miss line ("2,050 kcal vs a 2,400 target — 350
under; 128 g protein vs 165 g — 37 g short"). `/generate` forwards
`meta.matchPct` (scalar), `meta.days[]`, and `meta.attempts`; the Plan tab
renders a per-day match strip and spells out every missed day.

### 2. The "unsolvable + why" declaration was a threshold lottery

The diagnosis attached only when a week landed **below 6 of 7** days in
tolerance. A week at exactly 6/7 had a day off target and said nothing about
it — **300 of 5,040 benchmarked weeks**. Fixed: the reason is owed the moment
*any* day misses or *any* slot comes back unfilled.

### 3. Portion rounding was deleting ingredients

`practicalGrams` used bare `Math.round`, so any amount under 0.5 g became 0 g.
**4.0% of every ingredient the solver shipped** — 22,803 of 564,618 — came out
at zero: garlic, saffron, a pinch of yeast, silently gone from the plate *and*
from the grocery list while the recipe card still named them. Fixed with a 1 g
floor for any genuinely present ingredient; a truly absent amount still reads 0.

### 4. Empty snack slots were explained by talking about something else

**Only 9 of 889 recipes are snack-eligible.** After a dietary filter that is
0 for vegan, 0 for vegetarian, 1 for carnivore, 2 for kosher. So snack slots
came back empty — 15,050 of 141,120 slots, 62% of all unfilled slots — and
`diagnose()`, which only ever counted *meal* capacity, answered with a lecture
about protein density. Fixed: snack capacity is computed and stated in its own
words ("Your library has no snack-sized recipe that fits your rules — all 7
snack slots this week come back empty"), with an actionable suggestion that
never mentions loosening an allergy.

---

## Variety: the "repetitive by week 3" failure mode is real, and was total

Weeks were **independent draws**. Nothing remembered what last week served.
On a 613-recipe omnivore pool the solver used 66 distinct dinners across four
weeks and let week 3 come back 25% repeats — while ~90% of the library sat
untouched.

Fixed with a recency-weighted cross-week memory (`buildPriorUsage`, weights
1 / 0.6 / 0.35 over the previous three plans) plumbed through `pickRecipe` as
a **soft** discount, and `/generate` now loads the user's previous plans to
feed it.

Novelty = share of a week's meals never served in any earlier week.

| | week 1 | week 2 | week 3 | week 4 |
|---|---|---|---|---|
| before | 100% | 66.7% | **47.6%** | 33.3% |
| after | 100% | 85.7% | **64.3%** | 38.1% |

### Getting variety without paying for it in accuracy

The first attempt at this was a straight freshness bias, and it **cost
accuracy** — the solver started shipping worse-fitting fresh dishes, and 150
weeks lost their clean 7/7 day count. Backing off to fit-first cost the
opposite: thin-pool variety collapsed (keto week-3 novelty 28.6% → 7.1%).

The shape that keeps both, now in `resolveSlot`:

1. **Pass 1** — search with the freshness discount, evaluate the whole
   shortlist, and among the candidates that **fit**, take the
   least-recently-served one. Freshness is only ever spent on options that
   already hit the target.
2. **Pass 2** — if nothing in pass 1 fit, search again with the discount off,
   so last week's dish comes back rather than a worse-fitting new one.

Clean weeks went **up** (2,619 → 2,669) while week-3 novelty went up 17 points.
Cost: median week solve 3.1 ms → 6.8 ms (p95 26.7 ms, max 56.7 ms). For a
once-a-week desktop action that is free.

### Where variety genuinely cannot hold — and now says so

| diet | pool after diet | wk-3 novelty (before → after) | distinct dinners / 4 weeks | distinct snacks / 4 weeks |
|---|---|---|---|---|
| none | 613 | 75.0% → **90.5%** | 74 | 4 |
| halal | 522 | 71.4% → **91.7%** | 73 | 2 |
| mediterranean | 555 | 71.4% → **90.5%** | 72.5 | 3 |
| kosher | 483 | 69.6% → **90.5%** | 70 | 2 |
| vegetarian | 277 | 38.1% → **61.9%** | 46 | **0** |
| paleo | 172 | 33.3% → **42.9%** | 44 | 4 |
| vegan | 139 | 28.6% → **32.1%** | 33 | **0** |
| keto | 108 | 14.3% → **14.3%** | 26 | 5 |
| carnivore | 3 | 0% → **0%** | 3 | 1 |

Keto and carnivore did not improve, and that is the honest answer rather than a
bug: on a keto pool of 133 compliant recipes only **63** can actually be
portioned into a 530 kcal meal slot inside the 0.5–2× band while still reaching
its protein. Three weeks of distinct dinners is the ceiling; four does not
exist. Carnivore has three recipes, full stop.

So the second half of the fix is a declaration, not an algorithm.
`varietyOutlook()` counts the recipes that can genuinely reach the slot's
calories **and** its protein — raw pool size overstates variety badly — and
says up front when the library cannot carry the horizon:

> *"63 of your 133 compliant recipes can be portioned to a 530 kcal meal —
> about 3 week(s) of 21 meals before dishes start repeating, so over 4 weeks
> you will see favourites come back."*

Scenarios that repeat by week 3 with no warning: **656 → 1**.

---

## What the harness measured (post-fix, PROVISIONAL numbers)

### Feasibility and reasons

| | |
|---|---|
| clean weeks (7/7 days in tolerance) | 2,669 / 5,040 (52.9%) |
| weeks missing ≥1 day | 2,371 (47.1%) — **every one carrying a reason** |
| days outside tolerance | 10,200 / 35,280 (28.9%), of which 247 were *over* target |

Reasons actually given, by frequency:

| reason | times |
|---|---|
| not enough snack recipes — snack slots come back empty | 2,400 |
| pool lacks protein-dense recipes for these targets | 735 |
| not enough meal-eligible recipes for a week | 560 |
| days missed the calorie window (0.5–2× portion bound) | 36 |
| closest-fit shipped; pool leaves little room | 3 |

The distribution is itself a finding: the dominant cause of an imperfect week
is **not the solver**. It is a recipe library with 9 snack recipes and a thin
protein-dense tail. That is a data problem, and the solver's job is to name it.

### Match %

| metric | min | p25 | median | p75 | p95 | max |
|---|---|---|---|---|---|---|
| week average match % | 8 | 83 | 89 | 94 | 97 | 99 |
| days in tolerance / 7 | 0 | 3 | 7 | 7 | 7 | 7 |
| \|kcal delta\| per day % | 0 | 0.3 | 2.5 | 17.3 | 100 | 100 |
| protein shortfall per day % | 0 | 0 | 0.5 | 17.1 | 100 | 100 |
| best day-candidate match % | 45 | 90 | 97 | 99 | 100 | 100 |

The p95 of 100% is the carnivore/empty-pool tail — days where nothing could be
served at all. Those are declared, not hidden.

### Slots

| | |
|---|---|
| slots generated | 141,120 |
| unfilled | 24,286 — **15,050 of them snack slots** |
| carrying a warning | 40,640 |
| **pinned at the 0.5×/2× portion clamp** | **53,839** — 38.2% of all slots, **46.1% of filled ones** |
| ingredients at 0 g | **0** (was 22,803) |

**Nearly half of every filled slot hits the portion clamp.** The 0.5–2× band is
binding on ~46% of served meals, meaning the library's dish sizes are
systematically mismatched to the slot sizes users actually need. Not fixed here
(see below).

### Solve time

| operation | min | median | p95 | max |
|---|---|---|---|---|
| week solve (best of 5 attempts) | 0.1 ms | 6.8 ms | 26.7 ms | 56.7 ms |
| day options (3 scored candidates) | 0.0 ms | 1.0 ms | 3.3 ms | 6.3 ms |

Speed is not a problem and never was.

---

## Changed code

| file | change |
|---|---|
| `backend/src/lib/weeklyPlanner.js` | 1 g floor in `practicalGrams`; `priorUsage` soft discount through `pickRecipe`/`resolveSlot`/`solveDay`/`generateWeekPlan`; two-pass fit-then-freshness resolution; new `buildPriorUsage()` |
| `backend/src/lib/mealSolver.js` | `scoreWeek` publishes per-day rows; new `dayTolerance`/`dayMissLine`; tolerance judged on exact totals, never display-rounded ones; diagnosis fires on any missed day or unfilled slot; snack-capacity reason in `diagnose()`; new `varietyOutlook()` |
| `backend/src/routes/plans.js` | `/generate` loads previous plans for cross-week memory; `meta` gains `matchPct`, `days[]`, `attempts`, `variety` |
| `frontend/src/components/PlanTab.jsx` | reads the match % the server actually sends; renders a per-day match strip, each missed day's miss line, and variety notes |
| `backend/tests/solverHonesty.test.js` | new — 20 tests locking every property above |
| `backend/tests/golden/engine-baseline.golden.json` | regenerated (intentional: additive `score.days` + `attempts`, the new snack reason, and delta percentages now computed from exact totals — every slot, candidate, grocery, trend and diary value is byte-identical) |

One more rounding bug the harness surfaced: `scoreDay` rounds totals for
display, and tolerance was being judged on the **rounded** value — a day
15.009% under target rounded to exactly −15.0% and reported as clean. Rounding
can only ever hide a miss, never invent one, so tolerance now reads the exact
totals. Locked by test.

---

## Deliberately not fixed

- **The 38% portion-clamp rate.** The fix is dish-size diversity in the recipe
  library, not a wider scale band — widening it would let the solver serve half
  a dish or a soup pot and call it a portion. Recorded, not papered over.
- **9 snack recipes / 0 for vegan and vegetarian.** A content gap. The solver
  now declares it precisely; it cannot invent dishes.
- **The carnivore pool of 3 recipes.** Same.
- **1 remaining scenario** (of 1,260) that repeats by week 3 without an
  up-front warning. `varietyOutlook`'s reachability test is a necessary
  condition, not a sufficient one — it cannot know that the solver gets five
  attempts per slot. Left honest rather than tuned with a fudge factor.
- **`alternatesForSlot`'s match %** uses a 60/40 kcal/protein weighting while
  `scoreDay` uses 55/30/7.5/7.5. Two different questions (slot fit vs day fit),
  but two numbers both labelled "% fit" is a UI trap worth revisiting.
- **Anything in the food-import pipeline, micronutrients, or TDEE** — out of
  lane, and the food repair is another workstream's.
