# Cut Protocol — QC Gauntlet v2 Report

*Owner-facing. Autonomous overnight run on branch `qc/overnight-2026-07-23`, deterministic engine only, $0.*
*This is the live skeleton — status updates at every phase transition; see `RUNLOG.md` for the timeline.*

## Per-phase status
| Phase | What | Status |
|---|---|---|
| 0 | Harness + INDEPENDENT oracle (no engine imports; curated allergen list) | **DONE** |
| 0.5 | Oracle self-validation gate (hand-labeled fixtures) | **DONE — 10/10 pass** |
| 1A | Monte Carlo 1k → 10k → 100k | 1k re-run w/ independent oracle done; 10k/100k next |
| 1B | Longitudinal adaptive-TDEE journeys (≥2,000) | NOT STARTED |
| 1C | Invariants / determinism / coverage | NOT STARTED |
| 1D | 14k-library sweeps: allergen **DONE**; nutrition/micros/provenance next | PARTIAL |
| 2 | UI persona walkthroughs | **BLOCKED — Chrome extension not connected** |
| 3 | Break-it (fuzz / authz / injection / SSRF / ED-safety) | v1 basic done; v2 expansion pending |
| 4 | Triage → fix → re-run | pending findings |

## Owner decisions outstanding (see RUNLOG STOP-AND-SURFACE queue)
1. `mayContain` schema field is absent — cross-contact sweeps impossible without it.
2. Step-cap on `adaptiveTarget.changeKcal` is undefined in code — the "0 step-cap violations" bar tests nothing until defined.
3. ±7%-by-week-6 reachability precheck — blocked on (2).

## Carried forward from the v1 run (master, commits e1efebf → 6bfdc84)
Recorded as prior evidence; v2 re-verifies with the independent oracle.
- 10,000-user Monte Carlo: 0 allergy leaks, 0 floor breaches, 0 macro drift, 0 crashes, 0 silent misses.
- Break-it (244 hostile requests): 0 server-500s, 0 hangs, 0 stack-leaks, 0 garbage persisted.
- Open finding: only ~39.5% of feasible days within ±5% kcal — a recipe-library coverage gap in thin diets (P3).
- **v2 caveat on the above:** the v1 oracle IMPORTED the app's own `dietaryFilter` matcher for its allergen check — so it could not have caught a bug in that matcher. v2's oracle uses a separately-curated allergen list; the leak result is only fully trustworthy after that rebuild + Phase 0.5.

## Headline finding (P0 — fixed)
The independent oracle immediately found what v1's could not: the **`soy` allergen
checkbox did not exclude textured vegetable protein (TVP)** — defatted soy flour,
~50% soy protein — so a soy-allergic user was being served it. TVP forms lived only
in a *separate* `"soy protein"` key. v1's oracle used the app's own matcher, so
asking "is TVP soy?" returned the same wrong `false`. Fixed in `dietaryFilter.js`
(TVP/textured vegetable protein/soy protein isolate/concentrate added to `soy`;
soybean oil deliberately still permitted). **Re-run proof: 1k MC seed 42, P0 339 → 0.**

## Fixes made
| finding | sev | fix | regression | before → after |
|---|---|---|---|---|
| `soy` allergen omitted TVP → served to soy-allergic users | **P0** | TVP/TSP/soy-protein forms added to `dietaryFilter.soy` | `tests/qc/soyTvpLeak.test.js` | 329 leak instances → **0** |
| `nuts` omitted chestnut/nutella/praline → "Cooked Chestnut" shipped in a recipe | **P0** | added terms + a water-chestnut guard | `tests/qc/soyTvpLeak.test.js` | 1 reachable recipe → **0** |
| gelato→dairy, natto→soy, triticale/matzo/graham→gluten uncaught (non-reachable) | P1 | added to the respective lists | same | corpus gaps closed |
| (oracle self) peanut butter false-flagged as dairy; bare "bran"/"flour" over-claimed gluten | — | plant-dairy stripping + narrowed gluten list | `oracle-selfcheck.test.js` | verifier false pos → 0 |

**14k allergen sweep:** started at 31 leak candidates → **0 solver-reachable leaks** in every category. 11 residuals remain, all 0-recipe USDA edge foods (infant formula, "X as ingredient in omelet"), deferred with rationale. 3 false-exclusions (rice flour / corn tortilla under gluten) left as deliberate safe-direction over-exclusion — narrowing them would weaken allergen safety.

## Re-run commands
_(wired into package.json before being cited)_
