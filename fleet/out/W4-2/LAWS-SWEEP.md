# W4-2 — LAWS SWEEP

**Agent:** W4-2 laws-sweep · **Wave:** W4 (adversarial verify)
**Run:** 2026-08-02/03 · **HEAD at start and end:** `748c524` (unchanged; `fleet/out/W4-1/`, `fleet/out/W4-3/` appeared as untracked dirs mid-run — other sessions working)
**Scope:** every day-dump any agent produced — **144 JSONL files** (42 under `fleet/out/**`, 102 under `fleet/scratch/**`), **78,286 day records**, **344,600 slot placements**, 540 distinct recipes, **0 unresolved placements**, 12 agent namespaces (K2c, P0postfix, W1-1, W1-2, W1-5, W1-6, W3-2, W3-4, W3-5, W3-6, W3-7, W4-1).

| Law | Verdict | Number |
|---|---|---|
| **1 · Allergen / diet exclusions** | **BREACHED — 5 open gate false negatives, 1,226 shipped placements** | plus 1 fixed-since (437 placements) and 1 unenforceable-exclusion class (1,005) |
| **2 · Calorie floor (prescription)** | **HOLDS — 0 violations** | 0 / 56,323 records carrying an `energy` block |
| **3 · Keto carb ceiling** | **HOLDS in grading — 0 silent breaches** | 869 / 5,913 keto days breach the ceiling; **0** were graded `carbOk`, **0** graded in-band |

**No probe arm introduced a violation.** Every allergen finding below is a pre-existing gate false negative that all arms inherited from the shared pool; the trim/portioner/vegan-niche probes add none, and the trim arm *removes* the keto breaches (below). That is the answer to "did the probes bend the laws": they did not.

---

## Reproduction

```bash
node fleet/out/W4-2/lawsweep.mjs         # placement sweep  -> lawsweep.json
node fleet/out/W4-2/lawsweep2.mjs        # floors + keto, uncapped -> lawsweep2.json
node fleet/out/W4-2/reachability.mjs     # does the CURRENT tree still leak? -> reachability.json
node fleet/out/W4-2/hostileNames.mjs     # missing-word probe -> hostile-names.json
```
DBs read (read-only, `node:sqlite`): `fleet/scratch/W1-2/dev.db` `d9037dce` (the DB every dump was produced against), `fleet/scratch/W3-6/dev.db` `8c080b54` (probe DB, +10 recipes +1 food), `backend/prisma/dev.db` `fb67a37f` (current tree). Personas: `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1dd…57704e`, 250 rows.

---

## LAW 1 — allergen and diet exclusions

### My oracle, and why it is independent

`fleet/out/W4-2/oracleVocab.mjs`. Authored 2026-08-02 from culinary/food-science knowledge — Health Canada priority allergens, FDA Big-9, restaurant practice, transliterations — **before reading `dietaryFilter.js` or `allergenTaxonomy.js`**, and deliberately weighted toward the terms an English keyword list is structurally likely to lack: transliterations (`tahina`, `tehina`, `besan`, `kacang`, `dhania`, `tremoços`), carriers that name no allergen (`surimi`, `kamaboko`, `worcestershire`, `dashi`, `XO sauce`, `oyster sauce`), dish-name implications (`falafel`→sesame, `caesar`→anchovy+egg, `wonton`→egg+wheat), and cross-reactive families (`lupin`↔peanut).

This is the point W2-3 and T-2 both had to learn the hard way: **a sweep built from the filter's own term list can only detect disagreement between two copies of the same vocabulary — it can never detect a missing word**, which is the only failure mode that has ever actually shipped here.

Two evidence channels, both applied to the *actual ingredient rows* of each placed recipe:
1. **culinary vocabulary** (the authored list) against ingredient names → dish name → steps text;
2. **USDA/FNDDS `fdcCategory`** on each ingredient row — evidence authored by USDA, not by this repo. (First pass, these rules were too loose: `Cereal Grains and Pasta` holds quinoa and cornstarch, `Plant-based milk` holds coconut milk. Both produced false positives, both are now excluded by construction; the loose version is not what the numbers below come from.)

**Independence, measured two ways.**
- Crude: 887 literal terms extracted from the oracle's patterns, **316 (35.6%) appear nowhere** in `allergenTaxonomy.js` + `dietaryFilter.js`. Treat this as directional only — the extractor splits on regex metacharacters and produces some truncated fragments.
- Strong: the **missing-word probe** below — 72 hostile food names, all from the independent vocabulary, put to the real gate. **The gate misses 37 of 72.**

### Positive control — the sweep fires

A synthetic recipe `CONTROL-w42-tahina-lupini` ("Levantine Mezze Platter": Tahina, Lupini Beans, Surimi Sticks, Besan, Aged Cheddar) is injected into the stream on every run and handed to a wall set of sesame+peanuts+shellfish+gluten+dairy+legumes. It fires **10 findings across all 6 walls**: `sesame:tahina` ×2, `peanuts:lupini`, `shellfish:surimi`, `gluten:crackers`, `dairy:cheddar`, `dairy:Aged Cheddar` (fdcCategory channel), `legumes:beans|lupini|besan`. Both channels fire. Disable with `--nocontrol`.

Second control, on the *reachability* harness (which does call the product gate): `Tomato Puree`→nightshades, `Red Chilli`→nightshades, `Cheddar Cheese`→dairy all return `gateExcludes: true`, so a `false` from that harness means the gate genuinely does not exclude, not that the harness is miswired.

### Findings — OPEN on the current tree

Every row below was verified twice: (a) the recipe was **actually placed** on that persona's plate in the dumps, and (b) the **current** tree (`748c524`, DB `fb67a37f`) still returns "not excluded" at both food level (`foodMatchesExclusionTerm`) and recipe level (`traceRecipeExclusions`). Evidence: `reachability.json`.

| # | Wall | Carrier food (DB row) | Recipe | Personas | Placements | Still open? |
|---|---|---|---|---|---|---|
| **L-A** | nightshades | **`Scotch Bonnet`** (Capsicum chinense) | Mango chow | p088 | **242** | YES |
| **L-B** | nightshades | **`Enchilada sauce`** (tomato + chili base) | Chicken Enchilada Casserole | p169 p057 p174 p063 p038 p042 p142 | **292** | YES |
| **L-C** | nightshades | **`Banana Pepper`** (Capsicum annuum) | Porotos Granados | p224 p142 | **16** | YES |
| **L-D** | gluten | **`Oyster Sauce`** (wheat-thickened) | Thai beef stir-fry | p181 p104(keto) p125 | **160** | YES |
| **L-E** | cilantro | **`Pico De Gallo Sauce`** | Arepa Pabellón | p191 p223 | **516** | YES |

Total **1,226 shipped placements** on **14 personas**.

**L-D is the sharpest one.** The gate *does* exclude `Oyster Sauce` for a **shellfish** wall (`gateExcludes: true`) and does *not* for a **gluten** wall. It knows the food; it does not know the food's wheat. That is the exact structural failure `CLAUDE.md` and the brief already name — `WORD_GUARDS` is a denylist of exceptions to a denylist, so each new wall re-asks the same food a question nobody wrote an answer for.

**L-A/B/C** are one family: the nightshade vocabulary covers `tomato`, `chilli`, `paprika`, `sriracha`, `red pepper` — but not chili *cultivar names* (scotch bonnet, banana pepper) and not composite *sauce* names (enchilada sauce). T-2's hostile rules found harissa/passata/sriracha and stopped there; these three were never asked.

**L-E** is a half-closed fix. `7327a84` closed bare `Coriander` (verified: `Coriander`→cilantro is now `true`, and `Vietnamese caramel trout` is now recipe-level excluded). It did **not** close `Pico De Gallo Sauce`, which T-2's own probeF named. The commit closed the row it measured and left the row beside it.

### Findings — CLOSED, verified independently

| Item | Status | Evidence |
|---|---|---|
| **T-3 lupin↔peanut** (W2-3's open item, fix `6530fa0`) | **CLOSED — confirmed** | All 3 lupin rows: `Lupins, mature seeds, raw/cooked ±salt` return `true` for `peanuts`, `peanut`, `lupin`, `legumes`. `hostile-names.json` also confirms `Lupin Flour`→peanuts is caught. |
| **L1 bare `Coriander`** (T-2, fix `7327a84`) | **CLOSED — confirmed** | `Coriander`→cilantro `true`; recipe-level exclusion fires. The **437 placements across p110/p221/p191 in the dumps are pre-fix** and are not evidence against the current tree. |
| W3-6's "0 leaks, both arms" | **CORROBORATED** | The 10 probe-inserted recipes + `Nutritional yeast, large flake` resolved from `8c080b54` and produced **zero** findings under an oracle that shares no vocabulary with the gate. Their throw-guards held: no lupini, no powder rows. |

### Finding — an exclusion the gate cannot express (p101)

Persona **p101**'s `excludedFoods` is the free-text sentence *"no cow dairy but sheep and goat cheese are completely fine"*. The gate's own resolver says:

```
resolveExclusionTerm(...) -> { kind: "literal", recognised: false,
                               note: "not a recognised allergen — matching on text only" }
foodMatchesExclusionTerm(Cheddar Cheese, <sentence>) -> false
foodMatchesExclusionTerm(Milk,           <sentence>) -> false
foodMatchesExclusionTerm(Feta,           <sentence>) -> false
```

Result: **1,005 placements of cow-dairy foods** (Cheddar Cheese, Heavy Cream, Milk, Creme Fraiche, Greek Yogurt, Butter, Swiss cheese, Cottage Cheese, Parmesan) onto a plate whose owner asked for no cow dairy — including a recipe literally named "Chicken Fajita Mac and Cheese" and a food row named "Butter". The persona fixture itself records `walls: []`, i.e. the fleet's own generator already knew the request was unexpressible.

This is a **preference**, not an allergy, so it is not P0. It matters because the failure is the same one as L-A…L-E in a different coat: *absence of a match is read as absence of a restriction*. The gate internally marks the term `recognised: false` — the honest fix is to surface that to the user ("we could not interpret this restriction"), which is exactly the display/persistence honesty defect W1-4 already isolated.

### Oracle false positives — adjudicated and dismissed

Stated so the count above is not read as 100% precision. My oracle raised these; I read the ingredient rows and rejected them:

| Raised | Why it is not a leak |
|---|---|
| `tree nuts: butternut` (7 placements) | the row is **Butternut Squash**. Butternut *is* a true tree nut (Juglans cinerea); the squash is not. Oracle pattern too broad. |
| `tree nuts: chestnut` (2) | the row is **Water Chestnut** — a sedge corm, not a nut. |
| `shellfish: paella` (3) | "Roast fennel and aubergine paella" — dish-name inference; the ingredient list is vegan. |
| `dairy: gratin` (127) | "Boulangère Potatoes" — stock-based by definition; the steps say *gratin* as a technique. Ingredients: onion, thyme, olive oil, potatoes, vegetable stock. |
| `gluten: flour` (73) | "Arepa" — ingredients are **Corn Flour**, salt, water. The steps text says "flour" unqualified; my corn-guard is on the compound, not the sentence. |
| `sesame: shawarma` (6), `cilantro: chimichurri` (2) | dish-name inference, `standard` strength; the ingredient rows carry neither. Left as advisory, not counted as leaks. |

Advisory-strength classes (not counted, listed for the record): `soy: vegetable oil` 1,081 placements, `gluten: oats/porridge` 994, `tree nuts: coconut` 194, `pork: sausage/dumplings` 535, `beef: mince/burgers` 68. These are cross-contamination and variable-sourcing questions a real product has to take a position on; they are not gate defects.

### The missing-word probe (the part a corpus sweep cannot do)

A placement sweep can only find the misses the corpus happens to contain. `hostileNames.mjs` takes 72 names from the independent vocabulary, builds a synthetic `Food` row with **no metadata** (exactly the T-1 condition), and asks the gate.

**Result: 35 of 72 caught, 37 missed.** Missed, by family:

- **sesame** — `Gingelly Oil`
- **peanuts** — `Tremoços`, `Altramuces`, `Kacang Sauce`, `Pindakaas`, `Arachis Oil`, `Mani Tostado`
- **fish** — `Katsuobushi Flakes`, `Hondashi`, `Nuoc Mam`, `Colatura di Alici`, `Bottarga`
- **shellfish** — `Belacan`, `Terasi`, `Bagoong`, `XO Sauce`, `Kamaboko`
- **dairy** — `Labneh`, `Khoya`, `Smen`, `Mizithra`
- **eggs** — `Ovalbumin Powder`
- **soy** — `Doenjang`, `Douchi`, `Kecap Manis`
- **tree nuts** — `Orgeat Syrup`, `Dukkah`
- **nightshades** — `Scotch Bonnet`, `Banana Pepper`, `Enchilada sauce`, `Gochugaru`, `Aji Amarillo Paste`, `Pimentón`, `Piri Piri Sauce`, `Sambal Oelek`
- **legumes** — `Besan`, `Gram Flour`

Caught (so the probe is not simply pessimistic): `Tahina`, `Tehina Sauce`, `Gomashio`, `Simsim Paste`, `Benne Wafers`, `Za'atar`, `Halva`, `Lupin Flour`, `Nam Pla`, `Garum`, `Worcestershire Sauce`, `Seitan`, `Freekeh`, `Kamut`, `Matzo Meal`, `Panko`, `Malt Extract`, `Skyr`, `Sodium Caseinate`, `Aioli`, `Century Egg`, `Yuba`, `Okara`, `Gianduja`, `Frangipane`, `Pignoli`, `Tomatillo Salsa`, `Toor Dal`, `Carob Powder`, and others.

**Negative controls: 8 of 9 correct** — `Ground Nutmeg`/peanuts, `Coconut Milk`/dairy, `Eggplant`/eggs, `Butternut Squash`/tree nuts, `Water Chestnut`/tree nuts, `Black Pepper`/nightshades, `Sweet Potato`/nightshades, `Gluten-Free Penne`/gluten (H3's fix holds) all correctly **not** excluded. The ninth, `Green Beans`/legumes, **is** excluded — over-exclusion in the safe direction, botanically defensible, not a defect.

**The three names in that missed list that are also real DB rows are exactly L-A, L-B and L-C.** The probe predicts, the placement sweep confirms. The other 34 are what ships the next time someone authors a recipe.

---

## LAW 2 — calorie floor

**Rule** (`CLAUDE.md` constitution): never prescribe below `max(RMR × 0.95, 1500 kcal men / 1200 women)`; user floors may be stricter.

**Oracle:** recomputed from the constitution text against each record's own `energy.rmr` and the persona's `sex` and `profile.floorKcal` — **not** read from `energy.floorKcal` and **not** trusting the `energy.floored` boolean. Where they disagreed, my recomputation would win; they never disagreed.

**Result: 0 violations in 56,323 records that carry an `energy` block.** Includes W4-1's `armP`/`armF` dumps, which are produced with the **uncommitted `bmrEngine.js` fat rewrite** — that change does not breach the calorie floor.

**Secondary metric — delivered kcal below the user's own floor.** Not the law (the law is about the prescription), but it is what the plate does. Counted strictly, only on days whose own record carries `energy`: **7,222 of 54,700 filled days = 13.2%**.

Per-arm, same seeds and same denominators (1,869 filled days = 3 seeds × 623):

| arm | below own floor | rate |
|---|---|---|
| base / noop | 204 | 10.9% |
| c2 (smallest-first) | 166 | **8.9%** |
| trim (W3-7) | 195 | 10.4% |
| b20 | 194 | 10.4% |
| c14 (in-gate steering) | 287 | **15.4%** |
| c14_c2 | 282 | 15.1% |
| c14_c2_trim | 282 | 15.1% |
| l2 / linf / linf_c2 | 383 / 375 / 377 | ~20% |
| wls2repro | 364 | 19.5% |
| **floor25 (0.25× portion floor)** | 435 | **23.3%** |

Reading: **the TRIM arm does not push days under the floor** (10.4% vs 10.9% base) — its downscaling lands inside the deficit, not below it. The **portioner arms do**: `c14` costs +4.5pp, the L2/L-inf family +9pp, and `floor25` +12.4pp. W3-2 already called `floor25` unshippable on the plate-size argument; this is a second, independent reason. Any W5 recommendation that ships `c14` should carry the floor number with it.

---

## LAW 3 — keto carb ceiling

**Rule:** keto carb overshoot allowance is **0** (`dayDump` ruler header: *"keto carb overshoot allowance = 0"*).

**Oracle:** `dietStyle === "keto"` taken from the **persona fixture**, ceiling taken from the record's own `target.carbHi`, breach computed as `achieved.carb > carbHi`. The app's `verdict.carbOk` and `engineInBand` are read **only afterwards**, to ask whether the app agreed — never to decide whether a breach happened.

**Result: 869 of 5,913 keto days (14.7%) exceed the ceiling. Of those, 0 were graded `carbOk` and 0 were graded in-band.** The ceiling is enforced in grading; there is no silently-certified keto breach anywhere in 78,286 records.

Per-arm (3-seed pools, 147 keto days each):

| arm | over ceiling | rate |
|---|---|---|
| base / noop / g4fix / reimpl / trimf | 32 | 21.8% |
| c2 | 31 | 21.1% |
| c13 | 24 | 16.3% |
| linf / linf_c2 / linf_g / l2 | 13–18 | 9–12% |
| b20 | 16 | 10.9% |
| c14 | 2 | 1.4% |
| c14_c2 | 1 | 0.7% |
| **trim / trimfc / c14_c2_trim / c14_c2_b20 / wls2repro** | **0** | **0.0%** |

**W3-4's claim "baseline has 32, the trim ELIMINATES all 32" reproduces exactly** under an independent recomputation. Worst single breach across the whole corpus: p104, ceiling 30 g, delivered **53.8 g** (`fleet/scratch/W3-2/dump-c13-s8675309.jsonl`) — correctly graded out of band, and yet the same record reports `engineMatchPct: 88`. A day 79% over its own carb ceiling displaying "88% match" is not a Law-3 breach, but it is the display honesty defect W1-4 documented, showing up in the safety-critical macro.

---

## Knife-edges and what this sweep does NOT establish

1. **The sweep is placement-scoped.** It grades what the solver actually put on plates in these 144 dumps. A leak in a pool region no persona reached is invisible to it — that is what the missing-word probe is for, and 34 of its 37 misses are not yet in the corpus.
2. **The dumps predate two fixes.** `7327a84` (coriander) and `6530fa0` (lupin) landed after most dumps were written. Placement counts for those two are historical; the *current-tree* answer is in `reachability.json`.
3. **Steps-text hits are weaker evidence than ingredient rows** and are reported separately. Three of my six false positives came from steps text.
4. **My oracle has a measured false-positive rate** (6 dismissed classes above). I have not measured its false-*negative* rate, and cannot: that would need a vocabulary independent of *both* lists.
5. **`dietaryFilter.js` carries 3 NUL bytes.** Every search in this sweep used `grep -a`, the Read tool, or Node `require` — never plain ripgrep/Grep. No negative claim here rests on a silent binary-file skip.
6. **Law 2's secondary metric is unavailable on slim dumps** (K2c, W1-5, most W3-4) because those schemas drop `energy`. Rates above are strict-mode only.
