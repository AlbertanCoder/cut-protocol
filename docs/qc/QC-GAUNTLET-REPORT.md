# Cut Protocol — QC Gauntlet v2 Report

*Owner-facing. Autonomous overnight run on branch `qc/overnight-2026-07-23`, deterministic engine only, $0.*
*This is the live skeleton — status updates at every phase transition; see `RUNLOG.md` for the timeline.*

## Per-phase status
| Phase | What | Status |
|---|---|---|
| 0 | Harness + INDEPENDENT oracle (no engine imports; curated allergen list) | **DONE** |
| 0.5 | Oracle self-validation gate (hand-labeled fixtures) | **DONE — 10/10 pass** |
| 1A | Monte Carlo 1k → 10k → 100k | 1k re-run w/ independent oracle done; **10k in progress**; 100k next |
| 1B | Longitudinal adaptive-TDEE journeys (≥2,000) | NOT STARTED (partly gated on the step-cap owner decision) |
| 1C | Invariants / determinism / coverage | **DONE** (9 green; coverage pass pending) |
| 1D | 14k sweeps: allergen **DONE** · nutrition+provenance **DONE** · micros next | MOSTLY DONE |
| 2 | UI persona walkthroughs | **BLOCKED — Chrome extension not connected** |
| 3 | Break-it: security (IDOR/injection/ED-safety/SSRF) **DONE** · importer-HTML/XSS/barcode next | PARTIAL |
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

## 12-customer simulation (2026-07-23) — see CUSTOMER-FINDINGS.md
Twelve independent persona-customer agents, each grounded in a real generated plan. Shipped 5
fixes; queued the golden/law/product-shape items with root causes. Biggest catch: a **P0 tree-nut
allergen leak** the UI checkbox key exposed (below). Customers independently confirmed the hard
floor, no-shame color law, clean allergens, honest solver, and correct BMR math all hold.

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
| **`tree nuts` checkbox key omitted chestnut/nutella (+ harness tested wrong key)** | **P0** | synced "tree nuts" to "nuts" + drift guard; fixed harness keys | `treeNutParity.test.js` | reachable leak → **0** |
| login 500 on non-string email (Prisma-operator object) | P1 | type-check strings up front | `authInjection.test.js` | 500 → 400 |
| SSRF: importer fetched internal/private hosts | P2 | `isBlockedHost` guard pre-fetch | `importerSsrf.test.js` | fetched → refused |
| importer: absurd qty → Infinity grams; deep-nest HTML → stack overflow | P2 | qty cap 1e6; tree depth cap 500 | `importerFuzz.test.js` | corrupt/crash → clean |
| floored target hid the achievable rate (3 customers) | UX | expose `achievableRate` on Engine/Today/Profile | `flooredRate.test.js` | "not achievable" → real rate |
| BMR citations never rendered; metric rate picker showed lb/wk | UX | render provenance; kg/wk primary in metric | build | trust signal shown |
| **"keto" mode targeted ~150g carbs (not ketogenic)** | correctness | keto macro branch + scale-invariant carb-fraction recipe filter | `ketoMacros.test.js` | 32–117g → **~25g/day** |
| recipe monoculture — generated templates out-competed real food | quality | 0.35 selection weight on generated templates | `monoculture.test.js` | ~4 TVP/day → 5/week |
| **prose-declared allergen (mayo) bypassed the filter** | **P0-class** | filter folds in "Add'l ingredients:" | `proseAllergen.test.js` | Banh Mi kept 1 → **0** for egg allergy |
| (oracle self) peanut butter false-flagged as dairy; bare "bran"/"flour" over-claimed gluten; wine/vinegar mis-flagged | — | plant-dairy stripping + narrowed gluten list + physical-exemption class | `oracle-selfcheck.test.js` | verifier false pos → 0 |

**14k allergen sweep:** started at 31 leak candidates → **0 solver-reachable leaks** in every category. 11 residuals remain, all 0-recipe USDA edge foods (infant formula, "X as ingredient in omelet"), deferred with rationale. 3 false-exclusions (rice flour / corn tortilla under gluten) left as deliberate safe-direction over-exclusion — narrowing them would weaken allergen safety.

## Re-run commands
_(wired into package.json before being cited)_
