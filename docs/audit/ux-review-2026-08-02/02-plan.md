# 02 — The Plan tab: week board, swaps, locks, grocery list

Reviewed at 1477×812 (Chrome, tab 569901664), live `design-qa@local` session, against
`frontend/src/components/PlanTab.jsx` (1532 lines) and `backend/src/routes/plans.js` (865 lines).

## Verdict

The prior is right, but not for the reason I expected. Plan isn't doing too many *things* —
it's doing four things in the wrong order. **At 812px of viewport height you can see the
generate controls, the filter panel, and an apology, and not one meal name.** The week board,
which is the only reason to open this tab, starts at roughly y=800 — one pixel of it peeks
above the fold. Behind that layout problem sits a real defect: the solver's "here's what's
binding and why" narration — the single rarest thing this app does — is never written to the
database, and is destroyed by the most common action on the screen (swapping a meal). I found
it already destroyed on the live account when I arrived.

The worst of it, in order: (1) the verdict is gone, (2) the board is below the fold, (3) when
you do reach the board its day columns are unreadable.

## What's already working — do not touch

- **Swap is 2 clicks and the alternates are honestly scored.** Click the circular-arrow icon,
  click "Use". The panel shows `High-Protein Turkey & Bell Peppers with Rice / 664 kcal ·
  64.2P · 98% fit` — kcal, protein and a fit % per option. That is a genuinely good micro-flow
  and it is fast. Keep it exactly as is.
- **The empty-state copy is honest and specific.** `"No eligible snack recipe left for this
  slot."` on an unfilled slot, and `"Tried 2 recipe(s) for this slot, none fit within
  tolerance — closest was …"` — real strings, in the live DB. Most competitors would have
  silently inserted a filler meal. Don't let a redesign lose these.
- **The withheld grocery total.** `PlanTab.jsx:1505-1520` deliberately refuses to print a
  weekly total because the server prices consumed grams while the lines show retail packages,
  and says so in plain words. Refusing to show a confidently-wrong number is exactly right.
- **`stripSourcePaths`** (`PlanTab.jsx:79-83`) catches the backend leaking `see
  src/lib/groceryPrices.js` into shopping-list copy. Defensive and correct.
- **The lock's tooltip strings are the best copy on the screen**: `"Locked — survives a
  regenerate"` / `"Unlocked — a regenerate can replace it"` (`PlanTab.jsx:786`). The words are
  perfect. The problem is only that they live in a `title=` attribute (see F5).
- **The day-options race guard** (`PlanTab.jsx:895-928, 1090-1100`). Not UX, but it prevents
  Monday's meals being written into Tuesday. Leave it alone.

---

## Findings

### F1. The solver's verdict is never persisted, and one swap deletes it for the whole week

- **Saw:** On arrival at the live Plan tab, the card where the solver narration should be reads
  **"This verdict is out of date"** — "The meals changed after the meal planner last scored
  this week, so its match percentages and miss lines described a different plan — they are
  hidden rather than shown as current." No match %, no per-day strip, no diagnosis, no binding
  constraint. That is the state Shad's app is in *right now*.

  Cross-checked to the backend, and the history is still live:
  - `backend/prisma/schema.prisma:530-561` defines `Plan.verdict`, `Plan.diagnosis`,
    `Plan.verdictAt`, `Plan.verdictSlotSig`, with a long comment explaining why they exist.
  - `POST /plans/generate` builds a full `meta` object — `matchPct`, `attempts`, `score.days[]`,
    `diagnosis`, `poolCounts`, `variety` (`plans.js:456-488`) — and returns it in the response.
  - **It never writes any of it.** `grep -rn "verdict" backend/src/` returns zero hits in
    `routes/plans.js`. Confirmed against the real DB: the `design-qa@local` plan for 2026-07-27
    has `verdict null diagnosis null verdictSlotSig null`. Same for all three plan rows I
    checked.
  - So `resolveVerdict` (`PlanTab.jsx:456-468`) always falls through the DB branch to the
    localStorage mirror — one record, newest-only, browser-local.
  - `planSlotSig` (`PlanTab.jsx:387-397`) hashes `recipeId + proteinScale + sidesScale` per
    slot. **Applying one alternate changes that hash**, so `judgeVerdict` marks the stored
    verdict `"mutated"` and `StaleVerdict` replaces the entire narration.

- **Costs:** Swap one Sunday snack and you lose the honest report on all seven days —
  the average match %, the per-day match strip, the miss lines for every day that landed
  outside tolerance, and the binding-constraint line. The only way back is a full regenerate,
  which throws away the swap you just made. That is a loop with no exit: *improve one meal → lose
  the verdict → regenerate to get the verdict → lose the improvement.* And because nothing is
  in the DB, clearing browser storage or opening the app on another machine loses it too.
  The constitution says "Solver declares 'unsolvable + why' — silent target misses are
  forbidden." Right now the declaration survives until the first click.

- **Do:** Two changes, in this order.
  1. `backend/src/routes/plans.js` — inside the per-week transaction (~line 421-441), write
     `verdict: meta`, `diagnosis: result.diagnosis`, `verdictAt: new Date()`,
     `verdictSlotSig: <sig computed with the same recipe as planSlotSig>` onto the plan row.
     The columns, the migration, and the reader all already exist; this is the missing write.
     Then delete `readMirror`/`writeMirror` and their two call sites (`PlanTab.jsx:412-437,
     1051`) — the file's own comment says that's the plan.
  2. Stop treating a swap as total invalidation. When one slot changes, the other six days'
     verdicts are still true. Either re-score server-side on `POST /apply` (the endpoint
     already rebuilds and re-validates the slot), or narrow staleness to per-day: mark the
     mutated day's card stale and keep the rest. Whole-week invalidation from a single-slot
     edit is the wrong granularity for a screen whose whole purpose is single-slot edits.
- **Size:** medium (1) / medium (2)
- **Confidence:** high — verified in code, in the live DB, and on screen simultaneously.

### F2. Nothing but configuration is above the fold — put the week board first

- **Saw:** Plan tab at 1477×812, scroll position 0. Top to bottom: `PLAN` heading + subtitle
  (~50px), **"How much to generate"** card (~106px), **"Steer the meal planner"** filter card
  (~398px), the stale-verdict card (~97px). The week board's first row of pixels lands at
  ~y=800. **Zero meal names are visible without scrolling.** One 5-tick scroll gesture is
  required before you can read what you are eating.
- **Costs:** Every visit to Plan starts with a scroll past ~730px of controls you touch maybe
  once a month, to reach the content you came for. It also means the first thing the screen
  says to you is a horizon picker and a cuisine grid — which is precisely the "too much jargon
  / busy at the front door" complaint, relocated from Today to Plan.
- **Do:** In `PlanTab.jsx:1255-1263`, move `<HorizonBar>` and `<FiltersBar>` out of the top-level
  flow. Order should be: PageHead + Generate button → **week board** → selected day's meals.
  Both config cards go behind the Generate button as a popover/disclosure (see F6) or below the
  fold. Nothing else on the page needs to move.
- **Size:** small (it's a reorder of two JSX blocks plus a disclosure wrapper)
- **Confidence:** high

### F3. The week board's day columns are unreadable — names truncate at ~14 characters

- **Saw:** With seven columns across ~680px of the left rail, each cell is ~97px wide. The
  live board reads, column by column:

  | Mon 27 | Tue 28 | Wed 29 | Thu 30 | Fri 31 | Sat 1 | Sun 2 |
  |---|---|---|---|---|---|---|
  | Classic Chick… | Spiced Chick… | Stir-Fried Chi… | Classic Chick… | Mediterranea… | Thai Chicken … | Bistek |
  | Fiesta Chicke… | Classic Chick… | Corned Beef … | Thai Chicken … | Conch Stew | Blackened Tu… | Arroz con ga… |
  | Ground Beef … | Spiced Chick… | Grilled Chicke… | Conch Stew | Garlic Chicke… | Corned Beef … | Thai Chicken … |
  | Greek Yogurt,… | Greek Yogurt,… | Greek Yogurt … | Edamame wit… | Greek Yogurt … | Cottage Chee… | Greek Yogurt,… |
  | 2,041 kcal | 2,041 kcal | 2,040 kcal | 2,038 kcal | 2,040 kcal | 2,043 kcal | 2,081 kcal |

  The recipe library's names share long prefixes — *Classic / Fiesta / Thai / Spiced Chicken &
  Bell Peppers with Rice* are four different dishes that all truncate inside the first word
  that distinguishes them. The one field that isn't truncated, kcal, spans 2,038–2,081: six of
  seven days are within 5 kcal of each other, so it carries no signal either.
- **Costs:** The direct answer to "can you tell at a glance what you're eating today vs
  Thursday" is **no**. To actually learn the week you click each day and read the detail cards
  below — 7 clicks and 7 scroll-and-reads for information the board exists to give you in one
  look. The board currently costs 120px of vertical space and returns a column of ellipses.
- **Do:** Three cheap fixes in the board block (`PlanTab.jsx:1318-1350`), in order of payoff:
  1. Show a **short name**, not a truncated one. Either add a `shortName` to the recipe model,
     or render the distinguishing head of the name (first 2 words) plus the protein, e.g.
     "Classic Chicken" / "Fiesta Chicken". Truncation always cuts at the wrong place; a
     deliberate short label doesn't.
  2. Drop the per-day kcal line, or replace it with the **delta from target** (`+41`, `−2`) —
     four identical 2,04x numbers is worse than nothing; a signed delta is the number that
     changes.
  3. Give each cell a `title=` with the four full names, so hover answers the question without
     a click. (One attribute, ~2 lines.)
- **Size:** small (2 and 3) / medium (1, needs a data decision)
- **Confidence:** high on the diagnosis; the specific short-name scheme is my suggestion, not
  a verified fix.

### F4. Regenerate is one click, no confirmation, and no undo — and the board never shows what's protected

- **Saw:** The primary green button top-right reads **"Regenerate 1 week"**. One click fires
  `POST /plans/generate` immediately (`PlanTab.jsx:1240-1245` → `generate()` at :1015). There is
  no confirm step and no post-hoc undo. Server-side, `plans.js:430-436` deletes every slot in
  the covered days except those `slotIdsToKeep` (`plans.js:41-47`) preserves, and then upserts
  the solver's fresh slots over the rest. Locked slots survive; **every unlocked slot you
  hand-swapped is overwritten.**

  What the UI tells you beforehand: the PageHead subtitle `"Week of Jul 27 · locked meals
  survive a regenerate · as close as your recipes allow"` (`PlanTab.jsx:1237`), and a similar
  clause in the horizon summary line (`:135`). Both are stated as what *survives*, never as
  what is *lost*, and both are ~11px `--faint` text.

  Worse, the information you'd need to judge the risk isn't on the board. The live plan has
  **1 locked slot out of 28** — Sunday's *Bistek* — and the week board renders no lock
  indicator at all. To find out which meals are protected before you press the button you must
  click all 7 days and hover 28 rows.
- **Costs:** The single most destructive control on the screen is one unconfirmed click, and
  the state that determines what it destroys is invisible at the moment of decision. With 27
  of 28 slots unlocked, "Regenerate 1 week" currently means "discard 27 meals" and never says
  so.
- **Do:**
  1. Put a **lock pip** in the week-board cells — one small padlock next to a locked meal's
     name in `PlanTab.jsx:1335-1340`, beside the existing warning triangle. Cheapest, highest
     value: the board becomes the thing you read before pressing Regenerate.
  2. Make the button label count the loss: `Regenerate 1 week (23 meals will change, 5
     locked)`. The numbers are already derivable from `slotsByDay`. No modal, no extra click —
     it just stops being a surprise. (Per the brief, do **not** add a native `confirm()`.)
  3. Longer term: keep the pre-regenerate slots for one undo. The plan row is rewritten
     transactionally per week already, so a "restore previous week" is a snapshot away.
- **Size:** trivial (1) / small (2) / medium (3)
- **Confidence:** high on 1 and 2; 3 is a suggestion.

### F5. Locking a meal silently removes its swap button

- **Saw:** `PlanTab.jsx:789` — `{!slot.locked && (<button …swap…>)}`. On screen: Sunday's
  *Bistek* (the one locked slot) shows two action buttons; every other row shows three. The
  swap icon is simply absent, with no disabled state, no tooltip, and no explanation.
- **Costs:** A new user who locks a meal and then wants to change it finds the control they
  used ten seconds ago has vanished. There is nothing on screen connecting its disappearance
  to the padlock they clicked. Combined with the fact that both icons are unlabeled 14px
  glyphs in 28px squares — and that the swap and cart icons are `opacity: 0` until you hover
  the row (`frontend/src/index.css:224-227`) — a control disappearing is indistinguishable
  from a control you haven't hovered hard enough.
- **Do:** Render the swap button always; when the slot is locked, `disabled` it with
  `title="Unlock this meal to swap it"`. Two lines in `PlanTab.jsx:789-796`. A disabled control
  that explains itself teaches the lock's meaning; a missing one teaches nothing.
- **Size:** trivial
- **Confidence:** high

### F6. The 398px filter panel forgets everything you set in it

- **Saw:** "Steer the meal planner" is the tallest card on the screen — 8 cuisine chips, 3
  selects, a checkbox, three "optional caps" with sliders, a protein-priority block with a
  journal citation (*Helms, Aragon & Fitschen (2014) — J Int Soc Sports Nutr 11:20*), and four
  paragraphs of explanatory body copy. Measured ~398px tall, permanently expanded, second card
  on the page.

  Its state is component-local and **not persisted**: `PlanTab.jsx:872-877` initialises
  `cuisines: []`, `protein: ""`, `budget: null`, `maxPrepMin: null`, `allowBatchRepeats: false`,
  `maxCostCad: null`, `maxComplexity: null`, `minTaste: null`. Only `proteinPriority` reads from
  storage (`proteinPriorityPref.get()`). **Eight of nine filter fields reset to default every
  time you leave the tab and come back.**
- **Costs:** 398px — nearly half a viewport — of prime real estate on a daily screen, holding
  settings that (a) you change roughly monthly and (b) it throws away anyway. It is also the
  densest jargon on the tab ("Min taste ≥ 0.58", "Max complexity ≤ 6", a citation) sitting
  above the food.
- **Do:** Collapse the whole card into a disclosure attached to the Generate button —
  "Generate 1 week ▾" opening horizon + filters together, since they are one decision made at
  one moment. Show the active filters as a one-line summary chip row when any are set
  ("Mexican · ≤30 min · protein-priority"), and nothing at all when none are — which is the
  default state and the state it always returns to. Separately, persist the filter object to
  localStorage the way `proteinPriorityPref` already does; a control that resets silently is
  worse than one that isn't there.
- **Size:** medium
- **Confidence:** high (both the height and the reset are verified)

### F7. The grocery list is 71 items long, lists 4 g of brown sugar as a line to shop for, and makes the page 3,000px tall

- **Saw:** The list lives in the right rail of Plan, generated (`Regenerate from this week` /
  `Copy` / `Text` / `Email`). Live content, `PANTRY / DRY GOODS` section, verbatim:
  `All purpose flour 35 g · ≈¼ cup · ≈$0.05` · `Brown Sugar 4 g · ≈$0.01` · `Flour 18 g ·
  ≈$0.03` · `Sesame Seed Oil 21 g · ≈$0.17` · `Soy Sauce 20 g · ≈$0.12`. 71 items total in the
  DB for this plan.

  Two things there: **"All purpose flour" and "Flour" are separate lines** (35 g and 18 g) —
  the same pantry item split by name; and nobody shops for 4 g of brown sugar.

  Layout consequence: the grocery card is the tallest thing on the page by a wide margin, and
  the two columns share one scroll container (`xl:grid-cols-12`, `items-start`,
  `PlanTab.jsx:1312`). Scrolled to the bottom, the left half of the screen from y≈340 down is
  **completely empty black** while the grocery list runs on for another ~2,000px.
- **Costs:** The screen's total height is set by a shopping list, not by the plan. You scroll
  past a mostly-empty left column to read it, and the list itself has a signal problem —
  genuinely shoppable items (750 g couscous, 435 g quinoa) sit in an alphabetical stream with
  4 g of sugar and 18 g of flour, given equal visual weight and equal checkbox.
- **Do:**
  1. **Threshold the pantry lines.** Anything under a plausible purchase minimum (say <25 g of
     a dry good, <15 ml of an oil/sauce) rolls into one collapsed "Pantry staples you probably
     have — 11 items" row that expands. Belongs in `backend/src/lib/groceryList.js`, not the
     component.
  2. Fix the `All purpose flour` / `Flour` duplicate — that is a food-library alias problem
     and is likely the same class of issue as the known 470-row food corruption.
  3. Move the grocery list out of the Plan column layout — its own collapsible drawer or its
     own view. It is a *Saturday* screen; Plan is a *daily* screen. Sharing a scroll container
     costs Plan ~2,000px of height every day to serve a weekly task.
- **Size:** small (1, 2) / medium (3)
- **Confidence:** high on the observations; the specific gram thresholds are my suggestion.

### F8. "Meal structure" is a Profile setting occupying the top of Plan's right rail

- **Saw:** `PlanTab.jsx:1427-1447` — a card holding two number inputs, `Meals / day` (3) and
  `Snacks / day` (1), with the footnote "Applies on the next generate/regenerate." It writes
  straight to the profile (`api.putProfile`, `:979`). It sits above the grocery list, in the
  first screenful of the right column.
- **Costs:** It's a once-a-quarter decision holding a permanent slot next to the daily content,
  and its own copy admits it does nothing until you regenerate. It also creates a second place
  where profile data is edited, so "where do I change my meals per day" now has two answers.
- **Do:** Move both inputs into ProfileTab where the rest of the profile lives. If Plan needs
  the affordance, one line under the Generate disclosure: "3 meals + 1 snack — change in
  Profile". This is the cleanest pure deletion on the screen.
- **Size:** trivial
- **Confidence:** medium — worth confirming with Shad that he doesn't tune this from Plan
  deliberately (F-open-1).

### F9. The board marks the *selected* day but never marks *today*

- **Saw:** `activeDay` initialises to today (`PlanTab.jsx:871`) and selection renders as a
  lightness step (`:1325`). After I clicked Mon, the MON column was highlighted and the SUN
  column — the actual today — carried no marker of any kind. The date numbers (27, 28, …, 2)
  are the only clue, and they're 10px `--faint`.
- **Costs:** One click away from landing, the screen no longer tells you where "now" is. On a
  tab whose subtitle is "Week of Jul 27", knowing which of those seven columns is the meal you
  are about to eat is the most important single fact on it.
- **Do:** A persistent "TODAY" label or accent dot on the current day's column header,
  independent of selection. Note the color law: today is not on-target/success, so it must be
  a lightness step or a `--faint` label, not `--accent`.
- **Size:** trivial
- **Confidence:** high

---

## What a one-screen Plan would look like, and what it would lose

**The one screen, top to bottom:**

1. `PLAN — Week of Jul 27` + one primary button, `Generate 1 week ▾`, whose disclosure holds
   horizon + filters + caps (F6), and whose label states what regenerating costs (F4).
2. **The week board, full width.** Seven columns, readable short names, a today marker, a lock
   pip and a warning triangle per slot, and a signed delta instead of a fourth identical kcal
   number (F3, F4, F9). This is the screen's subject and it should be its first object.
3. **The selected day**, as it is now — the SlotCards are good.
4. **The verdict strip**, folded into the board rather than stacked above it: each column
   already has room for its own match %, which is exactly what `meta.score.days[]` contains
   (`plans.js:466`). The per-day miss lines belong under the selected day. That removes a whole
   card and puts the honesty *on* the thing being judged.

Grocery moves to a drawer. Meal structure moves to Profile.

**What it loses:** almost nothing that gets read. The casualties are the filter panel's
explanatory paragraphs — the protein-floor citation, the "caps are hard filters" note, the
"cuisine/protein/budget are preferences, diet and allergies are absolute" line. Those are
genuinely good, genuinely honest copy, and they should move *into the disclosure* rather than
be deleted — they're reference text, and reference text belongs where you go looking for it,
not where you land.

The one real trade-off: today the whole configuration surface is visible at once, so you can
see every input to the solver without opening anything. That matters to a numbers person, and
it is the one argument for the current layout. My answer is that this belongs in Engine (where
Shad already agreed the math lives) or in the disclosure — not on the front of the screen he
opens every day to find out what's for dinner.

---

## Cut list

- **`Meal structure` card** (`PlanTab.jsx:1427-1447`) — a Profile setting in Plan's prime right
  rail; its own copy says it does nothing until you regenerate.
- **The per-day kcal line in the board cells** (`PlanTab.jsx:1342`) — six of seven days within
  5 kcal; it's four characters of noise per column. Replace with a signed delta or drop it.
- **The `readMirror` / `writeMirror` localStorage layer** (`PlanTab.jsx:412-437, 1051`) — delete
  it the moment `POST /plans/generate` writes `Plan.verdict`. The file's own comment already
  says so.
- **The `HorizonSummary` card** (`PlanTab.jsx:203-227`) — it only renders for multi-week
  horizons and repeats data the board could carry. Low confidence; I never saw it on screen,
  since the default horizon is 1 week. Verify before cutting.
- **The `Text` / `Email` grocery buttons** (`PlanTab.jsx:1465-1470`) — `sms:` and `mailto:`
  links on a desktop Electron app for a single user who is also the only shopper. `Copy` next
  to them already covers it. Hunch, not a finding.

## Open questions for Shad

1. **Do you ever change meals/snacks per day from the Plan tab specifically?** If it's a
   deliberate "tune it right before I regenerate" workflow, F8 is wrong and it should stay.
2. **Have you ever used a lock?** The live plan has 1 locked slot in 28, and one other plan row
   in the DB has 0 in 42. If locks are effectively unused, the honest question isn't "how do we
   explain locks better" — it's whether the feature earns its two icons and its branch in the
   regenerate path at all. I can't tell from the data whether that's a discoverability failure
   or a feature you don't want.
3. **When a swap invalidates the verdict, which would you rather have** — the per-day verdicts
   for the six days you didn't touch, or nothing until you re-score? F1's fix branches on that
   answer.
4. **Is the grocery list something you open on Plan, or would you rather it were its own
   screen?** F7's third recommendation depends entirely on this and I'd be guessing.
