# Meal-Planning / Budget-Eating: Wants & Pain Points — 2026-07-24

## Source honesty (READ FIRST)
The assigned Reddit subs (r/mealprep, r/EatCheapAndHealthy, r/MealPrepSunday,
r/budgetfood, r/Cooking) were **unreachable**. reddit.com is blocked at the
crawler level: WebSearch rejects `allowed_domains: reddit.com`; WebFetch cannot
reach `www.reddit.com` or `old.reddit.com`; read-only mirrors (redlib, teddit,
safereddit) returned 403 / Anubis blocks. A local Chrome is connected but
driving the user's real browser to Reddit was out of scope for a background run.

So the findings below come from **reachable proxy sources** that mine the same
demand: a Reddit-aggregation blog, competitor app blogs, an app help center, a
macro-planner marketing page, review roundups, a household-scaling blog, an
OSS feature-request thread, and a budget/low-waste meal-plan patent. Treated as
directional, not as verbatim Reddit posts. No content invented.

## 1. TOP 10 WANTS / PAIN POINTS (frequency = # of independent sources)

1. **Grocery list is cluttered / duplicates not consolidated** (5 sources). Same
   ingredient listed multiple times instead of summed; list "too long."
   Fortune; organizeat; eatthismuch help title "my grocery list is too long."
2. **Pantry-first: "use what I already have" / flag items I own so I don't
   re-buy** (4). foodieprep; eatthismuch blog; pantry-app cluster.
3. **Paywalls hide core features after you've imported recipes** (3). Basic
   planning/sync/list locked post-import; pricing discovered mid-use. organizeat; Fortune.
4. **Food waste from fixed-size packages** (4). Recipe needs part of a can/pack;
   remainder spoils; US families waste 30-40%. justia patent; foodieprep; USU.
5. **Leftovers management** (3). Roll extra portions forward; avoid the
   "forgotten vegetable wilting in the fridge." eatthismuch blog; USU.
6. **Serving/portion scaling for household/family** (4). One base meal, different
   portions/sides per person; multiples that aren't clean. dinecraft; mealie #1161; recipe-scaler.
7. **Flexible recipe capture beyond clean URLs** (2). "Screenshot blindness" —
   photos, TikTok/Instagram, handwritten cards rejected. organizeat; foodieprep.
8. **Macro/calorie precision without manual math** (4). "160g protein under
   2,200 cal" is tedious by hand. eatthismuch; foodieprep; strongrfastr; Fortune.
9. **Allergy/diet + avoid-many-ingredients / multi-diet household** (3). "Avoid a
   hundred or so ingredients"; kid-friendly vs adult diet in one plan. Fortune; foodieprep.
10. **Cost/budget per serving — a full in-budget meal** (4). CheapToEat, eMeals
    "budget" category, Mayo/USU frugal planning.

Also recurring: aisle-sorted + in-store-editable lists; edits cascading cleanup;
shared/household device sync; decision fatigue ("what's for dinner").

## 2. WHAT CUT PROTOCOL ALREADY COVERS (honest)
- **#8 macro precision** — deterministic solver to a macro target = core strength; beats the manual-math complaint outright.
- **#10 cost/budget per serving** — per-serving cost filter from a local price table; directly matches CheapToEat/eMeals demand.
- **#9 allergy/diet** — zero-tolerance allergy + diet filter = strong (safety-critical, see §4).
- **#3 paywall/privacy** — offline + private desktop app sidesteps the #1 UX complaint (locked features, cloud pricing).
- **#1 grocery clutter** — grocery list in REAL purchase units (packs/cans/pieces) is the right primitive; consolidation across the horizon must be verified in-app.
- **#7 (partial)** — URL recipe importer exists; photo/social/OCR capture does not.
- Adaptive TDEE + micros cover budget-eating nutritional-adequacy worries.

## 3. GAPS, RANKED BY FREQUENCY
1. **Pantry / inventory awareness (#2)** — biggest gap. No "what I already have"
   model; can't flag owned staples or subtract them from the buy list.
2. **Food-waste / leftover-portion minimization (#4, #5)** — real purchase units
   surface pack sizes but nothing rolls the leftover half-can/portion into the
   next meal or flags spoilage-prone remainders.
3. **Household serving-scaling (#6)** — solver targets one eater's macros, not a
   family (one base meal, different portions/multiple diets per person).
4. **Flexible recipe capture (#7)** — URL-only import misses screenshots, social
   video, cookbook photos, handwritten cards ("screenshot blindness").
5. **Aisle-sorted / in-store-editable list + optional household sync (#1 tail)**
   — sync collides with the privacy/offline stance; aisle grouping does not.

## 4. SAFETY / HARM THEMES
- **Allergy filter is safety-critical:** a wrongly "compliant" plan can cause a
  reaction. Zero-tolerance is correct; it must be bulletproof (fail-closed) and
  never silently substitute a flagged ingredient.
- **Under-eating / disordered-eating risk:** macro/calorie tools invite unsafe
  deficits. Cut Protocol's "never suggest <2000 kcal" floor aligns; keep it.
- **Budget nutritional adequacy:** cheapest-plan optimization can starve micros;
  Cut Protocol's micro tracking is the right guard — keep micros as a hard gate.

## SOURCES (reachable; Reddit itself unreachable)
- https://fortune.com/article/best-meal-planning-apps/ (fetched)
- https://home.organizeat.com/blog/meal-planner-app-reddit/ (fetched — Reddit aggregation)
- https://blog.eatthismuch.com/best-meal-planning-apps/ (fetched)
- https://www.foodieprep.ai/blog/meal-planning-apps-in-2026-which-tools-actually-simplify-your-kitchen (fetched)
- https://help.eatthismuch.com/help/my-grocery-list-is-too-long (search-surfaced title)
- https://patents.justia.com/patent/20160098942 (low-waste in-budget meal-plan patent)
- https://extension.usu.edu/createbetterhealth/blog/menuplan (budget/waste)
- https://www.dinecraft.app/blog/family-meal-planning-app-with-macros (household scaling)
- https://github.com/mealie-recipes/mealie/discussions/1161 (serving-scaling request)
- https://apps.apple.com/mx/app/cheaptoeat/id6477322742 (budget+diet+cuisine competitor)
- https://www.strongrfastr.com/macro-meal-planner (macro-solver competitor)
- https://www.techradar.com/computing/websites-apps/mealboard (review)
