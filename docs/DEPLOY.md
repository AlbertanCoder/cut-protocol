# Deploy — boring and repeatable

Canonical as of 2026-08-19. Supersedes the root `DEPLOY.md` (2026-07-10,
kept as a record — it predates the Postgres build mechanism and tells you to
hand-edit the schema; do not follow it) and consolidates
`docs/deploy/TONIGHT-RUNBOOK.md`'s measured lessons.

## The shape

One codebase, two modes, one switch:

| | Desktop (Electron) | Hosted (Railway) |
|---|---|---|
| Auth | JWT email/password, httpOnly cookie | Google via Supabase (PKCE) — the ONLY path; no password form renders |
| DB | SQLite (`backend/prisma/dev.db`) | Supabase Postgres (schema flipped at image build) |
| Paywall | never (`{premium: true, status: "local"}`) | LemonSqueezy entitlement at read time |
| Switch | `SUPABASE_URL` unset | `SUPABASE_URL` set |

## Hosted: how a deploy actually works

1. Railway builds `Dockerfile` (two-stage, node:22-slim). Build args
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are REQUIRED at
   build time — Vite bakes them; without them the deployed frontend boots in
   desktop mode (password login, no Google).
2. The runtime stage runs `buildPostgresSchema.mjs --patch-main` (SQLite →
   Postgres provider flip) + `prisma generate`, and copies `frontend/dist`.
3. `docker-entrypoint.sh` runs `prisma migrate deploy` against
   `prisma/postgres/schema.prisma` with three measured failure modes handled:
   a 120 s timeout treated as success (the Supabase session pooler hangs on
   process exit AFTER migrate completes), pool-exhaustion strings logged
   loudly and booted through (old+new container overlap deadlocks otherwise),
   anything else fatal. Then `node server.js`.
4. Health: `/api/health` (DB-independent) and `/api/ready`.

Railway service on record: project `passionate-inspiration`, service
`cut-protocol-app`, US East. Live URL on record:
`https://cut-protocol-app-production.up.railway.app` (serving ~5 QA accounts
as of 2026-08-14 — **re-check `/api/health` before citing it as up**).

### Railway variables (assembled in `deploy-local/railway-variables.env`, gitignored)

Set: `DATABASE_URL` (Supabase session pooler), `SUPABASE_URL`, `JWT_SECRET`,
`NODE_ENV=production`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Leave UNSET: `BRAIN`, `CUT_PROTOCOL_DB_PATH`, `HOST`, `SEED_*`
(the deploy-night postmortem records `PORT=3001` ended up set on the live
service; the app tolerates it, but the runbook's rule is leave it unset).

## What is code-done but OWNER-blocked (BUILD_PLAN.md stages 1–6)

1. **Google OAuth consent screen is still in Testing.** Since the hosted
   build renders no password form, a stranger with the link gets a Google
   error and a dead end. Publishing the consent screen (Google Cloud →
   OAuth consent → Publish) is the single hardest live blocker.
2. Supabase + Google dashboards (BUILD_PLAN.md Parts A–E walkthroughs) —
   deferred owner task since 2026-08-06.
3. LemonSqueezy store dashboard + webhook URL (needs the Railway URL).
4. Legal pages still carry DRAFT banners and `[DATE — set at go-live]`.
5. **No trial mechanism exists** (`trialUsed`/`trialEndsAt` are not in the
   schema) — every tester needs premium flipped by hand
   (`backend/scripts/flipPremiumCloud.mjs`) or day one is a paywall.
6. Which commit the live service runs is unverified since 2026-08-13 —
   verify before inviting anyone (tester-invite.md blocker 4).

## Desktop: the installer

`npm run dist` (root). `build.files` is an ALLOWLIST (the denylist era is
over — `scripts/distPrecheck.mjs` fails the build if it ever regresses);
`extraResources` ships only the depersonalized `dev.db.template`.
Known gap: `docs/DISCLAIMER.md` is not in the allowlist and never ships.

## CI

`.github/workflows/ci.yml`, master-only: security (secret scan, brain
purity, supply chain) · backend (Node 24, SQLite `ci.db`, migrate + 3 seeds,
test-entrypoint guard, `npm test`, `qc:smoke`) · frontend (lint + build).
Recorded red: `qc:smoke` on the seeded pool (2026-08-13, 144 P0s) — see
docs/BLOCKERS.md B9 for why that number is quarantined, not trusted.
The persona gates (tests/personas/) skip on CI until the workflow also
builds the rebuild QA DB (add the seed steps + `CUT_REBUILD_QA_DB`).

## Rebuild-directive artifacts (this branch)

The isolated QA database is never deployed and never committed:
`backend/prisma/rebuild-qa.db`, built by the five commands in
`tests/personas/harness.js` (SKIP_NOTE). The safety-event ledger
(`backend/data/safety-events.jsonl`) is per-machine private data,
gitignored, and must never be shipped or synced.
