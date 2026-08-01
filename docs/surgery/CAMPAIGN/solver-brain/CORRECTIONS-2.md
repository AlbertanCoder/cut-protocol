# SOLVER BRAIN — mid-flight corrections, part 2

*`CORRECTIONS.md` is immutable once written (create-only guard). This file continues it.
**Every agent launched from here reads `BRIEF.md`, then `CORRECTIONS.md`, then this.***

---

## C6 — The copy block is the guard's `--force` rule. Use a plain copy.

**Operational.** A9 recorded that copying the database into its own directory was blocked on
both Bash and PowerShell, and correctly stopped rather than working around it. Cause:
`guard-bash.js` denies `--force\b|(^|\s)-f(\s|$)`, so `cp -f` and `Copy-Item -Force` both
trip it. The guard is not blocking the copy — it is blocking the force flag.

**A plain `cp` with no flags is not blocked** and is what the BRIEF's isolation contract
specifies. A3, A7, A10 and A11 all copied successfully. Consequence for A9: its role-coverage
counts are quoted from a schema comment rather than independently measured, and it appended
nothing to `CLAIMS.tsv`. **A13 must re-measure one-knob-branch coverage directly.**

There is also a **fleet sandbox** at `Desktop/solver-brain-guard/fleet-sandbox.js` that
blocks any command whose text pattern-matches a write to the live database — including,
as the coordinator discovered, a command that merely *quotes* such a path inside a heredoc.
Write prose through the Write tool, not through shell heredocs.

---

## C7 — THE DENOMINATOR RULING. Use 526 satisfiable days, not 495.

**Status: A3, MEASURED, with a falsification check. Supersedes §3 of the mission prompt and
the matching section of `BRIEF.md` for every agent from here.**

| figure | mission prompt / BRIEF | A3's ruling |
|---|---|---|
| structurally impossible days | 83 | **52** (proven) |
| **satisfiable-only denominator** | 495 | **526** |
| satisfiable-only compliance today | 385/495 = 77.8 % | **405/526 = 77.0 %** |
| all-days ceiling with a perfect solver | "near 88 %" | **91.0 %** (526/578) |
| satisfiable-only ceiling | — | **no *structural* ceiling below 100 %** |

**Two independent errors in the brief, not one.** Even taking 83 at face value, 495/578 =
**85.6 %**, not 88 % — "near 88 %" was never reproducible from the brief's own tier count.

**Why 83 was wrong:** `personas.mjs:248` builds IMPOSSIBLE from two constructions,
`weighted(r, [['every-protein-walled', 55], ['floor-vs-rate', 45]])`. Only the first is
unsatisfiable. `floor-vs-rate` landed **20 of its 30 days in band**.

**The ceiling decomposition, summing to 578** (A25 needs exactly this):

| bucket | personas | days | in band | rate |
|---|---|---|---|---|
| structurally impossible | 16 | 52 | 0 | 0.0 % |
| pool-limited | 20 | 140 | 83 | 59.3 % |
| solver-limited | 176 | 386 | 322 | 83.4 % |
| **TOTAL** | **212** | **578** | **405** | **70.1 %** |

**Caveat A3 states and no agent may drop:** the relaxation proves *impossibility* only,
never feasibility. "No structural ceiling below 100 %" does **not** mean 100 % is reachable —
both bounds ignore fat and carbs, and A2 measures 19 of 110 satisfiable-only misses binding
on exactly those.

**Open disagreements, logged not resolved — A24 adjudicates:**
- A2 restored 7 days (392/502 = 78.1 %); A3 restored 31 (405/526 = 77.0 %). A3's is the ruling.
- **A3 vs A11 on "pool-limited".** A3 counts 140 pool-limited days by a *pool-size vs slot-count*
  test. A11 counts **5 of 218 satisfiable personas (2.3 %)** by a *convex-hull reachability*
  test. These measure different things and the report must not present either as "the"
  pool-limited number without naming its test.
- **A3 vs A7 on the vegan tier.** A3 proves 52 days structurally impossible. A7 agrees the
  shortfall is real (27–33 % on whole foods) but argues it is a **library** wall, not botany —
  one authored concentrate row would clear it. Both can be true; the report must say which
  sense of "impossible" it means.

---

## C8 — Three different objectives are already live in one loop (A9). For A18.

- week selection: `mealSolver.js:127` `SCORE_WEIGHTS = { kcal: 0.46, protein: 0.3, fat: 0.12, carb: 0.12 }`
- per-slot gate: `KCAL_TOLERANCE_PCT = 0.15` (:67), `PROTEIN_TOLERANCE_PCT = 0.12` (:74) — **2 macros only**
- day verdict: `dayTolerance()` (:229-253) — **4 macros**

The `{kcal:1, protein:1, fat:0.1, carb:0.1}` figure the mission prompt attributes to
`solveGeneral` is a **different constant** from `SCORE_WEIGHTS`. A18 must establish which it
is actually sweeping and say so.

---

## C9 — The macro closer can only ADD, and the dominant failure is OVER band (A9)

`macroCloser.js` builds its gap list from shortfalls only (L130/L133/L135); `wouldHarm`
(L75-97) only ever *blocks* an addition. **No path in the module reduces anything.** Against
`weeklyPlanner.js:228-230`: fat was *"59% of failing days"*, and 74 days failed on fat alone,
*"every one of them OVER the band by a median of 49% of its midpoint."*

**The closer structurally cannot fix the largest single bucket.** The symmetric "trimmer" is
unbuilt and unpriced. A13 and A17 should both scope it; **A21 must not assume closer
expansion reaches over-band days.**

---

## C10 — What the ceiling work actually reframes: the binding constraint is the 0.5× FLOOR

A2, MEASURED. Of 70 bound-pinned missed days, **66 needed the day to be *smaller* and were
blocked at 0.5×; zero were blocked at the 2.0× ceiling alone.** The divergent
"625 g chicken with 2 g pine nuts" shape the mission prompt uses to reject widening is
**2.2 % of filled slots**.

The customer-acceptability objection to widening the *ceiling* is real and A5 corroborates it
from 80 years of diet-LP literature. **Neither is evidence about the floor.** A sub-0.5×
minimum is a different product question and has never been tested. A13/A21 should treat it as
an open, cheap experiment — and A24 should check that nobody quietly widened the ceiling
instead.

---

## C11 — A11: the corners are solver-limited, not pool-starved. Vegetarian is the exception.

**Only 5 of 218 satisfiable personas are pool-limited (2.3 %)** — 4 vegetarian, 1 carnivore.
Zero for keto, vegan, paleo, kosher, halal, mediterranean, none. **18 of the 23 all-population
pool-limited cases are engineered-impossible vegans** — counting them as an authoring signal
would aim the owner's money at customers the app should decline.

**A16 must not price a general recipe-authoring programme as the fix.** The measured authoring
target is vegetarian protein density (pool median **3.25 g/100 kcal** against a target median
of **8.16**). Keto has the *smallest* pool and the *highest* in-band density (29.0 %) — it is
solver-limited, and authoring keto recipes buys little.

**A11 contradicts the brief on which macro binds:** protein, not fat. Fat is the *tightest
band*; that is not the same as the *scarcest ratio*.

---

## C12 — A12: the grader is coherent; the **UI** is not. Zero points of the gap.

The grader/engine pair is jointly satisfiable for **250/250** profiles, so ruler incoherence
explains **0.0 points** of the 70.1 %. **The gap is real and must be explained by solver or
pool, not by the ruler.**

But three surfaces grade differently, and it is a customer-trust defect worth reporting:
fat is drawn as a **floor with no ceiling** while the grader fails it above ~77 g; calories,
carbs and protein-over show amber where the grader passes. `PlanTab` agrees with the grader
by construction; `TodayTab` does not. **Two screens can disagree about the same day.**

Also: `CARB_MIDPOINT_BUFFER_G = 25` means the macro midpoints sum ~89 kcal **below**
`targetKcal` — the solver spends 29 % of its kcal allowance before choosing anything. **A15
should score `CARB_MIDPOINT_BUFFER_G = 0` as a variant.**

---

## C13 — A latent style-gate leak exists. It is NOT a realized allergen leak. (A7)

`isExcluded(food, {dietaryStyle:'vegan'})` returns **false** for Squirrel, Groundhog,
Armadillo, Wild pig, Heart, Owl, Sea cucumber, Ceviche, Hog maws, Bear, Dove and an **Isopure
whey** row.

**Do not report this as breaking the "0 confirmed allergen leaks" property.** No recipe in the
910-recipe corpus contains these rows, so nothing leaked to any customer — the property holds
as measured. The exposure is that any surface gating *individual Food rows* — the macro
closer's adjuster pool is exactly one — could reach them.

**This bears directly on A17.** Widening the closer's gate is one of the levers under test, and
widening it into a pool with a known latent style leak is precisely the "raises compliance and
leaks" trade the integrity rules make an automatic fail. **A17 must check its widened candidate
set against this list before claiming any gain.**
