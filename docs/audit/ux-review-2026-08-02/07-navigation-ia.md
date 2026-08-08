# 07 — Information architecture and navigation: where things live

## Verdict

The map is the problem, but not in the way "eight tabs" suggests. Eight is defensible for this
app; what is not defensible is that the **top slot belongs to a settings screen**, that the
**largest dataset in the product (14,122 foods) is a hidden child whose own `<h1>` disagrees
with the nav item highlighted while you're on it**, and that a permanent slot in the chrome of
every screen is spent on a **competitor-comparison table in a single-user app**. The mechanics
underneath are unusually good — the focus-on-`<h1>` route-change pattern actually works, the
skip link is real, `aria-current` is correct — so this is a re-labelling and re-ordering job,
not a rebuild. The single highest-value edit is ~6 lines in one array.

Measured live at 1586×816, logged in as `design-qa@local`, on Today.

## What's already working

- **The SPA route-change focus pattern is real, not aspirational.** `App.jsx:85-92` moves focus
  to the new view's `<h1>`. I drove Trend → Engine → Today and read `document.activeElement`
  after each: `H1 "Trend"` (tabindex `-1`), `H1 "Engine"`, `H1 "Today"`. It works. Do not touch it.
- **Skip link is the first tab stop** (`App.jsx:322`), and every one of the 34 focusable
  elements on Today is reachable. Nothing is stranded.
- **`aria-current="page"` is on the active nav button**, and the active state is a lightness
  step + a 3px rail, not green — obeys colour law (a). The collapsed state gives icon-only
  buttons a real accessible name (`Sidebar.jsx:69-73`), and the Wellbeing dot is described in
  *words* for AT rather than left as a meaningless dot. That is careful work.
- **The Wellbeing marker has no counter and stands down on open** (`App.jsx:61-62`, 316-318).
  It is the correct amount of pointing. Leave it.
- **`NAV` genuinely is one array** (`Sidebar.jsx:11-26`) and the flags collapse cleanly into it.
  Everything I propose below is an edit to that array. The architecture already supports the fix.
- **Coach panel a11y is right**: focus moves into the textarea on open (verified —
  `activeElement` was `TEXTAREA|Message the meal-planning assistant`), Escape closes, focus
  returns to the launcher (`BrainChat.jsx:112-118`). The *placement* is wrong (F6), the
  behaviour is not.

---

## Findings

### F1. Move Today to the top slot and demote Profile out of NAV entirely

- **Saw:** `Sidebar.jsx:12` puts `profile` first; `Sidebar.jsx:13` puts `today` second. Live
  geometry: Profile's button top is y=100, Today's is y=144. Meanwhile the app itself treats
  Today as home in **three** places — `App.jsx:38` (`useState("today")`), `App.jsx:118` (reset
  on session expiry), `App.jsx:198` (reset on logout). Profile's own subtitle
  (`ProfileTab.jsx:452`) describes a configuration screen: "Your stats, activity, diet rules,
  and rate of change. Everything else in the app… derives from this tab." Its five cards are
  Body / Job & training / Diet & allergies / Rate of loss / Outside help — all set-once inputs.
- **Costs:** The cheapest, most-glanced-at position in the whole window is spent on a screen
  you open when you change jobs or change your goal rate. Every single day, the first thing
  Shad's eye lands on in the nav is not where he's going. It also makes the nav disagree with
  the app: the code says home is Today, the layout says home is Profile.
- **Do:** In `Sidebar.jsx`'s `NAV`, delete the `profile` entry and move `today` to index 0.
  Add a gear button to the sidebar footer beside the collapse/log-out controls that calls
  `setTab("profile")` — `ProfileTab` keeps rendering exactly as it does (`App.jsx:334`), it
  just stops costing a nav slot. `EngineTab.jsx:297`'s `openProfile` link keeps working
  untouched.
- **Size:** trivial (the array edit) + small (the footer gear button)
- **Confidence:** high on the reorder. The "Profile is least-visited" claim is a *structural*
  inference — a local app has no analytics — but it's supported by three code paths treating
  Today as home and by Profile's content being pure configuration.

### F2. Merge Recipes + Foods into one "Food" area — the nav currently lies about where you are

- **Saw:** Drove Today → Recipes → "Food database". On the Foods view the page `<h1>` reads
  **"Food database"** (`FoodsTab.jsx:540`) while the sidebar's `aria-current="page"` is on
  **"Recipes"** (verified live: `sidebarActive: ["Recipes"]`). The remap that causes it is
  `Sidebar.jsx:35`: `const activeId = tab === "foods" ? "recipes" : tab;`. There are two doors
  in (`RecipesTab.jsx:807` and `EngineTab.jsx:132`) and one hardcoded way out — and
  `FoodsTab.jsx:554-558`'s own comment admits the exit button used to lie about it, and leaves
  a `backLabel` prop **"once Foods gets a real nav entry of its own."** The code is already
  asking for this.
- **Costs:** 14,122 foods across 7 categories — the largest dataset in the product — sit behind
  a ghost button in another screen's header, and while you're in there the nav tells you you're
  somewhere else. Barcode lookup, which `CompareDialog.jsx:43,54` names as the app's own #1
  admitted gap ("No quick-logging"), is **3 clicks deep inside a hidden child**.
- **Do:** Rename the `recipes` NAV entry's label to **"Food"** (keep the `id` so nothing else
  moves), and put a segmented control at the top of that area — `Recipes | Food database |
  Cart` — so the sub-view is visible instead of inferred. Then `Sidebar.jsx:35`'s remap stops
  being a lie and becomes a true statement, and `FoodsTab`'s `onBack`/`backLabel` collapse into
  the segmented control. **Net top-level tab count is unchanged** — this is a truth fix, not an
  addition.
- **Size:** medium
- **Confidence:** high

### F3. Delete "How it compares" from the sidebar

- **Saw:** `Sidebar.jsx:111-122` — a permanent footer button on every screen, in both expanded
  and collapsed modes (measured live at y=709, one of only four persistent footer controls).
  It opens `CompareDialog.jsx`: a 12-row × 6-app feature matrix, 4 "wins" cards, 3 "gaps"
  cards, and two caveat paragraphs, 175 lines.
- **Costs:** This is marketing collateral, permanently mounted in the chrome of a **single-user
  app whose sole user is its author**. Shad does not need to be sold on Cut Protocol vs
  MyFitnessPal on every screen, forever. It competes for footer attention with "Report a bug",
  which is the one footer control that earns its place.
- **Do:** Remove the button from `Sidebar.jsx` and the `compareOpen` state + `<CompareDialog>`
  mount from `App.jsx:74, 233, 323`. **Keep the component and its content** — it is genuinely
  good, well-sourced, and its honest "Where it's behind" section is the best writing in the
  repo. It belongs in the README / project page where it does the job it was actually written
  for (showing people what the project is), or behind the new Settings gear as "About". Do not
  delete the file.
- **Size:** trivial
- **Confidence:** high

### F4. Delete the header bar — it repeats Today's own subtitle, verbatim, 90px away

- **Saw:** `HeaderBar.jsx:22-29` renders exactly two facts: `Day 15` and `Target 2,040 kcal`.
  Directly below it, `TodayTab.jsx:847` renders `sub={...Day ${daysIn} of protocol · target
  ${kc(...)} kcal · plan: ...}`. On screen, in one screenshot: header reads
  **"Day 15   Target 2,040 kcal"**; the PageHead sub reads **"Day 15 of protocol · target
  2,040 kcal · plan: 1 lb/wk"**. Same two numbers, twice, a few dozen pixels apart.
- **Costs:** A 48px full-width band on **every** screen, carrying zero unique information on
  the screen Shad lives in. "Day 15" is a Today concept — on Recipes or Training it is noise.
  And here's the joke: `Sidebar.jsx:107` (`{/* Day/Target moved to the HeaderBar */}`) and
  `HeaderBar.jsx:6-8` record that this pair was moved *out of the sidebar* — and I measured
  **244px of dead vertical space** in the sidebar between the last nav button and the "How it
  compares" footer button (~30% of the sidebar's height, sitting empty). The move created a
  48px band across every screen and left a 244px hole where the content used to be.
- **Do:** Delete `HeaderBar.jsx` and its mount at `App.jsx:326`; reclaim 48px of vertical on
  all seven screens. If a persistent target readout is genuinely wanted, put it back in the
  sidebar's dead zone where it costs nothing — but Today already says it, so my recommendation
  is simply to remove it.
- **Size:** trivial
- **Confidence:** high

### F5. Add Alt+1…7 tab switching — after a tab switch, the keyboard user is 11 Shift+Tabs from the nav

- **Saw:** I grepped every keyboard handler in `frontend/src/`: the only ones are Escape in
  dialogs (`useFocusTrap.js:55`, `BrainChat.jsx:185`, `ProfileTab.jsx:635`), Enter in text
  inputs, and arrow keys for day navigation in `PlanTab.jsx:961`. **There is no shortcut for
  switching tabs.** Live tab-order on Today: skip link, then the 8 nav buttons (stops 2-9),
  then How it compares, Report a bug, Collapse, Log out (stops 10-13), then main content.
- **Costs:** The focus-move at `App.jsx:85-92` (which is correct and should stay) parks you on
  the new view's `<h1>` — *inside* `<main>`, i.e. past the entire sidebar. To switch tabs again
  by keyboard you must Shift+Tab backwards through Log out, Collapse, Report a bug, How it
  compares and up the nav list: **11 Shift+Tabs to get from a freshly-switched view back to
  "Today"**, 12 to reach the first nav item. For a desktop app the author uses daily, that is
  the whole point of a keyboard.
- **Do:** One `useEffect` in `App.jsx` binding `Alt+1`…`Alt+7` to `setTab(NAV[i].id)`, driven
  off the exported `NAV` array so it stays correct automatically when the order changes. Export
  `NAV` from `Sidebar.jsx` (it is module-scope already). ~6 lines. Show the digit in each nav
  button's `title` so it's discoverable. **Do not** build a command palette — 7 destinations
  do not need search.
- **Size:** small
- **Confidence:** high

### F6. The Coach launcher covers content — move it into the sidebar footer

- **Saw:** `BrainChat.jsx:173` — `fixed bottom-4 right-4`. Measured live: 97×41 at (1463, 759)
  in an 816px-tall viewport, over a page that scrolls to 1595px. `elementsFromPoint` through
  its centre returns `BUTTON.fixed.bottom-4` → `SECTION.p-5.rounded-2xl` → the dashboard grid —
  i.e. it is sitting **on** a card, not beside one. In the screenshot it visibly covers part of
  the "Bistek" row's macro chips in the Food diary card. Open, the panel is 360×500 at
  (1200, 300) — it blankets the entire right-hand dashboard column including the Weigh-in card,
  non-modally.
- **Costs:** It is the only element in the app that overlaps content, and it does so at the
  bottom-right — exactly where a long diary list ends. Meanwhile there are 244px of empty
  sidebar (see F4). It is also effectively an 8th destination that is deliberately not in the
  nav, so it is invisible to anyone reading the sidebar as the map.
- **Do:** Move the launcher into the sidebar footer beside Report a bug (a labelled row,
  "✦ Coach"), and dock the open panel as a right-hand column rather than an overlay. Minimum
  viable fix if you don't want to move it: add bottom padding to `<main>` (`App.jsx:333`) equal
  to the launcher height so a row can never sit under it. Keep the label "Coach" — it's plain
  English and the `beta` chip is honest.
- **Size:** small (padding) / medium (dock it)
- **Confidence:** high

### F7. Delete the "MOVED — Micronutrients" tombstone card from Today

- **Saw:** `TodayTab.jsx:985-998` — a full `xl:col-span-12` card on the home screen whose entire
  content is a sentence saying the micronutrient breakdown moved to the Wellbeing tab, plus an
  "Open Wellbeing" link.
- **Costs:** A full-width row on the one screen Shad said is "too busy at the front door",
  spent on a changelog entry. He is the sole user and he approved the move — he does not need a
  permanent signpost to a decision he made. Meanwhile the same tab is *already* reachable from
  the sidebar and via the quiet Wellbeing marker.
- **Do:** Delete the card. If a pointer is still wanted, it is one line of the Wellbeing item's
  existing affordance, not a card.
- **Size:** trivial
- **Confidence:** high (the "he's the sole user so the tombstone has done its job" judgement is
  mine — if the repo is ever shown to others, a tombstone still doesn't belong on the home screen)

### F8. Deepest feature: Food database → food detail → add to recipe — 6 clicks from Today

- **Saw:** Walked it. Today → **Recipes** (1) → **"Food database"** ghost button in the
  PageHead (2) → expand a category group, e.g. "Protein 3,876" (3) → click a food tile (4) →
  **"Add to recipe"** in the detail card (5, `FoodsTab.jsx:212-216`, 300) → search and pick the
  target recipe (6). Searching instead of expanding a category saves one click but costs typing.
  Runner-up, **Add by barcode**: Today → Recipes → Food database → "Add by barcode"
  (`FoodsTab.jsx:551`) = 4 clicks — for the capability the app's own comparison table names as
  its biggest gap. For contrast, placing a recipe into a plan slot is only 4
  (`RecipesTab.jsx:354, 369`), and the grocery list is 2.
- **Costs:** The two deepest paths in the app both run through the hidden child. Every click on
  that path except the first is invisible from the sidebar.
- **Do:** F2 removes clicks 2 and 3 from every one of these (the segmented control puts "Food
  database" one click from the nav item, and the search box is the default view). No new
  feature required.
- **Size:** covered by F2
- **Confidence:** high

### F9. Collapsed sidebar is narrower, not better — and with 7 items you don't need it

- **Saw:** Toggled it (`Sidebar.jsx:30-33`, persisted via `sidebarPref`). It works cleanly:
  labels vanish, `aria-label` picks up the slack, the state is remembered. Screenshot at 72px:
  eight unlabelled glyphs, then a 270px gap, then four more unlabelled glyphs — scale, bug,
  chevrons, log-out — stacked in a column, with **Log out (the one control the brief forbids
  clicking) adjacent to the collapse toggle** and distinguished only by icon.
- **Costs:** 240→72 reclaims 168px, ~10% of a 1586px window, on a `<main>` already capped at
  `max-w-[1600px]` — so nothing meaningfully reflows. What you trade for it is a footer of four
  ambiguous glyphs, one of which signs you out. And it's solving the wrong problem: the sidebar
  isn't crowded, it's 30% empty (244px measured, F4).
- **Do:** Keep it — it's cheap, correct, and remembered — but don't invest in it, and don't
  treat it as the answer to "the sidebar is too big". F1 + F3 shrink the real footprint. If you
  touch anything here, separate Log out from the collapse toggle in collapsed mode.
- **Size:** trivial (the log-out adjacency) / none (otherwise)
- **Confidence:** high on the measurements; the "keep it" call is a judgement.

---

## Where I disagree with the brief's proposals

**"Plan + Recipes + Foods as one Food area" — half right.** Merge Recipes + Foods (F2). Do
**not** pull Plan in. Plan is an *output* on a weekly cadence — the solved week you consume;
Recipes/Foods are *inputs* on an occasional cadence — library maintenance. Folding a
high-frequency output into a low-frequency library is how you make the thing he uses harder to
reach. Plan keeps its own slot.

**"Trend + Engine as one Numbers area" — disagree.** They answer different questions on
different cadences: Trend answers *"am I actually losing?"* (weekly, after weigh-ins); Engine
answers *"why is my target that number?"* (rarely, after a Profile change). Merging them means
one screen with `CURVE` + `STATUS` + `PROJECTION` + `RECOMP` + `Step 1..4` + `AdaptiveTdeeCard`
— eight heavy cards in a single scroll, on the day Shad's stated complaint is "too much
jargon / busy." That trades a tab for a wall. **Smaller change that gets the real benefit:**
`AdaptiveTdeeCard` (`EngineTab.jsx:5`) is about *measured* burn vs predicted — the measurement
lives in Trend. Moving that one card to Trend puts each number next to the data that produced
it, without merging the tabs. Mark that as a hunch worth 10 minutes, not a finding.

**"Profile as settings behind a gear" — agree, strongly.** That's F1.

**"Foods hidden under Recipes" — wrong as built, but the fix is not an 8th tab.** F2.

---

## Proposed nav structure

```
SIDEBAR  ·  NAV array (Sidebar.jsx:11-26)
├── Today          ← was #2. Home. The app already says so in 3 places; the nav should too.
├── Plan           ← unchanged position relative to Today. The week that feeds Today.
├── Food           ← renamed from "Recipes" (id stays "recipes"). Now honestly contains:
│    ├── Recipes         ] one visible segmented control at the top of the area,
│    ├── Food database   ] replacing the ghost button + the hardcoded back button.
│    └── Cart            ] The <h1> and the highlighted nav item finally agree.
├── Training       ← unchanged. Flag-gated. Shad wants this improved, not hidden — it keeps a slot.
├── Trend          ← unchanged.
├── Wellbeing      ← stays directly below Trend, per standing rule 7's stated intent.
└── Engine         ← unchanged, last. The math, on purpose, for when he wants it.

SIDEBAR FOOTER
├── ✦ Coach        ← NEW here; moved off the floating bottom-right launcher (F6).
├── Report a bug   ← unchanged. Earns its slot.
├── ⚙ Settings     ← NEW; opens ProfileTab via setTab("profile"). Profile leaves NAV (F1).
└── Collapse · Log out   ← unchanged, but separate Log out from Collapse in collapsed mode.

DELETED
├── "How it compares" button + CompareDialog mount   → move content to README/About (F3)
├── HeaderBar (48px band on every screen)            → duplicates Today's own subtitle (F4)
└── TodayTab "MOVED — Micronutrients" card           → tombstone on the home screen (F7)

ADDED (non-visual)
└── Alt+1…7 tab switching, bound off the NAV array (F5)
```

**Top-level count: 8 → 7.** More importantly the order now reads as the actual data flow —
*what am I doing today → what's the week → what's in the library → am I training → is it
working → am I OK → why is the number that.*

**Note the diff is tiny.** Ignoring the Food merge, the primary reorder is literally the
current `NAV` array with the `profile` entry deleted and one label changed. Standing rule 7 is
correct that `NAV` in `frontend/src/components/Sidebar.jsx` is the single edit point.

### What breaks

| Change | What breaks | Fix |
|---|---|---|
| Remove `profile` from `NAV` | Nothing renders differently — `App.jsx:334` still keys on `tab === "profile"` | Add the footer gear calling `setTab("profile")` |
| Rename Recipes → Food | `Sidebar.jsx:35` `activeId` remap; `FoodsTab` `onBack`/`backLabel` (`App.jsx:339`, `FoodsTab.jsx:457, 559`); `EngineTab.jsx:132`'s second door | Segmented control replaces both the back button and the two entry doors |
| Delete `HeaderBar` | `App.jsx:326` mount only | Delete the import + the line |
| Delete Compare | `App.jsx:74, 233, 323` + `Sidebar.jsx:111-122` | Keep `CompareDialog.jsx` on disk |
| Move Coach launcher | `BrainChat.jsx:168-180` returns the launcher itself; it's mounted at `App.jsx:354` outside the sidebar | Either lift the launcher into `Sidebar` and pass an `open` handler, or keep the mount and just re-position |
| Alt+1…7 | Nothing; `NAV` needs exporting from `Sidebar.jsx` | `export const NAV` |
| **Docs** | `CLAUDE.md` standing rule 7 quotes the order in prose and will go stale the moment this lands | Update rule 7 in the same commit |

**Nothing URL-shaped breaks.** `tab` is React state (`App.jsx:38`), there is no router, so no
deep links, bookmarks, or history entries depend on the current order. That is a genuine
advantage for this change — and worth noting separately that it also means the browser Back
button does nothing in the app, which for a packaged Electron desktop app is acceptable and I
would not fix.

---

## Cut list

- **"How it compares" button in the sidebar** (`Sidebar.jsx:111-122`) — competitive marketing
  permanently mounted in a single-user app used by its own author. Content survives in the
  README; the button does not.
- **`HeaderBar.jsx` entirely** — 48px on every screen for two numbers that Today prints again
  90px lower.
- **`TodayTab.jsx:985-998`, the "MOVED — Micronutrients" card** — a full-width changelog entry
  on the busiest screen.
- **The second copy of the support resources** — `ProfileTab.jsx:937` ("RESOURCES — Outside
  help") duplicates `WellbeingTab.jsx:137` ("SUPPORT"). **Qualified cut:** `flags.js:13-15`
  deliberately keeps Profile's copy as the fallback so that hiding the Wellbeing tab never
  hides the phone numbers. That reasoning is good and should not be thrown away. Render
  Profile's card only when `WELLBEING !== "on"` — the safety net survives, the duplication
  doesn't. (Note this directly contradicts `Sidebar.jsx:124-127`'s own principle: "Keeping both
  would have meant two doors to the same room.")
- **The `foods → recipes` `activeId` remap** (`Sidebar.jsx:35`) — deleted as a side effect of
  F2, because the nav will no longer need to lie.

## Open questions for Shad

1. **Does Training earn a permanent top-level slot yet?** You said you want it improved, not
   hidden, and I've kept its slot on that basis. But it self-describes as "v1 scaffold"
   (`TrainingTab.jsx:69`). If it stays a scaffold through the next month, the honest structure
   is Training as a sub-view of Trend (the "other lever" card at `TrendTab.jsx:70` already
   points at it) — which would take top-level to 6. I did not propose that because you told us
   you want Training *improved*. Confirm which way.
2. **Do you actually open Profile weekly?** My F1 argument is structural, not measured. If you
   change your rate or weight targets often enough that Profile is a weekly stop, keep it in
   NAV — just not first. Put it last, above Engine.
3. **Is the Coach meant to be a destination or a utility?** If it's a destination you use daily,
   it should be a nav item, not a floating pill. If it's an occasional utility, the sidebar
   footer is right. Right now it's floating like a destination and labelled like a utility.
4. **Should the sidebar's 244px of dead space carry anything?** I recommend nothing — emptiness
   is a legitimate design choice and matches AURORA RINGLIGHT's calm. But if you want the
   Day/Target readout to survive the HeaderBar deletion, that's the only place it costs zero.
