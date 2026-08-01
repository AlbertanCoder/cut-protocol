"""Ledger updater for the measurement fleet.

Kept in-repo because the repo guard (correctly) refuses writes outside it, and
because the shell mangles the long headline strings when they are passed with
`python -c`. Each run rewrites `fleet/state.json` in place.
"""
import io
import json
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")


def mark(agents, key, artifacts, headline):
    agents[key]["status"] = "done"
    agents[key]["artifacts"] = artifacts
    agents[key]["headline"] = headline


def main():
    with io.open(P, encoding="utf-8") as fh:
        state = json.load(fh)
    a = state["agents"]

    mark(a, "W3-2",
         ["fleet/out/W3-2/FINDINGS.md", "fleet/out/W3-2/results.json"],
         "FOUND wls2 ON DISK (A13/a13-hook.cjs:187) -- an L2 SUM, confirming W2-1's inference; it already had k=2 "
         "and the one-sided protein hinge and optimised on CONTINUOUS x. But W2-1's MECHANISM IS REFUTED: L-inf gains "
         "LESS than L2 (+10.49 vs +12.36) and raises warned slots nearly 3x MORE (+620 vs +233) on all 3 seeds -- "
         "augmented Chebyshev is indifferent to everything below the max, so kcal and protein (the only macros the "
         "slot gate tests) drift free. W2-1's acceptRepartition guard blocks 91.9% of improving moves and costs "
         "-7.84pts. WINNERS: C14 in-gate steering +6.27 with warned slots -153 and the CHEAPEST arm (4.87ms/day vs "
         "base 7.32); C2 smallest-first +7.78 (brief +8.27); C14+C2 = +10.91 with ~0 warned cost and 30% FASTER. "
         "C4 floor25 +5.00 marginal but puts 31.2% of slots below 0.5x = UNSHIPPABLE. B3/B4 reproduced. 81% of every "
         "arm's rescues are W3-1's ruler-eligible pool -- cannot double-count with a ruler change.")

    mark(a, "W3-3",
         ["fleet/out/W3-3/FINDINGS.md", "fleet/out/W3-3/results.json"],
         "STRUCTURAL FACT NOBODY NOTICED: 185 of 250 personas ask for a ONE-DAY plan, where best-of-N IS already the "
         "per-day argmax -- cherry-picking is definitionally worth ZERO on 74% of the population, and all 158 of the "
         "oracle's rescued days come from the 65 week personas. CAP-VIOLATION RATE (the number the decision rule turns "
         "on, unmeasured by everyone): 94.36% of week personas, breaking at k=2 (86.9%). The provable-optimality branch "
         "fires on 11 of 195 weeks. Oracle 84.63% vs REALISED 77.70% (safe rule) / 78.84% (exact master) vs base "
         "75.11%. LNS = +2.95 for +15.7% work, BEATING a 2.4x attempt budget, 0 cap breaches, 0 regressions. "
         "Greedy-with-skip scores IDENTICALLY to LNS while breaching the cap on 58.5% of weeks. FREE PERMUTATION: "
         "adjacency 496->5 incidences (-99%) at EXACTLY ZERO compliance cost -- and it exposes that usedYesterday "
         "defends SOLVE order not CALENDAR order (33.4% of adjacent day pairs share a dish). NEW E11 CHANNEL: 14.7% of "
         "the oracle's rescued days ship FEWER meals than baseline. 61.5% of week-runs have zero selection headroom. "
         "D5 sharpened into a PROOF that SCORE_WEIGHTS cannot move the metric.")

    mark(a, "W3-4",
         ["fleet/out/W3-4/FINDINGS.md", "fleet/out/W3-4/results.json"],
         "TRIM ARM = +12.60 pts (canonical 553, pooled 3 seeds, measured AGAINST THE SHIPPING CLOSER), real at every "
         "individual seed with 4x margin, +15% cost. Fat-only would have been +9.46 -- W1-3's carb finding was "
         "decisive: keto goes +1.72 (fat only) to +20.69 (fat+carb). Over-side conversion 61.7% fat / 55.3% carb / "
         "46.8% kcal; pure-short 0/3 and empty-plate 0/48 EXACTLY as W1-3 predicted. ALL SAFETY GATES ZERO AND "
         "VERIFIED: allergen 0/40164, recipe-gate 0/8457, ingredient-set changes 0, floors created 0, keto ceiling 0 "
         "(baseline has 32, the trim ELIMINATES all 32), gram drift exactly 0. Guard invariant 0 axis-worsenings over "
         "891 mutated days vs the shipping guard's 195. G4 reproduced to the decimal (106/106, +16.11g). E4: a naive "
         "trim would have MULTIPLIED the stale-warning defect 4.6x and flipped the sign on 93 slots; as built ZERO, "
         "plus 377 new honest warnings. THE REAL COST IS THE PLATE: 83.2% of trimmed slots land below 0.7x reference, "
         "51.9% pinned at the 0.5 floor. Overlap with W3-2's portioner is 82.7% vs 80.3% on the same pool -- +12.60 "
         "and +12.36 MUST NOT BE SUMMED.")

    mark(a, "W3-5",
         ["fleet/out/W3-5/FINDINGS.md", "fleet/out/W3-5/results.json"],
         "KNEE = 20 on the per-slot budget; 20->40 is +0.24pp INSIDE NOISE, refuting the prompt's +1.74pp. "
         "Disambiguated TWO knobs both called attempts (per-slot budget vs week best-of-N) -- they behave nothing "
         "alike and must never share a row. NEW: the SHIPPING ADAPTIVE RULE IS A NET HARM (-2.17pp) and the entire "
         "loss lands on VEGAN (-11.43) and KETO (-9.77), the diets its own docstring claims to protect -- every keto "
         "pool is <=53 recipes so floor(pool/10) clamps to the MIN of 5 while their meal pool runs to 49 candidates. "
         "MEASURED EFFECTIVE m at k=20 = 1.92 (2.00 held-out): W2-2's 2.46 derivation is VOID as arithmetic (its "
         "10.8/24.5 inputs trace to the lab ledger and reproduce as 68.50/89.15 here) but its CONCLUSION is right and "
         "understated. Better statistic: 50.63% of days are ALL-OR-NOTHING across 20 independent attempts vs 0.05% "
         "predicted by independence. C11 REFUTED -- interaction +0.12pp, orthogonal not sub-additive. C2 is the best "
         "ratio measured (+5.48pp per ms/day vs +0.04 for budget 20->40). Only 49.37% of the canonical denominator is "
         "addressable at all.")

    mark(a, "W3-6",
         ["fleet/out/W3-6/FINDINGS.md", "fleet/out/W3-6/results.json", "fleet/out/W3-6/leaksweep-armA.json"],
         "Inserted 1 food + 10 snack recipes on a SCRATCH DB (real DB verified byte-identical). SKIPPED Lupini (T-3), "
         "Sprouted Lentil Bowl (Atwater), every powder (T-1) -- insert.mjs carries three throw-guards that fire before "
         "any write. COMPLIANCE +7.72pt (arm A) / +8.92 (arm B), NOT noise (5x the paired floor) -- BUT THE GAIN IS "
         "FAT, NOT PROTEIN: 99 of 145 rescued days were fat:over, only 3 protein, and 550 of 562 placements DISPLACED "
         "A FATTIER SNACK rather than filling an empty slot. COVERAGE: empty snack slots 141->45/seed, zero-snack-pool "
         "personas 20->2, wall personas with a qualifying snack 0->18 (arm B ONLY). ARM A COVERAGE FOR THE WALL IS "
         "ZERO -- the nutritional-yeast BRAND decides the wall, confirmed and total. NEW FINDING both W2-3 and W1-5 "
         "missed: ALL 18 WALL PERSONAS ALSO EXCLUDE LEGUMES, killing 6 of the 10 dishes. LEAKS 0 both arms WITH A "
         "FIRING POSITIVE CONTROL that reproduces T-1's mechanism on a brand-new row, so the zero is informative not "
         "vacuous. Two new H5 over-exclusions found by authoring: allergen prose has NO POLARITY "
         "(made-without-sesame-oil EXCLUDES) and unrecognised free-text terms match by bare substring (oats hits "
         "Goat cheese).")

    state["run"]["agentsSpawned"] = 18
    with io.open(P, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    print("ledger: 18 agents done")


if __name__ == "__main__":
    main()
