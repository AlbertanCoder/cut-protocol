# Final report — CUT_PROTOCOL_DIRECTIVE.md execution, 2026-08-19

> **Addendum 2026-08-20:** the branch was adversarially code-reviewed (11
> findings, all fixed — BUILD_LOG has the disposition), the visual walk of
> both new frontend pieces is done, and a lean-protein pool batch closed
> the last band misses: the fleet now measures **210/210 days inside all
> four bands, 0 allergen hits** (suite 155 / 1,857 / 0). Fragility items
> 2 (the two band misses) and 5 (no visual walk) below are RESOLVED;
> everything else in this report stands as written.

Unsold, per §13.8. Eight commits on `product-rebuild` (51b65cf → 4bb076e),
all local, nothing pushed. What works is measured; what is fragile is named;
nothing below is rounded up.

## Executed run output (§13.7 — the actual output, not a summary of it)

`npm test` (backend), final run of the session:

```
ℹ tests 1852
ℹ suites 0
ℹ pass 1852
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17512.5682

[runTests] OK — 155 files, 1852 tests, 0 failures.
```

`node scripts/personaReport.mjs` (the §7 gates, 7 personas × 30 days):

```
gates: days 210, ok 208 (99%), hits 0, p50 4ms, p95 8.2ms
```

`node scripts/prescribeWeek.mjs` (the §14 ship-gate machine half):

```
ok 14/14 · allergen hits 0 · → docs/P0_FOURTEEN_DAYS.md
```

Reproduce: build the QA DB (five commands in
`backend/tests/personas/harness.js` SKIP_NOTE), then run the three commands
above. Everything is seeded; same inputs, same numbers.

## What works

- **The prescription solver** (`backend/src/lib/prescription/`): per-role
  levers at directive bounds, joint day-level refinement, food-scale
  rounding with post-rounding re-verification against ±50 kcal / ±7 g P /
  ±7 g F / ±10 g net-C, multi-dish OMAD slots, belt-and-braces allergen
  re-scan with the §3.3.4 metadata line. 208/210 persona days in band;
  ~4 ms per day against a 2,000 ms budget.
- **The gates are real tests**: allergen-zero, dietary-hard-constraints,
  tolerance, variety, latency, meal-structure, floors-hold (P7 100/100),
  derived-allergens, image-provenance — all §12 rows mapped to JS and
  running in `npm test`.
- **The safety rails**: absolute 1.5%-BW rate cap (no override), the
  private safety-event ledger, the once-per-pattern check-in (server), and
  its panel (simple surface). The P7 storm test caught my first trigger
  design nag-looping before it shipped.
- **The pool pipeline**: propose → deterministic gate (resolution,
  energy-consistency screen, sanity bounds, real-exclusion-gate audience
  assertion) → seed. The gate rejected 20 of my own 62 first-draft
  proposals, including tofu offered to a soy allergy — which is the whole
  §3.1 architecture proving itself against its own author.
- **Reachability**: `/api/prescription/preview` + the Food › Preview room;
  live-fired end-to-end on the QA pool.
- Docs: AUDIT, BLOCKERS (12), BUILD_LOG, KILL_LIST, POSITIONING, DEPLOY,
  MOBILE_PATH, IMAGE_PROVENANCE, PERSONA_REPORT, P0_FOURTEEN_DAYS.

## What is fragile — read this part twice

1. **The QA pool is not the owner's library.** Every persona number above is
   measured on the isolated 688-recipe seeded pool. His real 889-recipe
   library carries the known ~470-row macro corruption; the runtime sanity
   fence guards plans, but persona-grade numbers on HIS pool are unmeasured
   (his dev.db is rightly untouchable by agents — he can run the harness
   against a copy himself if he chooses).
2. **The two band misses** (P0 fat-over ×1, P6 protein-under ×1 in 210 days)
   are selection-variance, not arithmetic: thin fatty/lean coverage in
   those pool corners. More pool depth fixes it; more attempts would paper
   over it. I chose not to paper.
3. **62 of the pool's recipes are my proposals.** Machine-verified numbers,
   plausible food on paper — but nobody has cooked them. The §14 gate's
   second half (the owner actually cooking from docs/P0_FOURTEEN_DAYS.md)
   is the only test of palatability, and it has not happened.
4. **The net-carb bridge is an allowance, not data.** The engine's carb
   band is total carbs; the preview maps it to net via a flat 25 g fiber
   allowance, disclosed in the API note. Real per-day fiber targeting needs
   fiber in the main solve path (it is only in the prescription path).
5. **Frontend pieces are lint/build/API-verified, not eyeball-verified.**
   No browser walk of Food › Preview or the check-in panel yet.
6. **The preview persists nothing.** Swap/pin/repeat, grocery generation
   from a prescription day, and any Plan-row persistence (whose schema
   assumes one recipe per slot — multi-dish OMAD does not fit it) are
   design decisions still ahead.
7. **P4's budget constraint is a preference, not a verified constraint** —
   cost coverage on recipes is too thin to gate on, and the report says so.
8. **CI never runs the persona gates** (no QA DB there) and CI itself only
   fires on master.

## Blocked on the owner, deliberately

- Medication-gate migration (BLOCKERS B11 — wiring plan ready).
- Training-aware floor (B12 — a locked calc; proposed diff written).
- Google consent screen + Supabase/LemonSqueezy dashboards (docs/DEPLOY.md).
- TheMealDB photo licence (docs/IMAGE_PROVENANCE.md rule 4).
- The kill-list ARCHIVE moves (docs/KILL_LIST.md, one commit per move).

## What I would build next, in order

1. Cook-test week: the owner cooks 3–5 days from P0_FOURTEEN_DAYS.md;
   every "would not eat that" becomes a proposal-layer fix or a lever-bound
   tightening. Palatability is the only ruler code can't hold.
2. Persistence for prescription days (schema decision: dishes-per-slot),
   then swap/pin/repeat on the preview room — that turns the preview into
   the §5.2 platter.
3. Pool depth in the measured-thin corners (vegan+GF, keto, snacks
   everywhere) through the same propose→gate pipeline.
4. Pescatarian as a real dietary style in the lattice.
5. The kill-list moves + the five-surface consolidation (Groceries gets
   its one home).
6. Fiber onto the main solve path; retire the 25 g allowance.
