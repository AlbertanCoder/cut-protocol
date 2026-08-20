# CUT PROTOCOL — Product Rebuild & Solver Directive

> **Usage:** In Claude Code, from the cut-protocol repo root — `Read CUT_PROTOCOL_DIRECTIVE.md and execute it in full.`
>
> **Written:** 19 Aug 2026. Companion document: `JARVIS_PHASE2_DIRECTIVE.md` (separate repo, separate session — do not interleave them).

---

## 0. ROLE AND STANDING ORDERS

You are acting as the **founding engineering lead of a food-tech company** whose only product is Cut Protocol. You carry four hats and must switch between them deliberately: principal engineer, registered-dietitian-equivalent domain reviewer, QA lead running synthetic customers, and a blunt product owner who kills features.

You are expected to work autonomously for an extended session. The operator is busy and does not want questions every five minutes.

**Standing orders — identical discipline to the Jarvis project, because it worked:**

1. **Audit before you touch.** A working app exists. Read it, inventory it, and document it before changing or replacing anything. Bulldozing prior work without a written record of what it contained is prohibited.
2. **Do not halt waiting for a human.** If you hit a genuine decision that is not yours to make, write it to `docs/BLOCKERS.md`, choose the most defensible default, note the assumption inline, and keep going.
3. **Measure, don't claim.** "The solver works" is meaningless without a persona run and a verification report. Every acceptance gate is an executed test.
4. **No LLM in any arithmetic or safety path.** All nutrition math, allergen checks, calorie floors, and macro verification are deterministic code against a nutrition database. An LLM may *propose* recipes; it may never *certify* their numbers. This is the food equivalent of "no LLM in a safety path" and it is non-negotiable.
5. **Commit at every phase boundary** with conventional-commit messages. Append to `docs/BUILD_LOG.md` at every boundary: what you did, what you measured, what you deferred.
6. **Archive, never delete.** Features removed in the simplification pass move to `/legacy` behind a dead feature flag, with a one-line burial note in `docs/KILL_LIST.md`.
7. If context or time runs out, leave the repo working, tested, and committed, with precise resumption instructions in `docs/RESUME_HERE.md`.

---

## 1. WHAT THIS PRODUCT IS

**A macro-precise meal prescription engine.** The user states goals and constraints once; the app computes their targets and then generates real, cookable meal plans whose numbers *actually add up* — to the gram, verified by machine, respecting allergies absolutely.

The framing is the operator's own and it should shape every screen: **a prescription, not a suggestion.** When you collect a prescription you don't take "roughly some" pills. The app tells you 165 g of chicken thigh and 80 g of dry rice because that is what hits the target, and it expects a food scale (say so once, at onboarding, plainly).

What this product is **not**: a food logger (Eat This Much and MacroFactor already exist), a social network, a recipe content farm, or a wellness blog. Every feature that does not serve *prescribe → cook → hit the numbers* is a candidate for the kill list.

**The solver is the product.** The UI, the photos, the onboarding — all packaging. If the solver cannot reliably hit a user's macros while excluding their allergens, nothing else matters. Resource allocation follows that priority.

---

## 2. PHASE 0 — AUDIT THE EXISTING APP

Stack on record: React/Vite frontend, FastAPI backend, Railway deployment in progress, Google OAuth in progress. Verify all of that against the tree rather than trusting this paragraph.

Produce `docs/AUDIT.md`:

1. **Full feature inventory.** Every screen, button, calculator, and exporter. The operator reports roughly ten calorie calculators, a recipe exporter, and "a bunch of buttons." For each item: USED / DEAD / BROKEN / DUPLICATE, with the file path.
2. **The calculator situation.** The ten formulas are almost certainly correct and valuable — as an *engine*, not as ten screens. Inventory which formulas exist, whether their implementations agree with the published equations (spot-check three against hand-computed values), and mark all of their UI surfaces for consolidation into one (§5.1).
3. **The eating-disorder screener.** It currently sits in the main flow. Document where and how it's wired. It is being *relocated*, not removed — see §8, which specifies the trigger-based design that replaces it. Do not delete the questionnaire content; it gets reused.
4. **State of deployment and auth.** What actually works on Railway today, what the OAuth flow does, where secrets live.
5. **Data model.** What is persisted, where, and whether any recipe/nutrition data already exists.
6. **Test coverage.** What exists, what it covers, whether it runs green.

Commit the audit before writing any new code.

---

## 3. THE SOLVER — THE HEART OF THE PRODUCT

### 3.1 Architecture: deterministic core, LLM at the edges

```
[Recipe pool]  ←  LLM proposes / adapts recipes  →  [Validation gate]  →  only validated recipes enter the pool
      │
      ▼
[Deterministic solver]  ←  user targets + constraints
      │
      ▼
[Verification pass]  →  every plan re-checked: macros summed, allergens scanned
      │
      ▼
[Plan shown to user]  — with the numbers visible, because the numbers are the product
```

- **Nutrition data source:** USDA FoodData Central (public domain, downloadable). Ingest Foundation Foods + SR Legacy into a local table: per-100 g calories, protein, fat, carbs, fiber (net carbs = carbs − fiber, displayed both ways). Every ingredient in every recipe must resolve to an FDC entry or a manually-verified custom entry with a recorded source. An ingredient with no verified nutrition data cannot appear in a plan.
- **Recipes are ingredient lists with gram amounts.** A recipe's macros are *computed* from its ingredients, never stored as asserted totals. This is what makes portion scaling honest.
- **The LLM boundary:** the model may generate recipe candidates (name, ingredient list with proposed grams, method, cuisine tags, prep time, cost tier), adapt an existing recipe to a cuisine, or rewrite cooking instructions. Every candidate passes through the deterministic validation gate: all ingredients resolve to FDC, allergen scan runs, macros computed, sanity bounds applied **per recipe** (a single recipe lands between 150 and 1,400 kcal, protein ≤ 100 g, etc.). Note the unit carefully: a **meal slot may contain multiple recipes** — an OMAD day is one slot holding several dishes — so per-recipe bounds never conflict with large meal structures. Candidates that fail are rejected with the reason logged. Validated recipes are cached — generation cost is paid once, not per user request.

### 3.2 The scaling model

Each recipe declares its **levers** — which ingredients scale, and within what palatability bounds:

- Protein lever (the chicken, the beef, the tofu): typically 0.5×–2.5× base
- Carb lever (the rice, the potatoes, the tortillas): typically 0.3×–2.5×
- Fat lever (the oil, the butter, the avocado, the cheese): typically 0.5×–2.0×
- Fixed aromatics (garlic, spices, vinegar): do not scale, or scale within ±25% — quintupling the garlic to hit a number ruins the dish, and a solver that ruins dishes gets deleted by its user

The solver's job per day: **select** meals from the filtered pool (discrete choice) and **scale** their levers (continuous) so the day lands inside tolerance. Implement as a two-stage approach — candidate selection by greedy/beam over the pool, then a linear-programming refinement of lever amounts (PuLP or scipy.optimize.linprog; both pip-installable and liberally licensed). Hand-rolled greedy-plus-refine is acceptable if LP proves awkward; what is not acceptable is imprecision.

**Tolerance bands (per day):** calories ±50 kcal · protein ±7 g · fat ±7 g · net carbs ±10 g. Tighter is better; looser fails the gate.

**Energy canonicalisation:** FDC's energy value is the canonical calorie figure. Never recompute calories as 4P + 4C + 9F for verification — per-food Atwater factors differ from the generic 4/4/9, and that mismatch alone can exceed the whole ±50 kcal band. Calories and each macro are verified independently, all against FDC-derived values; the 4/4/9 figure may be shown to the user as an approximation but decides nothing.

**Ceilings are not targets:** when a profile declares a ceiling (keto's ≤25 g net carbs), it is a hard constraint. A tolerance band truncates at a ceiling — the band may never license crossing it.

**Ranges and joint feasibility:** a profile may declare a point target (the band applies around it) or a range (the range *is* the band; the solver aims at its midpoint). When calories and all macros are declared together, run a **feasibility check at target-setting time** under FDC accounting — fiber contributes energy, so 4/4/9 over net macros will undershoot FDC calories, and a tightly specified profile can be arithmetically unsatisfiable before the solver ever runs. If infeasible, surface it at target-setting with a one-tap adjustment (carbs flex first, as the filler macro); never hand the solver impossible numbers and let it fail mysteriously.

**Food-scale reality:** after solving, round portions to 5 g increments (1 g for oils, nut butters, and other calorie-dense items), then **re-verify** the rounded plan against tolerance. Display grams *and* a household approximation ("165 g ≈ 1 large thigh").

**Per-meal shape:** the user's stated meal pattern (3+1, OMAD, IF window, 6 meals) is a **hard** structural constraint. The soft constraints — protein spread across meals (target 30–60 g per main meal rather than 180 g at dinner), no meal under 200 kcal unless it's a declared snack — apply only at 3+ meals and always yield to the declared structure; OMAD's single sitting carries the whole day by definition and is not a violation.

**Variety (soft):** no recipe repeats within 3 days unless the user pins it or enables batch mode. Batch mode inverts this: deliberately repeat 2–3 recipes across the week and consolidate the grocery list.

### 3.3 Allergen handling — safety-critical, zero tolerance

This is the part most competitor apps do badly and the part that must never fail. Build a small **allergen ontology** with derived-ingredient mapping, because the failures live in the derivatives:

- **Gluten** ⊃ wheat, barley, rye, malt, malt vinegar, seitan, standard soy sauce, most hoisin, many stock cubes, beer
- **Soy** ⊃ soy sauce, tamari (still soy; only GF-*labelled* tamari is gluten-free — trace-wheat tamari exists), tofu, tempeh, edamame, miso, soy lecithin, many "vegetable oil" blends
- **Shellfish** — model as an umbrella over two distinct classes: **crustaceans** (shrimp, crab, lobster, shrimp paste) and **molluscs** (oyster, mussel, squid, clam, **oyster sauce**). A colloquial "shellfish" exclusion denies the whole umbrella. Surimi is fish-based but frequently carries crustacean extract — classify by actual contents and deny under either when ambiguous. Fish sauce and Worcestershire (anchovy) are *fish*, a separate allergen — model separately
- **Kiwi** — and note latex-fruit cross-reactivity exists but do not auto-exclude; surface it as information only

Rules:

1. Allergen exclusions are **hard constraints at the ingredient level**, checked at recipe validation *and* re-checked at plan assembly. Belt and braces, because a violation is a safety event, not a bug.
2. **Unknown-ingredient policy is deny:** if a user has any allergen profile and a recipe contains an ingredient the ontology cannot classify, that recipe is excluded from that user's pool and the gap is logged for ontology expansion. Never assume safe.
3. The ontology must know the **substitutions** so the LLM adaptation layer can rescue cuisines rather than gutting them: coconut aminos for soy sauce (soy-free *and* gluten-free), GF-labelled tamari for wheat-only exclusions, rice-paper for wheat wraps. This is exactly how "soy and wheat allergy, loves Chinese food" stays a happy customer instead of an unserved one.
4. Every generated plan ships with a machine-written line in its metadata: `allergen_scan: PASS (profile: gluten, soy, shellfish, kiwi) — 0 hits across 41 ingredients`.

### 3.4 Solver performance and the loading experience

Target: **P50 < 2 s, P95 < 8 s** to solve one day. While it runs, show real progress, not a fake bar — the stages are genuine (filtering pool → selecting candidates → optimising portions → verifying) and each can emit an event. The operator explicitly wants the app to *visibly think*; give it honest stages to show.

Cache aggressively: same targets + same constraints + same pool = same plan candidates.

---

## 4. ONBOARDING — ONE PATH, EVERY QUESTION EARNS ITS PLACE

The flow, in order, exactly as the operator specified, one screen per step, progress visible:

1. **Sign in** — Google OAuth (finish the existing integration; it is the only auth path for v1). Two-step verification is inherited from Google's own flow — do not build a second factor.
2. **You** — name, date of birth, sex (needed by the formulas — say why it's asked), optional location, height, weight, units toggle (metric/imperial everywhere, stored metric).
3. **Goal** — lose / maintain / gain. If lose or gain: target rate. Default 0.5% bodyweight/week; selectable up to 1%/week; anything above triggers §8 rails.
4. **Body-fat %** — optional, with a "not sure" path (photos-comparison helper is a later feature; for now a simple visual chart). Presence of BF% unlocks the BF-dependent formulas.
5. **Activity** — activity level plus occupation type (a construction labourer and a desk worker at the same "moderate exercise" setting are not the same person; occupation adjusts NEAT).
6. **The engine runs** — Mifflin-St Jeor, Harris-Benedict (revised), Katch-McArdle, Cunningham, Owen, Schofield, Henry-Oxford, WHO/FAO, Livingston-Kohlstadt, plus any additional formula already implemented in the legacy code that survives the audit's correctness check. Default output: the mean of applicable formulas (BF-dependent ones included only when BF% given), with a "details" disclosure showing each formula's number and a toggle to pin one. **Ten calculators become one screen.**
7. **Targets** — calories and macros proposed (protein anchored to lean mass or bodyweight per standard practice, fat floor ≥ 0.6 g/kg, carbs fill), each editable within the safety rails.
8. **Eating pattern** — dietary style (none / vegetarian / vegan / pescatarian / keto / low-carb / paleo / carnivore), meal structure (3+snacks / IF 16:8 / OMAD / 6 meals / custom), cuisine preferences (multi-select with weights), prep-time preference, budget tier.
9. **Allergies & exclusions** — the big ones as toggles (gluten, dairy, soy, shellfish, fish, eggs, peanuts, tree nuts, sesame) plus free-text additions that must resolve against the ontology; distinguish *allergy* (hard, safety) from *dislike* (soft, preference). The solver treats them differently and the UI must too.
10. **The scale moment** — one screen, once: "This app prescribes portions in grams. A $15 kitchen scale is the difference between guessing and knowing." Dismissible, never shown again.

Then straight into the first generated day. No dashboard of widgets. The reward for finishing onboarding is *food*.

---

## 5. THE PLAN EXPERIENCE

### 5.1 Information architecture — five surfaces, total

**Onboarding · Today · Plan · Groceries · Settings.** Everything in the current app either maps into one of these or goes to the kill list. The ten calculators live inside Settings → "Recalculate targets" and inside onboarding step 6. Nowhere else.

### 5.2 Today (the platter)

The day's meals as cards: photo/illustration, name, per-meal macros, prep time. Tap → full recipe: ingredients in grams (+ household units), method steps, per-ingredient macro table for the curious. Day header: targets vs planned, the four numbers, colour-honest (inside tolerance = quiet; outside = say so).

Actions per meal: **swap** (solver proposes 3 alternates that keep the day in tolerance), **pin**, **repeat tomorrow**, **regenerate day**.

### 5.3 Plan (calendar)

Generate 1 day / 3 days / 1 week / 2 weeks. Batch-cooking toggle (§3.2). Week view shows day-level compliance dots, tap into any day's platter.

### 5.4 Groceries

Union of the plan's ingredients, consolidated (three recipes' chicken thigh = one line), grouped by store section, quantities in purchasable units ("1.2 kg chicken thigh ≈ 1 family pack"), with a per-week cost estimate honest about being an estimate.

### 5.5 Recipes and instructions

Every plan meal is cookable by a tired person: numbered steps, times, no cheffy ambiguity. When the LLM adapts a recipe for scaling or substitution, instructions regenerate to match the actual amounts and swapped ingredients — a recipe that says soy sauce while the ingredient list says coconut aminos fails validation.

---

## 6. IMAGES — LEGALLY CLEAN, NO EXCEPTIONS

The operator is right that photos sell meals, and right to be careful.

1. **Never scrape.** No Google Images, no hotlinking, no "found it online." One infringing image in an App Store product is an expensive mistake.
2. **v1 default: generated illustration set.** A consistent art direction (flat-lay illustration or clean silhouette style, one palette) applied to every recipe. Consistency reads as *designed*; a patchwork of mismatched stock photos reads as cheap. Generate via an image API if one is configured; otherwise ship a deterministic placeholder system (dish-category → styled SVG) that looks intentional.
3. **Openly licensed photos** may be layered in where the licence is verified (record it) and the photo honestly depicts the dish.
4. `docs/IMAGE_PROVENANCE.md` — every image's source and licence, same pattern as Jarvis's voice provenance file. An image without a provenance line does not ship.

---

## 7. PERSONA HARNESS — THE SYNTHETIC CUSTOMERS

The operator asked for agents pretending to be customers. Build it as a **fixture-driven test harness**, not vibes: each persona is a JSON profile that runs the pipeline — targets (declared in the fixture) → pool filtering → solve N days → verification — and the results gate the build. **Personas declare explicit calorie and macro targets in their fixtures**; where this table omits one, set a sane default at build time and record it in the fixture. The harness must never depend on the onboarding engine (Phase 5) to run — the formula engine has its own unit test.

| # | Persona | What it stress-tests |
|---|---|---|
| P0 | **The operator.** 2,150 kcal (hard floor 2,000) · 200–220 g P · 60–70 g F · 135–160 g net C · exclusions: shellfish, gluten, kiwi, soy (all allergy-level) · 3 meals + 1 snack · likes Mexican & grill | The founding customer. High protein under four simultaneous exclusions |
| P1 | Celiac vegan woman, 1,600 kcal | Protein without meat *or* gluten — seitan is pure wheat gluten and must never appear |
| P2 | Soy + wheat allergy, 2,000 kcal, loves Chinese | The derived-ingredient trap: soy sauce, hoisin, many oyster sauces. Coconut-amino substitutions must rescue the cuisine |
| P3 | Keto OMAD, 2,400 kcal, ≤25 g net carbs | One giant meal inside a hard carb ceiling |
| P4 | Budget student, $60/week, 3,000 kcal | Cost tier as a real constraint |
| P5 | Pescatarian Mediterranean, 1,800 kcal | Fish allowed, shellfish allowed — ontology precision in the other direction |
| P6 | Lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese | Hard exclusion + soft dislike handled differently |
| P7 | Override attempter: repeatedly sets 900 kcal and 2%/week | §8 rails: floors hold, check-in triggers, plan generates at the floor, never below |

**Gates (all executed, all in `tests/personas/`):**

- **Zero allergen violations** across ≥200 generated person-days. Zero. One hit fails the build and files the ingredient into the ontology backlog.
- **Zero dietary-pattern violations** across the same person-days — vegan served any animal product, pescatarian served poultry, keto over its ceiling. Hard constraints are hard whether the reason is safety or principle.
- Macro tolerance met on ≥95% of generated days; misses logged with cause.
- Variety rule holds; batch mode consolidates as specified.
- P7's floor holds on 100/100 attempts — **this gate runs at Phase 7**, when §8's rails exist; the Phase 4 gate covers P0–P6.
- Solver latency P50/P95 within §3.4.

Persona runs write `docs/PERSONA_REPORT.md` per run — pass/fail per gate, worst day per persona, example plan per persona rendered in full so a human can eyeball whether the food is *actually plausible to eat*, which no metric fully captures.

---

## 8. SAFETY RAILS — THE OPERATOR'S OWN DESIGN, ENCODED

The current app fronts an eating-disorder self-screener at all users. The operator's call — correct — is that this belongs out of the main path and behind a trigger. Implement exactly that:

1. **Deterministic floors:** absolute minimums 1,500 kcal (male) / 1,200 kcal (female) or the user's computed BMR × 0.8, whichever is *higher* — a deliberately conservative composite of common app-level and clinical guidance, chosen for a v1 that errs toward safety. Per-user floors can be set higher (P0's is 2,000) but never lower. The solver **cannot generate below the floor** — not warn-and-proceed; cannot.
2. **Rate caps:** default 0.5% BW/week, selectable to 1%. Above 1% requires an explicit confirm and is capped at 1.5% absolutely.
3. **The trigger:** if a user attempts to set targets below their floor twice, or repeatedly pushes past the rate cap, a **single respectful check-in** appears — a short questionnaire (reuse the relocated screener content), plainly worded, no shame, with the option to continue *at the capped values* and a quiet pointer to support resources. It appears once per pattern, not on a nag loop.
4. Log the events (locally, privately) so behaviour like P7's is testable.

No lectures anywhere else in the app. The rails do the caring; the copy stays neutral.

---

## 9. MARKET POSITION — WRITE IT DOWN ONCE, HONESTLY

Produce `docs/POSITIONING.md` (use web search if available in the session; otherwise mark claims as unverified-recall):

- Competitor matrix: MacroFactor, Eat This Much, Mealime, PlateJoy, Lifesum, MyFitnessPal, Cronometer — what each actually does well, pricing, and where their meal *generation* (not logging) is weak.
- **The honest edge, in one sentence:** most apps *log* what you ate or *suggest* meals loosely; Cut Protocol *prescribes* plans whose numbers are machine-verified to the gram with hard allergen guarantees. Precision + safety is the moat; polish is not (yet).
- The nearest competitor is Eat This Much; the operator already uses it *as a logger only*. A CSV/import bridge is a later nice-to-have; note it, don't build it.
- What we deliberately don't compete on in v1: social features, barcode scanning, wearable sync, content libraries.

---

## 10. SIMPLIFICATION PASS — THE KILL LIST

After the solver and personas are green, sweep the UI against §5.1's five surfaces. For each legacy feature: KEEP (map to a surface) / FOLD (its logic survives inside the engine, its UI dies — the ten calculators) / ARCHIVE (move to `/legacy`, flag off, burial note in `docs/KILL_LIST.md`).

Judgement standard: would a tired person at 9 pm, phone in one hand, find dinner in under 15 seconds? Every button that doesn't serve that answer is a candidate.

---

## 11. PLATFORM REALITY — SAY IT PLAINLY

- **Now:** a web app (React/Vite + FastAPI), deployed on Railway, used on the operator's desktop. Finish OAuth, make deployment boring and repeatable (`docs/DEPLOY.md`).
- **Mobile scaffolding (build now, cheap):** fully responsive layouts for the five surfaces; PWA manifest + installability so it runs from a phone home screen. That is the correct scaffold and costs little.
- **App Store (later, be honest):** requires a native wrapper (Capacitor is the sane path from this stack), an Apple developer account, review compliance, and real work on touch ergonomics. Write `docs/MOBILE_PATH.md` describing the steps; build none of it now.

---

## 12. ACCEPTANCE TESTS

| Test | Bar |
|---|---|
| `test_nutrition_resolution.py` | Every recipe ingredient in the pool resolves to FDC or a sourced custom entry; unresolvable = recipe excluded |
| `test_macro_arithmetic.py` | Recipe macros recompute from ingredients; stored totals forbidden; spot-check 20 recipes against hand-computed values; calorie verification uses FDC energy, never a 4/4/9 recomputation |
| `test_allergen_zero.py` | §7 gate: 0 violations in ≥200 person-days, all eight personas |
| `test_dietary_hard_constraints.py` | 0 dietary-pattern violations in the same person-days: vegan/vegetarian/pescatarian respected, keto ceiling never crossed |
| `test_derived_allergens.py` | Soy sauce trips gluten *and* soy; oyster sauce trips shellfish (mollusc class); tamari always trips soy and, unless GF-labelled, is denied-as-ambiguous for gluten profiles; coconut aminos trips neither |
| `test_solver_tolerance.py` | ≥95% of generated days inside §3.2 bands, post-rounding |
| `test_floors_hold.py` | P7: 100/100 below-floor attempts refused; check-in fires per §8.3 |
| `test_meal_structure.py` | OMAD yields exactly one meal slot (which may hold several recipes); IF window respected; 3+1 yields 3+1 |
| `test_variety_and_batch.py` | No repeat within 3 days unpinned; batch mode consolidates groceries |
| `test_grocery_consolidation.py` | Duplicate ingredients merge; purchasable-unit conversion sane |
| `test_solver_latency.py` | P50 < 2 s, P95 < 8 s per day, measured over 50 solves |
| `test_onboarding_formula_engine.py` | Each formula matches published equation on 3 reference bodies; mean/pin toggle works |
| `test_image_provenance.py` | Every shipped image has a provenance line; unattributed = build fails |

---

## 13. DELIVERABLES

1. `docs/AUDIT.md`, `docs/KILL_LIST.md`, `docs/BLOCKERS.md`, `docs/BUILD_LOG.md`
2. The nutrition core: FDC ingest, allergen ontology (`data/allergens.yaml` or equivalent), validation gate
3. The solver, with its levers, tolerances, and verification pass
4. The persona harness and `docs/PERSONA_REPORT.md`
5. The five surfaces, responsive, with the onboarding flow of §4
6. `docs/POSITIONING.md`, `docs/DEPLOY.md`, `docs/MOBILE_PATH.md`, `docs/IMAGE_PROVENANCE.md`
7. Green acceptance suite, run output included in the final report — not summarised
8. **Final report, unsold:** what works, what is fragile, what needs real-world tuning, what you would build next. The operator prefers a blunt statement of fragility over reassurance; an inflated report costs him hours of misplaced trust.

---

## 14. EXECUTION ORDER

```
Phase 0  Audit, baseline commit                      ← do first, touch nothing until written
Phase 1  Nutrition core: FDC ingest, allergen ontology, validation gate
Phase 2  Recipe pool: seed ~60 hand-validated recipes across cuisines/diets,
         then LLM-proposed candidates through the gate
Phase 3  Solver: selection + scaling + rounding + verification
Phase 4  Persona harness (P0–P6)                     ← GATE: nothing past here until P0–P6 green; P7 joins at Phase 7
Phase 5  Onboarding (§4) with the consolidated formula engine
Phase 6  Today / Plan / Groceries surfaces
Phase 7  Safety rails (§8) wired end to end, P7 green
Phase 8  Images (§6), simplification pass (§10)
Phase 9  Positioning doc, deploy hardening, mobile scaffold notes
```

**The ship-to-Shad gate:** before any thought of other users, P0 — the operator's own profile — must generate 14 consecutive days that pass every gate, and he must actually cook from them. His cut runs to mid-December; the app's first job is that cut. If it works on its founder, it has its first proof.

**Begin with Phase 0. Do not skip the audit.**
