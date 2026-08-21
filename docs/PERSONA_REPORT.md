# Persona report — 30 days × 7 personas, seeded run

Pool: rebuild QA database (698 library rows; see docs/qc/pool-admission-2026-08-19.md).
Solver: prescription daySolver (Phase 3), seed 1, best-of-5 attempts/day.

## Gates

| Gate | Bar | Measured | Verdict |
|---|---|---|---|
| Person-days | ≥200 | 210 | PASS |
| Allergen violations | 0 | 0 | PASS |
| Days inside all four bands (post-rounding) | ≥95% | 210/210 (100%) | PASS |
| Latency P50 / P95 per day | <2 s / <8 s | 4.3 ms / 6 ms | PASS |
| Variety (3-day window, in-day uniqueness) | hold | asserted in personaGates.test.js | PASS |
| Keto ceiling crossed | never | 0 day(s) | PASS |
| P7 floor gate | 100/100 | — | runs at Phase 7 (rails) |

## Per persona

| Persona | Pool | Days in band | Allergen hits | P50 ms | Stresses |
|---|---:|---:|---:|---:|---|
| p0 — high-protein founder-shaped profile, four allergen walls | 253 | 30/30 | 0 | 5.2 | high protein under four simultaneous exclusions |
| p1 — celiac vegan woman, 1,600 kcal | 42 | 30/30 | 0 | 4.9 | protein without meat OR gluten — seitan is pure wheat gluten and must never appear |
| p2 — soy + wheat allergy, 2,000 kcal, loves Chinese | 271 | 30/30 | 0 | 4.4 | the derived-ingredient trap: soy sauce, hoisin, oyster sauce; coconut aminos must rescue the cuisine |
| p3 — keto OMAD, 2,400 kcal, ≤25 g net carbs | 36 | 30/30 | 0 | 1.2 | one giant meal inside a hard carb ceiling — the slot holds several dishes |
| p4 — budget student, $60/week, 3,000 kcal | 598 | 30/30 | 0 | 2.3 | cost tier as a real constraint |
| p5 — pescatarian Mediterranean, 1,800 kcal | 317 | 30/30 | 0 | 3.7 | fish allowed, shellfish allowed — ontology precision in the other direction |
| p6 — lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese | 314 | 30/30 | 0 | 4.7 | hard exclusion + soft dislike handled differently |

## Cost (p4) — honest about what is measurable

Cost figures exist on 0% of served dishes (Recipe.costPerServing). That coverage is too thin for a cost GATE — the budget bias had almost nothing to act on. Building a real cost model (groceryPrices keyword estimates over ingredient grams) is recorded follow-up work; until then the budget tier is a preference, not a verified constraint.

## Worst day per persona (largest total band miss)

- **p0** day 1: kcal 2137.3 · P 210.9 g · F 67 g · netC 149.9 g — none — inside every band
- **p1** day 1: kcal 1635.6 · P 92.1 g · F 47.6 g · netC 176.7 g — none — inside every band
- **p2** day 1: kcal 2013.8 · P 149.1 g · F 64.3 g · netC 188.2 g — none — inside every band
- **p3** day 1: kcal 2403 · P 160.8 g · F 185.7 g · netC 16.1 g — none — inside every band
- **p4** day 1: kcal 3041 · P 163.4 g · F 86 g · netC 361.7 g — none — inside every band
- **p5** day 1: kcal 1814.1 · P 119 g · F 62.2 g · netC 167.9 g — none — inside every band
- **p6** day 1: kcal 3243.5 · P 218.6 g · F 96.2 g · netC 337.2 g — none — inside every band

## Example day per persona, in full — is this plausible food?

### p0 — high-protein founder-shaped profile, four allergen walls (day 1)

`allergen_scan: PASS (profile: shellfish, gluten, kiwi, soy) — 0 hits across 20 ingredients`

**meal 1**
- *Sirloin & Baked Potato, Trimmed* — 874 kcal · 93 g P
  - 280 g Sirloin steak, cooked, lean
  - 215 g Potato, baked with skin
  - 245 g Broccoli, raw
  - 4 g Olive Oil
**meal 2**
- *Poached White Fish, Potatoes & Asparagus* — 539 kcal · 48 g P
  - 215 g White Fish
  - 205 g Potato, baked with skin
  - 300 g Asparagus
  - 10 g Olive Oil
  - 12 g Lemon juice, raw
**meal 3**
- *Coconut-Aminos Chicken Stir-Fry* — 528 kcal · 51 g P
  - 145 g Chicken breast, cooked, skinless
  - 100 g Broccoli, raw
  - 65 g Peppers, bell, red, raw
  - 12 g Coconut aminos
  - 8 g Ginger
  - 6 g Garlic, raw
  - 10 g Oil, canola
  - 95 g White rice, cooked
**snack 1**
- *Protein Shake, Whey & Almond Milk* — 196 kcal · 19 g P
  - 20 g Beverages, Protein powder whey based
  - 345 g Almond milk, unsweetened, plain, refrigerated
  - 17 g Banana

Day: **2137 kcal** (band 2100–2200) · **211 g P** (200–220) · **67 g F** (60–70) · **150 g netC** (135–160)

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
- *Trout with Potatoes & Green Beans* — 786 kcal · 65 g P
  - 280 g Rainbow Trout
  - 305 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 9 g Olive Oil
  - 8 g Dill weed, fresh
**meal 2**
- *Ground Beef & Rice Skillet* — 504 kcal · 38 g P
  - 125 g Extra-lean ground beef, cooked
  - 170 g White rice, cooked
  - 75 g Bell peppers
  - 5 g Butter
**meal 3**
- *Ginger Prawn Rice Noodles* — 507 kcal · 31 g P
  - 105 g Prawns
  - 210 g Rice Noodles
  - 110 g Pak Choi
  - 14 g Coconut aminos
  - 10 g Ginger
  - 16 g Oil, sesame, salad or cooking
**snack 1**
- *Cottage Cheese & Pineapple Bowl* — 217 kcal · 15 g P
  - 130 g Cottage Cheese
  - 155 g Pineapple, raw

Day: **2014 kcal** (band 1950–2050) · **149 g P** (140–160) · **64 g F** (60–70) · **188 g netC** (180–200)

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

`allergen_scan: PASS (profile: none) — 0 hits across 29 ingredients`

**meal 1**
- *Edamame Fried Rice* — 1324 kcal · 58 g P
  - 595 g White rice, cooked
  - 315 g Edamame, shelled, cooked
  - 105 g Frozen Peas
  - 50 g Spring Onions
  - 25 g Coconut aminos
  - 8 g Oil, sesame, salad or cooking
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
- *Vietnamese caramel trout* — 625 kcal · 34 g P
  - 25 g Golden Caster Sugar
  - 5 g Fish Sauce
  - 15 g Red Chilli
  - 50 g Ginger
  - 100 g Rainbow Trout
  - 100 g Bok Choi
  - 30 g Lemon
  - 50 g Coriander
  - 50 g Rice
**snack 1**
- *Crispy Spiced Chickpeas* — 243 kcal · 9 g P
  - 40 g Chickpeas
  - 9 g Olive Oil
  - 3 g Smoked Paprika
**snack 2**
- *Cottage Cheese & Pineapple Bowl* — 303 kcal · 33 g P
  - 300 g Cottage Cheese
  - 30 g Pineapple, raw

Day: **3041 kcal** (band 2950–3050) · **163 g P** (150–180) · **86 g F** (80–100) · **362 g netC** (350–380)

### p5 — pescatarian Mediterranean, 1,800 kcal (day 1)

`allergen_scan: PASS (profile: style:pescatarian) — 0 hits across 18 ingredients`

**meal 1**
- *Sea Bass with Bulgur & Charred Lemon* — 682 kcal · 55 g P
  - 195 g Sea Bass Fillets
  - 360 g Bulgur, cooked
  - 300 g Courgettes
  - 14 g Olive Oil
  - 40 g Lemon
**meal 2**
- *Trout with Potatoes & Green Beans* — 446 kcal · 28 g P
  - 105 g Rainbow Trout
  - 195 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 10 g Olive Oil
  - 8 g Dill weed, fresh
**meal 3**
- *Edamame & Quinoa Green Bowl* — 430 kcal · 22 g P
  - 110 g Quinoa, cooked
  - 115 g Edamame, shelled, cooked
  - 200 g Cucumber
  - 80 g Rocket
  - 25 g Coconut aminos
  - 11 g Oil, sesame, salad or cooking
**snack 1**
- *Cottage Cheese & Pineapple Bowl* — 256 kcal · 14 g P
  - 115 g Cottage Cheese
  - 245 g Pineapple, raw

Day: **1814 kcal** (band 1750–1850) · **119 g P** (110–130) · **62 g F** (60–70) · **168 g netC** (160–180)

### p6 — lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese (day 1)

`allergen_scan: PASS (profile: lactose) — 0 hits across 27 ingredients`

**meal 1**
- *Turkey & Rice Skillet with Peppers* — 1392 kcal · 106 g P
  - 495 g Turkey, ground, 93% lean, 7% fat, raw
  - 450 g White rice, cooked
  - 75 g Peppers, bell, red, raw
  - 30 g Onions, raw
  - 4 g Smoked Paprika
  - 2 g Oil, canola
**meal 2**
- *Trout with Potatoes & Green Beans* — 558 kcal · 34 g P
  - 120 g Rainbow Trout
  - 340 g Potato, baked with skin
  - 75 g Beans, snap, green, microwaved
  - 5 g Olive Oil
  - 8 g Dill weed, fresh
**meal 3**
- *Carbonada Criolla* — 384 kcal · 26 g P
  - 65 g Beef
  - 14 g Onion
  - 15 g Carrots
  - 45 g Potatoes
  - 13 g Pumpkin
  - 13 g Dried Apricots
  - 25 g Beef Stock
  - 1 g Salt
  - 1 g Pepper
**meal 4**
- *Pan-Seared Salmon, Rice & Peppers* — 657 kcal · 34 g P
  - 115 g Salmon, cooked
  - 305 g White rice, cooked
  - 75 g Bell peppers
**snack 1**
- *Crispy Spiced Chickpeas* — 132 kcal · 6 g P
  - 25 g Chickpeas
  - 3 g Olive Oil
  - 3 g Smoked Paprika
**snack 2**
- *Edamame with Flaky Salt* — 121 kcal · 12 g P
  - 100 g Edamame, shelled, cooked

Day: **3243 kcal** (band 3150–3250) · **219 g P** (213–227) · **96 g F** (90–110) · **337 g netC** (325–355)
