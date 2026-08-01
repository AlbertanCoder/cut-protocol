# SOLVER BRAIN — mid-flight corrections, part 5

*Continues `CORRECTIONS.md`, `-2`, `-3`, `-4` (all immutable once written).
**A21, A22, A24 and A25 read all five.*** Written 2026-07-31 from the Phase-4 returns.

---

## C19 — `oracle.mjs` is NOT a sufficient leak check. It misses 12 of the 13 C13 rows.

**Status: A17, MEASURED. This invalidates the premise of C16 and binds A21, A22, A24.**

C16 mandated `oracle.mjs` as the independent defence against the engine grading itself. **It
does not cover the exposure it was assigned to.** A17 measured it directly: of the 13 rows in
C13's latent style-gate leak list, **only `Seal, bearded (Oogruk), meat` is caught**, and only
because the literal token `meat` appears in `oracle.mjs:80`'s `ANIMAL_MEAT` list. Squirrel,
Groundhog, Armadillo, Wild pig, Heart, Owl, **Sea cucumber**, Ceviche, Hog maws, Bear, Dove
and the Isopure whey row all pass oracle as clean for vegan.

A17 then ran oracle over an arm that **demonstrably leaked** — `Sea cucumber, yane (Alaska
Native)` placed as a protein adjuster **309 times** across 277 vegan and 32 vegetarian plans,
13.3 % of placements — and **oracle reported 0 leaks.**

**A16 independently found two more defects in the same list**, neither an engine defect:
`oracle.mjs:59` files `"nut butter"` under `nuts` and `:68` aliases tree nuts to nuts, so
**"Peanut Butter" false-positives as a tree nut** (4 of the baseline's 5 reported "leaks" are
this artifact; the 5th is "Egg Plants" matching the vegan egg term — **the baseline's 5 leaks
are all false positives**). And `oracle.mjs:54` deliberately omits bare `"flour"` from the
gluten list, so it would not have caught a Self-raising Flour row reaching a gluten-excluding
persona.

**The rules:**
1. **"oracle says zero" is necessary, not sufficient.** Any claim of leak-freedom on a
   pool, gate, or candidate-set change must **additionally check the candidate set by name**
   against C13's list.
2. **The fleet's "0 confirmed allergen leaks" property is still intact as measured** — no
   shipped path places these rows. But it was never verified by the instrument the fleet
   believed was verifying it. Say that plainly rather than restating the property.
3. **A24:** the baseline's 5 oracle "leaks" are false positives. Do not report them as leaks.

---

## C20 — A3's infeasibility bound has a DEAD TERM. The ceiling moves again.

**Status: A20, MEASURED, contradicting A3/C7. Unresolved — A24 adjudicates, A25 must not
pick one silently.**

`A3-classify-all.mjs:50` and `A3-prove-infeasible.mjs:57` compute the food side of the bound
as `f.kcalPer100g > 0 && f.proteinPer100g > 0 ? … : 0`. **The Prisma `Food` model has no such
columns** — the real fields are `kcal`/`protein`. **That expression evaluates to 0 across all
14,151 rows.** A3's prose claims the bound covers *"recipes and foods — the macro closer may
add one"*; it never did.

A3's operative SCALED bound is recipe-only by construction, so it survives — but it **omits
the macro closer entirely**. A20 repaired it (SCALED + every surviving adjuster at its
`MAX_GRAMS` ceiling) and the provable impossible set falls:

| | A3 / C7 | A20 repaired |
|---|---|---|
| structurally impossible days | 52 | **16** |
| impossible personas | 16 | **10** |
| all-days ceiling | 91.0 % | **97.2 %** (562/578) |

p030, p051, p059, p211, p222, p227 lose their proof. They gain no certificate either — they
become **UNKNOWN, not satisfiable.**

**A20 also caught its own instrument in the same error:** `A20-bound-audit.mjs:54` copied A3's
field names, so its "212/212 agrees with A3" was **agreement on a shared bug, not
corroboration.** Recorded by A20 against itself under integrity rule 7. **A24 should note this
is the second time a fleet cross-check has agreed with a defect rather than catching it.**

**Consequence:** three ceiling figures are now in play — the brief's 88 %, C7's 91.0 %, A20's
97.2 %. The Definition of Done requires a decomposition summing to 578. **A25 must present the
decomposition on a named, defended bound and show the other two, not average them.**

---

## C21 — THE SELF-SCORING TRAP. Refusal is not compliance. Binds A21 hardest.

**Status: A20, MEASURED. The sharpest inflation route found in this study, and nobody flagged
it before A20.**

A20 priced three ways to raise the headline by refusing days rather than planning them:

| predicate | Δ pts | false refusals |
|---|---|---|
| P4 — ship **A3's own bound** as the refusal rule | **+4.94** | 0 by construction, 36 unproven |
| P5 — refuse the engineered tier | +5.72 | 28 certificated days |
| P6 — re-badge the existing `diagnose()` | **+27.94** | **186** |

**P4 is the trap.** The ruling denominator and the refusal predicate are *the same object*.
Using it as both removes 36 days it cannot prove impossible from the denominator and books the
result as a +4.94 pt gain — above C14's 3.5-pt floor. **P6 buys +27.94 pts and a perfect
100 % KPI with zero behaviour change.**

**The sound predicate (P7, the repaired bound) buys +0.00 points.** It converts 16 silent
failures into 16 explained refusals. That is the honest pitch and it moves no headline.

**Rules:** no lever may count a refused day as a compliant one. Any stack including a refusal
path reports compliance **on the denominator that existed before the refusal**, and reports
refusal precision/recall separately. **A24: audit every Phase-4 delta for hidden denominator
movement, not just for band-widening.**

---

## C22 — A7's zero-concentrate-rows evidence is falsified. Its conclusion survives.

**Status: A20 MEASURED, plus A23 on provenance.**

A7 reported *"zero rows, all of them"* for vegan protein concentrates, searched by name.
**`Seaweed, spirulina, dried` is 57.5 g protein / 100 g and returns `isExcluded = false`** for
a vegan + soy + gluten + legumes + nuts + sesame persona; 180 g clears all 16 protein floors.
`Nutritional powder mix, protein, NFS` (78.1 g P/100 g) and an Isopure row also pass the vegan
gate. **The rows exist; A7's name-based search missed them.**

A7's *conclusion* — a library/configuration wall rather than botany — **survives and is
strengthened**. A20 locates the wall precisely: `planContext.js:167-178` `ADJUSTER_CANDIDATES`
is a **hardcoded ten-name list**, and all four protein entries (chicken, Greek yogurt, tofu,
lentils) die to vegan + soy + legumes. **0 of 4 survive for 16/16 impossible personas.** The
refusal is a claim about a ten-line constant, not about food. **One name added dissolves every
remaining proof** — so a refusal shipped today is wrong after that edit.

**A23 adds:** A7's nutritional-yeast figure is right but its provenance tier is wrong — the
source reads *"Bob's Red Mill brand, manufacturer reported values"*, so it is **LABEL, not
USDA-VERIFIED**. A16's simulated concentrate row inherits this; A16 disclosed it and further
noted the cited FDC id **returns 404**. Any report quoting 13.3 g P/100 kcal says LABEL.

---

## C23 — Two agents found the same +14.7-point lever by different routes. DO NOT ADD THEM.

**Status: A13 and A17, both MEASURED, both replicated across seeds. Binding on A21.**

| agent | mechanism | satisfiable-only delta |
|---|---|---|
| A13 | 2-knob **4-macro tolerance-normalised portioning objective** | **+14.74** [+11.40,+18.08], b=8 c=87 |
| A17 | **macro trimmer** — the subtraction the closer structurally lacks | **+14.93**, b=4 c=84 |

**These are near-certainly the same effect reached from two directions.** Both work by
*reducing* over-band days; A15 measured 42/42 fat-only misses as OVER, A17 measured baseline
fat-failing days at **97 OVER / 1 SHORT**, and A19 found **83/83** of its rescued days were
over. **The dominant failure mode is a single one, and every mechanism that fixes it will
claim the same ~15 points.** Summing them would be the exact inflation A24 exists to catch.

**A21 must measure the combination, not add the parts** — and should report the *overlap*
explicitly (how many days each rescues alone vs jointly).

**Where to intervene (A18, MEASURED):** every `mealSolver.js` edit measured **0.00 pts**;
every `weeklyPlanner.js` edit moved the number. `SCORE_WEIGHTS` is a post-hoc tiebreak that
provably cannot change the in-band count (b == c in 6 of 6 arms, structurally). **Compliance
is decided in `weeklyPlanner.js`'s slot loop; `mealSolver.js`'s day scoring is a reporting
layer.** A13's lever is exactly there: `weeklyPlanner.js:451` already computes a fat/carb
composition target and discards it before `scaleRecipe(recipe, kcalTarget, proteinTarget)`
at L394.

**Two costs that ride along and may not be dropped:**
- **A13:** warned slots *rise* 341 → 405 while day misses fall. The per-slot gate is
  kcal+protein only (C8), so it flags slots the 4-macro portioner deliberately detuned —
  **more amber on days that now pass.**
- **A17:** the trimmer as prototyped produced **1 verdict-disagreement and 1 silent miss**
  (baseline 0/0) because it mutates totals *after* the solver forms its warning. **That is an
  integrity-rule-3 honesty regression and disqualifies the prototype as built.** Median cut
  removes 48.9 % of a real component. Any shipped version computes the verdict post-trim.
