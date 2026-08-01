# W2-1 — REPARTITION IN PRACTICE (online research)

*Persisted by the orchestrator (subagent harness blocks report-file writes). No source modified.*

Marks: `[SRC]` verified from cited source · `[CODE]` verified by reading this repo · `[JUDGE]` judgement · `[NO SOURCE]` looked, found nothing.

## 0. Bottom line

**Adopt an augmented Chebyshev goal program on tolerance-normalised band violations, solved by a hand-rolled ~120-line bounded search that scores on rounded grams, guarded by Pareto-dominance acceptance. Add no runtime dependency. Use YALPS (MIT, pure JS) as a test-only oracle.**

The decisive reason is not in the literature — it is in this repo:

> **Cut Protocol's accept rule is already a Chebyshev norm on tolerance-normalised deviations. It just never gets used as an objective.** `[CODE]`

`dayTolerance()` (`mealSolver.js:229-253`) computes each macro's deviation outside its band as a fraction of the band midpoint, then compares each against that macro's own tolerance (`DAY_KCAL_TOLERANCE_PCT` 0.15, `DAY_PROTEIN_TOLERANCE_PCT` 0.15, `DAY_FAT_TOLERANCE_PCT` 0.25, `DAY_CARB_TOLERANCE_PCT` 0.25, keto carb allowance 0). "Day in band" is `kcalOk && proteinOk && fatOk && carbOk`. Divide each deviation by its own tolerance and that predicate is **exactly** `max(v_kcal, v_protein, v_fat, v_carb) ≤ 1` — the weighted Chebyshev / MINMAX achievement function of goal programming with percentage normalisation. **The ruler is one `Math.max` away from being the objective.**

The shape appears a second time, already shipping, at the slot gate: `weeklyPlanner.js:628` computes `worstRatio = Math.max(kcalOff / KCAL_TOLERANCE_PCT, proteinShort / PROTEIN_TOLERANCE_PCT)` with the comment *"expressed as a multiple of each metric's own tolerance so the two different-scale percentages are comparable"* — the textbook definition of goal-programming normalisation, written independently in this codebase, over two macros. `[CODE]`

**So this is not a new paradigm: take the two-macro tolerance-normalised Chebyshev score the codebase already uses as its gate, extend it to four macros, and give it to the portioner as an objective instead of only as a pass/fail test.**

## 1. Is "tolerance-normalised residuals" a named technique?

**Yes, twice over — and the internal candidate has the right idea and (probably) the wrong norm.**

### 1.1 The name
In goal programming, dividing each deviational variable by a constant to make differently-scaled goals commensurable is **normalisation**, and it is mandatory: *"A normalization technique is required if goals are measured in different units… Deviational variables measured in different units summed up directly will cause an unintentional bias towards the objectives with a larger magnitude."* Named schemes: **percentage**, **Euclidean**, **summation**, **zero-one**. `[SRC]` — [Jones & Tamiz Ch. 2](https://beckassets.blob.core.windows.net/product/readingsample/603745/9781441957702_excerpt_001.pdf), [SCIRP survey](https://www.scirp.org/html/2-1040278_44149.htm)

Dividing by the **allowed half-width** rather than the target level is a variant whose normalisation constant is the tolerance. **No paper found naming that exact choice** `[NO SOURCE]`, but it is the same construction as the metrology normalized error `E_n = (x−X)/U` and as χ²/WLS with `w_i = 1/σ_i²` — and it makes the objective's level set at 1.0 coincide with the feasibility boundary. That coincidence is the whole point. `[JUDGE]`

The nearest published instance in this exact domain uses **target-level** normalisation: the 2026 MIGP meal-optimisation paper sets `w_m = 1/max(T_m, 1)` *"to convert each deviation into a fraction of target before summing, preventing calorie deviations from dominating."* `[SRC]` — [arXiv:2605.13849](https://arxiv.org/abs/2605.13849)

**Cut Protocol should not copy that.** Its four macros have *different* tolerances (0.15/0.15/0.25/0.25, keto carb = 0), so target-level normalisation would over-penalise fat and carb by ≈1.67× relative to the ruler and misprice keto entirely. `[JUDGE]` Note `compositionDistance()` (`weeklyPlanner.js:465-471`) currently normalises **by target level, not tolerance** — so this mismatch is live in the code today. `[CODE]`

### 1.2 The norm is what wls2 probably got wrong

| GP variant | Metric | Minimises | Character |
|---|---|---|---|
| Weighted / Archimedean | L₁ | Σ wₘdₘ | can sacrifice one goal wholesale |
| Lexicographic | ordered L₁ | priority levels | needs hard priority order |
| **Chebyshev / MINMAX** (Flavell 1976) | **L∞** | **max wₘdₘ** | *"balanced solutions instead of extreme solutions"* |

`[SRC]` — [Jones & Tamiz](https://beckassets.blob.core.windows.net/product/readingsample/603745/9781441957702_excerpt_001.pdf), [Mathematics 9(5):483](https://www.mdpi.com/2227-7390/9/5/483). And: *"The weighted Chebyshev objective function guarantees accessing all Pareto optimal points regardless of having concave or convex structure… Weighted-sum scalarization can only recover Pareto-optimal points on the convex hull."* `[SRC]` — [arXiv:2407.00359](https://arxiv.org/pdf/2407.00359)

**This is the mechanism for wls2's measured regression.** `[JUDGE, mechanism]` C1 reports wls2 = "4-macro tolerance-normalised" at **+14.74 pts** while **raising the warned-slot count**. A tolerance-normalised weighted-*least-squares* objective is L₂ — a **sum**. A sum will trade `v_fat: 0.9 → 1.2` for `v_kcal, v_protein, v_carb: 0.8 → 0.4` every time. But the accept rule is `max(v) ≤ 1`, so that trade turns a passing slot into a warned one **while the objective improves.** Points up, warnings up — exactly the reported signature. **An L∞ objective cannot make that trade by construction.**

Corroborating internal evidence: `scoreDay()`'s weighted-sum `err` (`mealSolver.js:177-181`) is retunable via `SCORE_WEIGHTS`, and C8 measured **0.00, b==c in 6/6 arms**. D5 says why — `dayTolerance()` (the L∞ predicate) is the actual selection key. **The codebase already ran the "tune the weighted sum" experiment and got nothing.** `[CODE + brief]`

### 1.3 Known failure mode of pure Chebyshev, and the cure
Pure L∞ returns **weakly** efficient points: once one goal is unavoidably the max, the others become invisible. This matters — B7 says only 6.2% of slots find anything within `COMPOSITION_GOOD_ENOUGH`, so a structurally-fatty recipe pinning `v_fat` at 1.8 would leave the other three unconstrained. Standard cure: **Steuer & Choo (1983) augmented weighted Tchebycheff**, `‖z‖^w_τ = ‖z‖^w_∞ + τ‖z‖₁`, which *"combines the advantages of the original approach… with the property that weakly nondominated points are avoided."* Hazard: *"a too small value of ρ may cause numerical difficulties while a too large value may lead to the oversight of some nondominated points."* `[SRC]` — [Dächert et al., C&OR](https://www.sciencedirect.com/science/article/abs/pii/S0305054812000470), [EJOR](https://www.sciencedirect.com/science/article/abs/pii/S0377221718304430)

**Recommended ρ = 0.05** `[JUDGE]` — large enough to break ties at float precision, small enough that no single-macro gain of 0.05·Δ pays for a worst-case increase. **Pin it in a test.**

## 2. The recommended formulation

### 2.1 One violation function, shared by gate / objective / guard
There are currently **three independent `bandMiss` transcriptions with different return units** — `mealSolver.js:218` (pct of midpoint), `macroCloser.js:53` (**grams**), plus the ad-hoc `kcalOffPct`/`proteinShortfallPct`/`compositionDistance` trio in `weeklyPlanner.js:420-471` — and a fourth error notion in `brain/optimizer.js:41-50`. `[CODE]` **That fragmentation is why the gate is 2-macro (B2) and why `wouldHarm`'s "no worse" rule (G4) was written against different units than the grader's.**

```js
// backend/src/lib/macroViolation.js — NEW, ~40 lines, pure, no deps. The single ruler.
// v_m = deviation outside macro m's band, in units of macro m's OWN tolerance.
//   v_m == 0 comfortably inside · v_m <= 1 inside the graded band · v_m > 1 warned
// NOT capped at 1. scoreDay()'s missTerm() saturates via Math.min(1, …) (mealSolver.js:161-162)
// — correct for a DISPLAY metric, fatal for an OBJECTIVE: past the line a saturated term
// has zero gradient, so the search gets no signal to pull a badly-over macro back.
function violations(dailyTarget, totals) {
  const pMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2;
  const rel = (v, lo, hi) => {
    const mid = (lo + hi) / 2;
    if (!(mid > 0)) return null;               // absent band = NOT JUDGED, never a silent 0
    if (!Number.isFinite(v)) return Infinity;  // E5: non-finite must be LOUD, not min-clamped
    return v < lo ? (lo - v) / mid : v > hi ? (v - hi) / mid : 0;
  };
  return {
    kcal: dailyTarget.kcal > 0
      ? Math.abs(totals.kcal - dailyTarget.kcal) / dailyTarget.kcal / 0.15 : null,
    protein: pMid > 0                                                 // ONE-SIDED (D3):
      ? Math.max(0, (pMid - totals.protein) / pMid) / 0.15 : null,    // overshoot costs ZERO
    fat:  scale(rel(totals.fat,  dailyTarget.fatLo,  dailyTarget.fatHi),  0.25, 0.25),
    carb: scale(rel(totals.carb, dailyTarget.carbLo, dailyTarget.carbHi), 0.25,
                dailyTarget.keto ? 0 : 0.25),  // keto over-allowance 0 -> HARD REJECT
  };
}
```

**The one-sided protein term is non-negotiable and is the second-most-important detail after the norm.** `[JUDGE, grounded in D3+B5]` D3 fixes the graded protein band as `≥0.85·pMid, one-sided, no ceiling`. B5 measures **50.9% of days over protein by >12%, unpenalised.** If the new objective penalises protein overshoot symmetrically — which any naive least-squares port does, and which `brain/optimizer.js:41-50` currently does — **the portioner will spend kcal and fat budget pulling protein down to a midpoint the grader does not care about, and will measure as a regression while looking "better balanced."** GP has the exact vocabulary: only the *unwanted* deviational variable enters the achievement function. `[SRC]` — [Cambridge 3E4 L6](https://www3.eng.cam.ac.uk/~dr241/3E4/Lectures/3E4%20Lecture%206)

### 2.2 The objective
```js
const RHO = 0.05;                     // augmentation (Steuer & Choo)
function achievement(v) {             // lower is better; <= 1 == accept
  const j = [v.kcal, v.protein, v.fat, v.carb].filter(x => x !== null);
  if (!j.length) return null;         // "no judged macro" must NOT read as a perfect score
  if (j.some(x => !Number.isFinite(x))) return Infinity;
  return Math.max(...j) + RHO * (j.reduce((a, b) => a + b, 0) / j.length);
}
```
If exact parity with `dayTolerance()` is needed for the golden, gate on `Math.max(...j) <= 1` and use `achievement` only to *rank*.

### 2.3 The solver
```
solvePortions(bundles, target, bands, bounds = {min:0.5, max:2.0}, materialise)
  // materialise : (x) -> totals computed from PRACTICAL, ROUNDED grams.  (K6)

  STAGE 1 — warm start (closed form, existing code, preserves k=2 golden parity):
    x0 = current Cramer solve on (kcal, protein), clamped.   weeklyPlanner.js:404-415
    Guard the degeneracy test — §5.1: raw |det| < 1e-6 is not scale-invariant.

  STAGE 2 — grid-aware coordinate descent on the REAL rounded-gram objective:
    grid_i = breakpoints of practicalGrams(baseGrams_j * x) over [0.5, 2.0]; precomputed, sorted, deduped
    best = materialise(x0); bestF = achievement(violations(target, best))
    for sweep in 0..1:                    // FIXED 2 sweeps, no convergence test
      for i in 0..k-1:                    // FIXED coordinate order
        for step in [-1, +1]:
          cand = materialise(x with x_i moved one notch)
          if achievement(violations(target,cand)) < bestF - 1e-12: accept
    Cost: <= 28 materialise() calls at k=7, 8 at k=2. Negligible vs the shortlist scan.
```

**Why coordinate descent, not gradient descent:** the objective is **non-smooth** (max of piecewise-linear terms) *and* evaluated on a **step function** (`practicalGrams`, `weeklyPlanner.js:308-312`). Gradients don't exist at the kinks and are identically zero between gram steps. **Direct search over the induced grid is the only thing both correct and deterministic here.** `[JUDGE]` Honest limitation: coordinate descent on a non-smooth convex function can stall. The claim is *never worse than the incumbent, usually much better* — the guard enforces the first half unconditionally.

### 2.4 The guard — the correct general form of `wouldHarm`

**Pareto-dominance ("filter") acceptance on the violation *vector*, with a margin.** `[SRC]` Fletcher & Leyffer's filter method is exactly this: *"trial points are accepted if they improve the objective function or improve the constraint violation instead of a combination… A pair (h_k,f_k) is dominated by (h_j,f_j) iff h_k ≤ h_j and f_k ≤ f_j."* `[SRC]` — [J. Math. Industry 6:9](https://mathematicsinindustry.springeropen.com/articles/10.1186/s13362-016-0029-1), [SIAM J. Optim.](https://epubs.siam.org/doi/10.1137/S105262340038081X)

Crucially, **pure non-dominance is not enough** — production filters require a sufficient-decrease margin so accepted points cannot creep onto the boundary; when the filter blocks every trial point the algorithm enters a **restoration phase** rather than forcing a step. `[SRC]` — [arXiv:2507.23054](https://arxiv.org/pdf/2507.23054), [IPOPT](https://cepac.cheme.cmu.edu/pasi2011/library/biegler/ipopt.pdf)

```js
const EPS = 1e-9, GAMMA = 1e-3;
function acceptRepartition(vBefore, vAfter) {
  let strictlyBetterSomewhere = false;
  for (const m of ["kcal", "protein", "fat", "carb"]) {
    const b = vBefore[m], a = vAfter[m];
    if (b === null || a === null) continue;
    if (!Number.isFinite(a)) return false;
    if (b <= 1 && a > 1) return false;   // (1) HARD: in band must STAY in band
    if (a > b + EPS)      return false;  // (2) MONOTONE on LEVELS — the line G4 is missing
    if (a < b - GAMMA) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;        // no free lateral moves
}
```

**What this fixes:** (1) **G4's hole.** `wouldHarm`'s `check()` returns `isOver && !wasOver` — it tests *band membership*, so an already-over macro can be pushed arbitrarily further over. The measured case (protein close pushing fat 95 → 100.2 g against 55–70) is *accepted* because `wasOver` was already true. **Comparing levels (`v_fat: 2.0 → 2.4`) catches it.** The docstring at `macroCloser.js:74` already says *"'No worse' is the whole rule"* — this is that rule, correctly implemented. (2) **It generalises** — one function guards the closer, the swap, the alternates, and the new portioner.

**Restoration analogue:** when `acceptRepartition` rejects everything, **do not loosen it.** Keep the incumbent and emit a diagnosis — the app's own constitution, and what the literature does. Stakes: unguarded repartition crashed an oracle metric **49 → 16.3**; guarded gained **9.8 → 26.0%**.

## 3. Library comparison

Sizes are npm `dist.unpackedSize` (installer payload), **not** minified+gzip. Dates from npm search API, 2026-07-31. `[SRC — npm registry API]`

| Library | Licence | Unpacked | Pure JS? | Determ. | Last pub. | Verdict | URL |
|---|---|---|---|---|---|---|---|
| **hand-rolled (recommended)** | — | 0 | yes | **yes by construction** | — | **ADOPT.** ~120 lines; only route that can score on *rounded* grams (K6); no licence/bundle risk; dissolves K7 by being the one implementation | — |
| **YALPS** | MIT | 240 KB | **yes** (1 dep `heap`) | yes for pure LP | 2025-12-24 | **TEST ORACLE ONLY.** ~16 vars / 12 rows. Cannot see `practicalGrams`; `"cycled"` status must be handled | [npm](https://www.npmjs.com/package/yalps) · [GitHub](https://github.com/Ivordir/YALPS) |
| javascript-lp-solver | Unlicense | 2.3 MB | yes | unstated | 2026-01-24 | **NO.** 10× YALPS for the same job | [npm](https://www.npmjs.com/package/javascript-lp-solver) |
| glpk.js | **GPL-3.0** | 2.5 MB | **no — WASM** | n/a | 2025-12-23 | **HARD NO.** GPL-3.0 in a distributed NSIS installer is a licensing decision, not a technical one | [npm](https://www.npmjs.com/package/glpk.js) |
| quadprog | MIT | 45 KB | yes | yes | 2026-06-25 | **NO, but close.** Goldfarb–Idnani needs a **strictly convex** Hessian; our objective is piecewise-linear. Also `engines: ">=24.x"` | [npm](https://www.npmjs.com/package/quadprog) |
| ml-matrix | MIT | 1.1 MB | yes | yes | maintained | **NO as a solver.** Maybe a test dep for §5.1's condition check | [npm](https://www.npmjs.com/package/ml-matrix) |
| nnls (mljs) | MIT | 66 KB | yes | yes | ~2023-10 | **NO — wrong constraint set.** NNLS is `x ≥ 0` only; **the upper bound 2.0 cannot be expressed at all** | [GitHub](https://github.com/mljs/nnls) |
| ml-levenberg-marquardt | MIT | 63 KB | yes | yes | 2026-07-31 | **NO.** Smooth LS fitter with a finite-difference Jacobian — **FD Jacobian is 0 between gram steps, undefined at kinks.** Wall-clock `timeout` = determinism hazard | [README](https://github.com/mljs/levenberg-marquardt) |
| fmin | BSD-3 | 189 KB | yes | NM deterministic | **0.0.4**, stale | **NO.** *"Unconstrained function minimization"* — **no box constraints** | [npm](https://www.npmjs.com/package/fmin) |
| numeric.js | MIT | — | yes | yes | **2012-12-20** | **NO. Abandoned 13 years.** | [npm](https://www.npmjs.com/package/numeric) |
| highs-solver | — | — | **no — native** | — | 2025-08-07 | **NO.** electron-rebuild, per-arch prebuilds | [npm](https://www.npmjs.com/package/highs-solver) |

### 3.1 There is no JS BVLS — and that is a real finding
The correct academic formulation for *"least squares with per-variable upper AND lower bounds"* is **BVLS** (Stark & Parker 1995), an active-set method using QR on the free set; SciPy exposes it as `lsq_linear(method='bvls')`. For n ∈ [3,7] that's 3–7 tiny solves — theoretically ideal. `[SRC]` — [Stark & Parker](https://www.stat.berkeley.edu/~stark/Preprints/bvls.pdf), [SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.lsq_linear.html)

**I searched npm for a JavaScript BVLS / box-constrained least-squares package and found none.** `[SRC — npm registry search API, 2026-07-31]` So *"just use the standard algorithm from a library"* is **not available in this ecosystem**, which removes the main argument against hand-rolling. And BVLS is L₂ anyway, so it would still make the wls2 trade. **Don't hand-port BVLS either** — it optimises on *continuous* x: a mathematically exact answer to the wrong question, at 4× the code. `[JUDGE]`

### 3.2 The runtime-LP option, and why I reject it
The augmented Chebyshev GP **is** an LP (`n+9` variables, ~12 rows); YALPS solves it in microseconds. **Still recommend against at runtime:**
- **Decisive (K6):** an LP optimises over **continuous** x. The shipped plate is `practicalGrams(baseGrams × x)` — 5 g steps above 20 g, 1 g below — and composition is **2–10× more rounding-sensitive than calories** (carb p95 **6.15%**, max **63.2%**). **The LP's certified optimum is an optimum of a function the user never eats.** The MIGP paper measures exactly this: MIGP vs solve-then-round — median objective **0.1410 vs 0.5286 (3.8× worse)**, max deviation **6.3% vs 21.6%**, MIGP strictly better in **66%** of 810 instances and *never* worse. `[SRC]` — [arXiv:2605.13849](https://arxiv.org/html/2605.13849)
- **Strong:** a dependency doesn't solve K7, adds a licence surface, and adds a `"cycled"` failure path.

### 3.3 The right use of YALPS: a test-only oracle
`devDependencies` only. Build the LP, solve it, assert the runtime coordinate-descent result is within a fixed bound of the LP optimum on a corpus of real targets. **That certifies without shipping the solver, and it is a real quality axis — unlike the current golden, which K8 correctly calls theatre.** `[JUDGE]`

## 4. The Stigler lesson — and why it disqualifies the obvious fix

Stigler's minimum-cost subsistence diet was an LP whose answer was wheat flour and navy beans — *"nothing but absurd and disgusting solutions."* `[SRC]` — [Recht](https://www.argmin.net/p/dietary-shapes), [Garille & Gass, OR 49(1)](https://pubsonline.informs.org/doi/pdf/10.1287/opre.49.1.1.11187). The review literature says the cure is added constraint classes and is honest that the hardest is unsolved: *"Introducing acceptability constraints is recommended, but no study has provided the ultimate solution to calculating acceptability."* `[SRC]` — [Gazan et al., PMC6021504](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6021504/)

**Cut Protocol's `[0.5, 2.0]` bounds on a *recipe* ARE its acceptability constraint**, and the two-knob structure deliberately restricts the free variables so the dish stays a dish. `[CODE]` **The MIGP paper's formulation — integer serving counts on individual foods — dissolves that:** it would happily ship 400 g chicken and 5 g rice from a "Chicken and Rice" recipe. `macroCloser.js`'s own header records the customer verdicts on exactly that: *"625 g chicken with 2 g pine nuts", "13 g of cabbage inside a cabbage stew", "465 g of egg white", "105 g of rosemary."* `[CODE]`

**Take the paper's goal-programming skeleton and its round-aware finding; reject its decision-variable choice.** Round-awareness must come from *evaluating* on rounded grams, not from making grams the decision variables.

## 5. Numerical-safety checklist

### 5.1 Degeneracy — the raw determinant is the wrong test `[SRC]`
`weeklyPlanner.js:407` and `brain/optimizer.js:63` both branch on `Math.abs(det) < 1e-6`, where `det = P.protein·R.kcal − R.protein·P.kcal` — a **scale-dependent absolute** threshold on a product of ~10¹ × ~10³. `[CODE]`

> *"The determinant is a flawed measure of how close a nonsingular matrix is to being singular, not least because of the sensitivity of the determinant to scaling."* `[SRC]` — [Higham](https://nhigham.com/2021/06/22/what-is-the-determinant-of-a-matrix/), [condition number](https://nhigham.com/2020/03/19/what-is-a-condition-number/)

Wrong in both directions: a 30 kcal / 1 g-protein garnish against a 600 kcal side gives `|det|` in the hundreds — passes — while numerically useless. A tiny recipe gives `|det| ≈ 4` — also passes, garbage solve. **And converting kcal→kJ multiplies `det` by 4.184, silently changing which recipes take the degenerate branch.**

**Fix:** test the reciprocal condition number after column equilibration, or the scale-free surrogate `|det| / (‖col₁‖₂·‖col₂‖₂) < 1e-3`. Both dimensionless. Log which branch fired.

### 5.2 Bounds
- ✅ Coordinate descent starts inside and only moves to in-box grid points.
- ⚠️ **`clamp()` returns `min` on non-finite input** (`weeklyPlanner.js:294`, `brain/optimizer.js:21`) — E5's silent-miss vector: an *infinite* ask yields the *smallest* plate with `warning: null`. **Change the contract to `{ ok:false, reason }`.**
- ⚠️ `Math.max(...[])` returns `-Infinity`. Guard "no judged macro" explicitly.
- ⚠️ **Keto carb over-allowance is 0** → division yields `Infinity`. Represent as a **hard reject**, never an infinite objective term.
- ℹ️ Slot gate uses `PROTEIN_TOLERANCE_PCT = 0.12` (`weeklyPlanner.js:74`); day grading uses `0.15` (`mealSolver.js:211`). Not a bug — but the shared function must take tolerance as a parameter. `[CODE]`

### 5.3 Rounding — score on rounded grams, always `[SRC + K6]`
- The objective **must** be evaluated on `applyScales()`'s output (`weeklyPlanner.js:334-357`), never on `x · baseMacros`.
- **Grid must be deterministic and precomputed** — union of `x = g/baseGrams_j`, sorted with a stable tiebreak, deduped with fixed epsilon. Never rely on default `Array#sort` of near-equal floats.
- **Do not change `practicalGrams`'s 1 g floor.** Its comment records that plain `Math.round` sent **4.3%** of shipped ingredients to 0 g — an ingredient vanishing from plate and grocery list while the card still names it. `[CODE]`

### 5.4 Determinism `[K4]`
No `Math.random`/`Date.now`/`performance.now`/locale-dependent sort. **Fixed iteration counts, not convergence tests** (`while (improvement > tol)` is a float-order-dependent trip count). Enumerate a literal `["kcal","protein","fat","carb"]`, never `Object.keys`. ⚠️ K4: the purity test greps `Math.random(` **as a call**; `mealSolver.js:461`, `:823`, `:1358` evade it with bare references — **rewrite the test to catch bare identifiers.**

### 5.5 Two independent bugs found while reading `[CODE]`

**(a) `brain/optimizer.js:91` — the projected-gradient step size can diverge.** `solveGeneral` uses `lr = 1/(2·maxCol)` where `maxCol` is the largest **column** energy (the largest **diagonal** of `AᵀWA`). For `f(x)=‖Ax−b‖²_W` the gradient's Lipschitz constant is `L = 2·λ_max(AᵀWA)`, needing step `< 1/λ_max`. `[SRC]` — [UBC CPSC 540 L4](https://www.cs.ubc.ca/~schmidtm/Courses/540-W18/L4.pdf), [CMU 10-725 L5](https://www.cs.cmu.edu/~ggordon/10725-F12/scribes/10725_Lecture5.pdf). Since `λ_max` can reach `n·maxDiag` for correlated columns — **and meal-recipe columns ARE strongly correlated, because every recipe has large positive kcal** — the step can exceed the stability limit by up to n×. At k=7 that's ~3.5× too large. It won't blow up (the box clamp catches it); **it will oscillate between bounds and return a bad point silently** after its fixed 200 iterations. Safe: `1/(2·n·maxCol)`, or delete `solveGeneral` in favour of the shared routine.

**(b) `brain/optimizer.js:42` — the default weights are the wls2 mistake, pre-made.** `{kcal:1, protein:1, fat:0.1, carb:0.1}` applied to **raw squared** gram/kcal errors. A 10% kcal miss on 2000 kcal contributes `1×200² = 40,000`; a 10% fat miss on 60 g contributes `0.1×6² = 3.6`. **Fat is down-weighted by ~4 orders of magnitude.** The comment calls fat/carb *"included at low weight"* — it is not low weight, it is **structural invisibility**, and it is **B3 reproduced in the second transcription.**

## 6. What this changes for Cut Protocol

**6.1 It makes B3 impossible by construction, not by tuning.** Under the recommended objective, fat and carb enter `achievement()` with the same status as kcal and protein. Two targets differing on fat now produce different objective values at the same x. **Regression test = B3's experiment, asserting the difference is nonzero on ≥95% of non-degenerate pairs.**

**6.2 It converts B4's clamp into a solve, and the guard makes it safe.** Stage 2 searches the box directly, so the clamped point is only a starting guess. **13.7% is the honest ceiling on slot-level recovery — do not promise more.** The negative-bundle 22.5% is the strongest evidence the 2×2 is answering a question with no physical solution.

**6.3 It predicts wls2's +14.74 without the warned-slot regression — and that is falsifiable.** C1's arm and this recommendation differ in exactly one place: **L₂ sum vs augmented L∞.** If §1.2's mechanism is right, an L∞ arm should reproduce most of +14.74 *and* leave warned slots flat or lower. **If a measured L∞ arm also raises warned slots, the whole mechanism is wrong** and the cause is elsewhere (most likely composition-driven recipe *selection*, i.e. B7). **Run both arms.**

**6.4 The 0.5× floor: do not move it yet — and here is the measurement that decides it.**
*For:* 66 of 70 bound misses at the floor · C4 `floor25` **+5.22 marginal** · `macroCloser.js` header: **68.3%** of missed slots pinned at a bound · B8: 0–150 kcal slots **32.0% unsolved**, median fat **+108.1%**.
*Against:* C4 ships **35.5% of slots below the old floor**, **single seed** · **nobody has rendered the plates** · `macroCloser.js`'s header carries the *only* plate-realism data anyone has — real customer rejections of *"13 g of cabbage inside a cabbage stew"* and *"105 g of rosemary"* — **produced at a 0.5× floor.** At 0.25× that class gets strictly more common. `[CODE]`

**Recommendation, three parts `[JUDGE]`:**
1. **Ship the Chebyshev portioner first, then re-measure floor-pinning.** C4's +5.22 was measured *atop wls2*, an L₂ arm whose behaviour is to drive kcal down hard. **The floor's marginal value is very likely smaller after the portioner lands.** One arm settles it.
2. **If the floor moves, move it as a gram invariant, not a scale constant.** Allow `sidesScale` below 0.5 **only while every affected ingredient's shipped grams stay above a recognisable-portion floor** (candidate: `max(15 g, 0.30 × baseGrams)`). That turns "35.5% below the old floor" from an unmeasured risk into a per-ingredient assertion a test can hold — and respects the refusal to widen `SCALE_BOUNDS` by not touching the constant.
3. **Run the measurement nobody has run.** Render `floor25`'s 35.5% of below-floor slots as actual gram lists; count slots containing an ingredient below the recognisable floor. **Hours of work, decisive. Until it exists, C4 is not shippable** — not because the points are wrong, but because the risk it takes has literally never been measured.

**6.5 It gives the closer the symmetric partner G1 says is missing.** Against B1's near-total overshoot, an add-only closer aims at the wrong tail. **The recommended portioner is the subtractive lever the closer structurally cannot be.** Also G6 (all adjusters on slot 0, 353 g → 922 kcal) is a repartition-shaped bug that `acceptRepartition` catches: appending 622 kcal raises `v_kcal`, failing componentwise non-worsening whenever kcal binds.

**6.6 It dissolves K7 instead of tripping over it.** One implementation consumed by both call sites ⇒ k=2 parity becomes an identity rather than an assertion. **Sequence deliberately:** land the shared module with the Cramer path byte-identical (Stage 1 alone), verify the golden, **then** enable Stage 2 behind a flag.

## 7. Risks / where I'd be wrong

1. **§1.2's mechanism is inference, not measurement.** wls2's source was never seen (C1: "not on disk"). "wls2 = weighted **least squares** = L₂" is inferred from its name and the reported signature. **If wls2 was already L∞, the central recommendation collapses to "wls2, re-measured"** and the regression needs a different explanation. **First action for any implementer: find out what norm wls2 used. That one fact is worth more than the rest of this report.**
2. **Coordinate descent may stall.** Acceptable because the guard makes stalling *safe* rather than *wrong*.
3. **The grid may be larger than assumed** — breakpoints were not enumerated on the real library. A 150 g ingredient at 5 g steps gives ~45 breakpoints; ~8 ingredients could union to a few hundred per coordinate, so "one notch" may under-travel. **Mitigation:** geometric ladder (±1, ±2, ±4, ±8). Unmeasured. `[JUDGE]`
4. **B7 may swamp everything.** If the shortlist has no composition-feasible dish, a better portioner optimises inside an empty box. Honest expected ordering then: **C3 (pool enrichment) > C1 (portioning) > C4 (floor)** — and F5's starving snack slot is a supply problem no optimiser solves.
5. **The guard is strictly conservative and will refuse real gains.** Componentwise non-worsening rejects "fat 2.4 → 1.1 at the cost of carb 0.2 → 0.4" — a trade most people would take. Deliberate, given the measured 49 → 16.3 crash. If the guarded arm measures *below* +9.8, `GAMMA` and the already-out-of-band case are the first knobs — **not** the in-band rule, which is constitutional.
6. **A5 may make this unmeasurable at the margin.** The *difference* between L₂ and L∞ arms may not clear 3.5 pts. **Design the A/B as paired-slot warned-count deltas, not just days-in-band**, or you will not see the thing this report is about.
7. **Licence claims are npm metadata, not legal review.**

## 8. Sources

[Stark & Parker BVLS](https://www.stat.berkeley.edu/~stark/Preprints/bvls.pdf) · [MIGP meal optimisation arXiv:2605.13849](https://arxiv.org/abs/2605.13849) · [Jones & Tamiz Ch.2](https://beckassets.blob.core.windows.net/product/readingsample/603745/9781441957702_excerpt_001.pdf) · [Fletcher & Leyffer Filter-SQP](https://epubs.siam.org/doi/10.1137/S105262340038081X) · [Nonmonotone flexible filter](https://mathematicsinindustry.springeropen.com/articles/10.1186/s13362-016-0029-1) · [IPOPT](https://cepac.cheme.cmu.edu/pasi2011/library/biegler/ipopt.pdf) · [Dächert augmented Tchebycheff](https://www.sciencedirect.com/science/article/abs/pii/S0305054812000470) · [EJOR modified augmented](https://www.sciencedirect.com/science/article/abs/pii/S0377221718304430) · [Garille & Gass Stigler](https://pubsonline.informs.org/doi/pdf/10.1287/opre.49.1.1.11187) · [Gazan LP diet review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6021504/) · [arXiv:2407.00359](https://arxiv.org/pdf/2407.00359) · [arXiv:2507.23054](https://arxiv.org/pdf/2507.23054) · [Mathematics 9(5):483](https://www.mdpi.com/2227-7390/9/5/483) · [SCIRP GP survey](https://www.scirp.org/html/2-1040278_44149.htm) · [Cambridge 3E4 L6](https://www3.eng.cam.ac.uk/~dr241/3E4/Lectures/3E4%20Lecture%206) · [Recht Dietary Shapes](https://www.argmin.net/p/dietary-shapes) · [Higham determinant](https://nhigham.com/2021/06/22/what-is-the-determinant-of-a-matrix/) · [Higham condition](https://nhigham.com/2020/03/19/what-is-a-condition-number/) · [UIUC CS357](https://cs357.cs.illinois.edu/textbook/notes/condition.html) · [CMU 10-725 L5](https://www.cs.cmu.edu/~ggordon/10725-F12/scribes/10725_Lecture5.pdf) · [UBC CPSC 540 L4](https://www.cs.ubc.ca/~schmidtm/Courses/540-W18/L4.pdf) · [SciPy lsq_linear](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.lsq_linear.html) · [Bemporad BVLS/QR](http://cse.lab.imtlucca.it/~bemporad/publications/papers/ieeetac-bvls.pdf)

**No source found for:** a published paper naming "divide each residual by its own tolerance half-width" as a distinct technique · a JavaScript BVLS/box-constrained LS npm package · a public engineering writeup from a shipping consumer nutrition app describing its portioning solver.

**Repo files read:** `weeklyPlanner.js` (:58,:67,:74,:270-471,:620-676) · `mealSolver.js` (:140-253) · `macroCloser.js` (:1-108) · `brain/optimizer.js` (whole file).
