# Agent 09 — Adversarial audit of the compound-token allergen defence

**Scope:** `backend/src/lib/dietaryFilter.js` `COMPOUND_TOKENS` (48 keys) /
`COMPOUND_FALSE_FRIENDS` (11 entries) vs. the real corpus in
`backend/prisma/dev.db` — **14,122 Food rows, 889 Recipes, 7,245 RecipeIngredient
rows, 798 distinct on-plate ingredient names.**
**Method:** read-only. DB copied to scratchpad. All results reproduced by calling
the production module (`matchesExclusionTerm` / `foodMatchesExclusionTerm` /
`recipeExcludedByStyle` / `additionalIngredientNames`) and, for the
false-positive delta, against a source-identical baseline build with
`COMPOUND_TOKENS` stubbed out. **Nothing below is estimated.**

---

## VERDICT

The compound splitter is directionally right and its 48 curated entries do fire
correctly on the real table (350 of 14,122 names). But it is a **thin patch on a
name-only defence**, and the real corpus contains far more single-word prepared
dishes than the list covers. Measured: **194 (Food row, allergy) leak pairs** in
the library and **13 verified on-plate leaks** in the 889-recipe corpus,
including four peanut-oil recipes reaching a peanut allergy. In the opposite
direction the splitter (plus one pre-existing name shape) **wrongly removes ~30
rows and 6 real recipes**.

Two structural findings dominate everything else:

- **P0-A. The metadata backstop does not exist.** `fdcCategory`, `allergenTags`
  and `mayContain` are populated on **0 of 14,122 rows**. Probes 2/3/4 of
  `exclusionEvidence()` — and the whole `FDC_CATEGORY_FAMILIES` /
  `FDC_FLESH_CATEGORIES` apparatus the comments call "a BACKSTOP" — are dead
  code against real data. Every claim of defence-in-depth currently rests on
  name matching alone.
- **P0-B. The prose defence is inert and unevenly wired.**
  `additionalIngredientNames()` matches on exactly **1 of 889 recipes**
  (`Beef Banh Mi Bowls…`). Meanwhile the real corpus has 197 "serve with",
  62 "sprinkle with", 61 "top(ped) with", 35 "garnish with", 27 "drizzle with",
  25 "to serve:" steps — the parser sees none of them. And of the four call
  sites that filter for allergies, only `planContext.filterRecipePool()` folds
  the parsed names in; `routes/recipes.js` (library listing),
  `routes/cart.js` (`recipeCompliant`) and `weeklyPlanner.js`
  (`aiRecipeCompliant`) all use bare ingredient rows. The M8
  "listing can never diverge from the pool" invariant is broken for this path.

---

## 1. FALSE NEGATIVES — on-plate (highest severity)

These are real `RecipeIngredient` rows / step text in the 889-recipe corpus.
Verified by replicating `filterRecipePool()`'s allergy branch exactly.

| # | Recipe (id) | Allergen that escapes | Why |
|---|---|---|---|
| 1 | **Vietnamese lamb shanks with sweet potatoes** `cmrj2tyk505l1wlwsnyxhfnyj`, **Vietnamese-style caramel pork** `cmrj2u4bt06upwlwsx8gd6db5`, **Noodle bowl salad** `cmrj2u77507hnwlws4me7kx2z`, **Prawn stir-fry** `cmrj2u7ky07ktwlwsfvrxrm7y` | **PEANUTS** (all 4) and **TREE NUTS** (those 4 + **Tangy carrot, cabbage & onion salad** `cmrj2ujh40a6mwlwsrv4e1rlc`) | Ingredient row is **`Ground Nut Oil`** = peanut oil. `peanuts` synonyms carry `groundnut` (one word) and `peanut oil`; the corpus writes it as three words. `tree nuts` synonyms carry **no bare `nut`** — the `nuts` key does. `tests/qc/treeNutParity.test.js` pins chestnut/nutella but not this. **Anaphylaxis-grade.** |
| 2 | **Blackberry Fool** `cmrj2tox603frwlwszc4x2a3p` | **TREE NUTS** | Ingredient row is **`Hazlenuts`** — misspelled. `hazelnut` never matches. A one-character typo defeats the whole tree-nut list. |
| 3 | **Sushi** `cmrj2u97207x9wlwsczv1mv7p` | **FISH** and **SHELLFISH** | Ingredient rows: Sushi Rice, Rice wine, Caster Sugar, Mayonnaise, Rice wine, Soy Sauce, Cucumber. The steps say *"place a thin layer of **smoked salmon**"*, *"we've used **tuna** and cucumber"*, *"like half a **prawn**"*. A recipe named **Sushi** passes a fish allergy and a shellfish allergy. |
| 4 | **Mediterranean Pasta Salad** `cmrj2u6ti07elwlws791da43r` | **GLUTEN** | Ingredient row **`farfalle`**. `gluten` lists spaghetti/macaroni/penne/fettuccine/linguine/tagliatelle/ravioli/tortellini/vermicelli but not farfalle (nor ziti/rigatoni/fusilli/rotini/bucatini/orecchiette/ditalini). Celiac is served wheat pasta. |
| 5 | **Vegetarian Shakshuka** `cmrj2uk4r0ac5wlws8cr7de8c` | **GLUTEN** | Ingredient row **`Toast`**. `bread` is listed; `toast` is not. |
| 6 | **Chocolate Caramel Crispy** `cmrj2tq3e03ozwlwsgpkyrtby` | **GLUTEN** | Ingredient row **`Rice Krispies`** (barley malt). |
| 7 | **Poutine** `cmrj2tzrg05unwlwsnk7pm0ng` | **GLUTEN** | Ingredient row **`Beef Gravy`**. The list carries `gravy mix` / `gravy granules` — chosen for exactly this hidden-wheat reason — but not bare `gravy`, which is the corpus name shape. |
| 8 | **Christmas Pudding Flapjack** `cmrj2tqk003sqwlwsg715si4u` | **GLUTEN** | Ingredient row **`Christmas pudding`** (suet + breadcrumbs). Already listed for VEGAN in `ANIMAL_DERIVED_EXTRA_KEYWORDS`; the allergy lists never got it. |
| 9 | **Beef Dumpling Stew** `cmrj2tdht00wjwlwsyzh36ga3`, **Smoky Lentil Chili with Squash** `cmrj2uioc0a0dwlwsn9q2z2kp` | **FISH** | **The classic Worcestershire/anchovy trap, confirmed live.** Worcestershire appears only in step prose ("*add the Worcestershire sauce and balsamic vinegar*"); neither recipe has a Worcestershire ingredient row. `worcestershire` IS in the fish list — the corpus just never gives the filter a row to match. 9 recipes mention it in prose; 7 also carry the `Worcestershire Sauce` row and are caught; these 2 are not. |
| 10 | **Peanut Butter Cheesecake** `cmrj2tu2804k6wlwsgbq6sd9o`, **Raspberry mousse** `cmrj2tut104qfwlwslivthnnz` | **HALAL / KOSHER** | Ingredient row **`Gelatine Leafs`**. `excludedByStyle` uses `hasWord(n,"gelatin")`, which cannot match "Gelatine". The vegan path is fine (`MEAT_FISH_KEYWORDS` has both spellings). |

Other prose-only escapes verified at the pool level: `Roasted Eggplant With
Tahini, Pine Nuts, and Lentils` `cmrj2ui2w09vlwlwsfvso3lg0` (tahini → **SESAME**,
also `Beef Mechado` `cmrj2te240118wlws7wywvlp6`, `Mamoul (Eid biscuits)`
`cmrj2ttd604enwlwspik9q33n`, `Challah` `cmrj2uaw108a8wlws0o8td1jk` for sesame
seeds); `Thai rice noodle salad` `cmrj2ujsq0a9awlws5hpp6def` (soy sauce → **SOY**);
`Fish Stew with Rouille` `cmrj2u60u0785wlws5mxsdqni` (mayonnaise → **EGGS**);
`Lamb Tagine` `cmrj2txi605cewlwshnu4nbi6`, `Chicken wings with cumin, lemon &
garlic` `cmrj2tkaz02evwlws246fya47` (pine nuts / almond / pistachio → **TREE
NUTS**); `Singapore Noodles with Shrimp` `cmrj2u8lb07sywlws45kaarqr`
(peanut → **PEANUTS**). Prose-only allergen mentions with no matching ingredient
row, by allergy: dairy 54, gluten 30, eggs 8, tree nuts 6, sesame 4, fish 2,
shellfish 1, soy 1, peanuts 1 (of 889 recipes).

## 2. FALSE NEGATIVES — food library (14,122 rows)

Terms below are **absent from `COMPOUND_TOKENS` and from every
`CATEGORY_SYNONYMS` list**, and were confirmed non-excluded on the real names.
**194 distinct (row, allergy) leak pairs.**

| Allergy | rows | Leading carriers (real row names) |
|---|---|---|
| **gluten** | 70 | `stuffing` 12 (*George Weston Bakeries, Brownberry Sage and Onion Stuffing Mix, dry*), `empanada` 8, `lo mein` 7 (*Lo mein, NFS*), `strudel` 5, `eclair` 5, `crepe` 5, `manicotti` 4, `wafer` 4 (*Candies, KIT KAT Wafer Bar*), `zwieback` 2, `funnel cake` 2, `tempura` 2, plus `cannelloni`, `farfalle`, `focaccia`, `beignet`, `churro`, `knish`, `samosa`, `shortcake`, `coffee cake`, `chow mein`, `baklava`, `tiramisu`, `einkorn`, `melba toast` |
| **dairy** | 55 | `fudge` 17, `scalloped` 12 (*Potatoes, scalloped, dry mix, unprepared*), `souffle` 6, `pesto` 6, `mousse` 4, `au gratin` 3, `sherbet` 2, plus `tiramisu`, `tzatziki` (*Tzatziki dip* `cmrviimrv0666wl1kl92gprbo`), `creme brulee`, `brioche`, `flan` |
| **eggs** | 30 | `souffle` 7, `nougat` 7, `mousse` 4, `macaroon` 3, `ladyfinger` 3, plus `tiramisu`, `creme brulee`, `angel food`, `brioche`, `eclair`, `flan` |
| **soy** | 17 | `teriyaki` 12, `hoisin` 2 (*Hoisin Sauce* `cmrj2tc7x00nnwlws0lh2ted5` — a live ingredient row), `gochujang`, `okara`, `black bean sauce`. **Asymmetry:** `hoisin`, `teriyaki` and `soy sauce` are all in the GLUTEN list; only `soy sauce` is in the SOY list. |
| **tree nuts** | 10 | `pesto` 6 (*Sauce, pesto, ready-to-serve* — pine nuts), `nougat` 3, `baklava` 1 |
| **peanuts** | 10 | `kung pao` 5 (*Restaurant, Chinese, kung pao chicken*), `pad thai` 5 (*Pad Thai, NFS*) |
| **fish / shellfish** | 1 + 1 | `Soup, bouillabaisse` `cmrviimyl074qwl1kvu0yqcjy` |

Checked and **clean** (no leak found in the real table): sesame carriers,
`worcestershire`/`caesar dressing`/`fish sauce`/`surimi` as Food names,
`praline`/`marzipan`/`nutella`, `matzo`, `seitan`, `gelato`, `lactose`.

## 3. FALSE POSITIVES — over-exclusion

Delta measured against the COMPOUND_TOKENS-stubbed baseline: the splitter fires
on **350 of 14,122 names** and creates **547 new (row, key/style) exclusions**.
The overwhelming majority are correct. The wrong ones:

1. **`caesar` matches the brand "LITTLE CAESARS".** 6 pizza rows
   (*LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust* etc.) are now
   excluded for **FISH** and **EGGS** on an anchovy/raw-egg inference that has
   nothing to do with the product. 12 wrong pairs. Not in
   `COMPOUND_FALSE_FRIENDS`.
2. **`caesar` on explicitly undressed rows.** *Caesar salad, with romaine, **no
   dressing***, and the two *"…caesar garden salad… **no dressing**"* rows, are
   excluded for fish/egg although the name states the anchovy carrier is absent.
3. **`creamer` removes 16 non-dairy creamers** — including *Coffee creamer, soy,
   liquid*, *SILK Original / French Vanilla / Hazelnut Creamer* (a plant-milk
   brand) and, most visibly, *Beverages, coffee, instant, vanilla, sweetened,
   decaffeinated, **with non dairy creamer***. The name literally says "non
   dairy" and the filter calls it dairy. These are also lost to **vegan**, which
   is the worst possible direction — they are vegan products.
4. **`Egg Plants` — the actual corpus spelling — is excluded for EGGS.**
   `COMPOUND_FALSE_FRIENDS` guards `"Eggplant, raw"` (one word). The
   `RecipeIngredient` corpus writes **`Egg Plants`** (two words), which
   word-matches `egg`. Consequence: **6 real recipes are hidden from an
   egg-allergic user for no reason** — *Baba Ghanoush*, *Eggplant Adobo*,
   *Grilled eggplant with coconut milk*, *Roasted Eggplant With Tahini, Pine
   Nuts, and Lentils*, *Sichuan Eggplant*, *Stovetop Eggplant With Harissa,
   Chickpeas, and Cumin Yogurt*. (Pre-existing, not caused by the splitter — but
   it is precisely the class `COMPOUND_FALSE_FRIENDS` claims to pin, and it
   pinned the wrong string.)
5. **`Seeds, sunflower seed butter` (2 rows) excluded for DAIRY.**
   `isDairyButterOrCream()` exempts `peanut butter`, `nut butter`, cocoa/shea/
   apple butter and the 8 `PLANT_MILK_QUALIFIERS` — but not `sunflower`,
   `sesame` or a generic `seed butter`.
6. **`COMPOUND_FALSE_FRIENDS` is 9/11 fictional.** Only **`Graham crackers`**
   and **`Eggplant, raw`** exist in the 14,122-row table. `Hamburger, plain`,
   `Nutmeg, ground`, `Butternut squash, raw`, `Butterhead lettuce`,
   `Butterflied chicken breast`, `Coconut, raw`, `Water chestnut, canned`,
   `Doughnuts, glazed`, `Milkfish, raw` are **not real row names**. The
   "executable record of that decision" is asserted against strings the app will
   never see, which is how the real `Egg Plants` shape slipped through. (The
   underlying *concepts* are all safe — verified independently: nutmeg 0/4
   excluded, butternut 0/10, coconut 0/67, water chestnut 0/1, milkfish 0/2,
   graham 0/21 for peanuts, butterhead 0/1.)

## 4. Worcestershire / fish sauce / anchovy specifically

| carrier | recipes with it in step prose | escape the solver pool | escape the library listing |
|---|---|---|---|
| worcestershire | 9 | **2** | 2 |
| fish sauce | 20 | 0 | 0 |
| oyster sauce | 8 | 0 | 0 |
| anchovies | 1 | 0 | 0 |
| prawn | 25 | **1** (Sushi) | 1 |

The corpus does carry `Worcestershire Sauce`, `Fish Sauce`, `Oyster Sauce` and
`Anchovy Fillet` as Food rows, and where a recipe uses the row the filter catches
it. The trap only opens when the sauce is named in prose only — which is exactly
what happened twice. There is **no** `caesar dressing`, `shrimp paste`, `dashi`
or `bonito` Food row, so those synonym entries currently protect nothing.

---

## Reproduction

Scripts in the session scratchpad (`.../scratchpad/a09/`): `dump.mjs` (DB →
`foods.json`), `mkbaseline.mjs` (stubbed-COMPOUND_TOKENS build), `leaks.mjs` /
`final.mjs` (carrier sweep), `fp.mjs` (false-positive delta), `prose.mjs` /
`prose2.mjs` / `verify.mjs` (recipe corpus). No repo file was modified; the
production `dev.db` was copied, never opened for write.
