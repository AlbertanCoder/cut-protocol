# THE FLEET — 275 Strangers Walk Into Your App
### Customer-simulation campaign for Cut Protocol · Report-only · BRAIN=off fleet at $0 · BRAIN=on cohort ≤ $5.00 hard cap
*(You are a FRESH Claude Code session in the project root — the folder containing `CLAUDE.md`. You have no memory of this repo. Everything you need is in this file and on the disk. You are a tester, never a fixer.)*

---

## COLD OPEN

The owner built this app alone — a meal-planning engine with a deterministic library-first core and an LLM "brain" that fires only on residual gaps. Tonight he sleeps. While he does, you send 250 strangers through his front door: celiacs and triathletes, truckers and postpartum mothers, a parent managing a gluten-free kid's meals, an office worker who typed a mathematically impossible macro target, a powerlifter allergic to walnuts. Every one of them registers, sets their profile, asks for a plan, and grades what comes back. Twenty-five of them get a full sit-down interview.

Your mission is one sentence: **produce the evidence-grade answer to "would these 275 customers be happy?" — with every defect reproducible from a saved payload, every safety check re-derived from the database by your own query, and not one character of product code changed.**

---

## THE LAWS — read twice; the cage will enforce most of them, you enforce the rest

1. **REPORT ONLY.** You change no product code, no config, no schema, no test, no doc outside your home. Not a typo. A one-character fix is mission failure even if correct. Defects become report entries with repro payloads — never patches.
2. **YOUR HOME.** Your only writable path is `docs/surgery/CAMPAIGN/qa/<run_id>/` (create it; `run_id = qa-fleet-<YYYYMMDD-HHMM>`). Scripts, personas, raw responses, results, state, the report — all live there. Nothing anywhere else, ever.
3. **THE CAGE IS REAL.** This repo runs PreToolUse guard hooks (`guard-edit`, `guard-bash`) driven by `docs/surgery/CURRENT/manifest.json`. They will block forbidden acts with a message. **A guard block is a stop sign, not a puzzle — record it, do not rephrase around it.** You never edit hooks, manifests, `scripts/surgery/`, `.claude/`, or golden baselines.
4. **PORT 3001 IS SACRED.** It belongs to the owner's live packaged app and his real personal data. Never probe it, never reference it in a command (the bash guard denies the string), never kill any process you didn't start. Boot your own dev instance on a high port you choose (3900–3999 range, not ending in 01).
5. **DEV DB ONLY.** All accounts, plans, and ledger rows land in the dev database. Back it up to your home before the fleet runs. Every fleet account uses email `qa-fleet-<run_id>-p<NNN>@fleet.local` so the owner can find and purge them later.
6. **THE MONEY LAW.** Phase 2 runs with `BRAIN=off` — zero LLM spend, and you verify that with the ledger, not with faith. Phase 3 runs `BRAIN=on` with a **hard cap of $5.00 total**, enforced mechanically: read cumulative `LlmUsage` cost before the cohort (C0) and before *every* persona; the moment `C − C0 ≥ $4.50`, the cohort ends mid-stride. Arm the per-generate design cap (`BRAIN_MAX_DESIGNS_PER_GENERATE=2` or whatever the code actually reads — discover it). If the cap machinery cannot be armed and verified, Phase 3 does not run, and that is a recorded blocker, not a workaround opportunity.
7. **NO GIT WRITES.** `git status` / `git log` reads only. No commits, no staging, no branches. Your artifacts stay as untracked files in your home — the campaign's architect will find them there. (Pushing is mechanically impossible in this repo regardless.)
8. **ZERO NEW DEPENDENCIES.** Node stdlib only (`fetch`, `node:crypto`, `node:fs`). The repo's own Prisma client is available for DB reads and the account-mint pattern — use it via the backend's existing setup.
9. **SECRETS.** Never print an env value or key. Presence and shape only, if ever relevant.
10. **HONESTY OF MEASUREMENT.** You never trust the app's own verdict about itself. Allergen safety, macro totals, ledger deltas — all re-derived by your own queries against raw rows. The app is the subject, not a witness.
11. **FAIL CLOSED.** Any preflight failure → stop and write `TO-OWNER.md` in your home stating exactly what he must do (one line if possible). An unattended run without a working cage, a writable home, and an armed money stop does not proceed.
12. **Leash.** If the owner types **"STOP. Report only. Resume the fleet."** — drop whatever you drifted into and return to the current phase.

---

## PHASE 0 — PREFLIGHT (fail-closed; ~15 min)

Work through these in order; every result goes in `PREFLIGHT.md` in your home.

- **P0.1 Orient.** Read `CLAUDE.md` in full. `git log --oneline -5` and `git status` (read-only). Record branch + HEAD — every finding in the final report is stamped with this HEAD.
- **P0.2 The cage, alive.** Read `docs/surgery/CURRENT/manifest.json` — record `run_id`, `mode`, `locked`, and whether `docs/surgery/CAMPAIGN/` appears in the allow list. Create your home and write `probe.txt` into it. If the guard blocks the write, STOP: write nothing else, print a `TO-OWNER` note — *"The current manifest does not allow `docs/surgery/CAMPAIGN/` — add it to the allow list or re-run the fleet after the campaign's current unlock window."* Then verify the cage actually fires: attempt exactly one harmless forbidden act (e.g. `echo` a string containing `sk-ant-FAKE`) and expect a block. If the hooks are NOT firing at all, ABORT the mission — an uncaged unattended run is forbidden — and say so in `TO-OWNER.md`.
- **P0.3 Discover the app — from code, not memory.** Read, and record in PREFLIGHT.md with symbol names:
  - `backend/src/routes/auth.js` (or equivalent): the register/login flow, the session cookie name (`cutprotocol_session` expected — verify), why register 403s on a populated install.
  - `scripts/surgery/witness.js`: the canonical, already-debugged pattern for account mint (Prisma-direct `user.create` + real `POST /api/auth/login` to earn the cookie), dev-server boot on a non-default port, and ledger snapshots. **Mimic its auth approach; do not reinvent it.**
  - `backend/src/routes/plans.js`: the generate endpoint(s), request payload shape, day-vs-week horizon parameters.
  - The profile/onboarding routes: how a user's goals, macros, diet flags, allergies/walls, and meal-count preferences are actually set over HTTP. List every profile field the API accepts — this list becomes the persona forge's vocabulary. Anything a real customer would want that has no API surface is recorded as a PRODUCT GAP (not a defect).
  - `prisma/schema.prisma`: the `User`, plan, recipe/Food, and `LlmUsage` models — enough to write your own safety and totals queries.
  - `backend/package.json`: the dev boot script.
  - `backend/src/lib/weeklyPlanner.js` + `mealRouter.js` headers (read-only): note the BRAIN flag mechanics and the day-tolerance trigger if present — Phase 3 field-tests it.
- **P0.4 Boot.** Start your own dev backend, `BRAIN=off`, on your chosen high port. Health-check it (`/api/brain/status` should answer). If a server is already running somewhere, leave it alone — yours is separate. Record the exact boot command, port, and PID.
- **P0.5 Baselines.** Dev DB file copied into your home (backup). Ledger baseline via `node scripts/surgery/ledger-delta.js` if runnable, else your own Prisma query: total rows + total cost. Record both numbers — Phase 2's "$0 spent" claim is judged against them.
- **P0.6 Resume check.** If `state.json` already exists in a same-day fleet home, this is a crash resume: load it, skip completed personas (their accounts exist — detect by email and log in instead of minting), and continue from the recorded phase. Idempotence is a design requirement of every script you write tonight.

---

## PHASE 1 — THE PERSONA FORGE (deterministic; ~20 min)

Write `personas.mjs` in your home. Seeded RNG (seed = the run_id string, hashed; record it). It emits `personas.jsonl` — **250 unique personas** — plus `persona-distribution.md` summarizing the spread. No two personas share the same full constraint tuple; enforce uniqueness programmatically.

Sample each persona independently across these axes, **then map onto the app's actual profile vocabulary from P0.3** (unsupported wishes → recorded as requested-but-unsupported on that persona's card):

- **Body & stats:** age 16–78 (under-18s exist only as a *parent-managed* flag on an adult account), sex, height, weight spanning BMI ~17–45.
- **Goal:** cut 0.5 / 1.0 / 1.5 / 2.0 lb-wk · maintain · lean bulk 0.25–1.0 · recomp.
- **Life & activity:** office worker, formwork carpenter, nurse on 12s, long-haul trucker, cyclist, triathlete, powerlifter, weekend warrior, postpartum, sedentary senior, student athlete, shift worker with 2 a.m. meals.
- **Diet pattern:** none, keto, vegetarian, vegan, pescatarian, halal, kosher, low-FODMAP, Mediterranean, paleo — whatever subset the app supports; the rest become gap notes.
- **Walls (0–4 per persona, weighted toward 0–2):** celiac/gluten, soy, shellfish, peanut, tree nut (walnut named), dairy, egg, fish, sesame, nightshade-avoidance (skin condition), cilantro aversion, "no pork," "no beef."
- **Macro style & targets:** balanced / high-protein / low-carb / low-fat; calories derived from stats *or* explicitly user-set including edge values (1,200 floor; 4,500 athlete); protein set as g/lb in some personas.
- **Horizon:** ~70% single-day plans, ~30% full-week.
- **Difficulty tier** (stamped on each persona):
  - **EASY (~60%)** — mainstream constraints; the library should saturate these.
  - **HARD (~25%)** — stacked walls + tight bands + aggressive protein (the celiac+soy+high-protein family) — engineered so some days genuinely cannot land in tolerance without repair or the brain.
  - **IMPOSSIBLE (~10%)** — mathematically contradictory (e.g. 1,000 kcal with 150 g protein AND 150 g fat ≈ 1,950 kcal of macros; or every major protein source walled off simultaneously). **A happy customer here is one who gets a clear, honest, fast refusal with an explanation — a confident "plan" that pretends to satisfy the impossible is a CRITICAL honesty defect; a hang is a defect.**
  - **ROBUSTNESS (~5%)** — weird-but-legal inputs: unicode names, a 300-character allergy note, keto flag with a carb target, zero-meal or nine-meal day requests. Mild stress, not a pentest.

---

## PHASE 2 — THE SCRIPTED FLEET (BRAIN=off · $0 · all 250; ~30–60 min)

Write `fleet.mjs`. Concurrency ≤ 3 (SQLite; back off on write-lock errors, they are findings only if persistent). For each persona:

1. **Mint** — Prisma-direct user create with the fleet email + a generated password, then a real `POST /api/auth/login` to earn the session cookie (the witness.js pattern). Cookie jar per persona.
2. **Profile** — set everything through the real HTTP endpoints in the order the UI would. Direct DB writes are allowed ONLY for the account row itself; profiles go through the front door, because the front door is what's on trial.
3. **Generate** — request the plan (day or week per persona). 90-second client timeout: a hang past it is logged as a spinner-forever defect and the persona moves on.
4. **Capture** — full raw response + timing to `raw/p<NNN>.json`.
5. **Grade deterministically**, writing one line to `results.jsonl`:
   - **SAFETY (precondition, pass/fail):** your own transitive query — every ingredient of every meal in the plan, resolved against raw Food/recipe rows in the DB, checked against the persona's walls. The app's own warnings are NOT consulted. **Any leak = P0 defect** with the full repro payload; log it loudly and continue (you are observing, not operating).
   - **MACROS:** recompute day totals from raw rows; inside the app's tolerance bands? Record per-macro deltas. If out of band, did the app *say so honestly* (visible warning) or silently present the day as fine? Silent misses are honesty defects, distinct from accuracy misses.
   - **FUNCTIONAL:** HTTP codes, latency, honest error surfaces vs blank 500s.
   - **IMPOSSIBLE tier:** graded on refusal quality — clear message, correct reason, fast, no fake plan.
   - **VARIETY & STABILITY (mini Monte Carlo):** for a fixed 15-persona subsample, regenerate 3× each; record distinct-recipe counts, macro-compliance stability across regenerations, and week-plans' internal repetition.
   - **AFFORDABILITY:** if the app exposes any cost/price surface, grade it; if none exists, record once as a PRODUCT GAP.
6. **Heartbeat** — append one line per 25 personas to `heartbeat.log` (`n done · pass-rates · elapsed`), and refresh `state.json` (phase, index, spend) for crash-resume.

**Systemic-failure brake:** if ≥ 30% of the first 50 personas hard-fail on the same endpoint with the same signature, stop the fleet early — the remaining 200 would measure the same broken pipe — and proceed to Phase 5 with what exists, headline finding first.

**Close of phase:** re-run the ledger query. Spend during Phase 2 MUST be $0.00 — print the two numbers side by side.

---

## PHASE 3 — THE BRAIN COHORT (BRAIN=on · ≤ $5.00 hard cap · ≤ 20 personas; ~30 min)

Restart your dev instance with `BRAIN=on` and the design cap armed (≤2 designs per generate, via the mechanism the code actually reads). Select up to 20 personas:

- ~15 from **HARD** tier whose Phase-2 days landed OUT of tolerance or carried warned slots — genuine residual gaps, the exact prey the day-tolerance trigger was built to catch.
- 2–3 whose Phase-2 days landed comfortably IN band — on these, per the repo's D0 law (library-first, brain residual-only), **the brain staying silent is the pass**; a fired brain and a nonzero delta on an in-band day is a defect.
- 2 from **IMPOSSIBLE** — the brain must not burn dollars chasing contradictions; a fast honest refusal with $0 spent is the pass.

Mechanics per persona: ledger read → if `C − C0 ≥ $4.50`, cohort OVER, record where it stopped → else generate → ledger delta attributed to this persona (row IDs, phase, cost, timestamps inside your window) → your own checks: day now in band (recomputed from raw rows)? free repair logged before any model call? brain-designed slots engine-verified and cached with `source:"brain"` provenance? **safety re-verification on every brain-designed meal — a brain leak is the single worst possible finding of the night.**

If the brain path errors (the trigger surgery may be mid-campaign): capture the exact server-log error verbatim, localize read-only to a symbol if the log names one, mark the cohort INCOMPLETE, and continue — a broken brain precisely documented is a first-class deliverable, not a failed mission. Same if the brain never fires despite residual gaps: name the swallowing behavior from logs and Phase-2 evidence.

---

## PHASE 4 — THE AGENT CUSTOMERS (25 deep-dives; ~45 min)

Now the humans-in-silico. Use the Task tool to run **25 isolated customer agents, ≤ 3 concurrent**. Stratified sample: 10 HARD · 8 EASY · 4 IMPOSSIBLE (grading the refusal experience) · 3 from the brain cohort (if it ran).

Each agent receives ONLY: its persona sheet, the base URL + port, its pre-minted credentials, and the report-card template. Each agent is told, verbatim in spirit:

> *You are this customer. You have never seen this codebase and you must not read it — you experience the product through its HTTP API exactly as the app would show it to you. Log in. Review your generated plan meal by meal as YOUR persona: would you eat this? Does the combination make culinary sense? Can someone with your schedule actually prep it? Would you pay for this? Perform one realistic follow-up a customer would try (regenerate, swap a meal, tighten a target — whatever the API offers) and judge how that went. Then fill the report card. Be specific: quote the meal or message that earned each score. You know nothing about any other customer.*

**Report card (JSON, schema-validated by the collector):** satisfaction 1–10 · would-recommend y/n · the owner's five criteria scored 1–10 each — **(1) macros actually in range, (2) it works end-to-end, (3) the meals are good, (4) affordable / adjustable, (5) tasty** — with allergen respect as an absolute precondition (any leak the agent notices = automatic 1/10 + P0 flag) · top 3 delights · top 3 defects, each with the exact response snippet · one-sentence verdict. Malformed card → one retry → else marked `agent-failed` and noted.

Agents never see each other, the aggregate, or this mission file's grading logic — isolation is the point.

---

## PHASE 5 — MONTE CARLO ROLL-UP + THE REPORT (~20 min)

Write `stats.mjs`: pass rates with 95% Wilson intervals, sliced by wall type, diet, tier, goal, and horizon · defect clusters (signature = endpoint + error class + constraint pattern) · regeneration variance from the 15×3 subsample · latency p50/p95 · spend accounting to the cent · a convergence note (are rates stable between the first and second half of the fleet?). Emit `stats.json` + `defects.json`.

Then **`FLEET-REPORT.md`** — the owner reads this over coffee. Plain English, in this order:

1. **The verdict paragraph.** Would these 275 customers be happy — and is this app ready for the owner and his girlfriend to live on? Answer it straight.
2. **The scoreboard.** Safety record first (leaks MUST be zero; any leak is the headline of the entire night) · macro-compliance rate · impossible-tier honesty rate · satisfaction distribution from the 25 cards · uptime/latency.
3. **TOP 10 DEFECTS**, ranked severity × frequency. Each: one-line description · affected-persona count · repro payload path · evidence path · read-only localization to a symbol where the logs allow. These are written so the campaign's architect can lift them directly into ORDERs.
4. **What customers loved.** The good news is data too.
5. **Product gaps** (unsupported diets, missing pricing, absent surfaces) — kept separate from defects.
6. **The brain story.** Did the new day-tolerance trigger catch real residual gaps in the field? Free-repair-first honored? Silent-when-in-band honored? Rows, dollars, and the D0 verdict in plain words.
7. **Recommended fix order** for the next surgery campaign — 3 to 6 bullets, symbols not line numbers.

## THE RECEIPT — print as the absolute final output, nothing after it

```
FLEET RECEIPT v1
run_id: qa-fleet-<...>        head: <sha>        seed: <...>
personas: <n> run / <n> planned · deep-dives: <n>/25 · brain cohort: <n> (<complete|capped|blocked>)
SAFETY: leaks=<n>  (0 or the night's headline)
MACROS: <x>% of days in band · honesty-on-miss: <x>%
IMPOSSIBLE tier: <x>% honest refusals
SATISFACTION: median <n>/10 · would-recommend <x>%
MONEY: phase2=$0.00 verified · phase3=$<x.xx> of $5.00 cap · rows <ids range>
TOP 3: <one line each>
REPORT: docs/surgery/CAMPAIGN/qa/<run_id>/FLEET-REPORT.md
END RECEIPT
```

Shut down the dev server you booted. Touch nothing you didn't start. The fleet goes home; the report stays.
