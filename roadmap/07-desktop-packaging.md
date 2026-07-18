# 07 — Desktop Packaging Plan

Research-and-plan only. No code changed as part of this doc. Written against
the codebase as it exists today:

- `backend/server.js`: single Express process, `app.use(express.static(frontendDist))`
  + a catch-all `sendFile(index.html)` for client routing, API mounted at
  `/api/*` in the same process. Listens on `process.env.PORT || 3001`.
- Auth: `backend/src/lib/auth.js` issues a JWT in an **httpOnly cookie**
  (`cutprotocol_session`), `sameSite: "lax"`, `secure` only when
  `NODE_ENV === "production"`. No CORS middleware anywhere in the repo —
  there's never been a need for it, because the frontend has always been
  served from the same origin as the API.
- `frontend/src/lib/api.js`: every request is `fetch(\`/api${path}\`, { credentials: "include" })`
  — **relative path, hardcoded assumption of same-origin**. There is no
  concept of a configurable API base URL anywhere in the frontend.
- Dev mode: Vite dev server on :5173 proxies `/api` to :3001
  (`frontend/vite.config.js`), so even locally it's same-origin from the
  browser's point of view.
- Prod deploy (`DEPLOY.md`, `Dockerfile`, `railway.json`): one Docker image,
  frontend built and copied into `frontend/dist`, served by the same Express
  process that owns the API, deployed as one Railway service backed by
  Postgres.
- No PWA manifest, no service worker, no Electron/Tauri scaffolding exists
  anywhere in the repo today. This is a from-scratch decision.

This same-origin design is why the app has never needed CORS or a
configurable API URL — and it's exactly the assumption a desktop shell
breaks, however this gets built. That's the throughline for everything below.

---

## 1. The three options, evaluated for *this* app specifically

### Option A: Electron

Two fundamentally different things get called "Electron app" and this app's
already-decided direction (multi-tenant, hosted) picks between them:

**A1 — Local-first (bundle Express+SQLite inside the app).** Electron's main
process would spawn the actual `backend/server.js` as a child process (or
in-process) against a local SQLite file, no network required. This is the
architecture for something like Obsidian or a single-player tool.

**This does not fit this product.** The whole point of the Phase A/B work
already shipped (per `README.md`) is a *hosted, logged-in, multi-user* app —
Postgres in production, one shared backend, accounts. A local-first desktop
build would mean either (a) forking the data model into two divergent
storage backends (SQLite-per-device vs. shared Postgres) with no sync story,
which is a distributed-systems project nobody has asked for, or (b) shipping
a "desktop mode" that's quietly single-player and disconnected from the
account system the rest of the product assumes. Neither is a few days of
packaging work — both are new products. Rule this out.

**A2 — Thin client (bundle the built frontend, hit the hosted API).** The
Electron main process opens a `BrowserWindow` that loads `frontend/dist`
(bundled into the app itself, not fetched over the network at runtime) and
all `/api/*` calls go over HTTPS to the real deployed backend — the same one
the web version and, eventually, other users' desktop/mobile clients hit.
No local database, no local Express. This is the only version of Electron
that makes sense here, and it's a straightforward, well-trodden pattern
(Slack, Discord, Linear's desktop app all work this way).

Tradeoffs of A2 specifically:
- Pro: pure JS/Node tooling end to end — same language, same npm ecosystem,
  same debugging model as the rest of this stack. `electron-builder` is
  mature, extremely well documented, and `electron-updater` (auto-update)
  is close to turnkey against GitHub Releases for free.
- Pro: huge community/StackOverflow/GitHub-issue coverage — when something
  breaks at 11pm, there's a fix already written up.
- Con: ~80–150MB installer, ~150–300MB idle RAM (bundles Chromium + Node
  per app). For a weight-tracking app this is a non-issue in practice, but
  it's the honest number.
- Con: it is, mechanically, a browser tab with a taskbar icon. That's fine
  — it's what nearly every "desktop app" people use daily actually is — but
  worth naming plainly rather than dressing it up.

### Option B: Tauri

Same A2 shape (bundle the built frontend, hit the hosted API over HTTPS) but
the shell is a Rust binary driving the OS's native webview (WebView2 on
Windows, WKWebView on macOS) instead of bundling Chromium.

- Pro: installers land under ~10MB, idle RAM in the 30–50MB range — roughly
  a 5–10x improvement over Electron on both axes. Meaningfully better if
  this product ever needs a lightweight always-on tray presence.
- Pro: smaller attack surface (no bundled Chromium/Node runtime to keep
  patched inside the app itself).
- Con — and this is the one that matters for *this* team: it requires a
  working Rust toolchain (`rustup`, MSVC Build Tools with the C++ workload
  on Windows, the WebView2 SDK) on the build machine, and any build-time
  failure surfaces as a Rust/Cargo compiler error. Nobody on this project
  (owner or the Claude Code sessions doing the engineering) has Rust
  experience. A stuck `cargo build` on Windows is a materially worse
  debugging experience than a stuck `npm install`, and it's exactly the
  kind of toolchain-yak-shave that stalls a side project for days.
- Con: auto-update tooling is real but younger and less battle-tested than
  `electron-updater` — full-binary updates rather than Electron's
  differential updates (a non-issue at Tauri's bundle sizes, but the
  release-engineering docs and community answers are thinner).
- Con: still needs WebView2 present on the end-user's Windows machine.
  Preinstalled by default on Windows 11 and current Windows 10 builds; a
  small evergreen bootstrapper covers the remainder. Not a real blocker,
  just an extra install-time dependency to be aware of.

Tauri is the objectively better runtime. It is not the better choice for
who's actually going to build and maintain this.

### Option C: Installable PWA

The frontend is already a plain Vite SPA — getting a browser-installable PWA
out of it is cheap: add a `manifest.json` (name, icons, `display: "standalone"`,
theme colors) and a minimal service worker (a plugin like `vite-plugin-pwa`
does most of this in a few lines of Vite config). Edge/Chrome on Windows will
then offer "Install Cut Protocol," which creates a real Start Menu entry, a
pinnable taskbar icon, and a window with no browser chrome — genuinely
indistinguishable from a native app shell at a glance.

What it does *not* get you, and this matters for a login-gated,
server-computed app like this one: meaningful offline support. Nearly every
screen in this app (weigh-in trends, macro targets, recipe/plan generation,
grocery lists) is either a live DB read behind auth or a server-side
computation (`weeklyPlanner.js`, `bmrEngine.js`). A service worker can cache
the app shell (JS/CSS) for instant loads and a "you're offline" fallback,
but there's no realistic amount of engineering here that makes the actual
*data* usable offline without building real local storage + sync — which is
the same distributed-systems problem Option A1 ran into, just smaller. So:
PWA gets you install-ability and a native-feeling window essentially for
free; it does not get you a materially more capable app than the website.

Also worth naming directly: a PWA install is real, but it's a smaller,
quieter action than double-clicking a downloaded `CutProtocolSetup.exe` —
no download, no installer wizard, no "an app got installed on my computer"
moment. Some users don't even notice the install prompt exists.

**This is a judgment call for the owner, not something to assume an answer
to:** if "desktop app" means "I can open it without a browser and it has an
icon," a PWA plausibly satisfies that today, cheaply, and the packaging
question could stop here. If it means "a real installer, Start Menu
presence, something that feels like the native software this app is
becoming," a PWA under-delivers relative to that expectation — and given
this is explicitly one of three target platforms alongside native iOS and
Android builds (i.e., the direction is toward real installed software
everywhere, not web wrappers), the PWA reading feels like the less likely
fit for what's actually being aimed at. Flagging it rather than deciding it.

---

## 2. Recommendation

**Electron, thin-client (Option A2): bundle `frontend/dist` inside the app,
all API calls go over HTTPS to the real hosted backend — the same backend
every web and (eventually) mobile user hits. Ship the PWA (Option C) too,
as a near-free complementary install path, not instead of Electron.**

On the framing question posed going in — thin-client vs. local-first — the
assumption holds and I'd push it further than "almost certainly right":
local-first isn't just suboptimal here, it's a different product. This app
already made the hosted/multi-user bet (Postgres in prod, JWT auth,
accounts) before this task started. A local-first desktop build would mean
building a sync engine that nothing else in the roadmap has asked for, to
serve a offline-capability nobody has requested, for a product whose entire
current value (server-computed macros, recipe generation, shared account
across devices) lives on the server anyway. Thin-client is correct by a
wide margin, not a close call.

On Electron vs. Tauri: Tauri is the better runtime on every technical axis
that shows up in a table — size, memory, attack surface. I'm recommending
Electron anyway because the deciding variable isn't the runtime, it's who's
building this. This is a solo, non-engineer owner directing a Claude Code
session as the actual implementer, across a stack that is JS/Node end to
end (Express, Prisma, Vite, React). Electron keeps the desktop shell in that
same toolchain — same package manager, same debugging tools, same language
Claude Code already reasons well about. Tauri introduces Rust, Cargo, and
MSVC Build Tools as a hard dependency for every future build-pipeline
change, which is real risk of exactly the kind of stall this project can't
afford right now (per the project's own zero-tolerance-for-half-measures
posture — a broken Rust toolchain mid-build is a worse failure mode than a
few hundred extra megabytes of RAM). If the product matures, gets a second
engineer, or the resource footprint actually becomes a complaint, revisit
Tauri then — it's a rewrite of the shell only, not the app, since both
approaches point the same bundled frontend at the same hosted API.

---

## 3. Implementation plan

### 3.1 Backend changes required (`server.js`, CORS, cookies)

The Electron-bundled frontend will not be served by `backend/server.js` —
it ships inside the Electron app itself and loads from Electron's packaged
resources. That breaks the same-origin assumption the whole auth flow
currently relies on. Required changes:

1. **CORS middleware**, added to `backend/server.js` (currently absent —
   there's no `cors` package in `backend/package.json` today). Needs an
   explicit origin allow-list, not `*` — wildcard origins are incompatible
   with `credentials: true`, which this app needs to keep sending the
   session cookie:
   ```js
   const cors = require("cors");
   app.use(cors({
     origin: [
       "https://<your-railway-domain>",      // the web app itself
       "http://localhost:<electron-loopback-port>", // see 3.2 below
     ],
     credentials: true,
   }));
   ```
2. **Cookie flags** in `backend/src/lib/auth.js`. Today: `secure` only in
   production, `sameSite: "lax"`. Cross-origin `fetch`/XHR requests (which
   is what the Electron shell will be making, even against production)
   **do not send `sameSite: "lax"` cookies at all** — lax only rides along
   on top-level navigations. This needs to become:
   ```js
   secure: true,       // required for sameSite: "none"; means dev cookies
                        // now need HTTPS too, or a dev-only carve-out
   sameSite: "none",
   ```
   This is a behavior change for the *existing web app* too, not just the
   desktop build — worth testing the website login flow again after this
   lands, before touching Electron at all.
3. **Frontend: replace the hardcoded relative `/api` path** in
   `frontend/src/lib/api.js` with a configurable base URL (e.g.
   `const API_BASE = import.meta.env.VITE_API_BASE ?? ""` — empty string
   preserves today's relative-path behavior for the web build; Electron's
   build gets `VITE_API_BASE=https://<railway-domain>` baked in at build
   time via a separate Vite build target/env file).

### 3.2 The `file://` trap — read this before wiring up the shell

The naive version of "bundle the frontend in Electron" is
`win.loadFile("dist/index.html")`, which loads the app from a `file://`
origin. Two real, previously-filed Electron bugs make this the wrong move:
`file://` requests don't reliably carry an `Origin` header at all (so the
CORS allow-list above has nothing to match against), and cookie behavior
for local/custom-protocol origins has changed across Electron versions in
ways that have broken existing apps (see electron/electron#20730 and
#31438 — cookies silently not being set on localhost/custom protocols
between Electron versions).

The standard, reliable fix: **have the Electron main process run a tiny
local static file server** (e.g. `express.static` or even Node's built-in
`http`) bound to `127.0.0.1` on an app-picked port, serving the bundled
`frontend/dist`, and `loadURL("http://127.0.0.1:<port>")` instead of
`loadFile`. This gives the renderer a real `http://localhost:PORT` origin —
something CORS can allow-list cleanly and that cookie handling treats
normally, same as any other real origin. This is a small amount of extra
main-process code but it removes an entire category of "works on my machine,
breaks in the packaged build" bugs.

### 3.3 Auto-update strategy

`electron-updater` + GitHub Releases, free, no separate update server to
run:
- Tag a release in the repo, run `electron-builder --publish=always` (or
  wire it into a GitHub Action), which uploads the installer plus a
  `latest.yml` manifest to a GitHub Release.
- The packaged app calls `autoUpdater.checkForUpdatesAndNotify()` (or a
  manual "Check for updates" menu item) on launch; it diffs against
  `latest.yml`, downloads in the background, and applies on next relaunch.
- **This requires the repo (or at least the releases) to be reachable from
  GitHub the way `electron-updater` expects** — fine for a public repo,
  needs a GitHub token wired in for a private one. Confirm which this repo
  is before wiring this up.
- Auto-update on Windows works meaningfully better once builds are signed
  (see 3.4) — `electron-updater` will otherwise re-trigger SmartScreen
  friction on every update, not just first install.

### 3.4 Code signing — what's needed, cost, and what works without it

**Nothing here is required to build or run the app locally.** An unsigned
`electron-builder` build produces a working `.exe`/installer today, for
free, that runs fine on the machine that built it and on any machine willing
to click through Windows SmartScreen ("Windows protected your PC" → "More
info" → "Run anyway"). That's sufficient for the owner's own use and for
handing a build to a handful of people who trust the source. What's blocked
without signing is **public/wide distribution** — an unsigned installer
handed to a stranger reads as a red flag and SmartScreen actively discourages
running it.

For real distribution, Windows options as of mid-2026:
- **OV code signing certificate** (~$200–300/yr from a CA like SSL.com,
  SignMyCode, etc.). Since June 2023 the private key for *any* publicly
  trusted code-signing cert (OV or EV) must live on certified hardware — a
  physical USB HSM/token or a cloud HSM — it can no longer just be a file
  on disk. That adds friction (and sometimes cost) beyond the cert price
  itself.
- **EV certificates no longer buy what they used to**: EV certs used to
  skip SmartScreen's reputation-building period entirely; that carve-out
  was removed in 2024. EV and OV now both build reputation the same way
  (accumulated clean downloads over time), so paying the EV premium
  (~$400+/yr) purely to dodge SmartScreen isn't justified anymore — OV is
  the right tier for this app.
- **Azure Trusted Signing** (Microsoft's cloud signing service, ~$10/month)
  is the more attractive path if it fits: no physical HSM token to manage,
  CI-friendly, and — relevant given the owner doesn't currently hold any
  developer credentials — it now accepts **individual developers**, not
  just registered businesses, in the US and Canada. Identity is validated
  against the Azure billing account (legal name, billing address must
  match exactly). Requires a paid Azure subscription; doesn't work on
  free/trial/sponsored subscriptions. This is worth a serious look before
  buying a traditional OV cert — cheaper annualized and no token to keep
  track of.
- New CA/Browser Forum rules tighten cert lifetimes going forward
  (max ~1 year from mid-Feb 2026, max 458 days from March 2026) — whichever
  path is chosen, budget for annual renewal, not a one-time purchase.

For macOS, if it's ever targeted (noted as "ideally cross-platform" but not
the primary target): **Apple Developer Program, $99/yr**, required for a
Developer ID Application certificate and for **notarization**
(`xcrun notarytool` or `electron-builder`'s notarize hook via
`@electron/notarize`). Gatekeeper will refuse to open an unsigned,
non-notarized app for most users without an explicit right-click-open
override — functionally required for any Mac distribution beyond the
owner's own machine.

**Bottom line to flag plainly, not assume:** don't buy anything yet. Build
and test unsigned first (works today, free). Revisit signing when there's
an actual second user waiting to install this — buying a cert or an Apple
membership before that point is spending against a distribution problem
that doesn't exist yet.

### 3.5 Build/packaging pipeline — what `package.json` looks like

New top-level (or `electron/`) package, separate from `frontend/` and
`backend/`, since it has its own dependency (`electron`, `electron-builder`,
`electron-updater`) and build lifecycle:

```jsonc
{
  "name": "cut-protocol-desktop",
  "version": "0.1.0",
  "main": "main.js",
  "scripts": {
    // build the web app with the desktop-specific API base baked in
    "build:renderer": "cd ../frontend && VITE_API_BASE=https://<railway-domain> npm run build",
    // package for local testing, unsigned, current platform only
    "build:unpacked": "npm run build:renderer && electron-builder --dir",
    // full signed build for the current OS, for release
    "dist": "npm run build:renderer && electron-builder",
    // cut a GitHub Release with installer + latest.yml for electron-updater
    "release": "npm run build:renderer && electron-builder --publish=always"
  },
  "devDependencies": {
    "electron": "^<latest>",
    "electron-builder": "^<latest>"
  },
  "dependencies": {
    "electron-updater": "^<latest>",
    "express": "^<same as backend>"  // only for the local loopback static server, 3.2
  }
}
```
`electron-builder` config (either in this `package.json`'s `"build"` key or
`electron-builder.yml`):
```yaml
appId: com.cutprotocol.desktop
productName: Cut Protocol
files:
  - main.js
  - preload.js
  - "../frontend/dist/**/*"
win:
  target: nsis
  # signing config goes here once a cert/Trusted Signing is set up —
  # omit entirely for unsigned local builds
mac:
  target: dmg
  category: public.app-category.healthcare-fitness
publish:
  provider: github
  owner: <owner>
  repo: cut-protocol
```
Local dev loop: `npm run build:unpacked` produces a runnable, unsigned app
in `dist/` — this is what to use for all testing before any signing
decision is made.

---

## 4. Summary

| | Electron (recommended) | Tauri | Installable PWA |
|---|---|---|---|
| Model | thin client, hosted API | thin client, hosted API | thin client, hosted API |
| Install size | ~80–150MB | <10MB | none (browser feature) |
| New toolchain risk | none (pure JS) | high (Rust/Cargo/MSVC) | none |
| Auto-update | mature (`electron-updater`) | works, less mature | handled by browser |
| Feels like "an app" | yes | yes | maybe — owner's call |
| Blocked without paid certs | public distribution only | public distribution only | nothing — no signing concept |
| Cost to ship first unsigned build | $0 | $0 | $0 |

**Recommendation: Electron, thin-client, hitting the real hosted backend —
same model as the web app and future mobile clients. Ship the PWA
alongside it since it costs almost nothing given the existing Vite setup.
Skip Tauri for now; it's the better runtime but the wrong toolchain bet for
a solo owner + Claude-Code-as-engineer team.**

**Biggest technical risk:** the auth boundary crossing from same-origin
(today) to cross-origin (thin client). This is not a one-line CORS fix —
it's `sameSite: "lax"` → `"none"` (which forces `secure: true` everywhere,
including whatever "dev" means for the desktop build), a real CORS
allow-list replacing "no CORS needed" as a design premise, the frontend
losing its relative-`/api`-path assumption, and — the part most likely to
bite silently — the `file://`-origin trap in section 3.2, where a naive
`loadFile()` shell will *appear* to load fine and then have login either
silently fail to persist the session cookie or fail in a way that only
shows up in the packaged build, not in dev. Get the loopback-static-server
pattern and the cookie/CORS changes working and verified (login, refresh,
logout, session persistence across app restarts) before spending any more
time on packaging polish, signing, or auto-update — everything downstream
of this assumes the auth flow actually survives the origin change.
