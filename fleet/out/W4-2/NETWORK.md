# W4-2 — ZERO-NETWORK VERIFICATION

**Ground rule** (`fleet/PROMPT.md:18`): *"Zero API cost in harnesses: `BRAIN=off` everywhere; a harness making an LLM/network call is itself a P0 finding."* Note the rule's scope: **harnesses**.

## VERDICT

**No harness made an LLM or network call — CONFIRMED, on four independent lines of evidence.**
**No P0.** One **P1-latent** hazard (a live API key is present in harness process env), one scope correction (six research agents *did* use the network, via their own tools, which the rule does not cover), and one thing this method cannot close.

---

## Method — and the gotcha that voids the lazy version of it

All content searches used **`grep -a`** (binary-safe), never plain ripgrep or the Grep tool. This was necessary, not defensive. NUL bytes confirmed by byte-scan: `backend/src/lib/dietaryFilter.js` (3), `backend/scripts/qc/fuzz.mjs` (1), `backend/tests/librarySync.test.js` (1). Demonstrated failure on this tree: the Grep tool searching `fuzz.mjs` for `fetch\(` returns *"binary file matches"* **with no lines**; `grep -a` finds it at `backend/scripts/qc/fuzz.mjs:129`. `git grep` also degrades to a content-free "Binary file … matches". **Every negative network claim made about those three files by plain grep is void.**

Scope swept: 15 scripts in `backend/scripts/qc/`, 75 `.mjs/.cjs/.js` under `fleet/out` + `fleet/scratch`, 10 files in `docs/surgery/CAMPAIGN/solver-brain/A1/rig/`, and every product module that can open a socket.

---

## 1 · Static — only five modules can reach the network, and all are gated

| Module | Network line | Guard |
|---|---|---|
| `backend/src/lib/brain/llm.js` | `:6` `require("@anthropic-ai/sdk")`, `:64-65` `new Anthropic(...)` | `llm.js:90` — `if (process.env.BRAIN !== "on") return false;` inside `isBrainEnabled()`. Client construction is **lazy**, so importing opens nothing. |
| `backend/src/lib/aiRecipeClient.js` | via `brain/llm.js` | `brain/governance.js:81` → same gate |
| `backend/src/lib/brainRelayConfig.js` | `:194` `fetch(.../healthz)` | `:171` `if (isBrainEnabled())` |
| `backend/src/lib/usdaClient.js` | `:80` `fetch(...)` | route-only; **no harness imports it** |
| `backend/src/lib/openFoodFactsClient.js` | `:222` `fetch(...)` | route-only; no harness imports it |
| `backend/src/lib/recipeImporter.js` | `:56` `fetch(url)` | route-only; no harness imports it |

`mealSolver.js`, `mealRouter.js`, `planContext.js`, `weeklyPlanner.js`, `macroCloser.js` contain **no network primitives**. The solver's only door to a model is a lazy require behind the gate:

```
backend/src/lib/mealSolver.js:518   const { isBrainEnabled, reviseDayWithCritic } = require("./brain/index.js");
backend/src/lib/mealSolver.js:519   if (isBrainEnabled()) {
```

**Reachability, measured:** exactly one fleet-adjacent script references a network-capable module — `backend/scripts/qc/fuzz.mjs:83,222,224` POSTs `/api/brain/chat` against **its own Express app on `http://127.0.0.1:<ephemeral>`** (`:161-163`), deliberately asserting the route degrades calmly with `BRAIN=off`. `fuzz.mjs` and `securityFuzz.mjs` **were not run by this fleet** — their outputs in `docs/qc/` are all dated 2026-07-22…24, before the fleet window. No `axios`, `node-fetch`, `undici`, `WebSocket`, `net.connect`, `dns.*`, `curl` or `Invoke-WebRequest` anywhere in harness code. All `child_process` use is local: `execFileSync("git", …)` for provenance and `spawnSync(process.execPath, …)` to fan out node subprocesses.

## 2 · `BRAIN=off` per harness, plus in-process traps

Every harness that imports `mealSolver` sets `BRAIN` in-process before the first solve: `dayDump.mjs:57`, `runSolve.mjs:31`, `mc.mjs:66`, `personaPlan.mjs:18`, `leakSweep.mjs:68`, `A1/rig/runRig.mjs:66`, `A1/rig/poolGap.mjs:38`, plus the per-agent scripts (`W1-3/adjusterFoods.mjs:13`, `W1-4/{d6,e6}.mjs:8`, `W1-4/repro.mjs:11`, `W3-3/probe.mjs:27`, `W4-1/dayDumpAlt.mjs`, `W1-6/runRich.mjs:21`, `W3-2/b4`, `W3-4/runTrim`, `W3-5/effm`, `W3-6/coverage`, `W3-7/safetyProbe`).

The inverse was checked too: 19 fleet scripts mention the solver **without** setting BRAIN — none of them actually `require`/`import` `mealSolver`; they are JSONL scorers, patch generators and analyzers.

Belt on top of braces — several harnesses replace the network primitives with throwing traps and count them: `dayDump.mjs:342-347` (also `delete process.env.ANTHROPIC_API_KEY`), `leakSweep.mjs:441-444`, `mc.mjs:111-114`, `W3-3/probe.mjs:346`, `W1-4/repro.mjs:367-371`, `W3-2/b3.mjs:58`, `b4.mjs:71`, `W3-5/effm.mjs:147`. Non-zero exits are wired: `dayDump.mjs:735`, `leakSweep.mjs:773`, `mc.mjs:256` `process.exit(1)` if `netCalls > 0`.

## 3 · Evidence from the run, not just from the code

- **Brain-header census.** 348 `.jsonl` under `fleet/**` + `docs/surgery/**`, first line parsed. **285 carry a `brain` field; 285 of 285 are `"off"`. Zero exceptions.** Restricted to `fleet/out/**`: 32 of 32 `off`. The 63 without the field are per-row schemas, not run headers (`K2c/poolgap-rows.jsonl`, the `mc-*/failures.jsonl` pairs, 57 pre-fleet `docs/surgery/**` artifacts). `fleet/scratch/W1-6/raw/rich-on-*.jsonl`'s "on" is **macroCloser**-on, not brain-on (`W1-6/runRich.mjs:21` sets `BRAIN="off"`).
- **netCalls counters.** 134 occurrences across `fleet/out/**` `.md` + `.json`. **Every one is 0** — `"networkCalls":0` (×11, incl. `fleet/out/T-2/provenance.json:81`), `network calls 0` (×61), table form (×55), `"networkCallsAttempted":0` (×3), `"networkCallsPerRun":0` (`fleet/out/W1-2/BASELINE.json:13`). No non-zero value exists anywhere.
- **DB ledger.** 23 SQLite files (`backend/prisma/dev.db` + 22 scratch copies) queried read-only with `node:sqlite`. `BrainSolveRun` 0, `BrainConversation` 0, `BrainMessage` 0, `GeneratedRecipe` 0 in all 23. `LlmUsage` **14 rows in all 23**, newest `createdAt` = **2026-07-30T03:01:18.734Z**. The fleet window from file mtimes is **2026-07-31T11:53Z → 2026-08-03T04:16Z**, so the newest LLM row **predates the fleet by ~32 hours** and is attributable to the previous campaign (`claude-sonnet-5 / recipe-drafts / $0.053274`, matching `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/brain-cohort.jsonl`). **No LLM row was created during the fleet window in the shared DB or in any isolated copy.**
- **Hooks/settings.** `.claude/hooks/guard-bash.js` is a git-safety denylist, not a network guard. `.claude/settings.json` permits only loopback curl. **The zero-call claim rests on code gates + in-process traps, not on sandbox enforcement.**

---

## FINDINGS

### P1-latent — the live API key is in the harness environment before BRAIN is set

`backend/.env:15` holds a real 108-char `sk-ant-…` key and `backend/.env:20` is **`BRAIN=on`**. `import "dotenv/config"` is hoisted above the module body, so in `mc.mjs` (`:18` vs `:66`), `fuzz.mjs` (`:11` vs `:30`), `personaPlan.mjs` (`:11` vs `:18`), `securityFuzz.mjs` (`:15` vs `:33`), `sweep14k.mjs:14`, `integritySweep.mjs:20`, `recipeAllergenAudit.mjs:13` — **`BRAIN=on` and the real key sit in `process.env` for a window before the harness overwrites BRAIN.**

It did not fire, for two reasons that are correct but incidental: `isBrainEnabled()` reads `process.env` at **call** time (`llm.js:90`), never at import time; and the solver's brain require is lazy. `dayDump.mjs:347` is the only harness that also scrubs the key. `backend/.env.qc` shows the right pattern — `BRAIN=on` but `ANTHROPIC_API_KEY=` empty and `ANTHROPIC_BASE_URL=http://127.0.0.1:1` (dead port).

**Fix:** move `process.env.BRAIN="off"` into a tiny module imported first, or drop `dotenv/config` from qc scripts entirely.

### Scope correction — six agents *did* use the network, and that is not a rule violation

`fleet/out/W2-1` … `W2-6` are literature-sweep agents; their artifacts carry 33–63 external URLs each (arxiv, PMC, openreview, github). Every other agent directory (`W1-*`, `W3-*`, `W4-1`, `T-2`, `T1-allergen`, `K2c`, `P0postfix`, `food-records`) contains **zero** URLs. That is WebSearch/WebFetch by the agent, not by harness code, and carries no `ANTHROPIC_API_KEY` cost — but **"the fleet made zero network calls" full stop would be false**, and W5 should not write it that way.

### Observation — the shared DB changed mid-fleet

`dbSha256` moved `d9037dce…` (W1-2 headers, 2026-07-31) → `fb67a37f…` (`T-2/provenance.json:5`, 2026-08-02); `backend/prisma/dev.db` mtime 2026-08-02T03:44Z. `LlmUsage` (14) and `GeneratedRecipe` (0) are unchanged across it, so **the mutation was not an LLM write** — most likely the `food-records` work plus the `plan_verdict_persistence` migration. Numbers measured against the two SHAs are not interchangeable. (W4-2's own placement sweep resolves recipes against a byte copy of `d9037dce` for exactly this reason.)

### Doc drift (cosmetic)

`fleet/out/W1-6/FINDINGS.md:329` cites `BRAIN=off` at `runRig.mjs:37`; on this tree the statement is `docs/surgery/CAMPAIGN/solver-brain/A1/rig/runRig.mjs:66`. Claim true, line cite stale.

---

## What this method cannot rule out

1. **No OS-level egress evidence** — no packet capture, firewall, proxy or DNS log. The proof is *"the code cannot call and the ledger has no row"*, not an observation of the interface.
2. **Pre-trap window** — `dayDump.mjs` installs traps at `:342`, after Prisma warms at `:331-335`. Nothing in that window imports a network module, but the counter is not proof for that interval.
3. **Deleted artifacts** — the census reads only files present now. A run whose JSONL was deleted leaves no trace.
4. **`LlmUsage` is written by the app's own ledger.** A call made outside `governedModelCallOrThrow` — a bare `curl`, or a since-deleted scratch script using the SDK directly — would bill Anthropic without producing a row. **The one remaining hard cross-check is the Anthropic Console usage page for 2026-07-31 → 2026-08-02**, which no agent here can read. If the owner wants this closed to certainty, that is the step.
5. **Package internals** — `@anthropic-ai/sdk` was not audited for load-time side effects; only `llm.js`'s deferred client construction was verified.
