# 04 — Trend, the weigh-in habit loop, and adaptive TDEE

## Verdict

The Trend tab is the most carefully-built screen in this app and also the one that
currently answers "is the cut working?" with a dash. The chart's *engineering* is
excellent — real time axis, an honest fit that refuses to be drawn across days it never
saw, disclosed outliers, a keyboard-reachable table. The problem is arithmetic drift
between screens and one chart carrying two series 45 lb apart.

Right now, live, on the same data at the same moment: Today says his 7-day average is
**208 lb**, Trend says **206.5 lb**, and both call it "7-day average". Trend's headline
Rate is **"—"** and the Projection has silently fallen back to the pace he *typed* rather
than the pace he's *measuring*. The two-week-gap handling is split down the middle: Trend
is scrupulously honest about staleness, Today says nothing at all — and Today is where he
lives.

Worst of it, in order: (1) three different definitions of "7-day average" and two of
"rate", (2) Today has no staleness copy so a fortnight-old verdict reads as current news,
(3) the weight chart spends 78% of its vertical range on a line that is arithmetically
scale-weight × 0.78.

---

## What's already working

Do not touch these.

- **The x-axis on the big chart is a real number line** (`TrendTab.jsx:346-354, 463-468`).
  On screen the Jul 19 → Aug 2 gap is correctly wide while Jul 10 → Jul 11 is narrow. The
  comment at `:336-345` explains exactly why that matters and it's right.
- **The fit refuses to be ruled across days it never saw.** `drawEndX = min(endX, last
  weigh-in)` (`TrendTab.jsx:258`) and the projection starts from `fit.at(fit.drawEndX)`,
  not `fit.at(today)` (`:396-404`). This is the single most likely place to silently
  credit someone with weight they never lost, and it's guarded. Same for the sanity rail
  at `:269-271` that drops the line rather than draw a confident wrong one.
- **Outlier handling is disclosed, not hidden** (`:182-204`, `:547-555`): named out loud,
  kept in the table, kept in the data, with an instruction to fix it.
- **`LegendKey`** (`:109-130`) draws a *sample of the mark* beside text instead of asking
  the reader to match a colour from memory. Keep this pattern; it's better than most
  commercial dashboards.
- **The thin-window honesty line.** On screen: "That average covers 1 weigh-in in the last
  7 days — it is a short window, not a smooth one." (`:629-634`). That is exactly the
  right voice and exactly the right moment.
- **The table under the chart** (`:583-615`) — every value, keyboard-reachable, tooltip as
  enhancement not gate.
- **The projection cone** (Most likely / fast edge / slow edge, `:669-691`) beats a single
  hard date, and the "planned, not measured" disclaimer on the fallback is honest.
- **Colour law is respected on this screen.** No red anywhere on trend or body data.
  Accent green appears on exactly one mark (the trend/average line — explicitly sanctioned
  by law a). Goal line is faint dashed grey, outlier note is calm amber. Clean.
- **`WellbeingTab.jsx:60-70` derives its pace sentence from the numbers**, with a comment
  explaining it deliberately does *not* string-match the verdict copy. That's the right
  call and it's documented.

---

## Findings

### F1. One weigh-in, three "7-day averages" and two "rates" — pick one and ship it from the server

- **Saw:** At the same moment, on the same 11 weigh-ins:
  - Today → Verdict card → **"7-day avg 208 lb"** (screenshot; `TodayTab.jsx:936`,
    rendering `summary.avg7Kg`).
  - Trend → Numbers card → **"Average, last 7 days 206.5 lb"** (screenshot;
    `TrendTab.jsx:623`, rendering its own `avg7`).

  Three implementations:
  1. `backend/src/routes/weighins.js:50-52` — `entries.slice(-7)`, the last seven **rows**.
     With the two-week gap that window actually spans **2026-07-14 → 2026-08-02, twenty
     calendar days**, and is labelled "7-day avg".
  2. `TrendTab.jsx:213-230` — the last seven calendar **days**, anchored on each weigh-in.
     Correct, and its comment (`:206-212`) describes the row-vs-day bug precisely.
  3. `TodayTab.jsx:838` — `s.slice(Math.max(0, i - 6), i + 1)`, the last seven rows again,
     for the snapshot chart's heavy line.

  `bmrEngine.js:549` already contains the correct primitive, `trailingAverage()`, which
  even returns `count`, `stale` and `staleDays`. **The summary route does not call it.**

  Same split on rate: Today's "Rate" is `summary.rate` = `trendRate` (OLS, 14-day window,
  `bmrEngine.js:486-518`). Trend's "Rate (fitted)" prefers `-fit.slope * 7` (Huber-robust,
  exponentially weighted, ≤56 days, `TrendTab.jsx:414`). Two estimators, one label.
- **Costs:** He is a numbers person. The first time he notices 208 and 206.5 on two tabs
  he will stop trusting both, and he will be right to. It also means "7-day average" is
  a lie on Today whenever he skips days — which is the normal case.
- **Do:** Have `/weighins/summary` call `bmrEngine.trailingAverage(entries, { asOf })` and
  ship `{ avg, count, staleDays, stale }`. Delete the recomputation in `TrendTab.jsx:213-230`
  and `TodayTab.jsx:835-841` and render the server field on both. Do the same for rate:
  one rate, computed once, labelled the same way everywhere.
- **Size:** small (backend), small (delete two frontend blocks)
- **Confidence:** high

### F2. Today never says the numbers are stale — so a fortnight-old verdict reads as today's news

- **Saw:** `TrendTab.jsx:641-645` prints, when `staleDays > 3`: *"Last weigh-in was N days
  ago, so every number here describes that day, not today."* Grepping `TodayTab.jsx` for
  `staleDays` / "days ago" / "last weigh" returns **nothing**. The Verdict card
  (`TodayTab.jsx:933-945`) has no staleness branch.

  I reconstructed the pre-gap state through the shipped engine (`bmrEngine.trendRate` +
  `verdict` on the ten July weigh-ins, `daysIn: 15`). Today's Verdict card read:

  > **A little faster than planned** — 1.3 lb/wk against your 1 lb/wk plan. Fine for a
  > week — worth another look at this time next week.

  That is computed over **Jul 6 → Jul 19**, because `trendWindow` anchors on the *last
  weigh-in* when no `asOf` is passed (`bmrEngine.js:499-511`) and `weighins.js:53` calls
  `trendRate(entries)` with no options. Present tense. "This time next week." Fourteen
  days old. No qualifier anywhere on the card.
- **Costs:** The highest-emotion sentence in the app tells a man who has not stood on a
  scale in two weeks that his cut is going fine. That is worse than saying nothing.
- **Do:** (a) pass `asOf` into `trendRate` at `weighins.js:53` so the window is anchored on
  today, which makes `verdict` correctly return "Not enough weigh-ins yet"; (b) render the
  Trend tab's staleness sentence in the Verdict card too. One shared string.
- **Size:** small
- **Confidence:** high

### F3. The weight chart gives 78% of its height to a line that is scale weight × 0.78

- **Saw:** Trend chart y-axis on screen runs **157 → 214** (57 lb) to tell a **2.9 lb**
  story ("Lost (from start) 2.9 lb"). The plot is 380 px (`TrendTab.jsx:454`), so the
  entire weight trajectory — the reason the chart exists — occupies roughly **19 px**. On
  screen it is a flat line hugging the top gridline.

  The range is forced by the lean-mass series, which is
  `lean: r.avg * (1 - bfFrac)` (`TrendTab.jsx:297`), where `bfFrac` is a **single constant**
  from the profile (`:169`). It is an affine transform of the average line. It cannot show
  one thing the average line doesn't. The card's own caption admits it: *"estimated from a
  single current body-fat reading … not a measured trend"* (`:557-565`).
- **Costs:** The chart that answers "is this working?" is visually flat, and the flatness
  is bought with a redundant series. Answering "what does this chart show" requires reading
  four paragraphs of caption below it.
- **Do:** Remove the `lean` `<Line>` (`:497-501`) and the lean `ReferenceLine` (`:486-491`)
  from the weight chart. Lean mass already has a Stat in the Numbers card ("Lean mass
  (est.) 161.1 lb"). The y-domain then collapses to the real weight band and the cut
  becomes visible.
- **Size:** small
- **Confidence:** high

### F4. "LEAN MASS IF IT NEVER MOVED 161.1" is drawn at the wrong number and contradicts the card next to it

- **Saw:** The reference line is drawn at `leanNow = avg7 × (1 - bfFrac)` = 161.1
  (`TrendTab.jsx:231`, `:486-491`) and labelled *"LEAN MASS IF IT NEVER MOVED"*. But "never
  moved" is `lbmAtStart = startW × (1 - bfFrac)` = **163** — the number the Numbers card
  prints two feet to the right: *"assumes lean mass held at 163 lb since your start
  weight"* (`:646-648`, visible in the screenshot).

  Worse, the lean *series* ends at exactly `leanNow`, so the "bound" line passes through
  the series' own endpoint. The caption says *"Your real path sits between the two"*
  (`:563`) — but the two touch today and the estimate sits **above** the "most favourable"
  bound for the entire history. The interval is zero-width where it matters and inverted
  everywhere else.
- **Costs:** Two numbers for one concept, 2 lb apart, on one screen. This is the kind of
  thing that costs trust in the whole engine, not just the card.
- **Do:** Fold into F3 — delete the reference line with the lean series. If it stays, draw
  it at `lbmAtStart`, not `leanNow`.
- **Size:** trivial
- **Confidence:** high

### F5. The first day he logs food, the adaptive engine resets its own progress counter to zero

- **Saw:** Engine tab → "Every adjustment, week by week", on screen right now:

  | Week of | What the engine did |
  |---|---|
  | Jul 19 | Used the formula — only **10 days** of overlapping weight + intake data — needs 21 |
  | Jul 26 | Used the formula — only **17 days** of overlapping weight + intake data — needs 21 |
  | Aug 2 | Used the formula — only **1 day** of overlapping weight + intake data — needs 21 |

  10 → 17 → **1**. Cause: `expenditureEstimator.js:360-366` sets the window start to the
  **later** of the first weigh-in and the first food-log day. One diary entry created today
  moved the window start from 2026-07-10 to 2026-08-02 and discarded ten weigh-ins.

  Directly beside it: *"Weigh-ins in that window: **1**"* and *"Days of data so far
  (weigh-ins or food log): **1**"* — while the Trend tab one click away offers *"Show all
  **11** weigh-ins as a table."* The label at `AdaptiveTdeeCard.jsx:106` promises a union
  ("weigh-ins **or** food log") and reports something closer to an intersection. The comment
  above it (`:100-105`) says this exact mislabel was already fixed once; it wasn't.
- **Costs:** He starts logging food to unlock the measured burn, and the app immediately
  tells him he has 1 weigh-in and is 21 days away — after three weeks of daily weighing.
  That's the single most demotivating thing this screen can do.
- **Do:** Two options. (a) Let the window start at the first *weigh-in* and treat unlogged
  days as unknown — the estimator already has an `unloggedDaysKcal` uncertainty term for
  exactly this (`AdaptiveTdeeCard.jsx:231`). (b) If overlap must be required, say so in
  words: "Your food log starts today, so the 21-day clock starts today too — your weigh-ins
  are fine." Never print "1 weigh-in in the window" to a man with 11.
- **Size:** medium
- **Confidence:** high on the mechanism (code + on-screen ledger). Note: today's diary row
  was created by another reviewer in the shared session — the *trigger* was incidental, the
  *behaviour* is in the code and reproducible.

### F6. The one plain-English payoff of adaptive TDEE is buried on the Engine tab and effectively unreachable

- **Saw:** The sentence he should be seeing exists, and it's good
  (`AdaptiveTdeeCard.jsx:143-147`): *"The scale moved further than the formula predicted.
  That gap, spread over the window, is worth +X kcal a day — which means you actually burn
  about that much more than the formula thought."*

  It only renders when `a.inEffect`. The gates (`expenditureEstimator.js:60-64`, `:406-430`):
  21 days span, **14 weigh-ins**, **14 complete food-logged days**, 60% coverage, a weigh-in
  within 10 days, a full food day within N days. Shad has said he wants a lightweight "ate
  as planned" toggle rather than food-by-food logging — 14 *complete* logged days inside a
  21-day window is a demanding bar for that.

  And when it does fire, it renders on **Engine** (`EngineTab.jsx:302`) — the tab explicitly
  designated as the place jargon is allowed to live. Today never shows it. Today's only
  reference is a passive aside inside the over-target warning: *"as your weigh-ins build up,
  the engine re-reads your real burn and moves the target itself"* (`TodayTab.jsx:920-921`).
- **Costs:** The app's genuine differentiator — it learns his real metabolism — is invisible
  on the screen he lives in, and gated behind a logging habit he has told you he doesn't want.
- **Do:** (1) When `inEffect`, put **one sentence** on Today: "Your real burn is measuring
  2,690 — 150 above the formula. Target moved to X." (2) Replace the three gate bullets in
  the blocked state with one plain progress line: "Measured burn unlocks after 13 more
  logged days." The five rows under "What it has so far" restate the bullets above them —
  cut them.
- **Size:** medium
- **Confidence:** high

### F7. After the comeback weigh-in, Trend shows a dash for Rate and a projection built from a number he typed

- **Saw:** Trend tab, on screen: **Rate — lb/wk**. Projection card: *"At your planned pace
  (1 lb/wk) · Dec 29, 2026"* with *"there is no fitted trend yet."*

  Chain: `summary.adaptive.weight === null` (verified via the live API) because the window
  collapsed to one day (F5) so `wPts.length < 3` and the fit is skipped
  (`expenditureEstimator.js:432`). `TrendTab.jsx:242-244` therefore has no `fit`;
  `shownRate` falls back to `summary.rate`, which is *also* null because `trendRate` needs
  8 points in 14 days (`bmrEngine.js:487`). Result: **"—"**.

  And the caption under the chart says: *"The robust fit the Engine uses needs three
  weigh-ins and adaptive targeting switched on; until then this average is the honest
  smoothing."* (`TrendTab.jsx:532-537`). He has **11** weigh-ins and adaptive **is** on.
  The stated precondition is met and the fit still isn't there — so the copy sends him
  looking for a bug that isn't where it says it is.
- **Costs:** He steps on the scale after two weeks off — the exact moment the app should
  earn its keep — and gets a dash, a "not enough weigh-ins" stamp, and a goal date derived
  from his own guess. **He does not know what to do next.**
- **Do:** Fix F5 and this mostly resolves. Independently: make the fallback caption state
  the *actual* reason (`summary.adaptive.reasons[0]`) rather than a hardcoded precondition,
  and when Rate is "—", say why in the Stat's own sub-line rather than leaving a dash.
- **Size:** small (copy) + depends on F5
- **Confidence:** high

### F8. A weigh-in is deleted by one unconfirmed click, and only the 8 newest can be reached

- **Saw:** `TodayTab.jsx:1055` — `[...sorted].reverse().slice(0, 8)`. Each row carries a
  trash button (`:1060-1062`) whose handler (`:816-823`) calls `api.deleteWeighin` with no
  confirmation, no undo, and no dialog. (I did not click it.)

  Meanwhile `TrendTab.jsx:553` instructs, for a flagged outlier: *"Fix or delete it on the
  Today tab if it was a typo."* If that outlier is older than the 8 newest entries, there
  is nowhere on Today to delete it. The Trend table lists all 11 but is read-only.
- **Costs:** One misclick permanently removes a data point from the series every downstream
  number depends on. And the app's own repair instruction fails for exactly the entries
  most likely to need repair (old typos).
- **Do:** Put the delete (and an inline weight edit — `POST /weighins` already upserts,
  `weighins.js:28-32`) on the **Trend table**, which already lists every weigh-in. Then the
  Recent-entries list on Today can be display-only, or go entirely. Add an undo toast rather
  than a confirm dialog.
- **Size:** small
- **Confidence:** high

### F9. Delete Today's "Trend snapshot" — it's the Trend chart with the bugs put back in

- **Saw:** `TodayTab.jsx:1001-1048`. Its `<XAxis dataKey="d">` is **categorical**
  (`:1022`), so on screen the ticks read *Jul 10 · Jul 12 · Jul 14 · Jul 16 · Jul 18 · Aug 2*
  — the fourteen-day gap gets the same width as a two-day step. `TrendTab.jsx:336-345`
  documents this precise bug being fixed on the real chart; it was never fixed here.
  Its heavy line is the last-7-**rows** average (F1). Its caption is *"thin = daily · heavy
  = 7-day average · dashed = goal"* — the prose caption `TrendTab.jsx:103-108` says it
  replaced with a real legend.
- **Costs:** Today already renders weigh-in data three times (Verdict stats, snapshot chart,
  Recent entries) and the "Full trend →" button sits inside the same card. The snapshot is
  ~260 px of the screen he lives in, showing a compressed, differently-computed version of a
  chart one click away.
- **Do:** Delete the card. Keep the "Full trend →" link on the Verdict card. If a snapshot
  must stay, render the same component with a `compact` prop — never a second implementation.
- **Size:** small
- **Confidence:** high

### F10. Trend draws a confident straight line across the fourteen days it has no data for

- **Saw:** The heavy average line runs unbroken from Jul 19 to Aug 2 (screenshot). `avg` is
  defined at both endpoints so `connectNulls={false}` (`TrendTab.jsx:507`) doesn't help.
  The fit is careful not to do this (`:253-258`); the average line isn't held to the same
  rule.
- **Costs:** The gap — the single most important thing about this account's history — is
  invisible. It reads as a smooth two-week decline that was never measured.
- **Do:** Insert a null row into `chart` whenever consecutive weigh-ins are more than ~4
  days apart, so the line breaks. One `useMemo` change in `TrendTab.jsx:287-299`.
- **Size:** small
- **Confidence:** medium (the fix is straightforward; the threshold is a judgement call)

### F11. Two duplicated sentences and a half-empty card

- **Saw:**
  - Engine, reversibility block, verbatim on screen: *"…nothing is stored. Fix or delete an
    entry and the adjustment recalculates with it. **Nothing above is stored** — it is
    recalculated from your entries every time you open this screen…"* — `a.reversible.how`
    already ends with the claim and `AdaptiveTdeeCard.jsx:306-309` repeats it.
  - Today's Verdict card is ~455 px tall (screenshot) and its content stops ~215 px from
    the bottom — roughly 40% blank, because `items-stretch` (`TodayTab.jsx:855`) height-matches
    it to the ring card.
- **Do:** Drop the JSX half of the duplicate sentence. Move the trend sparkline or the
  staleness line (F2) into the Verdict card's dead space, or let the card size to content.
- **Size:** trivial
- **Confidence:** high

---

## Cut list

- **Today's entire "Trend snapshot" card** (`TodayTab.jsx:1001-1048`) — a second, worse
  implementation of a chart one click away, with a time axis that hides gaps.
- **The lean-mass `<Line>` on the Trend chart** (`TrendTab.jsx:497-501`) — arithmetically
  `average × 0.78`; costs 78% of the y-axis to show zero new information.
- **The "LEAN MASS IF IT NEVER MOVED" `ReferenceLine`** (`:486-491`) — wrong number, and its
  stated meaning doesn't survive contact with the series it's plotted against.
- **The "What it has so far" five-row block** (`AdaptiveTdeeCard.jsx:106-121`) — restates the
  three gate bullets printed directly above it, in table form.
- **The second "nothing is stored" sentence** (`AdaptiveTdeeCard.jsx:307-308`).
- **`avg7Kg` in `/weighins/summary`** (`weighins.js:50-52`) as currently computed — replace
  with `bmrEngine.trailingAverage`, don't keep both.
- **"Recent entries" on Today** (`TodayTab.jsx:1051-1065`) — once delete/edit moves to the
  Trend table (F8), this list is a truncated duplicate of it.

---

## Open questions for Shad

1. **Is lean mass on the weight chart worth its cost?** As built it's one body-fat number
   times the weight curve, and it flattens the chart. Would you rather it disappear from the
   chart entirely (staying as a Stat), or would you enter a BF% at each tape-and-photo audit
   so it becomes a real second series with real shape?
2. **Should the adaptive window be allowed to count weigh-ins from before your first
   food-log day?** The "ate as planned" toggle could supply intake for those days at the
   planned target — that would let the 21-day clock start from your first weigh-in instead
   of resetting. That's a modelling decision, not a UI one, and it's yours.
3. **Delete confirm, or undo?** I did not click the trash icon (shared session, native
   dialogs freeze the extension for everyone). Right now it is a silent one-click permanent
   delete. Undo-toast is my recommendation, but a confirm is defensible for body data.
4. **Where do you want the "your real burn is X, not Y" sentence to live?** It exists and
   it's well written, but it's on Engine. My assumption is Today gets one line and Engine
   keeps the full derivation — confirm that's the split you want.

---

### Verification notes

- The two-week-gap state described in F2 no longer exists in the shared DB — another
  reviewer logged a 2026-08-02 weigh-in (206.5 lb) during this session. I reconstructed
  what Today showed during the gap by calling the shipped `bmrEngine.trendRate` /
  `verdict` / `trailingAverage` directly against the ten July weigh-ins with
  `daysIn: 15`; the quoted verdict string is the engine's real output, not a paraphrase.
- All live numbers (avg7Kg 94.367 kg = 208.0 lb, `rate: null`, `adaptive.weight: null`,
  `window.spanDays: 1`, the three ledger rows) came from `GET /api/weighins/summary` on
  the running app, plus a direct Prisma read of the `design-qa@local` weigh-in rows.
- I did not create, edit or delete any weigh-in, diary entry, or profile field.
