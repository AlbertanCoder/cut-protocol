# W0-1 — PREFLIGHT & RESCUE

Run 2026-07-31, autonomous. Orchestrator context (see `DECISIONS.md` D-7).

## 1. Environment — GREEN

| Check | Result |
|---|---|
| node | **v24.13.0** (≥18 required) ✔ |
| npm | 11.6.2 |
| git | 2.53.0.windows.2 |
| Prisma client | generated, queries execute ✔ |
| Backend tests runnable | yes — deferred to W4-2 (`DECISIONS.md` D-8) |

## 2. The database — fingerprinted

| Item | Value |
|---|---|
| Path | `backend/prisma/dev.db` |
| Size | 22,781,952 bytes |
| mtime | 2026-07-31 05:53 |
| **sha256** | **`d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1`** |
| Food rows | **14,151** |
| Recipe rows | **910** |
| Food macro fingerprint | `kcal 2,993,020.9 · protein 145,901.21 · fat 142,334.53 · carb 287,639.42` |
| Recipe macro fingerprint | `kcal 586,983.59 · protein 31,722.41 · fat 26,363.37 · carb 57,733.6` |

Counts match the brief's 14,151 / 910 exactly — this is the post-repair DB the
brief describes, not the stale one. **Every downstream number must cite this
hash.** The brief is emphatic that the tree is a *working tree, not a commit*;
a SHA alone does not pin a baseline.

> Schema note for every agent: the macro columns on `Food` are
> **`kcal/protein/fat/carb`**, *not* `kcalPer100g/proteinPer100g/…`. The brief and
> several prior scripts use the `Per100g` spelling in prose; that spelling does
> not exist in SQLite and raw queries using it fail with
> `no such column`. Values are per 100 g regardless.

## 3. The rescue — DONE, and it was needed

`git status` at run start: **26 entries** — 11 modified tracked files and 15
untracked paths, including `backend/src/lib/macroCloser.js`, which the brief
describes as *"untracked in git and has zero tests"* and which carries a large
share of the uncommitted compliance arc. This was one crash from gone.

**Commit `75baddd` on branch `campaign-2026-07`** — 1,385 files,
10,153,913 insertions (bulk is campaign JSONL artifacts).

Inventory:
- `backend/src/lib/macroCloser.js` — **NEW**, the file the cloud never saw
- `backend/src/lib/{allergenTaxonomy,mealSolver,planContext,weeklyPlanner}.js`,
  `backend/src/routes/{plans,profile}.js` — modified in place
- `backend/scripts/{applyFoodOverrides,backfillIngredientMetadata,seedGapRecipes}.mjs`
- `backend/tests/` — golden regenerated, `horizonGeneration`, `solverHonesty`
- `docs/surgery/CAMPAIGN/**` — solver-deepdive (incl. the brief), solver-brain,
  qa fleet, handoffs; `docs/surgery/surgery-20260727-0217/verify/**`

Verified no secret or personal-data file entered the commit (no `.env`, no
`.db`, no snapshot) — the one `backup`-matching path is a `.md`.

**Push blocked by repo guard** (`DECISIONS.md` D-2). Prompt's fallback taken:

```
%USERPROFILE%\Desktop\cut-protocol-rescue.bundle   56,197,663 bytes
git bundle verify → "The bundle records a complete history."
ref: 75baddd0ff10f1e3a4f561cf790ea3408dbc2711 refs/heads/campaign-2026-07
```

> ⚠️ **OWNER ACTION REQUIRED:** the rescue and all fleet work exist **only on
> this machine** plus that bundle. Nothing is on GitHub. Push by hand:
> `git push -u origin campaign-2026-07 fleet/measure-2026-08`

**Working branch `fleet/measure-2026-08`** created from `75baddd`. Product
source is byte-identical to the rescue commit and stays that way.

## 4. Instruments located — all byte-exact

| Artifact | Path | sha256 (head) |
|---|---|---|
| **Persona fleet (250)** | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` | `e564b1dd…57704e` |
| Persona generator | `…/qa-fleet-20260729-2032/personas.mjs` | `31dc0dff…c06d0` |
| **Consolidated brief** | `docs/surgery/CAMPAIGN/solver-deepdive/CONSOLIDATED-BRIEF.md` | `efdbe1a1…55d488` |
| Rig — runner | `docs/surgery/CAMPAIGN/solver-brain/A1/rig/runRig.mjs` | `85fa7da6…a6758c` |
| Rig — comparator | `…/A1/rig/compare.v2.mjs` | `b8e959d9…3281c2` |
| Rig — schema (⚠ the `judged` defect, claim A6) | `…/A1/rig/schema.mjs` | `0bed337a…09b03e` |
| Rig — db integrity | `…/A1/rig/checkdb.mjs` | `27f83a24…8ab455` |
| Rig — seed registry | `…/A1/rig/seeds.mjs` | `c92e81c1…984322` |
| **Macro closer** | `backend/src/lib/macroCloser.js` | 183 lines, 8,956 bytes |

**Seeds (canonical, from `seeds.mjs`):** primary **424242**, replicates
**20260730** and **8675309**, smoke 1337 (`--n=25`). Under `pop=personas` the
population is fixed and the seed drives only the solver RNG stream
(`rng_i = mulberry32(childSeed(seed, persona.idx))`). **Every compared run uses
the same seed set. No number ships without its command + seed.**

Sizes for orientation: `weeklyPlanner.js` 1,087 lines · `mealSolver.js` 1,463 ·
`planContext.js` 268 · `macroCloser.js` 183.

## 5. The brief — read in full, distilled

646 lines, read end to end. Distilled to **`fleet/BRIEF-CLAIMS.md`**: 12
sections, ~90 numbered load-bearing claims, each with the brief's number, the
agent that tests it on real data, and a blank verdict column W5-1 fills.

**The brief materially contradicts this prompt's own condensed block** on the
ruler, on the honesty bug, and on the baseline level. Per the prompt's
instruction the brief wins; the six divergences are tabulated in
`DECISIONS.md` D-3, and W3-1 and W1-4 are re-scoped from *confirm* to
*adjudicate*.

## 6. Findings made during preflight

**H1 / TRIAGE T-1 — the allergen gate fails open (CONFIRMED, currently unreachable).**
The brief marked this "unproven, not wrong." It is now proven on the real DB:
`allergenTags` and `mayContain` are **NULL on 14,151 of 14,151 rows**, and
`Nutritional powder mix (Isopure)` — a whey isolate — returns *not excluded* for
whey, dairy and milk, and *allowed* for vegan. 13 of 17 rows in that category
behave the same. **Zero are reachable** (0 recipe references, 0 in the ten-name
adjuster list) ⇒ filed **P1-latent**, with a hard gate on W3-6 and on W5-1's
recommendations. Full reproduction in `fleet/TRIAGE.md`.

**K1 confirmed live, immediately.** `grep -n "^export" dietaryFilter.js` returned
**nothing**; a Node import of the same file listed **40 exports**. The NUL-byte
blindness is real and it bit within the first ten minutes. Every agent is
instructed: **negative grep results on that file are void — use `git grep`,
`Read`, or Node.**

**G3/G8 confirmed by inspection.** `ADJUSTER_CANDIDATES` is exactly the ten-name
hardcoded constant at `planContext.js:167-178` (Olive Oil, Butter, Avocado,
White rice, Potatoes, Oats, Chicken breast, Greek Yogurt, Tofu, Lentils).
`macroCloser.js` was indeed untracked at run start.

## 7. DoD

- [x] `fleet/state.json` + `fleet/PROGRESS.md` created **before** any other work
- [x] Environment verified · DB fingerprinted (hash + counts + macro fingerprint)
- [x] All uncommitted work committed to `campaign-2026-07`; push blocked → bundle
- [x] `fleet/measure-2026-08` created from the rescue commit
- [x] Brief read in full, hashed, distilled to `BRIEF-CLAIMS.md`; divergences logged
- [x] Persona fleet located **byte-exact** — no FALLBACK FLEET caveat needed
- [x] Rig, seeds, closer located and hashed
- [x] `fleet/00-rescue.md` written; ledger initialized
