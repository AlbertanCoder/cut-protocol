# A18 — Objective weights

*Agent A18. Persisted to disk by the fleet coordinator from A18's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A18's.
A18's scripts, 14 run artifacts and 21 `CLAIMS.tsv` rows DID land.*

**The constant I was assigned to sweep is unreachable, and the one I could reach cannot change the answer.**

## 1. The assigned objective is dormant (MEASURED, headline)

The mission prompt's `solveGeneral` optimising at `{kcal:1, protein:1, fat:0.1, carb:0.1}` is real text. It lives at `backend/src/lib/brain/optimizer.js:42` and `:81`, both as a *default fallback*:

```
  const w = weights || { kcal: 1, protein: 1, fat: 0.1, carb: 0.1 };
```

It is in `brain/`. **`BRAIN=off` is forced by the rig** (`runRig.mjs`: `process.env.BRAIN = "off"`). My hook fails loud when a target module never loads. Patching `residualOf`'s default to `{kcal:0, protein:0, fat:1000, carb:1000}` produced:

```
[rig] customers 250 · days 639 · judged 622 · in band 434 (69.8%)   <- baseline, unchanged
[a18-hook] FATAL: 1 edit(s) requested, 0 applied — a target module was never loaded.
EXIT=3
```

**Zero product paths reach it under `BRAIN=off`.** A sweep of it measures nothing. C8 called this and C8 is right.

## 2. Control first: the hook grades nothing of its own

`hookidentity` (hook loaded, empty edit list) = **639/639 byte-identical days**, delta 0.00 pts, b=0 c=0. The instrument does not move the number it measures.

## 3. `SCORE_WEIGHTS` is reached, reshuffles plans, and is worth 0.00 points

`mealSolver.js:127` is the constant I *actually* swept. It patches cleanly and changes 180–220 of 639 days' content — yet net compliance is **0.00 pts in all five arms**, including the destructive `{kcal:1, protein:0, fat:0, carb:0}` probe. Not dormant; **non-load-bearing**.

| arm | Δ pts (satisfiable) | 95% paired | b | c | byte-ident |
|---|---|---|---|---|---|
| hookidentity (control) | 0.00 | [0, 0] | 0 | 0 | 639/639 |
| w-equal `.25/.25/.25/.25` | 0.00 | [−0.90, +0.90] | 3 | 3 | 435/639 |
| w-graderline `.435/.435/.065/.065` | 0.00 | [−1.16, +1.16] | 5 | 5 | 459/639 |
| w-fatheavy `.30/.20/.30/.20` | 0.00 | [−0.52, +0.52] | 1 | 1 | 442/639 |
| w-fatcarb `.20/.20/.30/.30` | 0.00 | [−0.52, +0.52] | 1 | 1 | 433/639 |
| w-kcalonly `1/0/0/0` | 0.00 | [−1.16, +1.16] | 5 | 5 | 419/639 |

All at 413/536 → 413/536, seed 424242. Replicated at **seed 20260730**: w-kcalonly 417/536 → 417/536, 0.00 pts [−1.03, +1.03], b=4 c=4, 426/639 byte-identical. **Two seeds, same null.**

## 4. Why it is exactly zero (DERIVED — the null is structural, not luck)

Week selection consults `SCORE_WEIGHTS` **only after `daysInTolerance` ties**. `mealSolver.js:686`:

```
      || score.daysInTolerance > best.score.daysInTolerance
```

and the weights enter only through `avgMatch` at `:691`:

```
          && score.avgMatch > best.score.avgMatch);
```

So a weight change re-picks a *different member of the equal-`daysInTolerance` set*. The in-band **count** is preserved by construction; only *which* days are in band moves.

**Testable prediction: discordant pairs must balance exactly, b == c.** Observed b == c in **6 of 6** weight arms (3/3, 5/5, 1/1, 1/1, 5/5, and 4/4 at the second seed). The two `weeklyPlanner` arms that bypass this rule are strongly unbalanced (c-firstfit b=162 c=29; p-slotsym b=34 c=11). The signature holds.

## 5. Where compliance is actually decided: `weeklyPlanner.js`, not `mealSolver.js`

Every `mealSolver.js` edit = 0.00 pts. Every `weeklyPlanner.js` edit moves.

| arm | file | Δ pts | 95% paired | b | c |
|---|---|---|---|---|---|
| p-daysym (day protein hinge, neg. control) | mealSolver | 0.00 | [−0.73, +0.73] | 2 | 2 |
| **p-slotsym** (slot protein hinge, neg. control) | weeklyPlanner | **−4.29** | [−6.72, −1.87] | 34 | 11 |
| c-strict `CGE 0.05→0` | weeklyPlanner | +0.37 | [−1.34, +2.09] | 10 | 12 |
| **c-firstfit** `CGE 0.05→999` (neg. control) | weeklyPlanner | **−24.81** | [−29.41, −20.22] | 162 | 29 |
| s-fallbackcomp (C8 structural) | weeklyPlanner | +0.75 | [−0.89, +2.38] | 8 | 12 |

The same asymmetric protein hinge exists in both files. Breaking it in `weeklyPlanner` costs **4.29 pts**; breaking it in `mealSolver` costs **nothing**. c-firstfit (−24.81) proves the rig can see a large effect, so the weight nulls are not insensitivity.

## 6. The C8 structural lever: consistent direction, unresolved size

`s-fallbackcomp` gives the no-fit fallback rank a fat/carb term — it can only touch slots where *no* candidate passed the 2-macro gate, i.e. exactly the slots that produce failing days.

| seed | satisfiable | Δ pts | 95% paired | b | c |
|---|---|---|---|---|---|
| 424242 | 413 → 417 / 536 | +0.75 | [−0.89, +2.38] | 8 | 12 |
| 20260730 | 417 → 421 / 536 | +0.75 | [−1.26, +2.75] | 13 | 17 |

Identical point estimate at two seeds, c > b both times. Both intervals span zero and both sit **below the C14 3.5-pt floor**. **Unresolved, not small, and not a win.** It is the only arm worth a third seed and a larger n.

## 7. Multiple comparisons (DERIVED)

11 arms at one seed. **No correction was applied and none is needed:** the largest positive delta across all 11 is **+0.75 pts**, far under the 3.5-pt floor even uncorrected. The only two arms past the floor are pre-registered *negative controls*. There is no winner, so there was nothing to correct for and nothing to promote by replication. I replicated the two load-bearing claims anyway.

## 8. Hygiene

- `backend/src` never written. Patching is in-memory (`Module._extensions[".js"]` → `mod._compile`). All three constants verified still at shipped values; `grep __a18r backend/src/lib/*.js` empty. The `M` flags on `mealSolver.js`/`weeklyPlanner.js` **predate A18** (session-start snapshot, branch `fix/audit-remediation`).
- **C18:** `A18/dev.db` never re-copied. `dbHash e55f52e53658a086` on baseline, all 11 arms, and both seed-20260730 replications. `checkdb.mjs` never invoked; `--fix` never run.
- Instrument checks 0/0/0/0 on all 14 runs; `problems[]` empty in every compare. `compare.v2.mjs` throughout.
- Levels are the rig's own (C15); I quote deltas, and cite 413/536 only as this rig's baseline.

## What the fleet should take

1. **Delete the assignment.** "Retune `solveGeneral`'s weights toward the grader" cannot pay: the code is unreachable at `BRAIN=off`, and its live analogue `SCORE_WEIGHTS` is a post-hoc tiebreak that provably cannot change the in-band count.
2. The 2-vs-4 macro mismatch C8 names is **not fixable at the weights**. The reachable version is the fallback rank (§6) — direction consistent across two seeds, size unresolved.
3. `mealSolver.js`'s day-level scoring is a **reporting layer**. Compliance is decided in `weeklyPlanner.js`'s slot loop. Anyone tuning objectives should work there.

**FALSIFIED**
