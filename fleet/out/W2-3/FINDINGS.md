# W2-3 — VEGAN SNACK MARKET (soy + gluten + nut + peanut + sesame wall)

*Persisted by the orchestrator. Machine artifact: `fleet/out/W2-3/candidates.json` (45 candidates, 82 KB) + `build-candidates.mjs`, `fdc.mjs` as the reproduction path.*

## The headline

**The target box is not a "high-protein vegan" problem. It is a FAT problem, and it eliminates the entire nut-and-seed category by a factor of 3–4.**

Protein ≥ 8.16 g/100 kcal AND fat ≤ 2.60 g/100 kcal restated in energy terms is **≥ 32.6 %E protein and ≤ 23.4 %E fat.** Almost no plant food is shaped like that:

| food | Pd | Fd | verdict |
|---|---:|---:|---|
| Hemp hearts ([170148](https://fdc.nal.usda.gov/food-details/170148/nutrients)) | 5.71 | **8.82** | 3.4× the fat ceiling |
| Pumpkin seed kernels ([170556](https://fdc.nal.usda.gov/food-details/170556/nutrients)) | 5.40 | **8.77** | 3.4× |
| Sunflower kernels ([170562](https://fdc.nal.usda.gov/food-details/170562/nutrients)) | 3.56 | **8.82** | fails both axes |
| Chia ([170554](https://fdc.nal.usda.gov/food-details/170554/nutrients)) | 3.40 | **6.32** | 2.4× |

**10 g of hemp hearts spends 94% of the entire fat allowance of a 200 kcal snack for 3.2 g of protein.** Seeds are not the answer; they are *why* the current vegan snack pool has a fat density of 5.58.

## Target-box verdict — the honest count

**17 of 33 foods clear the box. That number is misleading and here is why.** Filter to foods that actually carry calories (≥100 kcal/100 g) and survive the full wall **including peanuts**, and it collapses:

> **Exactly ONE calorie-carrying whole plant food clears the box for this population unaided: sprouted lentils** ([FDC 168427](https://fdc.nal.usda.gov/food-details/168427/nutrients), 106 kcal, Pd 8.45 / Fd 0.52) — **and it fails the repo's own `checkAtwater`** (129 predicted vs 106 stated; the USDA row carries no fibre datum, so the fibre-adjusted arm cannot rescue it).

Everything else clearing the box is one of three things:
1. **A vegetable under 45 kcal/100 g** — crimini 11.36/0.45, white mushroom 14.05/1.55, asparagus 11.00/0.60, spinach 12.43/1.70, watercress 20.91/0.91, broccoli 8.29/1.09, frozen kale 9.50/1.64, mung sprouts 10.13/0.60, nori 16.60/0.80. Real, cheap, safe — **but they steer a slot, they cannot fill one.**
2. **A seasoning** — nutritional yeast, Pd 13.32 / Fd 0.83.
3. **Lupini beans — a peanut hazard.** See `fleet/TRIAGE.md` T-3.

**Realistic plate-real ceiling:** ~**8.4–8.9** Pd for a 200–270 kcal pulse snack; **10.6–12.4** for a 94–124 kcal vegetable one. There is a genuine energy/density tradeoff: **the larger the snack slot, the harder the box**, because the only things that raise density carry near-zero calories. Against the current vegan-snack median of **3.23**, every dish below is a **2.5–3.8× improvement**.

## The architecture that actually works

**Near-zero-fat pulse or vegetable base + nutritional yeast.** That is the *only* combination available under the wall. Nutritional yeast is the single cheap, widely stocked, soy/gluten/nut/peanut/sesame-free ingredient with ~50%+ protein and ~0 fat — and, critically for **T-1**, it is a **single-ingredient** food whose rows sit in `Baking Additives & Extracts` / `Flours & Corn Meal`, **not** `Protein and nutritional powders`. **Outside the blocked class.** Flagged anyway: the substring "nutritional" invites exactly that misfiling — **pin `fdcCategory` explicitly on insert.**

## The 12 dish proposals

All computed from the sourced foods; **all 12 pass the repo's real `foodValidation.checkAtwater`**; all 12 clear the box.

| # | dish | kcal | P g | F g | **Pd** | **Fd** | prep |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Lemon-Herb Lentil Snack Cup | 240 | 20.7 | 1.0 | **8.61** | 0.42 | no-cook |
| 2 | Minted Green Pea & Nooch Cup | 218 | 18.3 | 1.1 | **8.40** | 0.49 | no-cook |
| 3 | Savoury Mushroom & Spinach Skillet Cup | 115 | 14.3 | 1.0 | **12.40** | 0.86 | 5 min dry pan |
| 4 | Sprouted Lentil & Cucumber Crunch Bowl | 187 | 16.6 | 1.1 | **8.88** | 0.59 | no-cook |
| 5 | Bean-Sprout & Nori Slaw | 94 | 10.7 | 0.6 | **11.36** | 0.68 | no-cook |
| 6 | Fava & Herb Smash on Cucumber Rounds | 182 | 15.7 | 0.8 | **8.65** | 0.46 | no-cook |
| 7 | Split-Pea & Dill Snack Bowl w/ Crudités | 257 | 21.0 | 1.3 | **8.18** | 0.49 | batch + cold assembly |
| 8 | Roasted Asparagus & Nooch Spears | 100 | 11.9 | 0.7 | **11.91** | 0.72 | 12 min oven, no oil |
| 9 | Chilled Broccoli & White-Mushroom Chop | 115 | 12.7 | 1.2 | **11.02** | 1.08 | no-cook |
| 10 | Pea & Lentil Protein Scoop | 273 | 22.3 | 1.1 | **8.19** | 0.41 | no-cook |
| 11 | Brussels & Kale Nooch Crisps | 124 | 13.1 | 1.3 | **10.60** | 1.06 | 18 min oven, no oil |
| 12 | ⚠️ Lupini Snack Jar — **GATED (T-3)** | 157 | 20.3 | 3.8 | **12.95** | 2.43 | no-cook |

**11 wall-safe, 1 gated.** Eight are genuinely no-cook and portable. Three use the oven **with no added oil** — not stylistic: **5 g of any oil moves a 120 kcal dish from Fd 1.06 to Fd 4.6 and destroys it.**

Authoring cautions baked into the JSON: **do not name #7 a "dip"** (F3 bars `condiment_or_sauce` from meal slots; "bowl" keeps it safe); every recipe must be tagged `slotType: snack`/`either` and must **not** land in `dessert`/`beverage`/`bread_or_pastry_side`/`condiment_or_sauce`.

## Canadian availability

- **Lupini** — Unico 540 mL, ~**CAD 2.25–2.49**, Loblaws banners. Panel ([unico.ca](https://www.unico.ca/products.php?id=39&catid=5)): ½ cup = 190 kcal, 22 g P, 6 g F, 13 g fibre, **960 mg sodium**.
- **Canned lentils** — Unico 540 mL, **CAD 1.69 (Maxi) – 2.49 (Loblaws)**; ½ cup = 120 kcal, 9 g P, 0.5 g F. [loblaws.ca](https://www.loblaws.ca/en/lentils/p/20313447003_EA)
- **Nutritional yeast** — Bragg 127 g **CAD 8.99–10.99** ([NaturaMarket](https://naturamarket.ca/bragg-nutritional-yeast-seasoning-127g.html)); also Walmart.ca, Bulk Barn. **Do NOT spec Bulk Barn** — its listing declares **"May contain wheat."** ([bulkbarn.ca](https://www.bulkbarn.ca/en/Products/All/Flaked-Nutritional-Yeast-939))
- **Chickapea** — Canadian (Collingwood ON), certified GF facility, *"none of the major allergens are present in the facility"* — the strongest allergen-control claim sourced ([FAQ](https://chickapea.ca/pages/faqs)). ~CAD 6/227 g. **Misses the box (6.19) — a meal, not a snack.**
- **Asparagus** is seasonal/price-volatile in Canada; **frozen** (Pd 13.46) is the year-round form and scores better.
- **Frozen kale clears; RAW kale FAILS (Fd 4.26).** The form is the entire difference — **the grocery list must not silently substitute.**
- **Sprouted lentils are not a reliable Canadian retail item** — home-sproutable from any bulk lentil (jar + water, 3–4 days), which is also why their supply-chain allergen risk is ~zero.
- Nothing proposed is US-only.

## Provenance

**USDA-VERIFIED** for SR Legacy/Foundation (lab analysis, FDC id) vs **LABEL** for manufacturer panels — **including USDA FDC Branded rows, which are brand-submitted label transcriptions, not USDA lab work, even though they carry an fdcId.** **Nothing is AI-ESTIMATED. There are no unsourced numbers in the file.**

Sanity gate run against the repo's real `foodValidation.checkAtwater` (15% *or* 10 kcal absolute), not a reimplementation: **4 of 45 flagged** — `Seaweed, laver` (46 vs 35), `Lentils, sprouted` (129 vs 106), `Beans, fava, in pod` (109 vs 88), `Seaweed, spirulina` (395 vs 290). The first three all lack a fibre datum in USDA. **Each is marked do-not-insert-without-a-documented-exception. All 12 dishes pass.**

## Risks / where I'd be wrong

1. **⚠️ THE LUPIN FAIL-OPEN — filed as `fleet/TRIAGE.md` T-3.** Lupini is the best box-clearing snack-shaped whole food that exists (Pd 13.11 / Fd 2.45), **three USDA-verified lupin rows already sit in `dev.db` with zero recipe references**, and `foodMatchesExclusionTerm(lupinRow, 'peanuts') === false`. Health Canada advises every peanut-allergic consumer to avoid lupin (5–37% cross-reactivity); lupin is **not** a Canadian priority allergen so packages carry no "Contains" statement; `allergenTaxonomy.js:635` documents the cross-reaction **in prose, with no code consuming it.** Same shape as T-1. **Inert today, live the moment anyone acts on this brief.**
2. **Brand, not recipe, decides whether these dishes survive the wall.** The arithmetic uses Bob's Red Mill nutritional yeast, whose retailer listing declares **may contain soybean and tree nuts** — so 11 of 12 honestly inherit that flag. Bragg's panel declares free of wheat/soy/milk and is GF-labelled. **If W3-6 inserts these against a BRM- or bulk-bin-sourced yeast row, the dishes fail the wall they were designed for.** Bragg's *numeric* panel per 100 g could not be sourced — only its allergen claims — so **the macro basis and the allergen basis in the file come from different brands.** A real seam, marked rather than papered over.
3. **Lupini's two sources disagree materially on fat.** USDA 172424 → Fd **2.45**, clears. Unico's own panel → Fd **3.16**, **fails.** Unico declares no gram weight for its ½-cup serving. Both reported, neither claimed.
4. **Broccoli's margin is 0.13 g** (Pd 8.29 vs floor 8.16). **Do not build a claim on it.**
5. **Fava carries a hazard the app does not model at all: favism** (G6PD deficiency) is haemolytic, not allergic — no allergen taxonomy will ever catch it.
6. **Mustard greens will be falsely excluded** — "mustard" is a Canadian priority allergen and a taxonomy key; the greens are the leaf, not the seed. An H5-shaped over-exclusion, not a leak.
7. **Branded FDC data is noisy** — "red lentils" returned 219–380 kcal/100 g for the same commodity. SR Legacy used wherever one existed.
8. **No day-level effect measured or claimed.** W1-5 measured snack misses as pool-caused; F2 warns density is worth ~3.4 pts against a ~3.45-pt floor. **These dishes may measure zero.** They are a correctness/coverage fix for 17 personas who currently have *nothing*, not a scored lever.
9. **Adjacent but load-bearing:** the highest-leverage fix for this population may not be authoring at all. **H3** — the gluten guard covers `flour`/`tortilla`/`cereal` but not `pasta`/`noodle` — hides **53 genuinely gluten-free** High-Protein Lentil/Chickpea Pasta recipes from exactly these users. **A one-word code fix unlocking 53 meal recipes.** It does not touch the snack slot, but it is cheaper than everything above.

## Summary

29 of 45 candidates clear the box; 17 foods, 12 dishes — **but exactly one calorie-carrying food clears unaided under the full wall, and it fails Atwater.** Best density 20.91 (watercress, 11 kcal — steers, can't fill); best snack-shaped 13.11 (lupini, **peanut-gated**). Realistic ceiling 8.4–8.9 Pd at 200–270 kcal — still a **2.5–3.8× lift** over 3.23. **Nuts and seeds are dead here** (3.4× over on fat), as are all roasted-pulse snacks (the oil makes the crisp). Top 5 for the wall: **nutritional yeast (Bragg-class) · canned lentils · frozen green peas · crimini/white mushroom · mung bean sprouts.** **14 of 17 box-clearing foods already exist in `dev.db`, USDA-verified, with zero recipe uses; nutritional yeast has 0 rows.** Biggest sourcing risk: **nutritional yeast brand** — wrong brand and the wall breaks. **T-1 respected: no powders, no isolates.**
