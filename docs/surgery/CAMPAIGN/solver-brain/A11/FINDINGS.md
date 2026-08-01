# A11 · Pool density — pool-limited or solver-limited, per diet

*Agent A11. Persisted to disk by the fleet coordinator from A11's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A11's.
A11's 13 CSVs and its 20 `CLAIMS.tsv` rows DID land.*

**Null result first: almost nothing is pool-limited.** Of 218 *satisfiable* personas, **5
are pool-limited (2.3 %)** — 4 vegetarian, 1 carnivore. **Zero** for keto, vegan, paleo,
kosher, halal, mediterranean, none. The weak corners the fleet flagged (keto 62.0 %, vegan
59.3 %, vegetarian 58.7 %, paleo 64.7 %, kosher 72.2 %) are, with one partial exception,
**solver-limited**. MEASURED.

**Operationally: the owner's authoring money belongs almost entirely in vegetarian.
Everything else goes to A13/A18/A19's solver mechanisms.**

## Instrument check (done first)

`SELECT COUNT(*) FROM Recipe` = **910**, `Food` = **14,151**, loaded rows = 910. Not the
626-recipe failure mode. MEASURED. Gate is the product path, imported read-only:
`planContext.js:49` — `return stampDietGuard(filterRecipes(recipePool, profile), dietaryStyle)`
— and A11 calls that same `filterRecipes`, which is `exclusionGate.js:295` —
`return partitionRecipes(recipes, profile).allowed`. Gate cross-check passed: vegan ⊂
vegetarian held on all 169 rows.

## The test used

A day's macro-per-kcal vector is *exactly* a kcal-weighted convex combination of its slots'
vectors (scaling a recipe leaves its ratios unchanged). So the achievable set is the
**convex hull** of survivors' ratio points. **Pool-limited** = the tolerance-widened target
box (from `dayTolerance()`, over day-kcal ∈ ±15 %) does not intersect that hull —
unreachable by any choice or scaling. **Solver-limited** = it intersects but the solver
misses. Hull distance via Frank-Wolfe, 400 iters, axes scaled to band units. By
Carathéodory, hull membership in 3-D needs ≤4 recipes and a day has 4–6 slots — **so slot
count is not the binding constraint.** DERIVED.

## Where the 23 all-population pool-limited cases live

**18 of 23 are vegan IMPOSSIBLE-tier** — the engineered-unsatisfiable customers whose
correct output is a refusal. Counting them as an authoring signal would aim the owner's
money at customers the app should decline. MEASURED.

## The real structural finding (input for A16)

Pool size is not pool quality. Target **protein** median across satisfiable personas is
**8.16 g/100 kcal**; every style's pool median is below it (none 5.39, vegan 5.08,
vegetarian **3.25**). Target **fat** median is **2.60 g/100 kcal** against pool medians
~4.0–4.2 — **the pool is fattier and less protein-dense than any target.** The solver must
work the joint right tail on protein and left tail on fat simultaneously, in every corner.

**Vegetarian is the thinnest corner and the only real authoring target.** 401 recipes (2.4×
vegan's 169) yet the *worst* protein density of all nine styles: the 232 recipes vegetarian
admits over vegan have median protein **2.42 g/100 kcal** (Churros, Eton Mess, Bulgarian
Honey Cookies). All 4 vegetarian pool-limited cases fail on the **protein** axis. MEASURED.

**Keto is the counter-example.** Smallest mainstream pool (41 survivors mean, 53 pure) but
the *highest* in-band density (29.0 %; 92.7 % of survivors fat-OK). Small and well-aimed.
Its 62.0 % is solver-limited; authoring keto recipes buys little.

## Per-style, satisfiable only (218 personas)

| style | n | mean survivors | % all-4 in band | % protein-ok | % fat-ok | % carb-ok | pool-limited |
|---|---|---|---|---|---|---|---|
| vegetarian | 21 | 237 | 9.56 | 27.44 | 44.34 | 48.60 | **4** |
| paleo | 12 | 131 | 10.74 | 46.49 | 33.41 | 44.63 | 0 |
| vegan | 11 | 130 | 12.82 | 43.09 | 37.21 | 73.54 | 0 |
| carnivore | 2 | 2 | 16.67 | 83.33 | 16.67 | 33.33 | **1** |
| none | 120 | 577 | 16.87 | 45.32 | 45.27 | 58.00 | 0 |
| mediterranean | 19 | 530 | 17.48 | 45.29 | 44.73 | 58.14 | 0 |
| kosher | 11 | 461 | 18.80 | 50.03 | 47.34 | 57.02 | 0 |
| halal | 6 | 553 | 23.84 | 55.94 | 42.12 | 69.89 | 0 |
| keto | 16 | 41 | 29.04 | 67.70 | **92.70** | 47.67 | 0 |

## Pure-style pools, fat g/100 kcal (no allergens)

| style | survivors | % of 910 | min | q1 | med | q3 | max | skew | prot med | carb med |
|---|---|---|---|---|---|---|---|---|---|---|
| none | 910 | 100 | 0.03 | 2.63 | 4.20 | 5.75 | 10.96 | +0.16 | 5.39 | 9.78 |
| mediterranean | 814 | 89.45 | 0.03 | 2.63 | 4.17 | 5.73 | 10.96 | +0.19 | 5.58 | 9.78 |
| halal | 758 | 83.30 | 0.03 | 2.52 | 3.97 | 5.49 | 10.96 | +0.21 | 5.66 | 10.10 |
| kosher | 680 | 74.73 | 0.03 | 2.52 | 3.99 | 5.49 | 10.96 | +0.22 | 5.29 | 10.32 |
| vegetarian | 401 | 44.07 | 0.03 | 2.54 | 4.02 | 5.56 | 10.96 | +0.16 | **3.25** | 11.92 |
| vegan | 169 | 18.57 | 0.03 | 2.26 | 3.81 | 4.59 | 10.96 | −0.09 | 5.08 | 11.54 |
| paleo | 167 | 18.35 | 0.03 | 2.82 | 4.62 | 6.46 | 10.96 | +0.08 | 5.86 | 8.67 |
| keto | 53 | 5.82 | 0.43 | 5.89 | 6.87 | 7.98 | 10.96 | +0.06 | 7.65 | 1.74 |
| carnivore | 3 | 0.33 | 2.39 | 3.37 | 4.35 | 5.92 | 7.49 | +0.56 | 7.49 | 10.65 |

Shape: fat-per-kcal is unimodal and near-symmetric (|skew| ≤ 0.22) for every style except
carnivore (n=3). Not long-tailed — the mass sits *above* target.

## Contradiction with the BRIEF (flagged loudly, per rule 12)

The brief calls fat "the largest single cause of missed days." On this corpus **protein is
the binding axis**: it is the failure axis on every vegetarian pool-limited case, and
protein-ok density is below fat-ok density in 6 of 9 styles. Fat is the *tightest band*,
which is not the same as the *scarcest ratio*. ESTIMATED as a causal claim — A13/A18/A19 own
solve-side confirmation.

## Caveats

- Ratios use stored `Recipe.kcal/protein/fat/carb`; no recomputation from `Food` rows.
- Hull test relaxes the 0.5–2× scale bounds and slotType matching. A hull-feasible corner
  can still be unreachable *under those bounds* — that is exactly the "68.3 % of missed
  slots pinned at a scale bound" fact, and it is a **solver** constraint, not a pool one.
- `personas.mjs` is a generator script, not a module; running it rewrote `personas.jsonl` in
  the QA directory. Deterministic (seed 1387006667, 250 unique tuples), so content is
  identical — flagged rather than hidden.
- Guard block recorded: `docs/surgery/CAMPAIGN/` is create-only, so `A11-density.cjs` could
  not be edited; the runnable copy is `A11-density-run.cjs` (adds one `module.paths.push`
  line). Not bypassed.
- DB isolation honored: all reads against the absolute-path copy in the A11 directory. The
  owner's live database was never written.

## Artifacts (all `A11`-prefixed)

13 CSVs: `A11-survivors-{none,mediterranean,halal,kosher,vegetarian,vegan,paleo,keto,carnivore}.csv`
(per-recipe ratio rows), `A11-style-density.csv`, `A11-persona-corners.csv` (250 rows,
per-persona verdict + hull gap + gap axis), `A11-style-verdicts.csv`,
`A11-satisfiable-axis-density.csv`. Script: `A11-density-run.cjs`. 20 claims appended to
`CLAIMS.tsv`.

**CONFIRMED**
