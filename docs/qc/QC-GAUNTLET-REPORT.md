# Cut Protocol — QC Gauntlet v2 Report

*Owner-facing. Autonomous overnight run on branch `qc/overnight-2026-07-23`, deterministic engine only, $0.*
*This is the live skeleton — status updates at every phase transition; see `RUNLOG.md` for the timeline.*

## Per-phase status
| Phase | What | Status |
|---|---|---|
| 0 | Harness + INDEPENDENT oracle (no engine imports; curated allergen list) | **IN PROGRESS** |
| 0.5 | Oracle self-validation gate (hand-labeled fixtures) | NOT STARTED |
| 1A | Monte Carlo 1k → 10k → 100k | v1 done (10k); v2 re-run pending oracle rebuild |
| 1B | Longitudinal adaptive-TDEE journeys (≥2,000) | NOT STARTED |
| 1C | Invariants / determinism / coverage | NOT STARTED |
| 1D | 14k-library sweeps (allergy / nutrition / micros / provenance) | PARTIAL (allergy sweep exists) |
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

## What was tested & how many times
_(filled per phase)_

## Fixes made
_(filled in Phase 4; each: finding → attempts → regression test → before/after metric)_

## Re-run commands
_(wired into package.json before being cited)_
