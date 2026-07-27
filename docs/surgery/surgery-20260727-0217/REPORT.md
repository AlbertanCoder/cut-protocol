# The Surgeon's Report — Cut Protocol brain, Phase One

**run_id:** surgery-20260727-0217 · **parent:** autopsy-20260727-0126
**branch:** `fix/audit-remediation` · **head before:** `e328d34` → **after:** `5fc7510`
**drift from parent:** none — HEAD matched the receipt exactly at M0.

> **Session note.** This prompt says never to run it in the session that performed the
> autopsy. It was run in that session. I compensated by re-deriving every surgical
> coordinate from the file on disk before cutting (rule 2) rather than from memory —
> which is how M4's premise was caught as false. The session was also opened in
> `C:\Users\<account>`, not the project root; all work used absolute paths.

---

## 1. The mission sentence

> *A real meal generate, witnessed live, produces a NONZERO `LlmUsage` delta from the
> generate path — a brain-designed, engine-verified, cached meal, zero exclusion leaks
> under independent re-verification, inside the client's patience, for ≤ $0.50.*

# NOT-YET.

**`LlmUsage` delta = 0.** A real generate ran against the real endpoint, on a profile
that produced seven genuinely warned slots, with the brain on and the transport
healthy — and no model was called. **Total spend this session: $0.00, zero live calls.**

What the surgery *did* achieve is that the brain is now **reachable**: the gate no
longer refuses it, the relay answers, and the pass demonstrably hands a real gap
target to the router (E6, PROBE 1). What stops it is one rung further down than
anyone had looked, and it is now named exactly (§3).

---

## 2. Before / after, per move

| Move | Before | After | Verdict |
|---|---|---|---|
| **M1 Truth repair** | `.agent/state.json` claimed LlmUsage=0, "no post-selection pass", "aiFallback set only at :626", head `bd61418`; PROGRESS.md:60 claimed keys-absent ⇒ brain off | all four corrected in place, each citing `autopsy-20260727-0126` | **VERIFIED** |
| **M2 The gate** | `governance.js:63` `if (!process.env.ANTHROPIC_API_KEY)` — refused all four features before the relay-aware check at `:68` | `if (!process.env.ANTHROPIC_API_KEY && !relayConfig())` — accepts the same two transports `llm.js:91` does | **VERIFIED** |
| **M3 The clock** | client 45 s (`api.js:362` `TIMEOUT.SOLVER`) vs server up to 12 × 90 s | client 120 s (`TIMEOUT.LLM`); server pass hard-capped 75 s, per-design 35 s | **VERIFIED** |
| **M4 The plumbing** | critic unreachable from generate | **no cut made — premise false** | **UNVERIFIABLE** |
| **M5 The relay** | `127.0.0.1:8787` ECONNREFUSED | relay started, `/healthz` → HTTP 200 `{"ok":true}` | **VERIFIED** |
| **M6 The breath** | 0 generate-path LLM calls, all time | still 0 — swallowing branch identified | **FALSIFIED** |
| **M7 The gauntlet** | — | 110 files, 1482 tests, 0 failures; goldens byte-identical | **VERIFIED** |

**M2 — measured, packaged mode, before → after:** all four features `REFUSED
no-api-key 503` → all four `ENABLED`. That was root cause #1 and it is closed.

**M3 — the arithmetic now closes:** client patience 120,000 ms; brain pass ceiling
75,000 ms (a design is only *started* when the remaining budget covers a whole one,
so the pass cannot overrun); deterministic solve + week writes ~10,000 ms; server
worst case ≈ 85,000 ms — **~35 s margin (29%)**. Confirmed live on the wire: the
router received `timeoutMs: 35000` (E6, PROBE 1).

**M4 — the premise was false, so I did not cut.** The receipt (my own, from the
autopsy) said to forward `profile` into `generateDayCandidates` from
`generateHorizonPlan` and `generateBestWeekPlan`. Those functions never call
`generateDayCandidates` — only `chatPlan.js` and `plans.js:455` (`/day-options`) do.
Threading `profile` would have added a parameter with **no consumer** and changed
nothing. Shipping that and calling the critic "reachable" would have been a lie.
Making it fire needs a *new call site*, which is a behaviour change M4 forbids.

**M7 — the line was stopped once, by my own work.** The first full run failed
`1C purity: mealSolver + weeklyPlanner use no Math.random / Date.now / new Date` —
I had written `Date.now()` into the M3 deadline. That invariant is load-bearing:
a solver that reads an ambient clock is not reproducible and the goldens stop
meaning anything. **The test was right; the design changed.** The clock is now
injected by the route (`plans.js` passes `now: () => Date.now()`), the solver stays
pure, and the invariant test was **not** weakened.

---

## 3. The breath numbers

| | |
|---|---|
| Live LLM calls | **0** |
| Tokens | **0** |
| Dollars | **$0.00** (budget 12 calls / $0.50) |
| `LlmUsage` before → after | 13 → 13 (**delta 0**) |
| Run A (BRAIN=off), week | 14 slots · 0 empty · **7 warned** · 2/7 days in tolerance · 96 ms |
| Run B (BRAIN=on), week | 14 slots · 0 empty · 6 warned · **8,864 ms** · inside the 120 s client budget |
| Router calls made | 1 (PROBE 1, real gap target: 1116 kcal / 87 g protein) |
| Generation rung reached | **0** (PROBE 2) |

**The swallowing branch — `backend/src/lib/mealRouter.js:311-323`, the free library scan:**

```
router status : library-hit      router via : scan
router ok     : true             modelCalls : 0
recipe        : "Skillet Chicken Thighs, Potato & Cucumber" (curated)
scaled        : kcal 1115.41, protein 87.52   ← target was 1116 kcal / 87 g
                proteinScale 0.96, sidesScale 1.69
```

The library answers with a near-exact fit, so execution never reaches generation at
`mealRouter.js:330+`.

**Why the solver and the router disagree — the real finding.** The solver *warned*
that slot ("Tried 5 recipe(s) for this slot, none fit within tolerance") while the
router fits it almost exactly, for two structural reasons: the solver samples ~5
candidates per slot while the router scans all 335 eligible; and the solver scales a
dish by one portion factor (0.5–2×) while the router scales protein and sides on
separate axes. **The gap the solver reports is a search gap, not a library gap.** The
brain is therefore unreachable in practice on warned slots — correctly, by the
cheap-before-expensive design.

Two further findings, recorded and **not** acted on:

1. **A day can miss its macros badly with zero empty and zero warned slots**, and the
   brain pass never sees it: the pass inspects slot-level state only
   (`weeklyPlanner.js:666-671`). Run A's day horizon landed 155 g fat against a
   56–66 g range with 0 warnings.
2. **An honesty defect.** The app tells the user "none fit within tolerance" for a
   slot where a compliant library recipe demonstrably fits. That contradicts the
   constitution's *"solver declares unsolvable + why"* — it declared unsolvable when
   it was not.

Because V-BREATH is falsified, the mission's downstream clauses were never reachable
and are honestly **UNVERIFIABLE**, not passed: engine-verified brain recipe,
independent allergy re-verification, `source:"brain", verified:true` caching, and the
totals law. No brain-designed meal existed to check.

---

## 4. The lies

**Corrected in editable files (M1):**

1. `.agent/state.json` — "LlmUsage = 0 rows" → 13 rows (~$0.393) in dev.db; 0 is true
   only of the packaged DB.
2. `.agent/state.json` — "there is NO post-selection brain pass" → it exists at
   `mealSolver.js:723-731`; the claim was superseded 7 minutes after it was written.
3. `.agent/state.json` — "aiFallback set only at plans.js:626" → also set at `:304`;
   legacy site moved to `:664`.
4. `.agent/state.json` — `head: bd61418` → was two commits stale.
5. `PROGRESS.md:59-60` — "keys absent ⇒ brain off, app fully offline" → true only
   while no `brain.json` exists; with one, packaged reports enabled and then refuses.

**Living in commit history, uneditable — recorded here instead:**

- `2297f26` "feat(brain): **the brain now runs during a real generate**" — it does
  not. The path was built; it has still never run. This session proved that with a
  live witness and a zero ledger delta.
- `2eac08f` "the brain router exists, it is just never called" — true when written,
  superseded 51 minutes later.

**And one of my own, corrected in this report:** the autopsy receipt's M4 bullet
named a forwarding target that does not exist on the generate path.

---

## 5. Deferred debts, by name

- **VPS relay deploy.** The relay runs as a local background process from this
  session (PID 21668, `127.0.0.1:8787`); it dies with the terminal. The durable
  answer is the London VPS. Not done.
- **`status()` still overclaims when the relay dies.** It does not probe on the
  ordinary poll, deliberately (`brainRelayConfig.js:180-186`). Exact fix named in E5:
  return the already-documented-but-unused `"relay-unreachable"` reason
  (`brainRelayConfig.js:168`) from a short-TTL cached probe result. **P1.**
- **`chat.js:55` governance unification.** The coach still bypasses governance
  entirely, gating only on `isBrainEnabled()`. Left alone deliberately (M2 said so).
- **Spinner / progress UX (V11).** Untouched.
- **The 14k allergen sweep.** Not this session's job; the fast suite ran green.
- **`PROGRESS.md:381` "every safety guard proven".** Still unproven by any artifact.
- **The critic's fate.** Needs an authorized new call site (§2, M4).
- **The two new findings in §3** — day-level misses invisible to the pass, and the
  false "none fit within tolerance" warning.

---

## 6. Re-running the witness

Never against port 3001 — that is the owner's live packaged app.

```bash
# 1. relay (only needed for the PACKAGED app; dev uses the direct key)
cd relay
ANTHROPIC_API_KEY=<from backend/.env> RELAY_TOKEN=<relayToken from userData/brain.json> npm start
curl -s http://127.0.0.1:8787/healthz          # expect {"ok":true}

# 2. Run A — the gap, BRAIN=off, $0
cd backend
PORT=3010 BRAIN=off node server.js &
WITNESS_HORIZON=week node <scratchpad>/witness.js "RUN A"

# 3. Run B — the breath, BRAIN=on, budget hard-capped at 1 design
PORT=3010 BRAIN=on BRAIN_MAX_DESIGNS_PER_GENERATE=1 node server.js &
WITNESS_HORIZON=week node <scratchpad>/witness.js "RUN B"

# 4. the only measurement that matters
node -e 'const{DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync("./prisma/dev.db",{readOnly:true});
console.log(db.prepare("SELECT COUNT(*) n FROM LlmUsage").get());'
```

Witness account: `surgery.witness@example.com` (dev DB only). Cost ceiling: one design
is the largest budget that cannot breach $0.50 (worst case sonnet $0.156 + opus $0.260
= $0.416 per slot).

---

## 7. Evidence index

| id | path |
|---|---|
| E1 | `evidence/E1-m0-orient.txt` — HEAD/drift/preserve, live-app port map |
| E2 | `evidence/E2-m2-gate.txt` — gate diff + measured packaged before/after + tests |
| E3 | `evidence/E3-m3-clock.txt` — the arithmetic, the diff, 8 wall-clock tests |
| E4 | `evidence/E4-m4-plumbing.txt` — the falsified premise, no cut made |
| E5 | `evidence/E5-m5-relay.txt` — probe before/after, truthfulness, residual P1 |
| E6 | `evidence/E6-m6-breath.txt` — Run A/Run B, both probes, the swallowing branch |
| E7 | `evidence/E7-m7-gauntlet.txt` — stop-the-line event, full suite, goldens |

No key, token or URL value appears in any artifact — presence, shape and length only.
