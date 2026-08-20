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
