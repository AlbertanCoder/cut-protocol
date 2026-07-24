# Cut Protocol — 12 Independent Customer Simulations

*2026-07-23. Twelve agents, each a distinct real-world customer, each grounded in a REAL meal
plan the engine generated for them (via `scripts/qc/personaPlan.mjs`) plus a read of the screens
they'd actually meet. Fully independent — none saw another's findings. This is the raw voice of
the customer, triaged into what I fixed tonight and what needs your call.*

## The customers
1. Busy parent, dairy allergy, hates long cooking · 2. Physique competitor, hard cut, weighs grams
3. Vegan + gluten-free student · 4. GLP-1 patient, low appetite, muscle-loss fear · 5. 63-yo
beginner, non-technical · 6. Strict keto (<30 g carbs) · 7. Anaphylactic tree-nut + shellfish + egg
8. UK/metric Mediterranean nurse · 9. Quant who verifies every number · 10. ED-recovery, floor must
hold · 11. 140 kg trucker, first attempt · 12. Petite 50 kg woman, low TDEE.

---

## ✅ Fixed tonight (verified, committed, tests added)

### 1. P0 allergen leak — tree-nut checkbox omitted chestnut/nutella
Customer #7 (anaphylactic) found the UI's **"Tree nuts"** checkbox sends the key `"tree nuts"`,
whose list had **drifted** from the internal `"nuts"` list — chestnut and nutella were missing, so
"Cooked Chestnut" (a real recipe ingredient) reached a tree-nut-allergic user. Worse, the **entire
QC harness was testing the wrong key** (`"nuts"`, which no checkbox sends), so every prior "0
leaks" never exercised the real tree-nut path. Fixed the list, the oracle, and the harness keys;
added a **drift-guard test** so the two lists can never diverge again. `matchesExclusionTerm(
"Cooked Chestnut","tree nuts")` now true; water chestnut still safe.

### 2. Floored-rate honesty — tell the user the rate they'll actually get
Customers #10, #11, #12 (independently) hit a target clamped to the safety floor and were only told
"not achievable" — with no real number, and Today still showed the *chosen* rate as if it were
happening. `deriveTarget` now exposes the **achievable rate** ((TDEE − target) × 7 / 3500), shown on
Engine, Today, and Profile. Honest and supportive, no golden impact.

---

## ✅ Also fixed after the initial triage (all golden-safe, verified)
- **A. Keto is now ketogenic** — `computeMacros` keto branch (carbs capped ~25g, fat fills the
  balance) + a scale-invariant recipe carb-FRACTION filter. Verified: a keto week now averages
  **25g carbs/day** (was 32–117g). Golden byte-identical (keto-only branch).
- **B. Recipe monoculture** — the generated "High-Protein X & Y with Z" templates are now
  down-weighted so REAL recipes win when they fit. The 140kg omnivore's week went from ~4 TVP
  dishes/day to 5 generated all week (real food otherwise), protein still met. Golden byte-identical.
  *(Remaining: the generated recipes are still generically written — real thin-diet variety needs
  authored recipes, a data task. Queued below.)*
- **F. Prose-vs-ingredient allergen leak** — the "Beef Banh Mi … Sriracha Mayo" whose steps declared
  "Add'l ingredients: mayonnaise" but had no egg row is now excluded for an egg allergy. New
  `qc:recipe-allergen` audit found 2 such high-confidence drops + 76 incidental prose mentions.

## 🟠 Queued — real, but touches the plan goldens / laws / product-shape (your call)

These I did NOT change unilaterally overnight: each alters the deterministic plan output (breaking
the byte-identical BRAIN=off goldens), fabricates data, or is a product/taste decision. Root causes
and file locations are the agents' own.

### A. **"Keto" mode isn't ketogenic** — highest-value correctness finding (customer #6)
`bmrEngine.computeMacros()` never branches on `dietaryStyle`: protein/fat come from one fixed
lean-mass formula for every diet, carbs are just leftover kcal. Result: a "keto" week ran **32–117 g
carbs/day against a 30 g ceiling** — 5 of 7 days over, two days 4×. And the per-recipe keto ceiling
checks the **unscaled base** `recipe.carb`, but the solver scales portions up to 2×, so a dish
cached at 28 g ships 57 g. *Fix:* give keto its own macro formula (hard carb cap, fat fills the
rest) and re-check the ceiling against the **scaled** serving. *Why queued:* changes macro targets →
changes plans → golden rebaseline needed.

### B. **Recipe "variety" is one template in 40 costumes** (customers #2, #3, #5, #11, #12)
`scripts/genProteinForward.mjs` generates ~50 mechanical `High-Protein [TVP/Tempeh/Egg White/…] &
[Veg] with [Rice/Potato/…]` recipes — 40% of a vegan+GF pool, and they **out-compete real meat even
for `diet=none`** (they hit protein density exactly). The trucker got TVP/seitan 4 of 7 days having
picked no diet. *Fix options:* a same-family per-week cap in the solver, or give the generator real
technique variety (curry/stir-fry/taco), or down-weight generated recipes vs real ones. *Why
queued:* solver scoring change → goldens; or recipe-data authoring.

### C. **Snacks are unsolvable for many diet/allergy combos** (customers #1, #3, #4, #7)
Only ~9 snack-eligible recipes exist; dairy-free + 2 snacks/day leaves slots empty and the day
lands under target. The app is honest about it ("set snacks to 0"), but it's a dead feature for
common cases. *Fix:* add snack recipes (data), or redistribute unfillable snack calories into meals.
*Why queued:* recipe data (don't fabricate) or solver change (goldens).

### D. **The live food library is the raw USDA dump** (customer #8, UK)
14,124 foods, but 13,516 are the unfiltered USDA import: "Walrus/Squirrel (Alaska Native)",
"Frybread (Apache)", 38 near-duplicate "chicken breast" variants, US brand names — and **zero** UK
staples (no Tesco/Sainsbury's/Warburtons/Quorn). Search is polluted. *Fix:* a "common foods" filter
or rank the curated ~850 first in search; import branded/regional coverage via Open Food Facts.
*Why queued:* product decision; NOT deletion — those rows are validated data you may want.

### E. **Per-meal protein distribution isn't scored** (customer #2, competitor)
The solver checks only a **daily** protein floor; one meal can be 38 g and another 51 g. Twice-a-day
trainers need spread. "Protein-priority mode" also only defends the daily number. *Fix:* per-meal
floor (daily ÷ meals ± tol) in the solver + show meal-to-meal delta. *Why queued:* solver → goldens.

### F. **Recipe prose names an allergen its ingredient list doesn't** (customer #7)
"Beef Banh Mi Bowls with Sriracha **Mayo**" — the step text says mayonnaise, but no egg/mayo
ingredient row exists, so the (correct) egg filter never sees it. *Fix:* at import, cross-check
`recipe.steps` text against declared ingredients and flag allergen words that appear in prose but
not structured data. *Why queued:* data-integrity pass; important for allergen trust.

### Smaller queued items
- **Displayed math doesn't reproduce to the last kcal** (#9): TDEE is computed from the *unrounded*
  RMR but the UI shows the rounded one (2338 vs 2337). Fix = show 1 more RMR digit (display-only,
  safe) — queued only to batch with the citations work.
- **Citations exist but are never rendered** (#9): `bmrCitations.js` provenance reaches the Engine
  props and is dropped. Cheap, on-brand trust win — render per-formula on hover.
- **Partial-meal logging** (#4): diary is binary "ate as planned" vs manual entry; low-appetite
  users want a "% eaten" slider that scales the macros. New feature.
- **Onboarding doesn't ask appetite / suggest meal count** (#4): the working config (4m+1s,
  protein-priority) exists but nothing surfaces it; both natural attempts (fewer big meals / more
  tiny ones) fail in opposite ways.
- **kcal tolerance doesn't tighten as the rate climbs** (#2): a hard cut gets the same ±15% as a
  lazy one.
- **Jargon wall** (#5): TDEE/RMR/Katch/Cunningham/MET thrown at a non-technical beginner; wants
  plain labels first, formulas behind an "advanced" toggle, and "Verdict/Stamp" renamed off the
  report-card feel.
- **Metric rate picker still bold-shows lb/wk** (#8): every other Profile number converts; this one
  shows kg/wk only as grey subtext.

---

## 🟢 What is genuinely working (customers said so, unprompted)

- **The safety floor hard-clamps and never bends.** #10 (ED-recovery) tried the fastest rate on a
  lean body and could not talk it below 1,279 kcal; #9 hand-verified the clamp; #12 confirmed it
  refuses to go lower. This is the load-bearing safety property and it holds in the real output.
- **No-red / no-shame color law holds** even at the worst verdict tier — #10 verified it in
  `theme.js` (bad → amber, never red), and the NEDA screening link is present, opt-in, untracked.
- **Allergen exclusion is clean** on every run for every persona (once the tree-nut key is fixed) —
  the independent re-check found 0 leaks across all customers' plans.
- **The honesty layer is real, not marketing** — the solver declares "unsolvable + why" instead of
  faking a week, never suggests loosening an allergy, and explains the protein-density math (#1, #3).
- **The BMR math is correct** — #9 hand-verified every formula, the LBM-gating, occupation
  multiplier, and training kcal across 5 runs with no exceptions.

---

## Recommended priority (my honest ranking)
1. **Keto macros (A)** — a "keto" mode that isn't keto is a correctness/trust failure for a named
   feature. Highest value.
2. **Recipe monoculture (B)** — it degrades *every* customer's experience and undercuts the whole
   "variety" claim; also the root of the snack and meat-substitute complaints.
3. **Food-library curation (D)** — the thing most likely to make a real user close the app.
4. **Recipe prose-vs-ingredient allergen cross-check (F)** — cheap, and it's allergen trust.
5. Citations render + display-math precision (#9) — cheap, on-brand, and wins the skeptic.

Each of A/B/E/F is a solver/goldens change — say the word and I'll do them one at a time with a
golden rebaseline and a review diff, per the constitution.
