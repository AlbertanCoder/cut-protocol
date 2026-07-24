# Agent 07 — frontend resilience (frontend-arch-1 / -3 / -4, resilience-errors-5)

Branch `qc/overnight-2026-07-23`. Files changed are listed at the bottom.
Nothing outside my ownership list was touched.

---

## 1. What other agents MUST know about `lib/api.js`

**No call signature changed.** Every `api.*` method still works when called
exactly as before. Each one now accepts an **optional trailing `opts`
argument** — `{ signal, timeoutMs }` — appended after the existing params:

```js
api.getFoods()                      // unchanged
api.getFoods({ signal })            // new, optional
api.putProfile(patch)               // unchanged
api.putProfile(patch, { signal })   // new, optional
```

I did not have to touch a single call site in anyone else's file. Call sites
in files I do NOT own are listed in §5 — they keep working untouched, but
they will not get unmount-abort until their owner adds `{ signal }`.

### New exports from `lib/api.js`
| export | use |
|---|---|
| `ApiError`, `ERR` | error class + kind constants (`http`/`timeout`/`offline`/`aborted`) |
| `isAuthError(e)` | **real HTTP 401 only** |
| `isTimeoutError(e)` / `isOfflineError(e)` / `isNoAnswer(e)` | the server never answered |
| `isAbortError(e)` | we cancelled it (unmount) — should be *silently ignored* in catch blocks |
| `describeError(e)` | one honest user-facing sentence |
| `onSessionExpired(fn)` | register THE 401 handler (App already does; do not add a second) |
| `TIMEOUT` | the budget table (`READ` 15s, `WRITE` 20s, `BULK` 30s, `SOLVER` 45s, `REMOTE` 60s, `LLM` 120s) |

`e.status` and `e.body` are preserved **only for real HTTP responses**, so
existing checks (`e.status === 422 && e.body.requiresAck`, `e.status === 404`,
`e.status === 401` in LoginScreen) behave identically — and, critically, a
timeout can no longer masquerade as any of them (`status` is `undefined`).

### New file: `lib/useAbortable.js` → `useAbortSignal()`
Returns a stable object whose `.signal` aborts on unmount and self-heals
across a StrictMode double-mount. Usage:

```js
const abort = useAbortSignal();
useEffect(() => {
  api.getX({ signal: abort.signal })
     .then(setX)
     .catch((e) => { if (!isAbortError(e)) setError(describeError(e)); });
}, [abort]);
```
Never put `abort.signal` in a dependency array — read it inside the body.

### Base URL / Agent 6's dynamic port
`docs/qc/handoff/agent06.md` did not exist when I finished, so I read
`electron/preload.cjs` directly. It states that the renderer is **served from
the backend's own origin** and that the per-launch nonce is deliberately
**not** exposed to the renderer. Relative `/api/...` therefore remains correct
with a dynamic port and **no change was needed**. `apiUrl()` /
`handshakeHeaders()` will pick up `window.cutProtocol.apiBaseUrl` and
`window.cutProtocol.apiNonce` if those keys ever appear, and are inert
otherwise. **Assumption to reconcile:** if Agent 6 later requires a renderer
-side nonce header, publish it on the bridge under `apiNonce` and it is sent
as `X-Cut-Protocol-Nonce` with zero further frontend changes.

## 2. Requests for files I do NOT own

1. **`LoginScreen.jsx` (Agent 5)** — no change required from me. App renders
   the "your session expired" notice *itself*, above `<LoginScreen>`; I did
   **not** add a `notice` prop, so nothing in LoginScreen needs to handle it.
   If you'd rather own that copy, tell the orchestrator and I'll drop the
   banner in App.
2. **`TodayTab.jsx` (Agent 6)** — `api.getCurrentPlan().then(setPlan).catch(() => setPlan("error"))`
   is fine, but the diary/weigh-in handlers should adopt `{ signal }` +
   `isAbortError` for unmount safety.
3. **`PlanTab.jsx` (Agent 8)** — `api.getCart().then(...).catch(() => {})`
   silently renders "no cart"; `api.getProfileMeta().catch(() => {})` hides
   the citation. Same abort/`describeError` treatment recommended.
4. **`SetupWizard.jsx` (Agent 6)** — `onDone` is now a *guarded* function
   (App catches load failures), so awaiting it will never throw.
5. **Not owned by anyone tonight, still unguarded:** `BrainChat.jsx`,
   `TrainingTab.jsx`, `BodyFatPicker.jsx` — all call `api.*` with no abort
   signal. `TrainingTab` also renders a failed load as an empty plan.

## 3. Byte-level note for the orchestrator

Two stray NUL bytes briefly landed in `ProfileTab.jsx` (my edit, in a
`join()` separator). They are **removed and verified gone** — the file is
clean UTF-8 text again and `git diff --stat` is back to a sane 330/74.
Worth a `grep -Il ''`-style sanity pass over the whole tree before commit if
other agents hit the same editor glitch.

## 4. Verification actually run

- `npx oxlint` → 0 errors, 0 warnings on my files (only pre-existing
  `only-export-components` warnings in SetupWizard, not mine).
- `npx vite build` → `✓ built in 613ms`, 2377 modules, no errors. (The
  >500 kB chunk warning is pre-existing and documented in CLAUDE.md.)
- Error-taxonomy harness (22 assertions, all pass) covering: 401→handler
  fires once; 500→no logout; connection-refused→`offline`, no logout;
  timeout→`timeout` + `outcomeUnknown`, no logout; unmount abort→`aborted`;
  pre-aborted signal issues no fetch; 422 body preserved; `login`/`me` 401
  exempt from the global handler; 200/204 unchanged. Harness lives in the
  session scratchpad (not committed).
- **UNVERIFIED:** no browser/Electron run. There is no frontend test runner
  in this repo, and I did not launch the app (nine other agents are editing
  the same tree). The allergy failure UI is verified by build + review only.

## 5. api.js call sites (for the record)

Mine, now passing `{ signal }`: App (`me`, `getProfile`, `getSummary`,
`logout`), ProfileTab (`getProfileMeta`, `putProfile`, `getProfile`),
EngineTab (`getProfileMeta`, `putProfile`), FoodsTab (`getFoods`, `putFood`,
`getRecipes`, `updateRecipe`), TrendTab (`getTrainingPlan`), RecipesTab
(`getRecipes`, `getCart`, `getRatings`, `rate/unrateRecipe`,
`add/removeFromCart`, `fillTodayFromCart`, `generateCartGroceryList`,
`generateRecipeDrafts`, `importRecipe`, `saveRecipeDraft`, `updateRecipe`,
`deleteRecipe`, `placeRecipe`), BarcodeLookup (`lookupUpc`, `importUpc`),
MicronutrientsCard (`getMicronutrientsToday`).

Not mine, unchanged and still working: LoginScreen (`login`), SetupWizard
(`getProfileMeta`, `putProfile`), TodayTab (`getCurrentPlan`, `getDiary`,
`logPlannedDiary`, `addDiaryEntry`, `deleteDiaryEntry`, `postWeighin`,
`deleteWeighin`), PlanTab (13 methods), TrainingTab (3), BrainChat (2),
BodyFatPicker (`putProfile`).
