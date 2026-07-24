# QC10 — verify-the-verifiers

**VERDICT: PASS, no rubber-stamping found.** Every landed QC report reproduced raw. The
headline: the codebase was **patched mid-gauntlet** — commit `4a4c951` (15:09) *"close
step-prose + sweetcorn leaks; name the real binding cap (QC gauntlet)"* landed while I was
auditing, fixing QC01/QC02/QC05's exact findings. I caught the pre→post transition live and
verified both states. Method: read-only, scratch copy of dev.db, BRAIN=off, in-process boot on
ephemeral port. Scripts in `.qc-scratch-agent10/`.

## My own from-scratch spot-checks (all PASS)
- **3 allergens clean** (peanuts/shellfish/milk), re-derived with an INDEPENDENT keyword+metadata
  oracle (not the app matcher): 0 real leaks. 3 milk flags were my oracle's false-positives
  (Coconut Cream=plant, "Creamy" Aji=adjective+mayo). Corrected an initial circular check that
  reused the app's own matcher.
- **Free-text "gluten free"** → pool 889→433, 0 real gluten (Breadfruit = oracle FP).
- **Five-filter caps on the PRIMARY plans.js path**: `maxCostCad=3`→330, `=2`→235, `=1`→95
  (max survivor $0.99); `maxComplexity=3`→462. Cost/complexity independently recomputed on every
  survivor: **0 leaks**. A $1 cap never leaks a $5 recipe.
- **fdcCategory non-null = 13,516** (claim exact). Food 14,122 / Recipe 889 / RecipeIngredient 7,245.
- **Migrations = 25**; 6 new Recipe cols present+typed (costPerServing REAL … aiVerifiedBy JSONB);
  `Recipe_aiFingerprint_idx` present.
- **Integration reality check** — booted backend, POST `/api/plans/generate` (cookie session,
  shellfish+peanut allergy + `maxCostCad:4` + month): HTTP 200, matchPct 91, 4 weeks/124-of-140
  slots, **0 allergy leaks, 0 cost leaks**. Whole product in one call = compliant.

## Sampled QC claims re-run raw (>30%)
- **QC02** pools 7/7 exact (dairy 578/gluten 433/shellfish 808/soy 725/nightshades 472/redmeat
  669/nut 810 — pre-fix); P1 step-prose leak (Beef Mandi "ghee", Beef Banh Mi "butter") reproduced.
- **QC03/QC09** LlmUsage 12→12. **QC09** purity grep = 0 matches; seeded determinism byte-identical,
  different seed differs. **QC06** spans (month 28d/4win), resolveHorizon exact. **QC07** 6 cols/index/
  RI 7245/25 migs. **QC05** caps $1/2/3, cx3→462; binding-cap gap reproduced.
- **QC01 FAIL (sweetcorn P0)**: reproduced on pre-fix HEAD (leaked), now **FIXED** — `CATEGORY_SYNONYMS.corn`
  carries "sweetcorn"; Unicorn/Acorn correctly not over-excluded; 50+ runs deterministic.
- **QC08 BLOCKED**: honest (fresh-Chrome auth wall), not a false pass.

## Post-fix re-verification of `4a4c951`
Step-prose leaks CLOSED: Beef Mandi/Chicken Mandi/Beef Banh Mi (dairy) + Beef Mechado (sesame) now
excluded. `classifyBinding` now reads `stackExplain` (mealSolver.js:941) → names cost/complexity/taste.
Pools tightened correctly: dairy 578→550, gluten 433→391, corn 828→811 — deltas match the reported
leak counts. Caps unchanged (330/462). No vacuous/underpowered checks found; QC01/02/05 caught REAL
defects (now patched), QC03/06/07/09 reproduced exactly.

**Not re-run:** qc04 (monte-carlo) had not landed; qc08 unverifiable by design.
