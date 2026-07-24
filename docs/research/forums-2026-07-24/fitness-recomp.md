# Fitness/Recomp Forum Research — 2026-07-24

## Source & access honesty (READ FIRST)
- WebSearch and WebFetch **both block reddit.com** and every mirror I tried (old.reddit, redlib, libreddit → 403/502/"unable to fetch"). Aggregator blogs (e.g. nutrola.app) quote **no** real posts.
- Only reachable path was the **user's own Chrome** (read-only). It returned one full real page before the extension disconnected and would not reconnect.
- **Verified subreddit this session: r/leangains only** (top / all-time, query `app`). r/naturalbodybuilding, r/xxfitness, r/Fitness, r/gainit were **NOT reached** — not reported on. Nothing below is invented.
- Citations = exact title + score + age + author under: `https://old.reddit.com/r/leangains/search?q=app&restrict_sr=on&sort=top&t=all` (individual permalinks were stripped by text extraction; titles are unique enough to locate).

## 1. Top wants / pain points (r/leangains, real)
1. **"Tracking weekly averages instead of daily calories changed my entire cut"** — 45 pts, 36 comments, ~1 mo ago, u/Stock-Pickle4337. "**NO app shows rolling averages as the main view.** MFP and LoseIt both default to the daily number, which... makes me feel like I failed." Does it manually in a spreadsheet. **← strongest, most recent want.**
2. **"I feel like cutting is 10x harder than bulking"** — 38 pts, 28 comments, ~13 days ago. "Am I actually in a deficit? Am I losing fat or muscle? Should I lower calories again or just wait another week?" MFP + others → still second-guessing.
3. **"This is how you calculate your TDEE"** — 202 pts, 38 comments. Weigh food + weigh daily → weekly average → back-out maintenance from intake vs weight change. Community-canonical adaptive-TDEE method.
4. **"Is there any great apps for tracking gym/lifting numbers?"** — 83 pts, 106 comments.
5. **Snackr free tracker launches** — 393 pts / 269 pts. Demand: **free, no ads, barcode scan, large (USDA/1.3M) food DB.**
6. **"Leangains-friendly macro planner (Joy)"** — 77 pts, 89 comments. Loved: **variable macros per day (workout vs rest day)**, DB "more accurate than MFP," easy copy/move meals & whole days, recipe sharing.
7. **foxtopus 12-wk cut** — 187 pts. Wants a training app that "promotes goal obtainment, overcoming plateaus, anticipating deload." JEFIT cons: UI, adding unlisted exercises, cost, **no progression/deload recommendations.**
8. **"Leangains Tools" / web calculators** — 119 / 139 pts. Ongoing demand for a canonical calc + tool list.
9. **"Gain muscle in calorie deficit" (Lifesum)** — 66 pts. Recurring recomp confusion.
10. Older-lifter stall posts (Carbon app user, 57M) — "can't lose the belly fat" despite adherence → want stall guidance.

## 2. What Cut Protocol already covers (honest)
- **Meal solver to macro target** → kills the planning burden behind #6/#9.
- **Adaptive TDEE from weigh-ins (step-capped) + BMR floor** → directly is #3, and answers #2's "am I in a deficit."
- **Weigh-in trend + verdict** → addresses #2 second-guessing.
- **Allergy/diet + cost/time/complexity/taste filters, grocery list, recipe library/importer, micros, training templates, offline/private.**

## 3. Gaps, ranked by observed frequency
1. **7-day rolling average as the DEFAULT headline number** (#1, recent, explicit). If the verdict view still leads with a daily figure, surface the rolling trend as the primary number. **HIGH.**
2. **Actual-intake LOGGING: barcode scan + large verified food DB** (#5, #2, #4). Cut Protocol *plans*; the community also wants to *log what they actually ate*. Biggest functional gap. **MED-HIGH.**
3. **Per-day-type macro cycling (training vs rest day)** (#6, core leangains). Solver targets one number — support day-type targets. **MED.**
4. **Training progression intelligence** (progression/deload/PR, add custom exercise) beyond static templates (#7, #4). **MED.**
5. **Explicit recomp / gain-in-deficit mode & stall playbook** (#9, #10). **LOW-MED.**

## 4. Safety / harm themes
- **Daily-number fixation drives diet anxiety / "I failed" feelings** (#1 verbatim) — rolling averages and non-shaming UI (no red/over-target scolding, per MacroFactor's design) reduce disordered-eating pressure. Secondary: Healthline & app-user studies link diet-app use to higher dietary restraint / ED symptoms.
- **Over-restriction when stalling** ("Should I cut calories again?", #2/#10). Cut Protocol's **step-capped TDEE + BMR floor + never-below-2000-kcal** rule is the correct mitigation — keep it prominent.

_Secondary (non-Reddit, clearly labeled): Healthline "track macros without it taking over your life"; MacroFactor marketed as no red numbers / no shaming. Used only for the safety section._
