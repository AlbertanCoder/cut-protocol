# Cut Protocol — 10-reviewer UX synthesis, 2026-08-02

Ten reviewers, one running app, distinct lenses. All findings below are cited to a
file:line or a measured on-screen observation. Ranked by friction removed ÷ effort.

---

## 1. Convergence — what multiple reviewers found independently

Independent agreement is the strongest signal in the exercise. Four themes hit ≥2 lenses.

### A. The 7-day average is computed three different ways — **04, 05, 10**
Today's Verdict says **208 lb**. Trend's Numbers card says **206.5 lb**. Same statistic,
same label, same moment.

- `backend/src/routes/weighins.js:50-52` — last seven **rows** (spans Jul 13–Aug 2 here,
  20 calendar days, because of the July gap)
- `frontend/src/components/TrendTab.jsx:213-230` — true seven-**day** calendar window,
  and its caption explicitly disclaims the other method
- `frontend/src/components/TodayTab.jsx:838` — a third copy

`backend/src/lib/bmrEngine.js:535-549` **already documents `slice(-7)` as the bug and ships
`trailingAverage()` as the fix.** `weighins.js` never imports it.

It propagates: `adaptiveTarget.js:142-146` uses the same `slice(-7)`, `resolveEnergy()` feeds
that weight into `computeEnergy()`. **Every BMR formula, TDEE, target and macro range is
built on 208.0 while Trend reports 206.5.** Two goal dates fall out: Trend Dec 29 2026,
Profile Jan 9 2027.

### B. The app repeats itself constantly — **01, 05, 07, 08**
- `Target 2,040 kcal` appears **five times** on Today (HeaderBar, PageHead, plan card,
  Verdict tile, diary denominator) — 10 also counted 5, linked 0 times
- HeaderBar prints "Day 15 / Target 2,040 kcal"; Today's subtitle prints "Day 15 of
  protocol · target 2,040 kcal" ~90px below it
- `MacroRails` renders twice (`TodayTab.jsx:927` planned, `:606` eaten), each printing the
  same 25-word "calories and protein are the walls" paragraph
- ~30 uppercase eyebrows (`ui/Parts.jsx:47`), half exact duplicates of the title beside them
- Wellbeing prints "Based on 20% of today's food weight…" **23 times** on one screen
- The adaptive-burn card says "nothing is stored" twice back to back

### C. The two-week gap is honest on Trend, invisible on Today — **04, 10** (05 adjacent)
Today's Verdict read *"A little faster than planned — 1.3 lb/wk… worth another look at this
time next week"* — present tense, computed over Jul 6–19, fourteen days stale, no qualifier.
`trendRate` anchors on the last weigh-in, not today. Recent entries prints `Aug 2` directly
above `Jul 19` with no marker; the chart draws a straight line across fourteen empty days.
Engine already computes "days since last weigh-in" and nothing surfaces it.

### D. Copy that claims features don't exist — when they do — **03, 08**
`FoodsTab.jsx:355-363` renders "Log today" **disabled**, tooltip "Needs the food diary — not
built yet." `backend/src/routes/diary.js` exists, `api.addDiaryEntry` is exposed, and Today
showed **4 items logged** during the review. Two reviewers, different routes, same conclusion.
This is very likely why Foods feels like a dead end — the payoff action is switched off.

---

## 2. Contradictions, and the call

**07 vs 03 — Foods hidden under Recipes.**
07: the nav *lies* — `<h1>` says "Food database" while `aria-current="page"` sits on Recipes
(`Sidebar.jsx:35`); 14,151 foods behind a ghost button.
03: placement is *right* — 2 clicks, sidebar stays correctly lit, don't add an 8th nav item.
**Call: 03 wins on placement, 07 wins on the defect.** Keep Foods as a child; fix the
`aria-current` lie and give the entry button a real label. `FoodsTab.jsx:554-558` already
carries a `backLabel` prop whose comment anticipates exactly this.

**07 vs the brief — merge Trend+Engine.**
07 declined: it would produce one screen with eight heavy cards on the day the stated
complaint is "too busy." **Call: 07 is right. Dropped.**

**06 vs 01 — micronutrients.**
Not a real contradiction. Both agree: delete the *stub* on Today, keep the *content* on
Wellbeing. 06 additionally argues moving them to Engine breaks the wellbeing gate.

---

## 3. Defects (not taste) — fix before any cosmetic work

| # | Defect | Where | Size |
|---|---|---|---|
| 1 | Three different 7-day averages; corrupts every derived number | `weighins.js:50-52` | 1 line |
| 2 | Six profile fields cannot be set at all — PUT returns 200, saves nothing | `routes/profile.js:18-25` | small |
| 3 | Solver verdict computed, returned, never persisted; one swap voids all 7 days | `plans.js:456-488` | medium |
| 4 | `ScreenBoundary` written, documented, **mounted nowhere** — a render crash blanks the app including nav | `App.jsx` `<main>` | 1 line |
| 5 | Over-target warning fires at **1 kcal** over (`kcalPct > 1`) — currently scolding you over 41 kcal on a plan the solver itself scored good | `TodayTab.jsx:917` | 1 line |
| 6 | "Log today" disabled with false copy | `FoodsTab.jsx:355-363` | small |
| 7 | Adaptive ledger days run **10 → 17 → 1** | `expenditureEstimator.js:360-366` | small |
| 8 | Lean-mass reference line disagrees with the card beside it (161.1 vs 163) | `TrendTab.jsx` | small |
| 9 | Profile "Cuisine preferences" never reaches the solver | `ProfileTab.jsx:816` | small |
| 10 | `rateAcknowledged` is write-only — chip will claim an acknowledgement never given | schema + Profile | small |
| 11 | 29 zero-macro placeholder rows carry no warning in search results | `foodCategories.js:147-149` | 1 branch |

Note on #11: all 910 recipes were checked — **zero** use a placeholder, so nothing is
miscalculated today. It's a trust problem, not a math problem.

---

## 4. Ranked change list

### Tier 1 — one-liners with outsized effect
1. `weighins.js:50` → call the existing `trailingAverage()`. Fixes 208/206.5, both goal
   dates, and every downstream energy number. **Highest value change in the review.**
2. `TodayTab.jsx:917` — give the over-target warning a real tolerance instead of `> 1`
3. Delete Today's subtitle line — removes "protocol", "kcal" and a bare rate in one edit;
   every fact in it is already on screen twice
4. Delete the Micronutrients tombstone card (full-width row pointing at a permanently
   visible nav item; dead since 2026-07-24)
5. `RecipesTab.jsx:483` — default grouping `"cuisine"` → `"protein"`. Cuisine dumps 69% of
   recipes into Western/Comfort + Uncategorized, Mexican ninth and below the fold
6. Mount `ScreenBoundary` in `App.jsx`'s `<main>`
7. `App.jsx:335` — pass `openEngine` to TodayTab and link the target number. Engine is the
   best screen in the app and is currently reachable only if you already know it exists

### Tier 2 — small and mechanical
8. Strip the eyebrow prop from ~30 call sites — **the single highest-leverage fix for
   "too busy"**
9. Food search relevance comparator (~4 lines). Today "chicken" returns 824 rows with
   **"Chicken Breast" at position 230**; shorter-name-first alone fixes most of it
10. `foodWarning()` — add the `manual-placeholder` branch
11. Enable "Log today" and fix its copy
12. Add the six missing fields to `PROFILE_FIELDS`
13. Alt+1…7 tab shortcuts off the `NAV` array (~6 lines). Returning to nav currently costs
    **11 Shift+Tabs**
14. Fix `aria-current` on the Foods view; give the entry button a real label
15. Staleness line on Today when the last weigh-in is older than N days
16. Drop `v1 scaffold` / `V1 TEMPLATES` / `V1-TEMPLATES` from Training

### Tier 3 — medium, real design work
17. Persist the solver verdict. **The migration already exists**, untracked, at
    `backend/prisma/migrations/20260802034419_plan_verdict_persistence/`, and
    `schema.prisma:530-561` already defines the columns. The storage is waiting.
18. Today: swap the hero from *planned* calories to *eaten*. The 156px ring shows planned;
    "eaten today" is plain text below the fold at a third the size
19. Plan: get the 398px filter card out of the way (it also doesn't persist — 8 of 9 fields
    reset on tab switch, `PlanTab.jsx:872-877`). First meal name currently sits at ~y=800
    of an 812px viewport
20. Profile: reorder by change-frequency. It currently follows Prisma column order;
    "Rate of loss" — the one dial a cutter turns — sits at y=732
21. Nav: Profile → footer gear. 8 tabs → 7
22. Training: the minimal progression tracker (06's spec — kill the week chips, "Next up",
    one weight box per exercise pre-filled with last time, one Done button). **Key the log
    on exercise *name*, not ID** — IDs cascade-delete on regenerate

---

## 5. Cut list, merged

- Today's subtitle line
- The Micronutrients tombstone
- The duplicate macro rails + the twice-printed explainer paragraph
- The planned-calorie ring (10's single pick — takes the duplicates with it)
- ~30 uppercase eyebrows
- "How it compares" — a competitor matrix mounted permanently in a single-user app used by
  its own author. Keep the content for the README
- "RECOMP ENGINE" under the app name on every screen
- Training's week chips — all four weeks are byte-identical (`generator.js:131-151`)
- Trend's lean-mass line — arithmetically `average × 0.78`, carries no shape of its own, and
  forces a 57 lb y-axis to tell a 2.9 lb story (~19px of a 380px plot)
- Profile's dual-unit rate pills (7 dead lines for an imperial user)

---

## 6. Corrections to the record

**`CLAUDE.md` and two source comments overstate the food corruption by ~6×.** They assert
470 wrong-record rows. The live count is **80**, and the UI computes it correctly. The repair
ran 2026-07-31 (149 `provenance-restored` + 188 `provenance-reviewed`). Stale in:
`foodCategories.js:87`, `FoodsTab.jsx:528`, root `CLAUDE.md`.

**`CLAUDE.md` standing rule 7 quotes the nav order in prose** and goes stale the moment any
nav change lands. It already says the `NAV` array is the source of truth — the prose copy
should go.

---

## 7. What must NOT be touched

- `lib/api.js` error copy — the best writing in the product. Every message names a cause,
  says whether the change landed, gives a next step
- The over-target coach line — consistent, never scolds, offers a do-nothing option
- The three auth states in `App.jsx` (`checking` / `out` / `unreachable`) — genuinely
  distinguishable and honest
- The allergy save-with-rollback machinery, `ProfileTab.jsx:268-355`
- Swap → Use → lock: a clean 3-click flow, and locks are a real solver constraint
- Trend's projection cone and its refusal to draw past the last weigh-in; outlier disclosure;
  the a11y table
- The one-click "Ate as planned" path — properly idempotent server-side
- **The eating-disorder screening files.** `WellbeingCheck.jsx`, `WellbeingTab.jsx`,
  `lib/wellbeingResources.js` should be **exempted from any global find-and-replace**. SCOFF
  wording is verbatim-correct; rewording de-validates the instrument
- Colour-law compliance throughout Trend — no red on body data, accent on one mark only

---

## 8. Open questions for Shad

1. Does the product name "Cut Protocol" stay? (assumed yes — it's the brand and the icon;
   only "of protocol" and "Recomp Engine" are proposed for cutting)
2. Training — build 06's minimal progression tracker, or leave it as-is for now?
3. Food logging: the picker only accepts **grams**, so logging a burrito means guessing its
   mass. That's the opposite of the lightweight logging you asked for. Portions? Or accept?
4. Fix order — defects first (Tier 1), or the visual de-clutter first (Tier 2 #8)?
