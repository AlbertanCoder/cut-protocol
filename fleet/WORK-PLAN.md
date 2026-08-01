# FIX WORK PLAN — derived from the 2026-07-31 fleet

**Status of the source run:** 19 of 25 agents completed. W3-7, W4-1, W4-2, W4-3,
W5-1, W5-2 never ran. **There is no `FLEET-REPORT.md`** — W5-1 produces it.
This plan is assembled by hand from `fleet/state.json` + the 18 `out/*/FINDINGS.md`
artifacts, and it substitutes for the missing synthesis until W5-1 runs.

All code locations below were re-verified against the working tree on 2026-08-01.

---

## The structural warning — read before touching any performance lever

The fleet is a **measurement** campaign whose verification stages did not run:

| Agent | Job | Status |
|---|---|---|
| W3-7 | best-stack-probe — **run the combined trim+portioner arm** | ✗ never ran |
| W4-1 | reproduce | ✗ never ran |
| W4-2 | laws-sweep (test suite) | ✗ never ran |
| W4-3 | reconcile | ✗ never ran |

Consequence: **the two biggest numbers cannot be added.** W3-4 measured the trim
arm at **+12.60 pts**; W3-2 measured the portioner at **+12.36 / +10.91 pts**.
Their rescued-day pools **overlap 82.7% vs 80.3%**. W3-4's own recommendation:

> "Run ONE combined arm before crediting either — the trimmer's residual over a
> good portioner is the only number that matters."

That combined arm is precisely W3-7, the agent that died. **Tier 4 is therefore
blocked on re-running the fleet tail.** Tiers 1–3 are not — nothing in them
depends on a contested number.

Additional reconciliation debt already logged by the fleet itself:
- W2-2's "20 attempts ≈ 2.46 independent" is **void as arithmetic** (W3-5
  measured 1.92); its *conclusion* survives.
- W1-1/W1-2 adjusted claim A1 (623 is `judged`, not all-planned).
- Five non-interchangeable denominators are in circulation. Canonical
  recommendation: **satisfiable-planned minus degenerate, n=553.**

---

## TIER 1 — Live honesty defects (ships today, violates the constitution)

The project constitution says *"Solver declares 'unsolvable + why' — silent
target misses are forbidden."* W1-4 reproduced a **4,623 kcal day against a
2,000 kcal target carrying zero warnings.** These are live.

| # | Defect | Location | Evidence |
|---|---|---|---|
| 1.1 | Server trusts the client's `warning` field — the only un-recomputed field on the path. Sibling code 40 lines away does it correctly. | `backend/src/routes/plans.js:110`, hardcoded `warning: null` at `:625`, correct sibling `:669-678` | E8 CONFIRMED verbatim |
| 1.2 | **Over-fat days render as a met floor.** `kind="floor"` ⇒ `ceil` null ⇒ `over` always false ⇒ can never tint amber. Fat is the *dominant* failure macro and the solver grades it two-sided. | `frontend/src/components/TodayTab.jsx:137` | E3 CONFIRMED. Flagged deliberate at `:76-87` ⇒ **product decision, not a blind bug** |
| 1.3 | `TodayTab.jsx` matches `/warning/i` on **zero** lines of 55,843 bytes. `PlanSlot.warning` — the only signal surviving restart — renders on one screen, and it is not the daily one. | `frontend/src/components/TodayTab.jsx` | E3 CONFIRMED |
| 1.4 | No day-verdict / diagnosis column exists. `genMeta` is `useState(null)` with 2 writes, both inside `generate()`. Tab switch or reload ⇒ **the plan survives, the verdict on it does not.** | `schema.prisma:493-527`, `PlanTab.jsx:750/877/890` | E2 CONFIRMED. Needs a migration |
| 1.5 | `setGenMeta` never cleared on mutation ⇒ after a swap the card shows the **pre-edit** week. | `PlanTab.jsx` | E8 |
| 1.6 | Metric integrity: headline must pin to **all planned days**. Refusal pays **+30.18 pts free** on `judged` and **+0.00** on planned. | reporting convention | W1-4 inflation trap |

**1.2 is a decision, not a patch.** The floor rendering is deliberate. Fixing it
makes previously "green" days show amber — correct, but it changes what users see
overnight. Constitution law (b) forbids red; amber is the sanctioned treatment.

---

## TIER 2 — Correctness bugs that gate the levers ✅ COMPLETE 2026-08-01

W3-4: *"Ship the G4 guard fix and the E4 warning re-derivation regardless —
correctness, prerequisites, not levers."*

| # | Commit | Outcome |
|---|---|---|
| 2.1 G4 | `f56a155` | Fixed — guard compares overage size, not band membership |
| 2.2 E4 | `79523f6` | Fixed — closer reports `slotIndex`; planner restates the slot's real kcal |
| 2.3 G6 | `602f06c` | Fixed — adjusters spread least-loaded-first across plates |
| 2.4 G5 | `d368acd` | Fixed — **3 changes**, not 1: the trust columns were missing from the checksum too |
| 2.5/2.6 optimizer | `e96df4f` | Step bound fixed; weight trap **pinned, not changed** — see below |
| 2.7 A6+ | `bb83665` | **Not a product defect** — `mealsPerDay` is validated 1–8, so the 0-slot config is unreachable. Floor locked by test |

Suite: **1,491 → 1,515 tests, 0 failures** at every step. Nothing pushed.

Every fix carries a test verified to FAIL against the pre-fix source rather than
assumed to. Four fleet findings were reproduced independently in the process
(G4 101.48 g vs their 101.5; G6 358 g vs their 375 g; E4's p115 sign inversion;
G5's mechanism) — their numbers hold up.

**Open decision from 2.6:** the optimizer's default weights price raw squared
errors, making fat ~11,000× cheaper than kcal. Deliberately left alone —
nothing reads `residual`, and `brain/create.js` always passes k=2 so the
gradient path is unreachable. **Whoever wires the brain up owns choosing the
normalisation**; a test measures the current ratio so it cannot ship silently.

### Tier 2's measured effect on compliance (2026-08-01)

Tier 2 shipped on test evidence alone. Tests prove correctness, not that the
headline metric held — and G4 makes the closer **refuse** adds it used to make,
which could as easily have cost points. Measured after the fact, paired: same
three canonical seeds, same DB (`d9037dce…`), same 250 personas, **only the code
differs**. Baseline tree pinned at `962ac88` in a separate worktree.

| seed | satisfiable (n=537) | all-planned (n=640) | closer fired on |
|---|---|---|---|
| 424242 | 77.3% → 77.8% (+3 days) | 68.0% → 68.8% (+5 days) | 254 → 124 |
| 20260730 | 77.8% → 78.4% (+3 days) | 68.6% → 69.2% (+4 days) | 259 → 122 |
| 8675309 | 76.9% → 77.5% (+3 days) | 67.7% → 68.3% (+4 days) | 262 → 130 |
| **pooled** | **77.34% → 77.90% (+0.56 pp)** | **68.07% → 68.75% (+0.68 pp)** | **775 → 376 (−51%)** |

**The headline is not the +0.68 pp — it is the −51%.** The closer now acts on
half as many days and compliance went **up**. It was actively harming a large
share of the days it touched, which is precisely what G4 predicted and what the
106/106 fat-worsening figure described.

Magnitude honesty: +0.68 pp is small, and per-seed it sits inside the ~0.9 pp
cross-seed spread W1-2 measured — a single seed would prove nothing. What carries
it is that this is a **paired** comparison and the sign is consistent **3 of 3
seeds on both denominators, 6 of 6**. It also lands close to W3-4's independent
prediction for G4+E4 (+0.84).

Instrument checks clean on all six runs (disagree 0 · drift>1 0 · missing-food 0
· crashes 0 · net 0). The harness reproduced the fleet's published baseline
exactly (77.3% / 69.8% / 68.0% at seed 424242), which validates it before Tier 4
depends on it.

Evidence: `fleet/out/P0prefix/` (baseline worktree) and `fleet/out/P0postfix/`.

| # | Defect | Location | Scale |
|---|---|---|---|
| 2.1 | **G4** — `wouldHarm` returns `isOver && !wasOver`, so an **already** out-of-band macro is unprotected. The one day that most needs the guard is the one day without it. Docstring: *"'No worse' is the whole rule."* | `backend/src/lib/macroCloser.js:86-91` | **106/106** fat worsenings; 68/110 carb. Worst +16.1 g. Magnitude modest (~1.34 g/day) but direction universal |
| 2.2 | **E4** — stale slot warnings; sign wrong on some. A naive trim would have **multiplied this 4.6×** and flipped 93 slots. | closer + warning derivation | 15/250, worst 701 kcal |
| 2.3 | **G6** — every adjuster lands on **slot 0**; `slots.find` takes the first eligible and never reconsiders across all 3 rounds. | `backend/src/lib/macroCloser.js:116` | 250/250. Worst 123→685 kcal (×5.56), 375 g on one plate |
| 2.4 | **G5** — `_adjusterFoods` has **no invalidation path**. A Food row quarantined for bad macros keeps being served to real users until process restart; the `macroTrustIssue` re-check reads the stale cached object so it cannot catch it either. | `backend/src/lib/planContext.js:182` | Mechanism single-branch; not reproduced end-to-end |
| 2.5 | `brain/optimizer.js` step size can exceed the Lipschitz limit **n-fold** (~3.5× at k=7). Won't explode — the box clamp catches it — it **oscillates and returns a bad point silently** after 200 iterations. | `backend/src/lib/brain/optimizer.js:91` | Fix: `1/(2·n·maxCol)` or delete `solveGeneral` |
| 2.6 | `brain/optimizer.js` default weights `{kcal:1, protein:1, fat:0.1, carb:0.1}` on **raw squared** errors ⇒ fat down-weighted ~4 orders of magnitude. Comment calls it *"low weight"*; it is **structural invisibility**. This is B3 reproduced in a second transcription. | `backend/src/lib/brain/optimizer.js:42` | — |
| 2.7 | **A6+** — the 0-slot persona (p233) emits **no record** (n=639 not 640) and returns `diagnosis: null`. The single silent miss in the whole fleet. | solver emit path | 1/250 |

---

## TIER 3 — Latent safety (unreachable today, live land-mines)

All three are currently **unreachable** — which is why they are P1 and not P0 —
but Tier 5's obvious move (author vegan protein) walks straight into T-1.

| # | Defect | Detail |
|---|---|---|
| 3.1 | **T-1 — allergen gate fails OPEN on protein/nutritional powders.** `allergenTags` and `mayContain` are **NULL on 14,151 of 14,151 rows**. A whey isolate returns *not excluded* for whey/dairy/milk and *allowed* for vegan. 13 of 17 rows behave identically. | 0 recipe references, 0 in `ADJUSTER_CANDIDATES` ⇒ unreachable **today** |
| 3.2 | **T-3 — peanut-allergic users are not protected from lupin.** `foodMatchesExclusionTerm(lupin, peanuts) === false`. The cross-reaction is documented **in prose** at `allergenTaxonomy.js:635` with no code consuming it. | 3 lupin rows in DB, inert |
| 3.3 | **H5 — the mirror defect: over-exclusion.** Allergen prose has **no polarity** ("made without sesame oil" *excludes*), and unrecognised free-text terms match by **bare substring** ("oats" hits "Goat cheese"). | Found by W3-6 while authoring |
| 3.4 | **H3** — 57/57 gluten-free pasta recipes hidden from celiacs; 53 carry no gluten at all. | W1-5 |
| 3.5 | **T-2 — OPEN, never performed.** The full false-negative leak sweep. This is a **gap, not a finding.** | Requires its own pass |

---

## TIER 4 — Performance levers (BLOCKED on the fleet tail)

Do not implement until W3-7 + W4-1 + W4-3 have run. Listed for completeness.

| Lever | Measured | Caveat |
|---|---|---|
| Trim arm (fat **+ carb**) | **+12.60 pts** | All safety gates verified zero. **But 83.2% of trimmed slots land below 0.7× reference, 51.9% pinned at the 0.5 floor** ⇒ plate-realism decision required. Fat-only would be +9.46; keto goes +1.72 → +20.69 with carb included |
| Portioner C14 + C2 | **+10.91 pts** | ~0 warned cost, **30% faster** than baseline. One line plus one constrained search |
| **Combined** | **UNKNOWN** | 82.7% overlap. **Must not be summed.** This is W3-7's job |
| Kill/fix adaptive-attempts rule | **+2.17 pp** | Currently a **net harm**, and the entire loss lands on **vegan (−11.43)** and **keto (−9.77)** — the diets its own docstring claims to protect. `floor(pool/10)` clamps to MIN 5 on ≤53-recipe keto pools |
| LNS selection | +2.95 | For +15.7% work; beats a 2.4× attempt budget, 0 cap breaches |
| Free permutation | **+0.00** | Adjacency 496→5 incidences (−99%) at **exactly zero compliance cost.** Pure win |
| Ruler E35k → R35k | +2.77, +2.17 | Ruler share is only ~2.2–2.8 pts total. **Solver share is ~22 pts.** The ruler was never the lever |
| Variety: category quota | — | Replace the 0.35× multiplier; a quota costs zero until it binds |
| ~~C4 / floor25~~ | ~~+5.00~~ | **UNSHIPPABLE** — puts 31.2% of slots below 0.5× |

---

## TIER 5 — Data & authoring

| # | Item | Detail |
|---|---|---|
| 5.1 | **Snack starvation is authoring, not search.** 18 snack recipes library-wide; **135 of 141 empty snack slots are arithmetically unfillable a priori.** | No amount of solver work fixes this |
| 5.2 | **Vegan gap still open** — 17/30 vegan personas have 15 meals / 0 snacks / 0 clearing their own gate. `seedGapRecipes` authored **into** the exclusion set | — |
| 5.3 | W3-6 measured +7.72/+8.92 from 10 authored snacks — **but the gain is FAT, not protein.** 99 of 145 rescued days were fat:over, only 3 protein; 550 of 562 placements **displaced a fattier snack** rather than filling an empty slot | Re-aim before authoring more |
| 5.4 | **All 18 "wall" personas also exclude legumes**, killing 6 of the 10 proposed dishes | Missed by both W2-3 and W1-5 |
| 5.5 | `fatMid` is fixed in grams while `targetKcal` falls ⇒ **prescribed fat %E RISES as the cut deepens** — backwards from every source | W2-6 |
| 5.6 | **232/250 personas are graded COMPLIANT below the engine's own essential-fat floor** (0.2475 vs `ESSENTIAL_FAT_PER_LB_LBM` 0.30) | W2-6 |
| 5.7 | 167 wrong food records, 86 in use across 167 recipes | W1-5 |

---

## TIER 6 — Infrastructure / housekeeping

| # | Item |
|---|---|
| 6.1 | **Push `campaign-2026-07` + `fleet/measure-2026-08`.** Neither is on origin. The rescue exists only on this machine + `~/Desktop/cut-protocol-rescue.bundle`. **Repo is PUBLIC** — decide on the 2,041 campaign files first |
| 6.2 | Guard regex `/--force\b|(^|\s)-f(\s|$)/i` is case-insensitive ⇒ blocks `-F` (read message from file). Drop the `/i` |
| 6.3 | **K1 — `dietaryFilter.js` contains NUL bytes**: `grep` returns *nothing* while Node lists 40 exports. **Negative grep on that file is void.** Use `git grep`, Read, or Node |
| 6.4 | `fleet/PROGRESS.md` is stale (20:29) vs `state.json` (22:07) and mislabels finished agents as pending |
| 6.5 | K2c — the rig and `runSolve` drop `applyFilterStack` (32/250 personas, −69.9% worst pool). Level-inert but day-pairing-fatal |

---

## Recommended order

1. **Resume the fleet tail** (6 agents) — unblocks Tier 4 and produces the real report.
2. **Tier 2** — correctness prerequisites; the fleet says ship these regardless.
3. **Tier 1** — live honesty defects (1.2 needs a product call first).
4. **Tier 3** — latent safety, *before* any Tier 5 authoring.
5. **Tier 4** — levers, once reconciled.
6. **Tier 5** — authoring, re-aimed at protein per 5.3.
