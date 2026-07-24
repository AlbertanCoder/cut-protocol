# Agent 08 — `dietary-safety-2`: the un-backfilled allergen metadata columns

**VERDICT: HALF-CLOSED at best — and in the live filtering path, NOT CLOSED AT ALL.**

Two independent gaps stack. (a) `fdcCategory` is NULL on 100% of rows, so probe 2
is dark. (b) Even fully backfilled, probe 2 is **unreachable from production** —
nothing outside `dietaryFilter.js` and its tests calls the object-aware API.

All work below ran on scratch copies. `backend/prisma/dev.db` mtime unchanged
(`05:16`), never opened for writing.

---

## 1. How much protection is actually lost right now

### 1a. The measured baseline

| metric | value |
|---|--:|
| Food rows | 14,122 |
| `fdcId` present | 13,516 (`usda-verified`) |
| non-FDC rows (`manual`, `manual-placeholder`) | 606 |
| `fdcCategory` / `allergenTags` / `mayContain` non-null | 0 / 0 / 0 |

`FDC_CATEGORY_FAMILIES` maps only three categories, so probe 2's entire allergen
surface is `Dairy and Egg Products` (331 rows), `Finfish and Shellfish Products`,
and `Baked Products` (518 rows).

### 1b. Foods where the NAME is insufficient but USDA's category WOULD catch it

Backfilled copy vs. empty copy, per allergen term, counting rows where
`foodMatchesExclusionTerm` flips false→true **only** because of `fdcCategory`:

| term | probe-2-only firings | sibling-category collateral | genuinely name-ambiguous |
|---|--:|--:|--:|
| gluten | 118 | n/a (unpaired) | 118 |
| eggs | 293 | 285 | 8 |
| shellfish | 222 | 218 | 4 |
| fish | 65 | 61 | 4 |
| dairy | 45 | 37 | 8 |
| **total pairs** | **743** | 601 | 142 |

743 (food × term) pairs across **713 distinct foods**. But 601 of those are the
*documented, intentional* paired-category over-exclusion (a parmesan excluded for
an **egg** allergy because USDA files it under "Dairy and Egg Products"). Those
are pool shrinkage, not safety.

**Stripping collateral, the real protection currently lost is ~117 distinct foods
(0.83% of the table):**

- **108 gluten** — `Baked Products` rows carrying no token in the gluten synonym
  list. The list has `bread`, `pastry`, `biscuit`, `pie crust` — but **not**
  `cake`, `pie`, `roll`, `eclair`, `popover`, `stuffing`, `brownie`, `strudel`,
  `french toast`, `toaster pastry`, `hush puppies`, `ice cream cone`. Concrete
  leaks a coeliac account would be served today:
  `Cake, angelfood, commercially prepared` · `Pie, Dutch Apple, Commercially Prepared` ·
  `Rolls, hard (includes kaiser)` · `Rolls, pumpernickel` ·
  `Toaster pastries, brown-sugar-cinnamon` · `Cream puff shell, prepared from recipe` ·
  `French toast, frozen, ready-to-heat` · `Popovers, dry mix, enriched` ·
  `Kraft, Stove Top Stuffing Mix Chicken Flavor` ·
  `Martha White's Chewy Fudge Brownie Mix, dry` ·
  `Interstate Brands Corp, Wonder Hamburger Rolls`
  (10 of the 118 are false positives — `Tostada shells, corn`, `Taco shells, baked`
  ×2, and the 7 `Leavening agents, …` rows, which are gluten-free.)
- **8 dairy** — hidden-casein carriers with no dairy word:
  `Whipped topping, frozen, low fat` · `Dessert topping, pressurized` ·
  `Dessert topping, powdered` · `Beverage, instant breakfast powder, chocolate` ×2 ·
  `Reddi Wip Fat Free Whipped Topping` · `Nutritional supplement for people with diabetes`
- **~1 shellfish** — `Mollusks, snail, raw`. (`Frogs Legs`, `Turtle, green, raw`,
  `Jellyfish, dried, salted` are over-exclusion for both sea terms.)

**Style backstop is near-worthless** — the meat/fish keyword list is already
exhaustive. `styleExcludedByMetadata` adds only **10 vegan** and **2 vegetarian**
rows beyond name matching (`Jellyfish, dried, salted`,
`Yachtwurst, with pistachio nuts, cooked`, whipped/dessert toppings).

### 1c. The bigger finding — probe 2 has ZERO production callers

Every live consumer calls the **name-only** matcher:

| file | line | call |
|---|--:|---|
| `backend/src/lib/planContext.js` (solver pool) | 41 | `matchesExclusionTerm(ing.name, term)` |
| `backend/src/lib/weeklyPlanner.js` | 35 | `matchesExclusionTerm(ing.name, t)` |
| `backend/src/routes/recipes.js` | 36 | `matchesExclusionTerm(ing.name, term)` |
| `backend/src/routes/cart.js` | 22 | `matchesExclusionTerm(ing.name, t)` |
| `backend/src/lib/recipeGeneration.js` | 90 | `matchesExclusionTerm(ing.name, term)` |
| `backend/src/lib/aiRecipeClient.js` | 41 | `matchesExclusionTerm(ing.name, term)` |
| `backend/src/lib/brain/exclusions.js` | 78 | `matchesExclusionTerm(n, term)` |

Repo-wide caller counts for the object-aware API (`backend/src`, `backend/scripts`,
`backend/tests`, `frontend/src`, `electron`):

- `excludedByList` — **2 hits, both inside `dietaryFilter.js`** (definition +
  export). Zero callers anywhere, including tests.
- `foodMatchesExclusionTerm` / `exclusionEvidence` / `styleExcludedByMetadata` —
  callers are **`allergenMetadata.test.js` and `allergySweep.test.js` only**.

So even a perfect backfill buys **0 foods** of live protection until a caller is
changed. The merged feature is currently reachable only from tests.

---

## 2. Backfill — the data is 100% local, no USDA API needed

`backend/data/fdc-cache/fdc-index.json` (11.3 MB, built 2026-07-21) holds
**13,545 records, every one with a non-null `fdcCategory`** (196 distinct values).
Joined on `fdcId` against the live table:

```
rows 14122 | fdcId -> index HIT 13516 | MISS 0 | no fdcId 606
```

**Zero unmatched.** The raw source zips are also present
(`FoodData_Central_{foundation,sr_legacy,survey}_*.zip`, 28 MB total). No external
call is required. `scripts/lib/fdcDataset.js` already parses the field, and
`importFdcBulk.mjs:122` already *reads* `rec.fdcCategory` for the alcohol
exception — it simply never writes it.

### Executed on the scratch copy — result

```
backfilled 13516 rows | unmatched fdcId 0
fdcCategory NOT NULL now: 13516 / 14122   (95.7%; the 606 nulls are non-FDC manual rows — correct)
969 Beef Products · 894 Vegetables · 518 Baked Products · 466 Lamb, Veal, and Game ·
399 Fruits and Fruit Juices · 394 Poultry · 364 Beverages · 353 Sweets · 331 Dairy and Egg
```

### The exact procedure that works

A targeted `UPDATE` join is strictly better than re-running the importer (no
re-insert, no dedupe/`claimedIds` risk, idempotent, ~1 s):

```js
// backend/scripts/backfillFdcCategory.mjs  — run AFTER `npx prisma generate`
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
const DB  = process.argv[2];                                  // require explicit path
const idx = JSON.parse(fs.readFileSync("backend/data/fdc-cache/fdc-index.json", "utf8"));
const cat = new Map(idx.records.map(r => [String(r.fdcId), r.fdcCategory ?? null]));
const db  = new DatabaseSync(DB);
const upd = db.prepare("UPDATE Food SET fdcCategory = ? WHERE id = ?");
db.exec("BEGIN");
for (const r of db.prepare("SELECT id, fdcId FROM Food WHERE fdcId IS NOT NULL").all()) {
  const c = cat.get(String(r.fdcId));
  if (c) upd.run(c, r.id);
}
db.exec("COMMIT");
```

Then apply **agent04 item 2** so future imports carry it —
`backend/scripts/importFdcBulk.mjs`, add `fdcCategory: rec.fdcCategory ?? null,`
to **both** `toInsert.push({…})` literals (lines ~127 and ~170). Still unapplied
(verified: no `fdcCategory:` key in either literal).

**Agent04 item 3 is also still unapplied.** `usdaClient.js:67` now returns
`fdcCategory`, but `ingredientResolver.js` contains no reference to it — the
runtime USDA-hit path keeps creating rows with `fdcCategory = NULL`.

---

## 3. Measured delta from the shipped sweep: **0 → 0**

`backend/scripts/qc/sweep14k.mjs` **cannot detect this feature at all.** Two
structural reasons, both in its own source:

- line 55: `const foods = await prisma.food.findMany({ select: { id, name, source } })`
  — it never selects `fdcCategory` / `allergenTags` / `mayContain`.
- line 60: `const app = matchesExclusionTerm(f.name, c)` — the name-only matcher.

I did not run it (it writes `docs/qc/allergen-sweep.md`, outside my write scope).
I reproduced its oracle cross exactly, but with `foodMatchesExclusionTerm` and the
full food object, over both DB copies:

| | before (NULL) | after (backfilled) | closed |
|---|--:|--:|--:|
| all 10 categories, leak candidates | **0** | **0** | **0** |

Both zero — because the QC oracle (`scripts/qc/oracle.mjs`) is **itself a curated
name list**, and the app's name list already exhausts its vocabulary. Probe 2 is
the only non-name signal in the system, so **every food it catches is by
construction invisible to the oracle**. `trueCatch = 0` in my classifier is a
measurement-instrument limit, not evidence the probe is worthless — the 108
gluten catches in §1b are real and the oracle simply has no `cake`/`pie`/`roll`
entry either.

**"Does it matter?" — the honest answer:** the *shipped sweep number* does not
move. The real number is **~117 foods** that gain correct allergen exclusion,
against **601 pairs** of new over-exclusion, and **0** of either reaching a user
until §1c is fixed. The sweep cannot be the acceptance test for this feature.

### Side finding — 2 curated renames silently defeat the gluten filter

173 of the 13,516 rows have a name differing from USDA's description (deliberate
curation: `Onions, raw`→`Onion`, `Arugula, raw`→`Rocket`). Two of them drop an
allergen keyword:

- `"Bread, cinnamon"` → stored as **`"Cinnamon"`** (fdcId 171849)
- `"Bread, oatmeal"` → stored as **`"Oatmeal"`** (fdcId 172678)

Both lose the `bread` token and go completely undetected by every name-based
probe. `fdcCategory` is the **only** thing that recovers them. (A third,
`"Pie, peach"`→`"Peaches"`, is missed because `pie` isn't in the gluten list at
all.) These looked like false positives until traced to source.

---

## 4. `allergenTags` at 0% — expected, and the barcode path is now live

**Yes, 0% is correct.** OFF tags arrive only via barcode import; the library is
13,516 USDA rows + 605 manual, and USDA publishes no allergen declaration. Zero
is honest absence.

Write path traced end-to-end without calling OFF:

1. `openFoodFactsClient.js:55` — `"allergens_tags", "traces_tags"` **are** in
   `FIELDS`, sent at line 222 as `?fields=…`. **Agent04 item 1 is applied.**
2. `openFoodFactsClient.js:274-275` — `lookupUpc()` returns both verbatim
   (`Array.isArray(p.allergens_tags) ? … : null`).
3. `offImport.js:110-114` — `allergenFieldsFromOffProduct()` reads
   `p.allergens_tags` / `p.traces_tags`, normalises via `normaliseAllergenTags`.
4. `offImport.js:59, 82-83` — `candidateFromOffProduct()` puts `allergenTags` /
   `mayContain` on the candidate.
5. `routes/foods.js:84` — `prisma.food.create({ data: { ...candidate, … } })`
   spreads them straight through. Client regenerated (`fdcCategory` present in
   `backend/node_modules/.prisma/client/schema.prisma`), so this will not 500.

**The chain is complete.** One housekeeping item: `offImport.js:101-105` still
carries a `NOTE (open, …)` claiming the client "does not currently request
`allergens_tags`/`traces_tags`". That comment is now false and should be deleted.

---

## 5. Should `dietary-safety-2` be considered closed?

**HALF-CLOSED. Do not mark it closed.** Precisely:

| sub-claim | status |
|---|---|
| schema + migration | ✅ done (3 columns, 24 migrations, 14,122 rows intact) |
| probe logic + add-only invariant | ✅ done and tested |
| barcode/OFF write path (`-4`) | ✅ **closed** — verified end-to-end |
| `fdcCategory` populated | ❌ **0%** — data exists locally, never written |
| `importFdcBulk.mjs` writes it (item 2) | ❌ unapplied |
| `ingredientResolver.js` writes it (item 3) | ❌ unapplied |
| probe reachable from production | ❌ **zero callers** |
| regression test that can detect it | ❌ sweep is name-only and doesn't select the columns |

Closing it now would record a safety improvement that provably changes **zero**
user-visible outcomes. Three things must land first: the backfill (§2), a
production caller swapping `matchesExclusionTerm(ing.name, t)` →
`excludedByList(foodObject, terms)` in `planContext.js` / `weeklyPlanner.js` /
`routes/recipes.js` / `routes/cart.js` — which requires those queries to
`select` the three columns — and a sweep that actually reads them.

---

### Reproduction artifacts (scratchpad)

`dev_copy.db` (pristine) · `dev_backfilled.db` · `a08_backfill.mjs` ·
`a08_delta.mjs` · `a08_classify.mjs`
