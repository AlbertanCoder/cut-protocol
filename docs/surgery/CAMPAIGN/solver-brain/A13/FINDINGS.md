# A13 — n-knob portioning, the pinning metric, and the 0.5× floor

*Agent A13. Persisted to disk by the fleet coordinator from A13's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`; A13 reproduced the block
verbatim: "Subagents should return findings as text, not write report files"). Content is
A13's. A13's scripts, 16 arms and 26 `CLAIMS.tsv` rows DID land.*

**Lead null: the kill condition fires on the winning arm.** n-knob per-role scaling raises any-knob pinning **39.4 % → 61.5 %** (satisfiable served slots) while raising days-in-band **+15.11 pts**. By the assignment's stated rule ("if pinning does not fall, the mechanism is dead") the largest compliance gain in my arm set is dead on arrival. **The rule is wrong, not the arm.** A10 saw this inversion on a paired recipe×target proxy; it reproduces on the shipping solve path — and goes further: pinning is not even monotone.

Second null, and it decides the assignment: **the extra knobs buy nothing.** All of the gain comes from what you *aim* them at.

## The arms (rig, pop=personas, seed 424242, `BRAIN=off`, all on dbHash `e55f52e53658a086`) — MEASURED

| arm | satisfiable-only | Δ vs baseline (McNemar) | b / c | pinned % | pinned-given-miss |
|---|---|---|---|---|---|
| baseline (shipped 2-knob Cramer) | 413/536 = 77.1 % | — | — | 39.4 % | 86.5 % |
| noop (hook control) | 413/536 = 77.1 % | +0.00 | 0 / 0 | 39.4 % | 86.5 % |
| **floor 0.25 alone**, legacy solve | 436/536 = 81.3 % | **+4.29** [+1.41,+7.17] | 20 / 43 | **27.2 %** | **63.9 %** |
| a10w — n-knob, `optimizer.js` L42 weights | 464/536 = 86.6 % | +9.51 | 12 / 63 | 32.1 % | 83.0 % |
| **wls2 — 2 knobs, 4-macro tol-normalised** | 492/536 = 91.8 % | **+14.74** [+11.40,+18.08] | 8 / 87 | 43.8 % | 79.0 % |
| roleb — n-knob + per-role boxes | 491/536 = 91.6 % | +14.55 | 7 / 85 | 55.3 % | 82.1 % |
| role — n-knob (k≤5), same weights | 494/536 = 92.2 % | +15.11 | 4 / 85 | **61.5 %** | 85.2 % |
| **floor 0.25 + wls2** | **520/536 = 97.0 %** | **+19.96** [+16.54,+23.39] | 1 / 108 | 28.4 % | 49.0 % |

Replicated: wls2 **+14.37** (s20260730, b=5 c=82) and **+13.99** (s8675309, b=5 c=80). Levels are the **rig's** 536/622-day denominators (C15) — cite them only as deltas.

## 1. Pinning is not a lever and not a diagnostic (MEASURED)

Across seven arms pinning ranges 27–62 % and compliance 77–97 % with no monotone relation. The decisive number: under `role`, **95.7 % of days that PASS touch a bound** (473/494), against 74.1 % at baseline. A property that nearly every successful day has cannot indicate failure.

Mechanism (DERIVED): the shipped 2-knob solve is a *square* system — it hits (kcal, protein) exactly, so it only reaches a bound when that exact solution is infeasible. A 4-macro weighted least-squares is *over-determined*, so its constrained optimum normally lies on a face of the box; more knobs = more faces. Pinning therefore measures the geometry of the objective and the width of the box, not plan quality.

My baseline reproduces BRIEF.md's motivating pair on an independent path — **40.1 % of all slots pinned (vs 39.3 %) and 71.3 % of missed slots pinned (vs 68.3 %)**. The statistic is real. Its interpretation was not.

## 2. The knobs are not the mechanism; the objective is (MEASURED)

- `role` (k≤5) over `wls2` (k≤2): **+0.37 pts, b=8 c=10** — not distinguishable from zero at n=536 (C14 floor 3.5). DERIVED: 14.74/15.11 = **97.6 %** of the n-knob gain is already available at today's degrees of freedom.
- Same knobs, different weights — tolerance-normalised (`1/allow²`, allow = the day rule: kcal 0.15, protein 0.15, fat 0.25, carb 0.25) vs `optimizer.js` L42/L81 `{kcal:1,protein:1,fat:0.1,carb:0.1}`: **+5.60 pts** (b=10 c=40).
- Protein overshoot hinge removed: **−2.99 pts** (b=25 c=9) — **UNRESOLVED** under C14.
- Per-role boxes (veg 0.75–2.0, fat 0.5–1.5): **−0.56 pts** (b=12 c=9) — **UNRESOLVED**; they cut slots >3× spread 16.3 → 14.4 %, still worse than baseline's 8.4 %.

The defect this exploits is not missing knobs. `weeklyPlanner.js:451` already computes `const hasCompositionTarget = (t) => t && (t.fatShare > 0 || t.carbShare > 0);` and scores with fat/carb at L468–469 — the slot's fat/carb budget exists and is used for **ranking**, then thrown away before `scaleRecipe(recipe, kcalTarget, proteinTarget)` (L394) **portions**. The whole intervention is passing the argument that is already there.

**C9 tie-in:** the closer can only add; this portioner *trims*. Satisfiable days with fat over band **255 → 152**; `fatOk` 84.9 → 94.6 %. This is the symmetric trimmer C9 says is unbuilt.

## 3. C10 — I moved the FLOOR. The ceiling is untouched (MEASURED)

`a13-hook-v3.cjs` rewrites one literal, `{ min: 0.5, max: 2 }` → `{ min: 0.25, max: 2 }`, and asserts the source text before compiling. Max observed role-scale spread is **8.0× = 2.0/0.25**; had the ceiling moved it would exceed 8. **Floor only.**

Widening the floor alone is the **only** arm that cuts pinning (39.4 → 27.2 %) and it buys the **least** compliance (+4.29, only just clearing C14's 3.5). Stacked with the 4-macro objective it adds +5.22 (b=1 c=29) for 97.0 %.

**The price, stated plainly:** 35.5 % of served satisfiable slots carry a knob below the old 0.5× floor; 10.4 % of plates exceed a 4× role-scale spread; the 5th-percentile knob sits at the 0.25 floor. Grams per ingredient are not in the rig record, so **the servability question is measured in scale ratios, not in grams — ESTIMATED as unacceptable for some plates until someone renders them.** This is the "625 g chicken" objection pointed at the *small* end.

## 4. C6 — one-knob branch coverage, measured directly (MEASURED)

Branch test `proteinIngs.length === 0 || Math.abs(det) < 1e-6` (`weeklyPlanner.js:407`) is a per-recipe property, so served coverage is an exact join.

| | |
|---|---|
| recipes on the one-knob branch | **204/910 = 22.4 %** (A10's "200" is the no-protein-role subset; +231 served slots are det-degenerate) |
| served slots, all-days / satisfiable | 610/2818 = 21.6 % / 419/2525 = **16.6 %** |
| days with ≥1 one-knob slot, in band | **73.3 %** (214/292) vs 81.6 % (199/244) without |

`applyScales` (`weeklyPlanner.js:334`) hard-codes the two-way branch: `const scale = !ing.scalable ? 1 : ing.role === "protein" ? proteinScale : sidesScale;`

## 5. Load-bearing properties

All 16 arms: **verdict-disagreements 0, kcal-drift 0, crashes 0, invalid records 0, silent-miss 0** (`[rig] INSTRUMENT CHECKS` + `compare.v2` instrument line). Honesty-on-miss held. **Allergen leaks: oracle.mjs NOT run** — per C16 that is required for pool/gate/closer changes; this treatment only replaces the scale arithmetic *inside* `scaleRecipe`, downstream of `filterRecipePool`, and never alters ingredient identity (DERIVED from the code path, not measured). A16/A17 obligations do not transfer to it.

**One real regression:** slot-level warnings *rise* while day misses fall — 341 → 405 warned satisfiable slots under `wls2` (13.5 → 16.0 %). The per-slot gate is kcal+protein only (C8), so it flags slots the 4-macro portioner deliberately detuned. The user would see more amber on days that now pass. floor25w returns it to 343.

**Secondary, all-days:** 69.8 → 88.1 % (548/622), under A3's 91.0 % ceiling. DERIVED: the IMPOSSIBLE tier goes 548−520 = 28 of 86 judged days in band, from 434−413 = 21 — the over-inclusion C17 flagged, now more visible. Do not read 88.1 % as a fleet number.

## 6. Blocks recorded, not worked around

- `guard-bash.js` denied `[ -f "$d" ]` (bare `-f`). Rewrote without the test; no bypass.
- `guard-edit.js` create-only forced `a13-hook-v3.cjs`, `a13-pinmiss.mjs`, `a13-floorstat.mjs` as new files rather than edits (same block A10 recorded).
- The agent harness refused the `FINDINGS.md` Write — C4 reproduced verbatim.
- **C18:** `checkdb.mjs` never invoked, `--fix` never run. All 16 arms carry `dbHash e55f52e53658a086 / foodFingerprint 423e7279ed6af641 / poolRaw 910`, including the two run today. `A13/dev.db` mtime 07-30 14:35. `backend/src/` files all mtime ≤ 07-30 14:32 — the five `M` entries in `git status` predate the fleet and are the owner's branch, not mine; the hooks compile an in-memory string and never write.

## What A21 should take, and not take

Take the **2-knob 4-macro tolerance-normalised objective with the protein hinge**: +14.74 pts, replicated across three seeds, spread ≤ baseline (6.8 % vs 8.4 % of slots >3×), no new box. Do **not** stack it with n-knob (+0.37, unresolved) or with per-role boxes (−0.56, unresolved). The 0.25 floor is a separate, larger, and *product* decision — it works, and it is the only thing that reduces pinning, but it ships quarter-portions.

**FALSIFIED**
