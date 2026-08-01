# W1-1 — HARNESS-TRUTH

*Persisted by the orchestrator: the subagent harness blocks subagents from writing report files. Raw JSONL + per-run `.report.md` files are on disk under `fleet/out/W1-1/`. Committed `42712a0`.*

## 0. Provenance

| item | value |
|---|---|
| DB | `dev.db` sha256 `d9037dce…b623a1`; agent copy byte-identical. 14,151 Food / 910 Recipe; food fingerprint `b961ac3afbdf3f53` |
| git | measured at `750e2ae`, committed `42712a0` on `fleet/measure-2026-08` |
| personas | `e564b1dd…57704e`, 250 rows, horizon `{day:185, week:65}`, tiers `{EASY:142, HARD:61, IMPOSSIBLE:32, ROBUSTNESS:15}` |
| seeds | 424242 primary · 20260730 / 8675309 replicates · 1337 smoke |
| ruler | `mealSolver.js:229 dayTolerance` + `:256 dayInTolerance`; constants `:210-213` |
| BRAIN | `off` everywhere · **network calls 0 in all six runs** (trapped and counted, not assumed) |

## 1. Instrument map

| harness | ruler | solve shape | population | drops | verdict |
|---|---|---|---|---|---|
| `qc/runSolve.mjs` (`:46`) | none (raw) | `generateBestWeekPlan` — **no `horizon`, no `adjusters`** | caller's | horizons (74.0% of personas), closer never runs, `applyFilterStack` | **do-not-mix — wrong shape** |
| `qc/oracle.mjs` (`acceptOk` `:194`, consts `:38-39`) | **\|kcalDev\|≤5% AND protein ≥ proteinLo−5 g. No fat. No carb.** | n/a | n/a | fat, carb, keto carb law | **trustworthy-wrong-axis (K3)** |
| `qc/mc.mjs` (`:141`, `:133/:152`) | inherits oracle's 2-macro bar | inherits `runSolve` | `genProfile` — uniform, 13× carnivore | streams **one row per RUN**; fat/carb never reach disk | **do-not-mix** for levels; good crash fuzzer |
| `A1/rig/*` | **product ruler** ✔ | `generateHorizonPlan` + horizon + adjusters ✔ | canonical personas ✔ | `judged` drops 16 days; `applyFilterStack`; 0-slot config emits **no record**; per-slot grams/fat/carb/closer signal | trustworthy for **deltas between its own runs**; three denominator holes |
| **`qc/dayDump.mjs` (NEW)** | product, stamped per record | route-faithful; `--nostack` reproduces rig | canonical personas | nothing needed for a 4-macro re-grade | **trustworthy** |
| **`qc/scoreDays.mjs` (NEW)** | selectable, always named | none (arithmetic on the dump) | — | — | **trustworthy**; exits 4 if stored booleans fail to reconcile |

**Three incompatible rulers are live.** Same 640 days, same seed, satisfiable-only: product **77.3%** · `oracle.acceptOk` **78.2%** · product-minus-fat **86.2%**. They agree within a point on the headline and disagree wildly on *which* days pass. **Never one table.**

## 2. THE INVOCATION downstream agents must use

```bash
# PRIMARY BASELINE — production solve shape (what routes/plans.js:324 does). ~31 s.
BRAIN=off node backend/scripts/qc/dayDump.mjs \
  --seed=424242 --label=route --agent=<ID> \
  --out=fleet/out/<ID>/daydump-route-s424242.jsonl

# REPLICATES — run all three before quoting a level
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=route --agent=<ID> --out=...
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=8675309 --label=route --agent=<ID> --out=...

# RIG-COMPARABLE ARM — skips applyFilterStack; ONLY to reconcile with a published rig number
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=424242 --label=rigshape --nostack --agent=<ID> --out=...

# SMOKE — 25 personas / 55 days, ~3 s
BRAIN=off node backend/scripts/qc/dayDump.mjs --seed=1337 --n=25 --label=smoke --agent=<ID> --out=...
```

Each run also writes `<out-minus-.jsonl>.report.md` (provenance header, instrument checks, three denominators, binding histogram).

```bash
node backend/scripts/qc/scoreDays.mjs <dump.jsonl>                      # level, all 3 denominators
node backend/scripts/qc/scoreDays.mjs <base.jsonl> <treat.jsonl> --json=out.json   # paired McNemar + A5 floor
# RE-SCORE UNDER A DIFFERENT RULER — pure arithmetic, NO re-solve, no DB, no RNG
node backend/scripts/qc/scoreDays.mjs <dump.jsonl> --ruler=fatwide:0.5
node backend/scripts/qc/scoreDays.mjs <dump.jsonl> --ruler=carbwide:0.5
node backend/scripts/qc/scoreDays.mjs <dump.jsonl> --ruler=nofat|nocarb|kcal5|product-recomputed
```

**`scoreDays` exits 4** on a reconciliation failure, **3** on a comparability problem (seed / population / DB sha / food fingerprint / **pool shape** / **working tree** / day-key mismatch). **Non-zero = the number is unusable.**

## 3. Record schema — `fleet/W1-1/day/v2`, one object per planned day

`run` (provenance + `poolShape`, `ruler`, `seed`, `dbSha256`, `gitSha`, `gitDiffStat`, `personasSha256`) · `personaId/personaIdx/tier/satisfiable` (`satisfiable = tier !== "IMPOSSIBLE"`) · `dietStyle/allergens[]/allergenStack` · `mealsPerDay/snacksPerDay/horizonKey/horizonDays` · `poolCounts{raw,afterDiet,afterPrep,afterStack}` · `adjustersOffered/adjusterRoles[]` · `energy{tdee,rmr,floorKcal,targetRaw,targetKcal,floored}` · `dayIndex/dayOfWeek/windowIndex/`**`dayKey`** (= `"<personaId>#<dayIndex>"`, the A/B pairing key, verified unique) · **`judged`** (`slotsFilled>0` — reproduces `A1/rig/schema.mjs:83` exactly; SECONDARY) · **`planned`** (always true; **PRIMARY mandatory co-report**) · **`degenerate`** · `slotsTotal/slotsFilled/slotsEmpty` · **`target`** (all 10 band numbers) · **`achieved`** (4 macros as shipped, recomputed from raw Food rows) · `achievedSolver`/`drift` · **`verdict`** (inBand + 4 booleans + 6 pct fields) · `rulerId` · **`bindingMissKey`** · `missMacros[]/missSide` · `horizonBinding` · `engineInBand/engineMatchPct/verdictDisagrees` · **`closer{fired,addedCount,addedGrams,roles,items}`** · `honesty{hasWarning,warningCount,hasDiagnosis,declared}` · `pinned{scaledSlots,atLoBound,atHiBound}` · **`slots[]`** (per-slot grams, both scales, pin flags, macros, adjusters, warning) · `daysPlanned/daysJudged/daysInBand` · `solveMs`.

## 4. Measured levels (640 planned days)

| seed | pool shape | satisfiable (judged) | all (judged) | all planned |
|---|---|---|---|---|
| 424242 | route | 415/537 = **77.3%** | 435/623 = 69.8% | 435/640 = 68.0% |
| 20260730 | route | 418/537 = **77.8%** | 439/623 = 70.5% | 439/640 = 68.6% |
| 8675309 | route | 413/537 = **76.9%** | 433/623 = 69.5% | 433/640 = 67.7% |
| 424242 | **rig** (`--nostack`) | 417/537 = **77.7%** | **437/623 = 70.1%** | 437/640 = 68.3% |

The `--nostack` arm **reproduces the brief's headline 437/623 = 70.1% byte-exactly** — the strongest available proof that `dayDump`'s `judged` flag *is* the rig's, and it pins where the brief's number came from.

> **Correction to the brief's wording.** It prints "70.1% **all-planned-days** … 437/623". **623 is the JUDGED count.** All-planned is 437/639 = **68.4%**. The number is right; the denominator label is wrong, and A4 explicitly forbids that confusion.

Cross-seed spread, route shape: **0.9 pt** (brief A2 says 0.4–0.5 on the rig shape).

## 5. Claim A6 — CONFIRMED exactly

`A1/rig/schema.mjs:83` → `judged: filled.length > 0,`

Brief: 16 days dropped, all satisfiable, all total failures. **Measured: 16, identical at all 3 seeds, 16/16 satisfiable, 16/16 zero-filled with `slotsTotal > 0`.** From **3 personas**: `p005` (HARD keto, pool **1**, 7 days), `p018` (EASY carnivore, pool **3**, 5 days), `p115` (EASY keto, pool **5**, 4 days).

**Consequence:** a treatment that makes the solver refuse *more* days moves those days out of `judged` entirely — **the reported rate rises while the product gets worse.**

**Fix, as prescribed.** Every record carries `judged` **and** `planned`; `scoreDays` prints ALL PLANNED DAYS **first** and again as the closing headline of every A/B, prints `unjudged` beside every rate, warns when `unjudgedSat > 0`, and on an A/B prints `unjudged: baseline N → treatment M` with *"A RISE here is a treatment refusing days, not solving them."* Neither denominator silently changed.

### A6+ — NEW: a second denominator hole

`runRig.mjs` builds `byDay` from `w.slots`. A persona whose config asks for **zero slots/day** produces zero slots, `byDay` is empty, and **no record is emitted** — the persona does not become "unjudged", it **vanishes**. Exactly **1 of 250: `p233`** (ROBUSTNESS; `mealsPerDay:0, snacksPerDay:0`). **That is why every published all-planned n is 639, not 640.**

**And it is silent:** with zero slots, `unfilledSlots=0` and `daysInTolerance=allDays.length=0` ⇒ `anyMissed` false ⇒ `diagnosis: null`. **A plan containing no food is returned with no diagnosis and no warning** — the corpus's only `honesty.declared === false` record. → W1-4.

## 6. Claim K2 — CONFIRMED and extended

**K2a CONFIRMED exactly.** `runSolve.mjs:46` omits `horizon` and `adjusters`. Wrong shape on **185/250 = 74.0%**. Closer reached **never** vs **254/640 days = 39.7%** in the correct shape.

**K2b CONFIRMED.** `oracle.mjs:38-39` `KCAL_ACCEPT=0.05`, `PROTEIN_SLACK=5`; `:194` has no fat term, no carb term, no keto law, and grades protein against `proteinLo` not `proteinMid`. On identical 640 days: oracle **78.2%** vs product **77.3%**.

**K2c — NEW.** `runSolve.mjs` **and the rig** also drop `applyFilterStack` (the Stage-3 `maxCostCad`/`maxComplexity`/`minTaste` hard caps at `plans.js:214-220`).

| | |
|---|---|
| personas carrying a hard cap | **39** |
| personas whose pool the stack actually narrows | **32 / 250 (12.8%)** |
| pooled recipe-slots removed | 3,493 / 84,427 = **4.1%** |
| worst | `p039` **123→37 (−69.9%)** · `p034` 205→63 · `p129` 288→99 · `p240` 910→347 |
| emptied to zero | 0 |

Paired A/B: all-planned **−0.31 pts**, b=9 c=7, |b−c|=2 vs A5 floor 7.84 ⇒ **does not clear the detection floor**. But **80 of 640 records (12.5%) changed content.** So the omission is **level-inert and per-day-fatal**: rig-shape and route-shape may be compared for a *level*, **never paired day-by-day**. `scoreDays` raises `POOL SHAPE MISMATCH` and exits 3.

**K2d — what the rig IS faithful about** (so nobody re-checks): `walls`/`freeTextExclusions` are the singular rendering of `profile.excludedFoods` — nothing lost. The rig's `include` is a strict superset of `exclusionGate.RECIPE_GATE_SELECT`. The re-assembled adjuster list is equivalent to `planContext.loadAdjusters()`.

## 7. Oracle outcome mislabel — PRESENT, FIXED

Both `off-target-declared` and `honest-unsolvable` asserted honesty but were selected on counters graded at ±5%, while "was anything actually said?" was consulted only by the silent-miss branch (graded at ±15%). A day between the two bars landed on a label asserting it had been declared.

**MEASURED pre-fix** (genProfile, seed 424242, n=200): 111 runs `off-target-declared`; **7 (6.3%)** carried no week diagnosis; **4 (3.6%)** carried neither a diagnosis nor any slot warning.

```js
const anySlotWarning = res.slots.some((s) => s.warning);
const declared = declaredWeek || anySlotWarning;
else if (feasibleMisses > 0) outcome = declared ? "off-target-declared" : "off-target-undeclared";
else if (honestMisses > 0 || unfilledDeclared > 0) outcome = declared ? "honest-unsolvable" : "unsolvable-undeclared";
```

**Post-fix, identical command:** 111 → **107** + **4 `off-target-undeclared`**; converged 77, unsafe 8, honest-unsolvable 4 unchanged. `oracle-selfcheck.test.js` + `invariants.test.js` **19/19 pass**. Historical counts are an **upper bound**.

`mc.mjs` also gained a ruler banner + DB-sha/git-SHA/diff-stat provenance. Arithmetic untouched.

## 8. DoD verification — all PASS

640 records parse · count == 185×1 + 65×7 = 640 · all 250 personas present (249 before the `degenerate` fix — that is how p233 surfaced) · `dayKey` unique · `verdict.inBand == AND(4 booleans)` 0/640 mismatches · per-persona totals reconcile 0 · `--ruler=product-recomputed` identical · disagreements **0** · kcal-drift>1 **0** · missing Food rows **0** · crashes **0** · **network 0**.

**Free intelligence for W1-3** (seed 424242, route): binding-miss histogram `none` 435 · **`fat:over` 49** · `carb:over` 37 · `multi:protein:short+carb:over` 23 · `multi:kcal:over+fat:over` 17 · `empty` 16 · `multi:kcal:short+protein:short` 14 · `multi:kcal:short+protein:short+carb:over` 11 · `multi:kcal:over+fat:over+carb:over` 8 · `multi:fat:over+carb:short` 5 · 14 keys ≤4 · `degenerate` 1.
**Miss side over 205 out-of-band days: over 117 · short 34 · mixed 53 (~3.4:1 over-dominant).** Empty slots **191/3,011**. Closer fired **254/640**.

**Ruler sensitivity, re-scored with NO re-solve** (satisfiable-only, baseline 77.3%):

| ruler | satisfiable | Δ |
|---|--:|--:|
| product minus **fat** | 86.2% | **+8.9** |
| product minus **carb** | 83.6% | +6.3 |
| fat allowance widened to ±50% (A15) | 82.3% | **+5.0** |
| carb allowance widened to ±50% | 79.3% | +2.0 |

**For W3-1:** brief C9 caps A15 at "+4.0 max"; the direct re-grade measures **+5.0**. Adjudicate, don't inherit.

## 9. Blockers

1. **`CP_ROLE=builder`.** `.claude/hooks/guard-edit.js::roleGate` closes `docs/surgery/CAMPAIGN/` entirely to the builder role ("the builder is the party CAMPAIGN/ grades"). Permissions **intersect**, never union. **Reported, not worked around.** The mission's own alternative was taken: all instrumentation lives under `backend/scripts/qc/`. `A1/rig/**` is byte-unchanged; `scoreDays.mjs` is a drop-in superset of `compare.v2.mjs`, and the rig stays reproducible via `--nostack`.
2. Subagent harness refused to write `fleet/out/W1-1/FINDINGS.md`; orchestrator persisted it.

## 10. BRIEF-CLAIMS VERDICTS

| claim | brief | measured | verdict |
|---|---|---|---|
| **A6** | 16 satisfiable total-failure days | **16**, 3 seeds, p005/p018/p115 | **CONFIRMED** (exact) |
| **A6+** | — | 0-slot config emits **no record** (p233) ⇒ n=639 not 640; returns `diagnosis:null` | **NEW FINDING** |
| **K2a** | 74% wrong shape | **185/250 = 74.0%**; closer 0% vs 39.7% | **CONFIRMED** (exact) |
| **K2b** | 5% kcal, no fat/carb | verbatim; 78.2% vs 77.3% | **CONFIRMED** |
| **K2c** | — | rig+runSolve drop `applyFilterStack`; 32/250, −69.9% worst, −0.31 pts, 80/640 records differ | **NEW FINDING** |
| **A1** | 70.1%, 437/623 | reproduced **byte-exactly**; but 623 is *judged*, all-planned = **68.4%** | **ADJUSTED** — denominator label wrong |
| **A2** | 77.3–77.7%, spread 0.4–0.5 | route 77.3/77.8/76.9 (spread **0.9**); rig 77.7 | **CONFIRMED** (level); spread ADJUSTED up |
| **A4** | 495/502/526, 536/537 | this tree: **537, 623, 639/640** | **CONFIRMED** |
| **A7** | 250 rows | 250, `e564b1dd…`, `{day:185, week:65}` | **CONFIRMED** |
| oracle mislabel | qualitative | 4/111 (3.6%) claimed declared with zero declaration; **FIXED** | **CONFIRMED + FIXED** |
| **K3** | — | enforced structurally (ruler banner, `--ruler=kcal5` warning) | **CONFIRMED, guarded** |
| **C9/A15** | ≤ +4.0 | direct re-grade **+5.0** | **flagged for W3-1** |
| zero network | 0 | **0** in all six runs | **CLEAN** |

## 11. Artifacts (`fleet/out/W1-1/`)

`daydump-route-s424242.jsonl` + `.report.md` (primary, 640 days, 3.3 MB) · `-s20260730` / `-s8675309` (+ reports) · `daydump-rigshape-s424242` (+ report; reproduces 437/623) · `daydump-smoke-s1337` (+ report) · `ab-rigshape-vs-route.json` · `mc-prefix/` and `mc-postfix/`.

`git status --porcelain -- backend/src frontend/src` → empty. `docs/surgery/CAMPAIGN` → empty. `.gitignore` gained `fleet/scratch/`.
