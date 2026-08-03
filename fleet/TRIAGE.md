# FLEET TRIAGE — safety findings

Ground rule 1: an allergen/diet gate defect gets written here the moment it is
found, with reproduction, and the fleet keeps moving. This file measures; the
fixes are handoffs.

**Fix status (kept current — W4-2 found this header claiming "nothing here is
fixed" while T-3 already was, which is the same silent-record problem the
findings themselves are about):**

| | Status |
|---|---|
| T-1 powder rows | **open**, unreachable by the solver |
| T-2 sweep | **done** — performed by W4-2, results are T-4 |
| T-3 lupin↔peanut | **fixed** `6530fa0`, independently re-verified by W4-2 |
| T-4 five leaks | **fixed 2026-08-03** — all 5 food-level + all 7 recipe-level cases now excluded; `reachability.mjs` reports 0 leaks; hostile-name probe 35/72 → **72/72** |
| T-5 conditional exclusion | **fixed 2026-08-03** — resolver now separates "filters nothing" from "matches on text", and the screen says so |

T-4's two long-known extras (`Passata` nightshades, `Wonton Skin` eggs — both
named in T-2 and never closed) were closed in the same pass. `Lupini Beans` is
**not a row in this database**; the probe's own note anticipated that, and the
three real `Lupins, mature seeds …` rows return true for peanut.

---

## T-1 — The allergen gate fails OPEN on protein/nutritional powders (CONFIRMED on real DB, currently UNREACHABLE)

**Severity: P1-latent.** The defect is real and reproduced on this machine's
real database. It is *not* currently shipping to users, because every affected
row is unreachable by the solver. It becomes **P0 the instant the adjuster pool
or recipe library widens into this food class** — which is exactly what a
"vegan protein density" fix is tempted to do. Read this before W3-6.

**Found:** W0-1, 2026-07-31. **Inherited from:** CONSOLIDATED-BRIEF §7 (D3),
which marked its own verdict "unproven, not wrong." It is now proven.

### Reproduction (real DB, `backend/prisma/dev.db` sha256 `d9037dce…b623a1`)

```bash
cd backend && node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const df=require('./src/lib/dietaryFilter.js');
(async()=>{
  const r=(await p.food.findMany({where:{name:{contains:'Isopure'}}}))[0];
  console.log(r.name, r.protein, r.fdcCategory, r.allergenTags, r.mayContain);
  for (const t of ['whey','dairy','milk'])
    console.log(t, df.foodMatchesExclusionTerm(r,t));
  console.log('vegan-excluded?', df.adjusterExcludedByStyle(r,'vegan'));
  await p.\$disconnect();
})();"
```

**Observed:**

```
Nutritional powder mix (Isopure)  58.1  Protein and nutritional powders  null  null
whey  false
dairy false
milk  false
vegan-excluded? false
```

`Isopure` is a **whey protein isolate**. The gate clears it for a whey-allergic
user, a dairy-allergic user, a milk-allergic user, and a vegan.

### Mechanism

`Food.allergenTags` and `Food.mayContain` are **NULL on 100% of all 14,151
rows** (verified by raw SQL, not by ORM default). With both metadata columns
empty the gate falls back to the food **name** and `fdcCategory`. The string
`"Nutritional powder mix (Isopure)"` contains no allergen word, and the
category `"Protein and nutritional powders"` maps to no allergen family. Every
evidence channel returns "no evidence," and the gate reads absence of evidence
as evidence of safety. **It fails open, not closed.**

### Blast radius (measured, not estimated)

| Population | Count |
|---|---|
| Foods in `fdcCategory = 'Protein and nutritional powders'` | 17 |
| …that clear **dairy AND milk AND vegan** simultaneously | **13 of 17** |
| …of those, referenced by ≥1 `RecipeIngredient` | **0** |
| …of those, present in `ADJUSTER_CANDIDATES` (`planContext.js:167-178`) | **0** |

The 13 include unambiguously dairy products — `Carnation Instant Breakfast`,
`Slim Fast`, `Herbalife high protein`. **All are inert today:** zero recipe
references, and the adjuster list is a hardcoded ten-name constant that does
not include them.

### Why this matters to THIS fleet specifically

The brief's own remediation instinct — widen the protein-adjuster pool to fix
vegan protein density — walks straight into this. The brief already says it:
*"Do not widen the adjuster pool into `Protein and nutritional powders` until
the whey question is resolved."* This triage upgrades that from caution to a
**measured hard gate**: 13 of 17 rows in that category are provably
mis-classified by the live gate. **W3-6 must not insert any row from this class
into a probe DB**, and W5-1 must not recommend widening into it.

### What a real fix requires (not this fleet's job)

Populating `allergenTags` is necessary but not sufficient — the failure is that
*absence of evidence passes*. The gate needs to **fail closed on unclassified
rows** in an allergen-restricted context. That inverts the same denylist→
allowlist lesson this repo's own `CLAUDE.md` already teaches about the
installer payload; `WORD_GUARDS` is a denylist of exceptions to a denylist and
will keep producing one of these per vocabulary expansion.

### Honest limits of this finding

- Method is a **known-item probe**, not a leak sweep. It confirms these rows
  leak; it does **not** bound how many other rows do. No agent in the prior
  campaign used a method capable of finding false negatives, and neither has
  this one yet. Absence of further hits below is not evidence of safety.
- "Unreachable" is measured against the current DB and the current hardcoded
  adjuster list. Both are things people change.

---

## T-3 — Peanut-allergic users are NOT protected from LUPIN (CONFIRMED on real DB, currently unreachable)

**Severity: P1-latent** — same shape as T-1: the knowledge exists in the codebase,
in prose, and no code acts on it. **Found by W2-3, 2026-07-31**, while researching
the vegan snack niche — i.e. found *because* the fleet went looking for foods to
add, which is exactly when it would have shipped.

### Reproduction (real DB)

```js
foodMatchesExclusionTerm(lupinRow, 'peanuts') // -> false   ⚠️
foodMatchesExclusionTerm(lupinRow, 'lupin')   // -> true
```

### Why this is a real hazard, not a technicality

- **Health Canada advises every peanut-allergic consumer to avoid lupin.**
  Cross-reactivity is reported at **5–37%**. There is a published first Canadian
  paediatric anaphylaxis case.
  <https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/allergen-labelling/information-canadians-peanut-allergy-concerning-lupin.html>
- **Lupin is not a Canadian priority allergen, so packages carry no "Contains"
  statement.** The user cannot catch this at the shelf either.
- `backend/src/lib/allergenTaxonomy.js:635` **already documents the cross-reaction
  in a comment** — *"Cross-reacts strongly with peanut"*. `git grep` for any
  cross-reactivity logic returns **two comment lines and nothing else.** No code
  consumes it.
- A peanut-allergic vegan is protected **only if they separately tick the
  TIER_RARE "Lupin" checkbox** — i.e. only if they already knew.

### Blast radius

**Three USDA-verified lupin rows already sit in `dev.db` with ZERO recipe
references.** Inert today — and **one authoring session from shipping**. Lupini is
the single best box-clearing snack-shaped whole food W2-3 found (protein density
13.11, fat density 2.45) for exactly the population with the worst pool, so the
obvious "fix the vegan snack gap" move reaches for it first.

### Hard gate on this fleet's own output

**W3-6 must not insert any lupin/lupini row or dish into a probe DB, and W5-1 must
not recommend one, until the gate enforces the peanut↔lupin cross-reaction.**
W2-3's dish #12 (Lupini Snack Jar) is marked GATED in
`fleet/out/W2-3/candidates.json` for this reason.

> Note the pattern across T-1 and T-3: **both are the gate failing open on a food
> nobody had reason to name.** T-1 is absence of metadata read as safety; T-3 is
> documented knowledge that never became code. The brief's structural indictment
> of `WORD_GUARDS` — *"a denylist of exceptions to a denylist… it will keep
> producing one of these per vocabulary expansion"* — predicts both.

---

## T-2 — (open) Full false-negative leak sweep — NOT YET PERFORMED

Recorded so it is not mistaken for done. Every leak statement in the inherited
corpus rests on methods that inspect what was *removed* and are structurally
incapable of finding a false negative. W1-5's wrong-record scan and W4-2's laws
sweep are the fleet's attempts; neither is a complete sweep, and the final
report must say so rather than implying the gate is clean.

---

## T-4 — FIVE allergen/diet gate false negatives that SHIPPED to real personas (CONFIRMED still open at HEAD `748c524`)

**Severity: P1 (P0 for the three nightshade rows if any of those personas is a
true chili intolerance rather than a preference — the app cannot tell them
apart).** Found by **W4-2, 2026-08-02**, by sweeping every placement in all 144
fleet day dumps (78,286 day records, 344,600 slot placements) with an oracle
whose vocabulary was authored independently of `dietaryFilter.js` /
`allergenTaxonomy.js` — see `fleet/out/W4-2/oracleVocab.mjs` and
`fleet/out/W4-2/LAWS-SWEEP.md`.

Each row was verified twice: the recipe was **actually placed on that persona's
plate**, and the **current tree still does not exclude it** (food level *and*
recipe level).

| # | Wall | Carrier row | Recipe | Personas | Placements |
|---|---|---|---|---|---|
| L-A | nightshades | `Scotch Bonnet` | Mango chow | p088 | 242 |
| L-B | nightshades | `Enchilada sauce` | Chicken Enchilada Casserole | p169 p057 p174 p063 p038 p042 p142 | 292 |
| L-C | nightshades | `Banana Pepper` | Porotos Granados | p224 p142 | 16 |
| L-D | gluten | `Oyster Sauce` | Thai beef stir-fry | p181 p104 p125 | 160 |
| L-E | cilantro | `Pico De Gallo Sauce` | Arepa Pabellón | p191 p223 | 516 |

### Reproduction (current tree, DB `fb67a37f`)

```bash
node fleet/out/W4-2/reachability.mjs      # -> fleet/out/W4-2/reachability.json
```

Observed:

```
Scotch Bonnet        nightshades  -> false      recipe "Mango chow"                   -> not excluded
Enchilada sauce      nightshades  -> false      recipe "Chicken Enchilada Casserole"  -> not excluded
Banana Pepper        nightshades  -> false      recipe "Porotos Granados"             -> not excluded
Oyster Sauce         gluten       -> false      recipe "Thai beef stir-fry"           -> not excluded
Oyster Sauce         shellfish    -> TRUE       (the gate knows the food, not its wheat)
Pico De Gallo Sauce  cilantro     -> false      recipe "Arepa Pabellón"               -> not excluded
Tomato Puree / Red Chilli / Cheddar Cheese -> TRUE   (controls: the harness can see a working gate)
```

### Mechanism — the same one as T-1 and T-3

The nightshade vocabulary knows `tomato`, `chilli`, `paprika`, `sriracha`,
`red pepper`. It does not know chili **cultivar** names (scotch bonnet, banana
pepper) or composite **sauce** names (enchilada sauce). The gluten vocabulary
knows `wheat` and `soy sauce` but not that oyster sauce is wheat-thickened —
and it *already excludes that exact row for shellfish*, so the food is known
and only the second question was never asked. **One vocabulary expansion, one
new leak**, exactly as `WORD_GUARDS`' structure predicts.

L-E is a **half-closed fix**: `7327a84` closed bare `Coriander` (verified
working) but not `Pico De Gallo Sauce`, which T-2's own probeF had already
named. The commit closed the row it measured and left the row beside it.

### Blast radius beyond the corpus — the missing-word probe

`node fleet/out/W4-2/hostileNames.mjs` puts 72 hostile food names (all from the
independent vocabulary, synthetic rows with NO metadata) to the real gate:
**35 caught, 37 missed** — `Belacan`, `Terasi`, `Bagoong`, `XO Sauce`,
`Kamaboko` (shellfish); `Katsuobushi`, `Hondashi`, `Nuoc Mam`, `Bottarga`,
`Colatura di Alici` (fish); `Labneh`, `Khoya`, `Smen`, `Mizithra` (dairy);
`Doenjang`, `Douchi`, `Kecap Manis` (soy); `Tremoços`, `Altramuces`, `Kacang`,
`Pindakaas`, `Arachis Oil`, `Mani` (peanut); `Gochugaru`, `Sambal Oelek`,
`Pimentón`, `Piri Piri`, `Aji Amarillo` (nightshade); `Besan`, `Gram Flour`
(legumes); `Orgeat`, `Dukkah` (tree nuts); `Ovalbumin` (egg); `Gingelly Oil`
(sesame). Negative controls 8 of 9 correct (`Green Beans`→legumes
over-excludes, safe direction). **The three of those 37 that are also real DB
rows are exactly L-A, L-B and L-C** — the probe predicts, the placements
confirm. The other 34 ship the next time somebody authors a recipe.

### Status of the fleet's earlier allergen items (verified independently by W4-2)

- **T-3 lupin↔peanut: CLOSED.** All 3 `Lupins, mature seeds …` rows now return
  true for `peanuts`/`peanut`/`lupin`/`legumes` (`6530fa0`). Confirmed.
- **T-2 `L1` bare `Coriander`: CLOSED** (`7327a84`). Confirmed. The 437
  coriander placements in the dumps are pre-fix and are not evidence against
  the current tree.
- **T-1 powder rows: unchanged**, and W3-6's insert guards held — its 10 probe
  recipes produced **zero** findings under this independent oracle.

---

## T-5 — an exclusion the user typed, the gate cannot express, and nobody is told (p101)

**Severity: P2 (preference, not allergy) — but it is the same fail-open shape.**
Found by W4-2, 2026-08-02.

Persona p101's `excludedFoods` is the sentence
*"no cow dairy but sheep and goat cheese are completely fine"*. The gate's own
resolver returns `{ kind: "literal", recognised: false, note: "not a recognised
allergen — matching on text only" }`, and then matches **nothing**:

```js
foodMatchesExclusionTerm(CheddarCheese, "<that sentence>") // -> false
foodMatchesExclusionTerm(Milk,          "<that sentence>") // -> false
foodMatchesExclusionTerm(Feta,          "<that sentence>") // -> false
```

**1,005 cow-dairy placements** followed across every arm — Cheddar Cheese,
Heavy Cream, Milk, Creme Fraiche, Greek Yogurt, Butter, Swiss cheese, Cottage
Cheese, Parmesan — including a recipe named "Chicken Fajita Mac and Cheese" and
a food row named "Butter". The persona fixture itself records `walls: []`: the
generator already knew the request was inexpressible.

The gate **internally marks the term `recognised: false`** and the user is
never told. The fix is not more keywords — it is surfacing that flag, which is
the same display/persistence honesty defect W1-4 isolated.
