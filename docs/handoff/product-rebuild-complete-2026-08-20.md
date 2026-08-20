# Product rebuild — complete state report, 2026-08-20

Written after a full cold re-verification. Branch `product-rebuild`,
17 commits ahead of `recipe-brain`, HEAD `390cf9b`, tree clean, nothing
pushed. This document is the union of: the directive execution, the
2026-08-19 pre-directive handoff threads, and the saas-launch state —
everything, in one place.

## 1 · Verification (all run fresh today)

| Check | Result |
|---|---|
| `npm test` (backend) | **155 files · 1,857 tests · 0 failures** |
| Persona gates (7 × 30 days) | **210/210 days inside all four bands · 0 allergen hits** · p95 7.4 ms |
| Ship-gate (`prescribeWeek`) | **14/14 days · 0 hits** |
| Determinism | regenerated P0 plan byte-identical; persona report differs only in timing lines |
| Frontend | oxlint clean (pre-existing warnings only) · vite build green |
| Live API | preview solves in band on the QA pool with a PASS scan line |
| Test ledger / dev.db | ledger clean; dev.db untouched by all of today's work |

## 2 · Standing items to be aware of (none new today)

- `docs/surgery/CURRENT/PUSH_APPROVED` — a **stale push-gate token**; while
  it exists, a push would go through. Delete it unless it's deliberate.
- `docs/design/logo-2026-08/candidates/_ref/` — the 19 third-party brand
  assets exist **untracked on disk only** (amended out of history
  2026-08-19). A future `git add -A` could re-commit them; a one-line
  gitignore closes it on request.
- During the 2026-08-20 code review, the review agent **opened dev.db
  read-only** for aggregate censuses — against the standing rule. Only
  counts entered findings; disclosed in BUILD_LOG.
- `qc:smoke` (the OLD solver's Monte-Carlo on the CI seed pool) was
  recorded RED 2026-08-13 (144 P0s) and has never been re-measured
  (BLOCKERS B9). Pre-existing, on master's CI path, not this branch's
  solver.
- API keys named in the 2026-07-29 systems audit **still want rotating**
  (CLAUDE.md archive note).
- Four plaintext credential files remain on the Desktop (password-manager
  suggestion made once, 2026-08-19; not renewed here).

## 3 · Work done (this branch, 17 commits)

- **Phase 0** — six-sweep audit (`docs/AUDIT.md`), 12-entry BLOCKERS,
  directive premises corrected (no FastAPI; OAuth code-complete; screener
  already opt-in; "ten calculators" already one engine).
- **Phase 1** — nutrition core: FDC-canonical `nutritionCore.js`,
  `recipeSanityGate.js` (directive bounds + implausible-grams),
  `allergenSubstitutions.js` (rescue table, property-tested against the
  real filter), tamari/shoyu/ponzu → gluten with GF-label semantics.
- **Phase 2** — isolated `rebuild-qa.db`; pool admission sweep (626 → 497
  admitted; whole-pot TheMealDB rows fenced); the propose→gate candidate
  pipeline; runtime plausibility fence in `filterRecipePool` with honest
  counts + diagnosis.
- **Phase 3** — the prescription solver (`backend/src/lib/prescription/`):
  ±50 kcal / ±7 g P / ±7 g F / ±10 g net-C ruler (ceilings truncate,
  floors outrank, fail-closed), per-role levers at directive bounds,
  joint day refinement, food-scale rounding with post-rounding
  re-verification, multi-dish OMAD slots, allergen re-scan + §3.3.4 line.
- **Phase 4** — persona harness P0–P6, six §7 gates as executed tests,
  `docs/PERSONA_REPORT.md`.
- **Phase 7** — §8 rails: absolute 1.5%-BW rate cap (no ack path),
  private safety-event ledger, once-per-pattern check-in; P7 100/100.
- **Phases 8–9** — POSITIONING (web-researched), DEPLOY (canonical),
  MOBILE_PATH, IMAGE_PROVENANCE + enforcing test, KILL_LIST (verdicts
  recorded).
- **Ship-gate bridge** — `docs/P0_FOURTEEN_DAYS.md`, cookable.
- **Phase 5/6 increment** — `/api/prescription/{feasibility,preview}`
  (read-only, seeded by calendar day), the Food › Preview room, the §8.3
  check-in panel.
- **2026-08-20** — 11-finding adversarial code review, ALL fixed (keto
  band collapse, cap-laundering hole, fail-open ruler, NaN propagation,
  dead seasoning bounds, seeder overwrite hazard, prose-keyed safety
  counter, plant-milk false red, rule-8 hexes, median index, doubled
  sweeps); in-browser visual walk of both new pieces (screenshots taken);
  lean-protein pool batch → **210/210**; persistence design written
  (Option C); pescatarian scoped (B13).

## 4 · Work I could not do

**Yours by design (each ready the moment you say the word):**
1. Persistence Option C — one additive migration + three routes + "Save
   this day" (`docs/design/prescription-persistence.md`).
2. B11 medication-gate migration (module built + 21 tests; three nullable
   Profile columns).
3. B12 training-aware floor (locked calc; proposed diff + hand-re-derived
   fixture plan written).
4. Google consent screen out of Testing + Supabase/Google/LemonSqueezy
   dashboards (BUILD_PLAN Parts A–E) — the whole hosted go-live chain.
5. TheMealDB photo licence (~CA$16/mo) and the 308-never-photo treatment.
6. Kill-list ARCHIVE moves (one commit each, owner-reviewable).
7. Any push.
8. **The cook-test** — the ship-gate's human half.

**Technically blocked:**
- Persona-grade measurement of YOUR real library (dev.db untouchable —
  you can run `poolAdmissionSweep`/the harness against a copy YOU make).
- CI persona gates (ci.yml doesn't build the QA DB; master-only triggers).

**Deliberately deferred, with reasons in writing:**
- Pescatarian style (B13 — a land-vs-marine re-partition of the safety
  file's keyword lists; single-session task, not an end-of-day sprint).
- Serving-normalization rescue of the 129 whole-pot rows (curation
  tooling; owner call on the real library).
- Fiber onto the MAIN solve path (retires the preview's 25 g allowance).
- Five-surface consolidation + JSON/CSV export rebuild (KILL_LIST fix
  list; export is a standing-constitution violation).
- Frontend test infrastructure (currently zero tests; lint+build is the
  whole net).

## 5 · The roadmap, whole-project view

**Now (evidence before code):** 1) cook 3–5 days from P0_FOURTEEN_DAYS;
2) approve Option C → persistence + swap/pin on Preview; 3) pescatarian
session (B13); 4) kill-list moves + Groceries gets its one home + rebuild
the JSON/CSV export.

**Product threads predating the directive, still real:**
5) **Occupation autocomplete** — you ranked it #1 on 2026-08-19 and it was
never started; your design decision is already made (O*NET/NOC index →
free-text fallback → two questions → existing tiers, multiplier shown).
6) FFMI as a sanity check on mis-entered body fat. 7) Photography
decision. 8) `MIGRATION/baseline/` screenshots (the only blocker on the
254-capability Phase 8). 9) The remaining safety-artifact decisions.

**Go-live chain (all owner dashboards + small code):** consent screen →
verify live deploy commit → trial mechanism (schema) → legal pages out of
DRAFT → in-app account deletion → key rotation.

**Data health:** run the admission sweep against a copy of your library;
decide the ~470-row corruption cleanup; re-measure qc:smoke (B9).

## 6 · Loose ends needing one word each

- The 2026-08-19 Desktop housekeeping (7 spent files incl. that handoff)
  was never confirmed → never deleted.
- You wanted to discuss something about **Jarvis** before the 08-19
  session ended — still unasked.
- The QA walk servers (ports 3100/5173) are running until you kill them.
- `V2-DELTA-BACKUP.md` on the Desktop is still committed nowhere.
