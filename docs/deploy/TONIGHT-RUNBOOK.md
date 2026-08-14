# TONIGHT — Owner Runbook (Railway deploy)

Date: 2026-08-12 · Branch: `recipe-brain` · Deploy repo:
github.com/AlbertanCoder/cut-protocol-app (PRIVATE, default branch
`recipe-brain`, already pushed)

Your total hands-on time: ~5 minutes, 5 steps.
Everything else is the agent's job. You never edit a file
except ONE paste (step 3). No secrets appear in this document —
the variables live in `deploy-local/railway-variables.env`
(git-ignored, already assembled, only DATABASE_URL is a placeholder).

---

## 1. You (about 2 minutes — it shrank while you were at work)

1. **Railway login** — the Chrome tab is already sitting on the
   login modal. Click **Continue with GitHub** → **Authorize**
   (your GitHub session is live, so no password). If Railway asks
   you to pick a plan, choose **Hobby**. Payment method = your
   call — Railway won't deploy without one on file.

2. **Approve the push** — type **"go push"** to the agent. The
   deploy remote is 4 commits behind local (healthcheck, WAL
   guard, seeder fixes, legal email, this runbook); the agent
   writes the gate token on your word, pushes, re-arms the gate,
   and logs it — same recorded procedure as this morning.

**Already done for you today (no action):** Supabase DB password
reset + Session-pooler DATABASE_URL assembled and LIVE-VERIFIED
(real SQL executed through the pooler); the full variables pack at
`deploy-local/railway-variables.env` is complete — zero pastes
left; support email (armwrestlingalbertan@gmail.com) rendered into
terms/privacy and committed; CI patch found to be UNNECESSARY on
the deploy branch — your commit `4297210` already carries the
seed line there, so the staged patch in `docs/deploy/` is banked
for `master` only.

## 2. Then the agent does (no hands needed)

1. Create the Railway project from **cut-protocol-app**
   (branch `recipe-brain` — never master).
2. Paste the raw variables block from
   `deploy-local/railway-variables.env` into Railway's raw
   editor. The two `VITE_` vars must exist BEFORE the first
   build (Vite bakes them; set late = password login only, no
   Google button, until a rebuild). The five must-NOT-set vars
   (`BRAIN`, `CUT_PROTOCOL_DB_PATH`, `HOST`, `PORT`, `SEED_*`)
   stay unset.
3. First deploy. Watch the build log — if it dies on
   `libssl.so.3` at `prisma generate`, the known one-line fix is
   adding the `openssl` apt package to the runtime stage.
4. Generate the public domain, then set `APP_URL` to it.
5. Seed the cloud DB from the owner terminal:
   `buildTemplateDb.mjs`, then
   `seedCloudLibrary.mjs --url <pooler>` (no API keys needed).
6. Update Supabase **Site URL** + Google OAuth **JS origin**
   to the prod URL.
7. Fill the legal placeholders (support email from your step 5;
   grace period is 14 days per the pricing ruling).
8. Verify: `/api/health` green on the prod domain, then a full
   stranger signup flow end-to-end (fresh account → wizard →
   plan).
9. Hand you the link for the phone test.

---

## 3. Decision points — already ruled / still open

**Ruled (done, no action):**

1. **Pricing** — bundle 3: $24.99 / $125 USD stand, 14-day
   trial (unbuilt, no trial copy renders), monthly toggle
   default.
2. **Trust gate** — untrusted recipes excluded from the solver
   pool (browse untouched).
3. **First-stranger-admin fix** — done ahead of deploy prep.

**Still open (need YOU):**

4. **Payment method on Railway** — owner-only, in the Railway
   UI (your step 1 above).
5. **Google OAuth publishing** — the OAuth consent screen is
   still in Testing mode: YOU can sign in (you're exempt), but
   strangers cannot until test users are added or the app is
   published to production in Google Cloud Console. Not needed
   for tonight's deploy + your phone test; REQUIRED before any
   tester gets the link. The agent can attempt it in Chrome on
   your typed go-ahead.

---

## Notes carried from tonight's gate (context, not tasks)

- Tests GREEN at commit `7d336dd`: 139 files / 1729 tests / 0
  failures. Lint + build GREEN. Commits are local only —
  pushing to the deploy remote still needs the PUSH_APPROVED
  gate, and the fleet's gap-closures (healthcheck path, WAL
  guard, env-strip test fix) are NOT live on GitHub until that
  push happens. The agent will raise this before deploying if
  the remote is stale. *[Superseded same night: pushed 2026-08-12
  19:46 as `7332b6a..66dca00` — the gap-closures went live before
  the deploy attempts began.]*
- `railway.json` now carries `healthcheckPath: /api/health`
  (timeout 300, restart ON_FAILURE, 3 retries) — the audit's
  "no healthcheck" gap is closed.
- Known-red, ruled out of tonight: `qc:smoke` still exits 1
  against the seeded 626-recipe pool (144 P0s incl. 50 allergy
  leaks) — an owner-level data decision for another day; CI's
  final backend step stays red until then.
- Dockerfile reviewer recommends `node:20-slim` →
  `node:22-slim` in a future pass (engines wants >=22.13.0;
  Node 20 is EOL). Not a blocker for tonight's cloud path.
  *[Done that same night: `e01c958` flipped both stages to
  node:22-slim as part of the build fixes.]*
- Tester invite draft is ready at `docs/deploy/tester-invite.md`
  — do NOT send until its preflight blockers clear (Google
  OAuth is still in Testing mode; strangers can't sign in
  until added as test users or the app is published).

---

## Deploy-night result (2026-08-13 — rewritten after the cause was measured; supersedes the ~06:00 session-close version)

The ~06:00 version of this appendix called the healthcheck cause unknown and
queued a next-session plan (CLI install → target-port test → Diagnose → ssh
probe). The cause has since been MEASURED and fixed. The true story:

**Five deploys, and what killed each (measured):** builds `d49624b6` and
`87de8117` died in frontend `npm ci` (EUSAGE — the Windows-authored lockfile
never recorded tailwind-oxide's Linux optionals) → lock regen + node 20→22
(`e01c958`). Builds 3–4: same EUSAGE — builder npm 10 and authoring npm 11
disagree on bundled optionals → npm@11 in both Docker stages (`3631b59`) plus
the one lockfile entry npm's own writer refuses to emit, added by hand
(`8a50fae`). Deploy `ea2b53f3`: build green, container crash-looped — the
global npm-11 upgrade breaks runtime `npx` → call
`./node_modules/.bin/prisma` directly (`ea3a8a2`). Then the wall: healthcheck
dead at ~4:53, zero server stdout; `PORT=3001` pinned explicitly, no change.

**The wall, SOLVED:** the Railway CLI (now installed, authenticated, and
linked to the project) pulled the runtime logs the dashboard never showed.
They end at "No pending migrations to apply." — `prisma migrate deploy`
completes its work in ~1s against the session pooler, then HANGS ON PROCESS
EXIT (engine child never terminates over the pooled connection), so the `&&`
chain never advances and `node server.js` NEVER RAN across all five deploys.
Fixed in `4ea196c`: `timeout 120` wraps the migrate in both `railway.json`
startCommand and the Dockerfile CMD (exit 124 → proceed to the server; a
real migrate failure still aborts with its own code).

**Session-close hypotheses, resolved:** the domain/target-port theory is
TESTED AND KILLED as a healthcheck cause — the server never started, so no
networking config could have mattered. Generating the public domain is still
REQUIRED later for public access + `APP_URL` (step 2.4 above stands) — it
just isn't a healthcheck fix. The ssh probe and Diagnose steps were never
needed; CLI runtime logs settled it.

**Permanent wins:** Supabase Postgres schema is LIVE (init migration applied
through the session pooler — 26 tables); the Docker image builds
reproducibly; region ams→us-east; every defect above fixed for good.

Railway state: project passionate-inspiration, service cut-protocol-app,
US East, 7 variables (incl. PORT=3001), remote at `ea3a8a2` — the `4ea196c`
fix is LOCAL ONLY until the next gated push — no successful deploy yet,
nothing publicly exposed, ~cents of trial credit used. An accidental staged
service ("function-bun", from a stray console keystroke) was DISCARDED —
verify the canvas shows only cut-protocol-app. Push gate RE-ARMED at ~06:00
session close; the standing approval is CLOSED.
