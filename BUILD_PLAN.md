# BUILD_PLAN — Cut Protocol subscription layer

Running checklist for turning Cut Protocol into a deployed subscription product.
Owner: Shad. Working branch: `saas-launch` (off `ui-restyle`, created at Stage 1 go — NEVER pushed without owner's hand).

**Scope note:** This plan supersedes, on the `saas-launch` branch only, the restyle
pack's "backend untouchable / do not wire payments" scope lines in CLAUDE.md Part I.
The meal-engine / portion-solver logic (`backend/src/lib/` solver, planner, dietary
filter, engines) stays UNTOUCHABLE. This build is strictly: accounts, payments,
gating, deployment. DO-NOT-TOUCH.md still binds file-by-file.

## Locked business decisions (do not relitigate)

- $24.99/month · $125/year — annual framed as **"Save 58%" / "5 months free" (~$10.42/mo)**. USD default (confirm CAD once at product creation, Stage 3).
- FREE: calorie targets, workouts, browsable recipes (not portioned).
- PREMIUM: portion-solved, macro-exact meal plans — portions, cook amounts, grocery quantities.
- Premium preview: real component rendered, blurred, lock card overlaid (pricing toggle inside). Blur is presentation; **server-side gating is the real gate**.
- Failed payment → 7-day grace (Lemon Squeezy retries) → downgrade. Voluntary cancel → premium until period end. Refund/chargeback → revoke immediately.
- Phase 2 (schema room only, NOT built): one-time-ever win-back offer → `usedWinback` boolean on the subscription record.

## Codebase facts (mapped 2026-08-05)

- One repo = Cut Protocol = Recomp. React 19 + Vite 8 + Tailwind 4/shadcn frontend; **Express 5 + Prisma 6 (Node) backend** — the brief's "FastAPI" was a known doc error. Electron shell wraps the same app for desktop; web deploy doesn't use it.
- Auth today: httpOnly cookie `cutprotocol_session`, HS256 JWT pinned to password epoch (`backend/src/lib/auth.js`), bcrypt passwords, `requireAuth` sets `req.userId`. Every route file uses it. Frontend has ONE API seam (`frontend/src/lib/api.js`, relative `/api`, single 401 handler).
- Server serves built frontend same-origin (`backend/server.js:164`) → no CORS anywhere, including production.
- Webhook raw-body pattern already exists: path-scoped body parser mounted before global `express.json()` (`backend/server.js:66`).
- Deployment prep exists: `Dockerfile` (2-stage, frontend dist into one image), `railway.json`, `DEPLOY.md` Railway runbook incl. Postgres migration regen. `backend/.env.example` exists.
- SQLite→Postgres: `migration_lock.toml` pins sqlite; **9 of 28 migrations carry SQLite-only PRAGMA** → regenerate a fresh init migration against Postgres (procedure already in DEPLOY.md).
- Pricing UI head start: `frontend/src/components/pricing-section.jsx` — finished, unmounted, monthly/annual toggle. Placeholder $14.99/$119.99 "Save 33%" → must become $24.99/$125 "Save 58%". Its "Local-first: your data stays on your machine" bullet is untrue on web — reword for web.
- HOST binds loopback by default; `HOST=0.0.0.0` env is the sanctioned container path.

### Premium endpoint gate list (server-side, Stage 2)

| Route | Why |
|---|---|
| `/api/plans/*` — all 14 endpoints (generate, current, horizons, day-options, accept-day, slot lock/alternates/apply/swap, place-recipe, fill-today-from-cart, grocery-list ×3) | The portion-solved product |
| `POST /api/cart/grocery-list` | Shopping quantities (cart add/remove itself stays free) |
| `GET /api/micronutrients/today` | Reads the solved plan's per-food grams |
| `POST /api/recipes/generate-drafts` | AI generation — burns server-side Anthropic key |

Stays FREE: auth, profile (targets/TDEE), weighins/trend, training, foods (+UPC), recipes browse/import-URL/save/rate, diary (manual logging; log-planned is inert without a plan), export/import (constitution: data is never trapped), meta. Wellbeing is NEVER gated (safety law).

### Premium screens (blur+lock, Stage 2)

- PlanTab — entire screen
- TodayTab — the planned-meals region only (ring, targets, weigh-in, diary stay free)
- RecipesTab — cart→grocery/fill-today actions + AI generate
- Micronutrients card

## Stages

### Stage 0 — Recon & plan ✅ 2026-08-05
- [x] Confirm target repo (`Desktop/cut-protocol`) and base branch (`ui-restyle`)
- [x] Map frontend/backend/auth/deploy surface
- [x] BUILD_PLAN.md created
- [ ] Owner "go" for Stage 1

### Stage 1 — Accounts: Google sign-in (Supabase Auth) — CODE DONE, checkpoint pending
- [x] `saas-launch` branch created off `ui-restyle`
- [x] Backend: Supabase JWT verified per-request (jose, JWKS or legacy secret) through the existing `requireAuth` seam; `sub` mapped/linked to local User (design refined from the exchange-once idea — Supabase is the session authority, refresh handled by supabase-js)
- [x] Frontend: Google-only sign-in card (web mode = Supabase env vars present), bearer token on every api.js request, sign-out drops the Supabase session
- [x] Prisma migration created: `passwordHash` nullable, `supabaseUserId` unique (+ Subscription table, pulled forward from Stage 2)
- [x] `.env.example` updated both sides (SUPABASE_URL, SUPABASE_SECRET_KEY, optional SUPABASE_JWT_SECRET; VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
- [x] Stale dev processes stopped (2026-08-06); migration applied to dev.db; Prisma client regenerated; **full suite green: 1609 tests, 0 failures**
- [ ] **OWNER: Supabase project + Google OAuth dashboards** (walkthrough in chat, 2026-08-05) + fill both .env files
- [ ] CHECKPOINT (rest): Google sign-in E2E locally in the browser; signed-out curl gets 401

### Stage 2 — Free vs Premium gating — CODE DONE, checkpoint pending
- [x] `lib/entitlement.js`: entitlement derived from Subscription (active/on_trial; cancelled→endsAt; past_due→graceUntil); desktop installs never paywalled
- [x] `requirePremium` on: all `/api/plans/*`, `POST /api/cart/grocery-list`, `GET /api/micronutrients/today`, `POST /api/recipes/generate-drafts` — 403 `{code:"premium_required"}`
- [x] `scripts/flipPremium.mjs` — 6 states (premium/trial/cancelled/grace/lapsed/free), prints derived entitlement
- [x] `/api/auth/me` ships premium/premiumStatus; App holds tier state
- [x] PremiumGate: real component blurred+inert under lock card; full overlay on PlanTab (canonical PricingSection: $24.99/$125, "Save 58% — 5 months free ~$10.42/mo", annual default); compact gate on Today's plan card; quiet note on Wellbeing micros
- [x] CHECKPOINT server half PROVEN live (2026-08-06, in-process app + real HTTP on account saas-qa@local): no row 403 · active 200 · on_trial 200 · cancelled+5d 200 · lapsed 403 · grace 200 · grace-expired 403 · none 403 — all with `code:"premium_required"`
- [ ] CHECKPOINT UI half (needs Google sign-in working): `flipPremium --state free` → blur+lock overlays; `--state premium` → normal
- Note: QA account `saas-qa@local` (password saas-qa-pass-1) left in dev.db with a status-none subscription row, same convention as the other *.test@local accounts.

### Stage 2 — Free vs Premium gating
- [ ] Prisma: `Subscription` model (userId unique, lsCustomerId, lsSubscriptionId, status, plan, renewsAt, endsAt, graceUntil, `usedWinback Boolean @default(false)`)
- [ ] `requirePremium` middleware (entitlement = active | cancelled-until-period-end | past_due-within-grace; desktop/local mode always entitled)
- [ ] Apply to the gate list above; premium denials return a distinct status/body the frontend maps to the lock UI
- [ ] Frontend `PremiumGate`: renders the REAL component blurred + lock card ("Unlock with Premium" + benefits + pricing toggle)
- [ ] pricing-section.jsx → $24.99/mo, $125/yr, "Save 58%" badge, "5 months free (~$10.42/mo)" line; reword local-first bullet
- [ ] CHECKPOINT: free account = blur+lock on all premium screens AND raw API calls rejected server-side; entitled account = everything works

### Stage 3 — Lemon Squeezy (TEST MODE) — CODE DONE + UNIT-PROVEN, dashboard pending
- [x] Current docs verified 2026-08-06: `X-Signature` = HMAC-SHA256 hex over RAW body; events via `meta.event_name` + `meta.custom_data`; JSON:API checkout with `checkout_data.custom`
- [x] `POST /api/billing/checkout` → LS hosted checkout URL (user_id in custom data, email prefill, redirect `/?upgraded=1`); lock-card CTA wired end-to-end with busy/error states
- [x] `POST /api/webhooks/lemonsqueezy`: raw mount before JSON parser, signature-first (timing-safe), state machine for created/updated/payment success+failed+recovered/cancelled/resumed/expired/paused + order_refunded; 7-day grace from FIRST failure (repeats don't restart); refund revokes now; idempotent; every event logged
- [x] "You're in" return: activating banner polls /me until the webhook lands; honest slow-path note
- [x] Local reality check (item 5): CHOSE unit tests now + live-fire on the deployed URL in Stage 5 — no tunnel software/account to babysit, and the deterministic parts (HMAC gate, event effects, entitlement) are fully provable offline. LS's dashboard "Simulate events" tool covers spot-checks later.
- [x] CHECKPOINT (provable half): **1628 tests green** incl. 19 webhook tests driving the real route → real entitlement flips (403↔200)
- [ ] **OWNER: LS account + store + test mode + product with 2 variants + keys into backend/.env** (walkthrough in chat 2026-08-06). Currency: USD default stands unless owner says CAD BEFORE product creation.
- [ ] **OWNER→Stage 4: webhook is created in the LS dashboard only once the Railway URL exists** (signing secret gets generated then)
- [ ] CHECKPOINT (rest): "Unlock with Premium" opens LS test checkout showing $24.99 / $125 from inside the app

### Stage 4 — Deploy: Railway + Supabase Postgres — CODE DONE, deploy is owner clicking
- [x] Postgres pipeline: `prisma/postgres/schema.prisma` GENERATED from the canonical schema (`scripts/buildPostgresSchema.mjs`), offline-rendered init migration (26 tables, real Postgres DDL), own migration_lock; Docker flips the image-local provider + generates the client; `migrate deploy --schema prisma/postgres/schema.prisma`. Desktop SQLite untouched.
- [x] Drift guards: `tests/postgresSchemaSync.test.js` (stale copy, wrong dialect, missing models all fail CI)
- [x] Dockerfile: VITE_SUPABASE_* build args (Vite bakes at build time — without them prod boots in desktop mode), HOST=0.0.0.0, postgres CMD; railway.json matched
- [x] Library seeding: `scripts/seedCloudLibrary.mjs` (template SQLite → cloud Postgres, original ids, typed, batched, non-empty guard); `Subscription` added to the personal-table classification in buildTemplateDb + librarySync (their own drift test enforced the pair)
- [x] Legal: `/terms` + `/privacy` (frontend/public, clean URLs in server.js) — plain-language PIPEDA-aware DRAFTS with [BRACKETED] placeholders; medical disclaimer on both pages AND the sign-in card
- [x] Suite green after all of it: **1632 tests, 0 failures**
- [ ] OWNER: runbook Part C below (Railway + post-deploy URL updates + seed + legal placeholders)
- [ ] CHECKPOINT: open the production URL on the phone, sign in with Google, use the free app end to end

### Stage 5 — Full test-mode run on prod — WAITING on Stage 4 owner steps
Nothing to pre-build: the five scenarios (monthly sub, cancel-at-period-end, failed payment + shrunk grace, refund revoke, annual pass) run against the deployed URL with LS test cards. Claude runs/verifies these WITH the owner in a session; grace-shrink = `flipPremium`-style date surgery or LS dashboard simulate-events.

### Stage 6 — Go-live + penny test — WAITING on Stage 5
Owner-only dashboards (LS activation/KYC as Canadian sole prop, live keys into Railway, penny variant). No code gaps known.

---

## OWNER RUNBOOK — every dashboard step left, in order (each ~5–15 min)

### Part A — Supabase + Google (Stage 1's checkpoint)
Full click-by-click: chat 2026-08-06 ("Part 1–5, steps 1–21"). Compressed:
1. Supabase project `cut-protocol` (org exists; Data API off — decided). Settings→API Keys → Project URL + publishable key → `frontend/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`); URL + secret key → `backend/.env` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
2. Supabase → Authentication → Sign In/Providers → Google: copy Callback URL.
3. Google Cloud: project `Cut Protocol` → OAuth consent (External, no logo) → ADD YOURSELF AS TEST USER → Credentials → OAuth client (Web): JS origin `http://localhost:5173`, redirect = the Callback URL → paste ID+secret back into Supabase Google provider → Enable.
4. Supabase → Authentication → URL Configuration → Site URL `http://localhost:5173`.
5. Verify: `npm run dev` both halves → Google-only card → sign in → curl 401 signed out → `node scripts/flipPremium.mjs --email <you> --state free|premium` flips the overlays.

### Part B — Lemon Squeezy store, TEST MODE (Stage 3's checkpoint)
Full click-by-click: chat 2026-08-06 (Stage 3 end). Compressed:
1. Account + store `Cut Protocol` (country Canada, skip payouts). **Test Mode ON** (left sidebar toggle).
2. CURRENCY: USD default stands unless you decide CAD BEFORE creating the product.
3. Product `Cut Protocol Premium`, subscription, 2 variants: Monthly $24.99/mo, Annual $125/yr.
4. Into `backend/.env`: variant IDs → `LEMONSQUEEZY_VARIANT_MONTHLY` / `_ANNUAL`; Settings→API key (test) → `LEMONSQUEEZY_API_KEY`; Settings→Stores id → `LEMONSQUEEZY_STORE_ID`.
5. Verify: restart backend, free account → Unlock with Premium → LS test checkout shows $24.99/$125. (Webhook waits for Part C.)

### Part C — Railway deploy + wiring the production URL (Stage 4's checkpoint)
1. railway.com → sign in with GitHub → **New Project → Deploy from GitHub repo**… the repo's public master does NOT contain saas-launch (never pushed). EITHER push `saas-launch` to a PRIVATE repo (recommended: create `cut-protocol-app` private, `git push <new-remote> saas-launch`) and deploy that, OR use Railway's CLI upload. DECIDE WITH CLAUDE IN SESSION — pushing is your hand only (standing rule).
2. In the Railway service → Variables, set (values from your two .env files):
   `DATABASE_URL` = Supabase connection string (Supabase → Project Settings → Database → Connection string → URI, **Session pooler**; password = the one you saved) ·
   `JWT_SECRET` (generate fresh: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) ·
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY` ·
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (build args — same names) ·
   `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_MONTHLY`, `LEMONSQUEEZY_VARIANT_ANNUAL`, `LEMONSQUEEZY_WEBHOOK_SECRET` (generate: same crypto one-liner, 24 bytes fine) ·
   `APP_URL` = the Railway public URL once known (step 3) ·
   `ANTHROPIC_API_KEY` + `USDA_API_KEY` only if AI generation/UPC lookup should work on web.
   Do NOT set: `CUT_PROTOCOL_*`, `BRAIN`, `SEED_*`, `PORT`/`HOST` (Dockerfile handles those).
3. Settings → Networking → Generate Domain → that's your public HTTPS URL. Put it in `APP_URL` (redeploys).
4. Seed the library ONCE from your machine: `cd backend && node scripts/buildTemplateDb.mjs && node scripts/seedCloudLibrary.mjs --url "<the same DATABASE_URL>"`.
5. Update the three external configs to the prod URL:
   - Supabase → Auth → URL Configuration: Site URL = prod URL; add it to Redirect URLs (keep localhost too).
   - Google Cloud → Credentials → the OAuth client: add prod URL to Authorized JavaScript origins (redirect URI unchanged — it points at Supabase).
   - Lemon Squeezy (test mode) → Settings → Webhooks → + : URL = `<prod URL>/api/webhooks/lemonsqueezy`, Signing secret = the value you put in `LEMONSQUEEZY_WEBHOOK_SECRET`, select all subscription_* events + order_refunded.
6. Legal placeholders before anything public: [SUPPORT EMAIL], [DATE], [REGION] in `frontend/public/terms.html` + `privacy.html`; link `/terms` + `/privacy` prod URLs in the Google consent screen and LS store settings.
7. CHECKPOINT: production URL on your phone → Google sign-in → free app works end to end.

### Stage 5 — Full test-mode run on prod
- [ ] Fresh Google account: sign up → free tier verified (blur+lock, API rejections)
- [ ] Subscribe monthly (test card) → premium unlocks; repeat annual on second account
- [ ] Negative webhook test: bad/missing signature rejected, event NOT processed
- [ ] Failed-payment simulation → grace window honored → downgrade after
- [ ] Voluntary cancel → premium until period end → downgrade
- [ ] Refund via LS dashboard → immediate revoke
- [ ] CHECKPOINT: full matrix documented green in this file

### Stage 6 — Go-live + penny test
- [ ] Flip Lemon Squeezy to live mode; live product/variants at $24.99 / $125
- [ ] Live keys + webhook secret on Railway (test keys removed)
- [ ] Penny test: near-100%-off discount code, real-card self-purchase → premium unlocks → refund → revoke verified
- [ ] Remove/disable the penny discount code; final sweep: no secrets in repo, .env.example complete
- [ ] CHECKPOINT: real money moved and refunded; product is live

## Decisions still owed by the owner

- Currency USD vs CAD (Stage 3, product creation — asked once)
- Repo is PUBLIC on GitHub; a paid product's full source is self-hostable. Keep public, or flip private? (not blocking; `saas-launch` is never pushed regardless)
- Weigh-ins/Trend/diary/export defaulted FREE (premium = portion-solved only, per the tier definitions). Confirm at Stage 2.
- Brain/coach chat: relay-gated and off by default — out of scope for this build; if it ever ships on web it should be premium (server-side LLM cost).

## Known risks (tracked, not blocking)

- User deletion is currently impossible by schema design (documented at `schema.prisma:58`) — a paid product eventually needs account closure. Later work, noted here so it isn't lost.
- `LlmUsage.userId` cascade-on-delete would reset AI budget sums (schema comment) — same later-work bucket.
- Parallel Claude sessions are active in this repo some days (last commit today 19:39) — check `git log -1` freshness before branch/commit operations.
