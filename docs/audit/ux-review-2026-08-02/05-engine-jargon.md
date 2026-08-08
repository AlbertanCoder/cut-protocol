# 05 — The Engine tab, and jargon leakage out of it

## Verdict

Engine is **good** — better than I expected, and mostly should not be touched. Three cards
left-to-right (BMR → TDEE → Target) read as a real derivation, the ten-formula panel with
journal citations and strikethrough on the four you've switched off is genuinely proud work,
and I verified live that unticking a formula moves every downstream number *and the header*
within one render. Its one soft spot is Step 4: the macro ranges arrive as bare outputs while
Steps 1–3 show every operation.

The problem is Job B. **Jargon is not leaking from Engine — it is the app's default register.**
The first line of Today reads "Day 15 of protocol · target 2,040 kcal", the sidebar says
"RECOMP ENGINE" on every screen forever, a card on Today is titled "Verdict" with the eyebrow
"VERDICT" 8px away, and the Plan tab carries a journal citation with "g/kg fat-free mass/day"
in it. Worst concentration: **Today (the screen he lives in) and Plan.**

One correctness finding fell out of the "do the numbers agree?" check and it is the most
valuable thing in this report — see F1. Today and Trend print two different numbers under the
same label, and the Engine's whole derivation runs on the wrong one.

---

## What's already working

- **The target agrees everywhere.** Engine "Daily target 2,040 kcal" = Today "Target 2,040 kcal"
  = header "Target 2,040 kcal". Structurally guaranteed, not luck: `weighins.js:75` computes
  `computeMacros(profile, weightNowKg, target.target)`, so `macros.kcal` *is* `target.target`.
  I then unticked Mifflin–St Jeor live and watched all three move together to 2,058 in one
  render, and back to 2,040 on re-tick. Do not touch this wiring.
- **The formula-exclusion toggles work perfectly.** One click: row greys to 0.45 opacity with
  a strikethrough number, header recounts "Averaging 6 of 10" → "5 of 10", BMR 1,984 → 1,999,
  TDEE 2,540 → 2,558, floor 1,885 → 1,899, target 2,040 → 2,058, header updates too. Optimistic
  with rollback and a real error message on failure (`EngineTab.jsx:86-108`). This is the best
  interaction in the app.
- **Step 1's honesty layer.** "Dispersion, not a confidence interval — some estimators share a
  dataset or body-composition form", plus per-row notes like "Shares Schofield's underlying
  dataset — not independent" and "Weight-only; small sample". Zero of 37 competitors do this;
  it earns the tab's existence.
- **Engine's empty state** (`EngineTab.jsx:142-155`) — "There is nothing to do on this screen"
  is exactly right and rare.
- **The plain-English rewrites already landed** are good and should be the template for the
  rest: `bmrEngine.js:593-622` (verdict copy — "Slower than planned" not "SLOW"), Plan's
  "Closest fit we could find — here's what's binding" (`PlanTab.jsx:1387`), Today's "Ate as
  planned" toggle, Trend's "Not enough weigh-ins yet".
- **Engine's `<details>` JSON dump** is correctly labelled "Copy your data as JSON (raw backup)"
  and collapsed. Leave it (and the TODO at `EngineTab.jsx:357` explains why).

---

## Findings

### F1. Today and Trend disagree about the 7-day average — and Engine runs on the wrong one

- **Saw:** On screen right now, same session, same account:
  - Today → Verdict card → **"7-day avg  208 lb"**
  - Trend → Numbers card → **"Average, last 7 days  206.5 lb"**

  Cause: `backend/src/routes/weighins.js:50-52` computes `avg7Kg` from `entries.slice(-7)` —
  the last seven **rows**, whatever calendar span they cover. This account's last 7 rows run
  Aug 2 back to Jul 13 (a 21-day span); their mean is 208.0. `TrendTab.jsx:228-230` explicitly
  refuses that number — *"The headline average is the DAY-windowed one, not summary.avg7Kg"* —
  and computes the true 7-calendar-day average, which here is a single weigh-in: 206.5.

  `bmrEngine.js:535-547` already documents `slice(-7)` as the bug in prose and ships
  `trailingAverage()` as the fix. **`weighins.js` never imports it.** Trend was converted;
  Today, Profile and the engine were not.

  It propagates further than the label. `adaptiveTarget.js:142-146 weightNowKgAt()` uses the
  same `upto.slice(-7)`, and `resolveEnergy()` at line 156-157 feeds that weight straight into
  `computeEnergy(profile, weightKg)`. **So all ten BMR formulas, TDEE, the target, lean mass
  and the protein range on the Engine tab are computed from 208.0 lb** while the Trend tab
  tells him his current average is 206.5.

  It also produces two goal dates: Profile says **"Jan 9, 2027"** (`ProfileTab.jsx:429-445`,
  off `avg7Kg` = 208.0), Trend says **"Dec 29, 2026"** (`TrendTab.jsx:406-407`, off 206.5).
  11 days apart, same 1 lb/wk plan, neither screen mentions the other's number.
- **Costs:** Two screens print different values under the same words. For a numbers person that
  is the one thing that destroys trust in the whole instrument — and the project constitution
  says "wrong math = product death." The label is also simply false: for anyone not weighing
  daily, "7-day avg" describes a window that can be three weeks wide.
- **Do:** Import `trailingAverage` in `backend/src/routes/weighins.js` and replace lines 50-52;
  replace `weightNowKgAt`'s `upto.slice(-7)` in `adaptiveTarget.js:144` with the same call.
  Note this **will move the target** (a genuine correction, so log it via the existing ledger).
  Then delete `TrendTab.jsx`'s private workaround so there is one definition again.
- **Size:** small (the fix), medium (re-baselining the BMR goldens that pin the old weight)
- **Confidence:** high — both numbers read off the running app, both code paths cited.

### F2. Rewrite the first line of Today

- **Saw:** Today's PageHead subtitle (`TodayTab.jsx:847`) renders:
  **"Day 15 of protocol · target 2,040 kcal · plan: 1 lb/wk"**
  Three pieces of jargon in fourteen words, on the screen he lives in, above everything else:
  "protocol" (he is not running a protocol, he is cutting), "kcal" (nobody says kcal out loud),
  "plan:" followed by a bare rate.
- **Costs:** It is the literal front door and it is the densest jargon string in the app. The
  same three facts are already on screen twice more — the header bar says "Day 15 · Target 2,040
  kcal", and the ring card says "Target 2,040 kcal". Three renderings of the same two numbers
  in the top 300px.
- **Do:** `TodayTab.jsx:847` → `Day 15 · eat about 2,040 calories · losing 1 lb a week`. Or,
  better, **delete the subtitle entirely** — the header bar already carries Day and Target, and
  the ring card carries the target with context. That is a pure deletion.
- **Size:** trivial
- **Confidence:** high

### F3. Kill the "Verdict" card's name (it says the word twice)

- **Saw:** Today, third card from the left. Card title **"Verdict"**, eyebrow **"VERDICT"** in
  the same header row (`TodayTab.jsx:933`), then the footer line **"Verdicts judge 7-day
  averages only."** (`TodayTab.jsx:942-943`). The word appears three times in one 380px card.
  The card's actual content is good and plain: "Not enough weigh-ins yet / A pace needs at least
  8 weigh-ins inside the last 14 days."
- **Costs:** "Verdict" is a courtroom word attached to his body data, and it is the loudest text
  in a card whose body already speaks plainly. Against a standing rule that bans jargon labels
  in favour of plain English describing the action, this is the clearest violation in the app.
- **Do:** `TodayTab.jsx:933` → `<Card section="PACE" title="How your pace is going">`. Line 942
  → "This judges your 7-day average only; the fix for a wrong pace is on Profile." Sweep
  `verdict`→`pace` in user-visible strings only (the internal `summary.verdict` shape can keep
  its name — it never renders).
- **Size:** trivial
- **Confidence:** high

### F4. Explain the macro ranges on Today, or stop printing two of them

- **Saw:** Today's macro rails render (`TodayTab.jsx:131-143` via `Parts.jsx MacroBar`):
  ```
  P  Protein   199 / 185–203g
  C  Carbs     161 / 151–175g
  F  Fat        67 / min 52g
  ```
  Nothing on Today says where 185–203 or "min 52" come from. The derivation exists — protein is
  `lbmLb × 1.14 … × 1.25` (`bmrEngine.js:383-384`), fat's floor is `lbmLb × 0.3`
  (`bmrEngine.js:286, 357`) — but neither Today *nor Engine* prints the lean-mass number those
  multiply (see F6).
  Worse, this identical block renders **twice on the same screen** — once under the plan ring,
  once inside the food diary — and so does its caption, verbatim both times: *"Calories and
  protein are the walls. Fat has a minimum to clear; carbs take whatever calories are left, so
  they move the most."* I confirmed both copies in one page read.
- **Costs:** Two 3-row meters plus the same 25-word paragraph twice, ~180px of duplicated
  content on the screen he lives in, explaining ranges he still can't trace.
- **Do:** In `TodayTab.jsx:606`, drop the caption from the diary copy of `MacroRails` (keep the
  rails — planned vs eaten is a real comparison) so the sentence appears once. Change "min 52g"
  → "at least 52g". Add a one-line link under the rails: "Where these ranges come from →" to
  Engine Step 4.
- **Size:** small
- **Confidence:** high

### F5. Get the research citation off the Plan tab

- **Saw:** Plan → Steer the meal planner → Protein-priority mode, visible without scrolling
  past the first screen (`PlanTab.jsx:328-331`):
  > "Makes the meal planner defend your protein floor instead of trading it off against calories
  > — an option that misses it is ranked lower and the miss is always reported, never absorbed
  > into an otherwise-good match score. **Floor basis: Helms, Aragon & Fitschen (2014) — J Int
  > Soc Sports Nutr 11:20 — 2.3-3.1 g/kg fat-free mass/day preserves lean mass in a caloric
  > deficit.**"

  The exact same citation already renders on Engine Step 4 (`EngineTab.jsx:349-352`), where it
  belongs.
- **Costs:** A journal volume number, a g/kg figure, and "fat-free mass" on a screen whose job
  is "pick meals". It is 3 lines of a 5-line checkbox description, and it is a duplicate.
- **Do:** `PlanTab.jsx:329-331` — delete the `proteinFloorSource` block. Replace the whole
  description with: "Protects your protein target instead of trading it away for calories. If a
  day misses it, you'll be told." Keep the citation on Engine only.
- **Size:** trivial
- **Confidence:** high

### F6. Show lean body mass on Engine Step 4 — it's the one un-derived card

- **Saw:** Engine Step 4 "Macro engine" prints four bare outputs — Protein range 185–203g, Fat
  range 52–62g, Carb range ~151–175g, Fiber 25+g — and never shows the quantity they all come
  from. Steps 1–3 show every operation (`1,984 × 1.2 + 159 = 2,540`, then `− 500`, then a
  floor). Step 4 shows none.

  The server already computes and ships the missing number: `computeMacros` returns `lbmLb`
  (`bmrEngine.js:382, 449`) and it is in the summary payload. `EngineTab.jsx:322-327` renders
  the ranges and never renders `macros.lbmLb`. So the tab whose header promises "The math"
  hand-waves its most load-bearing output.

  Also unstated on that card: 1.14–1.25 g per lb of lean mass (protein), 25% of target calories
  (fat midpoint, `FAT_PCT_ENERGY_MID`), and 0.3 g/lb lean mass (the essential-fat floor).
- **Costs:** The one number he most wants to sanity-check — the protein range — is the one he
  cannot reproduce on the screen built to let him reproduce numbers.
- **Do:** `EngineTab.jsx:304-327` — add a `Line`-style derivation above the Stat grid, in the
  same shape as Step 3:
  ```
  lean mass (from 208.0 lb at 20.9% body fat)      164 lb
  × 1.14 – 1.25 g protein per lb lean              185–203 g
  25% of 2,040 calories, held above the 49 g floor  52–62 g
  = calories left over, minus a 25 g margin        ~151–175 g
  ```
- **Size:** small
- **Confidence:** high

### F7. Derive the calorie floor on Engine Step 3

- **Saw:** Engine Step 3 prints `your floor (never below)  1,885` with no derivation, in a card
  where every other row shows its arithmetic. I confirmed live what it is: unticking Mifflin
  moved BMR 1,984 → 1,999 and the floor moved 1,885 → 1,899 in lockstep. It is **RMR × 0.95**
  (`bmrEngine.js:224-228`: `max(sexFloor 1500, round(rmr × 0.95), profile.floorKcal)`).
- **Costs:** One unexplained number sitting in the middle of an otherwise fully-derived column.
  Profile separately labels the input "Personal floor (kcal, min 1500)", which implies the floor
  is 1500 — so the two screens appear to disagree until you work out the RMR rail.
- **Do:** `EngineTab.jsx:258` → label it `your floor — 95% of your resting burn (never below)`
  and, when the sex minimum or his own floor is the binding one, say which. The server already
  knows; only the label needs it.
- **Size:** trivial
- **Confidence:** high

### F8. "RECOMP ENGINE" in the sidebar, on every screen, forever

- **Saw:** `Sidebar.jsx:49-50` renders "CUT PROTOCOL" over "RECOMP ENGINE" in the top-left, on
  every tab, permanently. Same string on the login screen (`LoginScreen.jsx:147`). Trend has a
  card whose eyebrow is literally **"RECOMP"** (`TrendTab.jsx`, "The other lever / RECOMP") and
  a page subtitle beginning "Scale weight and estimated lean mass — recomposition means…".
- **Costs:** "Recomp" is gym-forum shorthand. It is the second thing his eye lands on at every
  app launch, it explains nothing, and it is on the standing no-jargon list.
- **Do:** Sidebar line 50 → delete it, or "Eat · train · track". Trend's "RECOMP" eyebrow →
  "TRAINING". Trend's subtitle → "Your weight, and how much of what you're losing is fat."
- **Size:** trivial
- **Confidence:** high

### F9. De-jargon Profile's four leaked lines

- **Saw:** All four confirmed rendering on the Profile tab:
  1. `ProfileTab.jsx:611` — "Body fat % unlocks the **two LBM-based BMR formulas**." Two
     acronyms, neither expanded anywhere on Profile.
  2. `ProfileTab.jsx:868` — under Daily target: "**TDEE** 2,540 − 500 deficit". Bare acronym;
     Engine glosses it ("total daily burn"), Profile does not.
  3. Field label "**Multiplier override**" under Occupation, and the caption "Occupation sets
     the day-to-day multiplier".
  4. The Rate-of-loss card's eyebrow reads "**PRESCRIPTION**".
- **Costs:** Profile is where a new/returning user starts, and it uses the two acronyms the
  Engine tab was built to explain — without explaining them.
- **Do:** (1) "Adding your body fat % turns on two more accurate formulas." (2) "Your daily
  burn 2,540, minus 500 to lose weight." (3) "Set the multiplier yourself" / "Your job sets how
  much you burn day to day". (4) eyebrow → "HOW FAST".
- **Size:** trivial
- **Confidence:** high

### F10. Plan's solver vocabulary

- **Saw:** On Plan, all rendering without scrolling far:
  - Card title **"This verdict is out of date"** (`PlanTab.jsx:475`) + body: "…so its **match
    percentages** and miss lines described a different plan… Regenerate to **score** what is
    here now." (`PlanTab.jsx:480-482`)
  - **"Min taste"** slider captioned "**0–1**; median across your recipes ≈ **0.58**"
  - **"Max complexity"** with options "Simple **≤3** / Moderate **≤6** / Involved **≤10**" —
    three of what, never said
  - "Caps are **hard filters** … it names which cap is **binding** rather than failing silently"
  - Big `{c.score.matchPct}%` numerals on day candidates (`PlanTab.jsx:655`) and
    `2,410 / 2,040 kcal · 195P 68F 240C` (`PlanTab.jsx:662, 1368`)
- **Costs:** "Verdict", "score", "binding", and two unitless 0–1 / ≤N scales on the screen where
  he picks dinner. The one good line here (`PlanTab.jsx:1396`: "The % is how close a day lands
  to your targets — 100% is rare and not the point") is buried *below* the candidates it
  explains.
- **Do:** Card title → "These match percentages are out of date". "score" → "check". "Min taste"
  → "Only dishes I've rated at least ★". "Max complexity ≤3/≤6/≤10" → name the unit ("up to 3
  steps"). "binding" → "which limit is blocking it". Move the line at 1396 above the cards.
- **Size:** small
- **Confidence:** high

### F11. Trend's statistics vocabulary

- **Saw:** On Trend, rendering now: "The **robust fit** the Engine uses needs three weigh-ins and
  **adaptive targeting** switched on"; the chart annotation "**LEAN MASS IF IT NEVER MOVED**
  161.1"; "estimated from a single current body-fat reading (**source unset**)"; "there is no
  **fitted trend** yet, so there is no honest range".
  Two more exist in code and render only once a fit has data, so I could not confirm them
  on screen today: "Trend line, with its **±1 standard-error band**" (`TrendTab.jsx:419`) and
  "The shaded band is **one standard error on its slope, hinged in the middle**"
  (`TrendTab.jsx:526`).
- **Costs:** "Robust fit", "standard error", "hinged" are graduate statistics on a weight chart.
  "(source unset)" is a database field leaking into a sentence.
- **Do:** "±1 standard-error band" → "the shaded area is how uncertain that line is". "robust
  fit" → "the more accurate trend line". "source unset" → "you haven't said how you measured it".
  "LEAN MASS IF IT NEVER MOVED" → "if you kept all your muscle".
- **Size:** small
- **Confidence:** high for the four confirmed on screen; the two chart-legend strings are
  code-only until a fit exists — verify before rewriting.

### F12. Engine's own two small gaps

- **Saw:** (a) Step 2 lists `BMR average 1,984`, `× Desk / office work ×1.2`, `+ training +159`,
  then `TDEE 2,540` — but never prints the product 2,381, so it is the one card where you have
  to multiply in your head to check the total. The file's own comment (`EngineTab.jsx:58-62`)
  claims "Every intermediate below is now on screen"; this one isn't.
  (b) At 1524px the Step 1 column runs past the fold (10 formulas + a citation line each) while
  Steps 2 and 3 both end around y=460 — roughly 300px × two-thirds of the window is empty
  canvas. Screenshot confirms.
- **Costs:** (a) breaks the tab's one promise, in the cheapest possible place to keep it.
  (b) the derivation's three steps are visually unbalanced; Step 4 and the adaptive card sit
  below a large void.
- **Do:** (a) add one `Line`: `= resting burn × your job  2,381`. (b) move Step 3 under Step 2
  in a 5/7 or 4/8 split so the tall formula panel doesn't strand its neighbours, or collapse
  the four default-off formulas behind "4 more formulas, off by default".
- **Size:** trivial (a) / small (b)
- **Confidence:** high (a) / medium (b) — layout is a judgement call, and 1920px may read better.

### F13. Small leaks worth a find-and-replace pass

- **Saw, each confirmed rendering:**
  - Header bar, every screen: "Target **2,040 kcal**" (`ui/HeaderBar.jsx:27`). "kcal" is the
    app's default unit everywhere; nobody says it out loud.
  - Today diary quick-add placeholders: "**P (g)**", "**C (g)**", "**F (g)**"
    (`TodayTab.jsx:547`).
  - Today ring caption: "planned **kcal**" (`TodayTab.jsx:910`).
  - Today over-target line: "swap a **slot** on the Plan tab" (`TodayTab.jsx:919`).
  - Today's unsolved-slot warnings (`TodayTab.jsx:715-716, 736`): "**1 slot** today couldn't be
    **solved** to your targets" and "caps are what usually leave the **solver** nothing that
    fits". *Conditional* — renders only when a planned slot carries a warning; none today.
    The word "solver" also appears in the plan-generation error hint (`TodayTab.jsx:900`).
  - Profile subtitle: "including the **protein floor** and lean-mass estimate".
- **Do:** "kcal" → "calories" (or nothing — the ring number needs no unit). "P (g)/C (g)/F (g)"
  → "Protein g / Carbs g / Fat g". "slot" → "meal". "solved / solver" → "the meal planner
  couldn't fit this one" / "leave the meal planner nothing that fits". "protein floor" → "your
  protein minimum". Keep every one of these words on Engine.
- **Size:** trivial
- **Confidence:** high (except the slot-warning strings, which I confirmed in code but not on
  screen)

---

## Cut list

- **Today's PageHead subtitle** (`TodayTab.jsx:847`) — every fact in it is already on screen
  twice (header bar + ring card). Deleting it removes "protocol", "kcal" and a bare rate in one
  edit. Highest ratio in the report.
- **The duplicate MacroRails caption** in the diary card (`TodayTab.jsx:606`) — 25 words, second
  verbatim appearance on the same screen.
- **The Helms/Aragon citation on Plan** (`PlanTab.jsx:329-331`) — a duplicate of the Engine copy,
  three lines long, on a meal-picking screen.
- **"RECOMP ENGINE"** (`Sidebar.jsx:50`, `LoginScreen.jsx:147`) — a permanent tagline that
  explains nothing and uses banned vocabulary.
- **`TrendTab.jsx`'s private day-windowed average workaround** (lines 228-230) — but only *after*
  F1 fixes the server, so there is one definition of "current weight" again.
- **The Engine "Spread" stat** (`EngineTab.jsx:203`) — weak candidate, flagging not recommending:
  it duplicates the ±SD line directly beneath it, and its low edge (1,909) silently excludes the
  1,842 that is visible eight rows above. The SD line alone would carry the same fact.

## Open questions for Shad

1. **F1 will move your target** when the 7-day average is fixed (208.0 → 206.5 here, so BMR/TDEE
   and the daily number all shift down a little). Do you want that as a one-off logged correction
   through the existing adjustment ledger, or held until a week boundary?
2. Do you want **"kcal" replaced app-wide with "calories"**, or kept as the unit on Engine only?
   It is currently the default unit on every screen including the persistent header.
3. Should the **four default-off BMR formulas** stay expanded on Engine (10 rows + 10 citations
   is what makes Step 1 overrun its neighbours), or collapse behind "4 more formulas, off by
   default"? The information is the tab's whole value, so I did not recommend hiding it — your
   call.
4. Two Trend chart-legend strings ("±1 standard-error band", "one standard error on its slope,
   hinged in the middle") only render once a fitted trend exists, which this account does not
   have. Worth confirming on an account with 14 days of weigh-ins before rewriting them.

---

*Method note: I toggled Mifflin–St Jeor off and back on once on the shared `design-qa@local`
session to test the exclusion controls (the assigned question) and reverted it immediately —
the header read 2,040 again before I moved on. No other shared state was changed.*
