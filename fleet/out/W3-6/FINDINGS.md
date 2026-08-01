# W3-6 — VEGAN NICHE INSERTION PROBE

*Persisted by orchestrator. Artifacts: `results.json`, `score.json`, `coverage-arm{A,B}.json`, `leaksweep-arm{A,B}.json`, `inserted-arm{A,B}.json`, 9 dumps. Code: `fleet/scratch/W3-6/` (`insert.mjs --revert` removes every `fleet-probe` row).*

**Real DB `d9037dce…b623a1` byte-identical after.** `BRAIN=off` · **network calls 0 in all 9 runs** (trapped) · instrument checks 0 · **baseline reproduces W1-2 byte-exact** (553 = 415/418/413).

## What I inserted, and what I skipped

**Foods: 1.** Only one of W2-3's foods is genuinely absent — **nutritional yeast** (FDC Branded 2596118, Bob's Red Mill), tagged **LABEL** (a brand-submitted panel, not USDA lab work), `source='fleet-probe'`, **`fdcCategory` pinned to `Baking Additives & Extracts`** (verified against `FDC_CATEGORY_FAMILIES`: maps to **no allergen family**). Passes `checkAtwater` on the high-fibre 30% arm; `checkNameShape` clean.

> **Correction to W2-3:** it flagged split peas, frozen green peas, frozen kale, frozen Brussels sprouts, frozen mustard greens and sprouted lentils as absent. **All six are already rows. 20 of the 21 foods its dishes need already exist. The gap is authoring only — more completely than W2-3 claimed.**

**Recipes: 10 of 12**, all `slotType: snack`, all `mealCategory: null` (none in the four barred at `weeklyPlanner.js:185`), **macros recomputed from the DB's own Food rows** via `computeRecipeMacros` — no typed-in numbers. All 10 pass `checkAtwater`.

**Skipped, named:**
- **#12 Lupini Snack Jar — TRIAGE T-3.** The best box-clearing snack-shaped whole food that exists (Pd 12.95), and the wall includes peanuts. **Shipping it converts a P1-latent into a shipped P0 for exactly this population.**
- **#4 Sprouted Lentil Bowl — Atwater.** Its base is ~70% of the dish's calories and that row fails `checkAtwater` (106 stated vs 129 classic, no fibre datum). Material, not a garnish.
- **T-1:** no powder, isolate or "nutritional powder mix". `insert.mjs` carries **three throw-guards** (blocked category / powder-isolate-whey name / lupin name) that fire **before any write.**
- Spirulina (Atwater), the Bulk Barn yeast (**declares *may contain wheat***), both pastas and both roasted-snack rows (miss the box).

**One honest miss:** *Split-Pea & Dill* lands at **Pd 8.13 vs the 8.16 floor.** W2-3 published 8.18 using a 41 kcal `manual` carrot row; I used the usda-verified 45 kcal one for provenance. **A 5 kcal/100 g difference in a 40 g garnish decided box membership** — W2-3's own "don't build a claim on a 0.13 g margin" caution, realised.

## The brand seam — decided, and it is TOTAL

Both arms run, differing in **exactly one field** (`Food.mayContain` on the yeast row).

| | arm A — **BRM basis, single-basis, honest** | arm B — **mixed basis, counterfactual ceiling** |
|---|---|---|
| macros | BRM (LABEL) | BRM (LABEL) |
| allergens | BRM's own *may contain soybean + tree nuts* | Bragg-class *declared free* → `[]` |
| production pool, vegan + **the wall** | **0 of 10** | **10 of 10** |
| vegan + soy only / tree nuts only | **0 / 0** | 10 / 10 |

I refused `mayContain: null` for arm B — **that replicates T-1's fail-open exactly**; `[]` is the schema's "source explicitly declared none". Arm B's row is prefixed `exception:mixed-basis` and **must never be merged.**

> **W2-3's warning is confirmed and it is not marginal — it is total.** With the honest allergen basis the whole dish set is invisible not just to the wall but to **any** soy- or nut-allergic user.

## Compliance delta — REAL, and attributed to the wrong macro if you are not careful

Paired McNemar, pooled 3 seeds, canonical **553**:

| arm | pooled level | b | c | **Δ** | detection floor | χ²cc |
|---|---|--:|--:|--:|--:|--:|
| base | 1246/1659 = 75.11% | — | — | — | — | — |
| **A** | 1374/1659 = **82.82%** | 17 | 145 | **+7.72 pt** | ±1.50 | 99.6 |
| **B** | 1394/1659 = **84.03%** | 42 | 190 | **+8.92 pt** | ±1.80 | 93.1 |

**NOT noise** — 5× the paired floor, >8× the 0.9-pt seed spread; per-seed spread 0.54 pt.

> **But the mechanism is FAT, not protein.** Of 145 rescued days (arm A), **99 were failing on `fat:over`** and only **3** on protein at all. These dishes have Fd 0.41–1.09 against a snack-pool median of **5.35**. And the displacement is explicit: **562 placements, but empty snack slots moved only 424 → 412 — 550 of 562 placements DISPLACED A FATTIER SNACK rather than filling an empty one.** Regressions are carb-over (12/30), the price of legume bases.

**Vegan segment** (n=35 satisfiable-judged, **pooled only** — the 14.3-pt cross-seed spread makes single-seed cells meaningless): 54.29% → **79.05%** (A) → **83.81%** (B); paired +24.76 / +29.52 against floors ±10.56 / ±11.35.

**Wall segment: exactly ZERO. n=162 planned days, b=0, c=0, all three arms.** All 18 wall personas are tier `IMPOSSIBLE` and excluded from the canonical denominator by construction — 17 are W1-2's F1 `aboveMaxGate` set verbatim.

## Coverage delta — the number the compliance KPI cannot see

| metric | base | arm A | arm B |
|---|--:|--:|--:|
| empty snack slots / seed | **141/794** *(reproduces W1-5 exactly)* | 137 | **45** |
| …vegan (pooled) | 216/345 | 204 | **54** |
| …**wall** (pooled) | **204/204 (100%)** | **204/204** | **54/204 (73.5% eliminated)** |
| arithmetically unfillable snack slots | 139 | 135 | **43** |
| personas with **zero** snack pool | 20 | 20 | **2** |
| **wall** personas with zero snack pool | **18** | **18** | **0** |
| **wall** personas with ≥1 snack clearing their OWN protein gate | **0** | **0** | **18** |
| meal slots empty | 150/6651 | 150 | 150 *(untouched, as designed)* |

**Did any of the 18 get a fillable snack slot? Under arm A: no, not one. Under arm B: all 18 — but only four dishes each.**

### The finding W2-3 and W1-5 both missed: `legumes`

> **All 18 wall personas ALSO exclude `legumes` — 18 of 18.** Neither W2-3's five-term wall nor W1-5's "soy+gluten+nuts+sesame" label carries it. **The gate correctly excludes 6 of the 10 dishes on `legumes` even under arm B's wall-safe yeast.** Only the four pure vegetable + nooch dishes reach them — Mushroom & Spinach (115 kcal), Asparagus (100), Broccoli & Mushroom (115), Brussels & Kale (124).

That means **W2-3's "exactly ONE calorie-carrying whole plant food clears the box unaided — sprouted lentils" was unusable for this population twice over: it fails Atwater AND it is a legume.** The genuine ceiling for the 18 is W2-3's own category 1 — vegetables under 45 kcal/100 g that, in its words, *"steer a slot but cannot fill one."* **Their snack slots demand more than 100–124 kcal.**

## Leak sweep — **0 leaks, both arms**, with a FIRING positive control

Direct assertions on `foodMatchesExclusionTerm` / `adjusterExcludedByStyle` / `exclusionGate.isExcluded` plus the production `filterRecipePool` path. **`oracle.mjs` not used (K3).** 30 terms × 11 rows both directions, plus all **51** `allergenCatalog` keys × 10 dishes, plus 10 styles.

> **Positive control fires:** the *same* probe row re-filed into `Protein and nutritional powders` with metadata stripped **is cleared for soy, dairy and vegan. T-1's mechanism reproduces on a brand-new row — it is a property of the GATE, not of the 17 legacy rows.** The zero is therefore **informative, not vacuous.**

Correct exclusions confirmed in both directions: arm A excludes all 11 rows for soy and the full tree-nut family via the trace (`TRACE_POLICY_DEFAULT = exclude`, working); all 10 dishes excluded for `yeast`; 6 for `legumes`; 3 for `nightshades`; 1 for `alliums`; carnivore excludes all 10; **zero false hits** on gluten, wheat, dairy, milk, eggs, fish, shellfish, peanuts, mustard, celery, sulphites, lupin, corn.

### Two new H5 specimens, found *because* I authored

Both are **over-exclusions (fail-safe), not leaks** — so no TRIAGE entry. **Both were hit live by my own first drafts:**
1. **Prose has no polarity.** `foodMatchesExclusionTerm({name:'made without sesame oil'},'sesame') === true`; `('contains no milk','dairy') === true`. A `-free` guard exists (`'peanut-free facility'` → false) but "made without X" / "contains no X" are not covered. **My draft step *"…the roasted snack packs are made with sesame oil"* — a SAFETY WARNING — hid the dish from every sesame-allergic user. The app has no field in which "does not contain X" can be stated.**
2. **Unrecognised free-text terms match by bare substring.** `resolveExclusionTerm('oats')` → `{kind:'literal', recognised:false}`; `('Goat cheese','oats') === true`, `('Sunflower seed butter','sun') === true`. **None of `WORD_GUARDS`' word-boundary machinery applies.** My draft step *"…until every lentil is **coat**ed"* excluded the dish for anyone typing "oats". **`Profile.excludedFoods` is free text, so the blast radius is user-driven and unbounded.**

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **C3** | A16 concentrate/snack enrichment **+10.45 gross**, +7.46 marginal over C1 | **Snack enrichment ALONE — 10 recipes, 1 food row, ZERO concentrates — buys +7.72 pt** (b=17 c=145, floor ±1.50, χ²cc 99.6); arm B +8.92 | **CONFIRMED — and the concentrate half is unnecessary**, which matters because **T-1 blocks it**. **Marginality over C1 UNTESTED** — do not promote +7.46. Caveat: 10 recipes against an 18-recipe snack pool is a **56% enlargement of the library's smallest pool** |
| **F5** | 18 snack-eligible; 141/193 empty slots are snacks; misses provably pool-caused | **141/794 reproduces exactly.** Causal claim now **demonstrated constructively**: 10 recipes, **zero solver change**, empty snack slots **141 → 45**/seed, 18 personas from zero pool to non-empty, **meal slots untouched at 150/6651** | **CONFIRMED — upgraded from inference to DEMONSTRATION.** Refinement: arm A raised compliance +7.72 while eliminating only **4** empty snack slots — **filling slots and passing the band are near-independent** |
| **F2** | density gap nearly inert; may measure ZERO | Of 145 rescued days, **3** failed on protein and **99** on fat-over. On the population F2 is about — demanded density above pool max — the delta is **exactly 0** (n=162, b=0, c=0, all arms) | **CONFIRMED.** **Anyone reading +7.72 pt as vindication of "the library is too weak on protein" has attributed it to the wrong macro. F2's 3.4 pt and this 7.7 pt are different quantities and must never be summed** |

## Honest limits

**T-2 stands:** this is a **declared-ground-truth sweep over 11 rows**, not the full false-negative sweep. It cannot bound how many *other* rows leak. **Arm B's numbers bound a ceiling, not a shippable result** — shipping its coverage needs a sourced Bragg-class per-100 g panel, which W2-3 could not obtain and I did not attempt (zero network). **Wall compliance is zero because all 18 are `IMPOSSIBLE` — the correct denominator, but it means the compliance KPI is structurally blind to the population this probe was commissioned to serve.** Favism (fava dish, G6PD) is a haemolytic non-allergic hazard no taxonomy models — **"zero leaks" is not "zero hazards."**

**Blockers reported, not worked around:** harness blocks `.md` writes; `dayDump.mjs` resolves `--out` against REPO not cwd, so the first run wrote outside the repo (relocated, stray dir removed); my first `score.mjs` pooled seeds on a key omitting the seed, silently collapsing the paired table to one seed — **caught by an n=553 that should have been 1659**, fixed, fix commented in the file.

## Summary

Inserted **1 food + 10 snack recipes**, all Atwater-passing, all `slotType:snack`, all `source='fleet-probe'`; **skipped Lupini (T-3), Sprouted Lentil Bowl (Atwater), and every powder (T-1).** **Compliance +7.72 pt (arm A) / +8.92 (arm B) — NOT noise** — **but the gain is FAT, not protein** (99 of 145 rescued days were `fat:over`; 550 of 562 placements displaced a fattier snack). **Coverage: empty snack slots 141 → 45/seed; zero-snack-pool personas 20 → 2; wall personas with a qualifying snack 0 → 18 (arm B only).** **Arm A coverage for the wall is ZERO — the brand decides the wall, confirmed and total.** **New finding: all 18 wall personas also exclude `legumes`**, killing 6 of 10 dishes; only 4 vegetable dishes (100–124 kcal) reach them. **Leaks: 0, both arms, with a firing positive control that reproduces T-1's mechanism on a fresh row.** Two new H5 over-exclusions found by authoring: **allergen prose has no polarity**, and **unrecognised free-text terms match by bare substring.**

**Recommendation: ship the 4 legume-free vegetable+nooch dishes as a correctness fix for 18 personas who have nothing — but first source a Bragg-class panel, because arm A is what ships otherwise and it delivers them zero. The +7.7 pt is a real, separate, whole-population FAT win worth taking on its own terms.**
