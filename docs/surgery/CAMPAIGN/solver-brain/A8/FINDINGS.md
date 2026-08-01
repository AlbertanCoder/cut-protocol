# A8 — Infeasibility detection: KPI split for the refusal path

*Agent A8. Persisted to disk by the fleet coordinator from A8's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A8's.
A8's `CLAIMS.tsv` line was also blocked and has been appended by the coordinator.*

**Lead result: the app has no refusal path to measure.** `mealSolver.js:296` `diagnose()`
returns `{ feasible: false, reasons, suggestions }`, and `:308` returns early on
`counts.afterDiet === 0` — but every caller still ships a plan with the diagnosis attached
(`:754-755`, `best.diagnosis = anyDayMissed || anyUnfilledSlot || floorMissed || noDaysAtAll ? diagnoseFromResult(…)`).
Today "unsolvable" is a *label on a delivered plan*, never a withholding. **MEASURED.**

That reframes A20's job. Two designs, and the choice sets the targets:

- **Design A — hard refusal** (withholds the plan). A false refusal delivers *nothing*.
- **Design B — soft refusal** (labels the day infeasible, still ships best-effort).
  **Recommended** — preserves 100 % honesty-on-miss by construction and makes a false
  refusal a scary message, not a dead end.

## How the field splits these — and it does split them

SAT Competition 2024's main track awards **three** medal sets: "SAT, UNSAT, SAT+UNSAT".
MIPLIB 2017 keeps a dedicated **Infeasible Set of 44 instances** rather than discarding
them. Gurobi reports `INFEASIBLE` = "Model was proven to be infeasible" as a status
distinct from `TIME_LIMIT`. The precedent for one blended number is: there isn't one.
**MEASURED.**

**The certificate asymmetry is load-bearing.** SAT competitions disqualify on a single
wrong answer *because both answers carry a checkable certificate* — "Printing a model in
case of a satisfiable instance is required for all tracks expect for 'No-limits'.
Additionally, UNSAT certificates (proofs) are required for the Main track." Cut Protocol's
`diagnose()` has **no certificate**; its checks are tuned heuristics
(`capacity < weeklyMealSlots * 1.3` at :338; `densePool.length < denseNeeded` at :365). A
heuristic cannot support a zero-false-refusal claim. **DERIVED.**

## Confusion matrix, in this app's terms

Ground truth = does an assignment exist, **within the shipping constraint set** (0.5–2.0×
scale bounds, repeat caps, allergen gate, *the customer's filtered pool*), whose totals
satisfy `dayTolerance()`.

| | truth: infeasible | truth: satisfiable |
|---|---|---|
| **app refuses** | **TR** true refusal | **FR** false refusal — declined a customer we could have fed |
| **app plans, in band** | *cannot occur* — an in-band plan **is** a satisfiability certificate | **TA** true accept |
| **app plans, out of band** | **FA-hard** — should have refused | **FA-soft** — solver-limited miss |

**Today's 70.1 % scores FA-hard and FA-soft identically.** Different failures, different
owners: FA-hard is a data/expectations problem, FA-soft is a search problem. **DERIVED.**

Useful consequence: **in-band plans are self-certifying**, so ground-truth labelling is
only needed on days that miss or are refused (~30 % of days), not all 578.

## Metric definitions — implementable as written

| KPI | formula | denominator | reads as |
|---|---|---|---|
| **KPI-1 plan quality** | `TA / (TA + FA-soft)` | satisfiable days the app **chose to plan** | solver quality, impossible tier removed |
| **KPI-2a refusal precision** | `TR / (TR + FR)` | all days the app **refused** | "of those we declined, how many were truly impossible" |
| **KPI-2b refusal recall** | `TR / (TR + FA-hard)` | all **genuinely infeasible** days | "of the impossible days, how many did we catch" |
| **KPI-3 combined** | report as the **triple** `(TA, TR, errors)` | all days | never as one scalar |

**Status taxonomy** (mirrors Gurobi's): `SAT-certified` / `INFEASIBLE-proved` / `UNKNOWN`.
Report `UNKNOWN` explicitly; never fold it into either side.

**Free FR detector, no new oracle.** SAT Competition disqualifies a solver that "reports
UNSAT on an instance that was proven to be SAT by some other solver." This fleet runs many
seeds. **The union of every in-band plan ever produced for a day-instance is that day's
satisfiability certificate.** Any day in that union which the app later refuses is a
*provable* false refusal. A20 can implement this by accumulating certificates across runs.
**DERIVED.**

## Mapping to A3's three ceiling categories

A3's `FINDINGS.md` was **not written** as of this run — mapping is to the categories as
named in the assignment, to be reconciled.

| A3 category | tier | metric | remedy |
|---|---|---|---|
| structurally impossible | infeasible | KPI-2b denominator; TR or FA-hard | refuse + explain |
| **pool-limited** | **infeasible *for this product*** | KPI-2b, tracked separately | data (generate recipes), not search |
| solver-limited | satisfiable | KPI-1 denominator; TA or FA-soft | search |

**Definitional crux:** infeasibility must be relative to the *filtered pool*, because that
is what the app delivers against. A day unsatisfiable given this customer's pool is
genuinely infeasible even though a larger library would fix it — so the refusal reason must
distinguish "impossible for anyone" from "impossible for your pool", which `diagnose()`
already does in prose.

## Is "zero false refusals" the right bar?

**Directionally yes — but A20 will hit it the wrong way if it tunes a classifier.** The
literature's zero-tolerance rests on certificates, not accuracy. The route to FR = 0 is a
**sound** refusal predicate: refuse only where a short proof of impossibility exists. Three
that are cheap and exact here:

1. `counts.afterDiet === 0` — pool empty after hard filters. Already implemented, exact.
2. `snackEligible === 0` — a slot class provably unfillable.
3. **Macro-envelope bound** (not implemented): if max achievable protein across the pool at
   the 2.0× ceiling < protein floor, no assignment can reach it. The LP-relaxation-bound
   analogue, an exact refutation. **ESTIMATED** — testable over the 83-day tier.

| metric | target | why |
|---|---|---|
| **KPI-2a precision** | **1.00; FR count = 0 as a release gate, not a rate** | a rate hides absolute harm on a small refusal set |
| **KPI-2b recall** | **no minimum at launch — report it** | recall rises only via new *sound* bounds, never a tuned threshold |
| **KPI-1** | the real 85 % question, on a **fixed cohort** | denominator must not move between releases |

**Why FR is the expensive error for a consumer product** — the second reason is the one
usually missed:

1. **Asymmetric recoverability.** An FA still ships a plan plus warning and swap
   suggestions. An FR ships nothing; the customer's whole reason for opening the app
   returns zero output.
2. **It is silent to the vendor.** An FA produces a compliance datum. An FR produces **no
   plan and therefore no measurement** — it deletes itself from the denominator that would
   have caught it. A measurement-integrity failure, not only a UX one.
3. **It is adversarially aimed at the neediest segment** — vegan/keto/allergy, the tier
   already at 58–62 %.

Under Design B, reasons 1 and 3 largely dissolve. That is the argument for Design B, and
why A8 would accept recall above zero at launch rather than freezing the refusal path until
provably sound.

## How this can be gamed

1. **Denominator laundering.** Every refused day *leaves KPI-1's denominator*. Refusing the
   worst-fitting 20 % raises KPI-1 with **zero solver improvement.** Guard: fixed benchmark
   cohort (MIPLIB's discipline); publish FR/TR counts beside every KPI-1 figure.
2. **Refusal-as-success.** A single-scalar KPI-3 counting TR as a win means refusing
   *everything* scores exactly the infeasible share. Guard: KPI-3 is a triple; headline
   stays KPI-1.
3. **Relabelling** (sharpest). An out-of-band day carrying a warning can be re-emitted as a
   refusal carrying a reason — scoring TR instead of FA with **no behaviour change
   whatsoever.** Guard: ground truth from `oracle.mjs` and accumulated certificates,
   **never from the app's own `diagnose()`**. A refusal path graded by the module that
   produces refusals is the engine grading itself.

## Interaction with the constitution and honesty-on-miss

`CLAUDE.md`: *"Solver declares 'unsolvable + why'"*. The verb is **declare**, not
**withhold**; the current implementation already satisfies it. **A20 must not read the
constitution as licence to stop returning a plan** — Design A is strictly stronger than the
constitution asks, and puts 100 % honesty-on-miss at risk in a new way: a refused day that
ships nothing carries no warning *because it carries no output*. Under Design B
honesty-on-miss is preserved by construction and the refusal label is additive.

Per BRIEF integrity rule 3: **a refusal that raises the headline by removing days from the
denominator is a metric artefact, not an improvement.** Named so it cannot later be claimed
as a gain.

## Arithmetic behind the framing

**DERIVED:** a solver refusing all 83 engineered-infeasible days correctly and planning all
495 satisfiable days in band scores `495/578 = 85.6 %` on the current all-days metric —
indistinguishable from a mediocre solver that plans everything and misses 14 %. Two very
different products, one number.

## Sources

1. SAT Competition 2024 — Medals, Armin Biere / University of Freiburg, 2024 — categories
   "SAT, UNSAT, SAT+UNSAT". https://cca.informatik.uni-freiburg.de/sat24medals/
2. SAT Competition 2024 — Rules, SAT Competition organisers, 2024 — certificate
   requirement; disqualification wording. https://satcompetition.github.io/2024/rules.html
3. "How does Gurobi compute the IIS for infeasible models?", Gurobi Optimization, accessed
   2026 — "An IIS is a minimal subset of constraints and variable bounds that, if isolated
   from the rest of the model, is still infeasible".
   https://support.gurobi.com/hc/en-us/articles/360041448572-How-does-Gurobi-compute-the-IIS-for-infeasible-models
4. MIPLIB 2017 — The Infeasible Set, Zuse Institute Berlin, 2017 — "The set of all
   infeasible instances", 44 instances. https://miplib.zib.de/set_infeasible.html
5. Gurobi Optimizer Reference Manual — Status Codes, Gurobi Optimization, accessed 2026 —
   `INFEASIBLE` "Model was proven to be infeasible".
   https://docs.gurobi.com/projects/optimizer/en/current/reference/numericcodes/statuscodes.html
6. Liffiton, M. H. & Sakallah, K. A., "Algorithms for Computing Minimal Unsatisfiable
   Subsets of Constraints", *Journal of Automated Reasoning* 40:1–33, 2008.
   https://link.springer.com/article/10.1007/s10817-007-9084-z

*Note for A23: source 3's definitional text is from the Gurobi **support article**; the
reference-manual infeasibility page carries usage, not the definition — check that URL, not
the docs.gurobi.com features page.*

**CONFIRMED** (analysis complete; artifact could not be persisted by the agent itself)
