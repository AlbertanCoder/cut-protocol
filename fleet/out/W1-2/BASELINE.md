# W1-2 — THE BASELINE

*Persisted by the orchestrator (subagent harness blocks report-file writes). Machine artifacts on disk: `daydump-route-s{424242,20260730,8675309}.jsonl`, `daydump-rigshape-s424242.jsonl`, `scoreRulers.mjs`, `scored.json`, `analyze.mjs`, `analysis.json`, `BASELINE.json`. Committed `e890c3b`.*

**Provenance.** DB `d9037dce…b623a1` (14,151 Food / 910 Recipe, fingerprint `b961ac3afbdf3f53`) · personas `e564b1dd…`, 250 rows · git `8cd1480`, **working tree clean** · `BRAIN=off`, **network calls 0 in all 4 runs** — trapped at `dayDump.mjs:341-346` (`https.request/get`, `http.request/get`, `globalThis.fetch` replaced with throwing counters; **not assumed**) · instrument checks `disagree 0 · drift>1 0 · missing-food 0 · crashes 0` · **31 s wall-clock per full-fleet run**.

**Reproduction of W1-1 is byte-exact:** 640/640 identical records, 0 verdict flips, all three seeds and both pool shapes — *despite a different git SHA and a clean-vs-dirty tree.*

## 1. THE HEADLINE TABLE

**Ruler A** = shipping `dayTolerance` (`mealSolver.js:229`). **Ruler D** = floors: kcal + protein as A · **fat ≥ round(0.30×lbmLb)** hard, no ceiling · **carb ≥ carbLo**, no ceiling · **keto carb ceiling (30 g) retained.**

Ruler A recomputed from stored macros matches the solver's stored booleans on **2,560/2,560 records, 0 mismatches**. LBM reconstructed from `personas.jsonl` and **proven exact on every record** (`round(lbm·1.14)==proteinLo && round(lbm·1.25)==proteinHi`, 0 failures).

### Route shape (production, `applyFilterStack` ON)

| seed | denominator | n | **Ruler A** | **Ruler D** | unjudged (sat) |
|---|---|--:|--:|--:|---|
| **424242** | planned | 640 | 435 = **68.0%** | 488 = **76.3%** | 17 (16) |
| | planned−degenerate | 639 | 435 = 68.1% | 488 = 76.4% | 16 (16) |
| | judged | 623 | 435 = 69.8% | 488 = 78.3% | 0 |
| | **satisfiable-planned** | **553** | 415 = **75.0%** | 464 = **83.9%** | 16 (16) |
| | satisfiable-judged | 537 | 415 = **77.3%** | 464 = **86.4%** | 0 |
| **20260730** | planned | 640 | 439 = 68.6% | 487 = 76.1% | 17 |
| | **satisfiable-planned** | **553** | 418 = **75.6%** | 463 = **83.7%** | 16 |
| | satisfiable-judged | 537 | 418 = **77.8%** | 463 = **86.2%** | 0 |
| **8675309** | planned | 640 | 433 = 67.7% | 485 = 75.8% | 17 |
| | **satisfiable-planned** | **553** | 413 = **74.7%** | 461 = **83.4%** | 16 |
| | satisfiable-judged | 537 | 413 = **76.9%** | 461 = **85.8%** | 0 |

### Rig-comparable arm (`--nostack`, seed 424242)

| denominator | n | Ruler A | Ruler D |
|---|--:|--:|--:|
| planned−degenerate | 639 | 437 = **68.4%** | 488 = 76.4% |
| **judged** | **623** | **437 = 70.1%** ← the brief's headline, byte-exact | 488 = 78.3% |
| satisfiable-judged | 537 | **417 = 77.7%** ← the brief's upper endpoint, byte-exact | 464 = 86.4% |

Route vs rig, paired at the same seed: **80/640 records changed content**, discordant **b=7 c=9**, |b−c| = 2 vs A5 floor 7.84 ⇒ **does not clear detection**; level Δ +0.31 pt. Confirms K2c. **Comparable for a level, never paired day-by-day.**

### Ruler A → D flip census (all planned days)

| seed | both pass | A-pass/D-fail | A-fail/D-pass | both fail |
|---|--:|--:|--:|--:|
| 424242 | 420 | **15** (all `carb<carbLo`) | **68** (fat 39, carb 26, both 3) | 137 |
| 20260730 | 419 | 20 (all carb) | 68 (fat 41, carb 24, both 3) | 133 |
| 8675309 | 413 | 20 (19 carb, **1 fat<essential**) | 72 (fat 43, carb 27, both 2) | 135 |

**D is not simply looser.** It removes the fat and non-keto carb *ceilings* (+68…72 days) but tightens the carb *floor* — A grants a −0.25·carbMid low-side slack that D does not (−15…20 days). **Across 1,920 route records only 1 day ever fell below the essential-fat floor.**

## 2. Per-diet split (route, seed 424242)

| diet | personas | A sat-judged | D sat-judged | A planned | D planned |
|---|--:|--:|--:|--:|--:|
| none | 125 | 243/275 = 88.4% | 248/275 = 90.2% | 257/293 = 87.7% | 265/293 = 90.4% |
| vegan | 30 | 20/35 = 57.1% | 30/35 = **85.7%** | 20/90 = 22.2% | 30/90 = 33.3% |
| vegetarian | 23 | 36/57 = 63.2% | 56/57 = **98.2%** | 37/65 = 56.9% | 58/65 = 89.2% |
| keto | 18 | 33/47 = 70.2% | 32/47 = **68.1% ↓** | 35/60 = 58.3% | 34/60 = 56.7% |
| mediterranean | 20 | 44/49 = 89.8% | 45/49 = 91.8% | 45/50 = 90.0% | 46/50 = 92.0% |
| kosher | 12 | 17/35 = 48.6% | 23/35 = 65.7% | 18/36 = 50.0% | 24/36 = 66.7% |
| paleo | 13 | 10/24 = 41.7% | 18/24 = **75.0%** | 10/25 = 40.0% | 18/25 = 72.0% |
| halal | 7 | 12/12 = 100% | 12/12 = 100% | 13/13 = 100% | 13/13 = 100% |
| carnivore | 2 | 0/3 = 0% | 0/3 = 0% | 0/8 = 0% | 0/8 = 0% |

**Keto is the only diet Ruler D makes worse** (−2.1 pts): its ceiling is retained by construction and its carb floor (`KETO_CARB_LO_G` = 10 g) is exact under D but has −5 g of slack under A.

⚠️ **Do not A/B on a per-diet cell.** Cross-seed spreads: vegan **14.3 pts** on n=35, kosher 8.6, paleo 8.3. Only `none` (n=275, spread 0.4) is stable.

## 3. Aggregation semantics — six live denominators

| n | name | membership rule | what it hides |
|--:|---|---|---|
| **640** | `planned` | every record dayDump emits | nothing; the ceiling |
| **639** | `planned−degenerate` | minus the 0-slot config (p233) | the rig's all-planned n |
| **623** | `judged` | `slotsFilled > 0` (`schema.mjs:83`) | **17 days**: 16 satisfiable total failures (p005 ×7, p018 ×5, p115 ×4) + p233 |
| **554** | `satisfiable-planned` | `tier != IMPOSSIBLE` | includes the non-solve degenerate day |
| **553** | **`satisfiable-planned − degenerate`** | above, minus p233 | **nothing. RECOMMENDED CANONICAL** |
| **537** | `satisfiable-judged` | `judged ∧ tier != IMPOSSIBLE` | the 16 total failures — **A6's hole** |

All verified to reconcile: `planned = judged + unjudged`; `planned = satisfiable-planned + impossible`; `satisfiable-planned = satisfiable-judged + unjudged-sat + degenerate`.

| published | what it actually is | comparable? |
|---|---|---|
| **70.1% = 437/623** | rig shape, s424242, **`judged`** | **Yes — byte-exact.** But the brief labels it "all-planned-days", which it is **not**. All-planned = 437/639 = **68.4%** (rig) / 435/640 = **68.0%** (route). |
| **77.7% / 77.3% / 77.8%** | `satisfiable-judged` | **Yes — all byte-exact.** |
| **405/578** | 578 is not a denominator on this tree | **No.** Different DB. |
| **495 / 502 / 526 / 536** | pre-repair DB / earlier population | **No.** None reproduce. |

> **The A4 rule was broken twice INSIDE this fleet:** (a) the brief prints a `judged` count under an "all-planned" label; (b) **W1-5 publishes "0 of 232" for F1 where the satisfiable population is 218** — 232 is `250 − 18`, a self-referential denominator. **Correct statement is 0 of 218.**

## 4. Cross-seed variance — adjudicating A2

| cell | s424242 | s20260730 | s8675309 | **spread** |
|---|--:|--:|--:|--:|
| A / planned (640) | 68.0 | 68.6 | 67.7 | **0.94 pt** |
| A / satisfiable-planned (553) | 75.0 | 75.6 | 74.7 | **0.91 pt** |
| A / satisfiable-judged (537) | 77.3 | 77.8 | 76.9 | **0.93 pt** |
| D / satisfiable-judged (537) | 86.4 | 86.2 | 85.8 | 0.56 pt |

**W1-1 is right, the brief is wrong — and here is *why*.** On the shipping ruler the spread is **0.9 pt on every denominator**. The brief's 0.4–0.5 figure is exactly what a *looser* ruler yields (**Ruler D measures 0.47–0.56**). **Seed noise concentrates in the days sitting on the fat/carb ceilings — remove the ceilings and half the variance disappears.** Anyone quoting ±0.5 pt noise against a ruler-A number understates it by 2×.

Practical A/B floor on **n=553**: b+c=20 needs **1.58 pts**; b+c=40 needs **2.24 pts**; b+c=60 needs **2.74 pts**. With 0.9-pt seed noise, **treat anything under ~3 pts on a single seed as unmeasured.**

## 5. Claim A3 — stored baselines, operationally

Four runs at git `8cd1480` (clean) vs W1-1's four at `750e2ae` (dirty, 78-line diff) → **640/640 byte-identical, 0 flips, ×4 pairings.**

1. **The instrument is exactly deterministic.** A stored baseline reproduces iff `dbSha256` + `foodFingerprint` + `personasSha256` + `poolShape` + solve-relevant source are unchanged. Elapsed time and commit SHA are irrelevant.
2. **But you cannot certify that cheaply.** `scoreDays.mjs` exits **3 — WORKING TREE MISMATCH**, because it cannot know whether the diff touched the solver. **A false positive here, and still the correct default.**
3. The brief's 514/639-changed evidence was measured across a **DB repair** — substrate change, not baseline rot.
4. **Cost of compliance is trivial: 31 s per run; 93 s for 3 seeds; 3.1 min for a full 3-seed paired A/B. There is no budget argument for reusing a stored baseline.**

**Verdict: CONFIRMED as policy, ADJUSTED as mechanism.**

## 6. Claim F1 — reconciled

| cohort | personas | planned days | in-band A | in-band D | personas w/ 0 in-band days |
|---|--:|--:|--:|--:|--:|
| W1-5's `aboveMax_gate` | **18** | 54 | **0** | **0** | **18/18** |
| above pool max on nominal pMid | 22 | 64 | 0 | 9 | 22/22 |
| …of those, `tier != IMPOSSIBLE` | **4** | 10 | **0** | **9** | 4/4 |
| IMPOSSIBLE tier NOT one-macro-infeasible | 14 | 32 | **20 = 62.5%** | 24 | 4/14 |
| all IMPOSSIBLE | 32 | 86 | 20 = 23.3% | 24 | 22/32 |
| **all satisfiable** | **218** | **554** | **415** | **464** | **31/218** |

- **The 18 are confirmed from the metric side, independently of W1-5's method:** 54 planned days, **zero in band under either ruler**, 18/18 personas with no compliant day. All 18 are IMPOSSIBLE-tier ⇒ **they contribute exactly 0 of the satisfiable-only gap.** F1's *consequence* holds.
- **W1-5's denominator is wrong: publish 0 of 218, not 0 of 232.**
- **The brief's "248/250 expressible" is REFUTED.** A demanded density above the pool's single-recipe maximum cannot be met by any convex combination — that is a *proof* of infeasibility, not an estimate.
- **4 satisfiable personas exceed pool max on the nominal ask** (10 days, 0 in band under A but **9/10 under D**) — they fail on the fat/carb *ceilings*, not on protein reach. ≤1.8 pts, and mis-attributed if called infeasibility.
- ⚠️ **"IMPOSSIBLE" is a persona-generator label, not a proof.** 14 of 32 are not one-macro-infeasible and pass **20 of 32 days = 62.5%** — better than the fleet average. **10 of 32 IMPOSSIBLE personas produce at least one fully compliant day.** Still the right exclusion (it is the only pre-registered one), but **nobody should describe the tier as "proved impossible."**

## 7. Canonical artifacts

```
CANONICAL DUMP:  fleet/out/W1-2/daydump-route-s424242.jsonl     640 records, 3.25 MB, schema fleet/W1-1/day/v2
REPLICATES:      fleet/out/W1-2/daydump-route-s{20260730,8675309}.jsonl
RIG ARM:         fleet/out/W1-2/daydump-rigshape-s424242.jsonl   (reconciliation only, NEVER paired day-by-day)
DUAL-RULER:      fleet/out/W1-2/scoreRulers.mjs -> scored.json
CENSUS/F1/A3:    fleet/out/W1-2/analyze.mjs     -> analysis.json
HEADLINE:        fleet/out/W1-2/BASELINE.json
```

```bash
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=424242 --label=route --agent=W1-2 --out=fleet/out/W1-2/daydump-route-s424242.jsonl
node fleet/out/W1-2/scoreRulers.mjs fleet/out/W1-2/daydump-route-s424242.jsonl --json=out.json
node backend/scripts/qc/scoreDays.mjs fleet/out/W1-2/daydump-route-s424242.jsonl
```

**Ruler D was NOT added to the shared `scoreDays.mjs`** — other fleet agents may be invoking it concurrently. `scoreRulers.mjs` is a standalone drop-in implementing A and D as pure functions (~15 lines each) for W3-1 to lift. `lbmLb` is not on the record; it is reconstructed from `personas.jsonl` and **proven exact**, refusing rather than guessing on failure.

## 8. Free intelligence for other lanes

**W1-3 (claim B1).** On the 537 real satisfiable solves at s424242, per-macro failure sides:

| macro | failures | **over** | **short** |
|---|--:|--:|--:|
| fat | 82 | **82** | **0** |
| carb | 55 | 50 | 5 |
| kcal | 31 | 30 | 1 |
| protein | 3 | — | 3 (one-sided by construction) |

**Fat failure is 82 over / 0 short — perfectly one-sided.**

**W3-1.** Ruler D buys **+9.1 pts** on satisfiable-judged (77.3 → 86.4) and **+8.9** on satisfiable-planned. That is **2× W1-1's `fatwide:0.5` re-grade (+5.0) and >2× the brief's A15 cap (+4.0)** — because D drops the fat *and* non-keto carb ceilings simultaneously. **Not a free lunch:** costs 15–20 days on the carb floor and makes **keto worse (−2.1)**. 8.9 is the net.

**W1-4.** `honesty.declared === false` count is **1** in every route run — p233, the 0-slot degenerate day (pool 494, so not a pool problem). Reproduces A6+.

## 9. BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **A1** | 70.1% "all-planned", 437/623; 405/578 | **437/623 = 70.1% byte-exact** — but 623 is `judged`. All-planned = **68.4%** rig / **68.0%** production. 405/578 not reproducible | **ADJUSTED** — number right, denominator label wrong |
| **A2** | 77.3–77.7%, spread 0.4–0.5 | Level **byte-exact at both endpoints**. Spread on the shipping ruler is **0.9 pt on every denominator**; 0.4–0.5 is what **Ruler D** yields. On the honest denominator (553) the level is **74.7–75.6%, 2.3 pts below** the published figure | **CONFIRMED (level) / ADJUSTED (spread ×2)** |
| **A3** | stored baselines invalid; 514/639 changed | Re-run at a different SHA reproduced **640/640, 0 flips**, ×4. Staleness comes from substrate change, not time. **31 s/run — no budget excuse** | **CONFIRMED (policy) / ADJUSTED (mechanism)** |
| **A4** | 5 denominators | **Six** live: 640 · 639 · 623 · 554 · 553 · 537. **Re-offended twice inside this fleet** | **CONFIRMED**, and violated again |
| **F1** | 248/250 expressible ⇒ ≈0 pts | 18 confirmed from the metric side: 54 days, **0 in band under either ruler**. **0 of 218** satisfiable (not 232). **"248/250" REFUTED.** 4 satisfiable exceed nominal pool max ⇒ ≤1.8 pts. **"IMPOSSIBLE" is a label, not a proof** — 10 of 32 produce a compliant day | **ADJUSTED** — consequence CONFIRMED, premise REFUTED |

`git status --porcelain -- backend/src frontend/src` → empty. No push. No `-f`/`-F`. **Blockers: none.**
