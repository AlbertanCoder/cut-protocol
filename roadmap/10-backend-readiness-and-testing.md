# 10 — Backend Production Readiness & Testing Strategy

Research-and-plan only. No application code changed. Sources reviewed: `AUDIT.md`,
`PABLO_REVIEW.md`, `DEPLOY.md`, `railway.json`, `Dockerfile`,
`backend/prisma/schema.prisma` + all 9 migration folders, `backend/server.js`,
`backend/src/routes/*.js`, `backend/src/lib/aiRecipeClient.js`,
`backend/src/lib/ingredientResolver.js`, `backend/src/lib/usdaClient.js`,
`backend/tests/*.test.js`, `backend/package.json`, `frontend/package.json`.

Context: this app is currently a single-user, dev-mode deployment (SQLite,
plaintext `.env`, one seeded login) that both prior reviews independently
audited and found in good architectural shape but with a live product-trust
bug (meal-plan calorie/protein delivery) and a real safety gap (allergy
filter present but unset). This document is about the *other* axis: what
breaks when this stops being "one person's app" and becomes a real
multi-user product on the public internet.

---

## Part 1 — Production Readiness

### 1.1 SQLite → Postgres migration

**Verifying the "portable schema" claim.** The schema file's own header comment
(`schema.prisma:1-2`) says it's designed for a one-line provider swap. This
is **half true**:

- **The Prisma *models* are genuinely portable.** Confirmed by reading the
  full schema: no native Postgres enums, no native array columns (every
  list-shaped field — `Profile.excludedFoods`, `Profile.cuisinePreferences`,
  `Recipe.steps`, `PlanSlot.ingredients`, `GroceryList.items` — is typed
  `Json`, specifically to sidestep the fact that SQLite has no array type
  Prisma can fall back to). `Json` maps cleanly to Postgres's native
  `jsonb` — this is a free upgrade (queryable, indexable) with zero schema
  changes required.
- **No raw SQL anywhere in application code.** Grepped `backend/src` for
  `$queryRaw`/`$executeRaw` — zero hits. All access goes through the Prisma
  Client query builder, which is provider-agnostic.
- **The migration *history* is NOT portable, and this is the part
  `DEPLOY.md` already gets right but is worth restating precisely.** Every
  `migration.sql` file under `backend/prisma/migrations/` that does an
  `ALTER TABLE` (6 of the 9 folders) contains SQLite's table-rebuild pattern:
  `PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF; ... PRAGMA
  foreign_keys=ON; PRAGMA defer_foreign_keys=OFF;` — this is how Prisma
  emulates `ALTER COLUMN` on SQLite, which has no such statement natively.
  These are 100% SQLite dialect and will fail outright against Postgres.
  There is no fixing them in place; the correct move (and the one
  `DEPLOY.md` already documents) is to delete `prisma/migrations/` entirely
  and regenerate a fresh migration history against a real Postgres
  instance once the provider line is switched.

**Verdict: the schema (data model) is portable as claimed. The migration
history is not, and never was going to be — that's normal for any
SQLite-dev → Postgres-prod project, not a defect in this one.** `DEPLOY.md`'s
existing runbook (steps 1–7) is directionally correct. What it's missing is
a data-preservation step and a verification step:

**Concrete runbook (supersedes/extends `DEPLOY.md` §1):**

1. Spin up a throwaway local Postgres (`docker run -p 5432:5432 -e
   POSTGRES_PASSWORD=dev postgres:16`) — don't do this against the real
   Railway Postgres addon until the dry run below passes.
2. **If there is real user data worth carrying over** (check: as of this
   audit there's exactly one seeded account with light weigh-in history —
   confirm current state before deciding this matters) — write a ~30-line
   Node script using Prisma Client to read every row from the SQLite DB
   (`User`, `Profile`, `Weighin`, `Food`, `Recipe`, `RecipeIngredient`,
   `Plan`, `PlanSlot`, `GroceryList`, `CartItem`) into JSON, then a second
   script that inserts that JSON into a freshly-migrated Postgres DB. At
   this row count (low hundreds at most) this is a lunch-break script, not
   a migration tool. Skip this step entirely if there's no data worth
   preserving yet — just re-seed via `npm run seed` + `npm run
   seed:recipes:recomp` on the new DB.
3. Change `schema.prisma`'s `provider` from `"sqlite"` to `"postgresql"`.
4. `rm -rf prisma/migrations && npx prisma migrate dev --name init` against
   the local throwaway Postgres — this generates a brand-new,
   Postgres-native migration history. Commit it. The old SQLite-dialect
   history can be deleted outright (it documents dev-phase schema evolution
   that no longer matters once there's a fresh `init` migration) — no need
   to preserve it for posterity.
5. Run `npm test` with `DATABASE_URL` pointed at the throwaway Postgres.
   One caveat found while reviewing the test suite: `recipeGeneration.test.js`
   already makes real Prisma calls against whatever `DATABASE_URL` is
   configured (`prisma.food.findMany()` in its `beforeEach`) — so the test
   suite is **not** currently DB-agnostic, and this is actually a decent
   forcing function: if anything in the app silently depended on
   SQLite-specific behavior (case-insensitive `LIKE`, different `NULL`
   sort ordering, etc.), this is where it would surface. Nothing in the
   schema/queries reviewed here suggests such a dependency exists, but this
   step is the actual verification, not an assumption.
6. Run `npx prisma migrate deploy` against the throwaway Postgres a second
   time from a clean checkout — this simulates exactly what Railway's
   `railway.json`-configured start command (`npx prisma migrate deploy &&
   node server.js`) does on every deploy.
7. Only after 3–6 pass clean: point Railway's real Postgres addon (created
   per `DEPLOY.md` §3), run the same runbook against it, run the seed
   script, log in, generate a plan end-to-end.

**One thing to watch, called out because the schema's own comments already
flag the same class of bug once:** `Profile.excludedFoods` and
`Profile.cuisinePreferences` deliberately have **no** `@default("[]")`
because — per the schema's own comment — Prisma+SQLite generated invalid
`DEFAULT []` SQL that silently corrupted rows with an empty string instead
of valid JSON. Postgres does not have this specific bug (it supports real
`jsonb` defaults correctly), but **do not "fix" this by adding
`@default("[]")` back in during the Postgres migration** — the existing
app-level default in `profile.js`'s `defaultProfile()` is correct and
provider-agnostic; leave it as the single source of truth for this default
rather than reintroducing a schema-level default now that the specific
bug that motivated removing it no longer applies. Consistency > cleverness
here.

---

### 1.2 Secrets management

**Current state:** `backend/.env` holds `JWT_SECRET`, `USDA_API_KEY`,
`ANTHROPIC_API_KEY`, `SEED_EMAIL`/`SEED_PASSWORD`, `DATABASE_URL`, `PORT` —
correctly gitignored, never committed (verified by both prior audits), but
sitting in plaintext on disk with a live Anthropic key.

**Right-sized recommendation: Railway's own environment variable management
is the correct answer here — do not reach for Vault or AWS Secrets
Manager.** Those tools solve problems this app doesn't have at this scale:
dynamic secret leasing, cross-cloud secret federation, fine-grained
per-service IAM policies, automated rotation pipelines. A small team
running one Express service on one platform gets the load-bearing
properties (encrypted at rest, not in source control, scoped per-service,
audit trail of who changed what) from Railway's built-in Variables tab for
free, with zero extra infrastructure to run, monitor, or pay for.

**Concrete steps:**

1. Generate a **fresh** `JWT_SECRET` for production — `DEPLOY.md` already
   says this correctly (`node -e "console.log(require('crypto')
   .randomBytes(32).toString('hex'))"`). Never reuse the dev value; a leaked
   dev secret should never be able to forge a production session token.
2. **Rotate both API keys (Anthropic, USDA) before going to production**,
   even though neither is confirmed compromised — this is a natural
   "clean start" point, costs nothing, and closes the loop on the
   unrelated exposed key `AUDIT.md` flagged on the Desktop (a good moment
   to also rotate *that* one, though it's outside this repo).
3. Set every secret via Railway's service **Variables** tab. Never put a
   real value in `railway.json` (it's committed to the repo) — confirmed
   clean today, keep it that way.
4. **Add a `backend/.env.example`** (currently missing) — not a secrets
   management tool, but the actual right-sized fix for "how does anyone
   else, including future-you, know what environment variables this
   service needs." List the 7 keys with placeholder/dummy values and a
   one-line comment each. This is a 5-minute file that pays for itself the
   first time someone redeploys or onboards.
5. Revisit this decision only if the team grows past "a handful of people
   with direct Railway dashboard access" or a compliance requirement
   (e.g. handling health data under a framework that mandates a specific
   secrets posture) shows up — neither is true today.

---

### 1.3 Cost / rate-limit exposure at scale

**Where the AI spend actually happens** (traced through the code, not
guessed):

| Call site | File:line | Cap today |
|---|---|---|
| `POST /api/plans/generate` | `routes/plans.js:97-99` | `aiFallback.maxCalls: 5` per request |
| `POST /:planId/slots/:slotId/swap` | `routes/plans.js:144-147` | `aiFallback.maxCalls: 1` per request |
| `POST /api/recipes/generate-drafts` | `routes/recipes.js:17-38` | **no cap at all** — every call unconditionally generates 3 drafts |

All three call `generateRecipeDrafts()` → `client.messages.create({model:
"claude-opus-4-8", ...})` in `aiRecipeClient.js:89-96`, with `output_config:
{format: {json_schema}}` and `thinking: {type: "adaptive"}`.

**Model choice.** `claude-opus-4-8` is the current flagship/most expensive
tier (\$5/\$25 per MTok in/out). This task — "generate 3 structured recipes
matching a macro target, from a JSON-schema-constrained prompt" — does not
need frontier-model reasoning. The `output_config.format` schema constraint
already guarantees structural validity regardless of model tier; what's
left for the model to get right is "does this read like a real, cookable
recipe with sane macros," a bar `claude-sonnet-5` ($3/$15, ~40% cheaper) or
even `claude-haiku-4-5` ($1/$5, ~80% cheaper) is well within reach of. This
is a one-line change in `aiRecipeClient.js:90` — but ship it behind a
side-by-side quality comparison first (generate a batch of drafts on both
models against the same prompts, sanity-check against the app's own
allergy/macro-fit checks) before flipping it in production, since "recipe
sounds appetizing and macros are realistic" is a soft quality bar worth
eyeballing once, not just trusting a pricing table.

**Cost model.** No token-usage telemetry exists yet (see §1.4 — this is
itself an argument for adding basic request logging that captures
`response.usage`), so the estimate below is built from the prompt/response
shape, not measured data — treat the dollar figures as order-of-magnitude,
and replace them with real numbers from `response.usage` after a few days
in production.

Assumptions: ~500 input tokens per call (short system prompt + macro
targets + constraints), ~1,200 output tokens per call (3 recipes × name/
description/steps/ingredients in JSON).

| Model | Cost/call | Worst case per `/plans/generate` (5 calls) |
|---|---|---|
| `claude-opus-4-8` (current) | ~$0.033 | ~$0.16 |
| `claude-sonnet-5` | ~$0.020 | ~$0.10 |
| `claude-haiku-4-5` | ~$0.007 | ~$0.03 |

Steady-state weekly cost, assuming ~2 AI-fallback calls/week/user (one plan
generation, partial pool coverage):

| Users | Opus 4.8 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|
| 1 | $0.07/wk | $0.04/wk | $0.01/wk |
| 10 | $0.70/wk | $0.40/wk | $0.10/wk |
| 100 | $7/wk | $4/wk | $1/wk |
| 1,000 | $70/wk | $40/wk | $10/wk |

**These steady-state numbers are not the real risk.** The real risk is that
**every one of these three endpoints has zero rate limiting** — nothing
stops a single authenticated user (via a buggy frontend retry loop, a
double-clicked button, or a deliberate script) from hitting
`/api/recipes/generate-drafts` in a tight loop. Each hit is a real,
uncapped Opus-4-8 call at ~\$0.01–0.03. A thousand rapid requests from one
account is $10–30 in minutes with the current setup, and nothing in the
code today would even notice, let alone stop it. At 1,000 real users this
stops being a hypothetical.

**Recommendations, in priority order:**

1. **Per-user rate limiting on all three AI-touching endpoints — do this
   first, regardless of anything else.** `express-rate-limit` (or
   equivalent) keyed by `req.userId` (available post-`requireAuth`, more
   correct than IP-based limiting since every caller here is
   authenticated). Suggested starting points: 10 plan-generations/hour/user,
   20 recipe-draft-generations/hour/user — generous enough that no real
   user brushes against it in normal use, tight enough that the worst-case
   spend per account is bounded and known. This is a few lines of
   middleware and closes the actual exposure (unbounded spend), independent
   of which model is used.
2. **Switch the model tier** (`claude-opus-4-8` → `claude-sonnet-5` in
   `aiRecipeClient.js:90`) after the quality check described above. 40%
   cost reduction on every call, no architecture change.
3. **Widen AI-fallback avoidance via the shared recipe pool.** The schema
   already shares `Recipe`/`Food` rows across all users by design (`schema.
   prisma:74-75`'s own comment: "Foods/recipes are a shared library, not
   per-user"), and `recipeGeneration.js`'s `persistRecipeImpl` already
   saves every AI-generated recipe back into that shared pool — so, in
   principle, generation cost should trend toward zero over time as pool
   coverage improves, *if* similar macro-target gaps across different users
   reuse an already-generated recipe instead of each triggering a fresh
   Opus/Sonnet call. Recommend: introduce a *separate*, more permissive
   "close enough to skip AI fallback" tolerance from the meal-plan-fit
   tolerance the solver uses — e.g. "if an existing pool recipe is within
   ±20% of this slot's kcal/protein target, prefer reusing it over spending
   an AI call, even if it wouldn't pass the solver's own stricter fit
   check for *that specific* slot." This is the single highest-leverage
   lever at real scale: it converts a recurring per-user-per-week cost
   into a roughly one-time cost per distinct macro-target *shape*, which
   is a much smaller number than the user count.
4. **Paid-tier gate — not needed yet, but design for it now.** At "small
   team, handful of real users" scale, a hard paywall on AI features is
   premature. But make the rate limits in (1) configurable via env vars
   (e.g. `RATE_LIMIT_PLAN_GENERATIONS_PER_DAY`) rather than hardcoded, so
   differentiating a free vs. paid tier later is a config change, not new
   plumbing.

**USDA API usage (`ingredientResolver.js`) — a related but distinct
scaling concern**, already flagged in `PABLO_REVIEW.md` §3.5 and worth
restating with the "at scale" framing this task asked for:

- `resolveIngredient()` (`ingredientResolver.js:34-41`) does
  `prisma.food.findMany()` — an **unfiltered full-table scan** of every
  `Food` row — then runs an in-JS token-overlap similarity check against
  every single one, **per ingredient, per AI-generated draft, before ever
  reaching the USDA fallback.** At today's 968 rows this is milliseconds.
  It will not stay milliseconds: every AI-generated recipe across every
  user adds new `Food` rows (no dedup beyond the fuzzy match itself), so
  the table — and the cost of this scan — grows roughly with total AI
  recipe generations across all users, unbounded.
- Because this full-scan-then-fuzzy-match happens *before* falling back to
  a real USDA API call, the live USDA request volume is somewhat
  self-limiting (only genuinely novel ingredient names reach it) — so the
  primary near-term scaling cliff is the **database read pattern**, not
  USDA's own published rate limit (1,000 requests/hour/key on the standard
  tier). That said, at real multi-hundred-user scale with steady AI recipe
  generation, that ceiling becomes reachable too, and there's currently no
  caching layer beyond "resolved USDA hits get persisted as `Food` rows
  with `source: usda`" (which does help, since a repeat ingredient name
  hits the DB-scan match before ever calling USDA again).
- **Recommendation:** not urgent for the immediate next milestone (968 rows
  is genuinely fine today), but flag it as a known cliff and fix it
  opportunistically — replace the full `findMany()` + in-JS similarity
  scan with a targeted pre-filter (Postgres full-text search via
  `to_tsvector`/`to_tsquery` once the Postgres migration lands, or even a
  cheap Prisma `contains` pre-filter to shrink the candidate set before
  the JS pass). This is exactly the shape of thing that's "fine at 968
  rows, a real latency and cost problem at 50k rows" — worth doing before
  the Food table crosses roughly 5–10k rows, not before.

---

### 1.4 Logging, monitoring, error tracking

**Current state, precisely:** one `console.log` at server startup
(`server.js:35`). No error-handling middleware — only 2 of 7 route files
(`plans.js`, `recipes.js`) wrap their Prisma calls in try/catch (confirmed
by both prior reviews and by reading every route file). No request
logging. No error-tracking service. Nothing.

**Right-sized recommendation** — this section is explicitly about *not*
reaching for enterprise APM (no Datadog, no New Relic, no ELK stack) at
this scale, and instead picking the smallest set of tools that actually
answers "why did this user's plan fail to generate":

1. **Centralized Express error-handling middleware — do this first,
   independent of everything else.** A single `app.use((err, req, res,
   next) => {...})` registered last in `server.js`, catching anything not
   already handled by a route's own try/catch, logging it with request
   context (method, path, `userId` if authenticated, timestamp), and
   returning one consistent JSON error shape instead of a leaked raw stack
   trace or Express's generic framework 500. This is a small, mechanical
   fix that directly closes the gap both `AUDIT.md` and `PABLO_REVIEW.md`
   independently flagged (5 of 7 route files have zero error handling
   today).
2. **Structured request logging — `pino`.** Fast, minimal, emits JSON
   lines that Railway's log viewer can search/filter (unlike unstructured
   `console.log` text). Log per-request: method, path, status code,
   duration, `userId`, and on error the message + stack. `morgan` is a
   lighter-weight alternative if `pino`'s structured-JSON habit feels like
   more setup than wanted right now, but `pino` is the better investment
   given Railway's log tooling rewards structured logs.
3. **Error tracking — Sentry, free tier.** This is the concrete answer to
   "what would actually help debug a real user's 'my plan didn't
   generate' report" — today the honest answer is "nothing; you'd have to
   reproduce it locally with their exact profile state." Sentry's free
   tier (5,000 events/month) is more than sufficient at this scale and
   needs zero infrastructure to run. Wire it into the Express error
   middleware from (1) for backend errors, and add Sentry's React SDK on
   the frontend so client-side crashes (e.g. the grocery-list response
   shape mismatch `plans.js:186-189`'s own comment flags as unverified
   against a real browser session) are also visible, with the specific
   user and request context attached — not just "someone hit an error
   somewhere."
4. **A health-check endpoint** — `GET /api/health` (or `/healthz`)
   checking DB connectivity, returning 200/503. Railway's `railway.json`
   already configures `restartPolicyType: "ON_FAILURE"` — a real health
   check gives that policy something meaningful to key off of, and it's
   the first thing worth having when a deploy silently fails to come up
   cleanly.
5. **Explicitly skip for now:** full APM platforms, log aggregation
   stacks, synthetic/uptime monitoring services. All genuine overkill for
   a small team without a paid on-call rotation. Revisit if/when there's
   an actual on-call responsibility to support.

---

### 1.5 Backup / disaster recovery

**What's at risk:** `User`, `Profile` (sex, age, height, weight, body-fat%
— real personal health data even at small scale), `Weighin` (a user's
tracked weight history over time — the kind of data a real user would be
genuinely upset to lose, since it's literally their progress record),
`Plan`/`PlanSlot`, `CartItem`.

**Minimally responsible baseline for Railway/Postgres:**

1. **Confirm what Railway's managed Postgres addon actually includes at
   the current plan tier** — automatic backups are not universally
   included on every Railway plan/tier; check the current plan's specifics
   before assuming point-in-time recovery exists. Don't skip this
   verification step — it's the difference between "there's already a
   safety net" and "there is none."
2. **If it doesn't (or as a belt-and-suspenders layer regardless): a
   scheduled `pg_dump` to external object storage.** Concretely: a small
   script (`railway run pg_dump $DATABASE_URL | gzip >
   backup-$(date +%F).sql.gz`) run on a schedule and uploaded to cheap
   off-Railway object storage (Cloudflare R2, Backblaze B2, or S3 — any of
   these are pennies/month at this data volume). Daily cadence is
   reasonable given the data-change velocity here (at most one weigh-in
   per user per day; plan regeneration is infrequent).
3. **Scheduling mechanism:** since Part 2 of this document is already
   setting up GitHub Actions as the CI platform, a scheduled GitHub Action
   (`on: schedule`, cron) is a reasonable, zero-additional-infrastructure
   place to run the backup script daily, rather than standing up a
   separate always-on Railway service just for this.
4. **Retention:** a simple rolling window (e.g. 30 days) is sufficient at
   this scale — no need for tiered daily/weekly/monthly retention policies
   yet.
5. **Test the restore path at least once before relying on it.** An
   untested backup is not a backup — this is the single most-skipped step
   in "minimally responsible" backup setups and the one most worth calling
   out explicitly.
6. **Explicitly not needed yet:** multi-region replication, a dedicated
   managed-backup vendor, point-in-time recovery beyond what a daily dump
   provides. All of these solve problems (near-zero RPO, geographic
   disaster tolerance) this app doesn't have at its current scale and risk
   profile.

---

## Part 2 — Testing / QA Strategy

### 2.1 Statistical / property-based tests against the real recipe pool

**The root cause, precisely, per both reviews' convergent findings:**
`backend/tests/weeklyPlanner.test.js` has three tests today (confirmed by
reading the file). All three build recipe pools from `flexibleRecipe()` /
`fixedOvershootRecipe()` helpers — small, hand-picked fixtures explicitly
engineered to have known, controllable fit characteristics. **None of the
three tests load or exercise the real 628-recipe production pool, and only
one metric (`kcal`) is ever asserted on — `protein` is never checked
anywhere in this file.** This is exactly the blind spot that let the live
regression ship green: the fix commit (`3a82335`) added a reject/retry
gate that checks `kcalOffPct` only (confirmed at `weeklyPlanner.js:192` per
`AUDIT.md`'s own line reference), shipped a new test proving calories now
land within tolerance against these same synthetic fixtures — and the real
pool's protein delivery was still 10–32% under target on 6 of 7 days
(`PABLO_REVIEW.md` §2.6), invisible to all 52 "passing" tests, because
nothing in the suite ever generates against the real pool or checks
protein.

**Design for a test that would have caught it — three changes, not one:**

**1. Real recipe pool as fixture data, not synthetic recipes.**

Two viable approaches, recommended together (fast path + slow path):

- **Fast path (every PR):** export a JSON snapshot of the real
  `Recipe`+`RecipeIngredient`+`Food` rows via a small one-off script
  against the dev database, check it into `backend/tests/fixtures/`, and
  load it directly in the test — no live DB connection needed, keeps the
  test hermetic and fast. Regenerate the snapshot periodically (e.g. a
  short manual step whenever the recipe library changes meaningfully) — it
  doesn't need to be perfectly current to be effective; it needs to be
  *representative* of the pool's real kcal/protein-density distribution
  and the dessert-tagged-as-meal / zero-protein-role-ingredient issues
  `PABLO_REVIEW.md` §2.7 documents.
- **Slow path (nightly/pre-release, not blocking every PR):** an
  integration-style test that actually seeds a real test database via the
  existing `scripts/seedRecipesFromRecomp.mjs` (already present per
  `package.json`) and runs against it — slower, but exercises exactly what
  runs in production, and catches drift between the checked-in JSON
  snapshot and the live seed data over time.

**2. Assert on protein, not just calories — every "did the plan hit its
target" check must cover both.**

This directly implements `PABLO_REVIEW.md` §4 recommendation #3 ("Add a
protein-tolerance check to `resolveSlot()`'s accept/reject gate, mirroring
the calorie one that just shipped... Add a test asserting daily protein
lands within some tolerance of target against a realistic (not toy)
fixture pool — this closes the exact gap that let the live shortfall
through undetected"). Sketch:

```js
test("generateWeekPlan: real recipe pool delivers both kcal AND protein within tolerance, across many generated weeks", async () => {
  const pool = loadRealRecipePoolFixture(); // checked-in snapshot, real 628-recipe shape
  const dailyTarget = { kcal: 2000, proteinLo: 201, proteinHi: 220 }; // real fixture-user targets
  const deviations = [];

  for (let seed = 0; seed < 20; seed++) {
    const plan = await generateWeekPlan(dailyTarget, mealConfig, pool, { rng: seededRng(seed) });
    for (const day of groupByDay(plan)) {
      deviations.push({
        kcalPct: pctOff(sum(day, "kcal"), dailyTarget.kcal),
        proteinPct: pctOff(sum(day, "protein"), midpoint(dailyTarget.proteinLo, dailyTarget.proteinHi)),
      });
    }
  }

  assert.ok(Math.max(...deviations.map((d) => d.kcalPct)) < 0.15, "worst-case daily kcal deviation exceeds 15%");
  assert.ok(Math.max(...deviations.map((d) => d.proteinPct)) < 0.15, "worst-case daily PROTEIN deviation exceeds 15% — the assertion that was missing");
});
```

**3. Statistical framing — many runs, not one sample.**

A single generation against the real pool can get lucky or unlucky
depending on which recipes the weighted-random `pickRecipe()` happens to
select. `generateWeekPlan`'s existing `rng` dependency-injection seam
(already used by the current tests, e.g. `{ rng: () => 0.5 }`) exists for
exactly this purpose — run 10–30 generations with different seeds and
assert on the **worst-case** (or 95th-percentile) deviation across all of
them, not one run's number. This is specifically what would have surfaced
`PABLO_REVIEW.md`'s finding (6 of 7 days protein-short) — a single
convenient run might not show it, a 20-run statistical sweep reliably
would.

**Bonus, lower-priority: a recipe-pool composition sanity check.** Addresses
`PABLO_REVIEW.md` §2.7 / §4 item 4 (dessert recipes tagged `slotType:
"meal"` with zero protein-role ingredients, eligible to be served as an
ordinary dinner). Doesn't fix the curation problem, but a lightweight test
asserting some bound — e.g. "no more than X% of `slotType:meal` recipes
have zero ingredients tagged `role: protein`," or a keyword flag for
dessert-shaped names (`cake|pie|pudding|cookie|tart|flan`) tagged `meal` —
gives an early warning in CI if pool composition regresses further as more
recipes get added (including AI-generated ones, per §1.3 above).

**Where this runs in CI:** the real-pool statistical test (20 in-memory JS
generations against ~628 recipes) is slower than today's 3 tiny-fixture
tests but should still comfortably run in well under a second in absolute
terms — this belongs in the **every-PR, blocking** test run alongside the
rest of `npm test`, not deferred to nightly, precisely because this is the
exact class of regression (fix looks complete against a synthetic fixture,
real-pool behavior still broken) that needs to be caught *before* merge.
Reserve a separate, non-blocking nightly job for anything genuinely slow or
that would touch live external services (the real USDA API, the real
Anthropic API) — see §2.3.

---

### 2.2 Frontend testing — right-sized starting point

**Confirmed:** zero test infrastructure in `frontend/package.json`
devDependencies — no `vitest`, no `@testing-library/*`, no `jest`. `lint`
(`oxlint`) is the only quality gate today.

**Recommendation: Vitest + `@testing-library/react`.** Vitest specifically
because the app already runs on Vite 8 — zero extra bundler config, native
integration, Jest-compatible API so there's no new mental model to learn.

**Priority order — highest value first, and explicitly not "add 100%
coverage":**

1. **Pure calculation/formatting utilities in `frontend/src/lib/`** —
   `math.js`, `units.js`, `dates.js`, `householdUnits.js`. These are the
   cheapest, highest-signal tests available: no rendering, no mocking,
   deterministic input → output. They're also exactly the class of code
   where a silent unit-conversion or rounding bug (lb↔kg, imperial↔metric,
   a week-boundary date calculation since `Plan.startDate` keys off
   "Monday of the week") would be a real, easy-to-miss-by-eye correctness
   bug — squarely in scope for a "cut phase coaching app" whose own project
   constitution states "wrong math = product death" as its first
   non-negotiable rule. Start here, one test file per lib module, covering
   the documented edge cases (both directions of every unit conversion,
   rounding boundaries, date-week-boundary logic).
2. **`api.js`** — not pure, but a thin fetch wrapper. Worth a handful of
   tests verifying it constructs the right request (method, URL, body
   shape) for each function, rather than mocking a full HTTP round-trip —
   this catches the "someone renamed a route and forgot to update the
   client" class of bug cheaply.
3. **A small number of critical-path component tests, in this order of
   value:**
   - `TodayTab.jsx`'s macro-summary rendering — the exact `summary.
     macros.kcal` (target) vs. `planned.kcal` (delivered) comparison
     `AUDIT.md` traced as the literal UI surface showing the live
     overshoot bug (§2 of that report). A test asserting the component
     renders the correct on-target/over-target visual state given
     target-vs-delivered props would have caught the *visible*
     manifestation of the solver bug independently of, and before, the
     backend fix.
   - `EngineTab.jsx`'s target quick-set buttons (confirmed `WIRED`) versus
     the cut/bulk tier table (confirmed `DEAD` — display-only, no click
     handler, per both audits' §5/§5.5 findings). A regression test here
     both protects against the dead-tier-table bug recurring and would
     have been the natural place to catch it in the first place.
   - Skip exhaustive snapshot testing and testing every component — low
     value for a team this size, and snapshot tests specifically tend to
     be low-signal (they fail on any visual change, not just regressions)
     and get rubber-stamp-updated rather than genuinely reviewed.
4. **Explicitly not recommended right now: E2E tests (Playwright/
   Cypress).** Valuable eventually, but lower ROI than the two items above
   at this size — the manual audit process this project already runs
   (`AUDIT.md`, `PABLO_REVIEW.md`-style passes) is reasonably filling that
   role for a pre-scale app. Revisit once the unit-level suite above is
   running reliably in CI and there's a specific UI-regression pain point
   motivating it.

---

### 2.3 CI pipeline (GitHub Actions)

**Design goals:** run backend tests + lint on every PR today; add frontend
tests to the same gate once §2.2 lands; keep the blocking path fast
(target well under 2 minutes) so it doesn't become something people work
around; keep anything that would hit a real external service (Anthropic,
USDA) out of the blocking path entirely.

**One fact from reading the actual test suite that shapes this design:**
`backend/tests/recipeGeneration.test.js` already makes real `prisma.food.
findMany()` calls against whatever `DATABASE_URL` is configured (confirmed
at lines 17 and 51) — so **the backend test suite is not currently
DB-free**, and CI needs a real database available even for the tests that
exist *today*, not just for the new real-pool statistical test proposed in
§2.1. This also means: once the Postgres migration in §1.1 lands, CI should
run against a real `postgres:16` service container rather than SQLite —
testing against a different database engine than production defeats the
purpose of this exact audit chain (a fix that passes against one data
shape and silently fails against the real one).

**Concrete sketch, written to `roadmap/examples/backend-and-frontend-ci.yml`**
(not placed in `.github/workflows/` yet, since `DEPLOY.md`'s own step 2
notes the repo isn't confirmed pushed to GitHub yet — "push it to GitHub
first if it isn't already"). Structure:

- Trigger: `pull_request` to `main`, plus `push` to `main`.
- **`backend` job:** checkout → Node 20 (matches `Dockerfile`'s
  `node:20-slim`) → spin up a `postgres:16` service container → `npm ci`
  in `backend/` → `npx prisma migrate deploy` against the service
  container → `npm test`. No secrets required for this job as the code is
  currently structured — the AI-recipe-generation code paths already use
  dependency-injection seams (`generateDraftsImpl`, `resolveIngredientImpl`
  per `PABLO_REVIEW.md` §3.1) that the *existing* recipe-generation tests
  lean on to avoid live API calls; **confirm the new real-pool statistical
  test in §2.1 follows the same discipline** (constructs its pool from a
  fixture, never calls `generateWeekPlan`'s AI-fallback path with
  `aiFallback.enabled: true`) before wiring it into this job, so the
  blocking CI path never depends on live Anthropic/USDA credentials.
- **`frontend` job:** checkout → Node 20 → `npm ci` in `frontend/` →
  `npm run lint` → `npm run build` (catches build breakage, which is a
  real and cheap thing to catch here) → once Vitest is added per §2.2,
  `npm run test`.
- Both jobs run in parallel — no dependency between them, keeps total wall
  time down.
- A separate, **non-blocking, scheduled** (`on: schedule`, e.g. nightly)
  job is the right home for anything that should exercise real external
  services or the slower DB-seeded integration variant of the real-pool
  test described in §2.1's "slow path" — failures here should notify, not
  block merges, since they're testing infrastructure/data drift rather
  than the code change in a given PR.

See `roadmap/examples/backend-and-frontend-ci.yml` for the runnable sketch.

---

## Summary — what to do first

Both halves of this document converge on the same shape of answer: **the
architecture is sound; the gaps are all "things nobody needed until
multi-user"** — no rate limits, no error visibility, no protein assertion,
no frontend tests, no CI. None of these are hard fixes; all of them are
overdue precisely because the app has only ever had one real user so far.
