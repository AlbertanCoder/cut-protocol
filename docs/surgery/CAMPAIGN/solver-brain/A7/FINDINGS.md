# A7 — Vegan feasibility under the killer allergen stack

*Agent A7. Persisted to disk by the fleet coordinator from A7's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A7's.
A7's scripts and its 10 `CLAIMS.tsv` rows DID land.*

## VERDICT: **LIBRARY problem, not a botany problem** — with one real caveat

Botany supplies legal vegan protein concentrates that survive *every* wall in the stack.
The library contains **none of them**. The wall is authored, not natural.

**The caveat is not small:** on **whole foods only** it genuinely *is* a botany wall. The
two answers differ entirely by whether a protein concentrate counts as food — that is a
product decision, not a solver one.

## The tier, quoted

`personas.mjs:255-256` — `const kill = ['soy','gluten','peanuts','tree nuts','sesame']`
plus `'legumes'`; `dietaryStyle = 'vegan'`, `rateLbPerWeek = 2`, `proteinPriority = true`.
Its own claim (`:251`): *"There is no combination of library rows that can hit an
LBM-derived protein band here."*

**That sentence is literally true and A7 confirms it. The BRIEF's gloss — that the tier is
unsatisfiable *by design* — overreaches. It is unsatisfiable by *this library*.**

## 1. Required density — DERIVED (app's own `bmrEngine`)

`computeEnergy` → `deriveTarget` → `computeMacros`; required protein = `0.85 ×` band
midpoint (the 15 %-short rule).

| persona | targetKcal | P band | P req | **req g/100 kcal** | fat band |
|---|---|---|---|---|---|
| M 180cm 85kg bf20 | 1776 | 171–187 | 152 | **8.57** | 51–60 |
| M 175cm 95kg bf28 | 1832 | 172–188 | 153 | **8.35** | 51–60 |
| M 190cm 78kg bf12 | 1783 | 173–189 | 154 | **8.63** | 51–61 |
| F 165cm 70kg bf30 | 1369 | 123–135 | 110 | **8.01** | 37–43 |
| F 172cm 62kg bf22 | 1358 | 122–133 | 108 | **7.98** | 36–43 |

**Required band: 7.98–8.63 g protein per 100 kcal.**

## 2. What survives — MEASURED through the shipping gate

`exclusionGate.isExcluded(food, profile)`: **4,634 of 14,151** Food rows survive. Only
**29 of 910** recipes have every ingredient survive.

| g/100 kcal | best in-library vegan bulk staple |
|---|---|
| **5.81** | Seeds, pumpkin seeds (pepitas), raw — 29.9 g/515 kcal |
| 5.71 | Seeds, hemp seed, hulled — 31.6 g/553 kcal |
| 4.34 / 3.85 / 3.83 | Oats / Buckwheat / Quinoa |
| 3.56 / 3.50 / 3.47 | Sunflower kernels / Flaxseed / Chia |

**Ceiling 5.81 vs required 7.98–8.63 → 27–33 % short.** And that ceiling is not even
deliverable: a full day of pepitas is **158 g fat against a 51–60 g band (2.6×)**. The real
whole-food ceiling is well *below* 5.81. Not a narrow miss.

## 3. The library gap — MEASURED, `0 rows` each

`rice protein`, `brown rice protein`, `potato protein`, `hemp protein`, `sunflower
protein`, `nutritional yeast`, `torula`, `chlorella`, `pumpkin seed protein` — **zero rows,
all of them.** Every concentrate the library *does* carry is correctly walled: soy isolate
`[soy,legumes]`, pea protein `[legumes]`, vital wheat gluten `[gluten]`, whey
`[style:vegan]`.

Nutritional yeast is **13.3 g protein/100 kcal** (53.3 g P, 400 kcal/100 g)¹ — it clears
the requirement by **1.5–1.7× on its own**. Rice and potato protein isolates sit higher.
None is a soy, gluten, peanut, tree nut, sesame or legume.

**Classification calls** (the answer depends on them): hemp = *Cannabis sativa*,
Cannabaceae — **not** a legume; sunflower = *Helianthus*, Asteraceae — **not** a tree nut,
and the app agrees (own `sunflower` allergen family, `allergenTaxonomy.js:700`); buckwheat
= Polygonaceae — **not** gluten (`:498` *"Buckwheat is NOT a wheat and NOT gluten"*). Pea
**is** a legume and is correctly killed — `legumes.nameKeywords` includes `"pea"` (`:484`).

## 4. Two defects found on the way

**(a) Dietary-style leak in the shipping gate — MEASURED.**
`isExcluded(food, {dietaryStyle:'vegan'})` returns **false** for: Squirrel, Groundhog,
Armadillo, **Wild pig**, Heart, Owl (horned, flesh, raw), Sea cucumber, Ceviche, Hog maws,
Bear, Dove, and **Nutritional powder mix (Isopure)** — a whey isolate. Chicken and
jellyfish are correctly caught. **Latent, not realized:** no recipe in the 910 corpus
contains these rows, consistent with the BRIEF's "0 confirmed leaks." Any surface gating
*individual Food rows* (macroCloser's adjuster pool is one) can reach them. Flagged for
A20/A3 — not A7's assignment to chase.

**(b) `Egg Plants` — 10.7 g protein / 55 kcal.** Aubergine is ~1 g/25 kcal. A wrong-food
macro row, and it ranks 8th on the surviving-density list.

## 5. Instrument error A7 made — recorded per rule 13

A7's v1 used `styleExcludedByMetadata`, the **metadata arm only**. `allergenTags`/
`fdcCategory` are NULL on most rows, so seal, whale, whey and Swiss cheese ranked as top
"vegan" survivors (6,772 rows). Corrected to the real union gate → 4,634. **A 46 % swing
produced entirely by A7's own harness**, caught by a sanity probe rather than by the number
looking wrong.

## Comparison with A3

Derived independently, before reading A3. If A3 concludes the tier is permanently
impossible, **A7 disagrees in part**: impossible *for this library* (confirmed, by 27–33 %
on whole foods) but reachable with roughly **one authored concentrate row**. It is a
**discontinuity at the concentrate boundary**, not a continuous shortfall.

## Guard block encountered

`docs/surgery/CAMPAIGN/` is CREATE-ONLY (`guard-edit.js`). Could not edit A7's own v1
script; created `-v2` under a new name. Reported, not worked around.

¹ *Nutritional yeast*, Wikipedia, 2026, citing USDA FoodData Central #1946780 (Bob's Red
Mill): 8 g protein / 60 kcal per 15 g → 53.3 g / 400 kcal per 100 g.
<https://en.wikipedia.org/wiki/Nutritional_yeast>. Direct FDC food-detail URLs returned
HTTP 404 to the fetcher (SPA), so **FDC ID 1946780 itself is UNVERIFIED — could not
fetch**; the composition figure is verified via the above.

## Artifacts on disk

`A7/a7-survivors.cjs` (v1, retains the harness error) · `A7/a7-survivors-v2.cjs` ·
`A7/a7-concentrates.cjs` · `A7/a7-gate-probe.cjs` · `A7/a7-arithmetic-v2.cjs` ·
`A7/dev.db` (isolated copy) · 10 rows appended to `CLAIMS.tsv`.

**CONFIRMED**
