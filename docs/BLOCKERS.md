# BLOCKERS — decisions not mine to make, defaults chosen, work continuing

Per CUT_PROTOCOL_DIRECTIVE.md standing order 2. Each entry: the conflict, the
default chosen, and what the owner can reverse. Newest last.

---

## B1 · The directive's stack paragraph is wrong (2026-08-19)

**Conflict:** §2/§11 describe "React/Vite frontend, FastAPI backend, Railway,
Google OAuth in progress." The tree is Express 5 + Prisma 6 (Node, SQLite),
React 19 + Vite 8 frontend, Electron desktop shell, JWT email/password auth.
The directive's own Phase 0 says to trust the tree over the paragraph.

**Default:** keep the existing stack. The Python acceptance-test names in §12
map to Node test files (`test_allergen_zero.py` → `allergenZero.test.js`,
etc.). LP refinement uses the directive's explicitly-permitted hand-rolled
greedy-plus-refine (or `javascript-lp-solver` if refinement proves awkward) —
no Python sidecar inside an Electron/Node product.

**Reversible by:** owner ordering a ground-up FastAPI rewrite (not
recommended; it discards 1,773 green tests and a working data layer).

---

## B2 · §8's premise about the ED screener is false; a binding safety law applies (2026-08-19)

**Conflict:** §8 says the screener "fronts … at all users." In the tree it is
already opt-in (launched from the sidebar footer / Wellbeing tab), and
DO-NOT-TOUCH.md carries a binding safety law: the Wellbeing entry and its
support resources are never hidden or greyed out.

**Default:** the Wellbeing entry stays visible. §8.3's trigger-based check-in
(fires on repeated below-floor attempts / rate-cap pushes) is **added** as new
behavior, reusing the SCOFF content as §8 specifies. This satisfies the
directive's intent (rails do the caring, no fronted lecture) without
violating the safety law.

**Reversible by:** owner explicitly revoking the DO-NOT-TOUCH safety law.

---

## B3 · The directive's floor is weaker than the shipped floor (2026-08-19)

**Conflict:** §8.1 floors at max(1,500 M / 1,200 F, BMR × 0.8). The shipped
constitution floors at max(RMR × 0.95, 1,500 M / 1,200 F). BMR × 0.8 <
RMR × 0.95, so the directive as written would *lower* an existing safety
floor.

**Default:** the stricter of the two everywhere — i.e. the shipped
max(RMR × 0.95, 1,500/1,200), plus §8.1's per-user raise-only floors (P0's
2,000) and the solver-cannot-generate-below-floor rule. A safety floor is
never weakened by default.

**Reversible by:** owner deliberately choosing the weaker composite, in
writing.

---

## B13 · Pescatarian needs a lattice re-partition, not a bolt-on (2026-08-20)

**Conflict:** the directive's P5 persona and §4.8 list pescatarian; this
app's 9 styles don't have it, and P5 currently runs as meat-word exclusions
(30/30 in the harness, but inexpressible in-app). Adding it properly means
SPLITTING the vegetarian machinery's combined keyword lists
(`MEAT_FISH_KEYWORDS`, `SLAUGHTER_OR_MARINE_KEYWORDS`) into land-slaughter
vs marine partitions — every term individually re-homed in the NUL-byte
safety file, the `dietaryStyleLattice` containment invariants extended
(`vegan ⊇ vegetarian ⊇ pescatarian-excludes`... precisely:
pescatarian-excludes = land-slaughter ⊂ vegetarian-excludes), plus
DIETARY_STYLES, `/meta`, both frontends' selects, and both style test
suites.

**Default:** not attempted at session end on the most dangerous file in the
repo (owner's own one-change-at-a-time rule). Scoped as a single-session
task with the harness's P5 (switched to the real style) as its acceptance
gate. Ambiguity to settle while splitting: anchovy-carrying compounds
(worcestershire, caesar) are marine → pescatarian-PERMITTED; gelatin stays
land-slaughter → excluded.

---

## B4 · CLAUDE.md rule 2 and golden fixtures vs new targets code (2026-08-19)

**Conflict:** repo rule — never change a calorie/macro/TDEE/BMR/target/portion
calculation; enforced by golden fixtures no agent can re-baseline. The
directive orders a new solver, new tolerance bands, and a consolidated formula
engine.

**Default:** all existing calculation modules remain byte-untouched and their
fixtures stay locked. Everything the directive adds (FDC-canonical
verification, lever scaling, ±50 kcal bands, feasibility check) is **new code
in new files**, tested independently, and wired in behind explicit call sites.
No existing number changes; new numbers are new features.

**Reversible by:** owner-approved deliberate change to a locked calculation.

---

## B5 · P0 persona is the operator's real health profile; the repo is public (2026-08-19)

**Conflict:** the P0 fixture (2,150 kcal, four allergen exclusions) is the
operator's personal health data. The `deploy` remote is public, and repo
standing rule 3 forbids personal data in app code; Phase 9 (2026-07-18)
scrubbed personal data from history once already.

**Default:** the fixture ships as `p0-founder.json` with no name, no
"operator" wording in code or test names, framed as a synthetic
high-protein/four-exclusion stress profile. Flag before any push so the owner
can decide whether even the numbers should go public (they never push without
his token anyway).

**Reversible by:** owner keeping the fixture local-only (gitignore) instead.

---

## B6 · Rebuild vs reuse — the directive orders built what partly exists (2026-08-19)

**Conflict:** solver, formula engine, allergen filter, grocery consolidation,
14k-food DB with FDC provenance, and 910 recipes already exist. Standing
order 1 prohibits bulldozing; the directive's gates demand capabilities the
existing code lacks (ingredient-level levers, FDC-canonical calorie
verification, ±50 kcal/±7 g bands, ontology with derived ingredients and
deny-on-unknown).

**Default:** decided per component in docs/AUDIT.md §7 (reuse-vs-rebuild
table). Rule of thumb: data and validated domain knowledge are harvested;
code that cannot meet a directive gate is superseded by new code, with the old
path archived per standing order 6 — never deleted (repo rule 1: deletions go
to MIGRATION/DELETE-CANDIDATES.md as candidates only).

---

## B7 · No pushes, regardless of the directive's cadence (2026-08-19)

The directive says commit at every phase boundary — done, locally. Pushing
requires the owner's explicit word (repo pre-push gate; a stale
`docs/surgery/CURRENT/PUSH_APPROVED` token currently exists and is being
ignored). All phase commits stay local until he says push.

---

## B8 · §4.1 "finish the existing integration" is owner dashboard work, not code (2026-08-19)

**Conflict:** Google OAuth is code-complete (audit §4). The outstanding items
are the owner's Supabase/Google Cloud dashboards (deferred since 2026-08-06)
and publishing the OAuth consent screen out of Testing — none of it reachable
from this session.

**Default:** treat hosted auth as done-pending-owner-dashboards. The
onboarding phase builds against both modes (Google in hosted, JWT in
desktop), which is how the code already works. `docs/DEPLOY.md` gets
rewritten to name the exact owner clicks remaining.

---

## B9 · Two contradictory allergen-leak measurements on record (2026-08-19)

**Conflict:** `qc:smoke` recorded 144 P0s including 50 allergy leaks against
the CI-seeded 626-recipe pool (2026-08-13, TONIGHT-RUNBOOK); the 100k-run
Monte Carlo against the owner's real 889-recipe library records 0. Re-running
`qc:smoke` locally would open dev.db (both env files point DATABASE_URL at
it), which is forbidden.

**Default:** neither number is cited as current. Phase 4's persona harness
runs on an isolated temp DB built from migrations + seed scripts and
re-measures from scratch; localising the CI-pool leak signal (seed-path gap
vs pool content) is an explicit Phase 4 exit criterion.

---

## B10 · The directive's five surfaces vs two existing app shells (2026-08-19)

**Conflict:** §5.1 orders five surfaces. The tree has two full shells (8-tab
full app, 4-door simple surface) — the audit shows the simple surface is the
closer shape but renders 2 of the recipe client's ~10 fields and bans the
existing progress components by comment. The owner explicitly preferred the
simple app but had not decided reconnect-vs-rebuild (handoff 2026-08-19).

**Default:** Phase 6 evolves the **simple surface** into the five surfaces
(it is mobile-first, which §11 needs anyway), reconnecting the already-built
full-app components the 8-agent roast identified as unplugged. The full app
remains untouched and reachable (`?simple=0`) as the power surface —
nothing is bulldozed. Owner can reverse toward either shell.

---

## B11 · Medication gate wiring is BLOCKED on an owner-approved migration (2026-08-19)

**Conflict:** `medicationGate.js` is built, tested (21 tests) and cited, but
wiring it needs three nullable Profile columns (`medications Json?`,
`conditions Json?`, `healthFlagsAt DateTime?` — `routes/profile.js:158-177`
names them), and `.claude/settings.json` denies every edit to
`schema.prisma` and `prisma/migrations/**` outright. That deny exists so
schema changes are deliberate owner decisions — correct here too.

**Default:** not wired. The wiring plan, ready to execute the day the owner
approves the additive migration: (1) migration adds the three nullable
columns; (2) onboarding + Settings gain a "medications & conditions"
question (free text, `classifyAll` echoes unrecognised entries back);
(3) the plan path calls `assessPlanSafety` before target derivation and
surfaces refusals/floors as data (SGLT2×keto refuses the keto style with
the citation, floors raise `floorKcal`); (4) P7-style tests for the ten
rules end-to-end.

**Reversible by:** owner saying "run the medication-gate migration".

---

## B12 · The floor ignores training expenditure — a locked calc, owner's call (2026-08-19)

**Conflict:** `effectiveFloor` (`bmrEngine.js:224`) never sees
`trainingKcalPerDay` (:163; sole call site :192 in TDEE). A hard-training
user's NET intake can sit far below the documented rail while the letter of
the constitution ("never prescribe below max(RMR×0.95, 1500/1200)") is
satisfied. Fixing it changes a locked calorie calculation (rule 2 + golden
fixtures).

**Default:** untouched, per B4. The proposed change, for the owner to
approve deliberately: `effectiveFloor` gains the training term —
`max(sexFloor, round(rmr × 0.95) + training.perDay, floorKcal)` — with the
12 MIGRATION/golden fixtures re-derived BY HAND (not regenerated) and the
change logged as what it is: a raise, never a lowering, of every affected
floor.
