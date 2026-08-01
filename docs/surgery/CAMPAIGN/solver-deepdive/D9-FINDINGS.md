# D9 — The instruments: what can actually detect a regression, and what is theatre

**Agent D9 · solver deep-dive · 2026-07-31.** Territory: `backend/tests/`, `backend/scripts/qc/`,
`backend/scripts/solverBenchmark.mjs`, and the campaign harnesses that produced the headline.

Every claim below is labelled `MEASURED` (I ran it, command given), `DERIVED` (arithmetic from
measured values), or `INFERRED` (read the code, did not execute it). Read-only throughout: no
file under `backend/src/` or `backend/tests/` was modified, and `backend/prisma/dev.db` hashes
`d9037dce9754b452…` before and after every command in this report.

Artifacts: `docs/surgery/CAMPAIGN/solver-deepdive/D9/` — three baseline JSONLs, a replay, a
drift comparison, one re-score script, and a DB copy.

---

## 0. Headline answers

| question | answer |
|---|---|
| Does 70.1 % reproduce today? | **Yes, as a level. No, as a day set.** Two independent instruments land on 70.1 % on the current tree; 514 of 639 day records have changed content since the campaign baseline. |
| Which population produced 70.1 %? | **`personas.mjs` (weighted, tiered), not `genProfile.mjs`.** Definitively, from `results.jsonl` × `personas.jsonl`, 250/250 rows cross-verified. |
| Is the golden file an oracle? | **No.** It is a snapshot. It currently locks a week that fails 4 of 7 days and leaves 5 of 21 slots empty, and has been regenerated three times without that ever changing. |
| Is `oracle.mjs` a sufficient leak check? | **No.** Measured 11/25 on real DB rows, and it misses every high-protein row a macro closer would actually reach for. |
| Minimum detectable effect? | **A churning treatment needs \|b−c\| > 1.96·√(b+c).** At the observed churn levels that is **2.6–3.7 pts**; use **≥3.5 pts**. A one-directional treatment needs **≥6 flipped days** (exact), **≥9** to also clear cross-seed spread. |
| Recommended harness | **`A1/rig/runRig.mjs` + `compare.v2.mjs`**, with one mandatory correction (§7). |

---

## 1. Baseline reproduction

### 1.1 The number reproduces — twice, independently

**MEASURED.** Re-scoring the stored HTTP-fleet run, no solve, no DB:

```bash
node docs/surgery/CAMPAIGN/solver-deepdive/D9/D9-rescore-httpfleet.mjs
# ALL DAYS      405/578 = 70.1%   emptyDays=17
#   tier EASY        personas=118  236/298 = 79.2%
#   tier HARD        personas= 52  120/160 = 75.0%
#   tier IMPOSSIBLE  personas= 29   20/83  = 24.1%
#   tier ROBUSTNESS  personas= 13   29/37  = 78.4%
```

**MEASURED.** A fresh solve on the current working tree, different call path, different
denominator:

```bash
cd docs/surgery/CAMPAIGN/solver-brain/A1/rig
node checkdb.mjs D9                       # copies backend/prisma/dev.db to solver-brain/D9/
node runRig.mjs --agent=D9 --pop=personas --seed=424242 --label=d9-baseline-worktree \
  --out=<abs>/solver-deepdive/D9/D9-baseline-worktree-s424242.jsonl
# [rig] customers 250 · days 639 · judged 623 · in band 437 (70.1%)
# [rig] INSTRUMENT CHECKS  verdict-disagreements 0 · kcal-drift>1 0 · crashes 0 · invalid records 0
```

Three seeds on today's tree (**MEASURED**):

| seed | satisfiable-judged | all judged | all planned |
|---|---|---|---|
| 424242 | 417/537 = **77.7 %** | 437/623 = **70.1 %** | 437/639 = 68.4 % |
| 20260730 | 417/537 = 77.7 % | 438/623 = 70.3 % | 438/639 = 68.5 % |
| 8675309 | 415/537 = 77.3 % | 435/623 = 69.8 % | 435/639 = 68.1 % |

Cross-seed spread on today's tree: **0.4 pts** (satisfiable), **0.5 pts** (all judged). Tighter
than BRIEF.md's stated ±1.5, and tighter than A1's 0.9 pts.

### 1.2 But the baseline is not in git, and the day set has moved

Three findings that a fix effort must not discover the hard way.

**(a) The 70.1 % run was measured on an UNCOMMITTED working tree. MEASURED.** The 38 personas
recorded as `profile-blocked-400` in `results.jsonl` all carry
`steps.profileFinal.gate = "gain-not-supported"`. That gate is `gainDirectionGate` in
`backend/src/routes/profile.js:304-356` — **uncommitted, +73 lines, present only in the working
tree**. So the headline cannot be reproduced from any commit: `git stash` the working changes
and the denominator changes. The baseline exists only as *this* tree.

**(b) The food data has changed since the campaign. MEASURED.**

```
backend/prisma/dev.db                         sha256 d9037dce9754b452…  (today)
solver-brain/DEVDB-BASELINE.txt               sha256 e55f52e53658a086…  (campaign)
   == backend/prisma/dev.db.backup-provenance149-20260731-055003
qa-fleet .../backup/dev.db.fleet-baseline     19.4 MB   (fleet start; today's is 22.8 MB)
```

The rig's own food fingerprint confirms it: A1's runs saw `423e7279ed6af641`, today's see
`b961ac3afbdf3f53`. `compare.v2.mjs` prints `*** COMPARABILITY PROBLEMS *** ! FOOD FINGERPRINT
MISMATCH` when the two are crossed — **the guard works, and it fires.**

**(c) 80 % of the day records changed content while the level did not. MEASURED.**

```bash
node compare.v2.mjs solver-brain/A1/A1-baseline-s424242.jsonl \
                    solver-deepdive/D9/D9-baseline-worktree-s424242.jsonl
# satisfiable   413/536 = 77.1%  ->  417/537 = 77.7%
# DELTA paired (McNemar) +0.75 pts  95% CI -1.89 … +3.38   b=24 c=28
# VERDICT  NOISE, NOT A RESULT
```

Excluding the wall-clock `solveMs` field, **125 of 639 records are content-identical and 514
changed** — every macro total, 392 match percentages, 62 honesty flags. Only 52 verdicts
flipped, and they nearly cancelled.

> **Rule for the fix effort: A1's stored baseline JSONLs are NOT a valid comparison arm.**
> They were produced on different source and different nutrition data. Re-run your own
> baseline, in the same session, on the same tree and DB, before every treatment run.

---

## 2. The persona-population question — definitively answered

**The 70.1 % figure came from `personas.mjs`.** `MEASURED`, two ways:

1. `stats.json` carries `runId: qa-fleet-20260729-2032`, whose `macros.daysInBandRate` is
   `{n: 578, k: 405, p: 0.701}`, computed by `qa-fleet-20260729-2032/stats.mjs` from
   `results.jsonl`, which `fleet.mjs` produces by walking `personas.jsonl`.
2. I cross-checked all 250 rows of `personas.jsonl` against `results.jsonl` on
   `(tier, dietaryStyle, walls, goalKind, bmi)` — **0 mismatches, 0 missing**. The population
   file on disk is the population that ran.

### The two generators are different populations, and it matters

| | `backend/scripts/qc/genProfile.mjs` | `qa-fleet-20260729-2032/personas.mjs` |
|---|---|---|
| diet selection | `pick(DIET_STYLES)` — **uniform over 9** (`genProfile.mjs:87`, `rng.mjs:24`) | `weighted(r, DIET_WISHES)` — **11 wishes, w 30/8/8/8/6/5/5/4/2/6/4** (`personas.mjs:64-80`) |
| carnivore | **10.6 %** (n=10 000) | **0.8 %** (2/250) — a **13×** over-representation in genProfile |
| unrestricted | 11.4 % (`null`) | 38.8 % `none` + 11.2 % `null` = **50.0 %** |
| difficulty tiers | none | `EASY 60 / HARD 25 / IMPOSSIBLE 10 / ROBUSTNESS 5` (`personas.mjs:107-109`) → realized 56.8/24.4/12.8/6.0 |
| engineered-impossible cohort | none | 32 personas, 83 days, **24.1 % in band** |
| allergy stacks | 45 % none / 30 % one / 18 % two / 7 % three-four | 20.8 % zero walls, tail out to 9 walls, tier pressure raises HARD to ≥2 |
| horizons | week only | 74 % single day, 26 % week |
| free-text walls | none | 101 personas type walls outside the 10-key picker |
| goals | cut only | cut 162 / lean bulk 38 / maintain 26 / recomp 24 |

**MEASURED** (`node -e` over `genProfile(42, i)`, n=10 000): genProfile's realized mix is
`null 11.4 · paleo 11.5 · halal 11.8 · keto 11.2 · mediterranean 11.0 · vegan 10.8 ·
vegetarian 10.8 · kosher 10.9 · carnivore 10.6` — uniform to within sampling error, exactly as
the prior note said.

**Consequence for the build prompt.** genProfile's population is roughly **one-in-nine
carnivore and one-in-nine vegan**, against a real mix of 1-in-125 and 1-in-8. Carnivore is the
worst-served diet in the library (A1: 0/3 satisfiable days in band). A harness built on
genProfile therefore reports a *lower* level, and — worse — will attribute gains to whatever
helps carnivore/vegan, a cohort that is 20 % of its population and 13 % of the real one. It is
also blind to horizons (185 of 250 real requests are single-day), free-text walls, and the
IMPOSSIBLE tier that the whole denominator argument turns on.

> **Never mix the two denominators, and prefer `personas.mjs`.** `genProfile.mjs` remains
> useful for one thing only: crash/robustness fuzzing across engine corners it deliberately
> over-samples (metric/imperial, body-fat present/absent, excluded formulas). It is not a
> compliance instrument.

---

## 3. Instrument-by-instrument verdict

### 3.1 Solver-relevant tests

All 121 tests below pass on the current tree, and the run does not touch the real DB:

```bash
cd backend && sha256sum prisma/dev.db && \
  node scripts/runTests.mjs tests/solverHonesty.test.js tests/golden/goldenBaseline.test.js \
    tests/horizonGeneration.test.js tests/dietaryFilter.test.js tests/exclusionGate.test.js \
    tests/fiveFilters.test.js && sha256sum prisma/dev.db
# [runTests] OK — 6 files, 121 tests, 0 failures.    hash unchanged before/after   MEASURED
```

| file | detects a compliance change? | verdict |
|---|---|---|
| `solverHonesty.test.js` | **No** | **TRUSTWORTHY, wrong axis.** It guards *honesty*, not *compliance*: every out-of-band day carries a miss line, every imperfect week a diagnosis, no suggestion mentions allergies, no ingredient ships at 0 g. It is the best-constructed file in the suite — line 238 is an explicit anti-vacuity guard (`sweep produced no 6/7 week — this test would have passed vacuously; retune the fixture`) and the 2026-07-30 retune comment records that the guard **fired and was obeyed in the strict direction**. But a solver that shipped 0/7 days in band with perfect miss lines passes every assertion here. |
| `golden/engine-baseline.golden.json` + `goldenBaseline.test.js` | **Change only, no quality axis** | **THEATRE, with one real virtue.** See §4. |
| `horizonGeneration.test.js` | **Weakly** | **MOSTLY TRUSTWORTHY.** Runs against a temp COPY of the real 910-recipe library with an absolute Prisma URL (`:56-67`) — genuinely read-only, correctly WAL-aware. Real assertions on repeat caps, distinct-recipe floors, binding classification, p95 latency. One compliance assertion exists — `:280 assert.ok(m.score.avgMatch >= 85, "measured 96-98% on this library")` — but it runs on **one hardcoded easy profile** (M 33, 185 cm, BF 20, no diet, no allergies) with **11–13 pts of slack**. It catches a catastrophe, not a regression. The uncommitted diff at `:404-433` is a confession that the previous snack assertion `passed only because of the order classifyBinding evaluates its branches in` — i.e. it *was* a vacuous pass, caught and fixed. |
| `dietaryFilter.test.js` | **No** | **THEATRE for coverage, fine for regression.** 30 tests over a **13-name synthetic pool** plus regressions harvested from past leaks. It proves the filter handles names someone already thought of. It structurally cannot detect the C13 class (Groundhog, Sea cucumber, Dove, Hog maws) because those names were never enumerated. This is the project's defining failure shape: an independently-authored word list is still a word list. |
| `exclusionGate.test.js` | **No** | **TRUSTWORTHY within its scope.** It deliberately does *not* test coverage; it pins three structural properties — the gate owns the evidence, a degraded recipe fails closed, and no new surface may import the weak name-only primitives (a source-grep assertion). That last one is a genuine architectural ratchet and the most valuable non-vacuous test in the suite. |
| `fiveFilters.test.js` | **No** (cost/time/complexity/taste, not macros) | **TRUSTWORTHY.** Statistical assertions over the committed 602-recipe seed rather than cherry-picked fixtures, with the reasoning stated in the header. Not a macro instrument at all — do not cite it in a compliance A/B. |

### 3.2 QC scripts

| script | writes? | verdict |
|---|---|---|
| `qc/rng.mjs` | — | **TRUSTWORTHY.** mulberry32, integer ops only, splitmix child seeds. Reproducible across machines. See §6. |
| `qc/genProfile.mjs` | — | **Correct code, wrong population** for compliance work. See §2. |
| `qc/runSolve.mjs` | — | **TRUSTWORTHY but incomplete.** It does use the route's real call sequence, and forces `BRAIN=off`. It omits **horizons** (`generateBestWeekPlan`, never `generateHorizonPlan` — so 74 % of real requests are solved as the wrong shape) and **`adjusters`/the macro closer**, which is the last +4.2 pts of the 40.8→70.1 arc. Both omissions are what `A1/rig/runRig.mjs` exists to fix. |
| `qc/oracle.mjs` | — | **PARTLY THEATRE, and its headline metric is a different ruler.** See §5. |
| `qc/mc.mjs` | writes `docs/qc/*.md`, `*.jsonl` | **USE WITH CARE.** Correct plumbing: `BRAIN=off`, traps outbound HTTP and fails on any call. But it grades with `oracle()`, whose acceptance bar is `KCAL_ACCEPT = 0.05` and `PROTEIN_SLACK = 5 g` with **no fat and no carb term at all** (`oracle.mjs:38-39, 194`). Its `daysInTol` is therefore a **third, incompatible ruler** — tighter on kcal, blind on composition — and must never be reported next to the 70.1 %. It also loads the shared DB via `.env` and writes to shared `docs/qc/` paths with no agent id. |
| `qc/personaPlan.mjs` | no | **TRUSTWORTHY as a human-readable probe**, useless as a metric. Read-only, no port. Its allergen re-check is `oracle.hitsAny`, inheriting §5's blindness. Cosmetic dead code at `:71,79` (`k` accumulates grams then is discarded). |
| `qc/sweep14k.mjs` | writes `docs/qc/allergen-sweep.md` | **THE RIGHT SHAPE, wrong vocabulary.** It crosses the app's matcher against oracle's list over the whole corpus, both directions (leak *and* false-exclusion, with a held-out KNOWN_SAFE list). That is exactly how a leak check should be built. It is capped by §5: the reference list is the ceiling on what it can find. |
| `qc/integritySweep.mjs` | report-only | **TRUSTWORTHY.** Re-implements fiber-adjusted Atwater inline, separates known formula-edge false positives from corruption, checks provenance and fdcId uniqueness, explicitly refuses to mutate Food (which would break the goldens). Note the standing caveat in project CLAUDE.md: Atwater consistency is not a correctness warrant — a row carrying another food's macros passes perfectly. |
| `qc/fuzz.mjs` | copies dev.db → `backend/prisma/dev.db.qcfuzz` | **TRUSTWORTHY for its purpose** (500s/hangs/stack leaks), irrelevant to macros. **Flag:** it drops a new `dev.db.*` file into `backend/prisma/` — precisely the class of file the project's packaging denylist cannot catch (CLAUDE.md, Packaging). |
| `scripts/solverBenchmark.mjs` | read-only | **HONEST, SUPERSEDED.** Its own header concedes `every ABSOLUTE nutritional number here is PROVISIONAL` and it is built around a synthetic grid (target × style × allergy set × prep cap), not a customer population. Its structural findings (silent miss / variety collapse / degenerate slots) hold. Its `--assert` silent-miss gate is a useful CI guard. **Do not use it for the headline** — it is a different population *and* a different call path from both instruments in §1. |

### 3.3 The campaign harnesses

| harness | verdict |
|---|---|
| `qa-fleet-.../fleet.mjs` + `lib.mjs` + `stats.mjs` | **THE CANONICAL LEVEL, and it is well built.** `lib.mjs:448-514` recomputes every day from raw `Food` rows and re-implements `dayTolerance` independently, then treats the app's own `matchPct`/`inTolerance`/`diagnosis` as *claims to be checked*. That is the correct posture. **Two costs:** it needs a live server on a port and mints 250 users into whatever DB `DATABASE_URL` names (`lib.mjs:24-28` loads `backend/.env`, so an unset override lands on the owner's DB); and its re-implemented tolerance rule is a **transcription** of `mealSolver.dayTolerance()`, so the two can silently drift. It records 0 verdict disagreements today, which is the guard for exactly that. |
| `A1/rig/runRig.mjs` + `compare.v2.mjs` | **THE RIGHT INSTRUMENT FOR DELTAS** — with one defect, §7. Isolates its own DB by absolute URL and refuses a relative one (`dbcopy.mjs:104-114`), forces `BRAIN=off`, binds no port, solves the real horizon shape and re-assembles the adjuster pool, imports `dayTolerance` rather than transcribing it, prints an `INSTRUMENT CHECKS` line that must read all zeros, and reports paired McNemar. 30 s per arm. |

---

## 4. The golden baseline is a snapshot, not an oracle

**MEASURED.** The locked baseline in three successive versions:

| version | days in tolerance | empty slots | avgMatch |
|---|---|---|---|
| `incident/engine-baseline.golden.PRE-COMPOSITION-BIAS.json` | **3/7** | 5/21 | 61 |
| `git show HEAD:backend/tests/golden/engine-baseline.golden.json` | **3/7** | 5/21 | 61 |
| working tree (regenerated, 578 diff lines) | **3/7** | 5/21 | 61 |

**The project's only committed baseline of solver output enshrines a week that misses 4 of 7
days and leaves 5 of 21 slots empty — 42.9 % in band — and it has been regenerated at least
three times without that number moving or anyone being alerted.** The fixture is structurally
incapable of doing better: 8 meal recipes × a 2×/week repeat cap = 16 servings for 21 slots
(`fixtures.js:61-70`).

`goldenBaseline.test.js` compares `JSON.stringify(actual[section])` to
`JSON.stringify(golden[section])` and, on mismatch, prints the regenerate command. It has **no
quality axis**: an improvement and a regression both fail it identically, and the documented
response to both is `REGEN`. It is a *change detector*.

**Its one real virtue is worth keeping** (`goldenBaseline.test.js:22-38`): the section list is
derived from the golden's own keys and asserted equal in both directions, so a section the
producer emits but the golden does not carry fails loudly. That closed a real hole where the
BMR snapshots sat committed and uncompared. Keep that; do not treat the file as evidence of
correctness.

> **For the build prompt:** expect `goldenBaseline.test.js` to fail on any solver change. That
> failure is information about *scope*, not *quality*. Review the diff, then regenerate. Never
> cite "goldens pass" as evidence a change helped, and never let a golden regeneration be the
> only record that behaviour moved.

---

## 5. `oracle.mjs` — confirmed insufficient as a leak check

**MEASURED**, against real rows in my DB copy, using oracle's own exported `hitsAny` with the
vegan term set reconstructed verbatim from `oracle.mjs:80-82`:

```
CAUGHT  Squirrel, ground, meat (Alaska Native)        P 19.3   <- only because "meat" is in the name
CAUGHT  Game meat, squirrel, raw                      P 21.2   <- same
MISSED  Groundhog                                     P 28.1
MISSED  Armadillo                                     P 28.1
MISSED  Wild pig                                      P 28.1
MISSED  Owl, horned, flesh, raw (Alaska Native)       P 22.7
MISSED  Sea cucumber, yane (Alaska Native)            P 13.0
MISSED  Ceviche                                       P 10.5
MISSED  Hog maws                                      P 26.5
MISSED  Dove, cooked (includes squab)                 P 23.9
MISSED  Nutritional powder mix (Isopure)              P 58.1
CAUGHT  Bear, black, meat (Alaska Native)             P 20.1   <- "meat"
CAUGHT  Seal, bearded (Oogruk), meat, raw             P 26.7   <- "meat"
MISSED  Oil, bearded seal (Oogruk)                    P 0.56
CAUGHT  Beef, variety meats and by-products, heart    P 17.7   <- "beef"
...
oracle vegan-leak coverage on real rows: 11/25
```

**C19 is confirmed, and my measurement sharpens it.** A17 reported 1 of 13; on the real row
names I get more hits than that — but **every catch is an accident of USDA naming**. Oracle
catches `Squirrel`, `Bear` and `Seal` only because those rows happen to contain the generic
token `meat`, and `Heart` only because the row is titled `Beef, … heart`. The rows it misses
are the bare-noun ones — and they are the **high-protein** ones (28.1, 26.5, 23.9, 58.1 g/100 g)
— exactly what a protein-shortfall closer reaches for first. The check has no relationship to
what the food *is*.

**Also confirmed (A16's finding):** `Peanut Butter` false-positives as `tree nuts`
(`oracle.mjs:58,68`), and `Egg Plants` false-positives as animal-derived on a vegan plan. The
baseline's "5 leaks" are all artifacts.

**Second, separate defect — oracle's compliance metric is a different ruler.** `acceptOk` at
`oracle.mjs:194` is `|kcalDev| ≤ 0.05 && protein ≥ proteinLo − 5 g`. Five percent on calories,
no fat term, no carb term, no keto rule. `mealSolver.dayTolerance()` is ±15 % kcal, 15 % of the
protein midpoint, ±25 % of the fat/carb midpoints outside the band, zero carb over-allowance on
keto. **`oracle.daysInTol` and "days in band" are not the same quantity and must never appear
in the same table.**

### What a sufficient leak check must do

1. **Gate on identity, not on the name string.** Every `Food` row needs a stored, reviewed
   classification (animal / plant / dairy / egg / fish / shellfish / gluten-grain / …). A row
   with no classification **fails closed**, exactly as `exclusionGate.js` already does for
   degraded recipes. `Groundhog` is invisible to any word list and obvious to a one-bit column.
2. **Enumerate the candidate set, not the shipped plates.** The realized-leak count is zero
   today because no *recipe* contains these rows. The exposure is the macro closer's
   single-`Food` adjuster pool (`planContext.js:167-178`, `ADJUSTER_CANDIDATES`). Any change to
   that pool must diff the **whole candidate set** against the classification, before solving.
3. **Assert both directions, with a held-out safe list.** `sweep14k.mjs` already has the right
   shape (leak *and* false-exclusion, `KNOWN_SAFE` held out). It needs a better reference than
   a second hand-written word list.
4. **Fail on unclassified coverage, not just on hits.** Report `n rows in the candidate set
   carry no classification` as a **failure**, not a note. "Zero leaks found" over a corpus you
   cannot classify is not evidence.
5. **Cross-check against a genuinely different signal.** Name lists share vocabulary with the
   thing they audit. FDC food-group codes, ingredient→food category, and the presence of
   animal-only nutrients (B12, cholesterol > 0 with zero plant-sterol context) are independent
   axes. Two axes disagreeing is the finding.

> **Standing rule (C19, re-confirmed): "oracle says zero" is necessary, never sufficient.**
> Any pool/gate/candidate-set change must additionally check the candidate set **by name**
> against the C13 list *and* report its unclassified count.

---

## 6. Determinism and seeding

**MEASURED — the rig replays bit-identically.** Same command, same seed, twice:

```
records 639 / 639 · differing fields: solveMs only (445 records)
verdict flips between identical re-runs: 0  (b=0, c=0)
```

Every substantive field — slots, grams, achieved macros, verdicts, pins, honesty flags — is
identical. The only variation is wall-clock timing. **`compare.v2.mjs`'s
`BYTE-IDENTICAL day records` line does not exclude `solveMs`, so it systematically
under-reports identity.** Do not read a low byte-identical count as evidence of
non-determinism; check the field-level diff.

`rng.mjs` is sound: mulberry32 with integer-only ops, splitmix-mixed child seeds so adjacent
run indices are uncorrelated. `runRig.mjs:69-83` re-implements it identically. Seeding is
correct in both, and the seed registry (424242 primary / 20260730 / 8675309 replicates / 1337
smoke) is a real convention already in use.

**The standing lesson applies with force here.** The rig is *perfectly* reproducible and
*still* reports 70.1 % against a denominator that drops 16 total-failure days (§7). Determinism
bought exact discordant counts — which is genuinely valuable, because paired McNemar on a
deterministic instrument has **zero sampling noise in b and c** — but it bought nothing about
whether the number means what it says.

---

## 7. Statistical discrimination and the minimum detectable effect

### 7.1 A1's derivation verified

**DERIVED, arithmetic checked.** McNemar's standard error for the difference of correlated
proportions is `se = √(b + c − (b−c)²/n) / n`. A1's positive control, satisfiable-only:
`b=50, c=39, n=536` → `√(89 − 121/536)/536 = 9.4220/536 = 0.017578` → 1.758 pts →
95 % half-width `1.96 × 1.758 = 3.446` → **3.45 pts. Correct.**

The formula is the right one, and the general rule is cleaner than the single number. Since
`(b−c)²/n` is negligible for small deltas:

> **A treatment is real at 95 % when `|b − c| > 1.96·√(b + c)`.**

Checked against every measurement I have:

| comparison | b | c | b+c | \|b−c\| | 1.96·√(b+c) | verdict | matches reported? |
|---|---|---|---|---|---|---|---|
| A1 positive control | 50 | 39 | 89 | 11 | 18.5 | not real | ✓ ("interval spanned zero") |
| A1 baseline → D9 baseline | 24 | 28 | 52 | 4 | 14.1 | not real | ✓ ("NOISE, NOT A RESULT") |
| A15 fat ±50 % re-grade | 21 | 0 | 21 | 21 | 9.0 | real | ✓ (+4.0 pts) |
| A15 fat ±40 % re-grade | 10 | 0 | 10 | 10 | 6.2 | real, marginal | ✓ (called marginal) |
| D9 replay (self) | 0 | 0 | 0 | 0 | 0 | identical | ✓ |

### 7.2 Minimum detectable effect for the recommended harness

**DERIVED, at n = 537 satisfiable-judged days on today's tree.**

| treatment shape | requirement | days | pts |
|---|---|---|---|
| **Churning** (helps some days, hurts others) — the realistic case | `\|b−c\| > 1.96·√(b+c)`; at the observed churn levels (b+c = 52 to 89) | 14 → 19 net | **2.6 → 3.5 pts** |
| **One-directional** (`c = 0`), statistical floor | exact binomial: `2 × 0.5^b < 0.05` | **b ≥ 6** | 1.1 pts |
| **One-directional**, generalization floor | must also clear the cross-seed spread measured today (0.4 pts satisfiable, 3 seeds) — and, for anything that will be re-measured on the HTTP fleet, BRIEF.md's ±1.5 pts | **b ≥ 9** | **1.5 pts** |

**The prior "≥3.5 pts churning / ~1.5 pts and ~9 days one-directional" guidance is correct and
I endorse it unchanged.** The 1.5-pt one-directional floor is not a significance threshold —
statistically 6 days suffices on a deterministic instrument — it is a *reproducibility* floor
imported from the HTTP fleet's run-to-run variance. That is the right conservatism, because a
delta measured on the rig will eventually be re-measured on the fleet, and a 1.1-pt rig win
would vanish there.

> **The number the fix effort needs: on the recommended harness, nothing below 3.5 pts is
> reportable unless you can show `c = 0` and `b ≥ 9`, replicated across all three seeds.**
> Getting from 77 % to 85 % is 8 points — roughly **43 flipped days**, comfortably measurable.
> Getting from 77 % to 79 % is not measurable as a single treatment on this instrument.

### 7.3 Statistical power is not the binding constraint — bookkeeping is

Two live traps, both larger than the MDE.

**(a) Persona-level denominator movement, HTTP fleet.** 38 of 250 personas contribute **zero
days** because `gainDirectionGate` 400s them (**MEASURED**: exactly the 38 personas with
`goalWeightKg > startWeightKg + 0.5`, all `lean bulk`/`recomp`). Any change to a profile gate
moves the denominator by up to 15 % of the population, with no solver change at all. The rig is
immune — it loads `personas.jsonl` directly and never calls the profile route.

**(b) Day-level denominator movement, inside the recommended rig.** **MEASURED, and this is a
defect in the instrument I am recommending:**

```
A1/rig/schema.mjs:83   judged: filled.length > 0
```

```
planned 639 · judged 623 · UNJUDGED (dropped from denominator) 16
unjudged by tier: { HARD: 7, EASY: 9 } · satisfiable & unjudged: 16
```

**All 16 dropped days are satisfiable, and all 16 are total failures** — zero slots filled. The
rig's PRIMARY denominator silently discards them. A treatment that makes the solver refuse more
days would **raise** the reported satisfiable rate by removing its own hardest cases. This is
exactly the inflation trap C21 names, sitting inside the instrument C16 recommended.

For contrast, the HTTP fleet gets this right at the day level: **MEASURED**, its 578 days
include 17 zero-kcal days, and **0 of the 17 are counted in band**.

`compare.v2.mjs` already prints the fix — `ALL PLANNED DAYS (refused/empty day counted as a
miss)`, n = 639 — but labels it third and does not gate on it. **It must be promoted to a
mandatory co-report.**

---

## 8. The measurement protocol — copy-pasteable

### 8.1 Before any measured run (once per session)

```bash
cd C:/Users/<account>/Desktop/cut-protocol

# 1. Pin the tree. The baseline is NOT a commit — record the diff, not a SHA.
git rev-parse HEAD
git diff --stat        # >>> paste this into your report; it is part of the baseline identity

# 2. Pin the data. If this hash changes mid-campaign, every earlier arm is void.
sha256sum backend/prisma/dev.db

# 3. Refresh your isolated DB copy and prove it matches.
cd docs/surgery/CAMPAIGN/solver-brain/A1/rig
node checkdb.mjs <YOUR-ID> --fix        # must print OK and matching hashes
```

### 8.2 The A/B, every treatment, every time

```bash
cd C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A1/rig
ME=<YOUR-ID>
OUT=C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/$ME

# BASELINE — re-run it NOW, in this session, on this tree. Never reuse a stored one.
for S in 424242 20260730 8675309; do
  node runRig.mjs --agent=$ME --pop=personas --seed=$S --label=baseline \
    --out=$OUT/$ME-baseline-s$S.jsonl
done

# TREATMENT — one mechanism, in its own file, with your id in the filename.
for S in 424242 20260730 8675309; do
  node runRig.mjs --agent=$ME --pop=personas --seed=$S --label=mymech \
    --treatment=./treatments/$ME-mymech.mjs --out=$OUT/$ME-mymech-s$S.jsonl
done

# COMPARE — paired, per seed. v2 only; v1 reports the wrong interval.
for S in 424242 20260730 8675309; do
  node compare.v2.mjs $OUT/$ME-baseline-s$S.jsonl $OUT/$ME-mymech-s$S.jsonl \
    --json=$OUT/$ME-ab-s$S.json
done
```

### 8.3 Acceptance gates — all must hold, or the result is void

1. **`INSTRUMENT CHECKS` reads all zeros** on every arm: `verdict-disagreements 0 ·
   kcal-drift>1 0 · crashes 0 · invalid records 0`.
2. **No `*** COMPARABILITY PROBLEMS ***`** block. A food-fingerprint mismatch means the two
   arms saw different nutrition data — throw the comparison away and re-run the baseline.
3. **Silent misses did not rise.** A rise is a honesty regression and disqualifies the
   treatment outright, whatever it did to compliance.
4. **Report all three denominators, always, in this order:**
   - `satisfiable-judged` (n ≈ 537) — **primary**
   - `all planned days` (n = 639) — **the anti-inflation guard. If the treatment moves this
     less than it moves the primary, it bought points by refusing days.** Never omit it.
   - `all judged` (n ≈ 623) — secondary
   Report `judged` and `unjudged` counts for **both** arms explicitly. If `unjudged` rose, say
   so in the same sentence as the delta.
5. **Never mix denominators across rows of one table**, and never cross an HTTP-fleet number
   (578 / 526) with a rig number (623 / 537). The satisfiable-only denominator alone has been
   published at **495, 502, 526** (fleet, three different impossible-tier rules) and **536,
   537** (rig). Name yours in every table header.
6. **Significance:** paired McNemar only. `|b − c| > 1.96·√(b + c)`, at all three seeds, same
   sign. Unpaired Wilson intervals at n≈537 are ±5 pts wide and will file a real +3 pt effect
   as nothing.
7. **Leaks:** if the treatment touches the pool, the exclusion path, or the adjuster candidate
   list, run `backend/scripts/qc/oracle.mjs` **and** diff the candidate set by name against the
   C13 list **and** report how many candidate rows carry no usable classification. Oracle
   reporting zero is not a pass (§5).
8. **Levels vs deltas.** Cite the **HTTP fleet** for a standalone level (70.1 % / the 526-day
   satisfiable figure). Cite the **rig** only for deltas between its own runs, in the same
   session, on the same tree and DB.

### 8.4 What to do about the golden

Expect `tests/golden/goldenBaseline.test.js` to fail. Read the diff for scope, confirm the
change is the one you intended, then regenerate:

```bash
cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\n'))"
```

Then run the full suite and confirm 0 failures. **A golden regeneration is never evidence of
improvement** — record the rig delta alongside it, or the change has no measured effect at all.

---

## 9. What I could NOT determine

1. **Whether a fresh HTTP-fleet run reproduces 405/578 today.** I did not run `fleet.mjs`. It
   requires a live server on a 39xx port and mints 250 users into whatever DB `DATABASE_URL`
   names, and its outputs (`results.jsonl`, `stats.json`, `raw/*`) are written to `HOME` —
   re-running in place would **destroy the campaign's primary evidence**. Reproducing it safely
   means copying the whole harness to a path exactly 5 segments below the repo root (`lib.mjs`
   computes `REPO` by `path.resolve(HOME, '..'×5)`) and keeping the directory name
   `qa-fleet-20260729-2032` (the persona seed is `sha256(basename(HOME))`). I judged the cost
   and the destruction risk too high against a rig that already corroborates the level to
   within 0.3 pts. **The fresh-fleet reproduction remains open.**
2. **Which exact `dev.db` produced 405/578.** Neither `stats.json` nor `results.jsonl` records a
   DB hash. `backup/dev.db.fleet-baseline` (19.4 MB) is the *pre*-fix DB; the run applied data
   fixes mid-campaign and re-measured at 14:34. `DEVDB-BASELINE.txt` (`e55f52e5…`) was written
   ~6.5 h after that remeasure, and three `dev.db.backup-overrides-2026073016*` files with three
   distinct hashes sit in between. **The exact food data behind 70.1 % is not recoverable from
   what is on disk.** Every future run must record its own DB hash — the rig already does
   (`run.dbHash`, `run.foodFingerprint`); the fleet does not.
3. **Whether `lib.mjs`'s transcribed `judgeDay` still matches `mealSolver.dayTolerance()`.** I
   read both and they agree term-for-term, but I did not execute a differential over a day
   corpus. The run's own `verdict-disagreements: 0` is indirect evidence. `INFERRED`.
4. **Whether the 3 pts of tier drift I found in the re-score matter.** `stats.json` reports
   `impossibleTier` with 32 personas; my re-score sees 29 personas with plans in the
   IMPOSSIBLE tier. The gap is the 3 impossible-tier personas who were profile-blocked. I did
   not chase whether A3's 526-day rule accounted for them.
5. **The realized-leak status of the current adjuster pool.** I confirmed oracle cannot find
   the C13 rows; I did not enumerate today's `ADJUSTER_CANDIDATES` output against the whole
   `Food` table. A20 owns that; my §5.2 recommendation stands regardless.
6. **Whether `mc.mjs` / `sweep14k.mjs` / `integritySweep.mjs` pass today.** I did not run them
   — they write to shared `docs/qc/` paths with no agent id, which would overwrite artifacts I
   did not create. Their code is reviewed, not executed. `INFERRED`.
7. **Anything about `BRAIN=on`.** Every measurement here is `BRAIN=off`, forced by the
   harnesses. The brain's effect on compliance is unmeasured by every instrument in my
   territory.

---

## 10. One-paragraph summary for the build prompt

Use `A1/rig/runRig.mjs` with `--pop=personas` at seeds 424242 / 20260730 / 8675309, compare with
`compare.v2.mjs`, and report the **satisfiable-judged (n≈537)** rate *alongside* the **all-planned
(n=639)** rate — the second is not optional, because the rig's primary denominator silently drops
16 satisfiable total-failure days and will reward a treatment for refusing hard days. Re-run your
own baseline every session: the campaign's stored baselines were produced on different source and
different food data, and 514 of 639 day records have changed since. The baseline is an uncommitted
working tree plus a `dev.db` that has already moved twice — record `git diff --stat` and the DB
sha256 as part of every result. Nothing below 3.5 pts is reportable for a churning treatment;
`c = 0` with `b ≥ 9` at all three seeds is the only way to claim less. Of the test suite, only
`solverHonesty.test.js` and `exclusionGate.test.js` are load-bearing, and neither measures
compliance — they guard honesty and architecture, which are the two properties a compliance push
is most likely to break. The golden baseline is a snapshot that has locked a 3/7-day week through
three regenerations; expect it to fail, read the diff, regenerate, and never cite it as evidence.
`oracle.mjs` reporting zero leaks means nothing on its own.
