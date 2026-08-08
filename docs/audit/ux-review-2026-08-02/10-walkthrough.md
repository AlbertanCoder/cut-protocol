# 10 — The whole app as a week in the life (task completion, click counts, dead ends)

> **State I changed (for the other reviewers):** completing T4 required a real swap, so
> Sunday's third meal went from *Thai Chicken & Bell Peppers with Rice* → *Thai Tofu &
> Broccoli with Noodles* (Sunday's day total moved 2,081 → 2,150 kcal). I locked it to verify
> the lock, then unlocked it again. Nothing else was written. I did **not** save the T9 rate
> change, did not log a weigh-in, and did not save a diary entry.

## Verdict

The individual screens are better than the seams between them. Every task I attempted
completed, most in 1–3 clicks, and two flows (swap-and-lock a meal, trace the target in
Engine) are genuinely excellent. But the app tells you the **same statistic twice with two
different numbers** — Today says your 7-day average is 208 lb, Trend says 206.5 lb — and
that single split then produces two different goal dates on two different screens. The worst
of it is concentrated in three places: the duplicated calorie story on Today (planned vs.
eaten, each with its own ring, its own macro rails, and its own 40-word explainer), the
Today→Engine seam (the number 2,058 appears five times on Today and links to Engine zero
times), and the two-week absence the app never names.

## What's already working

- **Engine answers "why 2,058" completely and in order.** BMR 1,999 (mean of 5 of 10
  formulas, each with its citation) → ×1.2 desk work → +159 training = TDEE 2,558 → −500
  for 1 lb/wk = 2,058, floor 1,899. Four labelled steps. Do not touch this screen.
- **Swap-and-lock is a 3-click task and the lock is real.** Swap icon → "Use" → padlock.
  The alternates panel shows each option's kcal, protein and "% fit" before you commit, and
  `backend/src/lib/weeklyPlanner.js:874-891` makes locked slots a *constraint of the solve*,
  not a post-hoc restore. Tooltip copy is exactly right: "Locked — survives a regenerate."
- **"Ate as planned" is genuinely one click and is idempotent** — `backend/src/routes/diary.js:376`
  documents that re-logging replaces prior planned rows and leaves manual rows alone. A
  double-click can't corrupt the day.
- **The food search is fast and honest.** "burrito" → 48 matches in under a second, each row
  showing per-100 g macros *and* provenance (USDA) *before* you pick.
- **The grocery list is store-ready without extra work** — grouped by aisle
  (PANTRY / DRY GOODS), grams as ground truth plus practical purchase units ("1 block —
  Peanut Butter, 17 g · ≈454 g each"), per-item cost, persisted checkboxes, and Copy /
  Text / Email.
- **The honesty layer is not decorative.** Trend volunteers "That average covers 1 weigh-in
  in the last 7 days — it is a short window, not a smooth one." Plan volunteers "This
  verdict is out of date." Engine volunteers exactly which three thresholds adaptive
  targeting is still short of. This is the app's best quality and every finding below
  assumes it stays.

---

## The ten tasks, as run

| # | Task | Result | Clicks |
|---|---|---|---|
| T1 | 30-second test | Pass, with three ambiguities | 0 |
| T2 | "What am I eating today?" | Pass — but not from Today | 1 + 2 scrolls |
| T3 | Daily loop (weigh in + ate as planned) | Pass | 3 clicks, 2 cards |
| T4 | Replace a meal, keep it through regenerate | **Pass** | 3 |
| T5 | "I ate a chicken burrito" | Completes, but not lightweight | 2 clicks + 2 typed values |
| T6 | "Am I on track?" | **Two screens contradict** | 2 screens |
| T7 | "Why is my target 2,058?" | Answer is superb; **path is invisible** | 1 (if you know) |
| T8 | Groceries | Pass | 1 + scroll |
| T9 | Cut slower (0.5 lb/wk) | Found it; **no preview, click = commit** | 1 + scroll |
| T10 | Back from vacation | **Not acknowledged anywhere** | — |

### T1 — the 30-second test (0 clicks)

What I thought it wanted me to do: log today's weight, and confirm I ate the plan. That
reading turned out to be right, so the front door works.

The three most prominent numbers, and whether I knew what they meant:

1. **2,081** — biggest thing on screen, 156px ring, labelled "planned kcal". I did *not*
   know what this was for ~10 seconds. It is neither what I ate nor what I should eat; it is
   what the meal plan happens to add up to. The number I actually needed (2,040 eaten) was
   below the fold in one-third the type size.
2. **208 lb** — "7-day avg". Clear. (Also wrong; see T6.)
3. **2,058 kcal** — "Target". Clear, and printed **five times on one screen**: the header
   bar, the page subtitle, the Planned-vs-target row, the Verdict card's Stat tile, and the
   diary's "/ 2,058 kcal".

Not clear in 30 seconds: (a) that the ring was the *plan*, not me; (b) why **Rate** was an
em-dash while the card beside it happily showed a 7-day average — nothing on the tile
explains that the two have different data requirements; (c) what "Day 15 of protocol" is
counting *toward* — there is no end date on the screen.

### T2 — "What am I eating today?" (1 click + 2 scroll gestures)

**Today never names a single meal.** The "Planned vs. target" card shows the ring, Target,
Planned today, "Meals + snacks: 4", and three macro bars — no dish names. The only reason I
could see "Bistek / Arroz con gambas y calamar / Thai Chicken…" was that the diary had
already been filled in with "Ate as planned"; on an unlogged morning that card is empty and
Today names no food at all. Confirmed in source: `TodayTab.jsx:907-929` renders Ring + three
rows + `MacroRails`, and nothing else.

So the answer lives on Plan: 1 click, then scroll past **two full configuration cards**
("How much to generate" — 7 options; "Steer the meal planner" — 8 cuisine pills, 3
dropdowns, a checkbox, 3 optional caps and Protein-priority mode) before the week board
appears. On a 1568px window that is roughly 1.5 screens of settings before one line of food.
The day chips themselves truncate at ~14 characters ("Classic Chick…", "Fiesta Chicke…").

### T3 — the daily loop (3 clicks + one typed number, across two cards)

Weigh-in: click the weight field → type "206.5" → click **Log** (or Enter). Date is
pre-filled with today — good. Then scroll down to a *different card* and click **Ate as
planned**. The two halves of the most frequent action in the app sit in the top-right
column and the next full-width row down, roughly 500px apart.

**Could it be one action? Yes.** These are the only two things a compliant day requires, and
they are never done separately. One strip — `[ 206.5 lb ] [ ✓ Ate as planned ] [ Save ]` —
would make the daily loop one visual object and one save.

One thing that is *not* a toggle: Shad asked for an "ate as planned" **toggle**. What
shipped is a button that never changes state. After clicking it, it still reads "Ate as
planned" — the only evidence it worked is that a list appears below it. There is no way to
un-say it except deleting four rows one at a time.

### T4 — "I don't want that" (3 clicks) — the cleanest flow in the app

Path: hover/click the circular-arrows icon on **Thai Chicken & Bell Peppers with Rice** →
panel opens with three alternates (Thai Tofu & Broccoli with Noodles, 688 kcal · 64.7P ·
99% fit; Tom kha gai, 674 · 64.2P · 99% fit; Thai Tofu & Bell Peppers with Rice, 713 ·
65.7P · 97% fit) → click **Use** → click the padlock. Done. Verified the lock took (the
swap button disappears from a locked row, matching the already-locked Bistek), and verified
in code that locked slots survive a regenerate as a solver constraint.

Two hesitations, both real:

- The three per-row controls are **unlabelled 14px glyphs**: a shopping cart, a padlock, and
  a **circular-arrows/refresh** glyph. "Refresh" is the near-universal symbol for *redo this
  thing*, not *show me three alternatives*. The correct sentence — "Swap — show 3 other
  options" — exists only as a `title` tooltip (`PlanTab.jsx:793`).
- After the swap the day went from 2,081 to **2,150 kcal against a 2,058 target**, and the
  Plan screen said nothing. The day-total line is plain grey text: "Day total: 2,150 kcal ·
  214P / 91.4F / 128.1C vs 2,058 target". The identical fact (23 over) had been rendered in
  amber with a supportive sentence on Today. **Same overage, flagged on one screen and
  silent on the other** — and the "99% fit" label on the option I chose is per-slot fit, so
  it reads like an endorsement of a change that made the day worse.

### T5 — "I ate a chicken burrito, not the planned meal" (2 clicks + 2 typed values)

Path: **Add item** → type "burrito" → 48 matches, top row "Burrito, NFS — 219 kcal · 11.1P
23.9C 8.5F / 100 g · USDA" → arrow/click to pick → **type a weight in grams** → Save.

The machinery is good. **The answer does not match what he asked for.** The unit of entry is
grams. Nobody weighs a burrito. There is no serving / piece / "1 burrito" option anywhere in
`PortionRow` (`TodayTab.jsx:315-374`) — grams is the only input, defaulted to 100, validated
1–5,000. The escape hatch, "Not in the library", asks you to type kcal + P + C + F by hand,
which is worse.

This is the second complete logging system in the app. Shad asked for a lightweight
"ate as planned" toggle *instead of* food-by-food logging; what shipped is the toggle **plus**
~300 lines of gram-level food-by-food diary (`FoodPicker` + `PortionRow` + manual entry)
occupying the largest card on his home screen.

### T6 — "Am I on track?" — **the two screens contradict each other**

Cold start, 2 screens. And they disagree:

| | Today (Verdict card) | Trend (Numbers card) |
|---|---|---|
| 7-day average | **208 lb** | **206.5 lb** |
| Rate | — lb/wk | — lb/wk |
| Goal date | (not shown) | Dec 29, 2026 |

And a third screen makes it three-way: **Profile → Rate of loss** shows "Goal date, if the
plan holds: **Jan 9, 2027**" — eleven days later than Trend's Dec 29, 2026, for the same
chosen 1 lb/wk and the same 185.2 lb goal.

The cause is one line. `backend/src/routes/weighins.js:50`:

```js
const last7 = entries.slice(-7);
```

That is the last seven **entries**, not the last seven **days**. With the July gap those
seven entries span Jul 13 → Aug 2 — twenty calendar days — so Today's "7-day avg" is 208.
TrendTab computes a real trailing-7-calendar-day window and gets 206.5, and it even
*disclaims the other method in its own copy*: "The heavy line is the average of the last 7
calendar days at each point — not the last 7 weigh-ins." Trend knows the wrong method
exists; Today ships it under the identical label. The 1.5 lb gap is then divided into the
remaining distance to goal, which is exactly why the two goal dates are eleven days apart.

### T7 — "Why is my target 2,058?" — perfect answer, invisible path

The Engine screen is the best thing in this app (see What's Working). The problem is getting
there.

**There is no path from Today to Engine.** The target is printed five times on Today and not
one of them is a link, a button, or even a hint that a derivation exists. In `App.jsx:335`,
TodayTab is handed `openTrend` and `openWellbeing` — and no `openEngine`. The closest thing
to a pointer is the Verdict card's sentence, which sends you to **Profile** ("the fix for a
wrong pace lives on the Profile tab"), not Engine.

I only found it because "Engine" was visible in the sidebar and I already knew from the
brief that it was the math tab. A user who didn't would conclude the number is unexplained.

### T8 — Groceries (1 click + scroll) — pass

Plan → scroll to the right-hand column. The list is already built, grouped by store section,
with grams, purchase units, prices and checkboxes, plus **Copy / Text / Email**. Copy alone
satisfies "a form you could take to a store."

One collision: the list's primary green button reads **"Regenerate from this week"**, and
the plan's own generate button at the top of the same screen reads **"Regenerate 1 week"**
(`PlanTab.jsx:1244` and `:1454`). Two buttons on one screen, both starting with
"Regenerate", meaning completely different things — and the *grocery* one is the green
primary, which under the design's own colour law is the strongest call to action on the page.

### T9 — "Cut slower, 0.5 lb/wk instead of 1" — found it, did not save

Found in **under 30 seconds**: Profile → scroll past Body / Activity / Diet to the "Rate of
loss" card. Seven pills, 0.25 → 2 lb/wk, current selection (1 lb/wk) shown as a lightness
step. Discoverability is fine.

**Consequences are not previewed — the pill IS the commit.** `ProfileTab.jsx:852`:

```jsx
<button key={r} onClick={() => commit({ rateLbPerWeek: r })} aria-pressed={active}>
```

There is no Save button, no confirm, no diff. The two panels that show what changed — "Daily
target 2,058 kcal · TDEE 2,558 − 500 deficit" and "Goal date, if the plan holds: Jan 9,
2027" — sit directly below the pills and update *after* the write lands. Everything needed
for a preview is already on screen and rendered one beat too late. I stopped at the control
as instructed and did not click.

### T10 — Back from vacation (last weigh-in Jul 19, today Aug 2) — **not acknowledged**

Nothing in the app says "you were away for two weeks." What it does instead:

- **Recent entries** prints `Aug 2 · 206.5 lb` directly above `Jul 19 · 207.7 lb`, adjacent
  rows, no separator, no gap marker.
- The **Trend snapshot** chart draws a straight line from Jul 18 to Aug 2 across a
  fourteen-day hole, indistinguishable from fourteen days of steady loss.
- The **Verdict** card says "Not enough weigh-ins yet — a pace needs at least 8 weigh-ins
  inside the last 14 days." True, honest, and reads exactly like a *new user* message. It
  never says the reason is a gap.
- Worst: **Engine's weekly adjustment log shows the data going backwards** and doesn't say
  why —

  | Week of | What the engine did |
  |---|---|
  | Aug 2 | Used the formula — only **1 day** of overlapping weight + intake data — needs 21 |
  | Jul 26 | Used the formula — only **17 days** of overlapping weight + intake data — needs 21 |
  | Jul 19 | Used the formula — only **10 days** of overlapping weight + intake data — needs 21 |

  10 → 17 → **1**. To anyone reading it, the app lost two and a half weeks of their data.
  The real reason (a trailing window that emptied out) is never stated.

**What it should do:** one calm sentence on Today, driven off the same "days since your last
weigh-in" figure Engine already computes and displays: *"14 days since your last weigh-in.
Your 7-day average and pace start over from today — the older points stay on the chart."*
Plus a visible break in the Recent-entries list and a dashed segment on the chart where
there is no data. All three read off numbers the app already has.

---

## Findings

### F1. Make Today and Trend compute "7-day average" the same way

- **Saw:** Today's Verdict card: "7-day avg **208** lb". Trend's Numbers card: "Average,
  last 7 days **206.5** lb". Same label, same day, 1.5 lb apart. Cause is
  `backend/src/routes/weighins.js:50` — `entries.slice(-7)` takes the last seven *entries*
  (Jul 13 → Aug 2, twenty calendar days), while TrendTab uses a true calendar window and
  says so out loud in its own caption.
- **Costs:** The app's own honesty guarantee breaks. Two screens, one statistic, two answers,
  and the user has no way to know which is right. It also propagates: Trend projects the goal
  at **Dec 29, 2026** and Profile at **Jan 9, 2027**, eleven days apart, purely because they
  divide by different "current" weights.
- **Do:** Change `weighins.js:50` to a trailing-7-calendar-day filter, matching TrendTab. One
  line, and it fixes the goal-date split for free. If the entry-based number is deliberately
  kept for stability, it must not be labelled "7-day avg" on any screen.
- **Size:** trivial · **Confidence:** high

### F2. Merge Today's two calorie stories into one

- **Saw:** Today renders the planned day and the eaten day as two separate full blocks, each
  with its own hero number, its own three `MacroRail`s, its own over-target sentence, and its
  own identical 40-word explainer ("Calories and protein are the walls. Fat has a minimum to
  clear; carbs take whatever calories are left, so they move the most." — printed **twice**
  on one screen, `TodayTab.jsx:927` and `:606`). The 156px hero ring is the *planned* number
  (2,081), the least actionable of the two; the number that matters (2,040 eaten) is below
  the fold at one-third the size.
- **Costs:** The front door's biggest number answers a question he didn't ask. Two macro
  triads on one screen means he has to work out which set of bars is "him". This is the
  literal shape of "too much jargon / busy at the front door".
- **Do:** One ring showing **eaten**, with the planned total as a tick mark or ghost arc on
  the same ring. One set of macro rails (eaten vs. target). One explainer sentence, once.
  Fold "Meals + snacks: 4" and the dish names into the diary card's header so Today finally
  names today's food (fixes T2 at the same time). `TodayTab.jsx`.
- **Size:** medium · **Confidence:** high

### F3. Give Today a route to Engine

- **Saw:** "2,058" appears five times on Today (header bar, page subtitle, Planned-vs-target
  row, Verdict Stat, diary denominator) and is a link zero times. `App.jsx:335` passes
  TodayTab `openTrend` and `openWellbeing` but no `openEngine`. The Verdict card's only
  pointer sends you to Profile.
- **Costs:** The single best screen in the app — the one that fully answers "why this
  number" in four labelled steps — is reachable only by already knowing it exists.
- **Do:** Make the Verdict card's "Target" Stat a button that opens Engine, with the sub-label
  "2,558 burn − 500". Pass `openEngine` from `App.jsx:335`. One prop, one click target.
- **Size:** trivial · **Confidence:** high

### F4. Name the gap when someone comes back

- **Saw:** Full detail in T10 above — adjacent `Aug 2` / `Jul 19` rows, an unbroken chart
  line across fourteen empty days, a Verdict that reads like a new-user message, and an
  Engine log showing 10 → 17 → **1** days of data with no stated reason.
- **Costs:** A returning user's most likely conclusion is that the app lost their data. The
  second most likely is that nothing happened. Neither is true, and the app knows the truth —
  Engine already displays "Days since your last weigh-in".
- **Do:** One `role="status"` line on Today when days-since-last-weigh-in > 3, using the
  existing figure. Break the sparkline where there is no data. Add the reason to the Engine
  adjustment-log row ("window empty — 14 days without a weigh-in").
- **Size:** small · **Confidence:** high

### F5. Collapse the Plan tab's configuration wall by default

- **Saw:** Plan opens on "How much to generate" (7 buttons + Custom) and "Steer the meal
  planner" (8 cuisine pills, 3 dropdowns, a batch-cooking checkbox, 3 optional caps with
  their own sliders and explainer paragraphs, and Protein-priority mode with a journal
  citation). At 1568px the week board starts roughly 1.5 screens down.
- **Costs:** The answer to "what am I eating today?" — 1 click away — is behind a page and a
  half of settings that are set once and then never touched. Every visit pays for a decision
  already made.
- **Do:** Ship both cards collapsed behind one summary row: `1 week · any cuisine · any
  protein · no caps  [Change]`. Board first, knobs second. `PlanTab.jsx:102` and `:240`.
- **Size:** small · **Confidence:** high

### F6. Rename the grocery "Regenerate from this week" button

- **Saw:** Plan shows "Regenerate 1 week" (rebuilds the meal plan, `PlanTab.jsx:1244`) and
  "Regenerate from this week" (rebuilds the shopping list, `:1454`) on the same screen. The
  grocery one is the green primary.
- **Costs:** Two same-word buttons, opposite blast radii — one is harmless, the other
  replaces every unlocked meal in the week. The dangerous one is the quieter one.
- **Do:** Grocery button becomes **"Rebuild list"** / **"Build list"**. `PlanTab.jsx:1454`.
- **Size:** trivial · **Confidence:** high

### F7. Merge the weigh-in and "ate as planned" into one daily strip

- **Saw:** The two halves of the daily loop live in separate cards ~500px apart — Weigh-in in
  the top-right 3-column card, "Ate as planned" in the next full-width row (`TodayTab.jsx:948`
  and `:507`). Three clicks and one typed number, in two places.
- **Costs:** The most frequent action in the app is two errands instead of one.
- **Do:** One "Today's check-in" strip at the top of Today: weight field, ate-as-planned
  control, one Save. Also make "Ate as planned" show a *state* — Shad asked for a toggle and
  got a fire-and-forget button that looks identical before and after.
- **Size:** medium · **Confidence:** high

### F8. Let the food picker take servings, not only grams

- **Saw:** `TodayTab.jsx:336-351` — the only portion input is grams (default 100, range
  1–5,000). Logging a burrito requires estimating its mass.
- **Costs:** The stated goal was lightweight logging. Every off-plan item costs a search, a
  pick, a *guessed weight in grams*, and a save. In practice this is the step where a real
  user stops logging.
- **Do:** Add a unit selector beside the grams box — `g / serving / piece` — defaulting to
  the food's own serving weight where the library has one. If that data isn't there, say so
  and keep grams; don't fake it.
- **Size:** medium · **Confidence:** medium (I did not check how many of the 14,122 foods
  carry a serving weight)

### F9. Flag an over-target day on Plan the way Today already does

- **Saw:** After my swap, Plan's day total read "Day total: **2,150** kcal · … vs **2,058**
  target" in plain faint text with no warning. The same 92-kcal overage on Today renders as
  an amber sentence with supportive copy. The alternate I picked was labelled "99% fit",
  which is *slot* fit, and reads as endorsement.
- **Costs:** You can walk a whole week over target from the Plan screen and never see a
  signal, then be told about it one day at a time on Today.
- **Do:** Reuse Today's amber over-target treatment on the Plan day-total line, and label the
  alternates' percentage "99% fit for this meal" so it isn't read as a day-level verdict.
- **Size:** small · **Confidence:** high

### F10. Label the meal-row icons, or at least stop using the refresh glyph for "swap"

- **Saw:** Three unlabelled 14px glyphs per meal row: cart, padlock, circular arrows. The
  correct sentence ("Swap — show 3 other options") exists only in a `title` tooltip,
  `PlanTab.jsx:793`.
- **Costs:** "I don't want that" is one of the two things he'll do on this screen, and its
  control looks like Refresh.
- **Do:** Swap `RefreshCw` for `Shuffle` or `ArrowLeftRight`, or put a text "Swap" button on
  the expanded row. Note the icons *are* visible at rest in Chrome despite the `row-reveal`
  `opacity: 0` rule (`index.css:224`) — worth confirming that's intentional, but it is not
  currently hurting anything.
- **Size:** trivial · **Confidence:** high

### F11. (Seam, not screen) "Ate as planned" feeds the target engine as if it were measured

- **Saw:** `backend/src/routes/diary.js:380-389`, the code's own warning: rows written by
  log-planned are read by `lib/adaptiveTarget.js:loadHistory()` with **no source filter**, so
  "on a day logged this way intake equals target by construction, the estimator's partial-log
  detector can never fire, and confidenceBlock() still tells the user 'Measured from your own
  logged intake.'"
- **Costs:** The one-click daily loop I'm recommending he use *more* is the thing that will
  eventually make Engine's adaptive burn claim measurement it doesn't have. Engine currently
  reads "Days of food logged: 1 of 1" — that 1 is a copy of the plan.
- **Do:** Weight `source:"planned"` rows as weaker evidence on the read side, or exclude them,
  and adjust the confidence sentence. Flagged here because it crosses the Today/Engine seam;
  the Engine reviewer should own the fix.
- **Size:** small · **Confidence:** high (the code documents it)

---

## The two things only a whole-app reviewer can say

### The single worst moment

**Reading "7-day avg 208 lb" on Today, then "Average, last 7 days 206.5 lb" on Trend, ten
seconds apart.** Not because 1.5 lb matters — because this app's entire pitch, and the thing
that makes it worth using over MyFitnessPal, is that it never lies to you about a number.
Every other screen goes out of its way to disclose its own weakness. Then two of them state
the same statistic, under the same label, on the same day, and disagree. Once you've seen it
you have to re-audit everything, and the eleven-day gap between Trend's Dec 29 goal date and
Profile's Jan 9 one confirms it wasn't a one-off.

**Smallest change that fixes it:** one line — `backend/src/routes/weighins.js:50`,
`entries.slice(-7)` → a trailing-7-calendar-day filter. Today and Trend agree, and both goal
dates collapse onto the same number as a side effect.

### The one thing I would delete

**The planned-calorie hero on Today — the 156px ring, its macro rails, its over-target
sentence, and its explainer paragraph.**

It is the biggest object on the screen he lives in, and it answers a question he isn't
asking at 7am. "What does my plan add up to" is a Plan-tab question, and Plan answers it
better (day chips with per-day totals, a board, the swap controls right there). Today should
answer one thing: *how am I doing today* — which is eaten vs. target, the number currently
sitting below the fold in small type.

Deleting it takes the whole duplicate structure with it: two rings become one, six macro
bars become three, two "Over by X" sentences become one, and the forty-word "Calories and
protein are the walls…" explainer stops appearing twice on one page. Today loses roughly
400px of height and gains a clear answer. The one genuinely useful thing in that card —
today's dish names and count — moves into the diary header, which is where it belongs and
where it also fixes T2.

Runner-up, for completeness: the gram-only food picker (F8/F5). It is more code than the
planned card and less used, but it can't simply be deleted — there has to be *some* way to
record an off-plan day. The planned ring has no such excuse: everything it shows exists
elsewhere.

---

## Cut list

- **The "Micronutrients — MOVED" card on Today** (`TodayTab.jsx:985-998`). A full-width
  12-column card on the home screen whose entire content is a sentence saying the feature is
  somewhere else. It has been in that seat long enough; the Wellbeing nav item is right there.
- **The second copy of "Calories and protein are the walls…"** (`TodayTab.jsx:139-142`,
  rendered at both `:606` and `:927`). Forty words of explainer printed twice on one screen.
- **The `Rate` stat tile on Today's Verdict card** when it has no value. It currently renders
  a lone em-dash beside a large "— lb/wk" unit, which reads as broken. Either show the reason
  in that tile's place or drop the tile until there's a rate.
- **The duplicated "Day 15" and "Target 2,058 kcal"** in the header bar — the page subtitle
  directly underneath says both again, ten pixels lower.

## Open questions for Shad

1. **Is the planned-vs-eaten split on Today deliberate?** F2 recommends collapsing it into
   one ring. If you specifically want to see plan-vs-reality side by side each morning,
   say so and I'd instead shrink the planned block to a single line rather than delete it.
2. **Which "7-day average" do you actually want** — last 7 calendar days (Trend's, jumpy
   after a gap) or last 7 weigh-ins (Today's, smooth but silently stale)? Either is
   defensible; shipping both under one label is not. My vote is calendar days, because it's
   the one that tells the truth after a break.
3. **How many of the 14,122 foods carry a serving weight?** F8's unit selector is only worth
   building if the data is there for most of them.
4. **Should the rate pills commit on click?** Everything else in the app commits optimistically
   and that's fine, but this one moves your target, your macros and your goal date at once.
   A one-line preview ("→ 2,308 kcal, goal Mar 2027") before the write would cost one hover.
