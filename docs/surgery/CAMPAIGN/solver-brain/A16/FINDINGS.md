# A16 · Pool enrichment curve — how many recipes buy how many points

*Agent A16. Persisted to disk by the fleet coordinator from A16's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A16's.
**This is A16's REVISED text**, returned after the coordinator sent C19 (the `oracle.mjs`
blind spot) mid-flight; it supersedes the first version and downgrades A16's own leak
warrant. A16's scripts, ~30 artifacts and 24 `CLAIMS.tsv` rows DID land.*

**The curve is not about volume. It is about one missing ingredient class.** Eight synthetic recipes built on ONE simulated protein-concentrate `Food` row buy **+10.45 pts**. Sixty-eight synthetic vegetarian whole-food recipes buy **+8.02**. What binds is the library's whole-food protein-density ceiling, not its recipe count. MEASURED.

## The number the owner can cost — 85 % satisfiable-only, from 77.1 %

| route | recipes to reach 85 % | bracketing arms |
|---|---|---|
| **one concentrate Food row + recipes** | **~4** | N4 = 84.9 %, N8 = 87.5 % |
| vegan whole-food | ~26 | N20 = 84.3 %, N40 = 86.8 % |
| vegetarian whole-food | ~65 | N40 = 84.3 %, N68 = 85.1 % |

DERIVED, linear interpolation between measured arms. The concentrate route is **6.5×** cheaper than vegan and **16×** cheaper than vegetarian authoring. Replicated at seed 20260730: conc-N4 = +8.21 pts (77.8 → 86.0 %), against +7.84 at seed 424242 — cross-seed spread on the delta **0.37 pts**. MEASURED.

## The curves (satisfiable-only, paired McNemar, seed 424242, baseline 413/536 = 77.1 %)

| N | vegetarian | vegan | concentrate |
|---|---|---|---|
| 1 | — | — | +2.61 (b=9 c=23) **UNRESOLVED, C14** |
| 2 | — | — | +4.48 (b=12 c=36) |
| 4 | — | — | **+7.84** (b=12 c=54) |
| 5 | +5.04 (b=6 c=33) | +4.29 (b=6 c=29) | — |
| 8 | — | — | **+10.45** (b=5 c=61) |
| 10 | +5.60 (b=9 c=39) | +6.90 (b=1 c=38) | — |
| 20 | +7.09 (b=8 c=46) | +7.28 (b=5 c=44) | — |
| 40 | +7.28 (b=9 c=48) | +9.70 (b=10 c=62) | — |
| 68 | +8.02 (b=11 c=54) | — | — |

Marginal points per recipe, concentrate: 2.61 / 1.87 / 1.68 / **0.65** over 0-1 / 1-2 / 2-4 / 4-8. Vegetarian: 1.008 / 0.112 / 0.149 / 0.010 / 0.026 over 0-5 / 5-10 / 10-20 / 20-40 / 40-68. **The knee is at N≈4-5 on every arm; past ~20 whole-food rows the curve is flat.** Not monotone — vegan rebounds 0.038 → 0.121 between 10-20 and 20-40.

## The gain does not land where the corner label says (contradicts a C11 reading)

`A16-enrich-vegetarian-N68`, 54 gained days:

| persona style | n | base % | trt % | gained | lost | share of gain |
|---|---|---|---|---|---|---|
| none | 275 | 88.0 | 95.3 | 24 | 4 | **44.4 %** |
| vegan | 35 | 60.0 | 88.6 | 10 | 0 | 18.5 % |
| kosher | 35 | 54.3 | 68.6 | 7 | 2 | 13.0 % |
| mediterranean | 49 | 87.8 | 100.0 | 6 | 0 | 11.1 % |
| **vegetarian** | 57 | 63.2 | **64.9** | 5 | 4 | **9.3 %** |
| keto | 46 | 63.0 | 63.0 | 0 | 0 | 0 % |
| carnivore | 3 | 0.0 | 0.0 | 0 | 0 | 0 % |

C11 is right that vegetarian is the thinnest pool and wrong as a purchasing instruction. Vegetarian personas themselves move **+1.7 pts (n=57, b=4 c=5) — unresolved at this n**. The row *shape* that pays is high-protein / low-fat, and the product's gate hands it to every style that admits it. Vegan-composition rows clear more gates, which is why **40 vegan rows beat 68 vegetarian rows**. C11 is corroborated on keto: zero synthetic rows admitted, zero days gained, in all five arms.

All 8 concentrate recipes are **snacks**, 145-236 kcal, fat density 0.54-0.91 g/100 kcal against a 2.32 target centroid. One low-fat, high-protein snack per day is the whole effect — the mechanism A11 predicted (pool fattier than every target) and C9 recorded (74 days failing on fat alone, all OVER band).

## C19 — the A17 artifact check. A16 does not show it.

Net days gained, satisfiable tier vs IMPOSSIBLE tier, paired on `dayKey`:

| arm | satisfiable net (g/l) | IMPOSSIBLE net (g/l) | IMPOSSIBLE share of all-days net gain |
|---|---|---|---|
| veg-N5 | 27 (33/6) | **0** (0/0) | 0.0 % |
| veg-N68 | 43 (54/11) | **0** (0/0) | 0.0 % |
| vegan-N5 | 23 (29/6) | **0** (0/0) | 0.0 % |
| vegan-N40 | 52 (62/10) | **0** (0/0) | 0.0 % |
| conc-N4 | 42 (54/12) | 3 (3/0) | 6.7 % |
| conc-N8 | 56 (61/5) | 3 (4/1) | 5.1 % |

**All four whole-food arms gain zero IMPOSSIBLE-tier days.** A17's widening gained 9 of 10 there. The concentrate arm's all-days gain exceeds its satisfiable gain by 3 days — 5.1 %, not a redirection of the result. MEASURED. My headline is quoted satisfiable-only throughout, so no A16 number is inflated by customers the app should decline.

## Leaks — C16 as run, then withdrawn as a warrant under C19

| arm | slots | synthetic slots | leaks |
|---|---|---|---|
| baseline | 2818 | 0 | 5 |
| veg-N20 / veg-N68 | 2834 | 326 / 438 | 1 / 3 |
| vegan-N20 / vegan-N40 | 2834 / 2846 | 321 / 418 | 4 / 1 |
| conc-N8 | 2910 | 358 | 0 of 358 checked |

Pool-mode against `oracle.mjs` `AUDIT_ALLERGENS`, 250 personas: vegetarian 9621 admissions 0, vegan 5870 0, none 9924 0. No leak count rises, and no synthetic row is implicated — every hit is a pre-existing real recipe.

**None of that is a safety warrant.** A17 measured that `oracle.mjs` catches **1 of the 13 C13 rows** (`Seal, bearded (Oogruk), meat`, only because the literal token `meat` sits in `oracle.mjs:80`), and reported **0 leaks on an arm that placed `Sea cucumber, yane (Alaska Native)` 309 times**. The mandated independent verifier shares the product gate's blind spot. A clean oracle run on my arms is **necessary and not sufficient**, and I do not claim these arms leak-free on its authority. Cite A17.

**What I checked instead, directly by name (C19 step 1):** all **70 distinct `Food` names** used across the three catalogue corners and the concentrate arm, substring-matched against the C13 list — squirrel, groundhog, armadillo, wild pig, heart, owl, sea cucumber, ceviche, hog maws, bear, dove, isopure/whey, seal/oogruk. **0 hits.** The full list is dominated by Tofu, Tempeh, Seitan, Edamame, TVP, Greek yogurt, rice, flours, and ordinary meats. MEASURED.

**The gate applied to my synthetic rows (C19 step 3)** is the product's, not mine. Ingredient eligibility: `exclusionGate.isExcluded` + `foodValidation.macroTrustIssue` + used by ≥2 real recipes + grams capped at the library's own maximum use for that food (`A16-catalogue-v2.mjs:95-103,116`). Per-persona admission: `planContext.filterRecipePool` then `mealSolver.applyPrepFilter` (`A16-enrich.mjs:42-43`). A synthetic row a persona's allergies forbid is dropped by product code.

**The limitation I cannot close.** The rig's slot record is `slotType, slotIndex, recipeId, proteinScale, sidesScale, pinnedLo, pinnedHi, kcal, protein, warning` — **no ingredient names, no adjuster field**. Every leak check I ran resolves ingredients by `recipeId`, so **adjuster-placed foods are structurally invisible to all of them**. A raw text scan of four arms for the C13 terms returns 0, and that is evidence the JSONL never records adjuster foods, **not** evidence of absence. The mitigation is structural: `A16-enrich.mjs:44` returns only `{ pool: … }`, and `A16-concentrate.mjs:150` sets `patch.adjusters` only under `MODE=adjuster|both` — every arm here ran `A16_CONC_MODE=recipes`. **No A16 treatment widened the adjuster gate**, so adjuster exposure is identical in baseline and treatment and is not *caused* by enrichment. Identical to baseline is not absent.

Two audit-list defects found, neither an engine defect: `oracle.mjs:59` lists `"nut butter"` under `nuts` and `:68` aliases `AUDIT_ALLERGENS["tree nuts"] = AUDIT_ALLERGENS.nuts`, so **"Peanut Butter" false-positives as a tree nut** (4 of the baseline's 5); the 5th is "Egg Plants" matching the vegan egg term. And `oracle.mjs:54` omits bare `"flour"` from the gluten list on purpose (`:51` — *"flour and oat/rice/corn/sorghum bran are gluten-FREE"*), so it would **not** have caught `A16-conc-5` (Self-raising Flour) reaching a gluten-excluding persona. The product gate shipped it there **0 times** — but the oracle would not have said so. Both for A24, alongside A17's finding.

**My own instrument fault, recorded:** `A16-leakcheck-v2.mjs` resolves slots only by the catalogue's `A16-syn-*` ids, so against conc-N8 it reported `unknown-ids 358` and inspected 2552 of 2910 slots. `A16-conc-leakcheck.mjs` closes that gap: 358/358, 0 leaks.

## A3 vs A7 — which sense of "impossible"

The concentrate speaks to **A7's library sense, not A3's structural proof**. IMPOSSIBLE tier, n=86 judged: baseline 21 in band (24.4 %) → conc-N8 24 (27.9 %), gained 4, lost 1, across 77 concentrate slots on 47 days. **61 of the 65 baseline IMPOSSIBLE misses survive one concentrate row.** One authored row does not clear the killer stack wholesale; it moves the *satisfiable* population by 10 points. Both A3 and A7 stand.

## Caveats

- **Upper bound, not a forecast.** Each catalogue row is optimised straight onto that corner's measured target-ratio centroid (`A16-catalogue-v2.mjs:114`, protein weighted 4× in `dist()`), with no taste, cost or repeat-fatigue constraint. A human author aiming less precisely needs **more** rows. ESTIMATED. What would test it: author 4 real concentrate recipes, seed them, re-run these arms.
- **The concentrate row is simulated and its provenance is imperfect.** Nutritional Yeast 400 kcal / 53.3 P / 3.3 F / 33.3 C per 100 g, DERIVED ×(100/15) from a cited 15 g serving (Wikipedia 2026 table, Bob's Red Mill, citing USDA FDC #1946780 — **that FDC id returns 404 and is itself unverified**). Labelled `A16 SIMULATED ROW` in its `dataQuality`. Every other ingredient in every synthetic recipe is a real `Food` row at grams the 910-recipe library already uses it at.
- **Rig deltas only (C15).** 536 satisfiable / 622 judged days here vs the fleet's 578. Do not read "85 %" as an HTTP-fleet level.
- **C14 rule 4:** only the concentrate arm is replicated across seeds. The nine whole-food arms are single-seed points. Every one has c ≫ b and |delta| ≥ 4.29 pts, above the 3.5 pt floor, so the direction holds; the exact knee is unreplicated.
- **C18 compliance:** `checkdb.mjs` was **never invoked**, nothing re-copied. All arms carry `dbHash e55f52e53658a086`, `foodFingerprint 423e7279ed6af641`, poolRaw 910, foodRows 14151. Instrument checks 0/0/0/0 on every arm. `backend/src/` untouched; `backend/prisma/dev.db` never written; no port bound.

## Artifacts

`A16-catalogue-v2.{mjs,json}` + report · `A16-enrich.mjs` and 9 `A16-enrich-*-s424242.jsonl` · `A16-concentrate.mjs` + manifest + `A16-conc-recipes-N{1,2,4,8}-s424242.jsonl` · `A16-baseline-s20260730.jsonl` + `A16-conc-recipes-N4-s20260730.jsonl` · 14 `A16-cmp-*.json` · `A16-flips.mjs` · `A16-leakcheck-v2.mjs`, `A16-conc-leakcheck.mjs` + outputs · `A16-claims{,-repl,-c19}.tsv`. 24 rows in `CLAIMS.tsv`.

**CONFIRMED** — with the leak property downgraded from *verified* to *necessary-condition-only*, per C19.
