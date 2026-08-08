# 09 — Profile, the setup wizard, and every empty / loading / error state

## Verdict

The empty / loading / error states are the **best-built part of this app** and should be
left almost entirely alone — they are honest, they distinguish "the server said no" from
"the server never answered", and they never fake a logged-out state. The problem is
**Profile itself**: 43 live controls on a 1,878px-tall page, ordered by the order the
Prisma schema declares its columns, with the one dial a cutter actually turns (Rate of
loss) below the fold. And underneath it sit **six profile settings that literally cannot
be set** — the API accepts them with a 200 and silently drops every one — plus one
preference control that saves fine and then changes nothing about the plan you get.

The worst of it is F1 and F2: settings that do nothing. Everything else on this screen is
a reordering job.

## What's already working

- **The three auth states in `App.jsx` are genuinely distinguishable and genuinely
  honest.** `checking` → skeleton cards; `unreachable` → "Can't reach the app's server…
  You are not signed out"; `out` → the login screen. `api.js:269` fires the signed-out
  handler on a real HTTP 401 and nothing else — not a 500, not a timeout, not a refused
  connection. `TIMEOUT.READ = 15_000` means `checking` cannot hang forever. This is the
  correct design and the comments explaining why are worth keeping verbatim.
- **Empty states are complete and count-aware.** `TrendTab.jsx:442-447` has a 0-weigh-in
  state and a separate 1-weigh-in state ("The curve starts with your second weigh-in").
  `TrendTab.jsx:631` states out loud how many weigh-ins the 7-day average actually covers
  rather than pretending it covers seven. `TrendTab.jsx:534` says the robust fit needs
  three weigh-ins. On screen, `Diet & allergies` with nothing excluded reads "Excluded (0)
  — Nothing excluded. That is a valid setting." That sentence is exactly right: a failed
  load must never read as an empty one, and here it doesn't.
- **The allergy save machinery** (`ProfileTab.jsx:268-355`) is over-engineered for one
  user and I would still not touch it. Optimistic toggle, rollback to server truth on
  failure, a re-check button, and copy that distinguishes "refused" from "no answer" —
  on the one control where being wrong matters.
- **The wizard's escape hatch** ("Don't know your numbers yet?" →
  `SetupWizard.jsx:636-652`) is on every step, in one fixed place, and requires an
  explicit tick before it applies. Keep it.
- **The under-18 and low-goal-weight refusals explain their reasoning instead of just
  blocking**, and they appear the moment the number is typed rather than after four steps
  (`SetupWizard.jsx:64-100`). Rare and good.
- **`ErrorBoundary.jsx`'s own doc comment lists what a boundary cannot catch.** A crash
  screen that refuses to oversell itself.

---

## Findings

### F1. Delete the four profile "preferences" the API silently refuses to save

- **Saw:** `Profile` has columns `maxPrepMin`, `budgetTier`, `allowBatch`,
  `maxComplexity` (`backend/prisma/schema.prisma`, Profile model), plus `adaptiveTdee`
  and `proteinPriorityMode`. **None of the six is in `PROFILE_FIELDS`**
  (`backend/src/routes/profile.js:18-25`), and that array is the only thing the PUT
  copies into its patch (`profile.js:421-423`). Measured on the throwaway clone:

  ```
  PUT /api/profile {"maxPrepMin":20,"budgetTier":"cheap","allowBatch":true,
                    "maxComplexity":2,"adaptiveTdee":false,"proteinPriorityMode":true}
  → 200 OK
  → maxPrepMin:null  budgetTier:null  allowBatch:null  maxComplexity:null
    adaptiveTdee:true  proteinPriorityMode:false
  ```

  Not a 400, not a warning — a 200 and a shrug. Meanwhile
  `backend/src/lib/brain/constraints.js:42-45` builds four of the coach's soft
  constraints straight off those columns:
  `batch: leaf({ allow: profile.allowBatch ?? null }, "profile", "soft", 2)` and the same
  for complexity, time and budget. All four are permanently `null`, so
  `softScore.js:56-89` scores them as "no signal" forever. And
  `backend/src/routes/export.js:856-861` writes all six into the JSON export, so the
  export file advertises settings the app cannot produce.
- **Costs:** Four of the Brain's seven soft constraints are dead weight it re-derives on
  every solve. `constraints.js`'s relaxation ladder (`SOFT_ORDER = ["portion", "batch",
  "complexity", "time", "budget", …]`) has four rungs that can never be occupied. And the
  export promises a round-trip that doesn't exist: import a file with `budgetTier:
  "cheap"` and it lands via `export.js:863`'s upsert, then can never be changed or cleared
  from the UI again.
- **Do:** Delete the four `leaf(...)` lines in `brain/constraints.js:42-45` and their
  `SOFT_ORDER` entries, the six lines in `export.js:856-861`, and the columns themselves
  in a migration. PlanTab already owns the live versions of all four as per-generation
  filters (`PlanTab.jsx:265` max prep, `:272` batch repeats, `:291` max cost, `:301`
  complexity cap) — those work, are validated in `planContext.js:264-281`, and are the
  right home for them. This is pure removal.
- **Size:** medium (a migration) · **Confidence:** high — measured, twice.

### F2. "Cuisine preferences" on Profile does not affect your meal plan

- **Saw:** Profile → Diet & allergies → "AI recipe preferences (optional)" → **Cuisine
  preferences**, a comma-separated text box (`ProfileTab.jsx:816-820`) that saves to
  `profile.cuisinePreferences`. That field is read in exactly two places:
  `recipeGeneration.js:236` (picks one at random to seed an AI recipe draft) and
  `mealRouter.js:470` (the AI fallback used only when the library can't fill a slot).
  **The solver never reads it.** `mealSolver.js:72-84` biases on `filters.cuisines`, and
  `filters` comes from `parseFilters(body)` (`planContext.js:263-281`), which reads
  `body.filters` — i.e. PlanTab's own cuisine chips. Typing "mexican, thai" here and
  hitting Generate changes nothing about which recipes you get.
- **Costs:** Two controls called "cuisine", in two tabs, with different scopes and no
  label saying so. The one on Profile — the screen labelled "Your stats, activity, diet
  rules…" — is the one that doesn't touch the plan. It is also the one collapsed behind a
  disclosure triangle, which reads as "advanced", not "inert".
- **Do:** Delete the Profile cuisine box and the Notes textarea beside it, or rename the
  disclosure to what it is: **"Preferences for AI-written recipes only"**, and say in the
  helper line that plan cuisine lives on Plan. Deleting is better — PlanTab's chips
  already cover the case, and `mealPreferencesNote` is free text the Brain treats as
  untrusted anyway (`brain/chat.js:115-123` runs it through an injection pre-gate).
- **Size:** trivial · **Confidence:** high.

### F3. Profile is ordered by the database, not by how often you change a field

- **Saw:** Prove it by putting the two lists side by side. Schema column order
  (`schema.prisma`, Profile model) vs. the order controls appear in `ProfileTab.jsx`:

  | # | Schema declares | ProfileTab renders |
  |---|---|---|
  | 1 | `sex` | Units *(hoisted)* |
  | 2 | `age` | Sex |
  | 3 | `heightCm` | Age |
  | 4 | `bodyFatPct` | Height |
  | 5 | `occupationKey` | Body fat % |
  | 6 | `activityOverride` | Goal weight |
  | 7 | `sessionsPerWeek` | Occupation |
  | 8 | `trainingStyle` | Multiplier override |
  | 9 | `minutesPerSession` | Training style |
  | 10 | `goalWeightKg` | Sessions / week |
  | 11 | `unitPref` | Minutes / session |
  | 12 | `rateLbPerWeek` | Allergies *(hoisted, deliberately)* |
  | 13 | `floorKcal` | Dietary style |
  | 14 | `excludedFoods` / `dietaryStyle` | Rate of loss |
  | 15 | `cuisinePreferences` / `…Note` | Personal floor |

  Two deviations, both documented in code as deliberate safety/UX decisions (units to the
  top so the boxes are labelled before you type; allergies above dietary style,
  `ProfileTab.jsx:722-725`). Everything else is the column order — which is also the order
  of `PROFILE_FIELDS` in `profile.js:18-25`. So: **ordered by storage, with two exceptions.**

  Measured on screen at 1586×816 (Chrome, live app): document height **1,878px** in an
  **816px** viewport — 2.3 screens. **43 visible interactive controls.** The `Rate of loss`
  card heading sits at **y = 732**; its Daily target readout and the goal date are below
  the fold. `Body`, `Job & training` and `Diet & allergies` all start at y = 189, and
  `Job & training` bottoms out ~170px above the other two, leaving a visible hole in the
  middle column (see screenshot).
- **Costs:** The field a cutter revisits — rate of loss, and the calorie number it
  produces — needs a scroll. The fields nobody edits twice (Sex, Height, Units, Personal
  floor, Multiplier override) are above it in the prime slot. "Personal floor (kcal, min
  1500)" gets the same visual weight in the Rate card as the rate picker itself, and its
  value on screen is the placeholder `default 1500`, i.e. never set.
- **Do:** Reorder into two zones in `ProfileTab.jsx`. **Zone 1, above the fold: what
  changes.** Rate of loss (with Daily target), Goal weight, Sessions/week + Minutes/session,
  Body fat %. **Zone 2, one collapsed "Set-up details" card: what doesn't.** Sex, Age,
  Height, Units, Occupation, Multiplier override, Training style, Personal floor. Allergies
  stay their own always-visible card (safety). This is a move, not a rewrite — no control
  changes behaviour.
- **Size:** medium · **Confidence:** high.

### F4. The wizard asks 16 things; only 11 of them are needed before it can show a number

- **Saw:** `SetupWizard.jsx` — 4 steps (`STEPS`, line 15-20), 16 inputs:
  - **Step 0 "Units & stats"** (7): units toggle, sex, age, height (2 boxes in imperial),
    current weight, goal weight, body fat %. *The only validated step* — `statsValid`
    (line 436) blocks Next; the other three steps let you press Next unconditionally.
  - **Step 1 "Activity"** (4): occupation (a 36-row listbox), training style,
    sessions/week, minutes/session.
  - **Step 2 "Diet"** (4): allergy search, dietary style, meals/day, snacks/day.
  - **Step 3 "Rate of loss"** (1): a 7-button rate picker, plus the "I understand" tick
    when the rate is ≥1% of bodyweight.

  Measured on the clone, what actually moves `targetKcal`:

  | changed | target |
  |---|---|
  | baseline (M, 35, 180cm, 100kg, desk, 1 lb/wk, bf 0) | 2,093 |
  | body fat 15% | **2,200** |
  | body fat 30% | **2,070** |
  | goal weight 85 → 70 kg | 2,093 *(unchanged)* |
  | goal weight 85 → 95 kg | 2,093 *(unchanged)* |
  | vegan + 2 allergens + 5 meals + 3 snacks | 2,093 *(unchanged)* |

  So **goal weight and the whole of Step 2 are irrelevant to the target.** Goal weight
  only feeds the goal-date projection and the BMI safety gate; diet/allergies/meal counts
  only matter once you generate a meal plan.
- **Costs:** Four steps and a 36-row occupation list before a first-time user sees the one
  number that tells them whether this app is worth their time. Step 2's four questions
  are asked before the user has ever seen a recipe.
- **Do:** Two changes in `SetupWizard.jsx`. (a) **Move Step 2 (Diet & allergies) out of
  the wizard** and ask it at first plan generation, where it is load-bearing — the same
  `AllergySearch` component already renders in both places, so this is a relocation.
  (b) **Show the running target on Step 3** as soon as the rate is picked: everything it
  needs is already in `d` by then, and today the user only learns the number after
  "Finish setup" completes. Net: 4 steps → 3, and the payoff arrives before the last click
  instead of after it.
- **Size:** medium · **Confidence:** high (the arithmetic is measured; the step-order
  proposal is a judgement call).

### F5. "Aggressive — acknowledged" claims an acknowledgement the app never checked

- **Saw:** Profile → Rate of loss → the status chip at `ProfileTab.jsx:910-914` reads
  `summary.rateSafety?.unsafe ? "Aggressive — acknowledged" : "Inside this app's default
  limits"`. It is driven **entirely by `rateSafety`** — a live computation of rate vs.
  current bodyweight and floor clamp (`bmrEngine.js:252-264`). It never consults
  `profile.rateAcknowledged`.

  And `rateAcknowledged` — the stored column — **is written and never read.** Grep across
  `backend/src` and `frontend/src`: the only decision that uses it is
  `profile.js:479`, which checks `body.rateAcknowledged` — the flag *in the current
  request* — not the row. `profile.js:482` then overwrites the column to mirror
  `safety.unsafe`. Nothing reads it back, ever.
- **Costs:** `rateSafety.unsafe` moves on its own as you lose weight — 1.5 lb/wk at 200 lb
  is 0.75%, the same 1.5 lb/wk at 145 lb is 1.03%. The moment you cross, the chip starts
  saying "acknowledged" about a conversation that never happened, with the stored flag
  still `false`. On a screen whose whole design ethic is "never show unsaved as saved",
  that word is the one lie on it.
- **Do:** Either drop the word — `summary.rateSafety.unsafe` → **"Above this app's ~1%
  guideline"** — or make the chip read the row: `profile.rateAcknowledged ? "Aggressive —
  you acknowledged this" : "Aggressive — not acknowledged"`. The first is one word in
  `ProfileTab.jsx:913`; the second is more honest and needs `rateAcknowledged` in the
  summary payload.
- **Size:** trivial (option A) · **Confidence:** high.

### F6. `BodyFatPicker` is good, undersells itself, is hidden, and its skip button deletes data

Judging it as asked, four separate things:

1. **The design is right.** Six abstract silhouettes (`BUCKETS = [10,15,20,25,30,35]`),
   parametric from one path, `currentColor`, no green/red, no "ideal" marker, selection is
   a lightness step, focus-trapped dialog, a measured-value escape hatch, and a "Not sure
   — skip". It obeys the colour laws and it doesn't moralise. Keep it.
2. **It undersells its own impact.** `BodyFatPicker.jsx:79` — "A minor refinement to your
   calorie estimate." Measured: bf 15% → 2,200 kcal, bf 30% → 2,070 kcal. **A 130 kcal/day
   spread on a 500 kcal deficit is 26% of the deficit** — roughly a quarter of the rate of
   loss. That is not minor, and body fat % is the field the wizard labels "(optional)".
   Fix the sentence: *"This changes your target by up to ~130 kcal a day — it unlocks two
   more BMR formulas."*
3. **It is hidden.** The only door is an 11px underlined "Estimate visually" link under
   the Body fat % box (`ProfileTab.jsx:585-589`) — confirmed on screen, it is the smallest
   text on the card. The wizard doesn't offer it at all: Step 0 has a bare number input
   with placeholder "unknown" (`SetupWizard.jsx:828-833`). So the tool that makes an
   optional-but-material field answerable is unreachable at the exact moment it's asked.
   **Do:** put the picker in the wizard, behind the same link.
4. **"Not sure — skip" is destructive with no confirm.** `skip()` at line 63 fires
   `save({ bodyFatPct: 0, bodyFatSource: null })` — so a user with a measured 18.5% who
   opens the picker to look around and clicks "Not sure — skip" **erases it**. The button
   should be "Cancel" (just `onClose()`) when `current > 0`, and only clear when there was
   nothing there.
5. *(hunch)* One silhouette shape serves both sexes — `Silhouette` takes only `pct`, never
   `profile.sex`, though ProfileTab has it. 25% on a man and 25% on a woman do not look
   alike, and the whole point of a visual picker is that it looks like you.

- **Size:** small (copy + the skip fix) / medium (sex-aware silhouettes)
- **Confidence:** high on 2-4, hunch on 5.

### F7. The "can't reach the server" screen says "the change was not sent" when nothing was changed

- **Saw:** `App.jsx:136-150` — boot calls `api.me()`. On a refused connection that throws
  an `OFFLINE` ApiError, and `describeError()` (`api.js:109`) returns *"Couldn't reach the
  app's server — **the change was not sent**. If this keeps happening, **close Cut Protocol
  completely and open it again**."* App then renders it inside its own copy
  (`App.jsx:252-255`), producing:

  > **Can't reach the app's server**
  > Couldn't reach the app's server — the change was not sent. If this keeps happening,
  > close Cut Protocol completely and open it again. You are not signed out — the app just
  > couldn't get an answer. **If this persists, close and reopen Cut Protocol.**

  Three defects in five lines: the title repeats the first clause of the body; "the change
  was not sent" is about a write, on a screen reached by a read; and the same "close and
  reopen" instruction is given twice in consecutive sentences. The same string is reused
  on the load-failure screen (`App.jsx:292-301`).
- **Costs:** The one screen a user hits when the backend hasn't finished booting reads as
  though something they did failed. It's the app's most likely first impression on a cold
  Electron start.
- **Do:** Split the OFFLINE copy into the two cases. `api.js:109` should return a
  read-safe sentence ("Couldn't reach the app's server."), and the *callers that perform
  writes* should append "— your change was not sent." Then drop the duplicated
  close-and-reopen line from `App.jsx:254`.
- **Size:** small · **Confidence:** high (code trace; not reproduced on screen — reviewers
  share one backend and I would not kill it).

### F8. `ScreenBoundary` is written, documented, and never mounted — one bad render blanks the app

- **Saw:** `ErrorBoundary.jsx:119-121` exports `ScreenBoundary`, with a 15-line doc comment
  that literally says *"Intended use, in App.jsx's `<main>`: `<ScreenBoundary label="Trend">`"*.
  Grep across `frontend/src`: the only mount is the root one in `main.jsx:24`, unlabelled.
  `App.jsx` doesn't import `ErrorBoundary` at all.
- **Costs:** `full = !this.props.label` (line 91), so the only boundary that exists renders
  the **full-screen** takeover: `min-h-svh`, sidebar gone, header gone, "Something went
  wrong" + Try again / Reload / Report. One malformed weigh-in row crashing a Recharts
  render takes down Today, Plan, Recipes and the nav with it — even though the recovery UI
  for exactly that case is already built and one line from being used.
- **Do:** Wrap each tab in `App.jsx:334-351` — `<ScreenBoundary key={tab} label="Trend">`
  etc. Eight one-line wraps. The root boundary stays as the last resort.
- **Size:** trivial · **Confidence:** high.

### F9. Every loading state is invisible to a screen reader

- **Saw:** `ui/Skeleton.jsx` — all three exports (`Skeleton`, `SkeletonCard`,
  `SkeletonRows`) hard-code `aria-hidden="true"`, and there is no live region anywhere.
  `App.jsx:212-219`'s `loading` is two bare `SkeletonCard`s in a flex box with no
  `role="status"`. Same for `ProfileTab.jsx:728`'s `<SkeletonRows rows={3} />` where the
  allergy picker will be.
- **Costs:** From a screen reader, app boot and every slow card are **silence**, then
  content appears with no announcement. Hiding the shimmer from AT is correct; announcing
  nothing in its place is not.
- **Do:** Add `role="status" aria-live="polite"` plus one visually-hidden word
  ("Loading…") to the *wrapper* in `App.jsx:213` and to `SkeletonCard`/`SkeletonRows`.
  The `aria-hidden` on the shimmer bars themselves stays.
- **Size:** trivial · **Confidence:** high.

### F10. The wizard cannot be quit and resumed

- **Saw:** All wizard state lives in one `useState` object (`SetupWizard.jsx:241-252`) plus
  a dozen sibling `useState`s. Nothing is persisted — the only `localStorage` key in the
  file is `PROVISIONAL_KEY` (line 125), which is written *after* a successful save, never
  during. `App.jsx:286` renders the wizard whenever `GET /api/profile` returns `null`
  (confirmed on the clone: a brand-new account returns `null` with a 200).
- **Costs:** Close the app on Step 3 having typed height, weight, goal, occupation and
  allergies, and you restart at Step 0 with an empty form. Back works (`:1032-1036`) and
  the left rail lets you jump back to any *completed* step (`:599-600`, `disabled={!done}`)
  — but forward-jump and resume don't exist.
- **Do:** Mirror `d` into `localStorage` on change under one key, and hydrate from it on
  mount; clear it in `finish()`. ~10 lines, reuses the `safeStorage()` helper already in
  the file. *(Lower priority than it sounds — this is a one-user desktop app and the
  wizard runs once. Listed for completeness, not urgency.)*
- **Size:** small · **Confidence:** high.

### F11. The "Allergies & exclusions (0)" jump button is dead weight at desktop width

- **Saw:** `ProfileTab.jsx:457-462`, top-right of the page head. Its own comment gives the
  reason: *"on a narrow window the Diet & allergies card stacks third, below the fold."*
  Measured on screen at 1586px: `Diet & allergies` starts at **y = 189**, the same y as
  the other two cards, fully visible without scrolling — with its own count already
  rendered inside it ("Excluded (0)").
- **Costs:** A button in the most valuable slot on the page that, at the width this app is
  designed for (standing rule 1: desktop first), scrolls you to something already on
  screen. The count appears twice, 300px apart.
- **Do:** Render it only below the `xl` breakpoint, where the stacking it exists for
  actually happens — or delete it and let the Reorder in F3 put the allergy card high
  enough that it never needed a shortcut.
- **Size:** trivial · **Confidence:** high.

---

## Cut list

Delete outright:

- **`maxPrepMin`, `budgetTier`, `allowBatch`, `maxComplexity` columns**, their four
  `leaf()` entries in `brain/constraints.js:42-45`, their `SOFT_ORDER` rungs, and their six
  lines in `export.js:856-861`. Unsettable through the API; PlanTab already owns all four.
- **The "AI recipe preferences" disclosure on Profile** (cuisine box + notes textarea,
  `ProfileTab.jsx:809-829`). The cuisine field doesn't reach the solver; PlanTab's chips do.
- **"Multiplier override"** (`ProfileTab.jsx:665-672`) — *soft cut, flagged for Shad.* It's
  a raw TDEE multiplier in the middle of a card that otherwise talks in job titles, and it
  only earns its place when `/profile/meta` fails to load. Move it into the collapsed
  "Set-up details" card from F3 rather than deleting, if the 36-occupation list is ever
  thin for a real job.
- **The duplicated "close and reopen Cut Protocol" sentence** in `App.jsx:254`.
- **The "Allergies & exclusions (N)" jump button** above `xl` (F11).

Keep despite looking cuttable:

- The two-paragraph footnotes under each Profile card. They're the only place the app says
  *why* a field exists ("Body fat % unlocks the two LBM-based BMR formulas") and Shad reads
  that kind of thing.
- The Resources card and `CoachSettings` at the bottom of Profile — correctly placed on a
  deliberately-visited screen, never nagged.

---

## Open questions for Shad

1. **Were `maxPrepMin` / `budgetTier` / `allowBatch` / `maxComplexity` ever meant to be
   *profile-level defaults* that PlanTab pre-fills from?** That's the only reading where
   the columns make sense. If yes, the fix is to add them to `PROFILE_FIELDS` and have
   PlanTab seed its filter state from the profile — the opposite of the delete I proposed
   in F1. If no, delete. I can't tell which from the code, and `brain/constraints.js`
   reading them suggests someone intended the former.
2. **`adaptiveTdee` and `proteinPriorityMode` are in the same unsettable boat, but they
   have live consumers.** `adaptiveTarget.js:77` genuinely branches on
   `profile.adaptiveTdee !== false` (the adaptive-target opt-out), and
   `PlanTab.jsx:876` keeps `proteinPriority` in **localStorage** instead
   (`storage.js#proteinPriorityPref`) — a per-machine setting where a per-user column
   already exists and is unreachable. Do you want the adaptive-target opt-out exposed in
   the UI at all, or is "always on" the intended answer?
3. **Should the wizard ask about diet and allergies at all?** F4 shows it changes nothing
   about the target — but it *is* the safety-critical control, and asking about allergies
   at first run rather than at first meal plan is a defensible safety call even though it
   costs a step. Your call, not mine.

---

*Method note: all API measurements were run against the throwaway clone on
`127.0.0.1:3002` (fresh account `ux09fresh@example.com`, created via the app's own
register + password-reset endpoints — the live `5173` session and its database were not
written to). On-screen measurements were taken read-only in one dedicated tab at
1586×816. Nothing on Profile was saved.*
