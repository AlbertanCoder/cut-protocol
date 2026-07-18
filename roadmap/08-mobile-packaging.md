# 08 — Mobile Packaging (iOS App Store + Google Play)

Research-and-plan doc. No submission happens from this doc — no Apple/Google
dev account exists yet, no Mac exists yet. This is "make the app technically
ready to submit the day those two things show up," nothing more.

Scope checked against the real codebase, not assumptions: `frontend/`
(Vite 8 + React 19 + Tailwind 4 + `lucide-react` + `recharts`), `backend/`
(Express 5 + Prisma + cookie-based JWT), same-origin deploy on Railway
(`backend/server.js` serves `frontend/dist` directly — no CORS configured
because there's never been a second origin). No PWA manifest, no service
worker, no `capacitor` deps present today — this is a from-scratch mobile
wrap, not a fix-up of a half-done one.

---

## 1. Platform choice

### Recommendation: Capacitor. Confirmed, not just assumed.

The reasoning holds up:

- The frontend is a working Vite + React SPA already. `frontend/vite.config.js`
  builds to `dist/` with zero exotic bundler config — that's exactly the
  input Capacitor wants (`webDir: "dist"`).
- App.jsx is already shaped like a mobile app: single-page tab switcher
  (`today / trend / engine / plan / foods / recipes`), fixed bottom nav,
  `max-w-xl mx-auto` centering, `-apple-system` font stack. Nobody has to
  redesign the UX for a phone screen — it was already built for one.
- No native-hardware dependency exists in the current feature set (no
  camera/barcode scan yet, no HealthKit, no local notifications). Capacitor's
  main value-add over a bare WebView — a plugin bridge to native APIs — isn't
  even load-bearing yet. It's there for when Phase v4 (wearable read) or a
  future barcode scanner shows up (see `CLAUDE.md` §5/§6, V2-DEPLOY mentions
  barcode via OFF as a later target).
- Cost: roughly a day of setup (see §2 migration path), not a rewrite.

### PWA-only — the fallback, not the plan

Cheaper and faster (`vite-plugin-pwa`, a manifest, an icon set — maybe an
afternoon), and it already almost works given the current UI shape. But it
does not produce an App Store or Play Store listing, which is the stated
goal. Two concrete gaps against "shipped to the store": (1) iOS Safari's
"Add to Home Screen" PWA support is real but discoverability is user-driven
— there is no listing, no search presence, no install prompt on iOS the way
there is on Android/Chrome; (2) even a great PWA does not satisfy "I want
this in the App Store," which is a distribution/credibility goal as much as
a technical one. Recommendation: build the PWA manifest anyway as a
near-zero-cost side effect of the Capacitor work (Capacitor's asset
generator can emit a PWA manifest from the same icon source — see §4), so
there's an installable web fallback while store accounts are pending. Don't
stop there.

### React Native rewrite — not worth it, briefly

React Native would mean re-authoring every component in `frontend/src/
components/` (six tab components plus `ui/` primitives) against a different
component model, replacing Tailwind with a RN styling approach, and losing
`recharts` (web SVG library — RN needs `react-native-svg`-based charting
instead, e.g. Victory Native or Skia). That's a multi-week rewrite of a
working app to get to parity with where Capacitor gets it in a day, for a
payoff (marginally more "native" feel, marginally better long-term
performance ceiling) this app's feature set doesn't need. Revisit only if a
specific native capability Capacitor can't bridge becomes load-bearing —
nothing in the current or planned (v3/v4) feature set qualifies.

---

## 2. Migration path from the current Vite setup

```
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init "Cut Protocol" "com.<yourdomain-reversed>.cutprotocol" --web-dir dist
npm install @capacitor/ios @capacitor/android
npx cap add ios       # requires a Mac + Xcode — blocked until hardware exists
npx cap add android   # works today, Android Studio on Windows is fine
```

Key points specific to this repo:

- `webDir` must be `dist` (matches `vite build` output — confirmed in
  `frontend/vite.config.js`, no custom `build.outDir`).
- `frontend/index.html` currently has no `<meta name="viewport">` beyond
  `width=device-width, initial-scale=1.0` (already present, good) — add
  `viewport-fit=cover` for iOS notch/safe-area handling once wrapped, and
  use `env(safe-area-inset-*)` CSS on the fixed header/bottom-nav bars in
  `App.jsx` (currently plain `fixed bottom-0` with no safe-area padding —
  will sit under the iPhone home indicator otherwise).
- The app is currently 100% client-fetch against `/api/*` on the same
  origin (`frontend/src/lib/api.js` hardcodes relative `/api${path}`
  paths). Under Capacitor the origin becomes `capacitor://localhost` (iOS)
  or `https://localhost` (Android, via `androidScheme: "https"`) — relative
  paths break. `api.js` needs a configurable base URL (env-driven at build
  time: `import.meta.env.VITE_API_BASE_URL`, pointing at the Railway
  production domain for mobile builds, empty/relative for web builds).
- Two separate build artifacts going forward: the web build (served by
  Express, same-origin, relative `/api` paths, cookie auth) and the mobile
  build (bundled into the native shell, absolute API base URL, bearer-token
  auth — see §3). Same source tree, different `.env` at build time; don't
  fork the codebase.
- Dev loop: `npx cap sync` after every `vite build` to copy `dist/` into the
  native projects, `npx cap open ios` / `npx cap open android` to launch in
  Xcode/Android Studio. Android Studio + Android SDK can be set up on
  Windows today; iOS is blocked on Mac hardware as noted.

---

## 3. Auth model: cookies break, bearer tokens are the fix

### The problem, concretely

`backend/src/lib/auth.js` sets the session as an `httpOnly` cookie
(`cutprotocol_session`, `sameSite: "lax"`, `secure` in production) via
`setSessionCookie()`. `frontend/src/lib/api.js` calls `fetch` with
`credentials: "include"` and relies on the browser silently attaching that
cookie. This works today specifically because everything is same-origin
(Express serves the built frontend directly — see the comment in
`backend/server.js`: *"no CORS needed"*).

Under Capacitor, the app runs from `capacitor://localhost` or a Capacitor
`https://localhost` scheme and talks to a **separately hosted** backend
(the Railway domain) over real cross-origin HTTP. Research confirms this is
a known, common failure mode, not a hypothetical: Capacitor iOS WebViews
(`WKWebView`) have documented, longstanding problems reliably persisting
and re-sending cross-origin cookies — multiple open Capacitor/Ionic issues
and forum threads describe `Set-Cookie` either not being stored or not
being sent back on the next request specifically on iOS, even when
`SameSite`/`Secure` are configured correctly. Android is more forgiving but
still cross-origin, and `SameSite=Lax` cookies are not reliably sent on
cross-site `fetch`/XHR requests at all under the spec (`Lax` mainly
protects top-level navigations). Relying on cookie auth for the mobile
build is fragile at best, broken at worst, and the failure mode is silent
(requests just come back 401 with no obvious cause).

### Recommendation: bearer tokens for mobile. Migrate web too — don't run two auth systems.

Do not maintain cookie auth for web and bearer auth for mobile as two
permanent parallel systems. That's two auth code paths to secure, test, and
reason about forever, for an app with exactly one developer. Concrete
recommendation:

1. Change `POST /api/auth/login` to return the JWT in the **response body**
   in addition to (or instead of) setting the cookie.
2. Frontend stores the token: `localStorage` for the web build (accept the
   XSS-vs-CSRF tradeoff — this is a single-user personal app, not
   multi-tenant SaaS with a large attack surface) or, for the mobile build,
   Capacitor's secure storage (`@capacitor/preferences` for convenience, or
   a secure-storage plugin if it's worth the extra dependency for a
   single-user app — `@capacitor/preferences` is adequate here given the
   threat model).
3. `frontend/src/lib/api.js`'s `request()` helper attaches
   `Authorization: Bearer <token>` instead of relying on
   `credentials: "include"`.
4. `backend/src/lib/auth.js`'s `requireAuth` reads `Authorization: Bearer`
   first, falls back to the cookie only during a transition window, then
   the cookie path gets deleted once the web build is confirmed working
   bearer-only. Don't leave the cookie code as permanent dead weight.
5. Logout becomes "delete the local token" client-side (`clearCookie` on
   the server becomes irrelevant once cookies are gone).

This is a real auth model change, not a mobile-only shim — treat it as its
own small piece of work before the Capacitor wrap, not bolted on
afterward. Given this is a single-user app (`README.md`: "Personal
weight-cut tracker," seeded via `SEED_EMAIL`/`SEED_PASSWORD`, no signup
flow), the security bar is "don't be sloppy," not "survive a pentest" —
bearer-in-localStorage is a reasonable, common choice at this scale and
isn't worth over-engineering with refresh-token rotation or a BFF proxy.

---

## 4. CORS

`backend/server.js` has zero CORS configuration today, correctly, because
there is currently exactly one origin. That assumption breaks the moment
either (a) the Capacitor app ships and makes cross-origin `fetch` calls
from `capacitor://localhost`/`https://localhost`, or (b) any desktop shell
(Electron/Tauri) or separately-hosted preview environment needs to hit the
same API.

Once bearer-token auth (§3) is in place, CORS gets simpler because
`credentials: "include"` — the part that requires `Access-Control-Allow-
Credentials: true` plus an explicit (non-wildcard) `Access-Control-Allow-
Origin` — goes away for token-authenticated requests. Concrete change:

```js
// backend/server.js
const cors = require("cors");
const ALLOWED_ORIGINS = [
  "capacitor://localhost",
  "https://localhost",          // Android Capacitor scheme
  process.env.WEB_ORIGIN,       // Railway production domain, if the web
                                 // build ever gets split off its own origin
].filter(Boolean);

app.use(cors({
  origin: ALLOWED_ORIGINS,
  // credentials: true only needed if any cookie-based path still exists;
  // drop once §3's bearer-token migration is complete.
}));
```

Add `npm install cors` to `backend/package.json` (not currently a
dependency — confirmed by reading `backend/package.json`). Keep the
same-origin static-file serving block in `server.js` as-is for the web
build; CORS only needs to cover the `/api/*` routes and only matters for
the non-same-origin callers.

---

## 5. App Store / Play Store readiness checklist (prep only)

### Icons & splash screens

Current assets: `frontend/public/favicon.svg` and `icons.svg` only — no
app-icon-sized raster assets exist yet. Use `@capacitor/assets`
(`npx @capacitor/assets generate`) once a single 1024×1024 source icon and
a 2732×2732 splash source exist — it generates the full iOS/Android/PWA
size matrix from those two files rather than hand-exporting each size.
Needed inputs:

| Asset | Minimum source size | Generates |
|---|---|---|
| App icon | 1024×1024 PNG, no alpha/transparency for iOS | Full iOS icon set, Android adaptive icon (foreground+background layers), PWA manifest icons |
| Splash screen | 2732×2732 PNG | iOS launch screen, Android 12+ splash (small icon + background color per Android's new splash API), legacy Android full-bitmap splash |

Design work needed before this is runnable: an actual icon (the existing
`favicon.svg` is a start, but check it's simple enough to read at 40×40 —
detailed logos don't survive icon-scale) and a decision on Android
adaptive-icon foreground/background split (foreground layer needs safe
margin since OEM launchers mask it into circles/squircles/rounded-squares).

### Screenshots

Both stores require per-device-class screenshots, not one universal size.
Minimum practical set:

- **iOS**: 6.7" display (iPhone 15/16 Pro Max class) is the one Apple
  currently requires at minimum for new submissions; iPad screenshots only
  needed if the app supports iPad (this app's layout is `max-w-xl
  mx-auto` phone-first — either add a tablet layout or mark iPad
  unsupported to skip that requirement).
- **Android**: phone screenshots (minimum 2, up to 8), plus a feature
  graphic (1024×500) required for the Play Store listing page regardless
  of screenshot count.

Actual screenshots can't be captured until the app runs on-device/simulator
— defer capture to right before submission, but note it in the checklist
now so it's not a surprise.

### Apple Privacy Nutrition Label — data categories

Cross-referenced against the actual Prisma schema (`backend/prisma/
schema.prisma`), not guessed. What this app actually collects:

| Data collected | Apple category | Linked to user? | "Used to track"? |
|---|---|---|---|
| Email, password hash | Contact Info / User Credentials | Yes | No |
| Sex, age, height, body-fat %, weight (start/goal), weigh-in history | **Health & Fitness** | Yes | No |
| Dietary restrictions, cuisine preferences, meal notes | User Content / Health & Fitness (borderline — food preference data) | Yes | No |
| Job/activity class, training frequency | Health & Fitness | Yes | No |

"Used to track you" answer should be **No** across the board — this app
has no ad SDK, no cross-app/cross-site identifier sharing, no third-party
analytics evident in the codebase (only `@anthropic-ai/sdk` server-side for
AI recipe generation — that's a first-party API call, not tracking). If an
analytics SDK (Sentry, PostHog, etc.) gets added later, revisit this table
— that's exactly the kind of thing that flips "used to track" answers and
gets apps rejected for privacy-label mismatches during review.

Google Play's equivalent (Data Safety form) maps to the same underlying
data — same table applies, different form.

### Android permission justifications

Current feature set needs close to zero device permissions — no camera
(no barcode scan yet), no location, no contacts, no health-sensor read. If
push notifications ship (§6 default recommendation is to skip them for v1)
that's the only permission this version would plausibly need
(`POST_NOTIFICATIONS` on Android 13+). Keep the manifest permission list
minimal — Play Console increasingly flags apps requesting permissions with
no corresponding declared use, and it's a cheap, avoidable review-friction
point to skip since this app doesn't need any of the sensitive permission
tiers (camera/location/health-connect) yet.

### Age rating — the real, non-obvious risk for this app category

This is the one worth taking seriously, and it's real, not manufactured
caution:

- Neither Apple's nor Google's *public* written policy names "diet apps" or
  "eating disorders" as an explicit rejection category the way, say, gambling
  or adult content is explicitly called out — direct confirmation searches
  came back without a dedicated clause. But both platforms have broader
  catch-all language that reviewers apply in practice: Apple's Guideline
  1.4 (Safety — Physical Harm) covers apps that "risk physical harm" and
  requires health-measurement apps to disclose methodology/accuracy;
  Google's Health Content and Services policy prohibits "misleading or
  harmful health functionality" and requires a Health apps declaration form
  in Play Console for anything in the health/fitness category.
- The practical risk isn't "instant rejection" — it's app-store
  **age-rating classification**. Calorie-restriction and weight-tracking
  content is a recognized trigger for stricter age ratings on both
  platforms (Apple's age-rating questionnaire includes explicit questions
  about content that could promote eating disorders or unhealthy body
  image; Google Play's content rating questionnaire has an analogous
  health/behavior category). A `targetKcal` field, floor-guarded (`CLAUDE.md`
  C3: `max(RMR×0.95, 1500 kcal M / 1200 F)`), rate-of-loss bands, and
  weigh-in trend charts are precisely the feature surface that trips this
  — not because the app does anything wrong, but because the category
  itself gets extra scrutiny.
- **This app's actual answer is a genuine mitigant, and it should go in the
  submission notes**: `CLAUDE.md` C3 hard-codes a floor Apple/Google
  reviewers would want to see (never prescribes below RMR×0.95 or an
  absolute floor), C4 makes every adjustment visible and reversible, C1
  makes every number's math inspectable. That's the opposite of an opaque
  "lose weight fast" app. When the actual submission happens (out of scope
  here, but worth flagging now): expect Apple's age rating to land at 12+
  or 17+ depending on how the questionnaire is answered regardless of the
  floor logic — answer the "weight control/eating disorders" question
  honestly (the app is calorie-restriction-adjacent by definition) rather
  than under-declaring to get a lower rating, since a mismatch discovered
  later is a worse outcome than a conservative rating now. Single-user
  personal app with no public sign-up somewhat reduces real-world risk
  exposure but does not exempt it from the classification questionnaire.

Sources: [Guideline 1.4.1 forum discussion](https://developer.apple.com/forums/thread/708478), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play Health Content and Services](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en).

---

## 6. Push notifications — recommend skipping for v1

`CLAUDE.md` C8 is explicit and non-negotiable: *"Instrument, not slot
machine: no streak-shaming, no notification spam, no engagement bait. Ever.
Including v5."* A "time to weigh in" reminder is the most defensible case
for a notification in this app, but even that has a failure mode this
constitution specifically rules out (a missed-day nudge is one Slack
message away from streak-shaming).

Recommendation: **skip push notifications entirely for the v1 mobile
build.** Reasoning:

- Nothing in the current feature set requires them to function — this is a
  pull-based app (open it, see the verdict card, log a weigh-in) not a
  push-driven one.
- Implementing them C8-compliant means: no streak language, no red badge
  pressure, no "you haven't logged in 3 days" guilt copy, opt-in (not
  default-on), and probably capped at one gentle local reminder — that's
  real design work to get right, not a checkbox.
- Capacitor's `@capacitor/local-notifications` plugin makes a purely local
  "reminder at a set time" trivial to add later without any backend
  push-infrastructure work (no APNs/FCM server setup needed for local-only
  reminders) — so skipping it now costs nothing in optionality.

If it's revisited later, keep it to a single local (not server-push)
reminder, user-configured time, neutral copy ("Weigh-in time" not "Don't
break your streak!"), and no daily-open pressure of any kind — that's the
C8 bar.

---

## 7. Offline handling — v1 story: online-required, graceful failure

This is a data-driven app end to end — every tab (`TodayTab`, `TrendTab`,
`EngineTab`, `PlanTab`, `FoodsTab`, `RecipesTab`) round-trips through
`frontend/src/lib/api.js` to the Express/Prisma backend on every load.
There's no local cache layer, no IndexedDB, no service worker today.
Building real offline sync (local-first writes, conflict resolution
between a phone logging a weigh-in offline and the web app doing the same)
is a meaningfully large feature — event-sourcing-shaped, incidentally
exactly what `CLAUDE.md` §3-A4 describes as a future architecture law, not
something in place today (§9 STATE explicitly notes A1-A9 aren't retrofit
requirements).

Recommendation for v1: **require connectivity, fail gracefully, don't fake
offline capability.**

- `App.jsx` already has an `error` state pattern (`{error && <div>...retry
  by making any change.</div>}`) — extend that pattern specifically for
  network failures: detect `fetch` rejection (not just non-2xx) and show
  "No connection — check your network and try again" rather than a generic
  error or, worse, a blank/stuck loading screen.
- Add a `navigator.onLine` check + `window.addEventListener('online'/
  'offline')` listener to proactively show a persistent "You're offline"
  banner rather than waiting for a failed request.
- Do not attempt local write queuing (e.g., "log a weigh-in offline, sync
  later") for v1 — that's exactly the event-sourcing/sync-conflict problem
  the current schema (`Weighin` as a plain mutable Prisma row, per
  `CLAUDE.md` §9's own gap analysis) isn't built for yet. Scope it as a
  named future item if it ever becomes a real pain point, not a v1
  deliverable.
- One cheap, real offline affordance worth including: cache the last
  successfully loaded `profile`/`summary` response (e.g., in
  `localStorage`, alongside the bearer token from §3) so a phone with no
  signal shows the last-known verdict card read-only instead of a blank
  loading spinner. Read-only stale-data display is a small addition on top
  of work already being done for token storage; full offline read/write is
  not.

---

## Summary of decisions

1. **Platform**: Capacitor. PWA manifest as a free side effect, not the
   primary deliverable. React Native rejected — working app already exists,
   no native capability gap justifies the rewrite cost.
2. **Auth**: move off cookies entirely, to bearer JWT stored client-side
   (`localStorage` web, `@capacitor/preferences` mobile). Don't run two
   parallel auth systems — migrate web too, this is a single-user app where
   that tradeoff is reasonable.
3. **CORS**: add the `cors` package, allow-list `capacitor://localhost` +
   `https://localhost` (Android) + the Railway web origin, drop
   `credentials: true` once bearer-only.
4. **Store readiness**: icon/splash generation via `@capacitor/assets` once
   source art exists; Privacy Nutrition Label table built directly from the
   real Prisma schema (Health & Fitness category, no tracking); biggest
   non-obvious risk is age-rating classification on the weight-loss/calorie
   content questionnaire, not outright rejection — mitigated by this app's
   own floor/transparency rules (C1/C3/C4) but still expect a conservative
   rating, don't under-declare to dodge it.
5. **Push notifications**: skip for v1. C8 makes even a well-intentioned
   "log your weight" reminder risky to get wrong; local-only reminders stay
   available later at near-zero cost if revisited.
6. **Offline**: online-required with graceful error/offline states, plus
   cheap last-known-data read-only caching. No write-sync/local-first queue
   in v1 — that's an event-sourcing-shaped problem the current schema isn't
   built for.
