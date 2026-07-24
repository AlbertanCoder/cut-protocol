# Agent 02 — merged-UI drive (Chrome)

VERDICT: BROKEN

**Blocked at boot. The authenticated tabs were never reachable, so Profile/Today/Plan/
Recipes/Trend/Engine/Training are UNVERIFIED live.** Chrome has its own cookie jar (the
Electron window's session does not carry over), and the leftover Chrome session cookie is a
valid JWT for a user row that no longer exists.

---

## F1 — P0 · Boot dead-end: a 404 from `/auth/me` is dressed up as "server unreachable", and the copy is a lie

Reproduced live, first load, `http://localhost:3001`.

Network (`read_network_requests`): `GET http://localhost:3001/api/auth/me` → **404**
(`{"error":"user not found"}`, `backend/src/routes/auth.js:193`).
`GET /api/auth/status` → 200 `{"needsSetup":false}` — the server is up and healthy.

Rendered (`get_page_text`, verbatim):

```
Can't reach the app's server
user not found You are not signed out — the app just couldn't get an answer. If this persists, close and reopen Cut Protocol.
Retry
```

Screenshot: `ui/agent02-boot-deadend.jpg`. Zero console errors/warnings — it fails silently.

Cause — the seam (a) taxonomy hole:
`isAuthError` is `status === 401` **only** (`frontend/src/lib/api.js:58`), so `App.boot()`
(`App.jsx:113-121`) drops a 404 into `setAuthStatus("unreachable")`. `App.jsx:26-29` documents
that bucket as "the server never answered, or answered with a 5xx" — a 404 is neither.

Three separate falsehoods on one screen:
1. "Can't reach the app's server" — the server answered, twice, in ms.
2. "You are not signed out" — the account is gone. The session is unusable.
3. "the app just couldn't get an answer" — it got an answer.

**Retry is the only control and it loops forever** (clicked; page text unchanged). There is no
path to LoginScreen, no path to sign out, no path to register. Reinstalling won't help — the
cookie has a 30-day TTL (`backend/src/lib/auth.js:45`) and `clearCookie` is only reachable from
inside the app. A real user hitting this (DB restored from the pre-migration backup, or a
purged account — exactly the data-loss scenario the fleet doc opens with) is bricked.

Fix: treat `404` on `/auth/me` as "session no longer valid" → `authStatus="out"` with an honest
notice, or have `/auth/me` return 401 when the token's user is missing.

---

## F2 — P0 · Seam (b): the assumed body-fat estimate is never labelled, and the one label that exists now states the opposite of what the engine does

Agent 09 was right that `bfAssumed` has zero frontend consumers, and it is worse than that.

Backend ships the disclosure: `computeMacros` returns `bfAssumed` / `assumedBodyFatPct`
(`bmrEngine.js:302,342`) and `routes/weighins.js:78-81` adds
`lbmSource: "assumed-bodyfat-estimate"` plus a written note
(*"Estimated: body fat % isn't set, so lean mass assumes a typical 21% for your sex…"*).

Grep of all of `frontend/src` for `bfAssumed|assumedBodyFatPct|lbmSource|lbmSourceNote`:
**no matches.** The note is computed and thrown away.

The only BF-related copy the user can see is `EngineTab.jsx:211`:

> `" Protein/fat ranges assume LBM = body weight until you add a body fat %."`

That was true before Agent 09 and is **false now** — `bmrEngine.js:281-282` sets
`lbm = weight × (1 − 21%/28%)`. The app tells the user its protein range is off total
bodyweight while actually computing it off an assumed 21% body fat.

It is also gated on `profile.bodyFatPct === 0`, while the engine's `bfKnown` accepts null *or*
0 (`bmrEngine.js:280`). A profile with `bodyFatPct: null` gets the assumption **and no
disclosure at all**.

Constitution breach: "Provenance on every food entry… Displayed numbers can reveal their
formula and inputs." An estimated protein target renders identically to a measured one.

## F3 — P1 · Seam (b), same class: `confidence`, `stepCap`, `targetDrift` also have zero consumers

`routes/weighins.js:90-96` ships `confidence` ("How honest the number is, in one block"),
`stepCap` (Agent 09's ±125 kcal cap) and `targetDrift`. Grep of `frontend/src` for
`stepCap|targetDrift|indicatedTargetKcal`: **no matches**; `confidence`: no summary consumer
(only an unrelated string at `EngineTab.jsx:112`). When the step cap holds back a larger
indicated move, nothing on screen says so — the user sees a target with a silent governor on it.

## F4 — P1 · Seam (a): `LoginScreen`'s local `authRequest` has no timeout and throws outside the taxonomy

`LoginScreen.jsx:17-32`. Its own comment claims it "mirrors api.js's request()". It does not:

- **No timeout, no AbortSignal.** Every api.js call carries a 15–120s budget
  (`api.js:89-96`). `/auth/status` and `/auth/register` can hang forever; the screen sits on
  `mode: "checking"` (line 38) with no fallback.
- **Throws a plain `Error`**, so `isApiError`/`isTimeoutError`/`isOfflineError`/`isNoAnswer`
  are all `false` for it and `describeError()` can never classify it.
- Raw `err.message` is shown to the user at lines 51, 102 and 168 — `describeError()` is
  imported nowhere in this file. On a refused connection the sign-in screen renders Chrome's
  **"Failed to fetch"** instead of api.js's "Couldn't reach the app's server — the change was
  not sent." Login has a different error voice than the rest of the app, and 429s from either
  throttle surface as raw server strings.

## F5 — P2 · Seam (d): PlanTab green law holds, with one exception

Source review only (tab not reachable). Green is correctly bound to `inTolerance === true` and
fails closed (`PlanTab.jsx:256-276`); non-compliant day chips use `C.warn`/`C.ink`, never
accent (lines 216-226). **No green found on a non-compliant card.**

One violation: `PlanTab.jsx:89` sets `accentColor: C.accent` on the "Batch-cooking repeats OK"
checkbox — a selected state, which design law (a) forbids explicitly ("not selected states").

## F6 — seam (c): NOT TESTED

Deliberate. The toggle was never touched, per instruction. Source
(`ProfileTab.jsx:111-140,217-224,530-540`) implements the asymmetric rollback and the
non-dismissable per-allergen error as specified; live behaviour is UNVERIFIED.

---

## What the orchestrator needs to unblock a real UI walk

I cannot sign in: entering passwords and creating accounts are both prohibited for me, and the
permission classifier blocked both JS recovery paths (reading the session token, and
`POST /api/auth/logout` to clear the dead cookie). To get the merged UI walked, either:

- clear the `cutprotocol_session` cookie for `localhost` in Chrome and hand over a throwaway
  test account's session, or
- fix F1 first — then the dead cookie self-resolves to the sign-in screen and the walk can
  start from there.

Note for whoever fixes F1: the cookie is host-scoped, not port-scoped, so **any** localhost dev
server in the same browser shares `cutprotocol_session`.
