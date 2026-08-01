# A20 — The refusal path

*Agent A20. Persisted to disk by the fleet coordinator from A20's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A20's.
A20's scripts, 9 artifacts and 25 `CLAIMS.tsv` rows DID land.*

**The bound the fleet was about to build a refusal on has a dead term, and it fails in the false-refusal direction.** `A3-classify-all.mjs:50` and `A3-prove-infeasible.mjs:57` compute the food side as `f.kcalPer100g > 0 && f.proteinPer100g > 0 ? … : 0`. The Prisma `Food` model has no such columns — `FOOD_GATE_SELECT` returns `kcal`/`protein`, per 100 g. **That expression evaluates to 0 over all 14,151 rows** (MEASURED). A3's prose claims the bound covers *"recipes **and** foods — the macro closer may add one"*; in effect it never did. My own `A20-bound-audit.mjs:54` copied the same field names, so its "212/212 agrees with A3" was **agreement on a shared bug, not corroboration** — integrity rule 7, on me.

A3's operative SCALED bound is recipe-only *by construction* (`:62` `pool.filter(isMealEligible)`), so it survives the bug — but it omits the macro closer. Repairing it (SCALED + every surviving adjuster at its full `MAX_GRAMS` ceiling, `macroCloser.js:46`) **cuts the provable impossible set from 52 days / 16 personas to 16 days / 10 personas.** p030, p051, p059, p211, p222, p227 lose their proof; they hold no certificate either, so they become UNKNOWN, not SAT. **DERIVED** from MEASURED bounds. **Revised ceiling 562/578 = 97.2 %, against C7's 91.0 % — contradiction with A3/C7, stated loudly.**

## Confusion matrix — 578 fleet days, seed `qa-fleet-20260729-2032`

Ground truth: `INFEASIBLE-proved` 16 · `SAT-certified` 495 · `UNKNOWN` 67. Certificates = union of every in-band day across 2 instruments / 6 runs (A8's free-FR detector). Truth never comes from the app's `diagnose()`.

| predicate | refused | TR | **FR** | UR | FA-hard | FA-soft | TA | KPI-2a | strict prec. | recall vs A3's 52 | KPI-1 (C7) | Δ pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0 shipped (no refusal) | 0 | 0 | **0** | 0 | 16 | 90 | 405 | n/a | n/a | 0.0 % | 72.06 % (n=562) | — |
| P1 `afterDiet===0` | 0 | 0 | **0** | 0 | 16 | 90 | 405 | n/a | n/a | 0.0 % | 72.06 % | +0.00 |
| P4 A3's SCALED bound | 52 | 16 | **0** | 36 | 0 | 90 | 405 | 100 % | 30.8 % | 30.8 % | 77.00 % (n=526) | +4.94 |
| P5 refuse engineered tier | 83 | 16 | **28** | 39 | 0 | 82 | 385 | 36.4 % | 19.3 % | 30.8 % | 77.78 % (n=495) | +5.72 |
| P6 refuse where `diagnose()` says so | 269 | 16 | **186** | 67 | 0 | 0 | 309 | 7.9 % | 5.9 % | 30.8 % | 100.00 % (n=309) | +27.94 |
| **P7 repaired bound** | **16** | **16** | **0** | **0** | 0 | 90 | 405 | **100 %** | **100 %** | 30.8 % | 72.06 % | **+0.00** |

**Answer to the asymmetric requirement: yes — P7 achieves FR = 0, at recall 16/52 = 30.8 % of the tier A3 asserted (100 % of what is provable).** Recall is the price, as A8 predicted.

FR = 0 does **not** rest on that matrix — TR/FR are near-tautological against a truth built from the same bound. It rests on: (1) the density argument is a certificate and the hole that breaks it is absent — **0 infinite-density and 0 supra-physical (>0.25 g/kcal) rows** in 910 recipes / 14,151 foods; (2) those personas were **solved 310 times across 2 instruments / 6 runs and landed in band 0 times** (exact one-sided 95 % upper bound on FR rate **0.96 %**); (3) the repaired bound is generous — it lets the closer add on top of a kcal ceiling the recipes already spend, which `wouldHarm` (`macroCloser.js:75`) would block.

## The traps, priced

**P4 — A3's own bound, shipped as a refusal, launders +4.94 pts by refusing 36 days it cannot prove.** Above C14's 3.5-pt floor. This is the sharpest trap and nobody flagged it: the ruling denominator and a refusal predicate are the same object, and using it as both is self-scoring.

**P5 — refusing the engineered tier is wrong on 37.3 % of it** (28 certificated + 3 unknown of 83) for +5.72 pts.

**P6 — re-badging `diagnose()` buys +27.94 pts and a perfect 100 % KPI-1 with zero behaviour change**, at 186 false refusals. A8 named this ("relabelling"); it is the largest number I measured and it is pure artefact.

**The sound path buys +0.00 pts.** It converts 16 silent failures into 16 explained refusals and moves no headline. That is the honest pitch.

## Which sense of "impossible" — narrower than A7's, and A7's evidence is wrong

**All 52 refused days are vegan (52/52).** The wall is not the recipe pool: `planContext.js:167-178` `ADJUSTER_CANDIDATES` is a **hardcoded ten-name list**, and all four protein entries — chicken, Greek yogurt, tofu, lentils — die to vegan + soy + legumes. **0 of 4 protein adjusters survive for 16/16 personas**; the whole 29.2 g closer ceiling is oats, rice, potato, avocado.

So the refusal is a **configuration** claim — not botany, not even a library gap. **One name added to a ten-item constant dissolves every remaining proof.** A refusal shipped today is wrong after that edit.

**Contradiction with A7:** A7 reports *"zero rows, all of them"* for vegan protein concentrates, searched by name (`pea protein`, `nutritional yeast`, `torula`, `chlorella`). **`Seaweed, spirulina, dried` is 57.5 g protein / 100 g and returns `isExcluded = false` for p073** (vegan + soy + gluten + legumes + nuts + sesame). 180 g clears all 16 floors. A7's *conclusion* (a library/authoring wall, not botany) survives; its zero-rows evidence does not.

For C13/C16: `Nutritional powder mix, protein, NFS` (78.1 g P/100 g) and `Nutritional powder mix (Isopure)` also return `isExcluded = false` for vegan. **Not a realized leak** — neither is on the adjuster list — but any widening of that list reaches them.

## Caveats

1. The relaxation proves **impossibility only, never feasibility** (A3's caveat, retained). P7 is sound without being complete; the 67 UNKNOWN days stay UNKNOWN, never folded.
2. A3's 52 is not so much wrong as **measured against a model omitting a shipping component**. Whether the closer would *realistically* add 180 g of anything is a product question I did not test.
3. FR = 0 is persona-level here: every predicate is pre-solve, so it is constant across a horizon.
4. **C18:** `A20/dev.db` hashes `e55f52e53658a086` — the fleet baseline. I never ran `checkdb.mjs`, never re-copied, never wrote the live DB. Two of my ledger rows carry an explicit CORRECTION re-basing the laundering deltas from A3's un-repaired truth onto the revised one.

**CONFIRMED** — a pre-solve refusal with zero false refusals is achievable, but it covers 16 days, not 52, and it is a claim about a ten-line constant rather than about food.
