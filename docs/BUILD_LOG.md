# BUILD LOG — CUT_PROTOCOL_DIRECTIVE.md execution

One entry per phase boundary: what was done, what was measured, what was
deferred. Newest last.

---

## Phase 0 — Audit (2026-08-19)

**Done:**
- Branch `product-rebuild` created off `recipe-brain` @ `7c36640`.
- Directive persisted to repo root as `CUT_PROTOCOL_DIRECTIVE.md`.
- Six parallel full-tree read-only sweeps (features, formula engine,
  screener/rails, deployment/auth, data model/solver, test coverage) →
  synthesized into `docs/AUDIT.md`.
- `docs/BLOCKERS.md` opened with 10 entries (B1–B10): stack correction,
  screener-premise correction, floor supremacy, calc-code untouchability,
  P0 fixture privacy, reuse-vs-rebuild rule, no-push rule, OAuth
  owner-dashboards, contradictory leak measurements, five-surfaces default.

**Measured:**
- `npm test` (backend): 143 files · 1,773 tests · 0 failures · 17.4 s.
- Three BMR formulas hand-verified against published equations (Mifflin
  1,880.0 / Harris-Benedict-revised 1,987.6 / Katch-McArdle 1,925.2 on the
  reference body) — exact matches; ten formulas total inspected, all agree.
- Solver benchmark on record: week-solve median 6.8 ms, p95 26.7 ms; 0
  silent misses in 35,280 day-results; 53% clean weeks at the current ±10%
  ruler; 38% of shipped slots pinned at the 0.5×/2× scale clamp.
- Confirmed defects worth naming: floor ignores training kcal
  (`bmrEngine.js:224` never calls `:163`); `plans.js:749` inline rounding
  can ship 0 g ingredients; no implausible-gram check on any production
  write path; `MIGRATION/golden/` not actually covered by the edit hooks.

**Deferred:**
- `qc:smoke` re-measurement → Phase 4, isolated DB only (B9).
- All fixes — Phase 0 wrote no product code by design.

**Next:** Phase 1 — nutrition core (net-carb derivation, allergen ontology
extensions: crustacean/mollusc subclasses + substitution table, validation
gate with per-recipe sanity bounds incl. implausible grams).

---

## Phase 1 — Nutrition core (2026-08-19)

**Done:**
- `backend/src/lib/nutritionCore.js` — FDC-canonical macro totals from
  ingredient grams (kcal from stored FDC energy, NEVER 4/4/9), net carbs
  (fiber-floored, missing fiber reads HIGH — the safe side for ceilings),
  display-only Atwater helper, fail-closed on unresolvable ingredients.
- `backend/src/lib/recipeSanityGate.js` — the plausibility gate the write
  paths never had: directive bounds (150–1,400 kcal/serving, protein ≤ 100 g),
  per-ingredient implausible-grams (warn 600 g / fail 1,500 g; seasonings
  warn 50 g / fail 250 g by food category), zero/negative grams refused.
  Pure + advisory; pool admission wires it in Phase 2.
- `backend/src/lib/allergenSubstitutions.js` — the §3.3.3 rescue table
  (coconut aminos, GF tamari, rice paper, corn tortilla, mushroom
  stir-fry sauce, tempeh, GF breadcrumbs, rice noodles…), profile-aware:
  never offers a rescue that trips the same profile (`stillTrips`).
- Ontology: `tamari`, `shoyu`, `ponzu` added to the gluten row's
  nameKeywords (trace-wheat/wheat-brewed; the existing regulated
  free-from-claim veto clears "Gluten-Free Tamari" — exactly the
  directive's rule) and promoted to soy SYNONYMS so the typed terms keep
  resolving to soy (the keyword-alias pass is first-wins, gluten first;
  two existing tests caught the flip and forced the promotion).
- Correction to AUDIT.md: crustacean/mollusc subclass rows already existed.

**Measured:**
- Live-filter probes before/after: Tamari/Shoyu Chicken/Ponzu Sauce gluten
  allowed→EXCLUDED; Gluten-Free Tamari stays allowed for gluten, excluded
  for soy; Coconut Aminos clean on soy/gluten/tree nuts throughout.
- The substitution property test caught a real bad rescue on first run —
  "crushed rice crackers" trips the filter's deliberate crackers-for-celiac
  over-exclusion — replaced with the GF-labelled product.
- Full suite: **147 files · 1,807 tests · 0 failures** (was 143/1,773;
  +4 files/+34 tests: derivedAllergens, nutritionCore, recipeSanityGate,
  allergenSubstitutions).

**Deferred:**
- Wiring sanityCheckRecipe into pool admission and the LLM-candidate gate →
  Phase 2. Net-carb display "both ways" → Phase 6. Feasibility check at
  target-setting → Phase 3.

**Next:** Phase 2 — recipe pool: run the sanity gate + exclusion gate over
the existing 889-recipe library as the admission sweep, quantify what
survives per persona-relevant diet corner, and stand up the LLM-candidate
validation pipeline (propose → deterministic gate → cache).

---

## Phase 2 — Recipe pool (2026-08-19)

**Done:**
- Isolated `backend/prisma/rebuild-qa.db` (gitignored) built from migrations
  + the three seed scripts — the CI-pool construction, never dev.db. This is
  also the Phase-4 harness substrate.
- `backend/scripts/poolAdmissionSweep.mjs` — measures every recipe against
  resolution / sanity / trust / drift and sizes persona pools; report at
  `docs/qc/pool-admission-2026-08-19.md`.
- `backend/data/rebuildCandidates.mjs` + `scripts/seedRebuildCandidates.mjs` —
  the §3.1 propose→gate pipeline with THIS session as the proposing LLM
  (zero API spend): 62 candidates + 6 label-sourced foods (coconut aminos,
  clean avocado/cauliflower/oats/almond-flour/edamame), each candidate
  resolved by name, refused if any referenced food fails an
  energy-consistency screen, totals computed FDC-canonically, sanity-gated,
  and asserted ADMITTED by the real exclusion gate for every audience it
  claims (vegan_gf / keto / carnivore / p0 / p2 / open). Dry-run default.
- Runtime plausibility fence: `planContext.recipeSanityExclusion` runs after
  the trust gate in `filterRecipePool` (cached per library version), count
  threaded to `poolCounts.sanityExcluded`, diagnosis names it (never-silent
  rule). The 150-kcal floor is admission-only by design — the runtime fence
  enforces ceilings + gram bounds (`enforceKcalFloor: false`), because a
  light side dish in the library harms nobody while a 9,282-kcal serving
  must never be served.

**Measured:**
- Seeded pool, admission sweep BEFORE: 626 recipes → 497 admitted; 129 fail
  sanity (TheMealDB whole-pot-as-one-serving rows: 1,500–2,500 kcal
  "servings"); 0 resolution failures; persona pools P1 celiac-vegan
  21 (0 snacks!), keto 20, snacks 6 total, carnivore 3.
- Candidate gate first dry run: 42/62 admitted — the gate caught ME
  proposing tofu to the soy-allergic persona, "No-Soy" in a title tripping
  the soy wall, bare "noodles"/"toasts" step prose as gluten evidence,
  corn tortillas correctly denied for celiacs, keto's 10% carb-energy share
  refusing lean snacks, and two more corrupt food rows (0-kcal Iceberg
  Lettuce, 0-kcal Cannellini). All fixed at the proposal layer; 62/62 admitted.
- AFTER seeding: 688 recipes → 559 admitted; P0 181→230 (snacks 6→21),
  P1 21→39 (snacks 0→6, now solvable), P2 197→247, keto 20→35,
  P6 247→285.
- Suite: 147 files · 1,807 tests · 0 failures after the fence wiring
  (two fence-design lessons paid for by 9 transient failures: rows with NO
  gram field are exclusionGate's territory, and partial sums must not be
  judged against the kcal floor).
- Found along the way: **"pescatarian" is not a dietary style in this app**
  (9 styles: none/mediterranean/vegetarian/vegan/paleo/keto/carnivore/
  halal/kosher) and an unrecognized style string silently applies no filter
  (route validation prevents it in-app). P5 needs the style added to the
  lattice — Phase 4 prerequisite.

**Deferred:**
- Serving-normalization rescue for the 129 whole-pot rows (divide grams by
  an inferred serving count, provenance-noted) — curation tooling, owner
  call on his real library.
- Sanity gate on the AI-draft/import/save write paths (runtime fence already
  guarantees nothing implausible is SERVED regardless of entry path).
- P5 pescatarian style in dietaryFilter/lattice.

**Next:** Phase 3 — solver: per-role lever scaling + LP-style refinement,
FDC-canonical verification ruler (±50 kcal / ±7 g P / ±7 g F / ±10 g net C),
post-rounding re-verify, feasibility check at target-setting.

---

## Phase 3 — The prescription solver (2026-08-19)

**Done — all NEW code in `backend/src/lib/prescription/`, existing solver
byte-untouched (B4):**
- `ruler.js` — the directive verdict: ±50 kcal / ±7 g P / ±7 g F / ±10 g
  net C; ranges ARE bands; ceilings truncate (keto never licensed over);
  floor outranks the band's lower edge; §3.3.4 allergen_scan line.
- `levers.js` — per-ROLE portion levers at directive bounds (protein
  0.5–2.5×, carb 0.3–2.5×, fat 0.5–2×, other 0.5–2×, scalable:false frozen),
  solved by band-normalized projected coordinate descent (the permitted
  hand-rolled refine); food-scale rounding (5 g / 1 g dense / never 0);
  totals recomputed FROM rounded grams.
- `daySolver.js` — greedy selection with carry-forward over K seeded-rng
  candidates per slot → JOINT day-level refinement across every slot's
  levers → rounding → micro-adjust (±25% wiggle on the day's own dense
  items, 1 g steps, never a new ingredient) → post-rounding re-verify →
  belt-and-braces allergen re-scan of the final plate. Meal structure is
  hard (OMAD = exactly one slot); 3-day variety window; injected rng, no
  clock, no DB.
- `feasibility.js` — arithmetic-impossibility screen at target-setting with
  per-gram FDC energy windows; carbs flex first; keto-ceiling conflicts
  named.

**Measured:**
- 26 new tests, all green first full run: P0-shaped day (2,150 kcal,
  200–220 g P, 60–70 g F, 135–160 g net C, floor 2,000) lands inside every
  band POST-rounding on a synthetic pool; independent gram-recompute agrees
  with the verdict; leak-in-pool caught at assembly with a FAIL scan line;
  P0 fixture numbers pass feasibility; the 1,200 kcal / 200 g P / 80 g F
  impossibility is caught before any solve.
- Latency: 50 seeded day solves in 137.7 ms ≈ 2.8 ms/day — the §3.4 budget
  (P50 < 2 s) has ~700× headroom.
- Full suite: **151 files · 1,833 tests · 0 failures**.

**Deferred:**
- Multi-day/batch orchestration (3-day window threading, batch-repeat
  inversion, grocery consolidation over the horizon) → Phase 4 harness
  drives it; wiring into routes/UI → Phase 6.
- Solver stage events for the honest progress UI → Phase 6.

**Next:** Phase 4 — persona harness P0–P6 on the isolated DB: fixtures with
declared targets, N-day runs, the six §7 gates executed, PERSONA_REPORT.md.
