# A3 — Ceiling audit

*Agent A3. Persisted to disk by the fleet coordinator from A3's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A3's.
A3's data artifacts (`.mjs`/`.json`/`.tsv`) and its 15 `CLAIMS.tsv` rows DID land.*

## RULING — the denominator the fleet should use

**526 days, not 495.** The impossible tier is **over-inclusive by 31 days**.

| figure | brief says | A3 measures |
|---|---|---|
| structurally impossible days | 83 | **52** (proven) |
| satisfiable-only denominator | 495 | **526** |
| satisfiable-only in-band today | 385/495 = 77.8 % | **405/526 = 77.0 %** |
| all-days ceiling, perfect solver | "near 88 %" | **91.0 %** (526/578) |
| satisfiable-only ceiling | — | **no proven ceiling below 100 %** |

The brief's own 83 implies **85.6 %** (495/578), not 88 %. **"Near 88 %" is not
reproducible from the brief's own tier count** — a second, separate error, independent of
the recount.

## Why 83 is wrong: the tier holds two different constructions

`personas.mjs:248` splits IMPOSSIBLE into two sub-kinds —
`weighted(r, [['every-protein-walled', 55], ['floor-vs-rate', 45]])`. Only the first
matches the brief's description; its comment reads `"no combination of library rows"`. The
second is a different customer — `"wants 2 lb/wk off a small frame at the calorie floor"` —
walling gluten/dairy/soy with a 15-min prep cap.

| sub-kind | personas | days | in band | proven impossible |
|---|---|---|---|---|
| every-protein-walled | 18 (17 planned) | 53 | **0** | 52 d / 16 pers |
| floor-vs-rate | 14 (12 planned) | 30 | **20 (66.7 %)** | **0** |

**A construction cannot be "mathematically unsatisfiable by design" and land 20 of its 30
days in tolerance.** `stats.json` already half-caught this (`"mislabelledSatisfiable": 7`)
but restored only the 7 personas that scored 100 %; p004, p045, p072, p088 and p109 are
equally unproven and equally belong in the denominator.

**Disagreement with A2, stated loudly.** A2's ledger line gives 392/502 = 78.1 %, restoring
7 days. That is under-corrected. Correct restoration is 31 days → **405/526 = 77.0 %**. A2
and the brief bracket the true figure; neither is it.

## The proof, not the assertion

Two upper bounds on a day's achievable protein, both **strictly more generous than the
solver** — so a failure is a proof and a pass proves nothing:

- **LOOSE** = `kcalCeiling × max(protein/kcal)` over every row surviving the gate (recipes
  *and* foods — the macro closer may add one). Ignores slots, portion clamp, variety, fat,
  carbs.
- **SCALED** = `Σ_slots min(2.0 × row.kcal, slotCeiling) × density`, applying the shipped
  0.5–2.0× portion clamp. Still ignores fat, carbs, variety.

Constants read from source, not assumed: `DAY_KCAL_TOLERANCE_PCT = 0.15` and
`DAY_PROTEIN_TOLERANCE_PCT = 0.15` (`mealSolver.js:210-211`) against
`pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2` (`mealSolver.js:230`).

**Instrument check (integrity rule 7): 29/29 reconstructed `afterDiet` pool sizes reproduce
the fleet's recorded `poolCounts.afterDiet` exactly, zero mismatches.** Falsification check:
had any proven-impossible persona landed a day in band, the proof would be false — **0 of 52
did.**

Worked example, p073 (vegan + tree nuts/pork/soy/gluten/peanuts/sesame/legumes): the gate
leaves **20 of 910 recipes** (2.2 %). Target 1,512 kcal, protein band 177–194 → floor
157.7 g. Best surviving density 0.0567 g/kcal × (1,512 × 1.15) = **98.7 g max**. Short by
**58.9 g (37 %)**. Infeasible. All 29 rows in `A3-infeasibility.tsv`.

## Under-inclusive direction: clean

Same proof over all 250 personas: **zero EASY/HARD/ROBUSTNESS personas are structurally
impossible** (0 personas, 0 days). The satisfiable population is not contaminated by hidden
refusals. That half of the brief's worry does not hold.

## Three-way split — sums to 578

`pool-limited` = not provably impossible, but the pool the solver actually received
(`afterStack`) is below what the horizon needs to fill its slots inside the 2×/week variety
cap: `afterStack < ceil(nSlots × days / 2)`.

| bucket | personas | days | in band | rate |
|---|---|---|---|---|
| structurally impossible | 16 | **52** | 0 | 0.0 % |
| pool-limited | 20 | **140** | 83 | 59.3 % |
| solver-limited | 176 | **386** | 322 | 83.4 % |
| **TOTAL** | **212** | **578** | **405** | **70.1 %** |

Sensitivity on the pool-limited cut (the one judgment call; structural counts do not move):
`afterStack<10` → 25 d/501 d · `<30` → 37/489 · `<60` → 72/454 · `<100` → 145/381.

## Caveats

1. **The relaxation proves impossibility only, never feasibility.** "No proven ceiling below
   100 %" ≠ "100 % is reachable" — both bounds ignore fat and carbs, and A2 measures 19/110
   satisfiable-only misses binding on those. A real ceiling under 100 % may exist; it is just
   not *structural*.
2. **p175 is contested** — floor 90.1 g vs SCALED bound 98.0 g, clears by 7.9 g (8.8 %), yet
   scored 0/1 days. If impossible: 53 days, ceiling 90.8 %. A3 reports 52 because 52 is what
   it proved.
3. p100, p155, p219 never reached a plan (`profile-blocked-400`) — in the 250, not in the 578.

## Artifacts

Under `docs/surgery/CAMPAIGN/solver-brain/A3/`: `A3-prove-infeasible.mjs`,
`A3-classify-all.mjs`, `A3-final-split.mjs`, `A3-infeasibility.tsv`,
`A3-infeasibility.json`, `A3-classification.json`, `A3-final-split.json`. Seed
`qa-fleet-20260729-2032`, head `0d3eaa5`, `BRAIN=off`. Isolated DB copy `A3-dev.db` (910
recipes, 14,151 foods), absolute `DATABASE_URL`, read-only — the owner's `dev.db` was never
written.

**FALSIFIED**
