# The Coroner's Report — Cut Protocol brain

**run_id:** autopsy-20260727-0126 · **issued:** 2026-07-27T01:26Z
**Repo:** `C:/Users/<account>/Desktop/cut-protocol` · **branch:** `fix/audit-remediation`
**Scope:** diagnosis only. Nothing was fixed. Two writes were made: one WIP preservation commit, and this folder.

> **Session note.** This session was opened in `C:/Users/<account>` (the home directory), not the
> project root. The `CLAUDE.md` loaded at startup is the quant-pipeline one, not this repo's.
> All work below was done against the repo above by absolute path. Nothing outside it was touched.

---

## 1. The one-sentence root cause

**Ranked. There are three, and they are independent — fixing any one alone still leaves a dead brain.**

1. **In the packaged app — the only build the owner actually runs — every governed AI feature is
   refused before it reaches the network, because `backend/src/lib/brain/governance.js:63` tests for a
   literal `ANTHROPIC_API_KEY` and returns *"AI features are unavailable in this build — no API key is
   configured"*, and a packaged install ships no key by design; the relay that exists precisely to
   replace that key is never consulted, because the relay-aware check sits four lines below at `:68`
   and is never reached.**

2. **The relay the packaged app points at is not running** — `http://127.0.0.1:8787` answers
   ECONNREFUSED — so the one surface that bypasses governance (the chat coach) has no transport
   either, and `llm.js:63`'s documented "RELAY WINS" rule routes it away from the working direct key
   rather than toward it.

3. **The generate→brain path is 10 hours old and has never once executed:** it was created by commit
   `2297f26` (2026-07-26 16:11), and it fires only when a slot survives best-of-5 empty-or-warned
   *and* neither the fingerprint cache nor a full library scan fits it — the `LlmUsage` ledger holds
   zero rows from it, all time.

---

## 2. Symptom map

| | Symptom | Cause | Verdict |
|---|---|---|---|
| **S1** | "AI unavailable" errors | `governance.js:63-64` emits that exact copy. In packaged mode all four registered features (`chat`, `critic`, `classify`, `recipeDrafts`) return `no-api-key` 503 — measured, E5 — while `relayStore.status()` simultaneously reports `{"enabled":true,"reason":"ok"}`. The app tells the UI it is healthy and refuses every call. | **VERIFIED** |
| **S2** | Endless spinner on meal generation | **UNVERIFIABLE — not witnessed** (C7 skipped, see §6). A real latent defect was found and is *not* claimed as the cause: the frontend aborts `generatePlan` at `TIMEOUT.SOLVER` = 45 s (`frontend/src/lib/api.js:124,362`), while one brain draft call is bounded at `DRAFT_TIMEOUT_MS` = 90 s (`llm.js:131-133`) and a week horizon budgets 4 of them, a month 12 (`plans.js:159-162`). A single brain call can outlive the whole client budget. In packaged mode this cannot be the cause — governance 503s instantly rather than hanging. | **UNVERIFIABLE** |
| **S3** | The chat coach responds fine | `brain/chat.js:55` gates on `isBrainEnabled()` **only** — it never calls governance. That is the entire reason S1 and S3 coexist: the coach uses the relay-aware gate, everything else uses the relay-blind one. In dev (live key, direct transport) the coach genuinely works; the ledger holds 12 `chat`+`classify` rows from 2026-07-20/21 proving it really ran. | **VERIFIED** |
| **S4** | Generated meals never change / never hit targets | Three independent reasons, any one sufficient: (a) the generate→brain path has **never fired** — 0 ledger rows, all time; (b) the plan **critic** cannot fire during a generate at all — `mealSolver.js:515` requires `profile`, and the only caller that passes one is `/day-options` (`plans.js:416-17`), never `/generate`; phase `"critic"` has **0 rows ever**; (c) in packaged mode governance 503s the path before any transport. | **VERIFIED** |

---

## 3. Verdict table

| Verdict | Result | Evidence |
|---|---|---|
| **V-TRANSPORT** | mode-dependent: dev = `direct`, packaged = `relay` | E3, E5 (measured by execution) |
| **V-RELAY-VARS** | present (packaged only, via `userData/brain.json`) · reachable **no** | E3 (ECONNREFUSED probe) |
| **V-KEY** | present in `backend/.env`, `"sk-ant-…"`, len 108 — unreachable in packaged mode | E3 |
| **V-ENABLED** | `true` in **both** modes — the flag is not the blocker | E5 |
| **V-WIRING** | **VERIFIED** — a generate→LLM path exists as of `2297f26` | E4, E7 (full raw chain) |
| **V-CRITIC** | **FALSIFIED** — cannot fire in a real generate | E4, E7, E6 (0 `critic` rows) |
| **V-LEDGER** | 13 calls all-time, ~$0.393; **1** outside chat; **0** from the generate path | E6 |
| **V-WITNESS** | skipped · ledger delta 0 | E8 |

**The two gates that disagree — this is the heart of the case:**

```
llm.js:89-92     isBrainEnabled()  →  key OR relay   →  relay-aware  →  true
governance.js:63 llmAvailability() →  key only       →  relay-BLIND  →  503 "no-api-key"
                 (:63 returns before :68 can call isBrainEnabled)
```

---

## 4. The lies — repo claims killed by this run's own artifacts

1. **"LlmUsage = 0 rows"** (`.agent/state.json`) — **FALSIFIED by E6.** The dev DB holds **13 rows**
   (~$0.393). Zero is true only of the *packaged* database. Every downstream conclusion drawn from
   "the brain has never fired" was drawn from a false premise.
2. **"the brain now runs during a real generate"** (commit `2297f26`) — **FALSIFIED by E5 + E6.** The
   *path* was built; nothing shows it *running*. Zero ledger rows have ever originated from it, and in
   packaged mode governance refuses it before any transport is attempted. Wiring a path and running it
   are different claims; the commit message asserts the second and delivered the first.
3. **"there is NO post-selection brain pass"** (`state.json` `rootCause`) — **FALSIFIED by E7.**
   `mealSolver.js:723-731` is exactly that pass. True when written at 22:04Z; superseded 7 minutes
   later at 22:11Z. The file was never updated.
4. **"aiFallback … set only at plans.js:626 (legacy swap)"** (`state.json`) — **FALSIFIED by E7.**
   `plans.js:304` also sets it; the legacy site has moved to `:664`.
5. **"API keys simply absent in a shared build → brain off, app works fully offline"**
   (`PROGRESS.md:59-60`) — **FALSIFIED by E5.** With a `brain.json` present the packaged app reports
   `isBrainEnabled() === true` and `reason:"ok"`. The brain is not off; it is on and broken — which is
   strictly worse, because the UI is told everything is fine.
6. **`.agent/state.json` records `head: bd61418`** — two commits stale (`2eac08f`, `2297f26` landed
   after). Anything reading it as current state is reading a pre-fix snapshot.

**Not a lie, for the record:** `state.json`'s `"$0.00 — no model call has been made in this round"`
is **VERIFIED** — the newest ledger row predates that session by two days.

---

## 5. Evidence index

| id | path | contents |
|---|---|---|
| E1 | `evidence/E1-c0-preserve.txt` | branch, pre/post HEAD, dirty count, 15-commit log |
| E2 | `evidence/E2-agent-state.json` | read-only copy of `.agent/state.json` as found |
| E3 | `evidence/E3-c2-transport.txt` | transport selection code, all 3 env sources (redacted), boot chain, tokenless probe |
| E4 | `evidence/E4-c3-callmap.txt` | the four LLM surfaces, full call map, firing conditions |
| E5 | `evidence/E5-c4-flag-measured.txt` | dev + packaged `isBrainEnabled()` / governance, **measured by execution** |
| E6 | `evidence/E6-c5-ledger.txt` | `LlmUsage` read-only query, both DBs, phase→surface mapping |
| E7 | `evidence/E7-raw-output.txt` | verbatim unedited command output for every load-bearing claim |
| E8 | `evidence/E8-c6-contradictions.txt` | all 9 repo claims adjudicated + C7 witness ruling |

Secrets: no key, token, or URL value appears in any artifact — presence, prefix shape and length only.

---

## 6. What I now know how to fix, and did not touch

Listed so the cage is visible. **None of this was done.**

1. **`backend/src/lib/brain/governance.js:63`** — the relay-blind gate. The `!process.env.ANTHROPIC_API_KEY`
   early-return must become the same relay-aware test `llm.js:91` already uses
   (`ANTHROPIC_API_KEY || relayConfig()`), or move below the `isBrainEnabled()` check at `:68`.
   This single line is what kills all four features in every packaged install. Not touched.
2. **The relay is down.** `127.0.0.1:8787` refuses connections; `brain.json` (written 2026-07-26 10:44)
   still points at it. Either start it, repoint it at the London VPS, or delete `brain.json` to fall
   back cleanly. `clearConfig()` (`brainRelayConfig.js:149`) is the intended kill switch. Not run.
3. **The 45 s / 90 s timeout mismatch** — `api.js:124` vs `llm.js:131` × `plans.js:159-162`. Either
   `generatePlan` moves to `TIMEOUT.LLM`, or the brain pass gets a wall-clock budget that fits inside
   the client's. Not changed.
4. **The critic is orphaned.** `mealSolver.js:515` needs `profile`; `generateBestWeekPlan` and
   `generateHorizonPlan` never accept or forward one. Threading it would make `reviseDayWithCritic`
   reachable from a real generate for the first time. Not threaded.
5. **`.agent/state.json` is stale and wrong** (`head`, the `LlmUsage = 0` finding, the "no
   post-selection pass" root cause). It belongs to another run; per this run's contract I did not
   write to it. Left exactly as found.
6. **The 1-meal horizon never gets `aiFallback`** — `plans.js:208-243` returns before `:304`. Whether
   that is intended or an omission is a product decision, not a bug I may assume. Not changed.

**Also observed, outside the brain, not acted on:** the owner's live packaged app was running
throughout this autopsy (`Cut Protocol.exe`, PID 24548, port 3001). It was never authenticated to,
written to, or restarted.
