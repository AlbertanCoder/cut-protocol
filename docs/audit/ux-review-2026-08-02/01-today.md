# 01 — the Today tab

Reviewed live at 1477×812 on `http://localhost:5173/` (design-qa@local, Day 15, target 2,040 kcal,
4 planned meals, diary already logged from plan) plus `frontend/src/components/TodayTab.jsx` (1,076 lines),
`ui/Parts.jsx`, `ui/HeaderBar.jsx`, `BrainChat.jsx`, `backend/src/routes/diary.js`, `routes/weighins.js`.

**`AdaptiveTdeeCard.jsx` does NOT render here.** Its only caller is `EngineTab.jsx:302`. Out of scope.

## Verdict

Today isn't jargon-heavy so much as **duplicated**. The same three facts — target calories, the macro
triad, and the "which macro is a wall vs a floor" explainer — are each rendered two to five times on one
screen, and the screen's biggest number (the 156px ring) is the one number he has the least use for.
The worst of it is the top row: of the three cards above the fold, the hero ring shows *planned* calories
(not eaten), the Verdict card's three stat tiles are two-thirds redundant with the sentence directly
above them, and both that card and the Weigh-in card carry 210–260px of empty space each because
`items-stretch` pins them to the ring card's height. The card that *should* be the hero — "what have I
eaten against target" — is buried below the fold at a third the type size.

Second-worst: the card labelled **"Planned vs. target" never names a single planned meal.** It tells him
there are "4" of them and asks him to open another tab to find out which.

## What's already working — don't touch this

- **The one-click logging path is genuinely lightweight.** "Ate as planned" is one click, and the backend
  (`diary.js:390-431`) is properly idempotent — a double-click replaces the planned rows rather than
  duplicating them, and leaves hand-logged rows alone. This is exactly the model he asked for.
- **"Add item" is one click to a focused search box** (`TodayTab.jsx:510, 523-527`, `autoFocus`), then
  type → arrow → Enter → grams → Enter. The 100g default arrives pre-selected (`:347`) so the next
  keystroke replaces it. That's a well-built keyboard path; leave it alone.
- **The optimistic delete with rollback** (`:490-500`) is, per its own comment, the only undo in the app.
  Keep it.
- **The verdict *sentences* are excellent.** `bmrEngine.js:597-621` — every tone carries a plain-English
  reason and names the tab where the fix lives ("Profile is where you slow it down"). No jargon, no
  moralising. This is the voice the rest of Today should be written in.
- **The floor-vs-range rail model is correct and hard-won.** The long comment at `TodayTab.jsx:74-88`
  documents a real bug it fixed (fat rendering as "117/65g, 180%" on a plan the solver scored as good).
  Don't revert the model — my findings below are about presentation, not the math.
- **Colour discipline holds.** Over-target goes amber, never red (`:110`, `:589`, `:918`); macro triad is
  P-blue / C-amber / F-pink everywhere with letter badges. No violations found on this screen.

## Findings

### F1. Show today's meals in the "Planned vs. target" card, and stop showing "Meals + snacks: 4"

- **Saw:** The card titled "Planned vs. target" renders a ring plus exactly three rows: `Target 2,040 kcal`
  / `Planned today 2,081 kcal` / `Meals + snacks 4` (`TodayTab.jsx:909-915`). No food is named. The only
  place a meal name appears on Today is the *diary*, i.e. **after** he's already eaten and logged. On
  screen the four names (Bistek, Arroz con gambas y calamar, Thai Chicken & Bell Peppers with Rice,
  Cottage Cheese with Pineapple) exist in the diary rows below and nowhere else.
- **Costs:** The daily question "what am I eating today?" cannot be answered on the screen he lives in.
  It's one nav click to Plan, then he has to find today's column — but the point is that Today, the
  default surface, doesn't do the thing its own card title implies. Meanwhile "Meals + snacks: 4" answers
  a question no one asks.
- **Do:** In `TodayTab.jsx:911-915`, replace the three-row summary block with the four slot names + their
  kcal (they're already in `todaySlots`, `:829`). Keep `Target` on one line if you want; delete
  `Planned today` (it's the ring's own number, printed twice, 40px apart) and delete `Meals + snacks`
  (the row count is the list length, now visible).
- **Size:** small
- **Confidence:** high

### F2. Make "eaten" the hero and demote "planned" — the ring is on the wrong number

- **Saw:** The 156px ring (`:910`) shows `2,081 / planned kcal` at `text-4xl`. "Eaten today 2,040 / 2,040 kcal"
  renders as plain `text-3xl` text with no ring, ~700px further down and below the fold at 812px
  (`:588-592`). So the largest, greenest, most glanceable object on the screen is a number the app
  computed for him, and the number he's actually accountable for is smaller and further away.
- **Costs:** The one-glance question — "how much room do I have left today?" — requires a scroll, and
  when he gets there the answer is in body type. Two kcal heroes on one screen also means he has to
  read a label to know which is which.
- **Do:** Move the `Ring` into the diary card driven by `totals.kcal / macros.kcal`, and reduce the plan
  card to a line of text (see F1). If both must stay, at minimum swap the type sizes.
- **Size:** medium
- **Confidence:** high

### F3. Delete one of the two macro triads — they're rendered twice, verbatim explainer included

- **Saw:** `MacroRails` is called twice on Today: `:927` (planned) and `:606` (eaten). Both render three
  rails **and** the identical 25-word sentence "Calories and protein are the walls. Fat has a minimum to
  clear; carbs take whatever calories are left, so they move the most." (`:139-142`). Confirmed on
  screen: `Protein 199 / 185–203g` in the plan card and `Protein 194 / 185–203g` in the diary, with the
  same paragraph under each.
- **Costs:** Six macro rails and the same paragraph twice on the screen he opens every morning. On any
  day he presses "Ate as planned" — the workflow he asked for — the two triads are the same numbers.
- **Do:** One triad, in the diary card, showing what he ate. If the plan's triad has value it's as a
  faint ghost marker on the same rails, not a second set. Also move the explainer sentence out of
  `MacroRails` and render it once (or move it to the Engine tab, where the math lives by design).
- **Size:** medium
- **Confidence:** high

### F4. Delete the Micronutrients "MOVED" tombstone card

- **Saw:** `TodayTab.jsx:985-998`. A full-width (`xl:col-span-12`) card, measured ~90px tall on screen,
  whose entire content is one sentence — "Today's vitamin and mineral breakdown moved to the **Wellbeing**
  tab" — and an "Open Wellbeing →" link. It sits between the diary and the trend chart.
- **Costs:** A full row of the primary screen, permanently, to point at a nav item that is **already
  permanently visible in the sidebar 300px to the left** (confirmed: "Wellbeing" sits between Trend and
  Engine in the nav). It also earns the section eyebrow "MOVED", which is a changelog note rendered as
  UI. It is a redirect sign nailed to the floor next to the door.
- **Do:** Delete lines 979-998 outright. The `openWellbeing` prop from `App.jsx:335` then has no consumer
  and can go too.
- **Size:** trivial
- **Confidence:** high — the only argument for it is "a card that vanishes reads as a bug", which is true
  for a week, not forever. `git log -S"moved to the" -- frontend/src/components/TodayTab.jsx` dates it to
  **2026-07-24 — 9 days ago**. It has done its job; it should now expire.

### F5. Cut the Verdict card's stat tiles from three to one

- **Saw:** `:935-939` renders `7-day avg` / `Rate` / `Target`. Directly above them, the verdict sentence
  already states the rate ("`{rate}` lb/wk against your `{chosen}` lb/wk plan", `bmrEngine.js:607-621`),
  and `Target 2,040 kcal` appears **five times** on this one screen:
  `HeaderBar.jsx:27`, `TodayTab.jsx:847` (PageHead sub), `:912` (plan card row), `:938` (this tile),
  `:591` (diary denominator). Only `7-day avg` is unique to this card.
- **Costs:** Three stat tiles where one carries information. `Target` is the single most-repeated string
  on the screen — and it's pinned in the sticky header, so it's visible no matter where he scrolls.
- **Do:** Keep `7-day avg`. Delete `Rate` (it's in the sentence) and `Target` (it's in the header). Then
  also delete the band explainer at `:940-944` — "Your band: 0.8–1.2 lb/wk… the fix for a wrong pace
  lives on the Profile tab" restates the band and the Profile pointer that the verdict `sub` already
  contains.
- **Size:** trivial
- **Confidence:** high

### F6. Give the over-target warning a tolerance — 41 kcal (2%) currently triggers a three-line scolding

- **Saw:** `:917` fires the amber block on `kcalPct > 1`, i.e. **one calorie** over. Live on screen right
  now: planned 2,081 vs target 2,040, and the card prints three wrapped lines of amber — "Over by 41 —
  swap a slot on the Plan tab if you want it closer. Nothing to undo: as your weigh-ins build up, the
  engine re-reads your real burn and moves the target itself." The diary has the same trigger (`:502`)
  and a near-identical paragraph (`:600-603`) whose second sentence is word-for-word the same.
- **Costs:** The app generated that 2,081 kcal plan itself, scored it as good, and then warns him about
  it. 2% is inside the solver's own kcal weighting. He sees an amber alarm most days for a number he
  didn't choose — which is exactly how a warning stops being read.
- **Do:** Threshold it (e.g. `> macros.kcal * 1.03`, or an absolute 75 kcal). And write the shared second
  sentence once instead of twice — better, drop it from the plan card entirely, since "nothing to undo"
  is meaningless about a plan he hasn't eaten yet.
- **Size:** trivial
- **Confidence:** high

### F7. Reclaim the 210–260px of dead space in the Verdict and Weigh-in cards

- **Saw:** `items-stretch` on the grid (`:855`, with an in-code comment explaining it was added to stop
  the top-right corner being empty at 1920px). Measured on screen at 1477px: row-1 cards run y≈140→588
  (448px tall). Verdict content ends at y≈378; Weigh-in content ends at y≈325. So the fix produced
  ~210px and ~260px of empty card instead of empty page. Same pattern lower down: the Trend snapshot
  card has ~85px of nothing under its legend because "Recent entries" sets that row's height.
- **Costs:** Two of the three cards above the fold are more than half empty, which pushes the diary — the
  card he actually acts on — below the fold on a 812px-tall window.
- **Do:** This is downstream of F1/F2/F5. Once the Verdict card is one stat tile and the plan card lists
  meals, the row rebalances on its own. If you want a standalone fix, drop the Verdict and Weigh-in cards
  into a single stacked `col-span-4` column.
- **Size:** small
- **Confidence:** high

### F8. "Ate as planned" has no done-state, and undoing it costs one click per meal

- **Saw:** `:507-509`. The button is the green **primary** action and its label is always "Ate as planned"
  (or "Working…"). On screen right now the day is already fully logged from plan — four rows, all tagged
  "from plan" — and the button is still the biggest, greenest control on the card. There is no "clear
  day" / un-log: `removeEntry` (`:490`) is per-row, so undoing costs 4 clicks (one trash icon per meal)
  against the 1 click that created them.
- **Costs:** He can't tell at a glance whether he's already ticked today off — the primary CTA looks
  identical either way. And the *toggle* he asked for is only a toggle in one direction.
- **Do:** When `entries.some(e => e.source === 'planned')`, flip it to a satisfied state — ghost kind,
  label "Logged as planned ✓", clicking it clears the planned rows (`DELETE` by source, which the backend
  already models at `diary.js:422`). One control, both directions, one click each way.
- **Size:** small
- **Confidence:** high

### F9. The fat rail is always 100% full and therefore says nothing

- **Saw:** `:95-96` — `span = Math.max(ceil ?? floor, eaten, 1)`. For a floor-kind rail there is no
  ceiling, so once `eaten >= floor` the span *is* `eaten` and the bar renders at exactly 100%. Confirmed
  on screen: `Fat 67 / min 52g` with the pink bar completely full, sitting next to a protein bar at 98%
  and a carb bar at 92%.
- **Costs:** Fat is the one macro that's fine to be over, and it's drawn as the one that's most maxed
  out. Next to two range bars, a permanently-full third bar reads as "you blew your fat" to anyone who
  didn't write the formula — which is the exact misread the comment block at `:74-88` says it was
  fixing.
- **Do:** For `kind="floor"`, don't draw a proportional fill at all. Draw the floor tick and a met/not-met
  mark, or fix the span to something like `floor * 1.5` so the bar has headroom above the minimum.
- **Size:** small
- **Confidence:** high

### F10. "199 / 185–203g" reads as a fraction whose denominator is a range

- **Saw:** `:97, :110` render `<eaten> / <targetText>` where targetText is `185–203g` or `min 52g`. On
  screen: `199 / 185–203g`, `161 / 151–175g`, `67 / min 52g`. The left number carries no unit; the slash
  is the "out of" slash used everywhere else in the app (`2,040 / 2,040 kcal`).
- **Costs:** "199 out of 185–203 grams" is not a sentence. The information he needs is binary — am I in
  the band or not — and it's encoded in a three-number string he has to parse. This is precisely the
  "too much jargon at the front door" complaint, in miniature, three times per triad.
- **Do:** Say the state, put the math second: `Protein 199g · in range` / `Fat 67g · over the 52g minimum`.
  The full `185–203g` band belongs on the Engine tab (and on hover/title here).
- **Size:** small
- **Confidence:** medium — it's a copy call, and he *does* like numbers; the band could stay in a
  quieter tier rather than disappearing.

### F11. The Weigh-in card doesn't say today is already logged, and the date field is in front of the weight field

- **Saw:** `:948-974`. The date input (defaulted to today, `:753`) renders **above** the weight input, so
  the keyboard path to the only action he does daily is Tab-past-a-field-he-never-changes. And the weight
  field is empty (placeholder "lb") even though Aug 2 already has 206.5 lb logged — visible in "Recent
  entries" two cards below. `backend/src/routes/weighins.js:28` is an `upsert`, so re-logging silently
  overwrites with no warning and no confirmation.
- **Costs:** No way to tell from the card whether he's weighed in today — he has to look at a different
  card to find out. Silent overwrite of body data with zero feedback.
- **Do:** Weight field first, date second (or collapse the date to a small "not today?" affordance).
  When today already has a weigh-in, show it in the card — "Today: 206.5 lb · logged" — and change the
  button to "Update".
- **Size:** small
- **Confidence:** high

### F12. Merge "Recent entries" into the Trend snapshot, or delete it

- **Saw:** Two adjacent cards (`:1001` col-span-7 and `:1051` col-span-5) drawing the same eight
  weigh-ins — one as a curve, one as a table. On screen: chart plots Jul 10 → Aug 2; the table lists
  Aug 2, Jul 19, 18, 17, 16, 15, 14, 13. The table's only unique affordance is a per-row delete.
- **Costs:** A full row of the daily screen to show the same eight numbers twice, when the full version
  of both already lives one click away on the Trend tab (the "Full trend →" link is right there at
  `:1044`).
- **Do:** Delete the "Recent entries" card and let deletion live on the Trend tab, or shrink it to
  yesterday + today. The trend chart earns its place; the table doesn't.
- **Size:** small
- **Confidence:** medium — the delete affordance is the one thing lost. Confirm he actually corrects
  weigh-ins often enough to want it on Today.

### F13. Escape doesn't close the "Add item" panel

- **Saw:** `:211` — `else if (e.key === "Escape" && q)`. Escape only clears the search text; with an
  empty box it does nothing. Verified: opened the panel, pressed Escape, panel stayed open. Closing it
  requires clicking the "Close" button back up at the top of the card.
- **Costs:** Small but real: every other panel in the app (the Coach, per `BrainChat.jsx:115-118`) closes
  on Escape. This one is the exception, in a keyboard-first flow that's otherwise excellent.
- **Do:** In `FoodPicker.onKeyDown`, make Escape clear the query if there is one, otherwise call the
  parent's `closeAdd`.
- **Size:** trivial
- **Confidence:** high

### F14. The floating Coach button sits on top of the diary's controls

- **Saw:** `BrainChat` is mounted app-wide at `App.jsx:354`, fixed bottom-right. Screenshotted at
  1477×812: the "Coach" pill occupies roughly x 1364-1452, y 760-795 — directly over the macro chips and
  the **delete button** of whichever diary row happens to be at the bottom of the viewport (it covered
  the "8.7F" chip and trash icon of the "Arroz con gambas y calamar" row). Opening it covers the whole
  right column, including "Recent entries".
- **Costs:** A fixed overlay on a full-width 12-column diary whose right edge is where the per-row
  controls live. Occasionally he'll have to scroll to reach a delete button.
- **Do:** Either give the main content pane bottom padding equal to the FAB, or move the Coach launcher
  into the sidebar footer next to "How it compares" / "Report a bug", where the other global actions
  already live.
- **Size:** trivial
- **Confidence:** medium — it's scroll-position dependent, but the overlap is structural, not luck.

### F15. Seven standing explainer blocks on a screen he opens daily

- **Saw:** Counted on the live screen — (1) the macro-walls sentence, twice (`:139-142`); (2) "Fasted ·
  post-bathroom · pre-water. Same conditions every day." (`:949-951`); (3) "Verdicts judge 7-day averages
  only" + the band line (`:940-944`); (4) "thin = daily · heavy = 7-day average · dashed = goal"
  (`:1041-1043`); (5) the Micronutrients relocation notice (`:988-991`); (6) the two over-target
  paragraphs (`:917-923`, `:600-603`); (7) "Next photo + tape audit: Aug 16" (`:1070-1072`).
- **Costs:** This is the "too much jargon / busy" complaint in aggregate. Every one of these is a
  first-run explanation that never retires — on day 15, and on day 300, he is still being told what
  "fasted" means and which line on his own chart is the average.
- **Do:** Pick a retirement rule and apply it once: legends and protocol reminders show for the first N
  days (or behind a `?`), then go quiet. The weigh-in protocol line and the chart legend are the two
  clearest candidates; the photo/tape line should appear when it's due (`photoDue` already exists,
  `:826`) and be silent otherwise.
- **Size:** medium
- **Confidence:** medium — the specific retirement rule is a product call, not something I can settle by
  looking.

## Cut list

Delete outright, in order of confidence:

1. **The Micronutrients "MOVED" card** (`TodayTab.jsx:979-998`) — a signpost to a nav item that's
   permanently on screen. Full row, one sentence.
2. **`Meals + snacks: 4`** and **`Planned today`** rows (`:913-914`) — a row count and a number the ring
   already shows 40px away.
3. **The `Rate` and `Target` stat tiles** in Verdict (`:937-938`) — both restated within 200px.
4. **The band explainer line** under the verdict (`:940-944`) — restates the verdict `sub`.
5. **The second copy of the macro-walls sentence** (whichever `MacroRails` call survives F3).
6. **"Nothing to undo: as your weigh-ins build up…"** from the *plan* card's over-target block
   (`:919-921`) — it's about eaten food, printed on a card about food not yet eaten, and printed
   verbatim again in the diary.
7. **The "Recent entries" card** (`:1051-1065`) — same eight numbers as the chart beside it. *Lower
   confidence: keep if the per-row delete matters.*

## Open questions for Shad

1. ~~How long has the Micronutrients "MOVED" card been up?~~ **Resolved: 2026-07-24, 9 days.** Long
   enough. No question left — delete it.
2. **Do you correct weigh-ins often enough to need the delete list on Today?** That's the only thing
   the "Recent entries" card does that the chart doesn't.
3. **When you press "Ate as planned", how often do you then edit the day?** If the answer is "almost
   never", the diary's four named rows with 3 macro chips + a delete button each could collapse to one
   line — which would take ~350px off the screen and make F2 (eaten-as-hero) fit above the fold.
4. **Is the band (`185–203g`) something you read, or something you'd rather see only in Engine?** F10
   hinges on this and it's a genuine numbers-person judgement call.
5. **What do you actually want the Verdict card to make you *do*?** Right now, on a day with too few
   weigh-ins, it occupies a third of the top row to say "not enough data" — but on a normal day its
   sentence is the best copy on the screen. It may want to be a one-line banner under the page title
   rather than a card.
