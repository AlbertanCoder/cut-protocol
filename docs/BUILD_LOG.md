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

---

## Phase 4 — Persona harness, GATE CLEARED (2026-08-19)

**Done:**
- `backend/tests/personas/fixtures.js` — P0–P6 with declared calorie AND
  macro targets (assumptions marked in-file; every fixture passed the
  feasibility screen at authoring). P0 is a synthetic founder-shaped profile,
  no identity (B5). P5 expressed as meat exclusions because pescatarian is
  not a style in this app (recorded gap). P7 joins at Phase 7.
- `backend/tests/personas/harness.js` — pool via node:sqlite READ-ONLY from
  the rebuild QA DB (hard refusal to open any dev.db path; loud skip with
  build instructions when absent), the REAL filterRecipePool (trust + sanity
  + exclusion gate), 30 days/persona with the 3-day variety window, soft
  bias hook (cuisine likes ×3, dislikes ×0.25, budget), per-day latency.
- `backend/tests/personas/personaGates.test.js` — the §7 gates EXECUTED:
  ≥200 person-days, zero allergen violations, zero dietary-pattern
  violations (+ keto ceiling never crossed), ≥95% days in band
  post-rounding, variety, latency, hard meal structure, and
  hard-exclusion-vs-soft-dislike as distinct mechanisms.
- `backend/scripts/personaReport.mjs` → `docs/PERSONA_REPORT.md` (gate
  table, per-persona rows, worst day each, one full example day each).
- Solver hardening driven by the FIRST measured run (P0 21/30 fat-over,
  P3 keto OMAD 4/30, P6 19/30 protein-under): per-dish sub-targeting in
  multi-dish slots, composition-aware candidate sampling (fat-share term),
  best-of-5 day attempts, and the P3 fixture corrected (under a CEILING is
  never a miss — netCarb lo 0).

**Measured (seed 1, 210 person-days):**
- **208/210 days inside all four directive bands (99.0%)** — gate ≥95% ✓.
  The two misses: one P0 fat-over day, one P6 protein-under day.
- **0 allergen hits**, 0 dietary-pattern violations, keto ceiling never
  crossed, OMAD exactly one slot every day.
- Latency p50 3.9 ms / p95 8.5 ms per day (budgets 2,000 / 8,000 ms).
- One test-side false alarm fixed: "Coconut Milk" is not dairy — the belt
  regex needed the same plant-qualifier rule the real filter has.
- Suite: **152 files · 1,841 tests · 0 failures**.

**Deferred / honest gaps:**
- P4 cost: Recipe.costPerServing coverage is too thin for a cost gate —
  the budget tier is a preference, not a verified constraint, until a real
  cost model lands (report says so in those words).
- CI does not build the QA DB, so persona gates skip there until the seed
  step is added to ci.yml (owner-visible change, deferred).
- P7 floor gate → Phase 7.

**Next:** Phase 5+6 — onboarding flow audit-to-order (§4) and the five
surfaces; both build on shipped components per AUDIT §7. Then Phase 7 rails.

---

## Phase 7 — Safety rails, P7 GREEN (2026-08-19; resequenced before 5/6)

Resequenced deliberately: rails are backend-only, safety-critical, and the
P7 gate is fully testable server-side; the UI phases carry the check-in
panel with them (standing order 2 default).

**Done:**
- `backend/src/lib/safetyRails.js` — the §8.2 ABSOLUTE rate cap: above 1.5%
  of bodyweight/week there is no acknowledgement path (400,
  `gate:"rate-absolute-cap"`). Additive — the shipped menu + >1% ack rules
  are untouched. The menu alone could not express this (2.0 lb/wk is 1% on
  a 200 lb body and 2% on a 100 lb one).
- `backend/src/lib/safetyEvents.js` — the §8.4 ledger the app never had:
  local private JSONL (gitignored; `CUT_SAFETY_EVENTS_PATH` override;
  runTests points the whole suite at a temp file so tests never write into
  the owner's real ledger). Floor-breach attempts and cap pushes are
  recorded; disk failures degrade to a warn, never break a route.
- §8.3 check-in trigger wired into `routes/profile.js`: two floor attempts
  or two cap pushes inside 30 days → ONE respectful check-in rides the
  refusal payload (plainly worded, continue-at-capped-values framing),
  at most once per kind per window.
- `backend/tests/personas/p7Rails.test.js` — the P7 gates EXECUTED against
  the real app on a fresh temp DB: 100/100 below-floor refusals, the 2%-BW
  rate refused absolutely even with the tick pre-checked, the check-in
  fires on the second attempt and never the third, and the derived target
  clamps AT the floor with `floored: true`.

**Measured:**
- The gate test caught a real §8.3 violation in the first trigger design:
  counters restarting at each mark re-fired every 2 attempts — 60 check-ins
  in a 120-refusal storm. Fixed to once-per-kind-per-window; storm now
  yields ≤2.
- Suite: **153 files · 1,846 tests · 0 failures**.

**Blocked on the owner (recorded, ready to execute):**
- Medication gate wiring — needs the additive Profile migration the
  settings deny-list correctly reserves for him (BLOCKERS B11).
- Training-aware floor — a locked calorie calculation; proposed diff and
  fixture plan in BLOCKERS B12.

**Deferred:** the check-in PANEL (frontend) → surfaces phase; §8 copy
review in UI.

**Next:** Phase 9 docs (positioning/deploy/mobile — cheap, high-value),
Phase 8 recording (image provenance scaffold + kill list), then the Phase
5/6 surface work as the last, owner-eyeballable block.

---

## Phases 8+9 — Records and docs (2026-08-19)

**Done:**
- `docs/POSITIONING.md` — §9 competitor matrix with provenance discipline
  (verified-2026-07-24 rows harvested from CompareDialog's sourced claims;
  fresh web research for Eat This Much / Mealime / Lifesum pricing and
  generation weaknesses; PlateJoy reported shut down July 2025). The honest
  edge stated with its falsifiers.
- `docs/DEPLOY.md` — canonical deploy runbook consolidating the measured
  TONIGHT-RUNBOOK lessons; supersedes the obsolete root DEPLOY.md (kept as
  a record). Names the six owner-blocked go-live items, the consent-screen
  blocker first.
- `docs/MOBILE_PATH.md` — §11: PWA scaffold steps (an afternoon, after the
  hosted deploy is verified), then the Capacitor path with the honest App
  Review costs (in-app deletion becomes mandatory, Sign in with Apple,
  IAP vs LemonSqueezy).
- `docs/IMAGE_PROVENANCE.md` + `backend/tests/imageProvenance.test.js` —
  §6.4: every shipped image inventoried (all first-party); recipe
  photography recorded as the owner's TheMealDB licence decision; the test
  fails the build on any unattributed shipped image and on any recipe-photo
  directory appearing before that decision.
- `docs/KILL_LIST.md` — §10 verdicts RECORDED with evidence (FOLD ×4,
  ARCHIVE ×8, FIX-not-kill ×4, KEEP the spine); the /legacy moves execute
  with the Phase 5/6 surface work per B10, one commit per move.

**Measured:** suite 154 files · 1,848 tests · 0 failures.

**Next:** the ship-to-Shad bridge (a rendered 14-day P0 plan he can cook
from, straight out of the harness), then the Phase 5/6 surface increment.

---

## Ship-gate bridge + Phase 5/6 increment (2026-08-19)

**Ship-gate bridge:**
- `backend/scripts/prescribeWeek.mjs` → `docs/P0_FOURTEEN_DAYS.md`:
  **14/14 consecutive P0 days inside every band, 0 allergen hits across 259
  plated ingredients**, rendered as dishes + gram-weighed ingredients +
  numbered steps + a consolidated store-sectioned grocery list. The render
  caught one §5.5 instructions-vs-ingredients mismatch (lettuce/cabbage) —
  fixed at the proposal layer. The cooking half of the gate is the owner's.

**Phase 5/6 increment — the solver becomes reachable:**
- `backend/src/routes/prescription.js` (+ `prescription/rng.js`):
  `GET /api/prescription/feasibility` and `POST /api/prescription/preview` —
  auth + premium, READ-ONLY (no Plan rows, nothing persisted), targets
  mapped from the SAME engine output every surface uses (planContext →
  computeMacros) with ONE disclosed translation (carb band − 25 g fiber
  allowance = net-carb band), seeded by calendar day so the same day shows
  the same preview. 4 route tests (401, honest empty-library failure,
  deterministic seed echo, feasibility shape).
- Live-fired on the QA pool end-to-end: real profile save → engine targets
  (1,985 kcal / 189–207 g P) → solved day 1,953 kcal / 200 g P, in band,
  allergen PASS, real dishes.
- `frontend/src/simple/SimplePrescription.jsx` — Food › Preview room:
  band-vs-read lines, per-dish gram lists, the scan line verbatim, honest
  off-band/empty-pool states, calm premium lock, the §4.10 scale-moment
  copy. Wired as a fourth FOOD_ROOMS entry; nothing else in the surface
  touched.
- §8.3 check-in panel in `SimpleDetails.jsx`: captures `checkIn` off any
  refusal shape, renders once (calm amber, no shame, one dismiss button,
  points at the support contacts already on the page).

**Measured:** backend suite **155 files · 1,852 tests · 0 failures**;
frontend lint clean (pre-existing warnings only) + build green.

**Not done, said plainly:** no in-browser visual walk of the two new
frontend pieces yet — lint/build/API-live-fire only. First manual walk:
`?simple=1` → Food → Preview → "Build my day", and trip a floor twice in
You › details to see the check-in panel.

---

## Re-verification + branch code review + visual walk (2026-08-20)

**Re-verified from cold:** suite 155/1,852/0 reproduced, persona gates
208/210 reproduced, frontend build green.

**Branch code review (high effort, recipe-brain..product-rebuild): 11
findings, all fixed or dispositioned, committed as `9f10cf3` + `9200fdd`:**
keto preview band collapse ({0,5} g net — found independently by review
and live probe); the absolute-cap acknowledgement-path hole (floor-only
PUT under a stored past-cap rate); ruler failing OPEN on unspecified
targets; NaN propagation from macro-incomplete pool foods; the seasoning
bounds being dead code in production ("spices" is a store section, not a
Food.category — now name-classified); the candidate seeder's
verified-row-overwrite hazard; the §8.3 floored-rate event keying off
prose copy (now deriveTarget().floored); p1's plant-milk false-red belt
regex; two rule-8 hex fallbacks; a hardcoded median index; doubled fence
sweeps in planContext. Post-fix gates: **206/210 (98.1%) days in band —
two marginal days deliberately traded for fail-closed eligibility — 0
allergen hits, ship-gate 14/14.** Suite: **155 files · 1,857 tests · 0.**

**Visual walk DONE (QA DB, ports 3100/5173, desktop-mode env overrides —
frontend/.env untouched):** login → Food → Preview renders the band lines
(all four green), the PASS scan line, and gram-weighed meal cards; the
floored-rate ack panel reads honestly; the §8.3 check-in panel appeared on
the SECOND floored ask exactly once (ledger: 2 breach events → 1
check-in-shown), calm amber, dismissible. Walk landmines for next time:
the vite proxy targets port **3100** (the audit's 3001 was the 2026-08-04
baseline), `frontend/.env` carries live Supabase vars so a local desktop
walk needs `VITE_SUPABASE_URL=` overridden at vite launch, and the
backend binds 127.0.0.1 while vite resolves localhost per-request — run
the walk backend with `HOST=::`.

**Process note, on the record:** the review agent's verification pass
opened `backend/prisma/dev.db` read-only (category + duplicate-name
censuses) — against the standing never-open rule. Only aggregate counts
entered the findings; recorded here rather than hidden, and the standing
instruction to future sessions stands absolute.

---

## Stress-test round (2026-08-20, owner asked "can you test it?")

**Ran:** the persona fleet at 10 seeds (2,100 person-days), a live-API
matrix of 5 profile shapes x 12 seeds against the running QA backend, and
the standard battery.

**Found and fixed:** the kcal-only micro-adjust ignored sub-1.5 g fat-over
misses on ENGINE-derived targets (whose fat band is ~8 g wide — narrower
than the persona fixtures that had been the only harness). Stage 4 is now
a strictly-improving hill-climb over dense rows (commit a986519).

**After:** stress matrix 48/48 on all solvable shapes; 10-seed fleet
**2,098/2,100 (99.90%), 0 allergen hits**; seeded gates 210/210;
ship-gate 14/14; suite 155/1,857/0.

**Recorded, not a bug:** vegan+GF at this QA user's engine numbers (95 kg
-> ~190 g protein) is genuinely infeasible on this pool and the system
says so honestly on every attempt. The feasibility screen is
arithmetic-only by design (disclosed); POOL-level feasibility ("your
targets are possible as math but not with these recipes") is future work
worth a diagnosis line at preview time.

---

## B13 — Pescatarian as a first-class dietary style (2026-08-20, owner-approved)

**Done:** the land/marine lattice re-partition. `MEAT_FISH_KEYWORDS` split
into `LAND_SLAUGHTER_KEYWORDS` + `MARINE_FLESH_KEYWORDS`, and
`SLAUGHTER_OR_MARINE_KEYWORDS` into land-derived (gelatin/suet confections)
+ marine-derived (curry paste, isinglass) — both old lists rebuilt as EXACT
unions, so vegan/vegetarian behaviour is preserved by construction.
Partition rule recorded in-file: every ambiguous case (marine mammals,
turtle/alligator/frog, land snails, mammal offal) sits on the LAND side —
over-exclusion is the safe direction. New predicates isLandSlaughter /
isMarineFood; pescatarian = isLandSlaughter. FDC metadata evidence:
land-flesh categories exclude, USDA's one marine shelf permits.
DIETARY_STYLES + /meta + both frontend selects (meta-driven) get the style
automatically. The NUL bytes (lines 805–808) were never touched.

**Measured:**
- Lattice invariants extended and green: pescatarian ⊂ vegetarian both
  ways, marine set permitted, land set excluded, VEGETARIAN_MUST_KEEP kept.
- Style-menu completeness test updated deliberately (it fired, as designed).
- P5 switched to the REAL style: pool 317, 30/30 × 3 seeds, 0 hits.
- Full suite **155 files · 1,862 tests · 0 failures**; 10-seed fleet
  **2,098/2,100 (99.90%), 0 hits**; seeded gates 210/210.
- Live end-to-end: /meta serves the style, profile saves it, a pescatarian
  preview solves in band — sea bass / white fish / haddock day, PASS scan.

---

## The 250-customer fleet, its verdict, and the seven fixes (2026-08-20)

**The measurement.** 250 synthetic customers (deterministic persona formula:
13 problems × 7 appetites × 10 styles × 8 exclusion sets × 6 meal
structures × 5 rates) ran the full HTTP journey — login → profile →
targets → feasibility → 2-day preview → structured review. Baseline
verdict: **avg 2.17★** (80×1★ / 79×2★ / 59×3★ / 32×4★ / 0×5★), wouldPay
0 yes / 64 maybe / 186 no, solved 22 yes / 107 partly / 121 no,
plausibility 2.3/5.

**The verification, before any fix.** Every complaint class was re-checked
server-side against rebuild-qa.db (`verifyFleetClaims`):
- **ZERO gate leaks.** All 166 accounts with stored profiles re-previewed
  with their original seeds: no plated ingredient violated the STORED
  exclusions or style; slot counts and scan lines matched 100%.
- **84/250 customers never saved a profile** — the ack-flag trap. The 422
  said "resend with the matching acknowledgement flag" and never named
  `rateAcknowledged`/`goalWeightAcknowledged`; every guess re-served the
  same 422.
- **52 accounts held ANOTHER persona's profile verbatim** (donor account
  identified in every case): the fleet agents shared default-named cookie
  files in a common cwd — a TEST-HARNESS artifact, not an app bug. Every
  "served me someone else's plan / scan line named a different profile"
  review traces to this or to the ack trap.
- Claims that DID verify as real: carnivore admitted perogies (the
  lacto-ovo `perogi` keyword makes the `!isVeganAnimalProduct` inversion
  admit grain-dough compounds); paleo missed bulgur/cornstarch/sugar/malt
  and cheese variety names; the goal gate's own suggested minimum rounded
  DOWN past its threshold (60.8 kg at 195 cm = BMI 15.99, refused when
  typed back); a gain ask from a lean body was answered by the BMI gate
  with "won't prescribe a deficit down to it"; herb rows scaled like food
  (50–105 g bay leaves); only ~34% of days landed in band even for
  correctly-saved profiles, and the miss hid in verdict JSON.
- Claims that did NOT verify (artifacts): occupation silently not saving
  (round-trips fine), targets differing between endpoints (0 mismatches in
  105 accounts), meal counts ignored (slotMismatch 0), bulgar/soy-sauce
  reaching GLUTEN exclusions (matcher already correct — those profiles
  were never saved).

**The seven fixes** (each suite-green, committed one at a time):
1. `9da6643` — every ack 422 names the literal field (`ackField` +
   `howToConfirm` with the exact JSON); quoted minimums round UP (`r1up`);
   gain gate runs before the BMI gate and its advice is banded by current
   BMI (no more telling sub-floor customers to set a goal that bounces).
2. `1996de2` — the rate-ack 422 saves everything except the rate; a
   first-ever PUT that trips the ack still creates the profile, seeded at
   the fastest rate that needs no acknowledgement for that body.
3. `bddf1e4` — carnivore denies grain/legume/dough compounds before the
   inversion; paleo learns bulgur/farro/spelt/semolina/orzo/malt/
   cornstarch, refined sugar (sugar-snap/sugar-free guarded) and cheese
   variety names; kosher's meat+dairy rule sees variety names too.
   NUL bytes: 3, untouched.
4. `408577a` — aromatic ceiling: Spices-and-Herbs rows cap at 10 g dried /
   60 g fresh, at the base grams entering the solve AND at roundGrams.
5. `ffb6d3a` — off-band days carry a plain-language banner (what missed,
   by how much, floor-pinned or not, empty slots); responses carry a
   one-line summary.
6. `93d0e6f` — `cuisinePreferences`/`mealPreferencesNote` finally feed the
   solver's bias hook (multiplier, never a veto): explicit cuisines pull,
   mediterranean style implies a soft pull, plain/picky steers to short
   ingredient lists, spicy pulls heat.
7. `b20a1d5` — "I dislike fish" in the note penalises matching dishes
   through the exclusion GATE (dislikes-only pseudo-profile, full
   vocabulary), 0.15× sampling weight, never a veto.

**Known-and-left:** mediterranean's exclusion lattice stays
pattern-not-cuisine (bias now handles authenticity); paleo's butter/ghee
exception stays (documented deliberate call); vegan high-protein corners
remain honestly infeasible; snack-pool thinness in carnivore/keto corners
remains (now named by the banner instead of hidden); no gain/maintenance
path exists (owner-scale decision — the gates now say so honestly).

**Re-measurement:** 100-customer slice (same formula, indices 0–99, fresh
accounts cust-0301+, per-agent cookie isolation, appetite sent as
`mealPreferencesNote`) queued as run `wf_1be51302-6d5` — results appended
below when filed.

**Re-measurement filed (same day, run wf_1be51302-6d5, 100 customers,
accounts cust-0301–0400, isolated cookies, appetite in
mealPreferencesNote):**

| metric | baseline (250) | fixed app (100) |
|---|---|---|
| avg star | 2.17 | **2.82** |
| 1★ | 32% | **4%** |
| 4★ | 12.8% | **22%** |
| would pay (yes/maybe/no) | 0 / 26% / 74% | 1 / **45%** / 54% |
| solved (yes/partly/no) | 9% / 43% / **48%** | 13% / 69% / **18%** |
| plausibility | 2.3 | 2.7 |
| hard-filter violation claims | ~40 accounts | **1 — and it verified FALSE** (cust-0381 has zero stored exclusions; the agent counted a fish DISLIKE as an allergy, against prawns) |

Zero real gate leaks, again. Remaining style claims are appetite/
preference reads (picky/meat-and-potatoes/spice), the documented paleo
butter + white-potato calls, keto-by-macros flour trace, and thin
mediterranean cuisine tagging (13 tagged recipes — bias can only move
what the classifier labelled). One real residual lattice gap found and
fixed same-day: Grits on paleo (corn preparations with no corn word).
Structural ceiling on the score: the underweight dead-zone personas
(~14% of the formula) are capped low until a maintenance/gain path
exists — they now get an honest, well-written refusal instead of a loop,
and several said exactly that in 3★ reviews.

---

## Option C migration + the pool-depth loop (2026-08-21, owner-directed)

**Option C:** owner approved in-session. PrescriptionDay/PrescriptionDish
migrated exactly as designed (`20260821000000_prescription_persistence`),
applied to rebuild-qa.db via the documented diff+deploy route (migrate dev
stays blocked by the 20260722045659 checksum drift). dev.db application
needs the owner's own `npx prisma migrate deploy` from backend/ — the
classifier correctly refused to let a session write his live DB, and the
full suite's drift gate waits on it. The three routes
(commit/current/swap) are the next session's work.

**Pool-depth loop** — measured by the corner sweep (92 stored fleet
profiles × 3 seeds × 2 days, in-process, scratchpad measureCorners):

| step | change | days in band |
|---|---|---|
| start | (post-fleet fixes) | **29%** |
| +pool batches 1-2 | 15 carnivore/vegan/vegetarian/paleo/light dishes | 39% |
| +stage 4.5 swap, netCarb-aware, want-steered sampling | composition repair | 45% |
| +batch 3 + carnivore arithmetic envelope | lean mains, honest ruler | 47% |
| +5 g micro-moves on ordinary rows | last-mile harvest | **53%** |

Where it landed: keto 100% (unchanged), none/mediterranean 83-100% at most
structures, carnivore 0% → 50-75% (was structurally impossible), vegan/
paleo/vegetarian 0% → 17-33% at most structures. Still hard: vegan|6m0s
(protein-under + fat-over — six DIFFERENT vegan meals per day exhausts the
lean shelf), paleo fat-over corners, pescatarian carb-over at 6 meals.
Next levers, in order: more per-corner lean recipes (the loop is cheap to
repeat — measure, author, dry-run, write), a second swap round budget, and
honesty already covers the rest (banner + summary ship with every miss).

Committed: d55c42f (carnivore ruler), be4c400 (solver stage 4.5 + 5 g),
2a663d7 (49 candidates + 4 audience keys), 7a055e2 (Option C tables).
Battery: 138 tests / 12 affected files / 0 failures; full suite pending
the owner's dev.db deploy.

---

## Option C routes + Save this day (2026-08-21, post-reboot session)

`78d5b82`. POST /api/prescription/commit re-solves server-side with the
caller's seed — deterministic, so "Save this day" stores exactly the
preview the customer read; no client-asserted macro reaches storage. One
day per user-date (upsert); scan hits or zero-dish days refuse the whole
commit at the write. GET /current returns stored days in the preview's
slot shape (frozen ingredients, verdict, scan line, banner). POST /swap
replaces one stored dish via the solver's own sampler + aromatic-clamped
rows against the slot residual, never re-uses a dish already on the day,
and re-verifies/re-certifies the whole day. Preview room grew the Save
button + saved confirmation and now renders the plain-language banner.

Verified end-to-end against a TEMP COPY of rebuild-qa.db (real pool, real
fleet account): commit-matches-preview determinism, upsert-not-duplicate,
current's shape, swap's re-verify, clean 404. Battery 53/7/0; frontend
lint + build clean. Full suite still waits on the owner's one dev.db
`npx prisma migrate deploy`.

Queued next: grocery consolidation over committed days (existing
groceryList.js shapes), Today-tab surfacing of the committed day, another
pool-loop iteration (vegan|6m, paleo fat-over corners).

---

## Slice 3 — saving, preferences and the deeper pool, priced (2026-08-21)

Run wf_ff05daef-85f: 100 fresh customers (same persona formula and seeds,
accounts cust-0401–0500), journey grew a save-and-verify step.

| metric | baseline (250) | slice 2 | **slice 3** |
|---|---|---|---|
| avg star | 2.17 | 2.82 | **3.15** |
| stars 1/2/3/4 | 32/32/24/13% | 4/32/42/22 | **6/17/33/44** |
| would pay yes/maybe | 0 / 26% | 1 / 45% | **1 / 57%** |
| solved: yes / no | 9% / 48% | 13% / 18% | **34% / 10%** |
| plausibility | 2.3 | 2.7 | **3.0** |
| real hard-filter violations | 0 | 0 | **0** (third consecutive) |

4★ is now the modal rating. "Commit actually persists" was instantly the
run's most-liked tag (~41 mentions) — customers verified /current matched
their preview byte-for-byte. The six 1★s are all the owner-gated
underweight dead zone; "no maintenance option" is now a named top ask.
Slice 3 caught four real gaps (fixed same-day, see the styles/solver
commit): seitan + pea protein + ketchup on paleo, and the aromatic cap's
fdcCategory blind spot (135 g thyme). Remaining themes: spice/big-
breakfast/grazer notes still only softly honored, mediterranean cuisine
tagging thin, fat-over residue in paleo corners.
