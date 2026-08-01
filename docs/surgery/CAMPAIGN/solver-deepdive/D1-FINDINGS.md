# D1 — the portioning solve: complete specification, discarded freedoms, and the constraints on a fix

*Agent D1. Territory: `backend/src/lib/weeklyPlanner.js`, recipe-scaling math only.
READ-ONLY. All measurements run against a byte-identical copy of `backend/prisma/dev.db`
(`md5 1f761e43a5cf7cfa31e1319fa997b0b7`, 910 recipes / 7,119 ingredient rows) at
`docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db`. Scripts in the same directory.
Every claim is labelled **MEASURED** (I ran it), **DERIVED** (computed from a measurement),
or **INFERRED** (read from code).*

**Independence note (per the verification-shape warning).** The linear algebra below was
re-derived with my own Gaussian elimination with partial pivoting, my own bundle summation,
and my own transcription of the practical-gram rule. `scaleRecipe` was invoked only *after*
the fact, to confirm my independently-computed pipeline reproduces its shipped grams.
It does: **600/600 gram vectors identical, max kcal difference 2.27e-13** (MEASURED,
`D1-algebra.mjs`). Where I use the solver's own tolerance constants I am measuring headroom
*against the shipping acceptance rule*, not verifying a behaviour with its own helper.

---

## LEAD RESULTS

1. **The portioning solve is provably blind to fat and carbs.** 207/207 one-recipe slots
   resolved to **byte-identical grams** under diametrically opposite fat/carb asks; max fat
   difference **exactly 0**. `scaleRecipe.length === 3`. (MEASURED.) C23/A13's claim is
   **VERIFIED** — but its file:line is wrong and would misdirect a builder (see §8).
2. **A second, independent defect sits on top of it: the clamp is not a solve.**
   `weeklyPlanner.js:413-414` clamps each coordinate of the *unconstrained* exact solution
   independently. On plausible (recipe, slot) pairs the exact solution lies outside the box
   **77.5 %** of the time, and in **94.8 %** of those the clamped point is *strictly worse than
   another point inside the same box, on the solver's own accept rule*. **13.7 % of all
   plausible pairs (362/2,636) had a feasible in-gate point and the clamp missed it.**
   (MEASURED, `D1-clamp.mjs`.) This is a defect at fixed bounds, fixed objective, fixed gate.
3. **A one-knob back-substitution recovers most of it, with zero regressions and no wider
   portions.** Pinning the violated knob and re-solving the free one for calories moves the
   per-pair in-gate rate **35.81 % → 42.91 %** (box optimum is 47.44 %), **83 rescues / 0
   regressions**, knob-spread >4× stays at **0**, and floor-resting knobs *fall* 586 → 542.
   (MEASURED, `D1-fix.mjs`.)
4. **Why the floor binds and the ceiling does not — the missing mechanism.** `proteinShortfallPct`
   (`:426-428`) is one-sided. A floor-pinned (over-sized) portion is over on protein **89.3 %** of
   the time and **50.9 % of the time is over by more than the 12 % tolerance and pays nothing
   for it**. Floor-pinned candidates clear the gate **37.3 %** of the time vs **26.6 %** for
   ceiling-pinned. The solver therefore *systematically selects over-sized portions*, whose
   median fat lands **+74.5 %** above a 28 %-of-kcal ask (ceiling-pinned: −23.9 %). (MEASURED,
   `D1-asym.mjs`.) This is the causal chain behind A15's 42/42, A17's 97-OVER/1-SHORT and
   A19's 83/83.
5. **A silent-miss vector.** A non-finite scale falls to `min`, i.e. **0.5, not 1**
   (`:294`). A zero or absent target therefore **ships a half portion and reports
   `warning: null`** (MEASURED, `D1-probe.mjs`) — a constitution violation ("silent target
   misses are forbidden"), reachable today from `brain/tools.js:74` whose tool schema
   (`brain/selector.js:13`) requires only `recipeId`.

---

## §1 — COMPLETE SPECIFICATION OF THE CURRENT PORTIONING MATH

### 1.1 Inputs

`scaleRecipe(recipe, kcalTarget, proteinTarget)` — `weeklyPlanner.js:394`. Three scalars.
There is no fourth or fifth parameter and no options object (INFERRED; arity confirmed
MEASURED = 3).

`recipe.ingredients[]` rows carry `baseGrams` (Float), `scalable` (Boolean, default true),
`role` (String?, nullable), and an included `food` with per-100 g `kcal / protein / fat / carb`
(`prisma/schema.prisma:437-454`).

Census (MEASURED, `D1-algebra.mjs`):

| | count | share |
|---|---|---|
| ingredient rows | 7,119 | — |
| `scalable = false` | 1,455 | 20.44 % |
| `role = null` | 2,469 | 34.68 % |
| `role = "protein"` | 851 | 11.95 % |
| `role ∈ {carb, veg, fat, dairy, other, fruit}` | 3,799 | 53.36 % |
| recipes with ≥1 non-scalable ingredient carrying kcal | 707 / 910 | 77.69 % |

Cached `recipe.kcal` is trustworthy: max drift vs the ingredient sum is **0.19 %**, zero
recipes above 1 % (MEASURED). The degenerate branch's reliance on it is therefore not a
data-integrity risk — its problem is structural (§2, D3).

### 1.2 The three-bundle decomposition (`:395-400`)

```
F = Σ  over ingredients with scalable == false          (never moves)
P = Σ  over scalable ingredients with role === "protein"
S = Σ  over scalable ingredients with role !== "protein" (INCLUDING role === null)
```

each a 4-vector `{kcal, protein, fat, carb}` summed as `food.macro × baseGrams / 100`
(`bundleMacros`, `:314-326`). Note `role !== "protein"` — the 2,469 null-role rows and every
`carb/veg/fat/dairy/other/fruit` row land in **one** bundle. The recipe's whole macro
vocabulary is collapsed to a **binary**.

### 1.3 The system it solves (`:402-414`)

Two unknowns `p` (proteinScale) and `s` (sidesScale). The shipped continuous model is

```
F.kcal    + p·P.kcal    + s·S.kcal    = kcalTarget
F.protein + p·P.protein + s·S.protein = proteinTarget
```

i.e. after moving the fixed bundle to the right-hand side (`:402-403`)

```
[ P.protein  S.protein ] [p]   [ proteinTarget − F.protein ]   [rp]
[ P.kcal     S.kcal    ] [s] = [ kcalTarget    − F.kcal    ] = [rk]
```

with `det = P.protein·S.kcal − S.protein·P.kcal` (`:404`) and the Cramer solution
(`:413-414`)

```
p = ( rp·S.kcal − S.protein·rk ) / det
s = ( P.protein·rk − rp·P.kcal ) / det
```

**This is a SQUARE system, not an optimisation.** It has no objective function and no
residual. When the solution is inside the box it hits calories and protein **exactly** —
verified independently: my Gaussian elimination agrees to **3.99e-14** relative over 400
random pairs, 0 disagreements, and the unclamped continuous mix hits both targets to
**1.26e-14** relative (MEASURED). Fat and carbohydrate are then **fully determined** — there
is no residual freedom to steer them *at the exact point*. (DERIVED. This matters: "carry the
composition target into the solve" is necessarily a change of **objective**, not the passing
of a spare argument. See §2 D1 and §7 C4.)

### 1.4 Every branch

**Branch A — degenerate (`:407-411`).** Taken when `proteinIngs.length === 0 || |det| < 1e-6`.

```
raw = recipe.kcal > 0 ? kcalTarget / recipe.kcal : 1
p = s = clamp(raw, SCALE_BOUNDS)
```

Coverage: **204 / 910 = 22.42 %** of recipes — 200 with no protein-role scalable ingredient
plus 4 det-degenerate (MEASURED; exactly reproduces A13 §4's 204/910 by an independent path).
Note the divisor is **`recipe.kcal`, the whole dish**, while the non-degenerate branch nets
out `F`. This is inconsistent and wrong; magnitude in §2 D3.

**Branch B — non-degenerate (`:413-414`).** Cramer as above, each coordinate clamped
independently.

**Branch C — there is no third branch.** `proteinIngs.length === 0` and "no scalable
ingredients at all" are *not* distinguished. Measured: **0 of 910 recipes have zero scalable
ingredients**, so the `S.kcal == 0 && P.kcal == 0` division-by-zero path is currently
unreachable in this library (MEASURED) — but nothing in the code guarantees it, and the
degenerate branch's `recipe.kcal > 0 ? … : 1` guard is the only protection.

### 1.5 `clamp` semantics (`:294`) — including the non-finite rule

```js
const clamp = (v, { min, max }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
```

The non-finite fallback is **`min`**, not `1` and not a rejection. Measured:
`clamp(NaN) = clamp(Infinity) = clamp(-Infinity) = 0.5`. Consequences, all MEASURED
(`D1-fix.mjs` / `D1-probe.mjs`), on a real recipe:

| input | proteinScale | sidesScale | shipped | warning |
|---|---|---|---|---|
| normal (600 kcal / 45 g) | 1.65 | 2 | 389 kcal | — |
| `proteinTarget = NaN` | **0.5** | **0.5** | 122 kcal | present |
| `proteinTarget = undefined` | **0.5** | **0.5** | 122 kcal | present |
| `kcalTarget = NaN` | **0.5** | **0.5** | 122 kcal | present |
| `kcalTarget = 0, proteinTarget = 0` | **0.5** | **0.5** | 1091 kcal | **`null`** |
| `kcalTarget = Infinity` | **0.5** | **0.5** | 122 kcal | — |

The zero-target row is the serious one: `kcalOffPct` (`:420-422`) and `proteinShortfallPct`
(`:426-428`) both return `0` when `target <= 0`, so `worstRatio` is 0, the slot passes the
gate at `:630`, and a **half portion ships as a perfect fit with `warning: null`**. An
infinite ask produces the *smallest* plate — the sign is inverted.

### 1.6 Materialisation — `applyScales` (`:334-357`)

```js
const scale = !ing.scalable ? 1 : ing.role === "protein" ? proteinScale : sidesScale;
grams = practicalGrams(ing.baseGrams * scale);            // :339
```

Totals are then **recomputed from the rounded grams** (`:343-354`), so the shipped macros
always match the shipped plate — this part is honest and must be preserved. The returned
`proteinScale` / `sidesScale` are `round2()`'d **labels** (`:356`); the grams come from the
**raw** factors. Label and factor are therefore not the same number.

`practicalGrams` (`:308-312`): `≥20 g → nearest 5 g`; `<20 g → max(1, round)`. The 1 g floor
is a deliberate honesty rule, but it is also a **hidden portion floor**: **155 / 910 recipes
carry a scalable ingredient whose 0.5× amount rounds up** (190 rows), so those ingredients
cannot shrink at all. 2,087 of 105,225 scalable-ingredient evaluations (**1.98 %**) are
inflated this way; **0** are rounded to zero (MEASURED).

### 1.7 The only downward search — `enforceScaledCarbCeiling` (`:377-391`)

```js
if (!dietaryStyle) return scaled;
if (!recipeExceedsKetoCeiling({carb, kcal}, dietaryStyle)) return scaled;
for (let s = scaled.sidesScale - 0.05; s > SCALE_BOUNDS.min; s -= 0.05) { … }   // :385
const floorTry = applyScales(recipe, scaled.proteinScale, SCALE_BOUNDS.min);    // :389
return over(floorTry) ? null : floorTry;                                        // :390
```

Properties, enumerated (MEASURED, `D1-freedom.mjs` §H):
- Step 0.05, strict `>` bound. Max 29 iterations (from 2.0). **Never emits a value below
  0.5**; float drift is confined to the last step (0.5499999999999987) and is cosmetic
  because `applyScales` consumes the raw factor.
- Starting from `sidesScale ≤ 0.55` the loop body executes **zero times** and control goes
  straight to the explicit floor try. Correct, but means the "search" is a no-op for
  already-small portions.
- It is **keto-only**: `dietaryFilter.js:1866` returns `false` unless
  `dietaryStyle === "keto"`. Confirmed MEASURED — the guard is object-identical inert for
  `null` and for `"vegan"`. So the file's one trimmer serves ~1 of 9 diet styles.
- **It re-applies with `scaled.proteinScale` — the round2'd LABEL, not the raw factor**
  (`:386`, `:389`). 2.33 % of sampled plates change kcal when re-applied this way, median
  drift 6 kcal, max 14.95 kcal (MEASURED). The trimmed portion is therefore not continuous
  with the untrimmed one.
- It **refuses rather than ships over** (`:390` returns `null`), which `resolveSlot:622`
  counts and names honestly at `:673-675`. That refusal shape is the correct template.

### 1.8 Where it is called

| call site | what is passed | what is in scope but not passed |
|---|---|---|
| `:621` (`resolveSlot`, the shipping path) | `target.kcalTarget, target.proteinTarget` | `target.fatShare`, `target.carbShare`, `target.fatTarget`, `target.carbTarget` |
| `:503` (`finishAiSlot`) | same | same |
| `mealRouter.js:84` | same | same |
| `routes/plans.js:666` (fill-today-from-cart) | same | target has no fat/carb |
| `brain/tools.js:77` | `kcalTarget, proteinTarget`, **both optional** | — |

---

## §2 — EVERY POINT WHERE A DEGREE OF FREEDOM IS DISCARDED

### D1 — the fat/carb budget dies at the call site, not in `scaleRecipe`. MEASURED.

`solveDay` **computes** the composition target: `fatShare`/`carbShare` at `:898-899`, then
the carry-forward `fatTarget`/`carbTarget` at `:930-931`. That object is passed to
`resolveSlot` as `target`. `resolveSlot:621` then calls
`scaleRecipe(recipe, target.kcalTarget, target.proteinTarget)` — **two of the four fields
are read and two are dropped**. The surviving pair is used only to *rank candidates already
portioned* (`compositionDistance`, `:465-471`; the draw bias, `:251-272`).

**Proof it is total, not partial** (MEASURED, `D1-freedom.mjs` §F): 250 trials, one-recipe
pool so selection cannot confound, two targets identical on kcal/protein and opposite on
fat/carb (`fatTarget 0.1 / carbTarget 60` vs `fatTarget 60 / carbTarget 0.1`).
**207/207 resolved slots produced identical gram vectors. Max fat difference: 0.**

**Size of the discarded freedom** (MEASURED, `D1-freedom.mjs` §I; grid 0.025 over the box,
keeping only points that pass the shipped kcal+protein gate). Of 740 plausible pairs, 341 had
≥1 feasible point and only **3 had exactly one**:

| | median | p90 | median relative to its own midpoint |
|---|---|---|---|
| achievable **fat** range | **4.55 g** | 17.38 g | 25.3 % |
| achievable **carb** range | **24.74 g** | 64.42 g | 63.9 % |

**Steering available without leaving the gate** (MEASURED, `D1-clamp.mjs` §K; practical
rounding applied; only slots whose exact solve *already passes* the gate, and the alternative
must also pass it): 359 of 368 (**97.6 %**) have a strictly better in-gate point.

| | current | best in-gate | |
|---|---|---|---|
| fat absolute error, mean | 9.52 g | **6.95 g** | −27 % |
| fat absolute error, median | 7.86 g | **5.33 g** | −32 % |
| carb absolute error, mean | 19.28 g | **11.51 g** | −40 % |
| carb absolute error, median | 14.19 g | **0.87 g** | −94 % |
| composition distance, mean | 0.416 | **0.282** | −32 % |

This is the *constrained* version of A13's lever and it is the important refinement:
**because every alternative point is required to pass the kcal/protein gate, it cannot raise
the warned-slot count** — which is exactly the cost A13's unconstrained `wls2` paid
(341 → 405 warned slots, C23).

### D2 — coordinate-wise clamping of an unconstrained solution is not a constrained solve. MEASURED. *(new)*

`:413-414` clamps `p` and `s` **independently**. When the exact solution leaves the box, the
correct move is to fix the violated knob at its bound and **re-solve the free one**; the code
never does. Because the two bundle columns are strongly correlated, independent clamping
lands far from the constrained optimum.

MEASURED (`D1-clamp.mjs` §J, linear model, non-degenerate recipes, grid 0.005):

| | |
|---|---|
| plausible pairs | 2,636 |
| exact solution outside the box | 2,042 (**77.47 %**) |
| of those, clamp strictly worse than some in-box point | 1,936 (**94.81 %**) |
| excess over the box optimum, in tolerance-multiples — median | **0.823** |
| — p90 / max | 2.444 / 24.156 |
| **pairs where an in-gate point existed and the clamp missed it** | **362** |
| — as a share of outside-box pairs / of all plausible pairs | 17.73 % / **13.73 %** |

Related structural fact (MEASURED, `D1-freedom.mjs` §G): the exact solution requires a
**negative** bundle quantity on **22.49 %** of non-degenerate plausible pairs (20.0 % negative
sides, 2.48 % negative protein), and a knob >10× on 14.58 %. The unconstrained solution is
frequently not merely out of bounds but *physically meaningless*, so clamping it is a very
poor projection.

**Recoverable, measured** (`D1-fix.mjs`). V1 = clamp, then for each pinned knob re-solve the
other for exact calories and clamp it; evaluate the raw corner plus the two back-substitutions
and keep the best on the shipped accept rule. Same bounds, same two macros, same gate:

| | V0 (shipped) | **V1 (back-substitution)** | V2 (exhaustive box optimum) |
|---|---|---|---|
| in-gate, 1,170 pairs | 419 (35.81 %) | **502 (42.91 %)** | 555 (47.44 %) |
| worstRatio median | 2.051 | **1.640** | 1.222 |
| worstRatio p90 | 6.843 | 6.321 | 5.612 |
| rescues / regressions vs V0 | — | **83 / 0** | — |
| knob spread > 4× | 0 | **0** | — |
| knobs resting on the 0.5 floor | 586 | **542** | — |

V1 introduces **no** divergent plates and *reduces* floor-resting knobs. It is the cheapest
correct change in this file.

### D3 — the degenerate branch ignores the fixed bundle. MEASURED.

`:410` divides by `recipe.kcal` (the whole dish) where `:402` nets `F` out. **139 of the 204
one-knob recipes carry fixed kcal.** Over 461 interior cases: the code's kcal error is median
**0.05 %**, p90 0.63 %, **max 9.69 %**; the net-of-fixed formula's error is **0** exactly, and
**0** cases exceed the 15 % tolerance. Real, one-line, low-yield — fix it for correctness, do
not sell it as a lever.

### D4 — the role split collapses a 7-value vocabulary to a binary, and the tag is unreliable. MEASURED.

`:336` and `:397-398` test only `role === "protein"`. Everything else — carb, veg, fat, dairy,
other, fruit, and 2,469 nulls — is one knob.

Independent tag audit (`D1-roles.mjs`; criterion re-derived, **not** the role column:
≥40 % of calories from protein AND ≥10 g protein/100 g):

- 504 protein-dense ingredient rows; **417 tagged `protein`, 12 tagged something else, 75
  `null` → 17.26 % misfiled**. Examples: `Greek yogurt, 0% [role=dairy]`,
  `Cheese, swiss, low fat [role=dairy]`, `Broad Beans [role=carb]`.
- 83 recipes contain a protein-dense food not tagged `protein`.
- **37 of the 200 no-protein-role recipes could be moved onto the 2-knob branch by tagging
  alone** under this strict criterion. A looser criterion (≥10 g protein/100 g, no kcal-share
  condition) gives 123, but is contaminated by flour and nuts. **The true number is between
  37 and 123 and I could not determine it** (§9).
- My criterion under-counts fatty animal proteins (whole egg is 35 % of kcal from protein,
  salmon 38.5 %), so the "51 % of `role=protein` rows are not protein-dense" figure my script
  prints is an **artifact of my threshold, not evidence of mis-tagging**. Recorded here
  against myself; do not cite it.

Sensitivity (MEASURED, `D1-fix.mjs`): stripping the protein role from a 2-knob recipe makes
the fit worse on **51.55 %** of pairs; penalty median 0.022 tolerance-multiples but **p90
1.426** — enough to flip a slot out of the gate. The tag is usually neutral and occasionally
decisive.

### D5 — no downward search exists outside keto. MEASURED. See §1.7.

### D6 — practical rounding is applied after the solve and never fed back. MEASURED.

The solve is optimal for the **linear** model; the plate is **rounded**. Rounding error
(`D1-floor.mjs` §D, 17,121 pairs):

| macro | median | p95 | max |
|---|---|---|---|
| kcal | 0.66 % | 3.35 % | 8.55 % |
| protein | — | 3.52 % | 11.84 % |
| **fat** | — | **4.98 %** | **29.85 %** |
| **carb** | — | **6.15 %** | **63.15 %** |

Net gate effect is small (70 pairs knocked out of tolerance, 33 knocked in — 0.41 % net), so
rounding is **not** a significant cause of bound misses. But the composition macros are 2-10×
more rounding-sensitive than calories, which is a hard constraint on any fat/carb-aware
portioner: **it must evaluate candidates on rounded grams, not on the linear model** (§7 C6).

### D7 — nothing on the slot record names the bound. MEASURED.

`resolveSlot` returns exactly `{recipeId, warning, proteinScale, sidesScale, ingredients,
kcal, protein, fat, carb}` — **no field matching `/pin|bound|clamp|limit|floor|ceil/`**
(MEASURED, `D1-probe.mjs`). The only signal that the solve ran out of room is
`proteinScale === 0.5 || sidesScale === 0.5`, which is **ambiguous with the non-finite path
of D8**. And a floor-pinned portion that still clears the kcal/protein gate ships with
`warning: null`: 81 of 490 pinned slots in my forced-pairing probe (**16.53 %**) were silent.
Every downstream diagnosis — A2's taxonomy, the brief's 68.3 %, the UI's amber — reads a
number the solver never asserted.

### D8 — non-finite → half portion. MEASURED. See §1.5. Reachable from `brain/tools.js:74`.

### D9 — the keto trim re-applies the rounded label, not the raw factor. MEASURED. See §1.7.

---

## §3 — THE 0.5× FLOOR, PRECISELY

**What the floor actually is.** It is *not* `0.5 × recipe.kcal`. Non-scalable ingredients never
move, so the smallest portion of a dish is `F + 0.5·(P + S)`. Measured: the fixed bundle's
share of a dish's calories is median **0.6 %**, p90 12.3 %, max 39.0 %, so the effective floor
is median **0.503** of base kcal and p90 **0.562** (MEASURED). For most dishes the floor is
what it appears to be; for the top decile it is meaningfully higher.

**What happens when a solve wants less than 0.5.** It is **clamped silently** at `:413-414`.
Not rejected, not flagged, not recorded. The result flows into `applyScales`, ships, and the
only trace is the `0.5` label. Whether the *slot* complains depends entirely on whether the
resulting overshoot breaks the kcal/protein tolerance at `:630`; 62.6 % of the time it does,
37.4 % of the time it does not (MEASURED).

**How far below the floor the solve wants to go** (MEASURED, `D1-floor.mjs` §C, 64,107
plausible pairs — restricted to recipes reachable at all, so the sampler's ratio bias is not
inflating this):

| | |
|---|---|
| interior solves (no clamp) | 32.71 % |
| pinned **low only** | **22.98 %** |
| pinned **high only** | 20.23 % |
| pinned **both directions** (the divergent plate) | 24.08 % |
| wanted-scale below the floor: median / p10 / min | 0.21 / −2.20 / −1220.75 |
| kcal actually shipped when floor-pinned, ÷ target: median / p90 | **1.193 / 1.546** |

So a floor-pinned slot lands a median **+19.3 %** over its calorie target and p90 **+54.6 %**.
That overshoot is the fat problem's engine (§4).

**Reachability at the floor** (MEASURED): for a 232 kcal snack slot (a 2,000 kcal day),
**500 of 910 recipes are too large even at 0.5×**; only 398 are reachable. For a 580 kcal
meal slot 753 are reachable. Snack slots are structurally the worst-served.

**Verifying A2's floor-vs-ceiling claim.** A2 measured "66 of 70 bound misses at the 0.5×
floor, 0 at the ceiling alone" on *shipped* slots. My a-priori pair census is much closer to
symmetric (22.98 % low-only vs 20.23 % high-only). **Both are right, and the difference is the
finding:** the asymmetry is created by the *search*, not by the geometry — see §4. A2's
instrument is also sound: its pin test uses `round2`'d labels, and the false-positive band
(a raw interior value within 0.005 of a bound rounding onto it) is only **0.96 %** at the
floor and **0.43 %** at the ceiling (MEASURED). A2's numbers stand.

---

## §4 — WHY THE FLOOR BINDS: THE ASYMMETRIC PROTEIN RULE *(new; MEASURED)*

`kcalOffPct` (`:420-422`) is **two-sided**. `proteinShortfallPct` (`:426-428`) is deliberately
**one-sided** — over-delivering protein costs nothing. `worstRatio` (`:628`) is the max of the
two normalised terms. Therefore:

- An **over-sized** portion (floor-pinned) is judged on **calories alone**.
- An **under-sized** portion (ceiling-pinned) is judged on **calories and protein**.

Measured over 21,537 single-direction pinned pairs (`D1-asym.mjs`):

| | floor-pinned (over-sized) | ceiling-pinned (under-sized) |
|---|---|---|
| pairs | 11,521 | 10,016 |
| **clears the shipped gate** | **37.31 %** | **26.55 %** |
| protein over target | 89.33 % | — |
| protein short | — | 97.21 % |
| **over on protein by >12 % yet unpenalised** | **50.85 %** | n/a |
| protein excess, median / p90 | +15.1 % / +65.7 % | — |
| kcal error, median | **+19.4 %** | — |
| **fat vs a 28 %-of-kcal ask, median** | **+74.5 %** | **−23.9 %** |

If the protein rule were symmetric, the floor-pinned pass rate collapses **37.31 % → 22.78 %**
(1,674 slots) while the ceiling-pinned rate barely moves (26.55 % → 26.08 %, 47 slots).
**The asymmetry is worth 14.5 points of acceptance to over-sized portions and 0.5 points to
under-sized ones.**

**Causal chain (DERIVED):** floor clamp → over-sized portion → protein overshoot free,
calorie overshoot partly inside the ±15 % band → the candidate scores well and ships → its fat
arrives ~75 % above the ask → the day fails on fat. This is precisely A15's 42/42 OVER,
A17's 97 OVER / 1 SHORT, A19's 83/83, and it explains why *every* mechanism that fixes the
headline is a trimmer (C23).

**Do not "fix" this by symmetrising the protein rule.** That rejects 1,674 in-gate slots and
converts them into empty or warned ones — it removes the symptom's cover without touching the
cause, and it contradicts a deliberate, nutritionally sound design decision (`:69-74`). The
correct reading is that the score has **no term that penalises an over-sized portion except
calories**; the fix is to add the fat/carb term (D1), not to remove the protein asymmetry.

---

## §5 — CONSTRAINTS A FIX MUST RESPECT

**C1 — Byte-identical goldens.** `tests/golden/goldenBaseline.test.js` compares every section
of `tests/golden/engine-baseline.golden.json` as serialized text and derives its section list
from the golden's own keys. Any change to `scaleRecipe`, `applyScales`, or the clamp changes
the solver section and **will fail**. It must be regenerated deliberately
(`BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline()…"`), with the diff
reviewed, never silently.

**C2 — k=2 parity with the Brain optimizer.** `tests/brain/optimizer.golden.test.js:34-66`
asserts `round2(solvePortions(...).scales)` equals `scaleRecipe`'s labels for the
non-degenerate, the clamping, and the degenerate cases. `brain/optimizer.js:54-73` is a
*second, independent transcription* of the same arithmetic, with its **own**
`SCALE_BOUNDS = {min:0.5, max:2}` at `optimizer.js:18` and its own `DET_EPS`. **Changing
`weeklyPlanner` alone breaks parity.** Either change both, or change the test's contract
explicitly. This duplicated constant is a standing hazard.

**C3 — Solver purity.** `tests/qc/invariants.test.js:106-108` forbids `Math.random`,
`Date.now`, `new Date` in `weeklyPlanner.js`. A search-based portioner must be deterministic
with fixed iteration order and a fixed step count.

**C4 — Determinism / reproducibility.** `invariants.test.js:85` asserts same seed + profile →
byte-identical plan, twice. Any grid or iterative search must be order-stable.

**C5 — The clamp bounds are asserted by name.** `invariants.test.js:95` ("extreme targets
clamp scales into [0.5, 2]") and `ketoPortionCeiling.test.js:71,85` (`raw.sidesScale ===
SCALE_BOUNDS.max`; `guarded.sidesScale >= SCALE_BOUNDS.min`). Widening the bounds requires
touching these. **Do not widen them as part of a portioning fix** — every gain in §2 D1/D2 is
available at 0.5–2, and A13 priced the 0.25 floor separately (+4.29 pts, 35.5 % of served
slots below the old floor; it is a product decision, not an engineering one).

**C6 — The shipped totals must be recomputed from the shipped grams.** `applyScales:343-354`
does this and `ketoPortionCeiling.test.js:91` asserts it to 1e-9. Any candidate a new
objective evaluates must be scored on **rounded** grams (D6), or the optimiser will chase a
fat/carb figure the plate does not deliver.

**C7 — Honesty: the verdict must be computed after the final portion.** Constitution: "Solver
declares unsolvable + why — silent target misses are forbidden."
`tests/solverHonesty.test.js:169` sweeps for silent misses. A17's trimmer prototype was
disqualified for exactly this — it mutated totals *after* the warning was formed
(1 verdict-disagreement, 1 silent miss vs 0/0 baseline, C23). **Compute `kcalOff` /
`proteinShort` / the warning from the final shipped macros, last.**

**C8 — The keto ceiling must still be enforced on the final portion, and refusal must remain
available.** `ketoPortionCeiling.test.js:94-101` requires `null` (refuse) rather than a
smaller-but-still-over plate, and `:114-142` sweeps >150 slots of a keto week. A new
portioner must run `enforceScaledCarbCeiling` — or its successor — on whatever point it
finally selects.

**C9 — Portion realism.** The campaign's own customers rejected "625 g chicken with 2 g pine
nuts" (`macroCloser.js:14-17`). Any new objective must report the **knob spread**
(`max/min`) and the share of plates above 3-4×. V1 measured 0 plates >4× (MEASURED) and A13's
per-role boxes made spread *worse*; this is a real acceptance criterion, not a formality.

**C10 — `SCALE_BOUNDS` has five consumers beyond the solve, three of which are diagnostics
that would silently lie if the bounds moved:**
`weeklyPlanner.js:385,389` (keto trim) · `mealSolver.js:791-792` ("how many of your recipes
can be portioned to this slot" — the variety warning) · `mealSolver.js:1397-1398` (the
"why not?" reach explanation) · `brain/optimizer.js:18` (the duplicate constant) ·
`routes/plans.js:103` and `:596` (hardcoded literal `0.5`/`2` clamps on the place-recipe and
save paths) · `frontend/src/components/RecipesTab.jsx:51` (`SCALES = [0.5, …, 2]`, the manual
scale picker). Six of these are **literals, not imports**.

**C11 — Do not add A13's +14.74 and A17's +14.93.** C23 is explicit and A22 measured the
overlap: 79 + 56 + 80 = 215 days alone vs **96** jointly, i.e. summing overstates by **2.24×**.
The in-gate steering of §2 D1 is very likely the *same* effect again; it must be measured in
combination, never added.

**C12 — Intervene here, not in `mealSolver.js`.** A18 measured every `mealSolver.js` edit at
**0.00 pts** and every `weeklyPlanner.js` edit as moving the number (C23). `SCORE_WEIGHTS` is
a reporting layer.

---

## §6 — RECOMMENDED SHAPE (for the build prompt)

Ordered by cost-to-risk, all inside the existing box:

1. **Back-substitution after clamping** (D2). Purely corrective, +7.10 pts of per-pair in-gate
   rate, 83 rescues / 0 regressions, 0 new divergent plates, fewer floor pins. Does not change
   the objective, the bounds, or the gate. Breaks C1 and C2 goldens; regenerate.
2. **Net the fixed bundle out of the degenerate branch** (D3). One line, correctness only.
3. **Lexicographic composition step** (D1): among box points that **pass the kcal/protein
   gate**, pick the one minimising `compositionDistance` against `target.fatTarget` /
   `target.carbTarget` — the numbers `solveDay:930-931` already computes and `:621` already
   drops. Evaluate on **rounded** grams (C6). Because the gate is a hard pre-filter, this
   cannot raise the warned-slot count — the specific regression A13's unconstrained `wls2`
   paid (341 → 405). Measured headroom: composition distance 0.416 → 0.282 mean, carb error
   14.19 g → 0.87 g median.
4. **Make the bound visible** (D7): carry a `pinned: {protein, sides}` (or a reason string)
   on the slot record so downstream diagnosis stops inferring it from a `0.5` label that the
   non-finite path also produces.
5. **Fix the non-finite fallback** (D8): a non-finite scale should be a *refusal* or `1`,
   never `min`; and a `kcalTarget <= 0` should never score as a perfect fit.
6. **Generalise the keto trimmer** (§1.7) as the model for a downward search — it already has
   the right shape (step down, re-check the **real recomputed totals**, refuse rather than
   ship over). Fix `:386`/`:389` to pass the raw factor, not the round2'd label.

---

## §7 — CORRECTIONS TO PRIOR FLEET MATERIAL

**C23 / A13 §2 — the substance is right, the citation is wrong and would misdirect a builder.**
The claim reads: *"`weeklyPlanner.js:451` already computes a fat/carb composition target and
discards it before `scaleRecipe(recipe, kcalTarget, proteinTarget)` at L394."*
- `:451` is `hasCompositionTarget`, a **predicate**, not a computation.
- The composition target is **computed** at `:898-899` (`fatShare`/`carbShare`) and
  `:930-931` (`fatTarget`/`carbTarget`), both in `solveDay`.
- It is **discarded at `:621`** (and `:503`), the call sites. `:394` is merely where
  `scaleRecipe` is *defined*.
A builder told to "pass the argument at L394" will edit a signature and find nothing to pass.
The edit is at **`:621`**, and it is not a passed argument — it is a change of objective (§1.3).

**The brief's own line numbers, corrected:** `det` is at **`:404`**, not 411-413 (the Cramer
expressions are `:413-414`). `round2` is *defined* at **`:295`** and *applied* at `:356`.
`fatShare`/`carbShare` are *produced* at `:898-899` / `:930-931`, not in the 445-458 block
(that block holds the predicate `:451`, the constant `:458`, and the scorer `:465-471`).

**A13 §4 reproduced independently.** 204/910 = 22.42 % on the one-knob branch, split 200
no-protein-role + 4 det-degenerate. Exact match by a different code path. **CONFIRMED.**

**A2 CONFIRMED, with its instrument checked.** The `round2` pin label has a false-positive
rate of 0.96 % (floor) / 0.43 % (ceiling) — negligible. A2's floor-dominance result and my
near-symmetric a-priori census are **both correct**; §4 supplies the missing mechanism that
reconciles them.

**One thing I recorded against myself:** my first role-tag criterion (≥40 % of kcal from
protein) reports "51 % of `role=protein` rows are not protein-dense". That is a threshold
artifact — whole egg and salmon both fail it. It is not evidence of mis-tagging and must not
be cited. (Third instance in this campaign of a check agreeing with its own construction
rather than the code; C20 flagged the second.)

---

## §8 — WHAT I COULD NOT DETERMINE

1. **The days-in-band delta of any of the §6 recommendations.** Everything I measured is
   per-(recipe, slot-target) pair. The shipped solver tries up to 20 candidates and keeps the
   best, so a per-pair rescue does not map 1:1 onto a shipped-slot rescue, and slots do not
   map 1:1 onto days. **Do not quote 35.81 → 42.91 as a compliance figure.** The instrument
   for the real number is A13's `a13-hook-v3.cjs` rig on the persona grid.
2. **The overlap between back-substitution (D2), in-gate composition steering (D1), and
   A13/A17's levers.** C23 is explicit that these will each claim the same ~15 points. I did
   not run the combination.
3. **Portion realism in grams.** Like A13, I measured scale *ratios* — knob spread >4× is 0
   under V1 — but nobody has rendered the plates. The "does this look like food" question
   remains ESTIMATED, not measured.
4. **How many of the 200 no-protein-role recipes are genuinely rescuable by tagging.**
   Bounded between **37** (strict criterion, under-counts fatty proteins) and **123** (loose
   criterion, contaminated by flour and nuts). Needs a curated pass over 183 candidate rows.
5. **Whether the non-finite → 0.5 path fires in production.** `bmrEngine.js:299-354` always
   emits `proteinLo`/`proteinHi` and the fat/carb bands, so the engine path looks safe. I did
   **not** audit every hand-built target (`estimateSlotTarget`, `alternatesForSlot`,
   `regenerateOneSlot`, `routes/plans.js`) for a path that omits `proteinTarget`.
   `brain/tools.js:74` + `brain/selector.js:13` is demonstrably reachable — the tool schema
   requires only `recipeId` — but I did not observe a live call omitting the targets.
6. **The shipped rate of quiet floor pins.** My 16.53 % comes from forced one-recipe pairings,
   not from a real solve. A2's shipped-slot numbers are authoritative for that question.

---

## ARTIFACTS

All under `docs/surgery/CAMPAIGN/solver-deepdive/D1/` — read-only, re-runnable, deterministic
(fixed mulberry32 seeds), each pointing `DATABASE_URL` at the local `dev.db` copy:

| script | what it establishes |
|---|---|
| `D1-algebra.mjs` | independent Gaussian re-derivation; branch census; cached-macro drift; shipped-gram parity |
| `D1-floor.mjs` | reach window; degenerate-branch bias; clamp census; pin-label false-positive band; rounding error; hidden 1 g floor |
| `D1-freedom.mjs` | fat/carb invariance proof; negative exact solutions; keto trim-loop enumeration; in-box fat/carb range |
| `D1-clamp.mjs` | clamp vs box optimum; slots the clamp loses outright; in-gate steering headroom |
| `D1-fix.mjs` | back-substitution evaluation (V0/V1/V2); degenerate-input probes; role-strip sensitivity |
| `D1-asym.mjs` | the asymmetric-protein-rule mechanism |
| `D1-roles.mjs`, `D1-roles2.mjs` | role-tag audit, strict and loose bounds |
| `dev.db` | copy, `md5 1f761e43a5cf7cfa31e1319fa997b0b7`, identical to `backend/prisma/dev.db` |

No file under `backend/src/` was modified. `backend/prisma/dev.db` was not opened for writing.
