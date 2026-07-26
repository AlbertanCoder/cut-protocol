# Vision Gap — Phase 0 ground truth

Date: 2026-07-26 · Branch `fix/audit-remediation` @ `bd61418`
Method: read-only inspection + one reproduction against the live database.
Nothing in this document is a self-certified claim; every line carries a
`file:line`, a command, or an observed output.

---

## ROOT CAUSE, IN ONE SENTENCE

**The Library→Brain router already exists and already works, but it is only
reachable through `aiFallback`, and `aiFallback` is set in exactly one place —
the legacy one-shot swap endpoint (`plans.js:626`) — so `POST /generate`, the
button the owner actually presses, never invokes it.**

Not a missing feature. A missing argument.

---

## 0.1 PRESERVE — the prompt's premise was stale

| Claim in the prompt | Observed |
|---|---|
| "~295 uncommitted files on `fix/audit-remediation`" | **0 uncommitted files.** `git status --short` returns empty. |

The tree was committed over the course of the preceding session (commits
`dd12256` → `bd61418`). There was nothing to rescue.

**A real risk did exist, and was addressed:** 25 commits are ahead of
`origin/master` and existed only on this machine, which lost power earlier
today. Created `brain-alive-backup-20260726-1516.bundle` (9.8 MB) at the repo
root. That is a local artifact, not a push — stop-gate 1 untouched.

---

## 0.2 TRANSPORT HIJACK — real, but scoped to the packaged app only

The prompt named this root-cause candidate #1 and instructed: unset the relay
vars for local dev. **That instruction is a no-op, because dev has no relay
vars to unset.**

Measured by resolving the transport the same way `client()` does, in each mode:

| Mode | userData | `brain.json` | Transport actually selected |
|---|---|---|---|
| Dev (`npm start`) | `%APPDATA%\cut-protocol-desktop` | absent | **DIRECT KEY → api.anthropic.com** |
| Packaged | `%APPDATA%\Cut Protocol` | present | **RELAY → `http://127.0.0.1:8787`** |

The two dirs differ because Electron uses package `name` in dev and
`build.productName` when packaged (`electron/main.cjs:44-52`).

So in dev the funded key is used and the brain is reachable. **Phase 1.5's live
smoke is not blocked.**

The hijack is nevertheless real in the packaged app, and I caused it, by two
decisions in the preceding session that are each defensible alone:

- `dd12256` — relay wins over a direct key, so a stray `ANTHROPIC_API_KEY`
  cannot silently bypass the relay's authoritative spend caps.
- `b68c132` — `CUT_PROTOCOL_USERDATA` is set in dev as well as packaged, so the
  Settings card is testable without building an installer.

Together: the packaged app reads `brain.json`, selects the relay, and the relay
was not running (the owner closed its terminal window). Reproduced:

```
!! runToolLoop THREW: Error: Connection error.
```

**Ticket P1-A:** the packaged app reports this as *"I couldn't put that together
right now"* (`brain/chat.js:164`) rather than "your relay isn't running". A
`relay-unreachable` status already exists (`brainRelayConfig.js`) and the chat
path does not consult it. `chat.js:160` is `catch { }` with no binding — it
discards the error object entirely, which is why this took a reproduction script
to identify rather than a log line.

---

## 0.3 CALL GRAPH — the expected conclusion is WRONG

> The prompt: *"The expected conclusion — verify, don't assume: no path exists
> from 'generate meals' to 'brain designs/fixes a meal.'"*

**A path exists.** It is built, it is the documented production default, and it
is not reached.

### LLM entry points (every file in `backend/src/` that can reach a model)

| File | Reaches a model via |
|---|---|
| `src/lib/brain/llm.js` | the SDK directly — the single transport |
| `src/lib/aiRecipeClient.js` | recipe drafting |
| `src/lib/brainRelayConfig.js` | `/healthz` probe only (no model) |

### The router that already exists

`src/lib/mealRouter.js` — **478 lines**, header at `mealRouter.js:1-30`. Its
documented order is V8 almost verbatim: POOL (`filterRecipePool`, not a fork) →
CACHE (fingerprint) → LIBRARY (full scan) → BRAIN (only now, through
`governedModelCall`) → VERIFY (re-checked in code) → CACHE IT → DEGRADE.

### How it is wired

- `weeklyPlanner.js:453` — `require("./mealRouter.js").routeMealSlot` is the
  **production default** inside `tryAiFallback`.
- `tryAiFallback` only runs when `aiFallback` is non-null (`weeklyPlanner.js:403`).

### Where `aiFallback` is set

`grep -n aiFallback src/routes/plans.js` returns **exactly one line**:

```
626:      { aiFallback: { enabled: true, maxCalls: 1, profile } }
```

That is inside `POST /:planId/slots/:slotId/swap` (`plans.js:615`), whose own
comment reads:

```
// Legacy one-shot swap (kept for compatibility; the UI now prefers
// alternates → apply).
```

`POST /generate` (`plans.js:155`) passes **no** `aiFallback`. Neither do
`/day-options` (357), `/accept-day` (395), or `/alternates` (451).

**Conclusion:** the brain can only design a meal if the user hits a legacy
endpoint the UI has moved away from — and even then, capped at `maxCalls: 1`.

### The other brain seam

`mealSolver.js:518` lazily requires `reviseDayWithCritic` and calls it at 534
when `isBrainEnabled()`. That is the *critic* (proposes constraints for one
bounded re-solve), not a designer. It cannot fill a gap or create a recipe.

---

## 0.4 LEDGER TRUTH

```
LlmUsage rows: 0
```

Read-only query against `%APPDATA%\Cut Protocol\cutprotocol.db`. All five brain
tables exist (`LlmUsage`, `BrainPreference`, `BrainConversation`,
`BrainMessage`, `BrainSolveRun`) — so this is not a missing-migration problem.

Zero rows is consistent with 0.3: no solve path has ever reached a model.

---

## 0.5 APP-AS-A-USER — deferred, and why

Not yet walked. Two of the four reported symptoms are already explained above
without needing the walk (the "AI unavailable" error and the dead endpoint), and
the remaining beats are cheaper to assess once Phase 1 changes what the generate
path does. Recorded as an open ticket rather than silently dropped.

**Ticket P1-B:** walk V1–V12 in the running app at 1920×1080 and 1280×720,
screenshot each beat, before Phase 2 lanes begin.

---

## PER-BEAT STATUS (provisional — full walk is P1-B)

| Beat | Status | Evidence |
|---|---|---|
| V8 — the brain in the loop | **EXISTS-BUT-UNREACHABLE** | `mealRouter.js` (478 lines) wired at `weeklyPlanner.js:453`; `aiFallback` set only at `plans.js:626` |
| V8.5 — `BRAIN=off` byte-identical | **WORKS** | golden `sha256 c42a3b23…d420b`, unchanged across 6 commits |
| V9 — five filters | **UNVERIFIED** | `mealRouter.js` claims pool-filter reuse; not yet independently re-verified |
| V11 — progress UX | **UNVERIFIED** | `GenerationProgress` referenced in the prompt; not yet walked |
| V1–V7, V10, V12 | **UNVERIFIED** | P1-B |

---

## FIX TICKETS SPAWNED

| ID | Sev | Ticket |
|---|---|---|
| **P0-1** | P0 | `POST /generate` must pass `aiFallback` so the existing router runs during a real generate. Includes deciding `maxCalls` per horizon (1 is wrong for a week). |
| **P1-A** | P1 | `chat.js:160` swallows the error object (`catch { }`); surface `relay-unreachable` and the real cause instead of a generic degrade. |
| **P1-B** | P1 | Full app-as-a-user walk of V1–V12 with screenshots. |
| **P2-1** | P2 | Packaged app + local relay is fragile — a closed terminal silently kills the coach. Either run the relay as a service or defer to the VPS round (Appendix A). |

---

## WHAT I DID NOT DO

- Did not unset relay vars (0.2) — there were none in dev; doing so would have
  been theatre.
- Did not delete or move `brain.json` — the packaged app needs it, and removing
  it would break the coach the owner just got working.
- Did not walk the app (0.5) — deferred to P1-B, recorded above.
