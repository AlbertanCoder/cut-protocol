# Allergy / Dietary-Restriction Community Research — 2026-07-24

**Source note:** reddit.com is fully blocked to this crawler (search + fetch both refused). Findings drawn from reachable adjacent-community and review sources that quote the same user sentiment: celiac.com forums, MyFitnessPal community, allergy-parent blogs, and app-comparison articles. No posts invented.

## 1. Top wants / frustrations with current apps

- **Tag-based "inclusion" filtering instead of true exclusion.** The most-cited gap: mainstream apps return recipes *tagged* "gluten-free" rather than *removing* anything containing the allergen. useLadle: *"Excluding gluten means the system actively removes anything containing gluten-containing ingredients, regardless of how the recipe is tagged."* (https://www.useladle.com/blog/meal-planning-app-dietary-restrictions)
- **Unreliable tags → manual audit of every recipe.** *"A recipe imported from a website might not carry the right tags... whatever tags you remembered to add."* Users re-read every ingredient list themselves. (useLadle)
- **Calorie/macro apps ignore ingredients.** For celiacs, MyFitnessPal/Cronometer give macros but don't surface ingredient data or flag gluten; user-submitted DB entries are unreliable; *"most calorie tracking apps do not track cross-contamination risk."* (https://www.welling.ai/articles/best-calorie-tracking-apps-gluten-free-2026)
- **Cognitive load / burnout.** Managing several restrictions means *"cross-referencing a dozen mental checklists with every single item"* (https://scangeni.us/the-app-that-people-with-food-allergies-have-been-waiting-for/); an allergy parent describes being *"so very tired of planning meals all the time"* (https://itchylittleworld.com/meal-planning-for-people-with-food-allergies-sensitivities/).
- **Multi-person households.** Big unmet demand: one safe plan for a peanut-allergic kid + vegetarian parent + GF teen from one cooking session — *"a gap most meal-planning tools ignore."* (NumYum / Nori / Snack'd)

## 2. What Cut Protocol already nails (honest)

- **Hard exclusion, applied to every plan** = exactly the #1 documented gap. This is *rare and valued*: the market is dominated by tag filters and barcode scanners; true exclusion is what challengers (useLadle, NumYum) explicitly sell as their differentiator — valued, not yet commoditized.
- **Scanning recipe title + full step text** beats the "unreliable tags" problem — Cut Protocol doesn't trust tags, it reads the actual text.
- **48-entry taxonomy with rares (lupin/mustard/celery/sesame) + species depth** — most apps stop at the top 9/13; rares are a genuine coverage gap Cut Protocol fills.
- **"Over-exclusion is the only acceptable failure direction" + honest "can't satisfy" messaging** matches the safety consensus (below) and avoids false confidence.

## 3. Gaps Cut Protocol still lacks

- **Cross-contamination / "may contain" / shared-facility flags** — repeatedly called *"vital"* (scangeni.us); AI planners *"cannot assess cross-contamination risks"* (NumYum/Nori). Cut Protocol only sees named ingredients + barcode tags. Highest-value gap.
- **Ingredient substitution suggestions** — listed as essential (useLadle); Cut Protocol excludes but doesn't propose safe swaps.
- **Multi-person / per-family-member profiles** — strong demand (Food Scan Genius per-profile scan, NumYum, Nori). Cut Protocol appears single-user.
- **Restaurant / eating-out filtering** — a whole app category (Gluten Dude, Spokin); Cut Protocol is plan-only.
- **Kid-friendly / picky-eater handling; recipe import (photos/cookbook/family cards); live barcode scan at purchase.**
- **Micronutrient-deficiency awareness** for GF substitutes (low fibre/iron/B/folate) — welling.ai.

## 4. Safety themes

- **"False sense of security" is the dominant safety concern.** Experts warn serious-allergy users should never rely solely on any app (Food Alert). Cut Protocol's honest-limits ethos is correctly aligned — keep marketing conservative.
- **Hidden allergen aliases** (casein=milk, albumen=egg, tahini=sesame, earthnut=peanut) — Cut Protocol's step-text scan helps only if alias coverage is exhaustive; audit the alias map.
- **Apps cannot verify cross-contamination** — must be stated in-product, not implied away.
- **Cost as a safety-equity barrier** — one review noted a subscription = *"25% of monthly disability income."*
- **Over-exclusion = correct default**, validated across sources: *"one missed ingredient... a trip to the ER."*
