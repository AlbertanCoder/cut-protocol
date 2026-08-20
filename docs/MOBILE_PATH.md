# Mobile path — described, deliberately not built

Per CUT_PROTOCOL_DIRECTIVE.md §11: say it plainly, build none of it now.

## Where mobile actually stands

- **No PWA exists.** No manifest, no service worker, no vite-plugin-pwa
  (verified in AUDIT §4). The only mobile-shaped work in the tree is the
  simple surface (`frontend/src/simple/`, ~2,900 lines): genuinely
  mobile-first responsive — `min-h-svh`, top "doors" row that becomes a
  sidebar at `sm:`, ≥44 px tap targets — reachable at `?simple=1`.
- The full app is desktop-first by standing rule and stays that way.

## Step 1 — PWA scaffold (the cheap, correct scaffold; NOT yet done)

1. `manifest.webmanifest` (name, icons from `assets/icon/png/`, standalone
   display, theme colors matching the shipped light default `#FBF7F1`).
2. `<link rel="manifest">` + `apple-mobile-web-app-*` tags in
   `frontend/index.html`.
3. A minimal service worker (app-shell cache only; NEVER cache `/api/*` —
   a stale plan is a wrong prescription; network-first or bypass for data).
4. Installability check in Chrome/Safari on the live Railway URL — a PWA
   only installs from HTTPS, so this lands after the hosted deploy is
   verified.
Cost estimate: an afternoon. Risk: low. Value: home-screen presence on the
operator's phone without an app store.

## Step 2 — App Store (later, honestly)

- **Capacitor is the sane wrapper** for this stack (React/Vite frontend
  already talks to a hosted API in hosted mode): wrap `frontend/dist`,
  point it at the Railway API, native shell per platform.
- What it actually requires, no varnish:
  - Apple Developer Program (US$99/yr) + a Mac (or cloud Mac) for Xcode
    builds; Google Play US$25 one-time.
  - App Review compliance: account deletion IN-APP (the privacy page
    already admits this is unbuilt — it becomes mandatory, not optional),
    Sign in with Apple is required the moment Google sign-in is offered on
    iOS, subscription purchases likely forced through StoreKit/Play Billing
    (LemonSqueezy web checkout inside an iOS app is a rejection magnet —
    budget for native IAP or external-purchase-link entitlements, both real
    work).
  - Touch ergonomics beyond responsive CSS: safe-area insets, keyboard
    avoidance on the log/weigh-in inputs, offline behavior story.
  - Health-app category scrutiny: the ED-safety posture (never-red, SCOFF
    opt-in, resources) is an asset here; the medication gate being unwired
    (BLOCKERS B11) is the kind of thing a reviewer question would surface.
- Order of operations that doesn't waste money: verified hosted deploy →
  PWA on the operator's phone → real usage evidence → only then Capacitor.

## What must NOT change on the way to mobile

The five-surface IA, the solver-server boundary (all solving stays
server-side; a phone never computes a prescription), and the safety rails —
every rail lives in the backend precisely so no client packaging can skip it.
