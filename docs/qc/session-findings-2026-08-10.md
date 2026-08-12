# Session findings — 2026-08-10

Measured, not inferred. Every number here came from a command run this session.
Where something is a hypothesis it says so.

This file exists because the session that produced it cannot remember anything:
the guard blocks writes outside the repo, and agent memory lives outside the
repo. If it is not written here, the next session starts from zero.

---

## Landed

| Commit | What |
|---|---|
| `4ddb742` | `fix(trend)` — split the hero chart so weight and lean mass each get their own axis |
| `4b53d58` | `docs(battle-plan)` — BATTLE-PLAN v2 committed out of `stash@{0}` |

`SEQUENCE.md:458` also carries the owner's 2026-08-09 ruling: **the AI/brain layer
is UNPARKED and meant to ship.** Do not re-ask.

`stash@{0}` still exists and was deliberately not dropped.

---

## Stage 2 (Google sign-in) is COMPLETE and PROVEN

Not "configured" — proven. A live Google sign-in landed in the app, authenticated.

Non-secret values, for reference:

```
Supabase project ref   vehldnrnjpvanscepfhk
Project URL            https://vehldnrnjpvanscepfhk.supabase.co
Callback URL           https://vehldnrnjpvanscepfhk.supabase.co/auth/v1/callback
Google OAuth client    Cut Protocol Web
Client ID              531106479238-9mbdggpeps62mcdnm63hfah1s26189e9.apps.googleusercontent.com
JS origin registered   http://localhost:5173
Supabase Site URL      http://localhost:5173
Google publishing      Testing (External). Owner is exempt; real testers are not.
```

Two corrections to `BUILD_PLAN.md` Runbook Part A, both measured:

1. **`SUPABASE_SECRET_KEY` is never read by any code.** It appears only in
   `BUILD_PLAN.md` and `backend/.env.example`. The backend verifies tokens via
   the project's JWKS endpoint derived from `SUPABASE_URL` alone
   (`backend/src/lib/supabaseAuth.js:19,34`). It is three values, not four.
2. **Google client secrets can no longer be re-viewed.** Google shows the full
   secret exactly once, in the dialog immediately after client creation. The
   client detail page now says so and displays only `****` plus the last four.
   If it is lost, the fix is "Add secret" — a new one, not recovery.

---

> **CORRECTED 2026-08-11 by the CI-prediction audit — the claim below and the
> `4297210` commit message OVERCLAIM.** The missing seed line is real but is
> ONE of at least three independent reds, and the fix as committed makes CI
> fail EARLIER, not green: `seedRecipesFromRecomp.mjs` violates the
> `Food.fdcId @unique` constraint (schema.prisma:292, landed 2026-07-22) at
> its 15th food — the ported library has 193 duplicate-fdcId groups covering
> 611 of 943 rows ("Beef" and "Ground Beef" share 170602). P2002 → exit 1 →
> the Seed step dies before any test runs. Second independent red:
> `allergenMetadataCoverage.test.js:265-289` resolves the DB path against
> `backend/` instead of `backend/prisma/` — authored 2026-08-02, mid-streak,
> has never once run green on CI. Fix requires: dedupe/ignore fdcId on create
> in the recomp seed + the path fix, then CI reaches the tests (626 recipes
> ≥ 100 → horizonGeneration passes; floors 135/1712 discover identically).
> Residual unknown: qc:smoke has never graded a 626-recipe pool.
> Even fully green, CI verifies the committed 626-recipe corpus — the
> 14,151-food library and its allergen sweeps remain owner-machine-only
> permanently by design (ARM 3 prints "NOT RUN" on CI).

## Defect 1 — CI has failed every run since 2026-07-24. Root cause found.

`backend/scripts/seedRecipes.js` contains **24 recipes**. CI seeds with exactly
that (`.github/workflows/ci.yml`, the `Seed` step). But
`backend/tests/horizonGeneration.test.js:73` asserts:

```js
assert.ok(RAW.length >= 100, `expected the real recipe library, got ${RAW.length} recipes`)
```

24 < 100 → exit 1 → red, every push.

The real library is seeded by a script CI never runs: `npm run seed:recipes:recomp`
(`backend/scripts/seedRecipesFromRecomp.mjs`, which imports `RECIPES` from
`portedFromRecomp/recipeLibrary.mjs`, 1.69 MB).

**Fix — one line** in the workflow's Seed step:

```yaml
    npm run seed
    npm run seed:recipes
    npm run seed:recipes:recomp     # add this
```

NOT APPLIED. `.github/` is not on the incision manifest, so no session under the
current guard can write it. Owner's hand, or a manifest widening.
The two seed scripts have not been verified to run cleanly in sequence.

### The bigger consequence

`horizonGeneration.test.js:55-62` copies the real `dev.db` when it exists.
Locally it does, so the suite passes. In CI it does not, and cannot — `dev.db`
is gitignored because it is personal health data.

So **"135 files, 1712 tests, 0 failures" is only true on the owner's machine.**
Nothing has been independently verified since 2026-07-24. Worth knowing before
Railway, which also will not have that database.

---

## Defect 2 — `SUPABASE_URL` in `backend/.env` silently paywalls the desktop app

`backend/src/lib/entitlement.js:13-16`:

> DESKTOP INSTALLS ARE NEVER PAYWALLED. With `SUPABASE_URL` unset (every
> desktop/local install) `requirePremium` is a pass-through and `getEntitlement`
> answers premium — the paywall is a property of the hosted web product, not of
> the app itself.

Adding `SUPABASE_URL` for the web test flipped the local backend into hosted
mode. The owner, having no Subscription row, became a free user in his own app:
"Exact portions are Premium", and the plan would not load.

The Electron app reads the same `backend/.env`, so the desktop build is affected
too. One variable, two modes, one config file — they cannot both be right.

**Workaround:** comment out `SUPABASE_URL` in `backend/.env` for desktop use.
**Proper fix (Stage 3):** that variable belongs in Railway's environment, not in
a file the desktop app reads.

Premium was granted to the demo account on the **database copy only** via
`node backend/scripts/flipPremium.mjs --email <addr> --state premium`. The real
`backend/prisma/dev.db` was never opened this session — verified by sha before
and after: `4D2C1EFA3CB282392776EC21C0CFA14D5FFD09BC8532C3C1010E74BF9FF93B6E`.

---

## Defect 3 — a paywall reported as a server error (exact cause found)

Before premium was granted, a free user's Today screen showed:

> **Couldn't load this week's plan.** Switch tabs and back to retry; if it keeps
> failing, restart the app.

A gated feature presented as a fault. The new user is told the app is broken
when it is merely not paid for.

**The backend is not at fault.** `entitlement.js:57-64` does it properly:

```js
res.status(403).json({
  error: "This is a Premium feature — portion-solved meal plans with exact portions and grocery quantities.",
  code: "premium_required",
});
```

403 rather than 401 on purpose — the comment at line 54 notes a 401 would sign
the user out. A machine-readable `code` is supplied precisely so the UI can tell
"locked" from "broken".

**The helper exists too.** `frontend/src/lib/api.js:70` exports
`isPremiumRequired(e)`, and `entitlement.js:53` names it as the intended
consumer ("keyed on the code, never on the sentence, so the copy can change
without breaking the lock UI").

**It is used in exactly one component.** `MicronutrientsCard.jsx:250` handles it
correctly. `TodayTab.jsx` never imports it — its plan fetch collapses every
failure into `plan === "error"` and renders the generic `ErrorNote` at
`TodayTab.jsx:871`.

So the pattern was designed, built, and applied to a secondary card, but not to
the primary one — the single most-viewed surface in the product, and the first
thing a free user sees.

Fix: teach `TodayTab.jsx`'s plan-fetch catch to branch on `isPremiumRequired(e)`
and render the lock state instead of the error state. `MicronutrientsCard.jsx`
is the in-repo precedent to copy. Note `plan === "error"` is a state value, so
adding a third state touches component state — **owner approval needed under
the styling-only boundary.**

`backend/src/routes/plans.js:23` mounts `requirePremium` on the whole router, so
every `/api/plans/*` call is gated for a free user, not just one endpoint.

---

## Defect 4 — logout does nothing in web mode (UNPROVEN CAUSE)

Two clicks, eight seconds, no effect; the app stayed authenticated. The button
is wired correctly (`Sidebar.jsx:149`, `onClick={onLogout}`).

Leading hypothesis, from the code alone. `App.jsx:244-267`:

```js
const logout = async () => {
  try {
    await supabaseSignOut();   // every state-clearing line is BELOW this
    await api.logout();
  } catch (e) { ... }
  setProfile(null); ... setAuthStatus("out");
};
```

The comment above it says *"Whatever the server does, the local session state is
cleared."* That holds for a **rejection**. It does not hold for a **hang** — an
awaited promise that never settles is not caught, and nothing below ever runs.
`supabaseSignOut()` (`frontend/src/lib/supabase.js:57`) calls
`supabase.auth.signOut()`, which has no timeout.

Not confirmed — the browser disconnected before the console could be read.
Confirm by watching for a pending `/auth/v1/logout` request, then decide whether
a timeout race is wanted. **This is auth logic; it needs owner approval.**

---

## Corrections to claims made earlier in the same session

- **"New users skip the setup wizard" — WRONG.** The wizard fires when
  `GET /profile` returns null (`App.jsx:188-195`). The Google login matched an
  existing local account by email and linked it (`supabaseAuth.js:81-87`, path
  2 of 3), and that account already had a profile. A genuine stranger takes
  path 3 — fresh User, no profile — and does get the wizard. Verified
  independently earlier the same session with a seeded profile-less account.
- **"27 local branches" — WRONG.** 28 local; remote is 6 branches plus the
  `origin/HEAD` symref.
- **Do not trust a timestamp read out of a log.** One was taken for the current
  time and was roughly twelve hours out. The machine is Mountain Time.

---

## Guard behaviour worth knowing

- `guard-bash.js:54` matches a bare `-f` anywhere in the raw command string.
  PowerShell's **string-format operator** (`"{0}" -f $x`) trips it. It bit three
  separate agents this session. The patch in
  `docs/orchestration/GUARD-NARROWING-PROPOSAL.md` fixes a *different* rule and
  does not address this one.
- Writes outside the repo are blocked, including agent memory. Nothing survives
  a session unless it is written into the repo.
- `.github/` and `.claude/` are sealed. `frontend/vite.config.js` is not on the
  manifest either — only `frontend/src/` and `frontend/public/` are.

---

## Stage 3 — the Postgres blocker is ALREADY SOLVED

`CLAUDE.md`'s correction table warns that the "one-line provider swap" claim is
overstated, that 8 of 25 migrations carry SQLite `PRAGMA` statements, and that
"the migration history would have to be squashed and regenerated against
Postgres first. Budget that work; it is not one line."

That work has since been done. Measured today:

- **28** migration directories (`CLAUDE.md` says 25, `BUILD_PLAN.md` says 28).
- **9** of them contain an executable `PRAGMA` (`CLAUDE.md` says 8).
  CORRECTED 2026-08-11: this file first said 10 — a substring grep counted a
  migration whose only "PRAGMA" is a comment saying one must NOT appear there
  (`20260724203000_.../migration.sql:8,13`). **`BUILD_PLAN.md:28`'s 9-of-28 was
  right all along.** Measure with a parser, not a substring.
- None of that matters for the cloud, because the cloud path does not replay
  the SQLite migration history at all.

Committed in `022aa06` — *"saas(deploy): Postgres migration pipeline for the
cloud, SQLite untouched for desktop"*:

| Path | What it is |
|---|---|
| `backend/prisma/postgres/schema.prisma` | 48 KB, `provider = "postgresql"`, client output `./seed-client` so it never clobbers the SQLite client. GENERATED — do not hand-edit. |
| `backend/prisma/postgres/migrations/000000000000_init` | One squashed init migration. Contains no `PRAGMA`. |
| `backend/scripts/buildPostgresSchema.mjs` | Derives the Postgres schema from the canonical SQLite one. |
| `backend/tests/postgresSchemaSync.test.js` | Fails if the two schemas drift, so it cannot silently rot. |
| `backend/scripts/seedCloudLibrary.mjs` | Seeds the food/recipe library into the cloud DB. |
| `backend/scripts/flipPremiumCloud.mjs` | Cloud equivalent of `flipPremium.mjs`. |
| `railway.json`, `Dockerfile` | Already reference the Postgres path. |

Workflow, from `buildPostgresSchema.mjs`'s own header:

```
node scripts/buildPostgresSchema.mjs               regenerate the postgres copy
node scripts/buildPostgresSchema.mjs --patch-main  Docker image only: flip the main
                                                   schema's provider in place
npx prisma migrate diff --from-empty \
  --to-schema-datamodel prisma/postgres/schema.prisma --script
                                                   regenerate the init migration
```

SQLite stays the desktop truth; Postgres is generated from it. **What remains in
Stage 3 is deployment mechanics — create the Railway service, set environment
variables, get the code there, run the init migration, seed the library. Not
schema engineering.**

The one genuine blocker in Stage 3's path is still `BUILD_PLAN.md:138`, which
requires pushing to a private repo while every other live document forbids
pushing.

---

## Audit 2026-08-11 — findings that gate the 14-day trial

From the ten-agent read-only audit (full reports in the session transcript;
key items only here, each verified with file:line by the auditor):

1. **First stranger becomes admin on a fresh cloud DB.** `supabaseAuth.js:132`
   — `role: existingUsers === 0 ? "admin" : "user"`. Right for a single-user
   desktop install; on a freshly-seeded cloud Postgres the first Google
   sign-in owns the deployment (admin reaches food-library writes via
   FoodsTab). MUST fix before Railway.
2. **The 131 `untrusted-ingredients` recipes are fully in the solver pool.**
   The trust flag gates nothing on the plan path: `exclusionGate.js:218` has
   no trust predicate, `mealRouter.js:188-227` checks allergens/placeholders/
   macro fit but never `macroTrustIssue`, and `plans.js:25` doesn't even load
   ingredient rows so PlanTab cannot caveat. Only surface: a client-side amber
   marker in the Recipes tab at >=60% untrusted-calorie share. Worst case for
   a stranger: a systematically UNDER-counted cut (the wrong-record rows
   under-count fat/energy per `foodValidation.js:202-205`), which the adaptive
   loop then compounds by lowering the target in response to the phantom
   stall. Owner decision: exclude flagged recipes from the pool, or accept
   with eyes open for the trial.
3. **Placeholder gate has a fat-shaped hole.** `recipeGeneration.js:133-134`
   only treats protein/carb roles as load-bearing, so a zero-macro FAT
   placeholder (9 kcal/g — the densest thing there is) passes the unattended
   AI gate.
4. **Four more paywall-as-error sites, all `RecipesTab.jsx`** (241, 614, 628,
   654) — no PremiumGate on that tab at all; failures render the generic
   "use Report a bug" copy. The new simple UI repeats the pattern 4 more
   times (SimpleToday.jsx:120,156,171,188). The TodayTab fix (this session)
   is the template.
5. **`ScreenBoundary` is defined and mounted nowhere; Sentry absent** (0 hits
   across both package.json + src). During the trial, a stranger's white
   screen or 500 is invisible to the owner. Cheap, high-value pre-deploy.
6. **Calorie-bug reframe:** 4 copies not 2 (adds `benchmarkAdaptiveTdee.js:169`
   and TodayTab.jsx:825's sparkline); NEITHER golden set imports the buggy
   files, so the feared golden re-base likely does not occur; the test suite
   is blind to the bug (every test weighs in daily — rows == days). The fix
   needs sparse-weigh-in tests written alongside it, floors raised same
   commit.
7. **The boot data-audit is a log line only** — `server.js:250`; no production
   code reads its result. It is a report, not a gate.

## Railway deploy — the measured checklist (audit 2026-08-11)

**Headline: nothing deployable is on GitHub.** `origin/master` carries the
PRE-saas Dockerfile (no VITE_ args, no HOST, `migrate deploy` with no
--schema — it would replay the SQLite history against Postgres and die on the
first PRAGMA). `recipe-brain` has no upstream. Step 1 of any deploy is the
owner pushing the right branch; everything else is inert until then.

The local pipeline is coherent: `toPostgresSchema(main)` reproduces
`prisma/postgres/schema.prisma` byte-for-byte; 26 models = 26 CREATE TABLE in
the init migration.

Railway env vars, from code not docs — REQUIRED: `DATABASE_URL` (Supabase
**Session pooler** URI — transaction pooler cannot run migrations),
`SUPABASE_URL` (the master switch: unset = no bearer auth AND everyone
premium), `JWT_SECRET`, `NODE_ENV=production`, and — **as build args before
the first build, not after** — `VITE_SUPABASE_URL` +
`VITE_SUPABASE_PUBLISHABLE_KEY` (baked into the bundle; set late = password
login, no Google button, until a rebuild). LS vars optional (clean 503 until
set). `SUPABASE_SECRET_KEY` is read by NOTHING — do not bother.
**Must NOT set:** `BRAIN`, `CUT_PROTOCOL_DB_PATH` (arms the desktop SQLite
bootstrap; on Node 20 images it 500s every /api request via a bootReady
rejection), `HOST`, `PORT`, `SEED_*`.

Order: push → Railway new project from the pushed branch (NOT master) → env
vars → generate domain → APP_URL → owner terminal: `buildTemplateDb.mjs` then
`seedCloudLibrary.mjs --url <pooler url>` (no API keys needed) → Supabase
Site URL + Google JS origin get the prod URL → legal placeholders → phone
test.

Gaps found: no healthcheck path in railway.json (a crash-looping deploy
reads as live); `prisma.js:51-57` fires `PRAGMA journal_mode=WAL` on every
boot — harmless on Postgres but logs a scary warning; the post-seed
data-audit spike (~320 MB RSS) lands on the first cloud boot; terms/privacy
still carry `[SUPPORT EMAIL]` placeholders and terms.html:67 promises 7-day
grace vs the decided 14; `.dockerignore` misses dev.db.template (only
matters for CLI upload, not GitHub builds). DEPLOY.md is stale and actively
wrong — follow BUILD_PLAN Part C.

## Pricing — the decision memo (audit 2026-08-11)

What is actually rendered today (`pricing-section.jsx:17-30`): **$24.99/$125,
annual default, no USD suffix, no trial copy, "5 months free"** (which is
arithmetically wrong — $125 vs $299.88 is 7 months free / 58%). Both
BUILD_PLAN.md:29 and BATTLE-PLAN.md:151 claim a $14.99 placeholder is
rendered — stale, the conversion already happened. No trial fields exist in
the schema (trialUsed/trialEndsAt/firstPaidAt: zero grep hits) — the trial
is unbuilt regardless of ruling, and needs migrations (owner-only).

The ruling must name SIX things or it will not stick: monthly price · annual
price · trial length · toggle default (BUILD_PLAN says annual, V2-DELTA says
monthly, code says annual) · whether BUILD_PLAN's "locked" block is amended
in place · explicit USD on rendered figures.

Three coherent bundles:
1. **Honour the lock:** $24.99/$125 · 7-day trial · monthly default. All of
   V2-DELTA P1 is already written for it. Overrules the teardown.
2. **Teardown reprice:** $14.99/$119 · 14-day trial ("save 34% — four months
   free"). Cheapest to justify, most files to sweep (every price string +
   formally unlocking BUILD_PLAN's locked block).
3. **Keep price, take 14 days:** $24.99/$125 · 14-day trial · monthly
   default. Smallest edit surface. Notably: the 14-day trial ends on the
   same day as the mission's day-14 gate and the day adaptive.applied fires.
   7 days is asserted in V2-DELTA without a rationale; 14 is argued from
   the engine's behaviour in two independent documents.

Cost check: the "heaviest user" rule discriminates nothing — worst case is
the $5/user/month brain cap vs $13.74-$23.24 net, and the launch config has
no ANTHROPIC key so per-user burn is $0. The binding constraint is the
GLOBAL $15/month brain cap (config.js:28), a launch-config item, not a
pricing item.

Two errors live regardless of bundle: "5 months free" and terms.html:67's
7-day grace.

## Push safety (audit 2026-08-11): SAFE-WITH-CONDITIONS

`recipe-brain` → new private repo: 388 commits, backup/pre-scrub is NOT an
ancestor (verified, exit 1 — its 106 commits stay behind), the Phase 9
history scrub covers this lineage, scan:secrets clean, all seven sensitive
paths confirmed untracked, fleet personas verified synthetic
(qa-fleet-*@fleet.local), no owner email in tree, 252 MB pack.

Conditions: (1) the Windows account name sits in 4 tracked files —
FIND-SIMPLE-UI-PROMPT.txt (worst; REDACTED in-tree 2026-08-11, though the
original text remains in the 4297210 blob), ORCHESTRATION.md:134,
MIGRATION/DELETE-CANDIDATES.md:78, MIGRATION/CONTRACT.md:127 (rules files —
owner's call). Private-only risk; becomes real if the repo ever flips
public. (2) scan:secrets' "2531 scanned" counts enumerated files, not read
ones — MAX_BYTES silently skips 118 large tracked files (sampled by hand:
synthetic). (3) The pre-push hook fires on ANY remote incl. new ones
(PUSH_APPROVED, fail-closed, ignores remote name) — but hooks don't travel;
the new repo inherits no protection. (4) ~950 MB of QA dumps ship in the
deploy clone for zero runtime value.

## Open, needing the owner

1. **Pricing.** Three live numbers ($24.99/$125 locked in `BUILD_PLAN.md`;
   $14.99/$119 + 14-day trial recommended by the teardown), and two trial
   lengths — `V2-DELTA.md:198` already hard-codes customer-facing copy reading
   "7 days free, then $24.99 USD/month". Blocks V2-DELTA P1 and Runbook D–E.
2. **The CI one-line fix** (`.github/` is sealed to sessions).
3. **Pushing.** `BUILD_PLAN.md:138` (Railway) requires a push; every other live
   document forbids one. A real contradiction sitting in Stage 3's path.
4. **Twenty testers.** Zero exist. One unsent 2026-07-21 draft to one person,
   with the download link never filled in, and it promises *"nothing gets
   uploaded anywhere"* — untrue of the hosted build. Longest lead time of
   anything remaining; nothing has been started.
