# Persona report — 30 days × 7 personas, seeded run

Pool: rebuild QA database (688 library rows; see docs/qc/pool-admission-2026-08-19.md).
Solver: prescription daySolver (Phase 3), seed 1, best-of-5 attempts/day.

## Gates

| Gate | Bar | Measured | Verdict |
|---|---|---|---|
| Person-days | ≥200 | 210 | PASS |
| Allergen violations | 0 | 0 | PASS |
| Days inside all four bands (post-rounding) | ≥95% | 206/210 (98.1%) | PASS |
| Latency P50 / P95 per day | <2 s / <8 s | 4.4 ms / 12.4 ms | PASS |
| Variety (3-day window, in-day uniqueness) | hold | asserted in personaGates.test.js | PASS |
| Keto ceiling crossed | never | 0 day(s) | PASS |
| P7 floor gate | 100/100 | — | runs at Phase 7 (rails) |

## Per persona

| Persona | Pool | Days in band | Allergen hits | P50 ms | Stresses |
|---|---:|---:|---:|---:|---|
| p0 — high-protein founder-shaped profile, four allergen walls | 243 | 26/30 | 0 | 5.9 | high protein under four simultaneous exclusions |
| p1 — celiac vegan woman, 1,600 kcal | 42 | 30/30 | 0 | 4.9 | protein without meat OR gluten — seitan is pure wheat gluten and must never appear |
| p2 — soy + wheat allergy, 2,000 kcal, loves Chinese | 261 | 30/30 | 0 | 4.3 | the derived-ingredient trap: soy sauce, hoisin, oyster sauce; coconut aminos must rescue the cuisine |
| p3 — keto OMAD, 2,400 kcal, ≤25 g net carbs | 36 | 30/30 | 0 | 1.4 | one giant meal inside a hard carb ceiling — the slot holds several dishes |
| p4 — budget student, $60/week, 3,000 kcal | 588 | 30/30 | 0 | 2.5 | cost tier as a real constraint |
| p5 — pescatarian Mediterranean, 1,800 kcal | 335 | 30/30 | 0 | 4.4 | fish allowed, shellfish allowed — ontology precision in the other direction |
| p6 — lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese | 304 | 30/30 | 0 | 5.2 | hard exclusion + soft dislike handled differently |

## Cost (p4) — honest about what is measurable

Cost figures exist on 0% of served dishes (Recipe.costPerServing). That coverage is too thin for a cost GATE — the budget bias had almost nothing to act on. Building a real cost model (groceryPrices keyword estimates over ingredient grams) is recorded follow-up work; until then the budget tier is a preference, not a verified constraint.

## Worst day per persona (largest total band miss)

- **p0** day 27: kcal 2104.8 · P 213.1 g · F 72.8 g · netC 154.5 g — fatG over by 2.8
- **p1** day 1: kcal 1635.6 · P 92.1 g · F 47.6 g · netC 176.7 g — none — inside every band
- **p2** day 1: kcal 2002.1 · P 148.5 g · F 63.2 g · netC 188.3 g — none — inside every band
- **p3** day 1: kcal 2403 · P 160.8 g · F 185.7 g · netC 16.1 g — none — inside every band
- **p4** day 1: kcal 3049.7 · P 162.1 g · F 83.5 g · netC 359.4 g — none — inside every band
- **p5** day 1: kcal 1817.9 · P 118.9 g · F 62.6 g · netC 167.2 g — none — inside every band
- **p6** day 1: kcal 3238.2 · P 217.4 g · F 95.2 g · netC 336.2 g — none — inside every band

## Example day per persona, in full — is this plausible food?

### p0 — high-protein founder-shaped profile, four allergen walls (day 1)

`allergen_scan: PASS (profile: shellfish, gluten, kiwi, soy) — 0 hits across 22 ingredients`

**meal 1**
- *Chipotle-Style Chicken Burrito Bowl* — 850 kcal · 99 g P
  - 260 g Chicken breast, cooked, skinless
  - 130 g White rice, cooked
  - 85 g Black beans, canned, drained
  - 85 g Enchilada sauce
  - 25 g Cheese, cheddar
  - 85 g White Cabbage
**meal 2**
- *Coconut-Aminos Chicken Stir-Fry* — 538 kcal · 45 g P
  - 125 g Chicken breast, cooked, skinless
  - 115 g Broccoli, raw
  - 75 g Peppers, bell, red, raw
  - 14 g Coconut aminos
  - 8 g Ginger
  - 6 g Garlic, raw
  - 16 g Oil, canola
  - 80 g White rice, cooked
**meal 3**
- *Smoked Haddock & Pea Rice Bowl* — 559 kcal · 48 g P
  - 155 g Smoked Haddock
  - 100 g White rice, cooked
  - 195 g Frozen Peas
  - 16 g Butter
  - 10 g Lemon juice, raw
**snack 1**
- *Protein Shake, Whey & Almond Milk* — 176 kcal · 17 g P
  - 18 g Beverages, Protein powder whey based
  - 315 g Almond milk, unsweetened, plain, refrigerated
  - 15 g Banana

Day: **2124 kcal** (band 2100–2200) · **210 g P** (200–220) · **65 g F** (60–70) · **148 g netC** (135–160)

### p1 — celiac vegan woman, 1,600 kcal (day 1)

`allergen_scan: PASS (profile: gluten, style:vegan) — 0 hits across 20 ingredients`

**meal 1**
- *Edamame Fried Rice* — 680 kcal · 35 g P
  - 245 g White rice, cooked
  - 200 g Edamame, shelled, cooked
  - 90 g Frozen Peas
  - 45 g Spring Onions
  - 20 g Coconut aminos
  - 4 g Oil, sesame, salad or cooking
  - 6 g Ginger
**meal 2**
- *Edamame & Quinoa Green Bowl* — 363 kcal · 25 g P
  - 60 g Quinoa, cooked
  - 160 g Edamame, shelled, cooked
  - 200 g Cucumber
  - 80 g Rocket
  - 25 g Coconut aminos
  - 4 g Oil, sesame, salad or cooking
**meal 3**
- *Lao Som Pak Pickled Cabbage* — 306 kcal · 17 g P
  - 50 g Cabbage
  - 570 g Spring Onions
  - 235 g Water
  - 10 g Salt
**snack 1**
- *Crispy Spiced Chickpeas* — 287 kcal · 15 g P
  - 65 g Chickpeas
  - 3 g Olive Oil
  - 3 g Smoked Paprika

Day: **1636 kcal** (band 1550–1650) · **92 g P** (85–105) · **48 g F** (45–55) · **177 g netC** (165–195)

### p2 — soy + wheat allergy, 2,000 kcal, loves Chinese (day 1)

`allergen_scan: PASS (profile: soy, wheat) — 0 hits across 17 ingredients`

**meal 1**
- *Trout with Potatoes & Green Beans* — 784 kcal · 64 g P
  - 275 g Rainbow Trout
  - 310 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 9 g Olive Oil
  - 8 g Dill weed, fresh
**meal 2**
- *Ginger Prawn Rice Noodles* — 504 kcal · 31 g P
  - 105 g Prawns
  - 225 g Rice Noodles
  - 105 g Pak Choi
  - 13 g Coconut aminos
  - 10 g Ginger
  - 14 g Oil, sesame, salad or cooking
**meal 3**
- *Ground Beef & Rice Skillet* — 487 kcal · 37 g P
  - 125 g Extra-lean ground beef, cooked
  - 150 g White rice, cooked
  - 75 g Bell peppers
  - 6 g Butter
**snack 1**
- *Cottage Cheese & Pineapple Bowl* — 227 kcal · 16 g P
  - 135 g Cottage Cheese
  - 165 g Pineapple, raw

Day: **2002 kcal** (band 1950–2050) · **148 g P** (140–160) · **63 g F** (60–70) · **188 g netC** (180–200)

### p3 — keto OMAD, 2,400 kcal, ≤25 g net carbs (day 1)

`allergen_scan: PASS (profile: style:keto) — 0 hits across 21 ingredients`

**meal 1**
- *Butter-Basted Salmon with Lemon Kale* — 628 kcal · 40 g P
  - 175 g Salmon, cooked
  - 60 g Kale
  - 27 g Butter
  - 15 g Lemon juice, raw
- *Three-Egg Cheddar & Kale Scramble* — 583 kcal · 38 g P
  - 200 g Eggs, whole, cooked
  - 35 g Cheese, cheddar
  - 115 g Kale
  - 10 g Butter
- *Baked Feta Eggs with Peppers* — 596 kcal · 39 g P
  - 260 g Eggs, whole, cooked
  - 35 g Cheese, feta
  - 50 g Peppers, bell, red, raw
  - 9 g Olive Oil
  - 2 g Dried Oregano
- *Keleya Zaara* — 596 kcal · 44 g P
  - 15 g Olive Oil
  - 210 g Lamb
  - 1 g Saffron
  - 30 g Onion
  - 7 g Water
  - 8 g Parsley
  - 4 g Butter
  - 16 g Lemon

Day: **2403 kcal** (band 2350–2450) · **161 g P** (150–170) · **186 g F** (175–195) · **16 g netC** (0–25)

### p4 — budget student, $60/week, 3,000 kcal (day 1)

`allergen_scan: PASS (profile: none) — 0 hits across 26 ingredients`

**meal 1**
- *Edamame Fried Rice* — 1324 kcal · 56 g P
  - 625 g White rice, cooked
  - 285 g Edamame, shelled, cooked
  - 120 g Frozen Peas
  - 60 g Spring Onions
  - 30 g Coconut aminos
  - 6 g Oil, sesame, salad or cooking
  - 6 g Ginger
**meal 2**
- *Falafel* — 547 kcal · 28 g P
  - 8 g Sunflower Oil
  - 30 g Onion
  - 1 g Garlic
  - 115 g Chickpeas
  - 1 g Ground Cumin
  - 1 g Ground Coriander
  - 9 g Parsley
  - 14 g Egg
**meal 3**
- *Edamame & Quinoa Green Bowl* — 678 kcal · 40 g P
  - 270 g Quinoa, cooked
  - 205 g Edamame, shelled, cooked
  - 200 g Cucumber
  - 80 g Rocket
  - 25 g Coconut aminos
  - 5 g Oil, sesame, salad or cooking
**snack 1**
- *Crispy Spiced Chickpeas* — 176 kcal · 6 g P
  - 25 g Chickpeas
  - 8 g Olive Oil
  - 3 g Smoked Paprika
**snack 2**
- *Cottage Cheese & Pineapple Bowl* — 325 kcal · 32 g P
  - 285 g Cottage Cheese
  - 90 g Pineapple, raw

Day: **3050 kcal** (band 2950–3050) · **162 g P** (150–180) · **83 g F** (80–100) · **359 g netC** (350–380)

### p5 — pescatarian Mediterranean, 1,800 kcal (day 1)

`allergen_scan: PASS (profile: beef, pork, chicken, lamb, turkey, bacon, ham, sausage) — 0 hits across 18 ingredients`

**meal 1**
- *Sea Bass with Bulgur & Charred Lemon* — 684 kcal · 53 g P
  - 170 g Sea Bass Fillets
  - 435 g Bulgur, cooked
  - 300 g Courgettes
  - 10 g Olive Oil
  - 40 g Lemon
**meal 2**
- *Trout with Potatoes & Green Beans* — 461 kcal · 29 g P
  - 105 g Rainbow Trout
  - 230 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 8 g Olive Oil
  - 8 g Dill weed, fresh
**meal 3**
- *Tuna, Black Bean & Rocket Salad* — 394 kcal · 21 g P
  - 75 g Fish, tuna, light, canned in water, drained solids
  - 35 g Black beans, canned, drained
  - 120 g Rocket
  - 24 g Olive Oil
  - 15 g Lemon juice, raw
  - 80 g Onions, red, raw
**snack 1**
- *Cottage Cheese & Pineapple Bowl* — 279 kcal · 16 g P
  - 135 g Cottage Cheese
  - 250 g Pineapple, raw

Day: **1818 kcal** (band 1750–1850) · **119 g P** (110–130) · **63 g F** (60–70) · **167 g netC** (160–180)

### p6 — lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese (day 1)

`allergen_scan: PASS (profile: lactose) — 0 hits across 32 ingredients`

**meal 1**
- *Trout with Potatoes & Green Beans* — 1183 kcal · 89 g P
  - 360 g Rainbow Trout
  - 620 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 8 g Olive Oil
  - 8 g Dill weed, fresh
**meal 2**
- *Carbonada Criolla* — 505 kcal · 34 g P
  - 85 g Beef
  - 19 g Onion
  - 20 g Carrots
  - 60 g Potatoes
  - 17 g Pumpkin
  - 17 g Dried Apricots
  - 35 g Beef Stock
  - 1 g Salt
  - 1 g Pepper
**meal 3**
- *Weeknight Beef & Broccoli* — 782 kcal · 46 g P
  - 145 g Beef, flank, steak, boneless, choice, raw
  - 380 g Broccoli, raw
  - 40 g Coconut aminos
  - 8 g Ginger
  - 6 g Cornstarch
  - 5 g Oil, canola
  - 245 g White rice, cooked
**meal 4**
- *Turkey Fajita Rice Skillet* — 515 kcal · 30 g P
  - 125 g Turkey, ground, 93% lean, 7% fat, raw
  - 75 g Peppers, bell, red, raw
  - 40 g Onions, raw
  - 170 g White rice, cooked
  - 4 g Smoked Paprika
  - 3 g Ground Cumin
  - 5 g Oil, canola
**snack 1**
- *Crispy Spiced Chickpeas* — 132 kcal · 6 g P
  - 25 g Chickpeas
  - 3 g Olive Oil
  - 3 g Smoked Paprika
**snack 2**
- *Edamame with Flaky Salt* — 121 kcal · 12 g P
  - 100 g Edamame, shelled, cooked

Day: **3238 kcal** (band 3150–3250) · **217 g P** (213–227) · **95 g F** (90–110) · **336 g netC** (325–355)
