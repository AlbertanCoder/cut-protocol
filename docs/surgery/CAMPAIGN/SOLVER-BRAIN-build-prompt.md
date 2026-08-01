# SOLVER BRAIN — wire Brain v3's portioning optimizer into the live solve path

**A cold-start build prompt.** Paste into a fresh Claude Code session at
`C:/Users/<account>/Desktop/cut-protocol/`. Assumes no prior context. Stages are
sequential and each one ends in a measurement. Do not skip Stage 0.

---

## 0. THE THESIS, IN ONE SENTENCE

The meal solver can only move calories and protein because it has **two knobs**; give
it a knob per component and fat and carbs become steerable by portioning instead of by
dish selection alone.

**The claim this overturns is written in the code today** —
`backend/src/lib/weeklyPlanner.js` ~L437:

> *"Fat and carbs are COMPOSITION — scaling a dish changes its calories, not its
> fat-per-kcal — so the only way to steer them is WHICH dish gets picked."*

That is **true for two knobs and false for n knobs.** With one scale on the protein
bundle and one on "the rest," oil and rice move together and fat-per-kcal is frozen.
With a scale per role, they move independently. This matters because **fat is the
single largest cause of missed days** (59% at one point), and every fix attempted so
far has been on the selection side — composition-aware sampling bought 4 points and
stalled, because selection was never the binding constraint.

---

## 1. WHAT ALREADY EXISTS — READ BEFORE WRITING ANYTHING

The optimizer is **already built, already correct, and already golden-locked.** This
build wires it. It does not write a solver.

| file | lines | state |
|---|---|---|
| `backend/src/lib/brain/optimizer.js` | 124 | **Built, not wired.** `solvePortions(candidates, target, opts)` |
| `backend/tests/brain/optimizer.golden.test.js` | — | Locks k=2 byte-parity with the legacy solver |
| `backend/src/lib/brain/create.js` → `scaleToTarget()` | ~L106 | **The reference wiring pattern.** Already calls `solvePortions` at k=2, rounds to 5 g, re-derives macros from rounded grams |
| `backend/src/lib/weeklyPlanner.js` → `scaleRecipe()` | L394–418 | The legacy 2-knob solver being replaced |
| `backend/src/lib/weeklyPlanner.js` → `applyScales()` | L334 | Hard-codes the two-way branch `ing.role === "protein" ? proteinScale : sidesScale` |
| `backend/src/lib/brain/verifier.js` | 103 | **Dormant scaffolding, banner-enforced.** Correct and unit-tested; nothing calls it |
| `backend/src/lib/brain/governance.js` L269 | — | Module registry with `dormant: true` flags — must be updated when anything wakes |

**How `solvePortions` behaves:**

- `k === 2` → `solve2()`, Cramer on (kcal, protein), **operand-for-operand identical**
  to `scaleRecipe`. Do not "simplify" it; byte-identity depends on the order.
- `k !== 2` → `solveGeneral()`, deterministic projected-gradient box least-squares,
  fixed 200 iterations, **optimising all four macros** at weights
  `{kcal: 1, protein: 1, fat: 0.1, carb: 0.1}`.
- Bounds are `SCALE_BOUNDS = {min: 0.5, max: 2}` in both paths.

**The single most important fact about this build:** `optimizer.js` is *pure
arithmetic*. No LLM, no `Math.random`, no wall clock — it says so in its header and
the golden test enforces it. **The entire portioning half of the Solver Brain ships at
`BRAIN=off` for $0.00** and is measurable on the existing free deterministic harness.
The LLM enters only at *selection* (which items), never at *portioning* (how much).
Keep that line clean; it is the architecture.

---

## 2. THE STATE YOU ARE INHERITING

250 simulated customers / 578 planned days, `BRAIN=off`, deterministic, run-to-run
variance ±1.5 points.

| population | days hitting all four macros |
|---|---|
| all 578 days | **70.1 %** (405/578, CI 66.2–73.7) |
| satisfiable configs only (excludes 83 impossible-by-design days) | **77.8 %** (385/495) |
| no dietary style — 80 customers, the mainstream case | 90.6 % |
| keto (14) · genuine vegan · vegetarian (21) | 62.0 % · 59.3 % · 58.7 % |

**The number that motivates this whole build: 68.3 % of slots that missed tolerance
were pinned at a 0.5× or 2.0× scale bound**, against 39.3 % of all slots. Two thirds
of every failure was the solver out of room, not choosing badly.

**Widening the bounds is the obvious move and it is the wrong one** — customers
already rejected what that produces ("625 g chicken with 2 g pine nuts"). The Solver
Brain's answer is **more knobs, not wider knobs**: with a scale per role the reachable
macro space grows without any single ingredient going to an absurd portion.

**Three properties are load-bearing. A change that raises compliance and breaks any of
these is an automatic revert, not a trade-off:**

- **0 confirmed allergen leaks** across 250 customers.
- **100 % honesty-on-miss** — every out-of-band day carries a warning, a per-day miss
  line, or a diagnosis. The app's single best property.
- **0 kcal drift** between stored slot totals and recomputation from raw `Food` rows.
  This is currently structural: `applyScales` calls `practicalGrams()` and then
  **re-derives totals from the rounded grams.** Never display a pre-rounding ideal.
  Preserve that shape in everything you wire.

Also hold: p50 ≈ 490 ms, p95 ≈ 950 ms for a full week solve. `solveGeneral` runs 200
fixed iterations per slot — **watch the p95 at Stage 4.**

---

## 3. STAGE 0 — RESCUE THE WORK THAT IS NOT SAVED

**Every point of the 40.8 → 70.1 climb is uncommitted in the working tree.** Do this
before touching the optimizer, or a mistake in Stage 3 has nothing to fall back to.

Uncommitted at HEAD `0d3eaa5`: 11 modified files (`mealSolver.js`, `weeklyPlanner.js`,
`planContext.js`, `allergenTaxonomy.js`, `foodOverrides.json`, `plans.js`,
`profile.js`, the golden baseline, 2 tests, `ledger.md`) plus untracked
`src/lib/macroCloser.js` and three `scripts/*.mjs`.

**You will likely be blocked from staging.** `.claude/hooks/guard-bash.js` reads
`CP_ROLE` via `role.js` and fails closed to `architect`; architects do not stage. You
cannot fix this from inside the session — the hook's own docs state a shell mutation
does not survive the tool call. **If blocked, stop and ask the owner to relaunch with
`CP_ROLE=builder`. A guard block is a stop sign, not a puzzle.**

Then re-run the 250-customer fleet untouched and confirm ~70 % within ±1.5 points:

```bash
cd backend && PORT=3947 HOST=127.0.0.1 BRAIN=off node server.js &
cd docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032
rm -f results.jsonl state.json && node fleet.mjs --port 3947 && node stats.mjs
```

**Port 3001 is the owner's live app with real personal data. Never probe it, never
reference it, never kill a process you did not start. Use 3900–3999.**

If you do not reproduce ~70 %, you have inherited a different state than this prompt
describes. Stop and reconcile before continuing.

---

## 4. STAGE 1 — PARITY HARNESS

**Goal:** prove `solvePortions` at k=2 is a drop-in for `scaleRecipe` on *real* recipes,
not just the golden fixtures.

`optimizer.golden.test.js` already locks parity — but only on synthetic recipes with
**no fixed (non-scalable) ingredients**, which is the easy case. Real recipes have
them, and `scaleRecipe` subtracts them (`remainingKcal = kcalTarget - fixed.kcal`)
before solving.

Build a harness that sweeps **every recipe in the live library** (910 recipes) across a
grid of realistic (kcal, protein) targets, and asserts `scaleRecipe(...)` and
`solvePortions([proteinBundle, restBundle], netOfFixedTarget)` return identical scales.

**Definition of done:** a stated count — *"N recipes × M targets, all byte-identical"* —
or an enumerated list of divergences with the cause of each. **Divergences are the
finding, not a nuisance.** Expect the fixed-ingredient path to be where they live; that
is exactly what Stage 2 exists to fix.

---

## 5. STAGE 2 — NET-OF-FIXED TARGET PLUMBING

`optimizer.js` says it explicitly (L16): a later stage wires the replacement *"passing
the net-of-fixed target."* That is this stage.

`scaleRecipe` computes `fixed = bundleMacros(ingredients.filter(i => !i.scalable))` and
subtracts it. `solvePortions` knows nothing about fixed ingredients — the caller must
hand it an already-net target. Build that boundary explicitly and test it, including
the degenerate cases the legacy path handles: no protein ingredient, `det ≈ 0`, and a
fixed bundle that already exceeds the target.

**Definition of done:** Stage 1's harness re-run with zero divergences, including
recipes with fixed ingredients. This is the gate for Stage 3 — do not proceed on a
partial parity.

---

## 6. STAGE 3 — REPLACE `scaleRecipe` AT THE CALL SITE

Still at **k=2**. This stage changes *who computes the scales*, and nothing else.

**Definition of done — and this is the sharpest gate in the build:**

> **`backend/tests/golden/engine-baseline.golden.json` must not drift by a single
> byte, and the 250-customer fleet must return the same ~70 % it returned in Stage 0.**

A correct wiring at k=2 is mathematically a no-op. **If the golden baseline drifts
here, the wiring is wrong — do not regenerate it, debug it.** That is an independent
oracle rather than a predicate sharing vocabulary with the thing it grades, which is
precisely the verification shape the last campaign's audit found missing.

Keep `scaleRecipe` in the tree as a thin delegating wrapper. `brain/tools.js` L77 calls
it as the LLM's tool, and `chatPlan.js` documents it as the authority for every macro
the coach quotes — those must keep working unchanged.

---

## 7. STAGE 4 — n-CANDIDATE PORTIONING

**This is the stage that buys the points.** Everything before it was scaffolding.

Two concrete changes:

1. **Bundle by role, not by protein-or-not.** `scaleRecipe` splits into `proteinIngs`
   and `restIngs`. Split instead by the `role` column — protein / carb / fat / other —
   so oil and rice get independent scales.
2. **Generalise `applyScales` (L334).** It currently hard-codes
   `ing.role === "protein" ? proteinScale : sidesScale`. It needs a scale per role.
   **Keep `practicalGrams()` and keep re-deriving totals from the rounded grams** —
   that is what holds kcal drift at 0.

Then feed `solvePortions` a full four-macro target. **The `fatTarget`/`carbTarget`
fields already exist** on slot targets (`weeklyPlanner.js` ~L432) and are deliberately
not used as a gate today — Stage 4 is what finally consumes them.

**On the objective weights.** `solveGeneral` runs `{kcal: 1, protein: 1, fat: 0.1,
carb: 0.1}`, which is narrower than what `dayTolerance()` actually grades. Tuning those
weights toward the grading rule is **legitimate and expected** — the weights are the
*objective*, not the *ruler*. Changing the objective to match the ruler is correct
engineering; changing the ruler to match the result is cheat #1 in the research brief.
**Do not touch `dayTolerance()` or `computeMacros()` bands. Ask the owner first — that
is a nutrition question with citations, not a solver question.**

**Definition of done:**
- **Primary:** share of missed slots pinned at a scale bound falls from **68.3 %**.
  That is the mechanism working, and it is a better signal than the headline rate.
- **Secondary:** satisfiable-only compliance rises from **77.8 %**. Anything inside
  ±1.5 points is harness noise, not a result.
- p95 solve stays under ~1.2 s. 200 iterations × more slots is the risk.
- The golden baseline **will** drift here, legitimately. Disclose it prominently and
  characterise the diff: *is this a quality change or a reshuffle?*
- All three load-bearing properties re-measured and holding.

**Stop condition:** if pinning does not fall, the thesis in §0 is wrong. Say so plainly,
write it up, and stop — do not start widening bounds to rescue the number.

---

## 8. STAGE 5 — WAKE `verifier.js`

Only after Stage 4 measures. `verifier.js` is the gate a selector path needs: it
re-confirms the recipe is in the exclusion-filtered pool, **recomputes macros from
source** and rejects any claimed number disagreeing beyond float epsilon, and rejects
anything lacking provenance. A rejection is a discard plus structured feedback — never
a silent "fix."

**The specific gotcha:** `tests/brain/dormantScaffolding.test.js` fails the build if a
caller appears outside `src/lib/brain/` while the `⚠️ SCAFFOLDING — NOT WIRED` banner
still stands, *and* fails if the banner is removed while the module is still uncalled.
**Edit the banner and wire it in the same commit.** Also flip `dormant: true` for the
relevant entry in `brain/governance.js` (L269 area). That test exists to stop exactly
the failure it was written about — a module branded as a running safety control that
protected nothing. Do not re-create that.

**Definition of done:** verifier rejects a deliberately corrupted claimed macro in a
live path, `dormantScaffolding.test.js` passes, and the governance registry matches
reality.

---

## 9. STAGE 6 — MEASURE

Re-run the 250-customer fleet and report **three numbers**, not one:

| # | metric | now | this build's target |
|---|---|---|---|
| 1 | days in band, **satisfiable customers only** — primary | 77.8 % | 85 %+ |
| 2 | days in band, all customers — ceiling ≈ 88 % | 70.1 % | 80 %+ |
| 3 | share of missed slots **pinned at a scale bound** — the mechanism | 68.3 % | well under 50 % |

**85–99 % on all 578 days is not achievable and must not be adopted as a target.** 83
of those days belong to customers engineered to be unsatisfiable — vegan plus soy,
gluten, peanut, tree nut, sesame and legumes against an LBM protein floor. No library
satisfies them; the correct output is a refusal. That caps all-days near **88 % under a
perfect solver.** Any claim above 90 % on all days is evidence your measurement broke —
treat it as a bug in your own work and go find it.

Report `BRAIN=off` as the headline. The portioning path is deterministic, so **the
entire gain should appear at $0.00.** If a number only improves with `BRAIN=on`, that
is a *selection* effect and belongs in a separate row — do not blend them.

Also slice by diet. Vegan/vegetarian/keto are the pool-limited populations, and the
n-knob change should help them **least** — they fail for lack of candidates, not lack
of scaling freedom. If they improve as much as `none` does, suspect the measurement.

---

## 10. INTEGRITY RULES

Research brief §7 applies in full — read
`docs/surgery/CAMPAIGN/RESEARCH-BRIEF-macro-compliance.md`. The short form: do not
widen tolerance bands to score, do not weaken the exclusion gate, do not degrade
honesty-on-miss, do not drop hard customers from a denominator, do not invent nutrition
data, do not fabricate a measurement, and beware your own tooling.

Four additions specific to this build:

8. **Determinism is not validity.** Reproducing your own number twice proves
   reproducibility, not correctness. Every load-bearing claim needs an oracle that does
   not share vocabulary with the thing it grades — the k=2 golden no-op at Stage 3 is
   the model to copy.
9. **Do not widen `SCALE_BOUNDS` to rescue a stage.** The whole build exists because
   more knobs beat wider knobs. If you reach for the bounds, the thesis failed — write
   that up instead.
10. **A parallel cloud fleet reported a 6.3 % baseline. It is unreconciled and must not
    be cited.** It ran against a public-repo clone with **626 recipes** against the
    desktop's **910**, no `foodOverrides.json` (uncommitted, so a clone cannot have
    them), a hand-built sqlite shim replacing Prisma, and a uniform diet mix
    (`genProfile.mjs` picks 1-of-9, so ~11 % carnivore) against the desktop's weighted
    mix (carnivore 0.8 %). Reweighting for diet mix alone explains only ~6 of the
    34-point gap — **estimated, not measured.** Its A/B *deltas* may be usable; its
    absolute numbers are not.
11. **Distinguish measured from estimated in every sentence carrying a number.**

---

## 11. GOVERNANCE — HARD LINES

- **Port 3001 is the owner's live app with real data.** Use 3900–3999.
- **PreToolUse guard hooks** (`.claude/hooks/guard-*.js`) are driven by
  `docs/surgery/CURRENT/manifest.json`. A block is a stop sign — record it and ask.
- **`git push` is denied** in `.claude/settings.json`. Commit; the owner pushes.
- **1,491 tests across 111 files must stay green** — `node scripts/runTests.mjs`.
- **Ask the owner before**: changing any tolerance band, regenerating the golden
  baseline, or bulk-importing recipes from the web.

---

## 12. DEFINITION OF DONE

- Stage 0 committed and the baseline reproduces.
- Stage 3 landed with a **byte-identical** golden baseline — the proof the wiring is
  sound.
- Stage 4 reports the pinning rate as its primary result, with the golden diff
  characterised.
- All three headline metrics reported with 95 % Wilson intervals and stated variance.
- The three load-bearing properties re-measured and holding: **0 allergen leaks, 100 %
  honesty-on-miss, 0 kcal drift.**
- `dormantScaffolding.test.js` green and the governance registry matching reality.
- A written list of what you got wrong mid-build and how you caught it.

**Deliverable:** `docs/surgery/CAMPAIGN/SOLVER-BRAIN-results-<YYYYMMDD>.md`, written for
an owner deciding where to spend the next month.
