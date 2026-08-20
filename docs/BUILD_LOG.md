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
