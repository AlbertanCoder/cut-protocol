# AUDIT — the existing app, measured before anything is touched

Phase 0 deliverable of `CUT_PROTOCOL_DIRECTIVE.md`. Produced 2026-08-19 on
branch `product-rebuild` (forked from `recipe-brain` @ `7c36640`), from six
parallel full-tree read-only sweeps plus a live test run. Line numbers refer
to the tree as of this commit.

**Baseline measurement:** `npm test` (backend) — **143 files · 1,773 tests ·
0 failures · 17.4 s**. Runner: Node's built-in `node --test` via
`scripts/runTests.mjs` with tripwire floors (138 files / 1,704 tests).

---

## 0. Corrections to the directive's own premises

The directive says to verify its stack paragraph against the tree. Verified;
four premises are wrong, one materially better than assumed:

| Directive claim | Tree reality |
|---|---|
| "FastAPI backend" | Express 5 + Prisma 6 (Node, SQLite locally / Postgres in the Docker image). No Python anywhere. |
| "Google OAuth in progress" (implying code work remains) | **OAuth is code-complete end to end** (Supabase PKCE + Google provider, local JWKS verification, identity linking, migration, tests). What remains is the owner's dashboard work — and the Google consent screen is still in Testing mode, which locks out every non-test user on the hosted build. |
| "roughly ten calorie calculators" (as separate screens) | Ten formulas in **one** engine (`bmrEngine.js` `FORMULAS` array) surfaced on **one** screen (EngineTab) with per-formula toggles. The consolidation §5.1/§4.6 orders **already shipped**. |
| "The eating-disorder screener sits in the main flow" | **False.** SCOFF is fully opt-in behind the Wellbeing tab; the only nudge in the whole app is a 6 px amber dot that stands down when the tab is opened. Nothing is fronted at anyone. §8's *relocation* has no target; §8.3's *trigger-based check-in* is genuinely new and worth building. |
| "used on the operator's desktop" (web app assumption) | Dual-mode single codebase: Electron desktop (JWT/password, never paywalled) and Railway-hosted web (Supabase/Google, LemonSqueezy paywall). A deploy went green 2026-08-13; `cut-protocol-app-production.up.railway.app` served ~5 QA accounts as of 2026-08-14 (not re-measured since). |

Also: the directive's §8.1 floor (BMR × 0.8) is **weaker** than the shipped
floor (max(RMR × 0.95, 1500 M / 1200 F, user floor)). The shipped floor
stands — see `docs/BLOCKERS.md` B3.

---

## 1. Feature inventory

Full sweep of `frontend/src/` (two parallel surfaces + chrome). Navigation is
the `tab` state in `App.jsx`; NAV order: Profile · Today · Plan · Recipes ·
Training (flag, on) · Trend · Wellbeing (flag, on) · Engine; Foods is a child
view of Recipes.

### 1.1 The headline: the tree carries TWO complete applications

- **Full app** — 8 tabs, `frontend/src/components/` (~12,000 lines of screens).
- **Simple surface** — 4 doors (Today · Food · Progress · You),
  `frontend/src/simple/` (~2,900 lines, 11 files), runtime-switched via
  `?simple=1` / localStorage `shadcut:uiMode` / a sidebar footer button.
  Default is `full`. Self-documented as the copy that loses on disagreement
  (`SimpleApp.jsx:34-50`).

Every simple screen duplicates a full-app screen. The single largest
duplicate cluster is the **grocery list + Copy/SMS/Email exporters, which
exist three times** (`PlanTab.jsx:1481-1556`, `RecipesTab.jsx:964-1037`,
`simple/SimpleShopping.jsx`).

### 1.2 Status classification (compressed; classes: USED / DEAD / BROKEN / DUPLICATE)

**USED and healthy** (maps cleanly to the five surfaces):
LoginScreen + SetupWizard + provisional-profile banner (→ Onboarding);
TodayTab ring/macros/diary/weigh-in/verdict/trend-snapshot + SlotWarnings
(→ Today); PlanTab horizon bar, generate/cancel with honest progress,
week board, 3-candidate day options, slot lock/swap, SolverNarration,
verdict persistence (→ Plan); grocery card + checkboxes + copy/email
(→ Groceries); RecipesTab browse/search/trust-report/URL-import/AI-drafts/
allergen-override/cart (→ Plan); FoodsTab virtualized 14k-food browse +
barcode lookup (→ Settings, advanced); EngineTab 3-step math walk +
AdaptiveTdeeCard (→ Settings); ProfileTab with ack gates, AllergySearch,
BodyFatPicker, CoachSettings (→ Settings/Onboarding); Wellbeing tab +
SCOFF check + MicronutrientsCard + ResourceList (→ Settings, safety-pinned);
TrendTab charts/outliers/projection (→ Today); LemonSqueezy checkout +
PremiumGate + pricing (→ Settings); BugReportDialog (→ Settings).

**BROKEN / stale:**
- **JSON export is not an export** — `EngineTab.jsx:362-370` is a `<details><pre>`
  with an in-file TODO admitting `GET /api/export` is unbuilt. **CSV export
  does not exist anywhere.** This violates the standing constitution ("data
  is never trapped: JSON+CSV export must always work"). Must be rebuilt.
- FoodsTab "Log today" button permanently disabled with copy claiming the
  food diary isn't built (`FoodsTab.jsx:354-362`) — the diary shipped.
  Wire it or kill it.
- `TodayTab.jsx:53-73` `searchDiaryFoods` hand-rolls fetch outside
  `lib/api.js`, bypassing the global 401 seam (admitted in its own comment).
- `PlanTab.jsx:79-83` `stripSourcePaths()` scrubs a backend defect
  (source path leaking into `costCoverageNote`) client-side.
- Barcode **webcam** scan path gated on `BarcodeDetector`, unavailable in
  Windows Chromium — dead on the target platform (manual UPC entry works).

**DEAD / kill-list candidates** (recorded here; actioned only at the Phase 8
simplification pass, per standing order 6 and repo rule 1 — archive, never
delete):
1. 12 shadcn primitives installed and never imported
   (`components/ui/{checkbox,dialog,label,progress,radio-group,select,separator,sheet,switch,table,textarea,tooltip}.jsx`).
2. TodayTab "Micronutrients — MOVED" forwarding-address card (`TodayTab.jsx:1011-1024`).
3. CompareDialog — 174 lines of static competitor marketing inside the tool.
4. Training tab — self-declared v1 scaffold, zero integration with the meal
   engine (owner call; it's isolated and harmless but serves no
   prescribe→cook→hit-numbers purpose).
5. `?penny=1` dev checkout route (`App.jsx:118-128`).
6. 4-week photo/tape reminder — a nag with no feature behind it
   (`TodayTab.jsx:1077-1081`).
7. `api.swapSlot` (`lib/api.js:387`) — zero call sites.
8. Two of the three grocery exporter triads.

**Misfiled (works, wrong home):** meal structure (meals/snacks per day) is a
profile setting living on the Plan tab (`PlanTab.jsx:1458-1478`) → Settings.

**Correction vs. one sweep's finding:** the login screen's Google button is
NOT a stub — `LoginScreen.jsx:176-215` `GoogleSignIn` calls
`signInWithGoogle()` → Supabase `signInWithOAuth({provider:"google"})`. The
comment "nothing here submits credentials anywhere" describes the OAuth
redirect, not a missing implementation. Verified by direct read.

### 1.3 Five-surface mapping

Everything above maps onto **Onboarding · Today · Plan · Groceries ·
Settings** without a sixth surface. Groceries is today split across three
in-tree copies and has no destination of its own — the directive's Groceries
surface is a *consolidation*, not new capability.

---

## 2. The calculator situation

`backend/src/lib/bmrEngine.js` — **10 formulas, one engine, one screen.**

Mifflin–St Jeor · Oxford/Henry 2005 · Harris–Benedict revised (Roza 1984) ·
Schofield · Katch–McArdle (BF) · Cunningham 1980 (BF) · FAO/WHO/UNU ·
Owen · Livingston–Kohlstadt · Nelson 1992 (BF). Default-ON: the first six;
default-OFF: the last four. Combination is the **mean** of included,
applicable formulas; BF-dependent rows hide when body fat is unknown;
dispersion published as spread/SD, honestly labelled not-a-CI.

**Spot-checks against published equations (hand-computed, reference body
M / 30 y / 180 cm / 90 kg / 20% BF):**

| Formula | Published expectation | Code result | Verdict |
|---|---|---|---|
| Mifflin–St Jeor | 10·90 + 6.25·180 − 5·30 + 5 = **1,880.0** | 1,880.0 | ✅ exact |
| Harris–Benedict revised | 88.362 + 13.397·90 + 4.799·180 − 5.677·30 = **1,987.6** | 1,987.6 | ✅ exact coefficients |
| Katch–McArdle | 370 + 21.6·72 = **1,925.2** | 1,925.2 | ✅ exact |

The other seven agree with their published forms on coefficient inspection.
The formulas are correct and stay byte-untouched (BLOCKERS B4).

**TDEE:** RMR × occupation multiplier (44 occupations, 5 bands, 1.2–1.7,
manual override 1.0–2.2) + additive ACSM-MET training kcal.
**Target:** TDEE − rate×500/day, clamped to
floor = max(1500 M/1200 F, RMR×0.95, user floor); `floored` +
`achievableRate` published, never silent.

**Engine defects found (fix in later phases, never silently):**

1. **The floor ignores training expenditure.** `effectiveFloor`
   (`bmrEngine.js:224-228`) never sees `trainingKcalPerDay` (:163; single
   call site :192). A hard-training user's *net* intake can sit far below
   the documented rail. → Phase 7 rails.
2. `excludedFormulas` is a **flip list**, not an exclusion list
   (`isFormulaOn` :127) — default-OFF formulas turn ON by being "excluded".
   Data-model semantics hazard.
3. Silent fallbacks: unknown `occupationKey` → desk-office (1.2); unknown
   `trainingStyle` → mixed (MET 5).
4. `SAFE_FLOOR[profile.sex] ?? SAFE_FLOOR.M` gives non-M/F values the male
   floor while `male: profile.sex === "M"` makes them female for BMR — the
   two defaults point in opposite directions.
5. `routes/recipes.js:104` calls `computeMacros` without `floorKcal` and
   reads the cached target instead of the reconciled resolver.
6. `lib/weightNow.js:10` and `adaptiveTarget.weightNowKgAt` still average the
   last 7 *rows*, not 7 calendar days; that weight feeds every formula.
7. The solver's fat allowance (±25% of midpoint) reaches below the essential-
   fat floor by construction — documented in-file (`bmrEngine.js:336-354`),
   downstream half unfixed.

**Adaptive TDEE** (`expenditureEstimator.js` + `adaptiveTarget.js`): a real
energy-balance reconciliation (Huber-robust weight slope, intake mean with
missing-day bias, inverse-variance shrinkage toward the formula prior,
±30% rails, ±125 kcal/week step cap, floor outranks cap, idempotent replay).
Keep untouched; the directive has no equivalent and needs none.

---

## 3. The eating-disorder screener

**As wired (all verified by read):**

- SCOFF (Morgan, Reid & Lacey 1999), 5 questions verbatim in
  `WellbeingCheck.jsx:19-25`; score = yes-count, positive ≥ 2; submit
  disabled until all answered.
- **Opt-in only.** Launched solely from the Wellbeing tab's CTA. The old
  sidebar-footer button was removed (tombstone at `Sidebar.jsx:142-145`).
  No modal auto-opens, ever. The simple surface has no SCOFF at all —
  resources only.
- The only pointer: a 6 px amber dot on the Wellbeing nav item when
  `wellbeingSignals()` finds live concerns (aggressive rate / floored
  target / measured loss outrunning band / goal BMI < 18.5), never seen
  this session, never screened. Stands down on tab open.
- Positive screen → support card first, micronutrient detail held back by
  default with a one-click, persisted "show anyway". A default, not a lock.
- Result: localStorage `shadcut:wellbeingScreen` only — no backend column,
  no route, one-click delete with focus management.
- Resources (`wellbeingResources.js`): NEDIC first, EDSNA, AB Mental Health
  Help Line, Health Link 811, 988 — verified 2026-07-24, rendered at four
  sites via one component, never gated.

**Consequences for §8:** there is nothing to relocate. What §8.3 actually
adds that doesn't exist: (a) a **trigger** — repeated below-floor attempts /
rate-cap pushes — because today those attempts leave **no structured record
anywhere** (only a 50-entry sessionStorage ring of "PUT /profile → 422"
lines that can't say which gate fired); (b) the single respectful check-in
reusing the SCOFF content at that trigger. The Wellbeing entry itself stays
visible per the binding safety law (BLOCKERS B2).

**Existing rails inventory (all server-side, all tested):** rate menu
(400 off-menu) · rate >1% BW/wk or floored target → 422 `ack:"rate"`
(persisted, auto-cleared when safe) · goal BMI 16–18.5 → 422
`ack:"goalWeight"` (deliberately never persisted) · goal BMI <16 → hard 400 ·
gain-direction hard 400 · adult gate 403 at age <18 (bounds deliberately
14–100 so 15-year-olds get the gate, not a "typo" message) · solver kcal
low-edge = max(band lo, floor−1e-6). Known scoping gap: a weigh-in that makes
a saved rate newly unsafe does not re-trigger the ack (signals fire, consent
isn't re-asked).

**The medication gate** (`backend/src/lib/medicationGate.js`, 415 lines,
21 tests): 6 drug classes (brands first, combinations included), 6
conditions, 10 rules (SGLT2×keto refusal, insulin VLCD refusal, pregnancy,
CKD protein ceiling, bariatric, ED-condition refusal…), returns refusals/
floors as data, never computes. **Zero callers, no schema column, no UI.**
`routes/profile.js:158-177` documents the three columns it needs. Wiring is
Phase 7 work gated on the owner's schema approval (additive nullable
migration).

---

## 4. Deployment & auth

**Deployment:** Railway (Docker, two-stage node:22-slim). The image flips
Prisma to Postgres at build (`buildPostgresSchema.mjs --patch-main`);
`docker-entrypoint.sh` handles three measured Supabase-pooler failure modes.
One green deploy on record (2026-08-13);
`https://cut-protocol-app-production.up.railway.app` serving ~5 QA accounts
per `docs/deploy/tester-invite.md` (2026-08-14), **not re-measured since —
verify `/api/health` before citing.** Root `DEPLOY.md` is obsolete (predates
the whole Postgres mechanism); `docs/deploy/TONIGHT-RUNBOOK.md` supersedes it.

**Auth, two modes, one switch (`SUPABASE_URL` set or not):**
- Desktop: JWT/password (bcrypt 12, HS256-pinned, password-epoch revocation,
  httpOnly cookie). Never paywalled.
- Hosted: Google via Supabase (PKCE), local JWKS verification, email-link or
  create with `role:"user"` always; first-run-admin gated off in hosted mode
  in both paths. Google is the only hosted path — no password fallback
  renders.

**The live blocker is dashboards, not code** (`BUILD_PLAN.md` stages 1–6:
code done; owner owes Supabase project + Google OAuth dashboards, deferred
since 2026-08-06; consent screen still in Testing ⇒ strangers get a dead
end). Billing is **LemonSqueezy** (not Stripe; no Stripe code exists):
checkout, webhook, entitlement-at-read, grace windows — built and
unit-proven; store dashboard pending. **14-day trial is unbuilt** (no
`trialUsed`/`trialEndsAt` columns). Legal pages exist but carry DRAFT
banners and placeholder dates.

**Secrets:** `backend/.env` (+`.env.qc`), `frontend/.env`,
`deploy-local/railway-variables.env` — all gitignored; `.env.example`s
tracked. Both backend env files point `DATABASE_URL` at **dev.db** — any
future harness needs its own DB built from migrations (pattern exists in
`auth.registration.test.js`). Packaging `build.files` **is now an allowlist**
(CLAUDE.md's "in progress" is stale); `distPrecheck.mjs` structurally forbids
regressing to a denylist. Residual: `docs/DISCLAIMER.md` still not in the
allowlist; keys named in the 2026-07-29 audit still want rotating;
`scanSecrets.mjs` still NUL-exempts `dietaryFilter.js`.

**CI** (`.github/workflows/ci.yml`, master-only — this branch never
triggers it): security job (secret scan, brain purity, supply chain),
backend job (Node 24, SQLite, migrate+seed, entrypoint guard, `npm test`,
`qc:smoke`), frontend job (lint + build). **Recorded red:** `qc:smoke`
exited 1 against the CI-seeded 626-recipe pool on 2026-08-13 — 144 P0s
including 50 allergy leaks. Recorded, **not re-measured here** (running it
locally would open dev.db, which is forbidden); re-measure in Phase 4 on an
isolated seeded DB. Note the contrast: against the owner's real 889-recipe
library, the 100k-run Monte Carlo records **0** P0s — the leak signal is a
property of the CI seed pool and/or seed-path gaps, and Phase 4 must
determine which.

**PWA/mobile: nothing.** No manifest, no service worker, no
vite-plugin-pwa. The simple surface is genuinely mobile-first responsive;
the full app is desktop-first. §11's PWA scaffold is real new work.

**The relay** (`relay/`): standalone keyless-installer proxy for the AI
coach — token auth (constant-time), model allowlist, hard USD caps. Local
only; no evidence of deployment. Its 24 tests are outside `npm test` and CI.

---

## 5. Data model & solver

### 5.1 Schema (`backend/prisma/schema.prisma`, 884 lines)

Answers to the directive's direct questions:
- **Recipe macros: computed AND cached.** `RecipeIngredient.baseGrams` ×
  `Food` per-100g is ground truth; `Recipe.kcal/…` are cached per-serving
  totals recomputed on save and used only for pool screening. The solver
  recomputes from grams on every solve, and shipped totals are recomputed
  **from the rounded grams**. The directive's "never stored as asserted
  totals" is satisfied in spirit; the cache is a screening index.
- **`Food.fdcId Int? @unique` exists** (uniqueness added after a real
  six-foods-one-record corruption). **`Food.fiber` exists** (default 0) —
  but **the solver ignores fiber entirely**; no net-carb concept anywhere.
- **No image field** on Recipe or Food.
- **No medication/condition field** on Profile.
- `PlanSlot` stores `proteinScale`, `sidesScale`, and a frozen
  `ingredients` JSON (ground truth per slot).

### 5.2 Nutrition data

14,122–14,124 foods (bulk FDC import grew it from ~864), 889 recipes
(602 TheMealDB / 262 ai-generated / 24 curated / 1 imported), ~7,245
ingredient rows. Provenance tiers on every food (open vocabulary:
usda-verified 13,516 · manual 605 · community · ai-estimated ·
manual-placeholder 3 · quarantined · undocumented `usda` 939).
Four ingestion paths (live FDC client with correct Foundation-energy
nutrient priority, bulk import, Open Food Facts barcode, offline seed cache
with 552-entry fdcMacroCache). Curated `foodOverrides.json` with per-entry
provenance notes.

**Known corruption, self-documented:** ~470 pre-import rows carry another
food's macros verbatim (Atwater-consistent because they're real numbers —
the wrong food's); `docs/qc/integrity-sweep.md` carries a VERDICT VOID
header saying its own "clean" headline is wrong. An adversarial sweep found
200 leaking food rows / 210 recipe×allergy pairs missed by the earlier
allergen sweep, plus over-blocking (57 peanut-butter rows excluded by
tree-nut via "nut butter" substring). 169 case-insensitive duplicate-name
groups. **No production write path checks implausible grams** — the
10,000 g-peas recipe validates as self-consistent (`validateRecipe` checks
drift, not plausibility; per-ingredient caps exist only on AI-draft and
URL-import paths).

### 5.3 The solver (`weeklyPlanner.js` 1,178 lines + `mealSolver.js` 1,764 lines)

Purity-locked (no RNG/clock — injected; goldens byte-reproducible).
Pipeline: planContext (cached filtered pool) → horizon windows →
best-of-5 weeks → randomized day order with within-day carry-forward →
per-slot weighted-random draw (protein-density, composition bias, cuisine/
rating/budget multipliers — never vetoes) → **two-lever scaling** →
post-scale keto re-check → `macroCloser` adjusters (max 3/day from a
10-food whitelist, never past target×1.10) → scoring → honest verdict +
diagnosis, persisted with a staleness signature.

**The load-bearing fact for Phase 3:** scaling is a closed-form 2×2 solve
over exactly two groups — `proteinScale` (role="protein") and `sidesScale`
(everything else scalable), both clamped 0.5–2×, `scalable:false` frozen.
It **cannot** move one ingredient independently, cannot change a dish's
fat-per-kcal or carb-per-kcal at all (composition is steerable only by
candidate choice), cannot substitute ingredients, and collapses the 7
existing `role` values into one "sides" bundle. Measured cost: **38% of all
shipped slots sit pinned at a clamp; 68.3% of missing slots were pinned**;
fat alone was 59% of failing days.

**Tolerance model today** (owner-decided 2026-08-03): kcal ±10% AND
≥ floor · protein ≥ floor (shortfall-only) · fat 20–35%E guardrail
(keto exempt from ceiling only) · carbs ungraded remainder (non-keto ≥ 50 g
anti-ketosis floor; keto ceiling absolute). Week: ±5%. The directive's
bands (±50 kcal · ±7 g P/F · ±10 g net C) are **dramatically tighter** —
at 2,150 kcal, ±50 is ±2.3% vs today's ±10% — and require **net carbs**,
which requires fiber in the solve path, which requires per-ingredient
scaling to be reachable at all. This is the single largest build item.

**Performance (measured, seeded, 5,040-week benchmark + 100k-run Monte
Carlo):** week solve median 6.8 ms / p95 26.7 ms; full-run p50 13.5 ms /
p95 67.2 ms; 0 silent misses in 35,280 day-results; 0 zero-gram ingredients
in 558,002; 53% clean weeks at the *current* ruler. The directive's
P50 < 2 s / P95 < 8 s budget is ~100× headroom — room to spend on LP
refinement. Latency is benchmarked (`bench:solver`) but has **no test
gate**; `bench:solver:check` asserts honesty, not speed, and isn't in CI.

**Rounding:** `practicalGrams` — ≥20 g → 5 g steps; <20 g → max(1 g, round)
(the 1 g floor exists because plain rounding deleted 4.3% of ingredients).
Totals recomputed from rounded grams. **Bug found:** `POST /plans/place-recipe`
re-implements rounding inline (`routes/plans.js:749`) where 0.4 g → 0 g —
the exact vanishing-ingredient bug `practicalGrams` prevents; no test
compares the two implementations.

### 5.4 Allergen/dietary filtering — closest thing to directive-grade in the tree

`exclusionGate.js` (single authority; four evidence sources: ingredient rows
with Food metadata, step-prose ingredient names, title, full step text;
build fails if any src file bypasses it) over `dietaryFilter.js` (126 KB,
NUL bytes — use `rg --text`) + `allergenTaxonomy.js` (38 rows).

- Six add-only matching layers: word-boundary+plural regex, 52-entry
  compound dictionary with 19 recorded false-friends, category ontology
  with real derived-ingredient knowledge (**soy sauce → gluten AND soy;
  hoisin/teriyaki/worcestershire → gluten+soy; oyster/squid/surimi/curry
  paste → shellfish; beer → gluten; stock cubes → gluten+soy; lactose →
  dairy**), ~120 free-text aliases (peanut ≠ tree nut), term normalisation,
  persisted metadata probes (fdcCategory, OFF allergen/traces tags —
  traces default exclude).
- **Unknown ingredient policy: DENY** — a recipe whose ingredient metadata
  didn't load fails closed (`ingredient-metadata-not-loaded`), before the
  profile is even consulted. Unknown *terms* still filter via literal
  matching and are reported as literal; condition-shaped text (`"no cow
  dairy but…"`) is marked `expressible:false` and the UI must say nothing
  was filtered.
- Cross-reactivity: peanut→lupin (directional). Keto is enforced as a
  scale-invariant carb-energy share with post-scale re-check.

Gaps vs the directive's §3.3 (corrected 2026-08-19 during Phase 1): the
crustacean/mollusc **subclass umbrella already exists** (taxonomy rows
`crustaceans` and `molluscs`, both `parent: "shellfish"` — an earlier draft
of this audit wrongly listed it as missing). The real gaps, measured live:
plain tamari/shoyu/ponzu did not trip **gluten** (closed in Phase 1 with the
regulated GF-claim veto giving the labelled-tamari semantics), and no
**substitution knowledge** existed anywhere (closed in Phase 1:
`allergenSubstitutions.js`). Additive ontology work, not rework — confirmed.

### 5.5 Grocery list

`groceryList.js` + `purchaseUnits.js` + `groceryPrices.js`: consolidation
keyed on (name, prep state) — honest two-line output when states differ;
7 cooked→raw yield factors, unknown yields explicitly labelled not-a-
purchase-quantity; store sections with measured corrections; ~70 purchasable-
unit rules with shopping-rounding; CAD estimates that are loudly estimates,
null (never fabricated) when unmatched, excluded from a total that is
deliberately withheld. Checkboxes persist server-side. **Reuse as-is;**
directive §5.4 is already built modulo a dedicated surface.

### 5.6 Content gaps the solver correctly declares but cannot fix

9 snack recipes total (0 vegan, 0 vegetarian); 3 carnivore recipes;
128 desserts correctly fenced out of meal slots (459 of 602 imports
meal-eligible); week-4 novelty 38%. Phase 2's pool work is where the
directive's LLM-proposes → gate-validates loop earns its keep.

---

## 6. Test coverage

143 files / 1,773 tests / green (measured). Runner: `node --test` via
`runTests.mjs` with tripwire floors, recursive JS discovery (the shell-glob
CI hole is fixed and guarded), BRAIN/keys neutralised so a run can never
bill. CI (master-only): security + backend (SQLite, seeded, `qc:smoke`
P0 gate) + frontend (lint+build). **Frontend has zero tests** — oxlint +
build is the whole net. Relay's 24 tests run nowhere automatically.

Strong: allergens (38-row taxonomy tests, 14k-food sweep, derived
ingredients, fail-closed gate, QC gauntlet incl. fuzz/SSRF/injection),
solver honesty, formula goldens (12 locked profile fixtures with exact
diff reporting), safety gates (28 tests), auth/routes/webhooks.

**Directive-relevant holes:**
| Gap | Status |
|---|---|
| Solver latency | No test anywhere; benchmark exists, asserts honesty not speed, not in CI |
| Implausible grams on recipes | No test AND no production check (10,000 g peas passes validation) |
| OMAD / meals:1 full-week solve | Door is tested (1..8 legal); no solver fixture ever runs meals:1 |
| Rounding parity | `place-recipe` route's inline rounding vs `practicalGrams` — no test compares them (real 0 g bug at `plans.js:749`) |
| Net carbs / fiber | Nothing — no concept in the solve path |

**Golden-fixture seal gap:** hooks + settings deny cover
`backend/tests/golden/` only; `MIGRATION/golden/` (the 12 calorie-chain
fixtures CLAUDE.md cites as hook-sealed at `guard-edit.js:138`) matches no
hook pattern and no deny entry. Its protection is convention. Flagged, not
fixed (hook config is owner infrastructure).

---

## 7. Reuse vs rebuild — the decision table

Per BLOCKERS B6. "Reuse" = byte-untouched or extended additively;
"Extend" = new code alongside, existing behavior preserved;
"Build" = doesn't exist.

| Directive component | Verdict | Basis |
|---|---|---|
| Formula engine (§4.6) | **REUSE** | 10 formulas verified correct, golden-locked, one screen already |
| Adaptive TDEE | **REUSE** | Better than anything the directive asks for |
| Safety gates (rate/goal/adult/floor) | **REUSE + EXTEND** | Rails exist and are tested; add event log + trigger check-in (§8.3) + training-aware floor fix |
| Medication gate | **WIRE** | Built, tested, cited; needs schema column (owner gate), onboarding question, plan-path call site |
| Allergen ontology (§3.3) | **REUSE + EXTEND** | Single-authority fail-closed gate exists; add crustacean/mollusc subclasses, substitution table, tamari rule |
| Dietary hard constraints | **REUSE** | Lattice + tests exist; 0 leaks on the real library across 100k runs |
| Nutrition data / FDC (§3.1) | **REUSE + EXTEND** | 13.5k USDA-verified foods with fdcId + fiber already ingested; add net-carb derivation, implausible-gram sanity gate, and the ~470-row corruption cleanup |
| Solver: selection layer | **REUSE** | Weighted draw + variety + caching + honesty layer, measured at scale |
| Solver: scaling (§3.2 levers) | **BUILD** | Two levers ≠ per-ingredient/per-role levers; 38% clamp-pinned; composition unreachable; this is the core build |
| Solver: verification pass | **BUILD** | Directive bands (±50 kcal/±7 g/net-C) + FDC-canonical energy + post-rounding re-verify — new ruler, new code, existing ruler untouched (B4) |
| Feasibility check at target-setting (§3.2) | **BUILD** | Nothing exists |
| Grocery (§5.4) | **REUSE** | Consolidation/units/sections/honest costs all built; needs its own surface |
| Onboarding (§4) | **EXTEND** | SetupWizard + SimpleOnboarding exist; directive's 10-step flow is a re-sequencing plus scale-moment + BF-visual (exists: BodyFatPicker) |
| Five surfaces (§5.1) | **CONSOLIDATE** | Both app shells exist; simple surface is the closer starting shape; groceries needs a home |
| Persona harness (§7) | **BUILD** | qc/mc.mjs is uniform-sampling crash-fuzz on a different ruler; fixture-driven personas with declared targets are new. Needs isolated DB (both .envs point at dev.db) |
| Images (§6) | **BUILD** | No image field, no assets, no provenance file |
| Safety check-in trigger (§8.3) | **BUILD** | No event log exists to trigger from |
| PWA scaffold (§11) | **BUILD** | Nothing exists |
| Positioning/deploy/mobile docs (§9, §11) | **WRITE** | CompareDialog's sourced claims + tester-invite are raw material |

---

## 8. Facts that gate the next phases

1. Both local env files point `DATABASE_URL` at dev.db (owner's personal
   data, never to be opened). Every harness/QC run in this build uses a
   temp DB built from `prisma/migrations` + seed scripts — the pattern
   already exists in `auth.registration.test.js`.
2. `qc:smoke`'s recorded red (50 allergy leaks, CI seed pool, 2026-08-13)
   vs the real library's recorded zero — Phase 4 must re-measure on the
   seeded pool and localise the difference before trusting either number.
3. The current solver hits 53% clean weeks at ±10% kcal. The directive
   demands 95% of days at ±2.3% (±50 kcal at P0's 2,150). The gap is closed
   by per-role/per-ingredient lever scaling + LP-style refinement +
   adjusters — not by tuning the existing two-lever closed form.
4. Latency budget is a non-issue (6.8 ms median vs 2 s budget) — spend it
   on refinement iterations.
5. Directive §12 test names are Python; this repo's equivalents will be
   `backend/tests/personas/*.test.js` and siblings (B1).
