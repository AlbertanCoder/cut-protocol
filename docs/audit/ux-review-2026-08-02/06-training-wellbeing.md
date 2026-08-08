# 06 — Training and Wellbeing: the two thinnest tabs

## Verdict

**Training is a stub, and it costs a nav slot for something Shad cannot act on.** It generates
a 4-week plan in which all four weeks are byte-identical, holds nothing he does, and re-asks
for training information the Profile already knows — in a *different vocabulary*, with no
sync in either direction. Right now, live on his account, the Engine says his training is
"3×45 min, mixed" and the Training tab says "3 days/wk · 60 min sessions · Hypertrophy."
Both are on screen in the same app, about the same training, and neither knows the other
exists. **He should not delete it — he should make it hold one number: the weight he lifted.**
That single field turns the tab from a printout into the only thing in the app that can
answer "am I keeping my strength while cutting."

**Wellbeing is the opposite problem — it is careful, well-argued, and nearly right.** The
bundle is not a junk drawer (see F-notes below). Its worst flaw is that the micronutrient
card repeats the same 12-word disclaimer sentence forty-three times, and draws a near-empty
progress bar next to "Vitamin D · 1% of target" when the real fact is "we have data for 35%
of your food." The safety content is genuinely good and I would touch almost none of it.

**Answer to the brief's cheapest-win question: no, there is no hidden capability in the
training API.** `backend/src/routes/training.js` is 82 lines and exposes exactly three
things — `GET /meta`, `GET /`, `POST /generate`, `DELETE /`. The UI already surfaces all of
it. The API is *thinner* than the UI implies, not richer (see F7).

---

## What's already working

- **The wellbeing amber dot is the calmest version of this that exists.** `App.jsx:317-318` —
  `signals.length > 0 && !wellbeingSeen && !wellbeingScreen`. No count, no badge number, it
  stands down the moment the tab is opened, and it stands down *permanently* the moment the
  check is ever taken. All four triggers (`WellbeingTab.jsx:47-84`) are derived live from his
  own numbers with nothing stored and nothing accumulating. **I confirmed it is silent right
  now** — no dot in any screenshot — and the math says why: 1 lb/wk on 208 lb = 0.48% of
  bodyweight (needs >1%), target 2,043 is above the 1,887 floor (not clamped), measured 1.3
  lb/wk is under the 1.7 trip point (`band.hi + 0.4`). It only speaks when his own numbers
  give it something to say. Do not touch this.
- **The self-check dialog is right.** Calm, five questions, no score-shaming, "not a
  diagnosis" stated four separate times, support numbers visible *before* you answer anything,
  one-click delete, local-only and it says so every render. `WellbeingCheck.jsx` needs nothing.
- **The gate reasoning is sound and documented** (`WellbeingTab.jsx:19-29`,
  `MicronutrientsCard.jsx:25-36`): a positive screen leads with support and holds back 47
  numbers *by default*, never as a lock, with the coverage summary always visible. This is the
  reason micronutrients belong on this tab and not on Engine — see F-note under "the bundle".
- **The three meter shapes in `MicronutrientsCard.jsx:88-134`** (target / limit / no-reference)
  are a genuinely good piece of design thinking — the "stay under" tag on sodium is exactly the
  plain-English labelling Shad asked for. F5 below is the one case they missed, not a criticism
  of the idea.
- **Micronutrient detail is collapsed by default and the choice persists**
  (`MicronutrientsCard.jsx:224`). Correct default. Leave it.
- **The training generator's honesty** — `generator.js:122-126` telling a 6-day-a-week user
  "walk or do easy conditioning rather than adding junk volume" is the right instinct. It is
  undermined only by F7 (that note is thrown away on reload).
- **Three copies of `ResourceList`** exist (`ProfileTab.jsx:943`, `WellbeingTab.jsx:139`,
  `WellbeingCheck.jsx:175`), and the dialog's copy renders directly on top of the tab's copy —
  I saw both in one viewport. **This is duplication I am explicitly recommending you keep.**
  It is one shared component so the numbers cannot drift, and the moment a person most needs a
  phone number is the moment they just got a positive result. Do not consolidate this.

---

## Findings

### F1. Make Training own the training inputs, and delete them from Profile

- **Saw:** The two tabs hold the same three facts under different names, in different
  vocabularies, with no sync.

  | Fact | Profile stores | Training asks for | Vocabulary |
  |---|---|---|---|
  | frequency | `sessionsPerWeek` = 3 | `daysPerWeek` = 3 | integers, same |
  | duration | `minutesPerSession` = 45 | `sessionLengthMin` = 60 | free int vs. 30/45/60/75/90 |
  | kind | `trainingStyle` = "mixed" | `style` = "hypertrophy" | **disjoint key sets** |

  The style keys have zero overlap: `activityData.js:74-79` uses `weights / mixed / sport /
  cardio`; `training/templates.js:18-23` uses `strength / hypertrophy / general / conditioning`.
  `TrainingTab.jsx:14` is declared `export default function TrainingTab()` — **it takes no
  props at all**, so it structurally cannot see the profile. Its defaults are hardcoded at
  `TrainingTab.jsx:19` (`sessionLengthMin: 60, style: "hypertrophy"`), which is why the plan I
  generated says 60 min when his profile says 45.
- **Costs:** He enters the same three facts twice, and the app now states two different things
  about his training on two tabs. Worse — the Training tab's copy of the numbers is the one
  that does *nothing*. Engine's Step 2 reads `+ training (3×45 min, mixed, MET 5) → +159`. If
  he corrects "45" to "60" on Training because that is where session length obviously lives,
  his calorie target does not move by one kcal. (It should move by ~53/day.)
- **Do:** Training owns days / length / style. On Generate, write them back to the profile,
  mapping style through a 4-line lookup (`strength`→weights, `hypertrophy`→weights,
  `general`→mixed, `conditioning`→cardio). Then `ProfileTab.jsx:680-698` loses three editable
  fields and becomes one read-only line: "Training: 3× 45 min, from your training plan →".
  **Net: −3 form fields, +0.** Files: `TrainingTab.jsx`, `ProfileTab.jsx`,
  `backend/src/routes/training.js`.
- **Size:** medium
- **Confidence:** high

### F2. Delete the four week chips — weeks 1 and 4 are identical

- **Saw:** On the live Training tab I generated a plan, read the full page text on Week 1,
  clicked Week 4, and read it again. **The three session tables are character-for-character
  identical.** The only thing that changed was one sentence above them. Source confirms:
  `generator.js:131-151` builds `Array.from({ length: 4 })` and maps *the same*
  `template.sessions` in every iteration; the only per-week variation is `WEEK_NOTES[w]`
  (`generator.js:103-108`).
- **Costs:** Four buttons that look like they navigate a 4-week program are a 4-way radio on
  one line of text. He clicks Week 2 expecting a change and gets the same 18 rows. It also
  writes 4 × 3 × 6 = **72 `TrainingExercise` rows to SQLite to store 18 distinct
  prescriptions**, and those 72 rows are cascade-deleted every time he regenerates
  (`routes/training.js:43`).
- **Do:** Drop the week chips (`TrainingTab.jsx:162-176`). Show the sessions once, with the
  four progression notes as a single four-line list under the plan header — that is what they
  actually are. Generate one week server-side, not four.
- **Size:** trivial (UI) / small (generator)
- **Confidence:** high

### F3. The smallest real progression tracking: one weight box per row, one Done button

This is the answer to "what does he tap on Monday." One screen, no new concepts.

- **Saw:** `schema.prisma:792-846` — `TrainingPlan → Week → Session → Exercise`. There is no
  `completed`, no `date`, no `weight`, no `actualReps`, nowhere. The plan is a read-only
  printout. Meanwhile the app's own coaching copy is *double progression*: "Add load anywhere
  last week's top-of-range was clean" (`generator.js:105`) — advice that requires knowing what
  last week's load was, which is the one thing the app does not hold.
- **Costs:** The tab can be opened but never *used*. Nothing he does in the gym changes
  anything on screen, ever. That is the whole reason it feels like a stub.
- **Do:** Replace the week chips (F2) with this:
  1. **A "Next up" line.** `Next up: Full Body A` — computed as `(logged session count) mod 3`.
     No calendar, no scheduling, no new concept.
  2. **One new cell per exercise row**, at the end of the existing table (`TrainingTab.jsx:199-207`):
     a weight input, **pre-filled with what he entered last time for that exercise**, with last
     time's result as ghost text — `last: 185 lb × 8,8,7`.
  3. **One button under each session: "Done."** Stamps today's date, saves the row weights,
     advances "Next up". That is the entire interaction.

  Monday: he opens Training, sees `Next up: Full Body A`, every box already holds last
  Monday's weight, he bumps the two that felt easy, taps Done. Four taps.

  **Backend: one table.**
  ```
  TrainingLog { id, userId, sessionName, exerciseName, date, weight, repsHit }
  ```
  **Key it on `exerciseName`, not `exerciseId`.** Exercise IDs are cascade-deleted on every
  regenerate (`routes/training.js:43`); names are not. Keying on name means his bench-press
  history survives a plan change, which is the difference between a log and a toy.

  Second-order win, free: once weights exist, the Trend tab's "The other lever" card
  (`TrendTab.jsx:70-86`) stops being a slogan and can say whether his lifts are holding
  during the cut — which is the actual recomp question.
- **Size:** medium
- **Confidence:** high on the design; the 4-tap estimate is a design claim, not a measurement.

### F4. Say the coverage sentence once, not forty-three times

- **Saw:** Wellbeing → "Show the 47-nutrient breakdown". The card header already says
  **"1 of 47 nutrients fully known today, 43 partial, 3 with no data yet."** Then all 43
  partial rows each print their own copy of the same disclaimer. From the live page text, the
  string *"Based on 35% of today's food weight — 10 items logged with no data for this
  nutrient."* appears **verbatim, 20 times in the Vitamins and Minerals groups alone**, with
  three near-identical variants (22% / 9 items / 15 items) making up the rest. Expanding
  Fatty acids + Amino acids adds ~20 more. Source: `MicronutrientsCard.jsx:64-69` and `:176`.
- **Costs:** The dominant text on the tab's largest card is one sentence, repeated. The signal
  he actually wants (the numbers) is outnumbered ~2:1 by boilerplate he has already read at the
  top of the card and again in the source line above it.
- **Do:** State it once, at card level, as the headline it deserves to be: *"We only have
  micronutrient data for about 35% of today's food, so most numbers below are undercounts."*
  Then print a per-row note **only when that row deviates** from the card-level figure — which
  from the live data is exactly three rows (Pantothenic acid and Manganese at 22%, Vitamin C
  and Selenium at 9 items). File: `MicronutrientsCard.jsx:64-69`, `:176`.
- **Size:** small
- **Confidence:** high

### F5. A 35%-coverage nutrient must not draw a progress bar

- **Saw:** On screen: **"Vitamin D — 0.2mcg · 1% of target"** with a `TargetMeter` rail that is
  visually empty. Also "Vitamin A · 1% of target", "Calcium · 7% of target". Every one of them
  is computed from ~35% of the day's food. The bar shape says *severe deficiency*; the sentence
  underneath says *we don't know*. At a glance, the shape wins.
- **Costs:** This is a food/body number that reads as an accusation, on the one tab explicitly
  designed not to do that. It is also precisely the failure mode this file already documents
  fixing twice — `MicronutrientsCard.jsx:71-86` explains at length why a no-reference nutrient
  and a `maximum` nutrient each needed their own shape rather than a shared filled rail.
  Partial coverage is the third case, and it never got its shape.
- **Do:** Fix it by shape, exactly as the file's own precedent does — no colour. Draw the
  un-covered fraction of the rail as the dashed treatment already used by `NoReferenceMeter`
  (`:126-134`), so the bar visibly reads "this much is known, this much is unmeasured." Below
  some coverage threshold, suppress the `% of target` figure entirely and print the amount
  only. File: `MicronutrientsCard.jsx:93-100`, `:136-179`.
- **Size:** small
- **Confidence:** high

### F6. Put the training-calorie line on the Training tab

- **Saw:** Engine, Step 2: `+ training (3×45 min, mixed, MET 5) → +159` and the formula
  explainer (`EngineTab.jsx:227-228`, `bmrEngine.js:163-168`). The Training tab shows **zero
  calorie numbers anywhere** — I read the full page text with a plan active and there is not
  one kcal figure on it.
- **Costs:** Training feeds TDEE, which sets his target, and the tab named Training never says
  so. The connection exists in code and is invisible from the place a user would look for it.
  It is also the reason F1's silent disagreement goes unnoticed — nothing on Training would
  change if the number were wrong.
- **Do:** One line under the inputs card: *"This adds +159 kcal/day to your target (3 × 45 min
  at MET 5). Change it here and Today updates."* Once F1 lands, that sentence becomes true and
  the number becomes live. File: `TrainingTab.jsx:133-135` — replace the v1-templates
  boilerplate that is already there.
- **Size:** trivial
- **Confidence:** high

### F7. `planNotes` and `description` are generated, then thrown away

- **Saw:** `routes/training.js:74` responds with `{ plan, description, planNotes }`.
  `TrainingTab.jsx:49` reads `planNotes` into state but **never reads `description` at all**.
  More importantly: `TrainingPlan` in `schema.prisma:792-808` has no column for either, and
  `GET /` (`routes/training.js:30-33`) returns only the stored plan. So both are **ephemeral —
  they exist for one render and are gone on reload.**
- **Costs:** Pick 5 or 6 days/week and the generator produces its best line — "on your other 2
  day(s), walk or do easy conditioning rather than adding junk volume." Reload the app and it is
  gone permanently, with no way to get it back short of regenerating. The honest guidance has a
  shorter lifespan than the plan it is about.
- **Do:** Add `planNotes Json?` and `description String?` to `TrainingPlan`, persist them in the
  create at `routes/training.js:45-70`, return them from `GET /`. Then render `description` —
  it is the only sentence explaining *why* this template was chosen. Cheapest real win in the
  training code.
- **Size:** small
- **Confidence:** high

### F8. The "not medical advice" card is the last thing on a 2,500px tab

- **Saw:** `WellbeingTab.jsx:240-242` calls the disclaimer *"the key line, always visible."* In
  the DOM order it renders **after** the micronutrients card. With the breakdown expanded (47
  rows across three columns), it sits below all of them and below the support list. I had to
  read the page text to find it.
- **Costs:** The card the code calls always-visible is, in the tab's most-used state, the least
  visible thing on it. Meanwhile the self-check card at the top says "it's not a diagnosis" and
  the disclaimer saying the same thing in more detail is ~2,000px away.
- **Do:** Move the DISCLAIMER card to sit immediately under the SELF-CHECK card — they are the
  same idea and belong adjacent — and let micronutrients be last in both branches. One JSX
  reorder at `WellbeingTab.jsx:222-256`.
- **Size:** trivial
- **Confidence:** high

### F9. Delete the "MOVED — Micronutrients" tombstone on Today

- **Saw:** Today, below the food diary: a full-width card (`xl:col-span-12`), ~90px tall,
  containing one sentence and a link — *"Today's vitamin and mineral breakdown moved to the
  Wellbeing tab."* `TodayTab.jsx:985-998`.
- **Costs:** A full-width row on the tab Shad lives in, permanently spent on an announcement
  about a change he made himself. A move notice is a transitional device; this one has no
  expiry.
- **Do:** Delete the card. If a pointer is still wanted, it is a link, not a card. The Wellbeing
  nav item is four inches away in the sidebar.
- **Size:** trivial
- **Confidence:** high — with one caveat: this is a judgment about *when* the notice has done
  its job, and only Shad knows whether he still needs it.

### F10. `flags.js` promises a fallback that does not exist

- **Saw:** `flags.js:13-15` documents the `hidden` state as: *"the sidebar's Wellbeing button
  and the Profile tab's 'Outside help' card still carry the support resources, so hiding the
  tab never hides the phone numbers."* But `Sidebar.jsx:24` is
  `...(WELLBEING === "on" ? [{ id: "wellbeing", ... }] : [])` — **flip the flag to `hidden` and
  the sidebar Wellbeing item is gone entirely.** Only the Profile card survives.
- **Costs:** The safety promise still holds (Profile does carry them), so this is not a live
  safety hole. But it is a comment that names a survivor that does not survive, on the one file
  in the app whose entire job is to be trusted at a glance. A future session flipping this flag
  would be reasoning from a false premise about a safety feature.
- **Do:** Fix the comment to name only the Profile card. One line, `flags.js:13-14`.
- **Size:** trivial
- **Confidence:** high

### F11. Fiber has its own collapsible section for exactly one row

- **Saw:** `MicronutrientsCard.jsx:41` — `{ group: "fiber", label: "Fiber", defaultOpen: true }`.
  On screen it renders a full section header reading **"FIBER — 1/1 with data"** above a single
  row. Fiber is also already stated on Engine's macro panel ("Fiber 25+g").
- **Costs:** A section header, a count, and a disclosure triangle for one number — in a
  three-column grid where it takes a full column and leaves two-thirds of it blank.
- **Do:** Fold fiber into Minerals, or promote it to the always-visible summary line beside the
  coverage note (it is the only nutrient on the card with complete data, which makes it the one
  worth showing without expanding).
- **Size:** trivial
- **Confidence:** medium — it is possible fiber is deliberately separated because it is a macro,
  in which case the honest fix is to move it *out* of this card entirely rather than in.

---

## On the Wellbeing bundle — is it a junk drawer?

**No, and I would not unbundle it.** It is two things, not three: a coherent safety group
(self-check + support + disclaimer, which belong together and should be made contiguous per F8),
plus one large nutrition report.

**Micronutrients should stay where they are, and moving them here was the right call.** My
first instinct was Engine — Shad likes the math there, it is already the "here is the underlying
arithmetic" tab, and micronutrients *are* arithmetic over the solved plan. But that breaks the
one mechanism that justifies the whole design: the gate. A positive self-check suppresses the
47-number detail by default (`WellbeingTab.jsx:119`, `MicronutrientsCard.jsx:352-381`), and
Engine has no such mechanism and would look absurd growing one. Co-locating the gate-able
content with the thing that triggers the gate is correct. The PageHead sub
(`WellbeingTab.jsx:184`) already announces the bundle honestly rather than pretending it is one
idea, which is the right way to carry a two-part tab.

Where it *reads* like a junk drawer is order, not membership — see F8.

---

## Cut list

| Cut | Why |
|---|---|
| The four week chips on Training (`TrainingTab.jsx:162-176`) | Weeks 1–4 render identical tables; verified on screen. A 4-way toggle on one sentence. |
| Three of the four `TrainingWeek` rows per plan (`generator.js:131`) | 72 DB rows storing 18 distinct prescriptions, cascade-deleted on every regenerate. |
| The "MOVED — Micronutrients" card on Today (`TodayTab.jsx:985-998`) | Full-width permanent tombstone for a move Shad made himself. |
| 40 of the 43 per-row coverage sentences (`MicronutrientsCard.jsx:176`) | The card-level line already says "43 partial". Keep only the rows that deviate. |
| `trainingStyle` / `sessionsPerWeek` / `minutesPerSession` as **editable fields on Profile** (`ProfileTab.jsx:680-698`) | Same three facts Training asks for. Let Training own them; Profile shows a read-only line. |
| The "Fiber" section header (`MicronutrientsCard.jsx:41`) | A collapsible group for one row. |

**Not on the cut list, deliberately:** the Training tab itself, any support resource, any of
the three `ResourceList` copies, the self-check, the amber dot, the gate, or the collapsed-by-
default micronutrient detail.

---

## Open questions for Shad

1. **Does he actually train the way the Profile says (3 × 45 min "mixed") or the way the
   Training tab implies (3 × 60 min hypertrophy)?** F1 assumes Training should be the source of
   truth, but the +159 kcal/day currently riding on the Profile numbers is real and feeds his
   target. Whichever number is right, the other one needs correcting before they are merged.
2. **Does he want the log to survive a regenerate?** F3 recommends keying `TrainingLog` on
   exercise *name* specifically so history outlives a plan change. If he would rather each plan
   have a clean slate, that is a different (simpler) schema and worth knowing before it is built.
3. **Is the "MOVED" card on Today still doing a job?** I cannot tell from the outside whether he
   still reaches for micronutrients on Today out of habit. If he does, keep it; if he has
   internalised the move, it is a free full-width row back on the tab he lives in.
4. **Was 47 nutrients always aspirational?** The card's own honest summary is *"1 of 47 fully
   known, 43 partial"* because 7 of 13 foods in today's plan carry no micronutrient data. That
   is a food-database gap, not a UI problem, and it is outside my lens — but it means this card
   cannot deliver its headline until the library is filled in. Worth knowing whether that fill-in
   is planned, because F4 and F5 are shaped differently if coverage is about to jump to 90%.
