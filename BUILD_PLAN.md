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

### Stage 3 — Lemon Squeezy (TEST MODE)
- [ ] Look up CURRENT LS docs (event names, signature header, payload shapes) — never from memory
- [ ] Store + product + monthly/annual variants in test mode (confirm USD vs CAD with owner here — once)
- [ ] Checkout from lock-card CTA (LS overlay/hosted checkout, prefilled email, custom data = userId)
- [ ] Webhook route: path-scoped `express.raw()` BEFORE global json (server.js:66 pattern) + HMAC verify against raw body → then process events
- [ ] Lifecycle mapping → Subscription row: created/updated → entitle; payment_failed → graceUntil = +7d; cancelled → keep until endsAt; refunded/chargeback → revoke now
- [ ] `.env.example`: LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_WEBHOOK_SECRET, LEMONSQUEEZY_STORE_ID, variant IDs
- [ ] CHECKPOINT: local test-mode purchase flips a free account to premium live; cancel + refund flows verified via LS test dashboard

### Stage 4 — Deploy: Railway + Supabase Postgres
- [ ] Supabase Postgres `DATABASE_URL`; schema provider → postgresql; regenerate init migration (DEPLOY.md procedure); verify `migrate deploy` clean
- [ ] Seed shared food/recipe library (14,122 foods / 889 recipes) into Postgres (adapt template-DB/seed scripts)
- [ ] Railway service from Dockerfile; env vars set (HOST=0.0.0.0, all secrets); public HTTPS URL
- [ ] Google OAuth redirect URIs + Supabase site URL + LS webhook URL updated to prod domain
- [ ] Desktop app unaffected (still SQLite/local — verify `npm test` in backend)
- [ ] CHECKPOINT: public URL serves the app; Google sign-in + test-mode checkout work in prod

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
