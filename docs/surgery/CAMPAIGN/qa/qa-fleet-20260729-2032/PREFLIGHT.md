# PREFLIGHT — qa-fleet-20260729-2032

**Verdict: PASS. The fleet may run.** Cage live, home writable, money stop armable, front door proven.

## P0.1 Orient

| | |
|---|---|
| branch | `fix/audit-remediation` |
| HEAD | `0d3eaa5b51a8aacdee9c2a19b691050f4bd1e39c` (`0d3eaa5` — "Cache compiled word patterns in dietaryFilter (3.4x on the exclusion gate)") |
| working tree | dirty, but only in `docs/surgery/` (ledger.md modified; two handoffs, this mission file, and a `verify/` dir untracked). No product file modified at start, and none by me. |
| git writes | none. `git rev-parse` / `log` / `status` only. |

**Every finding in the final report is stamped to `0d3eaa5`.**

`CLAUDE.md` read in full (root + repo). Noted as binding on my own conduct: the
allowlist-vs-denylist packaging rule, the "superseded claims" correction table
(food library is **14,122+**, not 854 — confirmed 14,148 rows tonight), and the
standing instruction that Atwater consistency is not a correctness warrant.

## P0.2 The cage, alive

`docs/surgery/CURRENT/manifest.json`:

| field | value |
|---|---|
| `run_id` | `campaign-p2-m0` |
| `mode` | `surgeon` |
| `locked` | `false` |
| `issued` | 2026-07-28 (parent `surgery-20260727-1010`, `head_at_issue` b82d577) |
| `docs/surgery/CAMPAIGN/` in allow list | **YES** (entry 6 of 8) |

Home created at `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/`; `probe.txt`
written and accepted. No `TO-OWNER.md` needed.

**Cage liveness probe — the guard fires.** One harmless forbidden act attempted:
a `Bash` call whose command contained a literal `sk-ant-…`-shaped string.

```
PreToolUse:Bash hook error: [node .claude/hooks/guard-bash.js]:
BLOCKED: a literal API key not on the incision manifest.
An API key shape may never appear in a command.
```

Blocked as designed. **Not rephrased around, not retried** — recorded and moved
on, per Law 3. Hooks are firing; the unattended run is caged.

## P0.3 The app, discovered from code

### Auth — `backend/src/routes/auth.js`, `backend/src/lib/auth.js`

- Session cookie name **`cutprotocol_session`** — *verified*, and it is the only
  path: `requireAuth` reads the httpOnly cookie exclusively. **There is no bearer
  token anywhere in the app.** A harness must hold a cookie like a browser.
- `POST /api/auth/register` is **gated, not open** (`router.post("/register", optionalAuth, …)`):
  permitted only when `prisma.user.count() === 0` *or* the caller already holds a
  live session. This install has **13 users**, so registration answers
  **403 "This machine already has an account."** That is why the fleet mints via
  Prisma-direct `user.create` and then signs in through the real
  `POST /api/auth/login` — the witness.js pattern, mimicked, not reinvented.
- Login throttle: 10 failed attempts / 15 min, keyed `ip|email`. Successes clear
  it. The fleet never mistypes, so it cannot trip this.
- `hashPassword` = bcrypt cost 12 (~250 ms). The fleet hashes **once** and reuses
  the digest across all 250 rows — same password, same verification, ~60 s saved.

### Account mint — `scripts/surgery/witness.js` (the canonical, already-debugged pattern)

Adopted wholesale: Prisma-direct `user.create({ email, passwordHash, role:'user' })`
→ real `POST /api/auth/login` → cookie jar per persona (`getSetCookie()`, absorb
`name=value` before the first `;`). Also adopted: non-3001 boot, ledger snapshot
before/after, and its hard-won lesson about *field names that are silently
dropped* (see the PROFILE GAP note below — that is exactly what bit the witness).

### Profile — `backend/src/routes/profile.js`

`PROFILE_FIELDS` is a **whitelist**, and anything outside it is **silently
discarded with a 200** — the failure mode witness.js was amended for on 2026-07-29.
The persona forge's entire vocabulary is therefore these 24 fields:

`sex` `age` `heightCm` `bodyFatPct` `bodyFatSource` `occupationKey`
`activityOverride` `sessionsPerWeek` `trainingStyle` `minutesPerSession`
`startWeightKg` `goalWeightKg` `startDate` `unitPref` `rateLbPerWeek`
`rateAcknowledged` `floorKcal` `excludedFormulas` `mealsPerDay` `snacksPerDay`
`excludedFoods` `dietaryStyle` `cuisinePreferences` `mealPreferencesNote`

Enumerations, read from the code (not from memory):

| field | accepted values |
|---|---|
| `dietaryStyle` | `none` `mediterranean` `vegetarian` `vegan` `paleo` `keto` `carnivore` `halal` `kosher` (9) |
| `rateLbPerWeek` | `0.25` `0.5` `0.75` `1` `1.25` `1.5` `2` — *exact membership*, no free values |
| `occupationKey` | 43 keys (`desk-office` … `manual-harvest`) |
| `trainingStyle` | `weights` `mixed` `sport` `cardio` |
| `unitPref` | `imperial` `metric` · `sex` `M` `F` |
| bounds | age 14–100, heightCm 100–250, weightKg 30–400, bodyFatPct 0–70, mealsPerDay 1–8, snacksPerDay 0–8, minutesPerSession 0–300, sessionsPerWeek 0–14, activityOverride 1.0–2.2, `excludedFoods` ≤40 items × ≤60 chars |
| `floorKcal` | stricter-only; refused below `SAFE_FLOOR` = M 1500 / F 1200 |

Gates that will shape persona outcomes, all server-side on the **merged** candidate:
- **`adultGate`** — age < 18 ⇒ **403** `gate:"adult-only"`, with a three-paragraph
  explanation of why adult BMR formulas read 600–900 kcal low for a growing body.
  Bounds still accept 14 so the *gate* answers, not a range error.
- **`goalWeightGate`** — goal BMI < 16 ⇒ **400 refused, no override**; 16–18.5 ⇒
  **422 `requiresAck:"goalWeight"`**; a *height* correction that strands an
  already-saved goal is downgraded to the ack path rather than refused.
- **unsafe rate** — >1 %/wk (or floor-clamped) ⇒ **422 `requiresAck:"rate"`**
  whenever rate/floor is touched. `ack` names *which* confirmation, so a rate
  acknowledgement cannot answer the goal-weight question.
- `targetKcal` is **derived, never client-set**, and re-materialised by
  `recomputeTarget()` on every profile write.

### Plans — `backend/src/routes/plans.js`

- `POST /api/plans/generate`, body `{ horizon, filters }`.
- `horizon`: `meal` (0 d, no writes) · `day` 1 · `3days` 3 · `week` 7 ·
  `2weeks` 14 · `month` 28 · or any integer 1–90. Absent ⇒ `week`. Sub-week
  horizons start **today**; week-or-longer start at **this week's Monday**.
- `filters` (per-request, `parseFilters`): `cuisines[≤8]` `protein` `budget`
  (`cheap|moderate|premium`) `maxPrepMin` `maxCostCad` `maxComplexity` 1–10
  `minTaste` 0–1 `allowBatchRepeats` `proteinPriority`.
  **Diet and allergies are deliberately NOT filters** — they come from the
  profile and are enforced in `filterRecipePool`, always.
- Response: the Plan row + slots, plus `meta` = `matchPct` `attempts` `score`
  `days[]` `diagnosis` `poolCounts` `variety` `priorWeeksConsidered` `horizon`.
- Other surfaces a customer could try as a follow-up: `POST /day-options`,
  `POST /accept-day`, `POST /:planId/slots/:slotId/alternates`,
  `PUT …/apply`, `POST …/swap`, `POST /place-recipe`,
  `POST /fill-today-from-cart`, `POST /:planId/grocery-list`.

### PRODUCT GAP found at the API surface (recorded, not a defect)

`Profile` in `schema.prisma` carries **six preference columns with no HTTP write
path**: `maxPrepMin` `budgetTier` `allowBatch` `maxComplexity` `adaptiveTdee`
`proteinPriorityMode`. None are in `PROFILE_FIELDS`; the only writer anywhere in
`backend/src` is `routes/export.js`'s import path. The equivalent knobs exist
**only as per-request `filters`**, so a customer cannot *save* "I never cook
longer than 20 minutes" or "I'm on a budget" — they must re-state it on every
single generate, and the profile column that looks like it remembers stays null.
Recorded per the mission: a real customer wish with no API surface.

Also absent from the vocabulary, so recorded as gaps rather than faked:
**pescatarian / low-FODMAP** (not in `DIETARY_STYLES`); **user-set calorie or
protein targets** (`targetKcal` is derived by design — a persona who "typed
4,500 kcal" can only approach it through stats/rate, and `floorKcal` is a floor,
not a target); **any parent-managed or minor flag** (`adultGate` refuses under-18
outright, and `routes/profile.js:158-177` states plainly that pregnancy /
breastfeeding / ED-history columns do not exist and cannot be added from there).

### Schema — `backend/prisma/schema.prisma`

Models the fleet queries directly: `User`, `Profile`, `Plan`, `PlanSlot`
(`ingredients` Json `[{foodId,name,grams,role}]`, `kcal/protein/fat/carb`,
`warning`, `locked`), `Recipe`, `RecipeIngredient`, `Food`
(`name/kcal/protein/fat/carb/fiber`, `allergenTags`, `mayContain`), `LlmUsage`
(`costUsd`, `phase`, `model`, `createdAt`).

**Structural fact that decides how safety can be judged at all:**
`Food.allergenTags` and `Food.mayContain` are **NULL on all 14,148 rows**
(`select typeof(allergenTags), count(*) … group by 1` ⇒ `null, 14148`). There is
no label-declaration data in this database. Name matching over raw `Food.name`
is therefore the only evidence available to *anyone* — the app or me. The app
documents this limit itself (`allergenTaxonomy.js`, sulphites note: *"Until
allergenTags/mayContain are populated (barcode import only), this key catches the
dried fruit and nothing else"*), so it is context for the audit, not a surprise.

### Brain — `mealRouter.js` / `weeklyPlanner.js` / `plans.js`

- `isBrainEnabled()` = `process.env.BRAIN === "on"` **AND** (`ANTHROPIC_API_KEY`
  present **OR** a relay configured). With `BRAIN=off` the `aiFallback` argument
  is **omitted entirely** from `generateHorizonPlan`, so the horizon planner runs
  the pre-P0-1 deterministic path byte-for-byte. That is the mechanical basis of
  the Phase-2 $0 claim, and it is still verified against the ledger, not trusted.
- **Design cap discovered, as required:** `BRAIN_MAX_DESIGNS_PER_GENERATE` →
  `BRAIN_CALL_CEILING` (`plans.js:155`), then
  `brainCallBudget = min(CEILING, max(1, ceil(days/2)))`. Default 12.
- Also armable: `BRAIN_PER_REQUEST_CAP_USD`, `BRAIN_DAILY_COST_CAP_USD`,
  `BRAIN_MONTHLY_COST_CAP_USD` (the witness proves the monthly one must be armed
  **relative to month-to-date spend** or the run starves and reports a false null),
  `BRAIN_GENERATE_BUDGET_MS` (75 s), `BRAIN_SLOT_TIMEOUT_MS` (35 s).
- The wall-clock contract, quoted because Phase 3 field-tests it: *the server
  must always answer before the client hangs up* — 75 s brain ceiling + ~10 s
  solve ≈ 85 s worst case against a 120 s client patience.

### Secrets

Presence and shape only, never a value. `backend/.env` present, keys:
`DATABASE_URL PORT JWT_SECRET USDA_API_KEY ANTHROPIC_API_KEY SEED_EMAIL
SEED_PASSWORD BRAIN`. `backend/.env.qc` also present (the file `CLAUDE.md` names
as slipping past the packaging denylist), keys additionally include
`ANTHROPIC_BASE_URL`. **An `ANTHROPIC_API_KEY` is present**, so Phase 3's brain
arm is capable of firing — which is exactly why the money stop is mechanical.

## P0.4 Boot

| | |
|---|---|
| command | `PORT=3947 HOST=127.0.0.1 BRAIN=off node server.js` (cwd `backend/`) |
| port | **3947** — my own, in the 3900–3999 range, not ending in 01 |
| log | `server-phase2.log` in this home |
| health | `GET /api/auth/status` ⇒ `200 {"needsSetup":false}` · `GET /healthz` returns the SPA index (the frontend catch-all swallows that path in this build; it is still a 200, which is why witness.js's `waitForBoot` works) · `GET /api/brain/status` requires auth |

**Port 3001 was never probed, never referenced, and no process I did not start was
signalled.** The owner's live app is untouched.

Boot-time `[data-audit]` line, recorded verbatim as pre-existing context:
`foods 14148 (1 failing), recipes 889 (779 failing), duplicate groups 0 [fresh]`
— 779 of 889 recipes carry `untrusted-ingredients`, and 25 rows are placeholders
awaiting real data. Not caused by the fleet; relevant to how much of the library
is trustworthy under load.

## P0.5 Baselines

| | |
|---|---|
| dev DB | `backend/prisma/dev.db`, 19,419,136 bytes, copied to `backup/dev.db.fleet-baseline` (no `-wal`/`-shm` present at copy time) |
| Food rows | 14,148 (0 with `allergenTags`, 0 with `mayContain`) |
| Recipe rows | 889 · RecipeIngredient rows 7,024 |
| User rows | 13 (pre-fleet) · Plan rows 8 |
| **LEDGER C0** | **13 rows, $0.392812** — newest `cmrzu1bcd0051wlo08nakbblp` @ `2026-07-25T03:51:39.182Z` |

Confirmed via `node scripts/surgery/ledger-delta.js` (runnable) **and** an
independent raw-SQL aggregate; the two agree. Every pre-existing row predates my
window by four days, so Phase-3 attribution is unambiguous.

Phase-2 spend will be judged against **$0.392812** and must not move it.
Phase-3 hard stop: cohort ends the moment `C − C0 ≥ $4.50`.

## P0.6 Resume check

No `state.json` in this home ⇒ fresh run, not a crash resume. Every script the
fleet writes is idempotent by construction: `mintAndLogin` logs into an existing
fleet row instead of re-creating it, `results.jsonl` is append-only with the
persona index as the key, and `state.json` is refreshed every 25 personas.

## Instrument calibration (the part that makes the rest admissible)

The smoke run put ONE persona through the real front door and caught **two bugs in
my own instrument** before they could contaminate 250 results:

1. `$queryRaw` returns a SQLite Json column **already deserialised**, so my
   `JSON.parse` threw, every ingredient list came back empty, and the harness
   cheerfully reported *0 kcal, 0 leaks, 0/7 days in tolerance* — a clean bill of
   health resting on no evidence whatsoever. Fixed to accept both shapes.
2. My gluten wall "matched" `Turkey & Swiss Roll-Ups` on **"roll"** and
   `Matambre a la Pizza` on **"pizza"** (an Argentine stuffed flank steak).
   Neither is gluten. Fixed by splitting the surfaces: the **safety verdict is
   drawn only from resolved raw `Food` rows** — the physical ingredients — while
   dish-name hits are demoted to an advisory `nameFlags` list. Reporting those as
   P0 leaks would have manufactured a headline out of an English pun.

Post-fix, on persona p000 (M/41, 178 cm, 95 kg, trucker, 1.0 lb/wk, walls
gluten + shellfish, week horizon):

| check | result |
|---|---|
| mint → login → cookie | 200, `cutprotocol_session` held |
| profile round-trip | **all 13 sent fields persisted**, nothing silently dropped |
| generate | **200 in 81 ms**, 28 slots filled |
| pool | 889 raw → **361** after diet/allergy rules |
| target (app's promise) | 2,029 kcal · P 189–207 · F 56–66 · C 135–159 |
| **my kcal recompute vs the app's stored slot totals** | **drift 0.0 on all 7 days** |
| my days-in-tolerance | **5/7 — the same verdict the app claimed (5/7)** |
| ingredient-surface leaks | **0** |
| ledger delta | **0 rows, $0.000000** |

That 0.0 drift is the calibration that matters: my arithmetic reproduces the
app's own slot totals exactly, so from here on **any disagreement between us is a
finding about the app, not noise in the instrument.**

---
*Report only. No product code, config, schema, test or doc outside this home was
touched, and none will be.*
