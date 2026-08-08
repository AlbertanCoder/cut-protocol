# 08 — Every word on screen: the copy and language audit

Reviewed on screen at 1524×784 in a dedicated tab, tab-by-tab, plus source
confirmation. Surfaces walked: Today, Plan, Engine, Profile, Trend, Training,
Wellbeing, Recipes. Foods (child view of Recipes) read from source only — my
click on its header button missed twice and I stopped rather than burn budget.

## Verdict

The *sentences* in this app are unusually good — better than most shipped
products. The problem is not prose, it's **labels**. Almost every complaint
Shad has about "jargon / busy" traces to four label habits: (1) a SHOUTED
eyebrow on every single card that mostly repeats the title next to it, (2) three
internal words used as user-facing nouns — **protocol**, **verdict**, **band** —
(3) version/status codenames leaking onto the screen (`v1 scaffold`,
`V1 TEMPLATES`, `RECOMP ENGINE`), and (4) bare numbers on unnamed scales
(`Simple ≤3`, `Min taste 0–1`, `Change −3`).

The worst single square inch is the **Today page header**: `Day 15 of protocol ·
target 2,040 kcal · plan: 1 lb/wk` — the first line he reads every day, and it
contains a metaphor ("protocol"), a colon-label ("plan:"), and a noun-form
target, when all three facts are one plain sentence. The second worst is the
**Verdict card**, whose title is the word "Verdict" and whose eyebrow is the word
"VERDICT" — literally the same word twice, 40px apart, over a card that then
tells you it can't give you one.

Nothing here needs the numbers changed. Every replacement below keeps every
figure.

## What's already working — do not touch

- **The error taxonomy and its copy.** `frontend/src/lib/api.js:80-113`. Every
  message names a cause and a next step, and — rare — it never claims to know
  what the server did when it doesn't: `"No answer from the app's server after
  15s — it may or may not have gone through. Check the screen before repeating
  it."` The `GENERIC_FAILURE` constant even documents why "Something went wrong"
  was deleted. This is the best-written file in the app. One nit only (F12).
- **The supportive over-target coach line.** `TodayTab.jsx:918-922` and
  `:589-593`: *"Over by 41 — swap a slot on the Plan tab if you want it closer.
  Nothing to undo: as your weigh-ins build up, the engine re-reads your real
  burn and moves the target itself."* Tone is consistent across both the planned
  and the eaten copies, it is never scolding, it names an action *and* an
  it's-fine-to-do-nothing option, and the code comment explains that the earlier
  "tomorrow's target already adjusts" was cut because the engine can't keep that
  promise for a new user. **Keep verbatim.** It is the model the rest of the
  app's labels should be measured against.
- **Recipes sort/group controls.** "Sort A–Z" · "Fewest calories first" · "Most
  protein per calorie" · "Group by main protein". Every one is plain English
  describing the action. This is exactly the standing rule, already met.
- **The Coach card on Profile.** "Connect the coach" / "The coach is on" /
  "Check the connection" / "Turn the coach off" / "Turning it off deletes the
  saved settings from this computer." Verbs, consequences, no jargon.
- **The Wellbeing self-check framing.** "Five questions, about a minute. It's
  optional, it's not a diagnosis, and the answers never leave this computer."
  See the safety section — flagging, not rewriting.
- **Training's week note.** "Week 1 — find working weights. Every set should
  leave 2-3 clean reps in the tank." That's gym vernacular Shad actually says.
  Keep.
- **The honesty lines.** "132 of 910 recipes here use at least one food whose
  stored numbers belong to a different food…", "Estimated from a local price
  table, not live grocery pricing.", "no silent fake logging". The app tells the
  truth about its own gaps in plain words. Don't sand these off while
  de-jargoning.

---

## Findings

### F1. Rewrite the Today header line — it's the densest jargon in the app and he reads it daily

- **Saw:** Today, directly under the "TODAY" h1:
  `Day 15 of protocol · target 2,040 kcal · plan: 1 lb/wk`
  (`TodayTab.jsx:847`). And 40px above it in the header bar, the same two facts
  again as `Day 15   Target 2,040 kcal` (`ui/HeaderBar.jsx:23-28`).
- **Costs:** Three jargon moves in eleven words. "of protocol" is a metaphor
  nobody says out loud. "target" is a noun where a verb belongs. "plan:" is a
  colon-label — the exact pattern he banned. And the target figure is printed
  **twice on the same screen inch**, in the header bar and again in the
  subtitle, in two different formats.
- **Do:** In `TodayTab.jsx:847` →
  `Day 15 · eat 2,040 kcal today · losing 1 lb a week`.
  Drop `Target` from `HeaderBar.jsx` entirely (the subtitle carries it, and the
  header's own comment at line 8 already establishes the principle that the
  header must not repeat what the PageHead says).
- **Size:** trivial · **Confidence:** high

### F2. Kill the card eyebrows — they are the "busy" complaint, made of text

- **Saw:** Every card renders a SHOUTED uppercase eyebrow in the top-right
  (`ui/Parts.jsx:47`). On Today alone: `TODAY`, `VERDICT`, `DAILY`, `DIARY`,
  `MOVED`, `CURVE`, `LOG`. Across the app: `PRESCRIPTION`, `RECOMP`, `STATUS`,
  `HOW FAR AHEAD`, `WEEKS WRITTEN`, `1 MEAL`, `STEP 2 DETAIL`, `V1-TEMPLATES`,
  `OTHER TRACKED`.
- **Costs:** Three failure modes at once. **(a) Pure duplication:** "Verdict /
  VERDICT", "Micronutrients / MICRONUTRIENTS", "Projection / PROJECTION",
  "Cart / CART". **(b) Internal codenames:** `MOVED`, `CURVE`, `LOG`, `RECOMP`,
  `WEEKS WRITTEN`, `1 MEAL` — none of these is a word for the thing in the
  card. **(c) It's a shouted compressed-code label**, which is the exact style
  the codebase itself already calls out as banned (`ui/Parts.jsx:90-99`
  documents removing `uppercase tracking-wide` from the verdict text for that
  reason — then leaves it on the eyebrow directly above).
  On Today this is **7 uppercase words** competing with 7 real titles for no
  information gain.
- **Do:** Delete the `section` prop from every `<Card>` call site. Where the
  eyebrow carried real information the title doesn't (`STEP 1`…`STEP 4` on
  Engine; `MICRONUTRIENTS`'s "13/14 with data"), fold it into the title:
  `"Step 1 — BMR"`. `ui/Parts.jsx:31-53` keeps the prop so nothing breaks.
- **Size:** small (one prop, ~30 call sites) · **Confidence:** high
- This is the single highest-leverage change for the "too busy" complaint.

### F3. "Verdict" is used for two different things and is a bad word for both

- **Saw:** Today has a card titled **Verdict** (`TodayTab.jsx:933`) that judges
  your weight-loss pace. Plan has a card titled **"This verdict is out of
  date"** (`PlanTab.jsx:475`) that means *the meal solver's match score*. Same
  word, two unrelated meanings, two tabs. It also appears in body copy —
  "Verdicts judge 7-day averages only" (`TodayTab.jsx:943`) — and as a
  component name in `BarcodeLookup.jsx:49` (`VerdictBanner`) for a third
  meaning (is this barcode's data trustworthy).
- **Costs:** "Verdict" is a courtroom word — a judgment passed on you. On a
  card that describes food and body data, in an app whose own design law says
  *"Red on food reads as moral judgment"*, the tone is off by exactly the amount
  the color law is trying to prevent. And a user who learns "verdict = my pace"
  on Today is then told on Plan that his verdict is out of date, meaning
  something else entirely.
- **Do:** Today's card → **"How your pace is going"** (title) with the eyebrow
  gone. Body line → "This only judges 7-day averages." Plan's card
  (`PlanTab.jsx:475`) → **"This score is out of date"**, and its body's *"match
  percentages and miss lines"* → *"match percentages and the notes about what it
  missed"* — "miss lines" is an internal term.
- **Size:** small · **Confidence:** high

### F4. "PRESCRIPTION" on Profile directly contradicts the app's own disclaimer

- **Saw:** Profile's rate card carries the eyebrow **`PRESCRIPTION`**
  (`ProfileTab.jsx:839`), and its error state reads *"Rate options couldn't be
  loaded — only your saved rate is shown. **Your prescription is unchanged.**"*
  (`ProfileTab.jsx:845`). Meanwhile Wellbeing's disclaimer card says the app's
  targets are *"general information from formulas — **not a prescription**, not
  personalized clinical guidance"* (`WellbeingTab.jsx:247`).
- **Costs:** The app calls the same number a prescription on one tab and
  explicitly not-a-prescription on another. Beyond the jargon problem, that is
  the kind of inconsistency that matters if anyone ever reads this app's copy
  adversarially.
- **Do:** Eyebrow → gone (F2). Title `"Rate of loss"` → **"How fast you want to
  lose"**. Error string → *"Your saved rate is unchanged."*
- **Size:** trivial · **Confidence:** high

### F5. Three numbers on screen sit on scales the app never names

- **Saw:**
  - Plan → `Max complexity: Simple ≤3 · Moderate ≤6 · Involved ≤10`
    (`ui/FilterControls.jsx:71-76`). **≤3 of what?** I read
    `backend/src/lib/recipeComplexity.js` to find out: it is a composite of
    ingredient count + step count + distinct technique flags. There is no way a
    user could know that, and no affordance on screen that reveals it.
  - Plan → `Min taste`, help text `0–1; median across your recipes ≈ 0.58`
    (`PlanTab.jsx:304-308`). A 0–1 score with no name and no explanation of
    what 0.58 means.
  - Engine → the weekly adjustment table's **`Change`** column shows `−3`,
    `no change`, `—` (`AdaptiveTdeeCard.jsx:260, 289`). No unit on the header
    (it's kcal), and `—` and `no change` mean two different things (no prior
    week vs. zero change) in the same column with no legend.
  - Trend chart → the annotation `GOAL 185.2` carries no unit inside the chart
    (`TrendTab.jsx`); the lb only appears in a line below.
- **Costs:** This is the *"number without a unit / unit without a label"* case
  exactly, and it violates the project's own constitution — *"Displayed numbers
  can reveal their formula and inputs."* These four cannot.
- **Do:** `Simple ≤3` → **`Simple`** with help text *"Scored on ingredients,
  steps, and fiddly techniques — simple is 3 or less."* `Min taste` →
  **`Minimum taste rating`**, help *"Your own 0–1 rating score; median across
  your recipes is 0.58. It sharpens once you rate dishes."* `Change` →
  **`Change (kcal)`**, and render the null case as `first week` rather than `—`.
  Chart annotation → `GOAL 185.2 lb`.
- **Size:** small · **Confidence:** high

### F6. "Band" is used for two different things and needs a plain word for both

- **Saw:** Today's Verdict card: *"**Your band:** 0.8–1.2 lb/wk, from your
  chosen 1 lb/wk"* (`TodayTab.jsx:942`). Trend: *"the shaded **band** is one
  standard error on its slope"* (`TrendTab.jsx:526`) and *"That is what a wide
  band means"* (`:689`). Engine: *"This app's 185–203g range sits inside that
  **band**"* (`EngineTab.jsx:351`).
- **Costs:** In one place it means "the pace range you're aiming for", in
  another "the statistical uncertainty around a fitted line". Neither is a word
  a normal person reaches for, and the Today usage is on the front door.
- **Do:** Today → *"**You're aiming for** 0.8–1.2 lb a week, from the 1 lb/wk
  you chose."* Trend → keep "band" only where it's paired with its own
  definition, or say *"shaded range"*. Engine can keep "band" — it's the math
  tab and he wants the math there.
- **Size:** trivial · **Confidence:** high

### F7. Training wears its version number in three places and calls itself a scaffold

- **Saw:** Training tab. Subtitle: *"**v1 scaffold** — matches your inputs to a
  sensible template. Programming depth comes later; this gets you lifting."*
  (`TrainingTab.jsx:69`). Badge next to it: **`V1 TEMPLATES`**. Plan card
  eyebrow: **`V1-TEMPLATES`** (`:151`). Three appearances of an internal
  version label on one screen.
- **Costs:** Shad said he wants Training *improved, not hidden* — and the first
  thing the screen does is tell him it's unfinished scaffolding, three times.
  "Scaffold" is developer vocabulary that has escaped onto a user surface.
- **Do:** Subtitle → *"Matches your inputs to a proven template. Deeper
  programming comes later; this gets you lifting."* Delete the `V1 TEMPLATES`
  badge and the `V1-TEMPLATES` eyebrow. The flag in `lib/flags.js` still
  controls whether the tab ships; the *user* doesn't need the version number.
- **Size:** trivial · **Confidence:** high

### F8. "Recomp Engine" / "recomposition" / "RECOMP" — the brand subtitle is the jargon

- **Saw:** The sidebar wordmark, on every screen, reads **CUT PROTOCOL** over
  **RECOMP ENGINE** (`Sidebar.jsx:50`, also `LoginScreen.jsx:147`). Trend's
  subtitle: *"Scale weight and estimated lean mass — **recomposition** means
  what's LOST matters as much as how much"* (`TrendTab.jsx:437`). Trend has a
  card eyebrowed **`RECOMP`** titled *"The other lever"* whose body begins
  lowercase: *"hypertrophy training active, 3x/week"* (`TrendTab.jsx:70`).
- **Costs:** "Recomp" is bodybuilding-forum shorthand printed under the app's
  own name, permanently, on every screen — it is the first jargon a user meets
  and it's never defined. "The other lever" as a card title tells you nothing
  about what's in the card.
- **Do:** Sidebar subtitle → **"Lose fat, keep muscle"** (same meaning, zero
  jargon, and it's the actual product promise). Trend subtitle → *"Scale weight
  and estimated lean mass — what you lose matters as much as how much."* Card
  title *"The other lever"* → **"Training keeps the muscle"**, and capitalise
  the body sentence.
- **Size:** trivial · **Confidence:** high
- **Note:** "Cut Protocol" as the *product name* I'd leave alone — it's the
  brand, it's on the icon, and renaming a product is not a copy fix. It's
  "protocol" as a *unit of measurement* ("Day 15 of protocol") and "Recomp
  Engine" as a *tagline* that are the problem.

### F9. "Ate as planned" is only explained when the diary is empty

- **Saw:** The diary card's button reads **`Ate as planned`**
  (`TodayTab.jsx:508`). What it does — copy today's plan into the diary — is
  stated *only* in the empty-state hint: *"Use "Ate as planned" to copy today's
  plan, or search your food library with "Add item"."* (`TodayTab.jsx:582`).
  Once anything is logged, that hint unmounts and the button stands bare. There
  is a third state too: disabled, with *"Generate a plan to enable "Ate as
  planned"."*
- **Costs:** The one feature Shad specifically asked for is self-explanatory
  for exactly as long as he never uses it. After day one the button is a
  statement ("ate as planned") sitting where a verb should be, next to a real
  verb ("Add item"), and nothing says it writes four rows into the diary below.
- **Do:** Relabel the button **`Copy today's plan into the diary`** (or, if
  that's too long for the row, `Log the whole plan`). Both are verbs that say
  what happens. Then the empty-state hint can shrink to *"…or search your food
  library with "Add item"."* Net: fewer words on screen, meaning always present.
- **Size:** trivial · **Confidence:** high

### F10. Foods tells you the food diary doesn't exist. It shipped.

- **Saw:** `FoodsTab.jsx:355-362`. A permanently-disabled **`Log today`** button
  with tooltip *"Needs the food diary — not built yet"* and the caption
  *""Log today" unlocks when the food diary ships — no silent fake logging."*
  Meanwhile the Today tab I was looking at has **four diary entries logged**,
  and `api.addDiaryEntry` / `api.logPlannedDiary` are live (`lib/api.js:396-399`).
- **Costs:** He goes to Foods to log a food, is told it's impossible, and
  doesn't learn that Today → "Add item" → search does exactly that. Stale copy
  that has become a lie is worse than no copy.
- **Do:** Either wire the button to `api.addDiaryEntry`, or — cheaper and in the
  spirit of "removal beats addition" — delete the button and the caption and
  replace with an inline link: *"Log this on **Today**."*
- **Size:** small · **Confidence:** high

### F11. Same fact, twice, back to back — two places

- **Saw:** **(a)** Engine, adaptive-burn card, one paragraph:
  *"**Undoing this.** This adjustment is recomputed from your weigh-ins and food
  log every time they change — **nothing is stored**. Fix or delete an entry and
  the adjustment recalculates with it. **Nothing above is stored** — it is
  recalculated from your entries every time you open this screen, so the log can
  never drift from what actually happened."* The first half comes from the
  backend (`backend/src/lib/adaptiveTarget.js:391`), the second half is appended
  by the frontend (`AdaptiveTdeeCard.jsx:307`). Neither knew about the other.
  **(b)** Wellbeing micronutrients: the sentence *"Based on 20% of today's food
  weight — 16 items logged with no data for this nutrient."* renders **23 times**
  on one screen, nearly identical each time.
- **Costs:** (a) is a 55-word paragraph making a 25-word point. (b) is the
  single densest block of repeated text in the app.
- **Do:** (a) Drop the frontend's appended clause — the backend string already
  says it. (b) Hoist the coverage sentence to **one line above the list**
  ("Coverage below is 20% of today's food weight; per-nutrient gaps are shown
  beside each row") and reduce each row to the differing number.
- **Size:** trivial (a) / small (b) · **Confidence:** high

### F12. Button labels that aren't verbs, and three names for one thing

- **Saw:**
  - Plan grocery list: two adjacent buttons labelled **`Text`** and **`Email`**
    (`PlanTab.jsx:1466-1470`). They're `sms:` and `mailto:` links. "Text" as a
    bare noun reads as "show me this as plain text".
  - Recipes: an import button labelled just **`Import`** next to a URL box.
  - Foods: the screen is titled **"Food database"** (`FoodsTab.jsx:540`) but
    Recipes' prose calls it *"your food **library**"* and *"the library"*, and
    the Recipes empty-state says *"Add recipes from the **library**"*.
  - Engine: **`Copy your data as JSON (raw backup)`** — good, actually; it says
    what happens. Contrast with the above.
  - `api.js:110`: `isAuthError` → *"Your session expired."* — the one error
    string in that file that names no next step, while every one of its
    neighbours does.
- **Do:** `Text` → **`Send by text`**; `Email` → **`Send by email`**; `Import` →
  **`Import this recipe`**. Pick **one** name — I'd use **"Food library"** since
  the prose already says it twice and "database" is the engineer's word — and
  use it in the PageHead, the nav button, and every mention. `"Your session
  expired."` → *"Your session expired — sign in again to continue."* (which is
  already the exact string `App.jsx:119` shows, so this is just making the two
  agree).
- **Size:** trivial · **Confidence:** high

### F13. Metric leaks: narrow, and one of them is deliberate

I hunted specifically for kg/cm reaching an imperial screen. The `units.js`
boundary is clean and pref-aware (`lib/units.js:11-38`) — storage is kg/cm,
every display helper takes `pref`. Only three leaks, and they're small:

- **Saw:** **(a)** Profile's rate pills print **both** units on every pill —
  `1 lb/wk` bold with `0.5 kg/wk` underneath, ×7 pills
  (`ProfileTab.jsx:857-858`). The code comment says this is intentional
  (metric users get the mirror), but for an imperial-only user it is seven
  lines of dead text on a card he visits to change one setting.
  **(b)** The backend hardcodes `lb/wk` into every verdict sentence
  (`backend/src/lib/bmrEngine.js:607-621`, e.g. `"${r1(rate)} lb/wk against your
  ${r1(chosen)} lb/wk plan"`) — so a *metric* user would read lb inside the
  Verdict card while the line right below it converts to kg/wk. Harmless for
  Shad; a real bug for anyone else.
  **(c)** `TodayTab.jsx:847` and `:942` hardcode `lb/wk` for
  `profile.rateLbPerWeek` rather than routing it through `displayRate`.
- **Costs:** For Shad specifically: 7 redundant kg lines on Profile. That's it.
  I did **not** find kg or cm on Today, Trend, Engine, or the diary.
- **Do:** (a) Show the secondary unit only when it differs from `unitPref` — or
  just drop it; the Units toggle is 300px above. (b)/(c) route through
  `rateUnit(pref)`/`displayRate` if a second user ever matters. **(a) only if he
  agrees** — it's a deliberate choice, not a defect.
- **Size:** trivial · **Confidence:** high on the observation, medium on whether
  (a) is worth changing

### F14. Small vocabulary leaks a Canadian wouldn't say

- **Saw:**
  - `"they just can't describe this **fortnight**"` — Today's Verdict card, the
    state he's in right now (`backend/src/lib/bmrEngine.js:600`). Britishism.
  - `"photos + **tape audit**"` — Today footer and Trend
    (`TodayTab.jsx:1071`, `TrendTab.jsx`). "Audit" is an accounting word.
  - Profile: **`Multiplier override`** — override which multiplier?
  - Profile: *"Body fat % unlocks the two **LBM**-based BMR formulas"* — LBM is
    never expanded anywhere on that tab (Trend says "lean mass" in full).
  - Profile: **`Personal floor (kcal, min 1500)`** — "floor" appears as a bare
    noun here and in three other places without ever being defined on a default
    surface.
  - Trend: *"The **robust fit** the Engine uses needs three weigh-ins and
    **adaptive targeting** switched on"* — two internal terms in one sentence,
    on a default surface.
  - Plan: `Optional caps — each off unless you set it`, then `Caps are hard
    filters` — "cap" four times in one card, and **`Min taste`'s enable button
    says `Set cap`** for a *minimum* (`ui/FilterControls.jsx:45`). A floor
    controlled by a button labelled "cap".
  - Plan: *"locked meals survive **a regenerate**"* — verb used as a noun.
  - Recipes: `${drafts.length} draft(s)` (`RecipesTab.jsx:963`) — the lazy
    `(s)` plural, in an app that pluralises properly two files away
    (`TodayTab.jsx:601`).
  - Grocery list: **`1 apple — Pineapple, raw`**, **`1 block — Peanut Butter`**,
    **`1 onion — Spring Onions`**, **`1 pepper — Green Pepper · 1 g`** filed
    under SPICES. The *unit nouns* are wrong even where the grams are right.
    (The classifier bug behind these is someone else's lens; the visible copy
    defect is mine.)
- **Do:** See the table below.
- **Size:** trivial each · **Confidence:** high

---

## String → replacement table (hand this to an implementer)

Numbers and facts unchanged throughout; only labels move.

| # | Exact string | Where | Why it's a problem | Replace with |
|---|---|---|---|---|
| 1 | `Day 15 of protocol · target 2,040 kcal · plan: 1 lb/wk` | Today subtitle · `TodayTab.jsx:847` | metaphor + colon-label + noun-target, first line he reads | `Day 15 · eat 2,040 kcal today · losing 1 lb a week` |
| 2 | `Target 2,040 kcal` | header bar · `ui/HeaderBar.jsx:26` | duplicates line 1 forty px away | *delete* |
| 3 | `RECOMP ENGINE` | sidebar + login · `Sidebar.jsx:50`, `LoginScreen.jsx:147` | forum shorthand under the app's name, on every screen | `Lose fat, keep muscle` |
| 4 | `Verdict` (card title) | Today · `TodayTab.jsx:933` | courtroom word on food/body data | `How your pace is going` |
| 5 | `VERDICT` (eyebrow) | Today · same card | same word twice, 40px apart | *delete* |
| 6 | `Verdicts judge 7-day averages only.` | Today · `TodayTab.jsx:943` | " | `This only judges 7-day averages.` |
| 7 | `This verdict is out of date` | Plan · `PlanTab.jsx:475` | "verdict" now means a solver score — 2nd meaning | `This score is out of date` |
| 8 | `match percentages and miss lines` | Plan · `PlanTab.jsx:475` body | "miss lines" is internal | `match percentages and the notes about what it missed` |
| 9 | `Your band: 0.8–1.2 lb/wk, from your chosen 1 lb/wk` | Today · `TodayTab.jsx:942` | "band" undefined on the front door | `You're aiming for 0.8–1.2 lb a week, from the 1 lb/wk you chose.` |
| 10 | `PRESCRIPTION` (eyebrow) | Profile · `ProfileTab.jsx:839` | contradicts the app's own "not a prescription" disclaimer | *delete* |
| 11 | `Rate of loss` | Profile · same card | noun-phrase label | `How fast you want to lose` |
| 12 | `Your prescription is unchanged.` | Profile · `ProfileTab.jsx:845` | see #10 | `Your saved rate is unchanged.` |
| 13 | `Multiplier override` | Profile · Job & training | which multiplier? | `Set your own activity multiplier` |
| 14 | `…unlocks the two LBM-based BMR formulas.` | Profile · Body card | LBM never expanded on this tab | `…unlocks the two formulas that use lean body mass.` |
| 15 | `Personal floor (kcal, min 1500)` | Profile | "floor" undefined | `Never plan below (kcal, min 1,500)` |
| 16 | `Planned vs. target` | Today · `TodayTab.jsx:857` | the rows inside already say Target / Planned today | `Today's plan` |
| 17 | `Trend snapshot` | Today · `TodayTab.jsx:1001` | "snapshot" is a metaphor | `Weight so far` |
| 18 | `Recent entries` | Today · `TodayTab.jsx:1051` | entries of what? | `Recent weigh-ins` |
| 19 | `Ate as planned` | Today diary button · `TodayTab.jsx:508` | statement, not a verb; only explained in the empty state | `Copy today's plan into the diary` |
| 20 | `Next photo + tape audit: Aug 16` | Today footer · `TodayTab.jsx:1071` | "audit" is an accounting word | `Next progress photo + tape measure: Aug 16` |
| 21 | `4-week photo + tape audit due — same light, same poses.` | Today footer · same line | " | `Progress photo + tape measure due — same light, same poses.` |
| 22 | `…they just can't describe this fortnight.` | Verdict body · `bmrEngine.js:600` | Britishism | `…they just can't describe the last two weeks.` |
| 23 | `v1 scaffold — matches your inputs to a sensible template.` | Training subtitle · `TrainingTab.jsx:69` | "scaffold" is developer-speak; tells him it's unfinished | `Matches your inputs to a proven template.` |
| 24 | `V1 TEMPLATES` (badge) | Training · `TrainingTab.jsx:69` | internal version label | *delete* |
| 25 | `V1-TEMPLATES` (eyebrow) | Training plan card · `:151` | " | *delete* |
| 26 | `RPE` (table column, no legend) | Training exercise tables | never expanded on the tab | keep the column, add one legend line: `RPE = how hard it should feel, 1–10. Rest is in seconds.` |
| 27 | `120s` / `90s` | Training rest column | seconds abbreviated mid-table | `2 min` / `1½ min` |
| 28 | `Max complexity: Simple ≤3` | Plan · `ui/FilterControls.jsx:76` | ≤3 of *what* — it's a composite score with no name | `Simple`, + help `Scored on ingredients, steps and fiddly techniques — simple is 3 or less.` |
| 29 | `Min taste` + `Set cap` button | Plan · `PlanTab.jsx:304`, `FilterControls.jsx:45` | a **minimum** whose button says **cap** | `Minimum taste rating` + button `Set minimum` |
| 30 | `0–1; median across your recipes ≈ 0.58.` | Plan · `PlanTab.jsx:308` | 0–1 of what | `Your own 0–1 rating score; the median across your recipes is 0.58.` |
| 31 | `Optional caps — each off unless you set it` | Plan · `PlanTab.jsx:286` | "cap" ×4 in one card | `Optional limits — all off unless you turn one on` |
| 32 | `locked meals survive a regenerate` | Plan subtitle | verb used as a noun | `locked meals survive when you regenerate` |
| 33 | `Text` / `Email` (buttons) | Plan grocery · `PlanTab.jsx:1466-1470` | nouns, not verbs; "Text" reads as "plain text" | `Send by text` / `Send by email` |
| 34 | `Import` (button) | Recipes · `RecipesTab.jsx` | bare verb, no object | `Import this recipe` |
| 35 | `Food database` | Foods PageHead · `FoodsTab.jsx:540` | three names for one thing (database / library / the library) | `Food library` — everywhere |
| 36 | `${drafts.length} draft(s) — review grams, then save` | Recipes · `RecipesTab.jsx:963` | `(s)` plural | `3 drafts — review the grams, then save` (proper pluralisation) |
| 37 | `Change` (table column) | Engine · `AdaptiveTdeeCard.jsx:260` | no unit; it's kcal | `Change (kcal)` |
| 38 | `—` in that column | Engine · `AdaptiveTdeeCard.jsx:289` | means "no earlier week" but sits beside `no change` | `first week` |
| 39 | `Nothing above is stored — it is recalculated from your entries every time you open this screen…` | Engine · `AdaptiveTdeeCard.jsx:307` | restates the backend string immediately before it | *delete* (backend `adaptiveTarget.js:391` already says it) |
| 40 | `Based on 20% of today's food weight — 16 items logged with no data for this nutrient.` ×23 | Wellbeing micronutrients | same sentence 23 times on one screen | hoist once above the list; leave only the per-row number |
| 41 | `The other lever` (card title) | Trend · `TrendTab.jsx:70` | tells you nothing | `Training keeps the muscle` |
| 42 | `hypertrophy training active, 3x/week.` | Trend · same card | starts lowercase; "hypertrophy" unexplained | `Hypertrophy (muscle-building) training, 3× a week.` |
| 43 | `The robust fit the Engine uses needs three weigh-ins and adaptive targeting switched on` | Trend · `TrendTab.jsx` | two internal terms, one sentence, default surface | `The Engine's fitted trend line needs three weigh-ins and the adaptive target turned on` |
| 44 | `LEAN MASS IF IT NEVER MOVED 161.1` | Trend chart annotation | shouted, no unit, reads as a claim | `If lean mass never moved: 161.1 lb` |
| 45 | `GOAL 185.2` | Trend chart annotation | no unit inside the chart | `GOAL 185.2 lb` |
| 46 | `photos + tape are the real audit` | Trend · Numbers card | see #20 | `photos and a tape measure are how you actually check this` |
| 47 | `recomposition means what's LOST matters as much as how much` | Trend subtitle · `TrendTab.jsx:437` | jargon + shouted word | `what you lose matters as much as how much` |
| 48 | `Your session expired.` | `lib/api.js:110` | only string in that file with no next step | `Your session expired — sign in again to continue.` |
| 49 | `Needs the food diary — not built yet` + `"Log today" unlocks when the food diary ships` | Foods · `FoodsTab.jsx:355,361` | **the food diary shipped** — this is now false | wire the button, or replace with `Log this on Today.` |
| 50 | `1 apple — Pineapple, raw` · `1 block — Peanut Butter` · `1 onion — Spring Onions` | Plan grocery list | wrong unit nouns | `1 pineapple —` · `1 jar —` · `1 bunch —` (needs the piece-noun table fixed, not just the string) |
| 51 | every `section=` eyebrow (~30 call sites) | app-wide · `ui/Parts.jsx:47` | half duplicate the title, half are codenames | delete the prop from call sites; fold real info (`STEP 1`…) into titles |

---

## Cut list

- **All ~30 card eyebrows.** Highest-value deletion in the app for the "busy"
  complaint. (F2, table #51.)
- **`Target 2,040 kcal` in the header bar.** Printed twice per screen.
- **The `V1 TEMPLATES` badge and the `V1-TEMPLATES` eyebrow.** The flag already
  controls shipping; the user doesn't need the version.
- **The Micronutrients "MOVED" card on Today** (`TodayTab.jsx:985-998`). It's a
  full-width 12-column card whose entire content is a forwarding address. It was
  right to leave a signpost for one release; it's been there since. Delete it —
  Wellbeing is in the sidebar.
- **The appended "Nothing above is stored" clause** (`AdaptiveTdeeCard.jsx:307`).
  Duplicate of the backend string directly before it.
- **22 of the 23 copies of "Based on 20% of today's food weight…"** on Wellbeing.
- **The kg/wk secondary line on Profile's rate pills**, if Shad confirms he'll
  never switch to metric. Seven dead lines otherwise. (Ask first — deliberate.)
- **The disabled `Log today` button on Foods.** Either wire it or remove it; a
  permanently-dead control that describes a shipped feature as unbuilt is worse
  than nothing.

---

## Wellbeing / eating-disorder screening copy — flagged, not rewritten

I read this carefully and am **not** proposing changes. The wording is
deliberate and the reasons are documented in the source
(`WellbeingCheck.jsx:8-19`: SCOFF over-flags in community samples, so the copy is
"a reason to check in," never "you have a disorder"). Three flags for Shad, all
questions rather than edits:

1. **`Have you recently lost more than One stone (about 6.3 kg / 14 lb) in a
   3-month period?`** (`WellbeingCheck.jsx:23`). "One stone" is meaningless to a
   Canadian, and the capital O mid-sentence looks like a typo. Both are correct:
   it is the verbatim SCOFF item and the letters spell S-C-O-F-F. The
   parenthetical already carries lb. **Do not change this without deciding
   whether you care about instrument fidelity** — reworded SCOFF items are no
   longer validated SCOFF items. My only suggestion, and it's optional: put the
   lb first — `(about 14 lb / 6.3 kg)` — which changes no word of the item
   itself.
2. **The Wellbeing tab's disclaimer says "not a prescription"** while Profile
   labels the rate card `PRESCRIPTION`. That's finding F4, but I'm re-flagging
   it here because the *disclaimer* is the copy that must not move — the fix
   belongs entirely on the Profile side.
3. **Everything else in this area is good and should survive the de-jargoning
   pass.** "Five questions, about a minute. It's optional, it's not a diagnosis,
   and the answers never leave this computer." / "Stored on this computer only —
   never uploaded, never sent to the app's server, never part of a backup or an
   export." / the support-resource note about not being affiliated. If a global
   find-and-replace runs over the app, exempt `WellbeingCheck.jsx`,
   `WellbeingTab.jsx` and `lib/wellbeingResources.js`.

---

## Error messages — what the user actually sees

Per the brief I read `lib/api.js` rather than breaking the backend. The user
never sees a status code. `describeError` (`api.js:103-113`) maps every thrown
error to one sentence:

| Situation | What he reads |
|---|---|
| request cancelled | `The request was cancelled.` |
| timeout | `No answer from the app's server after 15s — it may or may not have gone through. Check the screen before repeating it.` |
| connection refused | `Couldn't reach the app's server — the change was not sent. If this keeps happening, close Cut Protocol completely and open it again.` |
| 401 | `Your session expired.` ← the one weak string (table #48) |
| 500+ | `The server hit an error (500) — your change was not saved.` |
| unclassified | `That didn't go through, and the app couldn't tell why. Try it once more — if it fails again, use Report a bug in the sidebar so the details get sent with it.` |
| 404 | `This version of the app asked the server for something it doesn't have — the two halves may be out of step.` |
| 409 | `That clashed with a change already saved. Reload the screen to see the current state, then try again.` |
| 429 | `Too many attempts in a row. Wait a minute and try again.` |

**This is the best copy in the product.** Every line names a cause, says whether
the change landed, and gives a next step. The only defect is #48 (401 is the
sole message with no next step, and `App.jsx:119` already has the better
version). Do not "simplify" this file.

---

## Open questions for Shad

1. **"Cut Protocol" the product name** — I left it alone (it's the brand and the
   app icon). It's `Day 15 **of protocol**` and `RECOMP ENGINE` that I'd cut. Do
   you agree the name stays?
2. **Profile rate pills showing both units** — deliberate per the code comment.
   Are you ever switching to metric? If no, that's 7 lines of dead text on the
   card gone for free.
3. **`Max complexity ≤3`** — I had to read `recipeComplexity.js` to find out it
   scores ingredients + steps + technique flags. Do you want that formula
   surfaced (constitution says displayed numbers can reveal their formula), or
   is the number itself the thing you want cut?
4. **The Foods `Log today` button** — wire it to the diary, or delete it? The
   diary is live, so the current "not built yet" copy is false either way.
5. **`Cart (unknown)`** (`RecipesTab.jsx:974`) — I saw the code path but never
   the state. Is that an error label users actually hit, and should it read
   `Cart — couldn't load`?
