# Agent 06 handoff — Wave 3, Sold-Install Survival

Branch: `qc/overnight-2026-07-23` · 2026-07-23

Findings: `competitor-gap-1` (P0), `resilience-errors-2` (P1), `onboarding-flow-3`
(P1), `onboarding-flow-5` (P2), `resilience-errors-5` (P2) — **all five CLOSED**.

---

## ACTION REQUIRED BY THE ORCHESTRATOR

### 1. Install the new dependency

```
npm install
```

(run at the REPO ROOT, not in `backend/`). One dependency was added
declaratively to root `package.json`:

```
"dependencies": { "electron-updater": "^6.6.2" }
```

I did **not** install it, per the fleet rules. **The app still boots without
it** — `electron/updater.cjs` requires it lazily inside a try/catch and logs
`electron-updater is not installed … update checks disabled for this run`.
Verified: every live boot test below ran with the dependency absent.

If you want the exact isolated command: `npm install electron-updater@^6.6.2`.

### 2. Nothing else. No build, no migration, no schema change.

No Prisma schema change, no migration, no new env var required at runtime.

---

## Requests for other agents

### Agent 7 (`frontend/src/lib/api.js`) — `resilience-errors-5`, renderer half

I did not touch `api.js`. What I need from your central handler, for the half of
this finding that lives inside the running app:

1. **A failed `/auth/me` must not imply logout.** `401` = genuinely signed out →
   login screen. Anything else (network error, `5xx`, timeout) = "couldn't reach
   the local server", with a retry, on the CURRENT screen. Today a dead server
   dumps the user to a login form that says, in effect, "you were signed out" —
   which is false, and the user's next move (re-entering a password that then
   also fails) makes it worse.
2. **A post-login fetch failure must resolve to a state, never an infinite
   skeleton.** Every `undefined`-means-loading state needs a terminal error
   value. `TodayTab` already does this for the plan fetch (`plan === "error"`),
   and I extended the same pattern to the new generate path — a timeout in
   `request()` would let every screen do it.
3. If you add a timeout, please make it distinguishable from a `5xx` on the
   thrown error (e.g. `err.kind = "network" | "timeout" | "http"`). The copy for
   "the engine is not answering" and "the engine answered with an error" are
   different sentences and the second one should not tell people to restart.

Note there is now a preload bridge available in the packaged app if you ever
want it for diagnostics: `window.cutProtocol.getBackendInfo()` →
`{ port, host }`, and `window.cutProtocol.checkForUpdates()`.

### Whoever owns `frontend/src/components/ProfileTab.jsx`

`onboarding-flow-3` marks a defaults-derived profile as provisional and shows a
persistent banner on **Today**. The same banner would be worth showing on
Profile (that is where the fix happens). Helpers are exported and self-clearing:

```js
import { readProfileProvisional, describeAssumptions } from "./SetupWizard.jsx";
const provisional = readProfileProvisional(profile); // null once real data is entered
```

Not a blocker — the mechanism works and clears itself without it.

### Housekeeping for the owner (NOT done, deliberately outside my file list)

`SetupWizard.jsx` now exports 5 non-component helpers, which makes oxlint emit
5 `react(only-export-components)` **warnings** (Fast Refresh only; `oxlint`
still exits 0, and the repo already had unrelated warnings from other agents
tonight). The clean fix is a new file `frontend/src/lib/provisionalProfile.js`
holding `DEFAULT_ASSUMPTIONS`, `markProfileProvisional`,
`clearProfileProvisional`, `readProfileProvisional`, `describeAssumptions`,
with `SetupWizard.jsx`/`TodayTab.jsx` importing from it. Creating a new
frontend file was outside my ownership list, so I left it.

### `Dockerfile` / `railway.json` (nobody's tonight)

`backend/server.js` now defaults to `HOST=127.0.0.1`. **A container deploy must
set `HOST=0.0.0.0`** or it will bind loopback inside the container and be
unreachable. The override still works — there is a passing regression test for
it (`HOST stays overridable — the container deploy path can still bind
0.0.0.0`). If the Railway path is dead, deleting `Dockerfile`/`railway.json`/
`DEPLOY.md` would remove the only reason `HOST` is overridable at all.

### Re: `docs/qc/handoff/agent05.md` §1

Agent 5's residual risk — "if a `HOST=0.0.0.0` line ever lands in a packaged
`.env`, the app is network-exposed again" — **is closed for the desktop path.**
`electron/main.cjs:194` sets `process.env.HOST = "127.0.0.1"` *before* the
backend module is required, and `dotenv` never overwrites an existing var, so a
shipped `.env` cannot win. Comment at `electron/main.cjs:186-193` records this.
It is still worth adding a `HOST` check to `scripts/checkDistSafe.mjs` as
defence in depth (that file is not mine).

---

## What changed, by finding

### competitor-gap-1 (P0) — update channel · CLOSED

| File | What |
| --- | --- |
| `electron/updater.cjs` (new) | electron-updater wiring: launch check + manual check, background download, prompt-before-restart, silent-but-logged when offline |
| `electron/logger.cjs` (new) | file logger in `%AppData%\Cut Protocol\logs\cut-protocol.log`, self-rotating at 512 KB, diagnostics only (no user data) |
| `electron/license.cjs` (new) | offline Ed25519 entitlement gate, **inert by default**, dev bypass |
| `electron/licenseTool.cjs` (new) | owner-side keygen/sign/verify CLI, excluded from the packaged build |
| `package.json` | `electron-updater` dep, `build.publish` → GitHub `AlbertanCoder/cut-protocol`, `npm run release`, `npm run license:keygen`, `!electron/licenseTool.cjs` in `build.files` |
| `docs/RELEASING.md` (new) | exact publish steps, verification procedure, rollback, licensing, failure table |

No token anywhere in the repo. `GH_TOKEN` is set in the publish shell only —
documented in `docs/RELEASING.md` §1.2/§2.3.

### resilience-errors-2 (P1) — port conflict · CLOSED

- Port is **probed** (3001 preferred, upward to 3020, then OS-assigned `:0`)
  before the backend is required — `electron/main.cjs:143-178`.
- Per-launch nonce (`electron/main.cjs:183`) + `/api/meta/whoami`
  (`backend/server.js:60-81`) handshake; the shell **refuses to load an origin
  it can't verify** — `verifyOwnBackend`, `electron/main.cjs:344`.
- Bind is **loopback only** — `backend/server.js:127` and `:131`.

### onboarding-flow-3 (P1) — fabricated profile · CLOSED

`SetupWizard.jsx` — "Skip — use defaults" (which silently called
`putProfile({})` and let the server invent a 30-year-old, 178 cm, 90 kg person)
is gone. Replaced by an explicit, acknowledged estimate path plus a persistent,
self-clearing `ESTIMATE FROM DEFAULTS` banner on Today.

### onboarding-flow-5 (P2) — buried day-1 payoff · CLOSED

`TodayTab.jsx` — the no-plan state is now a single "Generate this week's plan"
CTA that solves the week in place.

### resilience-errors-5 (P2) — honest failure screens · CLOSED (boot half)

`electron/splash.html` + `electron/main.cjs` — every boot failure path ends in a
titled failure screen with what happened, what it means for the user's data,
what to do, the log path, and an "Open log folder" button. The renderer half is
Agent 7's (see above).

---

## Files I changed

```
electron/main.cjs          (M)
electron/preload.cjs       (M)
electron/splash.html       (M)
electron/logger.cjs        (NEW)
electron/updater.cjs       (NEW)
electron/license.cjs       (NEW)
electron/licenseTool.cjs   (NEW)
package.json               (M — root only)
backend/server.js          (M)
frontend/src/components/SetupWizard.jsx  (M)
frontend/src/components/TodayTab.jsx     (M)
backend/tests/serverPortIdentity.test.js (NEW)
backend/tests/bootLicenseGate.test.js    (NEW)
docs/RELEASING.md          (NEW)
docs/qc/handoff/agent06.md (NEW — this file)
```

I did not touch `backend/tests/bootstrapResilience.test.js` (Agent 2's),
`backend/package.json` (Agent 1's), `frontend/src/lib/api.js` (Agent 7's), or
`frontend/dist/`.

Note: the two new test files raise the discovery count in
`backend/scripts/runTests.mjs`; its `MIN_TEST_FILES` / `MIN_TESTS` floors are
minimums, so nothing needs changing, but the counts will be +2 files / +13 tests.
