# Cut Protocol — Battle Plan v2

**Rewritten 2026-08-06.** Supersedes the 2026-07-24 version (20-agent audit), which is now
substantially stale — four of its headline items shipped and one of its central claims was
overstated by 6×. What survives from it is preserved below; what's done is listed so nobody
re-does it.

**Sources:** `TEARDOWN-2026-08-06.md` (the adversarial teardown — read §5 and Stage 3 Q2 if you
only read two sections) and `docs/audit/ux-review-2026-08-02/SYNTHESIS.md`.
**`BUILD_PLAN.md` remains authoritative for the billing stages** and its Owner Runbook Parts A–E
are the click-by-click for every dashboard step. This file does not duplicate them; it sequences
them.

---

## The mission, in one line

Get 20 strangers using a deployed Cut Protocol for 14 days, and find out whether 6 of them come
back on day 14.

Everything in Week 1 exists to make that number mean something. Everything in Weeks 2–3 exists
because we're waiting anyway.

**The gate:** ≥6 of 20 open the app on day 14, AND ≥10 of 20 log 3+ weigh-ins.
Below either line, retention is fatal in the current shape and no amount of billing plumbing
changes it. See "At the gate" below for what each outcome triggers.

**Why 14 days and not 7:** `expenditureEstimator` needs ~2 weeks of weigh-ins before
`adaptive.applied` flips true. The product's only real differentiator does not exist before then.
Any shorter test measures a product that hasn't started working yet.

---

## Rules of engagement

1. **One change, verify it live, commit.** Never stack two untested changes.
2. **The Now gate:** does this change move a stranger closer to paying? If no, it waits.
3. **Cap non-revenue work at 4 of the 20 weekly hours** until the gate is passed.
4. Never push. Branch `saas-launch`. Owner's hand only.
5. Parallel Claude sessions run in this repo. **`git log -1` before any branch or commit
   operation**, and the repo is CRLF — LF patches silently no-match.

---

## Owner split

| Marker | Who | Note |
|---|---|---|
| **[S]** | Shad | Dashboard clicks, recruiting, real-card money. Nobody else can do these. |
| **[C]** | Claude | Code, tests, commits. |

**The critical path runs through [S] items.** Week 1 item 2 has been the top open item in
`BUILD_PLAN.md` since 2026-08-06 and nothing downstream — not the test, not billing, not one
user — happens before it. It is dashboard clicking on a Saturday after a ten-hour day and it will
feel like admin. It is not admin. It is the only step that turns this repo into a product.

---

## WEEK 1 — Make it not embarrassing, then deploy (~19 hrs)

### 1A. Correctness block [C] — ~11 hrs

Every item here would otherwise turn a tester's real reaction into noise. You cannot tell
"this isn't useful" from "this showed me two different weights."

- [ ] **`weighins.js:50` → call the existing `trailingAverage()`** · 1 hr
  `bmrEngine.js:606` ships a correct calendar-day implementation, tested at
  `tests/trendRateWindow.test.js:138`, with **zero production callers**. Today's Verdict says
  208 lb while Trend says 206.5 lb — same statistic, same moment.
  *Skipped:* you ship a product whose two headline screens disagree.
- [ ] **Same fix at `adaptiveTarget.js:144` and `weightNow.js:10`; re-baseline
  `tests/golden/engine-baseline.golden.json`** · 4 hrs
  `resolveEnergy()` feeds this weight into `computeEnergy()`, so every BMR formula, the TDEE, the
  target and all four macro ranges are currently built on the wrong number.
  *Skipped:* the corruption survives in the engine even after the display is fixed.
- [ ] **Mount `ScreenBoundary` in `App.jsx`'s `<main>`** · 0.5 hr
  Written and documented in `ErrorBoundary.jsx`; `grep ScreenBoundary frontend/src/App.jsx`
  returns nothing.
  *Skipped:* one bad render blanks the app, nav included, for a paying user.
- [ ] **Over-target warning tolerance — `TodayTab.jsx:917`** · 0.5 hr
  Fires at `kcalPct > 1`, i.e. 1 kcal over. Currently scolds over 41 kcal on a plan the solver
  itself scored good, in direct violation of the color law.
- [ ] **Six write-only profile fields → `PROFILE_FIELDS` (`routes/profile.js:18`)** · 2 hrs
  PUT returns 200 and saves nothing. Silent data loss during onboarding.
- [ ] **Remove the AI-generation allergen override on the web build** · 0.5 hr
  The one path where a user toggle defeats `exclusionGate.js`. Adjudicated in the teardown: consent
  does not survive a UI — the person who ticks the box is not the person eating three days later.
  One boolean. (The feature it protects is on the kill list anyway.)
- [ ] **Sentry free tier, backend + frontend** · 3 hrs
  Terminal error middleware at `server.js:192` logs to stdout; on Railway that is a tail nobody
  reads.
  *Skipped:* a tester's 500 is invisible and you learn nothing from the test.

### 1B. Deploy [S] — ~8 hrs, `BUILD_PLAN.md` Runbook Parts A–C

- [ ] **Part A — Supabase project + Google OAuth client**, both `.env` files filled
- [ ] **Part C — Railway deploy**, `DATABASE_URL` (Session pooler), fresh `JWT_SECRET`,
      `VITE_SUPABASE_*` build args, generate domain, set `APP_URL`
- [ ] **Seed the cloud library once:** `node scripts/buildTemplateDb.mjs && node
      scripts/seedCloudLibrary.mjs --url "<DATABASE_URL>"`
- [ ] **Do NOT set `ANTHROPIC_API_KEY`.** The global LLM cap is $15/month
      (`brain/config.js:28`) — ~94 Opus-5 generations across your *entire* customer base. Leaving
      the key unset means AI generation is cleanly absent instead of intermittently broken.
- [ ] **Legal minimum:** real support email into `terms.html` / `privacy.html` (currently literal
      `[SUPPORT EMAIL]`, `[DATE]`, `[REGION]`), and ship `docs/DISCLAIMER.md` — it is not in the
      installer allowlist so it has never shipped anywhere
- [ ] **Skip Lemon Squeezy entirely for now.** The cohort is free; the code is already written.

### 1C. Recruit [S] — end of week 1

- [ ] **One honest post**, r/fitness30plus or r/leangains. Construction by day, built this at
      night because you were sick of weighing chicken at 5 a.m. before a ten-hour shift. Here's
      what it does. 20 free accounts.
- [ ] **Recruit 20, onboard them, then leave them alone.** No hand-holding, no concierge. You are
      measuring the product, not your enthusiasm.
- [ ] **Log the cohort:** signup date, and whether they completed setup. That's the whole
      instrumentation.

---

## WEEKS 2–3 — Build the paid path while the clock runs (~34 hrs)

The 14 days pass whether you work or not. This is the work that must exist before money moves.

### Retention organs [C] — ~16 hrs

The app currently has no scheduler, no queue, no cron, and no email provider. **Nothing in this
system can execute at a time the user did not personally initiate.**

- [ ] **Resend + `SentMessage` table + 3 templates** (welcome · day-14 adaptive-on · weekly
      digest) · 10 hrs
- [ ] **Railway cron service + the day-index send job** · 6 hrs
      One nightly pass: per active user, evaluate day-index and state, send at most one email,
      record it. ~200 lines.
- [ ] **Send the test cohort's day-3 and day-14 emails BY HAND** · 1 hr [S]
      Forty emails. You get the retention signal *and* you test the copy before automating it.
      Do not build the automation for copy you have never seen land.
- [ ] **Never build:** streak shaming, "you haven't logged in 3 days!", notification spam. The
      constitution forbids engagement bait and it is right — this cohort churns *harder* when
      nagged. Every message carries information or it doesn't go.

### Before a dollar moves [C] — ~11 hrs

- [ ] **Account deletion** · 8 hrs
      `schema.prisma:68–75`: six relations default to `onDelete: Restrict`, so `user.delete()`
      always throws P2003; six more tables carry a bare `userId` with no FK. Needs an explicit
      cascade order.
      *Skipped:* you are selling a health-data service people cannot leave. PIPEDA, app stores,
      and basic decency.
- [ ] **Repricing → $14.99/mo · $119/yr · 14-day trial** · 3 hrs
      `pricing-section.jsx` currently reads $14.99/$119.99 placeholder → was to become $24.99/$125.
      See the teardown Stage 4 for why the monthly comes down and why the trial is 14 days and not
      7. `entitlement.js:23` already handles `on_trial` → premium; zero new backend code.
      **[S] decision required before I touch this** — `BUILD_PLAN.md` marks $24.99 as locked.

### Quality-per-hour [C] — ~7 hrs

- [ ] **Strip the eyebrow prop from ~30 call sites** (`ui/Parts.jsx:47`) · 4 hrs
      Highest perceived-quality gain per hour in the whole backlog; half of them duplicate the
      title beside them.
- [ ] **Delete Today's subtitle line and the Micronutrients tombstone card** · 1 hr
      Every fact in the subtitle is already on screen twice; the tombstone points at a permanently
      visible nav item and has been dead since 2026-07-24.
- [ ] **`RecipesTab.jsx:483` default grouping `"cuisine"` → `"protein"`** · 0.5 hr
      Cuisine dumps 69% of recipes into Western/Comfort + Uncategorized.
- [ ] **Food-search relevance comparator** (~4 lines) · 1.5 hrs
      "chicken" returns 824 rows with **"Chicken Breast" at position 230**. Shorter-name-first
      fixes most of it.

---

## AT THE GATE — day 14

Count the two numbers. Then pick a branch and say which one out loud.

### PASS (≥6 return, ≥10 with 3+ weigh-ins)

- [ ] Lemon Squeezy test mode, five test-card scenarios on prod (`BUILD_PLAN.md` Part D)
- [ ] LS activation + live product + penny test (Part E)
- [ ] **Then, and only then, the retention features that make it stick:**
      learned recipe pool (16 hrs — the "can't live without it" mechanic), day-14 celebration
      moment with the formula-vs-measured chart (8 hrs), diary portions instead of grams (12 hrs),
      time-to-first-value under 5 minutes (12 hrs), PWA (8 hrs), stall detection (8 hrs),
      Training behind the paywall (2 hrs).

### FAIL (<6 return)

Do **not** proceed to billing. The failure mode is diagnostic:

- **They never completed setup** → onboarding problem. Fix time-to-first-value, re-run with 20 new
  people. Cheap.
- **They set up, never weighed in** → the engine never fires, so the differentiator never existed
  for them. The day-3 nudge and a lower-friction weigh-in are the fix.
- **They weighed in and still left** → the product itself doesn't hold. This is the expensive
  answer. Reconsider the wedge before writing more code.

**Interview at least 5 of the 20 either way.** The number tells you *whether*; only they tell you
*why*, and a phone call is cheaper than any feature.

---

## STOP BUILDING — killed, out loud

| Kill | Why |
|---|---|
| **Brain / LLM coach** (~35 files, `src/lib/brain/`) | Default-off, $15/mo global cap, touches nothing in the value prop, most complex subsystem in the repo |
| **AI recipe generation** | The only LLM cost, premium-gated, unreliable at any scale because of that cap, and the last remaining allergen-override path. 889 recipes already exist |
| **Electron / desktop shell** | The web deploy doesn't use it; doubles the packaging surface and owns the denylist secrets-leak problem |
| **Micronutrients** | A nice-to-have for users who can't reliably log calories yet |
| **Compare dialog** | A competitor matrix permanently mounted in a single-user app, containing four claims that are wrong about named companies. Move the content to the README or delete it |
| **Design v2 passes 2/3 and 3/3** | Two complete design systems exist and one supersedes the other. A third pass is drift (~40 hrs saved) |
| **Training beyond the paywall move** | v1 templates, four byte-identical weeks (`generator.js:131–151`). Leave it exactly as it is |

---

## Done since 2026-07-24 — do not re-do

Verified live 2026-08-06. The old plan lists all of these as open.

- **Unify `todayStr()`** — both `dates.js:76`, no third inline copy. DONE
- **`resolveSlot` fat/carb tie-break** — `weeklyPlanner.js:696–703` keeps all `fits` and sorts by
  prior/comp/worstRatio. DONE
- **One filter across every surface** — became `exclusionGate.js`, with a CI source-scan that
  breaks the build if a new surface reaches around it. DONE, and better than the plan asked for
- **Age gate** — `ADULT_MIN_AGE`, refused in wizard and route. DONE
- **BMI floor on goal weight** — `GOAL_BMI_ACK` / `GOAL_BMI_REFUSE`, `profile.js:386`. DONE
- **NEDIC hours** — corrected 2026-07-24. DONE
- **`GET /api/export` + `POST /api/import`** — `routes/export.js` (53 KB). DONE
- **`.qc-scratch-agent*`** — 0 MB, already emptied. DONE
- **The "470 corrupt food rows"** — overstated ~6×. Live count is **80**, the UI computes it
  correctly, and the repair ran 2026-07-31. Stale in `foodCategories.js:87`, `FoodsTab.jsx:528`,
  and root `CLAUDE.md`

**Still open from the old plan, deliberately parked** (all fail the Now gate): packaging allowlist
inversion, the 202 MB / 114 MB bundle trims, `FoodsTab` virtualization, RecipeIngredient indexes,
auto-updater, backup pruning, the language/polish phase. Every one is a desktop-build concern and
the web deploy does not use the desktop build. Revisit only if desktop ships again.

**Repo hygiene, 30 min, zero risk, do it while waiting:** 3 stale worktrees
(`.claude/worktrees/apps-editing-claude-02aba7`, `.claude/worktrees/ux-simplify`,
`~/worktrees/cp-prefix-baseline`) and ~19 merged branches. `git worktree remove` first, then
`git branch -d` — never `-D`; let it refuse if the check is wrong.

---

## What's already good — do not "improve" it

Preserved from the 2026-07-24 plan and re-verified where cheap. Written down so no future session
wrecks it.

- **The nutrition math.** Ten BMR formula coefficient sets verified against the literature. The
  calorie floor survived a 250,880-combination sweep and a 20,000-case fuzz with **zero** breaches.
  Re-verified 2026-08-06: `effectiveFloor()` = `max(sexFloor, rmr×0.95, userFloor)` and the ±125
  adaptive step cap is explicitly subordinated to it. I could not construct a sub-floor input.
- **The adaptive estimator.** Huber-robust, AR(1)-corrected, real standard error. A 10 lb overnight
  spike moved expenditure by 3 kcal. The target is derived, never stored, so correcting a weigh-in
  retroactively undoes its adjustment. **This is the product. Protect it.**
- **`exclusionGate.js`.** The gate owns the evidence, degraded input fails closed, and a source
  scan breaks CI if a new surface imports the raw primitives. Better than any commercial app in
  the category.
- **The safety refusals.** Minor gate, goal-BMI refusal, 422-with-`ack` on unsafe rates, floors
  shown rather than hidden, SCOFF screen never gated, verified crisis numbers. This is the
  positioning, not just compliance.
- **`lib/api.js` error copy.** Every message names a cause, says whether the change landed, and
  gives a next step. The best writing in the product.
- **The over-target coach line, the swap → use → lock flow, Trend's projection cone and its refusal
  to draw past the last weigh-in, the one-click "Ate as planned" path** (idempotent server-side —
  and the seam the learned-recipe-pool feature will hang off).
- **`brain/governance.js`** + `aiGovernanceStructure.test.js`, which fails the build on a new
  ungoverned LLM call site. Keep this even after the Brain is killed.
- **Okabe-Ito macro triad, no information conveyed by colour alone, `prefers-reduced-motion`
  honoured, zero shadows.**
- **The eating-disorder screening files** — `WellbeingCheck.jsx`, `WellbeingTab.jsx`,
  `lib/wellbeingResources.js`. **Exempt from any global find-and-replace.** SCOFF wording is
  verbatim-correct; rewording de-validates the instrument.

---

## If you only do five things

1. **[C]** `trailingAverage()` in all three call sites. (5 h) — the app stops disagreeing with itself
2. **[S]** Supabase + Google + Railway. (8 h) — the only step that makes anything else possible
3. **[S]** Post, recruit 20, leave them alone. (6 h) — the only new information in this document
4. **[C]** Resend + cron. (16 h) — the missing organ
5. **[S]** Interview 5 of them on day 14. (2 h) — the number says whether; they say why

Thirty-seven hours, spread over three weeks, and you stop guessing.
