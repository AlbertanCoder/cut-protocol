# RESEARCH BRIEF — can Cut Protocol's macro compliance go higher, and what is the real ceiling?

*Paste this whole file as the opening prompt of a FRESH Claude Code session in the
repo root (the folder containing `CLAUDE.md`). It assumes you have no memory of this
work. Everything you need is here or on disk.*

---

## 0. MISSION, IN ONE SENTENCE

**Determine — with evidence, not opinion — how much higher the meal solver's
macro-compliance rate can honestly go, what the true ceiling is, and what specific
work would buy each remaining point; then write it up so the owner can decide what to
fund.**

You are doing **research**, not a feature sprint. A rigorous "here is the ceiling and
here is why" is a complete success. A number that went up because the ruler moved is a
failure, and §7 tells you exactly which ways of moving the ruler are off the table.

---

## 1. THE PRODUCT, IN 60 SECONDS

Cut Protocol is a desktop meal-planning app (Electron + Express 5 + Prisma/SQLite +
React). A user's profile produces a daily calorie/macro target; a solver fills the
day's meal and snack slots from a ~910-recipe library, scaling portions to fit, while
hard-excluding anything that breaks their diet style or allergy walls.

Read `CLAUDE.md` in full before anything else — especially the **constitution**
(wrong math is product death; the solver must declare "unsolvable + why"; no silent
target misses) and the **superseded-claims table**, which lists statements in the
phase log that are no longer true.

---

## 2. THE NUMBER YOU ARE STUDYING, AND EXACTLY HOW IT IS DEFINED

**"Days in band"** = the share of planned days where the day's totals satisfy **all
four** macro rules. The rule lives in one place — `backend/src/lib/mealSolver.js`,
`dayTolerance()` — and reads:

| macro | rule |
|---|---|
| calories | within **±15 %** of target |
| protein | no more than **15 % short** of the band midpoint (over is never a miss) |
| fat | no further than **25 % of the band midpoint** outside `[fatLo, fatHi]` |
| carbs | same 25 % allowance — but **zero upward allowance on a keto target** (a diet law) |

The bands themselves come from `bmrEngine.computeMacros()`. Note their width before
you form any view: protein is `lbm_lb × 1.14 … 1.25`, and **fat is `lbm_lb × 0.34 …
0.40` — roughly ±8 % around its own midpoint.**

---

## 3. WHERE IT STANDS NOW

Measured over 250 simulated customers / 578 planned days, `BRAIN=off`, deterministic.

| population | days in band |
|---|---|
| **all 578 days** | **70.1 %** |
| **satisfiable configs only** (excludes 83 days from deliberately-contradictory personas) | **77.8 %** |
| `dietaryStyle: none` — 80 personas, the mainstream customer | **90.6 %** |
| halal (6) · mediterranean (16) | 100 % · 85.0 % |
| no style set (24) · kosher (12) · paleo (11) | 76.7 % · 72.2 % · 64.7 % |
| **keto (14)** | **62.0 %** |
| **genuine vegan** (excluding impossible-tier) | **59.3 %** |
| vegetarian (21) | 58.7 % |

Also currently true, and **all four are load-bearing — do not regress them**:

- **0 confirmed allergen leaks** across 250 customers (was 37 hits / 16 customers).
- **100 % honesty-on-miss** — every out-of-band day carries a warning, a per-day miss
  line, or a diagnosis. This is the app's single best property.
- **0 kcal drift** between stored slot totals and recomputation from raw `Food` rows.
- p50 ≈ 490 ms, p95 ≈ 950 ms for a full week solve.

---

## 4. WHAT HAS ALREADY BEEN TRIED — DO NOT REDISCOVER THIS

Each row was measured on the same harness. The arc was **40.8 % → 70.1 %**.

| change | effect | file |
|---|---|---|
| Corrected 17 `Food` rows carrying another food's macros (`Potatoes` held *bread* at 266 kcal vs 77; `Carrots` held *dehydrated* carrot at 8×; `Tomatoes`/`Tinned Tomatos` held *tomato powder* at ~13×; `Chicken Breast` held *breaded tenders* at half the protein) | part of 40.8 → 49.3 % | `data/foodOverrides.json` |
| Populated three columns that were designed and never filled: `RecipeIngredient.scalable` (was 260/7024), `Recipe.mealCategory`, `RecipeIngredient.role` (35 % of oil rows said `carb`) | same step | `scripts/backfillIngredientMetadata.mjs` |
| **Composition-aware sampling** — `pickRecipe` weighted draws by protein-per-kcal ONLY; fat/carb entered one step too late | 49.3 → **53.3 %** | `weeklyPlanner.pickRecipe`, `COMPOSITION_BIAS_K` |
| **Adaptive slot-attempt budget** — was a flat 5 draws from a ~400-dish pool. Scaled to pool size, `max(5, min(20, n/10))` | 53.3 → **60.4 %** | `weeklyPlanner.slotAttemptBudget` |
| Un-quarantined ~30 staple `Food` rows (79 % of recipes carried an `untrusted-ingredients` flag; most were benign name mismatches like `Parsley ← "Parsley, fresh"`, but `Green Chilli` held **asparagus**, `Bacon` held **meatless bacon**, `Banana` held **dehydrated**) + authored 21 real recipes (snacks 9 → 18, vegan-eligible snacks 0 → 5) | 60.4 → **65.9 %** | `foodOverrides.json`, `scripts/seedGapRecipes.mjs` |
| **Macro closer** — adds a small allergy-filtered component (oil / rice / yogurt / chicken) when scaling alone cannot land the day | 65.9 → **70.1 %** | `src/lib/macroCloser.js` |

**Two negative results, equally important — do not repeat them:**

1. **More search depth stops paying.** Attempts 5 → 12 → 20 → 30 gave 53.3 → 60.2 →
   60.4 → 61.8 %. The curve is flat after ~12. **And a flat budget of 20 made THIN
   pools worse** (a 36-recipe fixture fell from 6/7 days to 4/7) because deep per-slot
   search greedily exhausts a small pool and starves later slots — which is why the
   budget is pool-scaled.
2. **A systematic scan for bad food rows found nothing new.** Screening all 433 served
   foods for implausible density produced 64 flags, essentially all false positives of
   the screen (dried spices legitimately at 250–560 kcal; alcohol reading "Atwater off
   −87 %" because ethanol sits in no macro column; citric acid; `canned in water,
   drained solids`). The app's own validator is more sophisticated and reports 1
   failing food in 14,151. **The wrong-food errors are Atwater-consistent by
   construction, so no arithmetic check can find them** — the ~450 remaining
   self-declared rows are the work list, and there is no cleverer detector to build.

---

## 5. REPRODUCE THE MEASUREMENT IN ~3 MINUTES

The harness already exists and is deterministic. From the repo root:

```bash
# 1. boot a dev backend on a high port (3001 is the owner's live app — NEVER touch it)
cd backend && PORT=3947 HOST=127.0.0.1 BRAIN=off node server.js &

# 2. clear the fleet's previous plans (test accounts only — email prefix qa-fleet-)
#    see docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/ for the scripts

# 3. run 250 simulated customers (~80 s, $0.00, BRAIN=off)
cd docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032
rm -f results.jsonl state.json && node fleet.mjs --port 3947

# 4. statistics with 95 % Wilson intervals, sliced by diet/tier/wall/horizon
node stats.mjs
```

**Understand the harness before you trust it.** Read `lib.mjs` — it re-derives every
verdict from raw `PlanSlot`/`Food` rows with its own arithmetic and its own
hand-authored allergen vocabulary, deliberately NOT importing the app's. The app's own
`matchPct` / `inTolerance` / `diagnosis` are recorded as *claims* and checked, never
used as evidence.

**Run-to-run variance is ~±1.5 points** (the solver samples). Anything smaller than
that is noise — do not report a 1-point "improvement" as a result.

Prior artifacts worth reading first: `FLEET-REPORT.md` (the original findings),
`IMPLEMENTED.md` (what was changed and why, including four self-corrections), and
`HARNESS-INCIDENT.md` (how a false cross-account-leak report was manufactured and
caught — read this before trusting any agent-produced finding, including your own).

---

## 6. THE CEILING ARITHMETIC — KNOW THIS BEFORE YOU SET A TARGET

**83 of the 578 days belong to personas engineered to be unsatisfiable** — vegan *plus*
soy, gluten, peanut, tree nut, sesame and legumes all excluded, against an LBM-derived
protein floor. There is no combination of library rows that satisfies them, and the
correct output is a refusal, not a plan.

That puts a hard ceiling near **88 %** on the all-days figure even with a perfect
solver. **Any claim of 90 %+ on all 578 days is therefore evidence of a broken
measurement or a moved goalpost — treat it as a bug in your own work and go find it.**

Report against **satisfiable configs (currently 77.8 %)** as the primary metric, with
all-days as a secondary. If you think the impossible tier is mis-specified, say so and
show the arithmetic — the persona generator is `personas.mjs` and its `IMPOSSIBLE`
tier is documented there.

---

## 7. INTEGRITY RULES — THE WAYS TO CHEAT, NAMED SO THEY ARE OFF THE TABLE

Every one of these would raise the number and improve nothing. If you find yourself
reaching for one, that is the finding — write it up as "the metric can be gamed thus"
rather than doing it.

1. **Do not widen the tolerance bands** in `dayTolerance()` or `computeMacros()` **as
   a way to raise the score.** Investigating whether they are *nutritionally correct*
   is explicitly in scope (H1) — but that is a nutrition question answered with
   citations, and any change must be justified independently of its effect on the
   metric, with the before/after effect disclosed separately.
2. **Do not weaken the exclusion gate.** Allergen leaks are currently 0. A change that
   raises compliance and leaks is an automatic fail.
3. **Do not degrade honesty-on-miss.** Suppressing a warning is not a fix.
4. **Do not exclude hard personas from the denominator** to make a rate look better.
   Slicing is fine and encouraged; silently dropping is not.
5. **Do not invent nutrition data.** Every food value must trace to a real record.
   `foodValidation.macroTrustIssue()` is the gate; respect it.
6. **Do not fabricate a measurement.** Every number in your report must be reproducible
   by the commands in §5. State variance. Distinguish measured from estimated.
7. **Beware your own tooling.** Two of the largest "findings" in the prior campaign
   were artifacts of the harness, not the app (see `HARNESS-INCIDENT.md`). Verify
   surprising results against raw DB rows before believing them.

---

## 8. OPEN HYPOTHESES — TEST THESE, IN THIS ORDER

Each is stated as a falsifiable claim with a suggested method. **H1 is the highest
value in the brief and nobody has done it.**

### H1 — The ruler may be wrong. The fat band is ±8 %, and nothing has validated it.
**Claim:** a material share of "failures" are not nutritional failures at all, but the
app grading itself against an arbitrarily tight window.
**Why it matters:** fat was the single largest cause of missed days (59 % at one
point), and `fatLo…fatHi = lbm×0.34…0.40` is ±8 % around its midpoint — far tighter
than any dietary guideline expresses. If the band is not defensible, the honest fix is
to correct the band and *report the compliance change as a consequence*, not to chase
the metric.
**Method:** find what the evidence base actually supports for fat and protein
distribution in a cutting/recomp population (AMDR, ISSN/ACSM position stands, the
`PROTEIN_FLOOR_SOURCE` citation already in `brain/proteinFloor.js`). Compare against
what `computeMacros()` emits for a spread of real profiles. Then quantify: of the
currently-failing days, how many are outside a *defensible* band vs only outside this
one?
**Falsified if:** the emitted bands sit within what the literature supports, in which
case say so plainly and close the question.

### H2 — Sequential greedy leaves points on the table that a joint solve would take.
**Claim:** solving slots one at a time with carry-forward is materially worse than
optimising the whole day jointly.
**Method:** the day is a small problem — ~4 slots × a few hundred candidates × 2
continuous scale factors. Prototype a joint search (ILP/CP, or beam search over slot
combinations) **offline against saved days from `results.jsonl`** — do not touch the
production path to test this. Measure the gap between the greedy day and the best
achievable day for the same pool and target.
**Falsified if:** the joint optimum is within ~2 points of greedy. That result is
valuable: it would prove the pool, not the search, is binding.
**Note:** the solver path is held to a purity invariant (no `Math.random`, no
`Date.now`) so goldens stay reproducible. Any production change must honour it.

### H3 — The macro closer is under-used.
**Claim:** it currently attaches to one host slot, offers three roles and caps at three
additions; per-slot placement or a wider candidate set would close more days.
**Method:** `src/lib/macroCloser.js`. It fired on only 9.9 % of slots. Instrument how
often it *wanted* to act but backed off, and why (`wouldHarm` refusals, no safe
candidate in a role, gap below `MIN_GRAMS`). That histogram tells you the headroom.
**Falsified if:** the refusals are dominated by `wouldHarm` — meaning the day is
already at a boundary and more adjuster freedom just moves which macro fails.

### H4 — Restricted diets are pool-limited, and the required volume is knowable.
**Claim:** vegan (59.3 %) and keto (62.0 %) are limited by library composition, and you
can compute how many recipes in which macro niches would close the gap.
**Method:** for each failing day, compute whether ANY combination in that persona's
filtered pool could have satisfied all four macros (a feasibility oracle, not a
search). Where infeasible, characterise the missing dish as a macro vector
(kcal/protein/fat/carb per serving) and cluster those vectors. **The deliverable is a
specific authoring brief: "N dishes at roughly X kcal / Y g protein / Z % fat,
vegan-compliant" — not "add more vegan recipes".**

### H5 — Up-front infeasibility detection would serve customers better than a bad plan.
**Claim:** the app can often know *before solving* that a configuration cannot be
satisfied, and saying so is better than 7 warned days.
**Method:** `mealSolver.classifyBinding()` already names a binding constraint after the
fact. Can a cheap pre-check (pool depth × macro reachability vs the target) predict
infeasibility with high precision? Measure precision/recall against the 83 known-
impossible days. **A false "impossible" on a solvable config is much worse than a
missed one — report precision, not just recall.**

### H6 — The remaining ~450 quarantined `Food` rows still hide real errors.
**Claim:** the staple triage caught the high-frequency rows; the tail still contains
wrong-food entries that corrupt macros.
**Method:** the flag does not distinguish "same food, different label" from "wrong
food entirely" — compare each row's stored macros against the borrowed record's
described food. Rank by how many recipes each blocks. Note §4's negative result: no
arithmetic screen finds these, so this is comparison work, not detection work.

### H7 — Portion bounds may be defensible to relax *selectively*.
**Claim:** 0.5–2× is right for a composed dish but wrong for a single-ingredient side.
**Method:** 68.3 % of missing slots were pinned at a bound. Test whether relaxing the
bound only for `role: "carb"`/`"veg"` side components (rice, potato) while holding it
for the named protein preserves plate sanity. **The prior campaign's customers
explicitly rejected what blanket relaxation produces** — "625 g chicken with 2 g pine
nuts", "13 g of cabbage inside a cabbage stew" — so any proposal must show what the
worst resulting plate looks like, not just the metric.

### H8 — The week horizon is structurally harder than the day, and may deserve different treatment.
**Claim:** a week must land 7 days against a variety cap; the cap and the target may be
in direct conflict.
**Method:** compare day-horizon vs week-horizon compliance for matched personas
(`results.jsonl` carries `horizon`). If the week is materially worse, quantify how much
of the gap is the repeat cap by re-running with `allowBatchRepeats`.

---

## 9. WHAT YOU MAY AND MAY NOT CHANGE

**Default posture: research-only.** Prototype offline, measure, and write up. You may
freely create files under `docs/surgery/CAMPAIGN/` and your own scratch space.

**Before changing any product code**, note two things:

1. **This repo runs PreToolUse guard hooks** (`.claude/hooks/guard-*.js`) driven by
   `docs/surgery/CURRENT/manifest.json`. They will block acts outside the current
   incision — including `git add`/`git commit` unless your role permits it. **A guard
   block is a stop sign, not a puzzle: record it and ask the owner, never route around
   it.**
2. **`backend/tests/golden/engine-baseline.golden.json` locks the BRAIN=off engine
   output.** A solver change will drift it. Regenerating is legitimate *when the change
   is intentional* — the test documents the command — but it must be disclosed
   prominently, with the diff characterised (is it a quality change or a reshuffle?).

**Port 3001 is the owner's live app with real personal data. Never probe it, never
reference it, never kill a process you did not start.** Use 3900–3999.

---

## 10. DELIVERABLE

One document: `docs/surgery/CAMPAIGN/RESEARCH-macro-ceiling-<YYYYMMDD>.md`.

Written for an owner deciding where to spend the next month, in this order:

1. **The answer, in one paragraph.** What is the realistic ceiling on satisfiable
   configs, and what is the single highest-value piece of work?
2. **The ceiling, with its arithmetic.** Distinguish *structurally impossible*,
   *pool-limited*, and *solver-limited* days, with counts. This decomposition is the
   core scientific contribution — everything else is commentary on it.
3. **Per hypothesis (H1–H8): verdict, evidence, and effect size.** Include the ones you
   falsified — a well-killed hypothesis saves more money than a vague live one.
4. **A ranked work list.** Each item: expected points gained, confidence, effort, and
   what it would break. Be explicit where a gain is speculative.
5. **What you could not determine, and what it would take.**
6. **Anything you got wrong mid-investigation, and how you caught it.** The prior
   campaign's most valuable output was a list of its own refuted claims; hold yourself
   to the same standard.

---

## 11. DEFINITION OF DONE

- Every number reproducible by §5, with stated variance.
- Every hypothesis carries a verdict — confirmed, falsified, or explicitly "not
  reached, here is why".
- The three load-bearing properties are re-measured and still hold: **0 allergen
  leaks, 100 % honesty-on-miss, 0 kcal drift**.
- No integrity rule in §7 broken; any temptation encountered is written up.
- The work list is specific enough to start on Monday without re-deriving anything.

**Ask the owner before**: changing any tolerance band, regenerating the golden
baseline, or bulk-importing recipes from the web (ingredient lists are facts, but
written method steps are generally copyrightable — that is a deliberate decision, not
a QA side effect).

---

*Context: this brief was produced at the end of a campaign that took compliance from
40.8 % to 70.1 % and allergen leaks from 37 to 0. The prior work, its four documented
self-corrections, and the full evidence trail are in
`docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/`. Start by reading `IMPLEMENTED.md`
there — particularly the sections where the prior session was wrong, because those are
the places the next result is most likely hiding.*
