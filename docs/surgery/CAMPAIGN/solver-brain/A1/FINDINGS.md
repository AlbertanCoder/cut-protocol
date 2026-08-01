# A1 · Rig — findings

*Agent A1. Persisted to disk by the fleet coordinator from A1's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A1's.
All rig code, data and 8 `CLAIMS.tsv` rows DID land.*

**The no-op A/B returns exact zero.** Same seed, baseline vs identity treatment: 0.00 pts on
all three denominators, 0 discordant pairs, **639/639 byte-identical day records**. The rig
adds nothing of its own.

**The more useful negative result: the rig cannot resolve a delta under ~3.5 points.** The
positive control (pool thinned to 2-of-3 recipes) moved satisfiable-only by −2.05 pts and the
paired 95 % interval still spanned zero. A Phase-4 mechanism that churns days in both
directions needs roughly **+3.5 pts or more** before this study may call it real. That is a
property of n=536, not of anyone's mechanism.

## What is on disk

`A1/rig/` — `dbcopy.mjs` (isolation), `checkdb.mjs` (staleness check), `seeds.mjs`,
`schema.mjs` + `SCHEMA.md`, `runRig.mjs`, **`compare.v2.mjs`** (use this one),
`treatments/noop.mjs`, `treatments/positive-control.mjs`.

`runRig.mjs` is a wrapper, not a harness: it uses `runSolve.mjs`'s call sequence plus the two
things the real route does that `runSolve` omits — horizons (185 of 250 personas ask for one
day, not a week) and `adjusters` (the macro closer). Verdicts come from
`mealSolver.dayTolerance`/`dayInTolerance`, imported. Day totals are re-derived independently
from raw `Food` rows (the `oracle.mjs` method), so every record carries the solver's claim,
the re-derivation, and the drift.

## Copy-paste block for a Phase-4 agent

```bash
cd docs/surgery/CAMPAIGN/solver-brain/A1/rig
ME=A7                                    # <- your agent id
OUT=C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/$ME

node checkdb.mjs $ME                     # once, before any measured run

# write your mechanism: copy treatments/noop.mjs, change ONE returned object
#   -> rig/treatments/$ME-mymech.mjs     ... put your id in the filename

node runRig.mjs --agent=$ME --pop=personas --seed=424242 --label=baseline \
  --out=$OUT/$ME-baseline-s424242.jsonl
node runRig.mjs --agent=$ME --pop=personas --seed=424242 --label=mymech \
  --treatment=./treatments/$ME-mymech.mjs --out=$OUT/$ME-mymech-s424242.jsonl

node compare.v2.mjs $OUT/$ME-baseline-s424242.jsonl \
  $OUT/$ME-mymech-s424242.jsonl --json=$OUT/$ME-ab-s424242.json

# repeat at seeds 20260730 and 8675309 before believing any delta.
```

`runRig` copies the database to `$OUT/` and sets an absolute `DATABASE_URL` itself — do not
set one. Check its `INSTRUMENT CHECKS` line reads all zeros. No port bound, no write to the
shared DB, `BRAIN=off` forced. One run ≈ 35 s.

## Seed registry

| name | seed | use |
|---|---|---|
| primary | 424242 | every headline A/B |
| replicate-1 | 20260730 | is-the-delta-real check |
| replicate-2 | 8675309 | is-the-delta-real check |
| smoke | 1337 | `--n=25` wiring only; never reported |

With `pop=personas` the population is fixed (250 materialised rows); the seed drives only the
solver RNG, `rng_i = mulberry32(childSeed(seed, persona.idx))`. With `pop=genprofile` the seed
also decides who the customers are. **Never mix the two in one table.**

## The no-op A/B — MEASURED, seed 424242

| denominator | baseline | no-op | delta (paired) | discordant |
|---|---|---|---|---|
| satisfiable-only | 413/536 = 77.1 % | 413/536 = 77.1 % | **+0.00 pts** | b=0 c=0 |
| all judged days | 434/622 = 69.8 % | 434/622 = 69.8 % | **+0.00 pts** | b=0 c=0 |
| all planned days | 434/639 = 67.9 % | 434/639 = 67.9 % | **+0.00 pts** | b=0 c=0 |

Byte-identical 639/639. Instrument: verdict-disagreements 0, kcal-drift 0, crashes 0, silent
misses 0.

## Baseline level vs the campaign's numbers — MEASURED, 3 seeds

| seed | satisfiable-only | all judged days |
|---|---|---|
| 424242 | 413/536 = 77.1 % (73.3–80.4) | 434/622 = 69.8 % (66.1–73.3) |
| 20260730 | 417/536 = 77.8 % (74.1–81.1) | 438/622 = 70.4 % (66.7–73.9) |
| 8675309 | 418/536 = 78.0 % (74.3–81.3) | 437/622 = 70.3 % (66.5–73.7) |

BRIEF.md's HTTP-fleet figures are 77.8 % and 70.1 %. This rig lands on 77.1–78.0 % and
69.8–70.4 % **on a different call path and a different denominator** (622 judged days here,
578 there — four deliberate deviations documented in `SCHEMA.md`: `startDayOfWeek` pinned to
0, free-text exclusions not applied, no HTTP layer, adjusters re-assembled). Two instruments
agreeing to within a point is corroboration, not the same measurement. **Cite the HTTP fleet
for a standalone level; cite this rig only for deltas between its own runs.**

Diet slices, satisfiable-only, seed 424242 — MEASURED: none 242/275 (88 %), mediterranean
43/49 (88 %), vegetarian 36/57 (63 %), keto 29/46 (63 %), vegan 21/35 (60 %), kosher 19/35
(54 %), paleo 11/24 (46 %), carnivore 0/3. BRIEF.md's 90.6/62.0/59.3/58.7 for
none/keto/vegan/vegetarian sit inside or beside these. **Without the satisfiable filter the
same vegan slice reads 21/90 = 23 %** — the denominator rule is doing real work, not
bookkeeping.

Cross-seed spread is 0.9 pts (satisfiable) and 0.6 pts (all days), inside BRIEF.md's ±1.5.
Within one seed the rig is exactly deterministic — there is no run-to-run noise to average
away.

## Minimum detectable effect — DERIVED

McNemar `se = sqrt(b + c − (b−c)²/n)/n`. Positive control, satisfiable-only: b=50, c=39,
n=536 → `sqrt(89 − 121/536)/536 = 9.42/536 = 0.0176` → 1.76 pts → 95 % half-width **3.45
pts**. A churning treatment needs |delta| ≳ 3.5 pts. A treatment that only ever helps (b=0)
is limited instead by the ±1.5 pt floor, needing about **9 flipped days** at n=536.

## Two things this rig does NOT check

1. **Allergen leaks.** No leak column is emitted. BRIEF.md's zero-leak property must be
   verified with `backend/scripts/qc/oracle.mjs`, whose `AUDIT_ALLERGENS` list is curated
   independently of the app's. **Any treatment touching the pool or exclusion path must run
   the oracle separately.**
2. **Free-text exclusions.** Personas carrying them are solved slightly less constrained here
   than in the HTTP fleet.

## For A3 (denominator audit) — MEASURED, seed 424242

The `IMPOSSIBLE` tier produced **21/86 judged days in band** (32 personas, 103 planned days).
If correct output for that tier is a refusal, 21 in-band days are either mis-tiered personas
or a refusal that did not fire. Slice `tier == "IMPOSSIBLE" && verdict.inBand` in
`A1-baseline-s424242.jsonl`. *(Coordinator: this independently corroborates A3's C7 ruling
that the tier is over-inclusive.)*

Day-level pinning — MEASURED: 168/188 (89.4 %) of out-of-band days carry at least one slot
pinned at 0.5×/2.0×, against 493/622 (79.3 %) of all judged days. **Slot-level: 1130/2818
(40.1 %) of all filled slots are pinned**, sitting on BRIEF.md's 39.3 %. The brief's other
figure (68.3 %) counts *slots that themselves missed* — a different unit, so this neither
confirms nor contradicts it; the schema stores per-slot scales and bounds so whoever owns that
question can compute it without re-solving.

## Blockers recorded, not worked around

1. `guard-edit.js` **BLOCKED an edit to `rig/compare.mjs`** — everything under
   `docs/surgery/CAMPAIGN/` is create-only. v1 is correct but reports only the unpaired
   interval, which at n≈620 is ±5 pts wide and would file a real +3 pt effect as "not
   distinguishable from zero". Fix shipped as a new file, `compare.v2.mjs`, adding the paired
   McNemar interval. **Phase-4 agents: run `compare.v2.mjs`.** Every agent should expect this
   guard — write each artifact once, ship corrections as new files.
2. The **fleet sandbox** blocked a guard self-test that set `DATABASE_URL` to the live path to
   prove `assertIsolated` rejects it. False positive on a read-only probe; probe dropped, not
   rephrased. The rejection paths in `dbcopy.mjs` are therefore code-reviewed but not
   execution-tested.
3. The harness blocked writing `FINDINGS.md` itself.

**Sanity checks run before reporting:** the shared live database sha256 is unchanged and still
matches `DEVDB-BASELINE.txt`; `A1/dev.db` hashes identical to source (`e55f52e53658a086`);
smoke run, three full baselines, no-op and positive-control runs all report zero
verdict-disagreements, zero kcal-drift, zero crashes, zero invalid records.

**CONFIRMED**
