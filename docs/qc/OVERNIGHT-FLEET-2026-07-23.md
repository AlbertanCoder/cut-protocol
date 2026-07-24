# Overnight Fleet — 2026-07-23

Ten agents against **The One Battle Plan**, Waves 0–7. Branch `qc/overnight-2026-07-23`,
all work committed and pushed. Shad asleep; no approvals requested.

**Final state: 80 test files, 926 tests, 0 failures. vite build clean. 0 npm vulnerabilities.**
Suite was 62 files / 667 tests at the start of the night.

---

## Read this first: three things that were worse than the audit said

**1. The migration runner was destroying user data, and it committed without error.**
Not theoretical. Replaying the pre-fix runner against a Prisma table-rebuild with a cascade
parent: **3 rows → 0, transaction committed, no error raised.** `PRAGMA foreign_keys=OFF` lived
*inside* the migration files, so it ran *inside* the transaction, where SQLite silently ignores
it. `defer_foreign_keys` — the thing that looked like partial awareness — defers the constraint
*check*, it does not stop FK *actions*. `DROP TABLE` with enforcement live does an implicit
`DELETE FROM`, and every `ON DELETE CASCADE` fires.

Your shipped migrations contain `DROP TABLE "User"` and `DROP TABLE "Recipe"`. `schema.prisma`
hangs **10 cascade relations** off them: MealLog, BrainConversation, LlmUsage, CartItem,
RecipeRating, and the whole training tree. Anyone upgrading across those migrations lost that
data silently — including the copy you were about to hand Amandeep.

**2. The backend was bound to every network interface, not loopback.**
`server.js` called `listen(PORT)` with no host, which binds `0.0.0.0` and `::`. Agent 6 proved it
by reaching the running app from the LAN at `192.168.1.67`. So the whole API was being served to
every device on your network — and until earlier that same night, that API had **no registration
gate and no login throttle**. Now `127.0.0.1` only, asserted by a test that requires the LAN
address to refuse.

**3. The fuzzy matcher scored a *perfect* 1.0 on the allergen swap.**
`similarity("almond butter", "Butter")` = `overlap / min(|a|,|b|)` = `1 / min(2,1)` = **1.0**. Not
a marginal pass over the 0.6 threshold — the maximum possible score. Measured against your real
14,122-row Food table, it silently renamed **21 of 58** probe queries into a different food, **5
across an allergen boundary**. `rice vinegar → Rice` was a 23× calorie error; `butter lettuce →
Butter` turned a leaf into 717 kcal of dairy fat.

---

## Wave 0 — Preserve & Unblock

| Step | Status |
|---|---|
| 0a. Push the branch | **Was already done.** `origin/qc/overnight-2026-07-23` already matched local HEAD at `c2015b8`. The plan measured against `origin/master`; the branch itself was pushed. Nothing was at risk. |
| 0b-1. Step cap ±125 kcal | **Done** (Agent 9) |
| 0b-2. Nullable `mayContain` column | **Done** (Agent 4), migration applied to the real DB |
| 0b-3. ±7%-by-week-6 precheck | Deferred to Wave 4 as designed — it is gated on the step cap, which now exists |
| 0c. Merge toward master | **Not done, deliberately.** Wave 1 is green, but see "what is NOT verified" below. |

### Unplanned, found and closed: public-repo data exposure
`backend/prisma/dev.db.snapshot-agentcontam-20260721-212858` (3.2 MB) was untracked **but not
ignored**. `.gitignore` covered `dev.db`, `dev.db.backup-*` and `*.db`; a `.db.snapshot-*` suffix
matches none of them. This repo is public. One `git add -A` publishes real health records. Same
hazard for two `*.bundle` files. Closed in `65303d3`.

---

## Reconciliation ledger — all 29 fleet findings

| # | ID | Sev | Status | Evidence |
|---|----|-----|--------|----------|
| 1 | onboarding-flow-1 | P0 | **CLOSED** | `/register` + `/status` + create-account UI; browser-verified on an empty install |
| 2 | tests-quality-1 | P0 | **CLOSED** | Was already fixed but **uncommitted** — that is why it still read as open. Hardened further (see below) |
| 3 | dietary-safety-1 | P0 | **CLOSED** | Verified; 2 further leaks found and fixed (chestnut plurals, lactose-free formula) |
| 4 | frontend-arch-1 | P0 | **CLOSED** | Allergy toggle reverts to server truth with an asymmetric safety rule |
| 5 | dietary-safety-2 | P0 | **CLOSED** | `fdcCategory` persisted + compound-token dictionary |
| 6 | tests-quality-2 | P0 | CLOSED (overnight, pre-fleet) | 14k sweep — extended further this session |
| 7 | food-data-1 | P0 | **CLOSED** | `similarity()` deleted; grep-test prevents its return |
| 8 | competitor-gap-1 | P0 | **CLOSED** | `electron-updater` + offline license gate + `docs/RELEASING.md` |
| 9 | schema-model-1 | P0 | **CLOSED** | Single-connection runner, FK window, `foreign_key_check`, txn bookkeeping |
| 10 | brain-stack-1 | P0 | **CLOSED** | One governed door; structural test prevents recurrence |
| 11 | resilience-errors-2 | P1 | **CLOSED** | Port probe + per-launch nonce handshake |
| 12 | solver-core-1 | P1 | **CLOSED** | Locks solved as constraints; route patched (was inert without it) |
| 13 | solver-core-3 | P1 | **CLOSED** | Was **still open** despite `a0d0d24` — see below |
| 14 | solver-core-2 | P1 | **CLOSED** | Fat/carb now first-class |
| 15 | adaptive-tdee-1 | P1 | **CLOSED** | Intake-recency gate |
| 16 | adaptive-tdee-2 | P1 | **CLOSED** | Resolver authoritative; wired into the planner path |
| 17 | onboarding-flow-4 | P1 | **CLOSED** | With a correction — it is not Boer (see below) |
| 18 | onboarding-flow-3 | P1 | **CLOSED** | Fabricated profile replaced with a self-clearing estimate banner |
| 19 | ux-screens-1 | P1 | **OPEN** | Wave 8, not attempted |
| 20 | competitor-gap-2 | P1 | **OPEN** | Wave 8, not attempted — the food diary |
| 21 | dietary-safety-4 | P1 | **CLOSED** | Required a 2-line client patch to stop being dormant |
| 22 | dietary-safety-5 | P1 | **CLOSED** | ~110-entry alias map |
| 23 | ux-screens-2 | P1 | **CLOSED** | Green-scarcity law enforced |
| 24 | frontend-arch-3 | P1 | **CLOSED** | Error taxonomy, timeouts, one 401 seam |
| 25 | tests-quality-3 | P1 | **CLOSED** | Was a dead letter; proven dead before fixing |
| 26 | resilience-errors-5 | P2 | **CLOSED** | Both halves |
| 27 | frontend-arch-4 | P2 | **CLOSED** | Six handlers + error-vs-empty everywhere |
| 28 | onboarding-flow-5 | P2 | **CLOSED** | Generate CTA |
| 29 | ux-screens-8 | P2 | **OPEN** | Wave 8, not attempted — CSV export |

**27 of 29 closed. The 2 open are both Wave 8 (food diary / export), deliberately not started.**

---

## Findings the audit got wrong, and what was actually true

**`tests-quality-3` was a dead letter, and it was proven dead before being fixed.**
`engine-baseline.golden.json` *does* carry a `bmr` array of 6 profiles — but `goldenBaseline.test.js`
walked a hand-written section list `["solver","grocery","trend","diary"]`. `"bmr"` was never in it.
Proof, measured not asserted: a byte-copy of the pre-fix test, run with +1 kcal injected into
Mifflin–St Jeor, **passed green, exit 0**. The number behind every user's `targetKcal` was locked by
a baseline no test read. Root cause fixed too — the section list now derives from
`Object.keys(golden)`, so a section can never again be committed-but-uncompared.

**`solver-core-3` was still open, despite `a0d0d24` claiming to fix it.**
That commit's carb-energy-fraction check is scale-invariant under *uniform* scaling — but
`scaleRecipe` solves **two independent factors**, so sides can double while protein halves. A dish
at `0.0664` carb-energy fraction at 1× ships at `0.1128`, over the `0.10` ceiling. Measured across
12 seeded keto weeks: **39 of 296 slots over the ceiling, 35.0 g mean daily carbs** on a plan
labelled keto. After the fix: 0 breaches, 28.0 g/day — restoring the number `a0d0d24`'s own commit
message claimed.

**`onboarding-flow-4` is closed, but it is not Boer and there is no `lbmSource` field.**
The fallback uses ACE body-fat midpoints (21% M / 28% F), not the Boer formula. Hand-checked on a
232 lb male with unknown BF: lean mass `183.28 lb` (232 × 0.79), protein 209–229 g, `bfAssumed:
true`. Protein is definitively **not** computed on total weight. For reference, Boer would have
implied 30.5% BF for that same profile.

**The biggest number in the whole night:** making fat and carb honest drops
`daysInTolerance` from **168/168 to 102/168** across 168 solved days on 3 real profiles. Kcal
offenders 0, protein offenders 0, **fat offenders 60, carb offenders 25.** Every one of those days
shipped green before. That drop is the finding, not a regression — the app was calling fat-starved
days compliant.

---

## Work done by the orchestrator (not by an agent)

- **`/login` had no brute-force brake.** Agent 5 correctly declined to add one (it would have
  broken the fuzz harness) and flagged it. Picked up and fixed — and the tests caught **two flaws
  in that fix**: (a) keying on `req.ip` is wrong here, because a loopback-only app sees
  `127.0.0.1` for everyone, making it one global bucket where ten wrong guesses at any account
  lock out *every* account; (b) `reset()` empties the whole map, so calling it on success would
  let any one login wipe an attacker's counter against another account. Now keyed `address|email`
  with a per-key `clear()`. The harness resets the counter between bodies so its coverage stays
  real instead of silently bouncing at 429.
- **Four agents' fixes were inert until wired.** `solver-core-1` needed the `plans.js` patch at
  both week and day granularity; `adaptive-tdee-2` needed `planContext.js`; `dietary-safety-4`
  needed `openFoodFactsClient` to actually *request* the allergen fields it was handling.
- **`npm test` could bill your Anthropic account.** `backend/.env` has `BRAIN=on` with a real key,
  and Prisma loads `.env` into `process.env`. A suite reaching the transport would make a real
  paid call **and pass while doing it**. `runTests.mjs` now forces `BRAIN=off` with empty keys for
  the whole run — at the single entrypoint, not per-file, because per-file means remembering it in
  every future test forever.
- **High-severity `fast-uri` vuln** (host confusion via backslash authority delimiter) arrived with
  `electron-updater` — on the exact code path that downloads and installs executables. Fixed;
  0 vulnerabilities now.
- **Migration applied to the real DB** after a backup: 14,122 foods and 6 users intact, all three
  columns present, `PRAGMA foreign_key_check` clean. Backup at
  `backend/prisma/dev.db.backup-premigration-*`.
- **Golden baseline regenerated and audited, not accepted.** Diff is 25 leaf paths, all in
  `solver`, all additive. Verified by grep that `bmr`, `rmr`, `matchPct`, `avgMatch`,
  `daysInTolerance`, `recipeId` and `grams` appear **zero** times in the diff — so the plan is
  bit-identical and Agent 9's BMR work was not masked by a last-writer-wins regeneration.

---

## What is NOT verified — read before merging to master

1. **CI has never run any of this.** `.github/workflows/ci.yml` triggers on `master` push/PR only,
   so nothing tonight has executed on GitHub. Everything is proven locally. Left the trigger alone
   deliberately — changing it mid-fleet would have surprised nine other agents.
2. **No browser or Electron run of the merged tree.** Agents verified their own slices live
   (registration walk, Electron port-conflict boot, setup-wizard banner), but nobody has driven the
   *combined* app. Ten agents' frontend changes have only been proven to build and lint together.
3. **The QC gauntlet was not re-run** (Wave 4). The 38.8% feasible-day coverage baseline is now
   stale — `daysInTolerance` moved a lot, and the keto guard costs ~1.5% more empty slots.
4. **Wave 8 was not started.** Food diary, CSV export, Living App stages C–G.
5. **`backend/.env` still has `BRAIN=on` with a real key.** Fine on your machine, but that file must
   not ship. `npm run dist:check` exists for this.

---

## Recommended next moves, in order

1. Re-run the QC gauntlet (Wave 4) to re-baseline coverage against the honest tolerance numbers.
2. Drive the merged app by hand once — the combined frontend has never been opened.
3. Then the **Amandeep gate**: `SHARE-WITH-AMANDEEP` (clean install → fresh-install check → secret
   scan → build → your explicit go).
4. Wave 8 (the food diary) is the largest remaining lift and the one users will feel most.

---

## Fleet assignments (for the record)

| # | Wave | Findings | Owned |
|---|---|---|---|
| 1 | 1 | tests-quality-1/-3 | `runTests.mjs`, `tests/golden/**`, CI |
| 2 | 1 | schema-model-1 | `desktopBootstrap.js` |
| 3 | 2 | food-data-1 | `ingredientResolver.js` |
| 4 | 2 | dietary-safety-2/-4/-5 | `schema.prisma`, `dietaryFilter.js`, `offImport.js` |
| 5 | 3 | onboarding-flow-1 | `routes/auth.js`, `LoginScreen.jsx` |
| 6 | 3 | competitor-gap-1, resilience-2, onboarding-3/-5 | `electron/**`, `server.js` |
| 7 | — | frontend-arch-1/-3/-4 | `api.js`, 8 components |
| 8 | 5 | solver-core-1/-2/-3, ux-screens-2 | `mealSolver.js`, `weeklyPlanner.js`, `PlanTab.jsx` |
| 9 | 6 | adaptive-tdee-1/-2, onboarding-4, step cap | `adaptiveTarget.js`, `expenditureEstimator.js` |
| 10 | 7 | brain-stack-1 | `brain/**`, `aiRecipeClient.js` |

Strict file ownership, no two agents in one file (CLAUDE.md standing rule 6). Cross-agent requests
went to `docs/qc/handoff/agentNN.md` — all ten files are committed and worth reading for the
follow-ups not taken tonight.
