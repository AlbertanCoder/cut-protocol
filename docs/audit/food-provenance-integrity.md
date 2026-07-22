# Food provenance integrity — corruption, repair, and the import that replaces it

Track: `track/food-integrity-usda` · 2026-07-21

The Food table's highest trust tier was lying. 738 rows claimed a USDA
FoodData Central id; 472 of them did not describe the food whose id they
carried, and many carried that food's macros verbatim. 98.3% of recipes
(874 of 889) referenced at least one affected row.

This document records what happened, how far it reached, exactly what was
changed, and what was deliberately left unresolved.

---

## 1. What happened

`fdcId 170160` is USDA **"Nuts, almond paste"** — 458 kcal, 9 g protein,
27.7 g fat, 47.8 g carb per 100 g. That id and those five numbers were also
stamped on:

| Row | Real value (approx) | Stored |
|---|---|---|
| Red Curry Paste | ~100 kcal | 458 kcal |
| Ginger Garlic Paste | ~80 kcal | 458 kcal |
| Galangal Paste | ~90 kcal | 458 kcal |
| Madras Paste | ~100 kcal | 458 kcal |
| Tahini Paste | ~595 kcal | 458 kcal |
| Chilli Bean Paste | — | 458 kcal |

All six were tagged `source: "usda"`, the tier the UI presents as verified.

**Root cause.** The ids did not come from a USDA lookup in this app. They were
baked into the ported recipe library, `backend/src/lib/portedFromRecomp/
recipeLibrary.mjs`, where each ingredient line already carries an `fdcId`:

```json
{ "name": "Ginger Garlic Paste", "grams": 9.4, "state": "raw", "fdcId": 170160 }
{ "name": "Galangal Paste",      "grams": 18.8, "state": "raw", "fdcId": 170160 }
```

Those were produced by recomp-v1 matching ingredient names to FDC records by
scored name similarity. "Red Curry **Paste**" scored high enough against
"Nuts, almond **paste**" to inherit its identity. The seeder then created Food
rows from those ids plus the cached macros, and the wrong number became
"USDA-verified".

This is the failure mode of every threshold-on-a-similarity-score matcher:
somewhere on the scale there is always a wrong food scoring just above the
line.

## 2. Blast radius

Measured, not estimated:

| | Count |
|---|---|
| Foods before | 864 |
| Rows claiming an fdcId | 738 |
| Duplicate-fdcId groups | 140 (382 rows) |
| ...spanning more than one food category | 28 |
| Rows whose provenance did not survive verification | **472 (64%)** |
| Recipes referencing ≥1 repaired food | **874 / 889 (98.3%)** |
| Recipes referencing ≥1 *downgraded* food | 779 / 889 (87.6%) |

**The duplicate-fdcId view understated the problem.** Duplicates are the most
*detectable* symptom, not the extent. Of the 472 rows that failed
verification, **233 were singletons** — sole claimants of an id, invisible to
any duplicate check, and just as wrong:

| Row | fdcId actually points at |
|---|---|
| Birds-eye Chillies | Caribou, eye, raw (Alaska Native) |
| Broad Beans | Fish, whitefish, broad, liver (Alaska Native) |
| Baby Aubergine | Spinach, baby |
| Black Pudding | Corn pudding, home prepared |
| Cheese Curds | Soybean, curd cheese |
| Chicken Bouillon Powder | Soup, **beef** broth or bouillon, powder, dry |
| Almonds | Flour, almond |
| Achiote Seeds | Seeds, breadfruit seeds, boiled |

## 3. How each row was judged

Ground truth is the FDC bulk data itself (Foundation + SR Legacy + FNDDS —
13,545 usable records). For every row claiming an id, its name was compared to
that id's real USDA description.

There is **no similarity score anywhere in this logic** — that is what caused
the bug. Both directions are set containment over stemmed tokens, and every
decision is explainable as a list of words
(`backend/scripts/lib/fdcMatch.js`):

- **R ⊆ F** — the row name may not introduce a token the FDC description
  lacks. `curry`, `tahini`, `galangal` are instantly disqualifying.
- **F ⊆ R** — the description's distinguishing tokens must all appear in the
  name. `Rice` cannot claim *Rice crackers*; `Tomato` cannot claim
  *Tomato powder*.

Three narrow, individually reviewable vocabularies soften the second direction:

1. **FDC's leading taxonomy noun** — "Nuts, almond paste" → "almond paste", so
   `Almond Paste` matches. The group word alone still can't claim a member:
   `Cheese` cannot claim *Cheese, cheddar*.
2. **Preparation qualifiers** (`home`, `prepared`, `commercial`, …) — so
   `Beef Stock` matches *Soup, stock, beef, home-prepared*.
3. **Soft cooking states** (`raw`, `cooked`, …), and only when the name states
   no conflicting state — so `Blueberries` matches *Blueberries, raw*. These
   are flagged separately (50 rows) because the row's numbers already came
   from that record, so keeping the pointer asserts nothing new. Hard state
   changes (`dried`, `canned`, `powder`) are never droppable — they are
   different foods.

A curated synonym table covers dialect facts (`aubergine`=`eggplant`,
`courgette`=`zucchini`, `prawn`=`shrimp`). Deliberately **excluded**:
`chilli`→`pepper`, `capsicum`→`pepper`, `coriander`→`cilantro` — those are
conflations, and the first is precisely what put banana-pepper macros on
Habanero, Kampot and Sichuan "Pepper" rows.

### Re-derivation, and its one deleted rule

A row that failed verification was re-matched **only** if exactly one FDC
description had precisely its tokens, and the candidate then passed the full
validator under the row's own name. Ambiguity is a refusal, not a tie-break.

An earlier revision also accepted "the name equals the description's
distinguishing tokens after dropping FDC's leading noun". Run against the real
corpus, that rule proposed:

```
Onion    -> Bread, onion       Tomato   -> Soup, tomato
Garlic   -> Roll, garlic       Zucchini -> Bread, zucchini
Lemon    -> Pie, lemon
```

— i.e. it reproduced the exact bug being repaired, because for those
descriptions the leading noun *is* the food and the trailing word is the
flavour. **The rule was removed.** Two genuinely good matches (`Jalapeno`,
`Mozzarella`) were lost with it; they are downgraded honestly instead. That is
the correct trade, and it is covered by a regression test.

## 4. What was changed

`node scripts/repairFoodProvenance.mjs --apply` — 738 rows, 121 of them with
macro changes, plus **731 recipe macro caches recomputed** in the same
transaction so no recipe was left drifting.

| Verdict | Rows | Action |
|---|---|---|
| **verified** | 181 | Name genuinely denotes its record. Macros refreshed *from* that record, promoted to `usda-verified`, micronutrients attached. |
| **rematched** | 78 | Re-derived from the one FDC record the name denotes. `fdcId` **and** macros replaced. |
| **curated** | 7 | Macros owned by `data/foodOverrides.json`; numbers untouched, provenance corrected. |
| **downgraded** | 472 | False `fdcId` **removed**, `source` dropped off the USDA tier, `dataQuality` records exactly what was wrong. **Macros retained, marked unverified — no replacement was invented.** |

A downgraded row says so on the row:

```
exception:provenance-cleared — carried fdcId 170160 ("Nuts, almond paste"),
whose description does not denote this food; this row's macros are that
record's values verbatim and are therefore NOT this food's numbers; no FDC
record matches this name unambiguously, so no replacement was guessed
```

Every change is logged with its prior value in
`backend/data/provenance-repair-log.json`, and
`scripts/repairFoodProvenance.mjs --revert` restores from it.

**Deliberate conservatism.** Some downgraded rows are probably fine — `Cucumber`
lost its id only because FDC's record is *"Cucumber, peeled, raw"*. Their
numbers are unchanged and still displayed; only the verified badge is gone. An
honestly-labelled unknown is a correct row. A confidently wrong number is not.
Recovering these is a curated-synonym exercise, not a threshold change.

### Result

| | Before | After |
|---|---|---|
| Rows claiming an fdcId | 738 | 259 |
| ...verified against real FDC data | 0 known | **259 (100%)** |
| Duplicate-fdcId groups | 140 | 23 |
| ...spanning >1 category | 28 | **0** |

## 5. The import that cannot reproduce this

`scripts/importFdcBulk.mjs` added **13,280** foods (Foundation + SR Legacy +
FNDDS). Table: **864 → 14,144**.

**Identity is the FDC id, never a name.** A record's identity is
`record.fdcId` verbatim; "do we already have it?" is a lookup in a `Set` of
existing ids; `name` is USDA's own description, copied — never matched. The
import is idempotent and structurally cannot re-point an existing row at a
different food.

Every row is validated on the way in by the same
`src/lib/foodValidation.js` the app uses, and records its verdict in
`dataQuality`. A record that fails without a documented exception is
**rejected, not imported with a warning**.

### Two places the generic model was wrong, not the data

1. **USDA does not use 4/4/9.** Limes are computed with P3.36/F8.37/C2.48,
   chicken with P4.27/F9.02/C3.87 — **4,716 of the 5,024** bulk records that
   declare factors are not 4/4/9. Checking those against 4/4/9 reports a
   discrepancy that lives in the model. `validateFood` now accepts the factors
   the source actually used, read off the record.
2. **The name-shape heuristic does not apply here.** It exists to catch a food
   whose macros came from a *different* record than its name implies. Where
   name and macros are two fields of one record that is unrepresentable, and
   it only produced false positives — *"Anchovies, canned in olive oil"* is not
   an oil, *"Snacks, granola bars, almond"* is not a nut. It is skipped only
   under the explicit `nameIsSourceDescription` flag.

Applying both honestly took rejections from 519 (3.8%) to **29 (0.2%)** without
loosening a single threshold.

| Outcome | Records |
|---|---|
| Imported, validator `pass` | 12,790 |
| Imported with a documented `exception:` | 490 |
| Already present (matched by fdcId) | 236 |
| **Rejected** | **29 (0.2%)** |

The 29 are sugar-alcohol/polyol products (sugar-free syrups, sugarless gum)
where polyols count as carbohydrate but yield ~2 kcal/g. They are listed in
full in `backend/data/fdc-import-rejects.json` — nothing is dropped silently.

Documented exceptions carry their reason on the row, e.g.:

```
exception:alcohol-energy — ethanol supplies ~7 kcal/g and is reported in no
macro field, so kcal 43 legitimately exceeds the Atwater sum (...); USDA
category "Beer"; fdcId 168746 (SR Legacy)
```

### Micronutrients

All 13,539 `usda-verified` rows carry `micros` (mean 32 nutrients each),
per the `src/lib/nutrients.js` contract. **Absent ≠ zero**: a nutrient FDC does
not report for a food is *omitted* from the object; a measured zero is stored
as `0`; a food with no micronutrient data at all gets `null`. Non-mass units
(IU) are dropped with a reason rather than converted by a guessed factor.

**All 47 registry nutrient ids were verified against the real datasets**
(`scripts/verifyNutrientIds.mjs`) — every id resolves to the nutrient it
claims, including the two flagged as unverified (biotin 1176, iodine 1100).
Findings returned to the micronutrient track:

- 11 amino acids are reported by FDC in **g** while the registry's canonical
  unit is **mg**. Not an error — the importer converts (×1000) — but the
  registry should say so.
- `omega6LinoleicAcid` (1269) is named *"PUFA 18:2"* in FDC. Correct id,
  confirmed manually.
- Coverage is very thin for `iodine` (46 of 13,545 foods, 0.3%) and
  `biotinB7` (110, 0.8%), as the registry predicted.

## 6. Final state

```
[data-audit] foods 14144 (1 failing), recipes 889 (0 failing), duplicate groups 0
[data-audit]   quality: 13041 pass, 977 documented exception, 0 warn, 126 not yet validated
[data-audit]   provenance: manual 604, usda-verified 13539, manual-placeholder 1
[data-audit]   1 placeholder row(s) awaiting real data (no number invented): chipotle in adobo
[data-audit]   23 fdcId(s) claimed by more than one row — run: node scripts/auditFoodProvenance.mjs
```

The startup report gained a data-quality and provenance breakdown. `warn: 0`
and `unvalidated: 126` are stated rather than rounded away — those 126 are
hand-entered rows that predate the pipeline and have never been machine-checked.

**The one remaining failure is pre-existing and correct behaviour.**
`chipotle in adobo` is a zero-macro `manual-placeholder`; the validator is
*supposed* to flag it. No FDC record denotes it (the near matches are
*"Chipotle dip, regular"* and *"Adobo, with rice"* — different foods), so no
number was invented. It needs a human to supply real data or delete the row.

## 7. Can `fdcId` take a UNIQUE constraint?

**Not yet — 23 groups still share an id, and all 23 are legitimate.**

They are synonym pairs: the app's display name and USDA's description as two
rows pointing at one real record with identical macros.

| fdcId | Rows |
|---|---|
| 170160 | `Almond Paste` + `Nuts, almond paste` |
| 328637 | `Cheddar Cheese` + `Cheese, cheddar` |
| 172336 | `Canola Oil` + `Oil, canola` |
| 2346411 | `Blueberries` + `Blueberries, raw` |
| 173420 | `Feta` + `Cheese, feta` |
| … | 18 more of the same shape |

This is duplication, not corruption — and it is exactly the class Phase 2
resolved for names (merge, re-point recipe ingredients, delete the loser).
The constraint is safe to add **immediately after** that merge:

1. For each of the 23 groups, keep the row whose name the app actually uses
   and re-point `RecipeIngredient.foodId` from the other.
2. Delete the losers (−23 rows).
3. `ALTER TABLE Food ADD CONSTRAINT ... UNIQUE (fdcId)` — SQLite `NULL`s stay
   exempt, so the 605 rows with no id are unaffected.

Nothing else blocks it: the import already enforces id-uniqueness in code, so
no *new* duplicate can appear. Adding the constraint makes that guarantee
structural rather than procedural, which is the right permanent fix.

## 8. Reproducing

```bash
cd backend
node scripts/downloadFdcDatasets.mjs   # ~18 MB, gitignored
node scripts/buildFdcIndex.mjs         # ~2 s
node scripts/verifyNutrientIds.mjs     # registry ids vs real data
node scripts/auditFoodProvenance.mjs   # read-only report, exit 1 if unverified
node scripts/repairFoodProvenance.mjs  # dry run; --apply to write; --revert to undo
node scripts/importFdcBulk.mjs         # dry run; --apply to write
```

CI runs against the committed samples in `backend/data/fdc-fixtures/`
(`--fixture` on the index/audit/import steps); 36 tests in
`backend/tests/fdcImport.test.js` cover the matching rules, the streaming
parser, the Atwater model, micronutrient absent-vs-zero semantics, the repair
decision engine and the startup audit.

## 9. Known limitations

- **472 downgraded rows keep unverified macros.** Honest, but they are not
  *right* — a curated pass could recover many. `Cucumber` vs *"Cucumber,
  peeled, raw"* is the representative case.
- **`resolveIngredient` is now a bigger hazard, and was left alone.**
  `src/lib/ingredientResolver.js` matches ingredient names against *every* food
  row by token-overlap similarity at a 0.6 threshold. That pool just grew from
  864 to 14,144, so the chance of a confident wrong match rose sharply — the
  same mechanism as the original bug. It is out of this track's lane (the
  recipe-import track owns it) and is flagged, not changed. It should match on
  `fdcId`/`upc` first and treat name similarity as a last resort that produces
  a *review* item, never a silent write.
- **Dietary-filter surface area grew.** `dietaryFilter.js` keyword lists were
  audited against 854 names; there are now 14,144. Not this track's lane, but
  worth a re-sweep before the imported pool reaches the solver.
- The 29 rejected polyol records could be imported with a sugar-alcohol-aware
  energy model (FDC reports polyols separately).
