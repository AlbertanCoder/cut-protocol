# What people want vs. what Cut Protocol has — 10-agent forum/market scrub

_2026-07-24. Ten research agents across calorie-counting, fitness/recomp, meal-prep/budget,
allergy/dietary, diet-specific (keto/vegan/IF/low-cal), ED-safety, and four competitors
(MacroFactor, MyFitnessPal, Cronometer/Lose It/Carbon). Per-source detail in the sibling
`*.md` files._

## Read this first: a real limit on the scrub

**Reddit is blocked to automated tools in this environment.** Every agent hit the same wall —
`reddit.com` refuses WebSearch (400) and WebFetch (403), and the read-only mirrors
(old.reddit, redlib, libreddit, teddit) are 403/blocked too. One agent got **one** real
r/leangains page through the connected browser before the extension dropped. So this is **not**
a verbatim-Reddit scrape. It is built from *reachable* public sources that voice the same
demand: competitor forums (Cronometer), app-store review aggregators, comparison/review
articles, help centers, and clinical/press coverage. Findings are directional and cited in the
per-source files; nothing was invented. A browser-driven Reddit pass is the honest follow-up if
you want verbatim posts + permalinks.

## The one-line verdict

Cut Protocol is a **solver in a market of trackers.** Every major competitor — MyFitnessPal,
MacroFactor, Cronometer, Lose It, Carbon — *logs what you ate* or *coaches a number*. None
*builds a compliant plan to your target.* "Just tell me what to eat" is a repeatedly-voiced,
unmet desire, and it is the thing you already do. Your gaps are almost entirely **logging,
mobile, and habit mechanics** — the surrounding conveniences — not the engine.

## What people want vs. what you have

| What people repeatedly ask for | Cut Protocol today |
|---|---|
| "Just tell me what to eat" — a plan that hits my macros | ✅ **Core strength** — the deterministic solver. Nobody else does this. |
| Adaptive TDEE (is my deficit real? plateau anxiety) | ✅ Adaptive TDEE from weigh-ins, step-capped, BMR floor |
| Allergy/diet handling that actually *removes* unsafe food | ✅ **Rare differentiator** — true zero-tolerance exclusion (not tag-filtering) + step-text scan + rares |
| Micronutrients without paywalls | ✅ Auto micro rollup from the built plan |
| No ads / no subscription / owns my data / private | ✅ Offline, local, one-time — sidesteps MFP's top 4 complaints |
| Budget / cost-per-serving meals | ✅ Cost filter + grocery list with real purchase units |
| Fast logging of what I *actually* ate (barcode/photo/voice) | ❌ **Biggest gap** — prescriptive only |
| On my phone | ❌ Desktop only |
| 7-day rolling average as the *headline* number | ⚠️ Has trend + adaptive, but the daily number is still the hero |
| Pantry-first / use-what-I-own / leftovers / no waste | ❌ No inventory model |
| One plan for a household with different diets/allergies | ❌ Single-eater |
| Cross-contamination / "may contain" flags | ⚠️ `mayContain` column exists, unpopulated |
| Big, accurate, verified food + restaurant database | ⚠️ 889 validated recipes ≠ 20M branded/restaurant items |
| Habit hooks: reminders, streaks, weekly check-in nudges | ❌ Deliberately avoided (anti-streak-shame) — a real tension |

## Lead with these (validated strengths, low/zero build)

1. **"A solver, not a tracker."** This is the whole positioning. It maps directly onto
   MacroFactor's #3 most-requested-missing feature and the market-wide "Eat This Much but
   better" wish. Say it on the landing screen.
2. **Own-your-data, pay-once, private.** The anti-subscription / post-MFP-paywall cohort is
   loud and real, and a whole class of new apps now leads with it — validation that it sells to
   a niche.
3. **Safety as a feature.** ~73% of people with an ED who used a calorie app felt it made things
   worse. Your no-red / calorie-floor / no-streak design + the new wellbeing self-check +
   disclaimer are a genuine, differentiated, *marketable* stance — not just compliance.

## Highest-leverage gaps to close, ranked by value ÷ effort

1. **Make the 7-day rolling average the headline number** (LOW effort, HIGH value). The single
   strongest *verified* Reddit signal: "no app shows rolling averages as the main view; the
   daily number makes me feel like I failed." You already compute it — promote it, demote the
   daily figure, and it doubles as an anti-anxiety safety win.
2. **Make the adaptive TDEE legible** (LOW-MED). Show the expenditure trend line and a plain
   "your target changed because…" line. Your strongest hidden feature is currently invisible;
   MacroFactor's whole loved-ness is this *presentation*, not better math.
3. **A satiety / volume score and/or a keto electrolyte + net-carb view** (MED, low competition).
   Both are things only a solver can own, and rivals paywall or lack them.
4. **Populate `mayContain` + surface cross-contamination flags** (MED). Highest-value allergy
   gap, and you already have the column and the OFF-tag pipeline.
5. **A lightweight "log what I actually ate" path** (MED-HIGH, but tension). The #1 market ask —
   *but* your plan-first model is also a safety advantage (avoids the log-every-bite guilt
   loop). If you add logging, keep it optional and non-guilt-framed. A companion mobile-log or a
   barcode import is the realistic bridge without abandoning desktop.

## Two business truths, stated plainly

- **Desktop-only is a strength for your niche and a liability for a mass audience.** Even
  Cronometer power users keep a phone for on-the-go and barcode. Realistic target: the
  privacy-conscious, subscription-fatigued, data-owning serious cutter who works at a desk —
  i.e., *you*. Underserved, and willing to pay once. Don't position as a MyFitnessPal killer.
- **A one-time price can't fund ongoing food-database upkeep** — and a decaying/inaccurate DB is
  the market's #1 dealbreaker. This is the core tension to solve before scaling: either a
  maintenance model, a USDA-only "no crowd data" promise (which you already lean on), or accept
  the niche and keep the library curated and small.
