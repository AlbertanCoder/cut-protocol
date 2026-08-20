// rebuildCandidates.mjs — LLM-proposed recipe candidates for the Phase-2 pool.
//
// Proposal layer ONLY (CUT_PROTOCOL_DIRECTIVE.md §3.1): nothing in this file
// asserts a macro. Ingredients are (existing food name, grams); the seeder
// resolves every name against the Food table, refuses foods whose stored
// energy fails a consistency check (the seeded pool carries known corrupt
// rows — cod-liver-oil macros on "Salmon", 0-kcal almonds), computes totals
// with nutritionCore (FDC-canonical), runs the sanity gate, and asserts each
// candidate is actually ADMITTED by the real exclusion gate for the audience
// it claims to serve. Candidates that fail any of that are logged and dropped.
//
// Targeting comes from docs/qc/pool-admission-2026-08-19.md: the admitted
// seeded pool had 17 vegan+GF mains and 0 vegan snacks, ~20 keto recipes,
// 6 snacks TOTAL, and 3 carnivore recipes.
//
// NEW_FOODS are label/USDA-reference values, hand-entered, no fdcId claimed —
// source "label" with the provenance note in dataQuality.

export const NEW_FOODS = [
  { name: "Coconut aminos", category: "pantry", kcal: 87, protein: 1.3, fat: 0, carb: 20, fiber: 0,
    source: "label", dataQuality: "label-entered 2026-08-19 from typical retail label (5 kcal/tsp); the soy-free gluten-free soy-sauce rescue" },
  { name: "Cauliflower, raw", category: "fruit-veg", kcal: 25, protein: 1.9, fat: 0.3, carb: 5, fiber: 2,
    source: "label", dataQuality: "hand-entered 2026-08-19 from USDA SR reference values, no fdcId claimed" },
  { name: "Avocado, raw", category: "fruit-veg", kcal: 160, protein: 2, fat: 14.7, carb: 8.5, fiber: 6.7,
    source: "label", dataQuality: "hand-entered 2026-08-19 from USDA SR reference values; the pre-existing 'Avocado' row carries oil macros and is quarantine-shaped" },
  { name: "Oats, rolled, dry", category: "grains", kcal: 379, protein: 13.2, fat: 6.5, carb: 67.7, fiber: 10.1,
    source: "label", dataQuality: "hand-entered 2026-08-19 from USDA SR reference values; existing oats rows carry oil macros" },
  { name: "Almond flour, blanched", category: "fats-nuts-oils", kcal: 571, protein: 21.4, fat: 50, carb: 21.4, fiber: 10.7,
    source: "label", dataQuality: "label-entered 2026-08-19; existing 'Almond Flour' row is zero-kcal corrupt" },
  { name: "Edamame, shelled, cooked", category: "protein", kcal: 121, protein: 11.9, fat: 5.2, carb: 8.9, fiber: 5.2,
    source: "label", dataQuality: "hand-entered 2026-08-19 from USDA SR reference values" },
];

// audience keys → profiles asserted in the seeder:
//   vegan_gf   {dietaryStyle:"vegan", excludedFoods:["gluten"]}
//   keto       {dietaryStyle:"keto"}
//   carnivore  {dietaryStyle:"carnivore"}
//   p0         {excludedFoods:["shellfish","gluten","kiwi","soy"]}
//   p2         {excludedFoods:["soy","wheat"]}
//   open       {} — allergen-clean baseline only

const M = (name, cuisine, prepTimeMin, audience, ingredients, steps, slotType = "meal") =>
  ({ name, cuisine, prepTimeMin, audience, ingredients, steps, slotType });
const I = (foodName, baseGrams, role, scalable = true) => ({ foodName, baseGrams, role, scalable });

export const CANDIDATES = [
  // ── Vegan + gluten-free mains (P1: pool had 17) ─────────────────────────
  M("Crispy Tofu Rice Bowl with Coconut-Ginger Glaze", "chinese", 25, ["vegan_gf"], [
    I("Tofu, firm, raw", 250, "protein"), I("White rice, cooked", 180, "carb"),
    I("Broccoli, raw", 150, "veg"), I("Coconut aminos", 15, "other"),
    I("Ginger", 8, "other", false), I("Garlic, raw", 6, "other", false), I("Oil, canola", 10, "fat"),
  ], ["Press the tofu 10 minutes, cube it, and pan-fry in the oil until every side is browned.",
      "Steam the broccoli florets 4 minutes.",
      "Toss tofu and broccoli with coconut aminos, grated ginger and garlic; serve over the rice."]),
  M("Tempeh Taco Bowl", "mexican", 20, ["vegan_gf"], [
    I("Tempeh, cooked", 200, "protein"), I("Black beans, canned, drained", 120, "carb"),
    I("White rice, cooked", 160, "carb"), I("Peppers, bell, red, raw", 100, "veg"),
    I("Onions, raw", 60, "veg"), I("Chili Powder", 6, "other", false), I("Ground Cumin", 3, "other", false),
    I("Oil, canola", 8, "fat"),
  ], ["Crumble the tempeh into a hot oiled skillet with the onion and pepper; brown 5 minutes.",
      "Add beans, chili powder and cumin with a splash of water; simmer 3 minutes.",
      "Serve over the rice."]),
  M("Quinoa & Black Bean Power Plate", "mexican", 20, ["vegan_gf", "p0"], [
    I("Quinoa, cooked", 220, "carb"), I("Black beans, canned, drained", 180, "protein"),
    I("Avocado, raw", 80, "fat"), I("Grape Tomatoes", 100, "veg"),
    I("Lime juice, raw", 15, "other", false), I("Cilantro", 8, "other", false), I("Ground Cumin", 3, "other", false),
  ], ["Warm the beans with cumin.",
      "Pile quinoa, beans, halved tomatoes and sliced avocado on a plate.",
      "Finish with lime juice and cilantro."]),
  M("Edamame Fried Rice", "chinese", 15, ["vegan_gf"], [
    I("White rice, cooked", 250, "carb"), I("Edamame, shelled, cooked", 150, "protein"),
    I("Frozen Peas", 60, "veg"), I("Spring Onions", 30, "veg"),
    I("Coconut aminos", 15, "other"), I("Oil, sesame, salad or cooking", 8, "fat"), I("Ginger", 6, "other", false),
  ], ["Heat the sesame oil hard; fry the ginger 30 seconds.",
      "Add rice, edamame and peas; toss until everything sizzles.",
      "Finish with coconut aminos and spring onion."]),
  M("Tofu & Cauliflower Tikka Tray", "indian", 30, ["vegan_gf"], [
    I("Tofu, firm, raw", 250, "protein"), I("Cauliflower, raw", 250, "veg"),
    I("Unsweetened Coconut Milk", 100, "fat"), I("Curry Powder", 8, "other", false),
    I("Ground Turmeric", 3, "other", false), I("Oil, canola", 10, "fat"), I("White rice, cooked", 150, "carb"),
  ], ["Toss tofu cubes and cauliflower florets with oil and the spices; roast at 220°C for 22 minutes.",
      "Warm the coconut milk and pour it over the tray.",
      "Serve over rice."]),
  M("Smoky Tempeh & Sweet Potato Hash", "american", 25, ["vegan_gf"], [
    I("Tempeh, cooked", 180, "protein"), I("Potato, baked with skin", 250, "carb"),
    I("Peppers, bell, green, raw", 100, "veg"), I("Onions, red, raw", 60, "veg"),
    I("Smoked Paprika", 5, "other", false), I("Oil, canola", 12, "fat"),
  ], ["Dice the potato and crisp it in the oil, 8 minutes.",
      "Add crumbled tempeh, pepper and onion; cook 5 more.",
      "Season with smoked paprika and plenty of black pepper."]),
  M("Chickpea Coconut Curry Bowl", "indian", 25, ["vegan_gf", "p2"], [
    I("Chickpeas", 70, "protein"), I("Unsweetened Coconut Milk", 150, "fat"),
    I("Tomato Sauce", 120, "other"), I("Kale", 80, "veg"),
    I("Curry Powder", 8, "other", false), I("Garlic, raw", 6, "other", false), I("White rice, cooked", 180, "carb"),
  ], ["Simmer the (pre-soaked, cooked) chickpeas in tomato sauce, coconut milk and curry powder, 12 minutes.",
      "Wilt the kale in for the last 3.",
      "Serve over rice."]),
  M("Edamame & Quinoa Green Bowl", "japanese", 15, ["vegan_gf"], [
    I("Quinoa, cooked", 200, "carb"), I("Edamame, shelled, cooked", 180, "protein"),
    I("Cucumber", 100, "veg"), I("Rocket", 40, "veg"),
    I("Coconut aminos", 12, "other"), I("Oil, sesame, salad or cooking", 8, "fat"),
  ], ["Build the bowl: quinoa base, edamame, cucumber ribbons, rocket.",
      "Whisk coconut aminos with the sesame oil and dress it."]),
  M("Black Bean Stuffed Peppers", "mexican", 35, ["vegan_gf", "p0"], [
    I("Peppers, bell, red, raw", 250, "veg"), I("Black beans, canned, drained", 200, "protein"),
    I("White rice, cooked", 150, "carb"), I("Tomato Sauce", 100, "other"),
    I("Ground Cumin", 4, "other", false), I("Oil, canola", 8, "fat"),
  ], ["Halve and seed the peppers.",
      "Mix beans, rice, tomato sauce and cumin; stuff the peppers.",
      "Bake at 200°C for 25 minutes until the edges char."]),
  M("Tofu Larb Lettuce Cups", "thai", 20, ["vegan_gf"], [
    I("Tofu, firm, raw", 280, "protein"), I("Napa Cabbage", 120, "veg"),
    I("Lime juice, raw", 20, "other", false), I("Coconut aminos", 12, "other"),
    I("Ginger", 8, "other", false), I("White rice, cooked", 120, "carb"), I("Oil, canola", 8, "fat"),
  ], ["Crumble the tofu into a dry hot pan and cook until it browns and crisps, then add the oil and ginger.",
      "Season with coconut aminos and lime.",
      "Spoon into cabbage leaves with rice on the side."]),
  M("Roasted Cauliflower & Chickpea Traybake", "mediterranean", 30, ["vegan_gf"], [
    I("Cauliflower, raw", 300, "veg"), I("Chickpeas", 60, "protein"),
    I("Olive Oil", 15, "fat"), I("Smoked Paprika", 5, "other", false),
    I("Lemon juice, raw", 15, "other", false), I("Quinoa, cooked", 180, "carb"),
  ], ["Toss cauliflower and cooked chickpeas with oil and paprika; roast at 220°C for 25 minutes.",
      "Serve over quinoa with the lemon squeezed over."]),
  M("Tofu Rice-Noodle Stir Bowl with Lime", "thai", 20, ["vegan_gf"], [
    I("Rice Noodles", 180, "carb"), I("Tofu, firm, raw", 200, "protein"),
    I("Bean Sprouts", 80, "veg"), I("Spring Onions", 30, "veg"),
    I("Coconut aminos", 18, "other"), I("Lime juice, raw", 15, "other", false), I("Oil, canola", 10, "fat"),
  ], ["Soak the rice noodles per the pack.",
      "Fry the tofu in oil until golden; add the rice noodles, sprouts and coconut aminos and toss 2 minutes.",
      "Finish with lime and spring onion."]),

  // ── Vegan + GF snacks (pool had ZERO) ────────────────────────────────────
  M("Hummus & Crunch Plate", "mediterranean", 5, ["vegan_gf"], [
    I("Hummus", 80, "protein"), I("Cucumber", 100, "veg"), I("Peppers, bell, red, raw", 100, "veg"),
  ], ["Slice the vegetables into dippers.", "Dip."], "snack"),
  M("Crispy Spiced Chickpeas", "mediterranean", 25, ["vegan_gf"], [
    I("Chickpeas", 45, "protein"), I("Olive Oil", 6, "fat"), I("Smoked Paprika", 3, "other", false),
  ], ["Dry cooked chickpeas well, toss with oil and paprika.",
      "Roast at 200°C for 20 minutes, shaking once, until they rattle."], "snack"),
  M("Edamame with Flaky Salt", "japanese", 5, ["vegan_gf"], [
    I("Edamame, shelled, cooked", 200, "protein"),
  ], ["Steam or microwave the edamame until hot.", "Season and eat by the handful."], "snack"),
  M("Date & Tahini Bites", "mediterranean", 5, ["vegan_gf"], [
    I("Pitted Dates", 40, "carb"), I("Tahini", 20, "fat"),
  ], ["Split the dates.", "Spoon a little tahini into each."], "snack"),
  M("Pumpkin Seed Trail Mix", "american", 5, ["vegan_gf"], [
    I("Seeds, pumpkin seeds (pepitas), raw", 30, "fat"),
    I("Dried cranberries", 20, "carb"), I("Coconut Flakes", 12, "fat"),
  ], ["Shake everything together in a jar.", "Pocket it."], "snack"),
  M("Avocado & Tomato Rice Cakes", "american", 5, ["vegan_gf"], [
    I("Avocado, raw", 80, "fat"), I("Grape Tomatoes", 80, "veg"), I("White rice, cooked", 100, "carb"),
  ], ["Mash the avocado over warm rice (or rice cakes if you have them).",
      "Top with halved tomatoes, salt and pepper."], "snack"),

  // ── Keto mains (pool had ~20; P3 is OMAD 2,400) ──────────────────────────
  M("Butter-Basted Salmon with Lemon Kale", "american", 20, ["keto", "p2"], [
    I("Salmon, cooked", 220, "protein"), I("Kale", 120, "veg"),
    I("Butter", 18, "fat"), I("Lemon juice, raw", 15, "other", false),
  ], ["Pan-sear the salmon; spoon the foaming butter over it for the last 2 minutes.",
      "Wilt the kale in the same pan with lemon.",
      "Plate skin-side up."]),
  M("Chicken Thigh & Zucchini Feta Skillet", "mediterranean", 25, ["keto", "p0", "p2"], [
    I("Chicken thigh, cooked, skinless", 250, "protein"), I("Courgettes", 200, "veg"),
    I("Cheese, feta", 40, "fat"), I("Olive Oil", 12, "fat"), I("Dried Oregano", 3, "other", false),
  ], ["Brown the thighs hard in olive oil.",
      "Add zucchini half-moons and oregano; cook 6 minutes.",
      "Crumble feta over the top off the heat."]),
  M("Cauliflower Rice Beef Bowl", "chinese", 20, ["p2"], [
    I("Extra-lean ground beef, cooked", 220, "protein"), I("Cauliflower, raw", 300, "carb"),
    I("Coconut aminos", 10, "other"), I("Ginger", 8, "other", false),
    I("Oil, sesame, salad or cooking", 10, "fat"), I("Spring Onions", 30, "veg"),
  ], ["Pulse the cauliflower into rice (or grate it).",
      "Brown the beef with ginger; push aside and fry the cauliflower rice in the sesame oil 4 minutes.",
      "Toss with coconut aminos and spring onion."]),
  M("Three-Egg Cheddar & Kale Scramble", "american", 10, ["keto", "p0", "p2"], [
    I("Eggs, whole, cooked", 180, "protein"), I("Cheese, cheddar", 35, "fat"),
    I("Kale", 80, "veg"), I("Butter", 10, "fat"),
  ], ["Soft-scramble the eggs in butter.",
      "Fold in chopped kale and the cheddar off the heat."]),
  M("Mackerel with Charred Cabbage Wedges", "american", 20, ["keto", "p2"], [
    I("Mackerel", 180, "protein"), I("White Cabbage", 250, "veg"),
    I("Olive Oil", 12, "fat"), I("Lemon juice, raw", 15, "other", false),
  ], ["Cut the cabbage into thick wedges, oil them, and char hard in a pan or under the broiler.",
      "Pan-fry the mackerel 3 minutes a side.",
      "Lemon over everything."]),
  M("Creamy Coconut Chicken Curry", "indian", 25, ["p0", "p2"], [
    I("Chicken thigh, cooked, skinless", 250, "protein"), I("Coconut Cream", 60, "fat"),
    I("Cauliflower, raw", 200, "veg"), I("Curry Powder", 7, "other", false),
    I("Ginger", 6, "other", false), I("Oil, canola", 8, "fat"),
  ], ["Brown the chicken; add curry powder and ginger for 30 seconds.",
      "Add coconut cream and cauliflower florets; simmer 12 minutes, lid on."]),
  M("Steak & Avocado Board", "steakhouse", 20, ["keto", "p0", "p2"], [
    I("Sirloin steak, cooked, lean", 220, "protein"), I("Avocado, raw", 100, "fat"),
    I("Rocket", 40, "veg"), I("Olive Oil", 8, "fat"), I("Lemon juice, raw", 10, "other", false),
  ], ["Sear the steak to your line; rest it 5 minutes.",
      "Slice against the grain over rocket and sliced avocado.",
      "Dress with oil and lemon."]),
  M("Prawn & Zucchini Ribbon Scampi", "italian", 20, ["keto"], [
    I("Prawns", 200, "protein"), I("Courgettes", 250, "carb"),
    I("Butter", 28, "fat"), I("Garlic, raw", 8, "other", false), I("Lemon juice, raw", 15, "other", false),
  ], ["Ribbon the zucchini into noodles.",
      "Sizzle garlic in butter, add prawns until pink, then the zoodles for 90 seconds.",
      "Lemon, pepper, done."]),
  M("Baked Feta Eggs with Peppers", "mediterranean", 20, ["keto", "p0", "p2"], [
    I("Eggs, whole, cooked", 150, "protein"), I("Cheese, feta", 50, "fat"),
    I("Peppers, bell, red, raw", 100, "veg"), I("Olive Oil", 14, "fat"), I("Dried Oregano", 2, "other", false),
  ], ["Soften the peppers in oil in a small oven dish.",
      "Nestle in the feta, crack the eggs around it, and bake at 200°C until just set (10-12 min)."]),
  M("Turkey & Swiss Skillet Melts", "american", 15, ["keto", "p0", "p2"], [
    I("Turkey, ground, 93% lean, 7% fat, raw", 220, "protein"), I("Cheese, swiss, low fat", 45, "fat"),
    I("Onions, raw", 50, "veg"), I("Butter", 10, "fat"),
  ], ["Form thin turkey patties and fry them in butter with the onions.",
      "Cap each with Swiss and lid the pan 1 minute to melt."]),

  // ── Keto / low-carb snacks ───────────────────────────────────────────────
  M("Boiled Eggs & Olives", "mediterranean", 12, ["keto", "p0", "p2"], [
    I("Eggs, whole, cooked", 100, "protein"), I("Green Olives", 40, "fat"),
  ], ["Boil the eggs 8 minutes; peel.", "Plate with the olives and cracked pepper."], "snack"),
  M("Pepperoni & Cheddar Stack", "american", 5, ["keto", "p2"], [
    I("Pepperoni", 30, "protein"), I("Cheese, cheddar", 30, "fat"), I("Cucumber", 80, "veg"),
  ], ["Stack pepperoni and cheddar on cucumber coins."], "snack"),
  M("Cottage Cheese & Pumpkin Seed Cup", "american", 3, ["p0", "p2"], [
    I("Cottage Cheese", 180, "protein"), I("Seeds, pumpkin seeds (pepitas), raw", 15, "fat"),
  ], ["Spoon the seeds over the cottage cheese.", "Pepper it."], "snack"),
  M("Tuna Avocado Boats", "american", 8, ["p2"], [
    I("Fish, tuna, light, canned in water, drained solids", 100, "protein"), I("Avocado, raw", 90, "fat"),
    I("Lemon juice, raw", 10, "other", false),
  ], ["Halve the avocado; pile the drained tuna into the wells.", "Lemon and pepper."], "snack"),

  // ── P0: high-protein Mexican & grill under 4 exclusions ─────────────────
  M("Carne Asada Rice Plate", "mexican", 25, ["p0"], [
    I("Beef, flank, steak, boneless, choice, raw", 250, "protein"), I("White rice, cooked", 200, "carb"),
    I("Peppers, bell, green, raw", 100, "veg"), I("Lime juice, raw", 20, "other", false),
    I("Ground Cumin", 4, "other", false), I("Oil, canola", 10, "fat"),
  ], ["Marinate the flank in lime, cumin and oil while the pan heats.",
      "Sear 4 minutes a side; rest, then slice thin against the grain.",
      "Serve over rice with charred peppers."]),
  M("Chipotle-Style Chicken Burrito Bowl", "mexican", 20, ["p0"], [
    I("Chicken breast, cooked, skinless", 220, "protein"), I("White rice, cooked", 180, "carb"),
    I("Black beans, canned, drained", 120, "carb"), I("Enchilada sauce", 60, "other"),
    I("Cheese, cheddar", 30, "fat"), I("White Cabbage", 60, "veg"),
  ], ["Layer rice, warmed beans and sliced chicken in a bowl.",
      "Spoon over the sauce, then cheese and shredded cabbage."]),
  M("Grilled Chicken Street-Taco Bowl", "mexican", 20, ["p0"], [
    I("Chicken thigh, cooked, skinless", 220, "protein"), I("White rice, cooked", 180, "carb"),
    I("Onions, raw", 50, "veg"), I("Cilantro", 10, "other", false),
    I("Lime juice, raw", 15, "other", false), I("Chili Powder", 5, "other", false),
  ], ["Rub the thighs with chili powder and grill hard.",
      "Chop it over the rice with onion, cilantro and lime."]),
  M("Turkey Fajita Rice Skillet", "mexican", 20, ["p0"], [
    I("Turkey, ground, 93% lean, 7% fat, raw", 250, "protein"), I("Peppers, bell, red, raw", 150, "veg"),
    I("Onions, raw", 80, "veg"), I("White rice, cooked", 150, "carb"),
    I("Smoked Paprika", 4, "other", false), I("Ground Cumin", 3, "other", false), I("Oil, canola", 10, "fat"),
  ], ["Brown the turkey; add peppers, onion and the spices and cook until the edges catch.",
      "Serve over the rice."]),
  M("Backyard Grill Plate: Steak, Potato, Corn", "steakhouse", 30, ["p0"], [
    I("Sirloin steak, cooked, lean", 250, "protein"), I("Potato, baked with skin", 250, "carb"),
    I("Sweetcorn", 100, "veg"), I("Butter", 12, "fat"),
  ], ["Bake or microwave-then-crisp the potato.",
      "Grill the steak to your line; rest 5.",
      "Butter goes on everything."]),
  M("Grilled Salmon with Rice & Asparagus", "american", 25, ["p0", "p2"], [
    I("Salmon, cooked", 200, "protein"), I("White rice, cooked", 180, "carb"),
    I("Asparagus", 150, "veg"), I("Olive Oil", 10, "fat"), I("Lemon juice, raw", 15, "other", false),
  ], ["Grill the salmon and asparagus with oil, 8 minutes.",
      "Serve on rice with lemon."]),
  M("Pollo Verde Bowl", "mexican", 20, ["p0"], [
    I("Chicken breast, cooked, skinless", 230, "protein"), I("Green Salsa", 60, "other"),
    I("White rice, cooked", 180, "carb"), I("Black beans, canned, drained", 100, "carb"),
    I("Greek yogurt, 0%", 40, "other"),
  ], ["Warm the chicken through in the salsa.",
      "Bowl it over rice and beans; finish with a spoon of yogurt as crema."]),
  M("Smash Patties with Rocket & Tomato", "american", 15, ["p0", "p2"], [
    I("Extra-lean ground beef, cooked", 220, "protein"), I("Cheese, cheddar", 30, "fat"),
    I("Rocket", 50, "veg"), I("Plum Tomatoes", 80, "veg"),
  ], ["Smash two thin patties in a screaming pan; cheese the tops.",
      "Serve over the rocket with tomato slices."]),

  // ── P2: Chinese rescued with coconut aminos (no soy, no wheat) ──────────
  M("Coconut-Aminos Chicken Stir-Fry", "chinese", 20, ["p2", "p0"], [
    I("Chicken breast, cooked, skinless", 230, "protein"), I("Broccoli, raw", 150, "veg"),
    I("Peppers, bell, red, raw", 100, "veg"), I("Coconut aminos", 18, "other"),
    I("Ginger", 8, "other", false), I("Garlic, raw", 6, "other", false),
    I("Oil, canola", 10, "fat"), I("White rice, cooked", 180, "carb"),
  ], ["Stir-fry the chicken in oil until golden; set aside.",
      "Fry the vegetables hard with ginger and garlic; return the chicken.",
      "Splash in the coconut aminos, toss, and serve over rice."]),
  M("Weeknight Beef & Broccoli", "chinese", 20, ["p2"], [
    I("Beef, flank, steak, boneless, choice, raw", 230, "protein"), I("Broccoli, raw", 200, "veg"),
    I("Coconut aminos", 20, "other"), I("Ginger", 8, "other", false),
    I("Cornstarch", 6, "other", false), I("Oil, canola", 10, "fat"), I("White rice, cooked", 180, "carb"),
  ], ["Slice the beef thin, dust with cornstarch, and sear in batches.",
      "Add broccoli and a splash of water; lid 2 minutes.",
      "Finish with coconut aminos and ginger; serve on rice."]),
  M("Ginger Prawn Rice Noodles", "chinese", 18, ["p2"], [
    I("Prawns", 200, "protein"), I("Rice Noodles", 160, "carb"),
    I("Pak Choi", 120, "veg"), I("Coconut aminos", 15, "other"),
    I("Ginger", 10, "other", false), I("Oil, sesame, salad or cooking", 8, "fat"),
  ], ["Soak the rice noodles.",
      "Flash-fry prawns with ginger in sesame oil; add pak choi, then the rice noodles and coconut aminos.",
      "Toss 2 minutes and plate."]),
  M("Five-Spice Pork with Cauliflower Rice", "chinese", 20, ["p2"], [
    I("Ground Pork", 220, "protein"), I("Cauliflower, raw", 280, "carb"),
    I("Five Spice Powder", 4, "other", false), I("Coconut aminos", 12, "other"),
    I("Spring Onions", 30, "veg"), I("Oil, canola", 8, "fat"),
  ], ["Brown the pork with five-spice.",
      "Add riced cauliflower and fry 4 minutes; season with coconut aminos.",
      "Shower with spring onion."]),
  M("Orange-Ginger Chicken (Clean Version)", "chinese", 25, ["p2", "p0"], [
    I("Chicken thigh, cooked, skinless", 240, "protein"), I("Orange Juice", 80, "other"),
    I("Coconut aminos", 12, "other"), I("Ginger", 8, "other", false),
    I("Cornstarch", 6, "other", false), I("White rice, cooked", 180, "carb"), I("Broccoli, raw", 120, "veg"),
  ], ["Brown the chicken pieces.",
      "Simmer orange juice, coconut aminos and ginger to a glaze; thicken with the cornstarch slurry.",
      "Toss chicken through; serve with rice and steamed broccoli."]),
  M("Egg & Vegetable Cauliflower Fried Rice", "chinese", 15, ["p2"], [
    I("Eggs, whole, cooked", 150, "protein"), I("Cauliflower, raw", 300, "carb"),
    I("Frozen Peas", 60, "veg"), I("Coconut aminos", 12, "other"),
    I("Oil, sesame, salad or cooking", 10, "fat"), I("Spring Onions", 30, "veg"),
  ], ["Scramble the eggs in sesame oil and set aside.",
      "Fry the cauliflower rice hard 4 minutes; add peas, eggs and coconut aminos.",
      "Finish with spring onion."]),

  // ── Pescatarian / Mediterranean (P5 shape; admitted broadly) ────────────
  M("Sea Bass with Bulgur & Charred Lemon", "mediterranean", 25, ["open"], [
    I("Sea Bass Fillets", 200, "protein"), I("Bulgur, cooked", 200, "carb"),
    I("Courgettes", 150, "veg"), I("Olive Oil", 12, "fat"), I("Lemon", 40, "other", false),
  ], ["Pan-fry the bass skin-down until crisp; flip for 1 minute.",
      "Char the lemon halves cut-side down alongside.",
      "Serve over bulgur with pan-zucchini."]),
  M("Greek Prawn & Feta Orzo-Style Rice", "mediterranean", 25, ["open"], [
    I("Prawns", 200, "protein"), I("White rice, cooked", 200, "carb"),
    I("Cheese, feta", 40, "fat"), I("Plum Tomatoes", 150, "veg"),
    I("Olive Oil", 10, "fat"), I("Dried Oregano", 3, "other", false),
  ], ["Simmer tomatoes with oregano into a quick sauce; add prawns until pink.",
      "Fold through the rice; crumble feta over."]),
  M("Tuna, Black Bean & Rocket Salad", "mediterranean", 10, ["open"], [
    I("Fish, tuna, light, canned in water, drained solids", 150, "protein"),
    I("Black beans, canned, drained", 100, "carb"), I("Rocket", 60, "veg"),
    I("Olive Oil", 15, "fat"), I("Lemon juice, raw", 15, "other", false), I("Onions, red, raw", 40, "veg"),
  ], ["Rinse the beans; toss everything in a big bowl.",
      "Dress with oil, lemon, salt and a lot of pepper."]),
  M("Trout with Potatoes & Green Beans", "mediterranean", 30, ["open", "p2"], [
    I("Rainbow Trout", 200, "protein"), I("Potato, baked with skin", 250, "carb"),
    I("Beans, snap, green, microwaved", 150, "veg"), I("Olive Oil", 12, "fat"),
    I("Dill weed, fresh", 8, "other", false),
  ], ["Roast halved potatoes in oil at 220°C for 20 minutes.",
      "Lay the trout and beans on the tray for the last 10.",
      "Finish with dill."]),
  M("Smoked Haddock & Pea Rice Bowl", "american", 20, ["open", "p2"], [
    I("Smoked Haddock", 200, "protein"), I("White rice, cooked", 220, "carb"),
    I("Frozen Peas", 100, "veg"), I("Butter", 12, "fat"), I("Lemon juice, raw", 10, "other", false),
  ], ["Poach the haddock 6 minutes; flake it.",
      "Stir through buttered rice and peas with lemon."]),
  M("Salmon Quinoa Tabbouleh Plate", "mediterranean", 20, ["open", "p2"], [
    I("Salmon, cooked", 180, "protein"), I("Quinoa, cooked", 200, "carb"),
    I("Cucumber", 100, "veg"), I("Grape Tomatoes", 100, "veg"),
    I("Parsley, fresh", 15, "other", false), I("Olive Oil", 12, "fat"), I("Lemon juice, raw", 15, "other", false),
  ], ["Toss quinoa with chopped cucumber, tomatoes, parsley, oil and lemon.",
      "Top with flaked salmon."]),

  // ── Carnivore (pool had 3) ───────────────────────────────────────────────
  M("Steak & Eggs, Plain and Right", "steakhouse", 20, ["carnivore", "keto", "p0", "p2"], [
    I("Sirloin steak, cooked, lean", 250, "protein"), I("Eggs, whole, cooked", 100, "protein"),
    I("Butter", 15, "fat"),
  ], ["Sear the steak in half the butter; rest it.",
      "Fry the eggs in the rest.",
      "Season generously."]),
  M("Double Beef Cheddar Patties", "american", 15, ["carnivore", "keto", "p0", "p2"], [
    I("Extra-lean ground beef, cooked", 280, "protein"), I("Cheese, cheddar", 40, "fat"), I("Butter", 8, "fat"),
  ], ["Form two patties; fry in butter.",
      "Melt the cheddar over them under a lid."]),
  M("Butter-Roasted Chicken Thighs", "american", 35, ["carnivore", "keto", "p0", "p2"], [
    I("Chicken thigh, cooked, skinless", 320, "protein"), I("Butter", 20, "fat"),
  ], ["Roast the thighs at 220°C in the butter, basting once, ~25 minutes.",
      "Rest 5 and pour the pan butter over."]),
  M("Lamb Chops with Ghee", "steakhouse", 20, ["carnivore", "keto", "p2"], [
    I("Lamb Loin Chops", 280, "protein"), I("Ghee", 15, "fat"),
  ], ["Sear the chops in ghee, 3-4 minutes a side.",
      "Rest and season hard."]),

  // ── General high-protein snacks (pool had 6 total) ──────────────────────
  M("Greek Yogurt & Blueberry Cup", "american", 3, ["p0", "p2"], [
    I("Greek yogurt, 0%", 200, "protein"), I("Blueberries, raw", 100, "carb"),
  ], ["Tip the berries over the yogurt.", "Done."], "snack"),
  M("Skyr with Strawberries & Honey", "american", 3, ["p0", "p2"], [
    I("Greek yogurt, plain, nonfat (skyr-style)", 200, "protein"),
    I("Strawberries", 100, "carb"), I("Honey", 10, "carb"),
  ], ["Slice the strawberries over the skyr; drizzle the honey."], "snack"),
  M("Turkey Roll-Ups with Swiss", "american", 5, ["p0", "p2"], [
    I("Turkey breast, low salt, prepackaged or deli, luncheon meat", 90, "protein"),
    I("Cheese, swiss, low fat", 30, "fat"), I("Cucumber", 60, "veg"),
  ], ["Roll the swiss and cucumber batons inside the turkey slices."], "snack"),
  M("Protein Shake, Whey & Almond Milk", "american", 3, ["p0", "p2"], [
    I("Beverages, Protein powder whey based", 35, "protein"),
    I("Almond milk, unsweetened, plain, refrigerated", 300, "other"), I("Banana", 40, "carb"),
  ], ["Shake or blend everything until smooth."], "snack"),
  M("Overnight Oats with Whey", "american", 5, ["p0", "p2"], [
    I("Oats, rolled, dry", 50, "carb"), I("Beverages, Protein powder whey based", 25, "protein"),
    I("Milk, 2%", 200, "other"), I("Blueberries, raw", 60, "carb"),
  ], ["Stir oats, whey and milk in a jar; fridge overnight.",
      "Berries on top in the morning."], "snack"),
  M("Cottage Cheese & Pineapple Bowl", "american", 3, ["p0", "p2"], [
    I("Cottage Cheese", 200, "protein"), I("Pineapple, raw", 100, "carb"),
  ], ["Spoon the pineapple over the cottage cheese."], "snack"),

  // ── Lean-protein batch (2026-08-20) ─────────────────────────────────────
  // Measured need: P0's only remaining band misses are fatG-over by 2-3 g
  // (4/30 days) — the P0-eligible pool skews slightly fatty, so high
  // protein levers drag fat just past the 70 g edge. These mains run ≤12 g
  // fat/serving with a 1 g-steppable oil lever so the day refine can pull
  // fat DOWN. All are soy/gluten/shellfish/kiwi-clean; most are dairy-free
  // (P6 headroom too).
  M("Grilled Chicken Breast Plate with Rice & Green Beans", "american", 20, ["p0", "p2"], [
    I("Chicken breast, cooked, skinless", 250, "protein"), I("White rice, cooked", 200, "carb"),
    I("Beans, snap, green, microwaved", 150, "veg"), I("Olive Oil", 5, "fat"),
    I("Lemon juice, raw", 10, "other", false),
  ], ["Grill the seasoned breasts hard; rest 3 minutes.",
      "Plate over rice with the beans; a thread of oil and the lemon over everything."]),
  M("Egg White & Chicken Scramble Bowl", "mexican", 15, ["p0", "p2"], [
    I("Eggs, Grade A, Large, egg white", 200, "protein"), I("Chicken breast, cooked, skinless", 120, "protein"),
    I("White rice, cooked", 150, "carb"), I("Enchilada sauce", 50, "other"),
    I("Oil, canola", 4, "fat"), I("Spring Onions", 20, "veg"),
  ], ["Soft-scramble the egg whites in the oil; fold in the diced chicken.",
      "Bowl over rice, warm sauce over, spring onion on top."]),
  M("Poached White Fish, Potatoes & Asparagus", "american", 25, ["p0", "p2"], [
    I("White Fish", 250, "protein"), I("Potato, baked with skin", 280, "carb"),
    I("Asparagus", 150, "veg"), I("Olive Oil", 6, "fat"), I("Lemon juice, raw", 12, "other", false),
  ], ["Poach the fish gently in barely-simmering salted water, 6-8 minutes.",
      "Serve with the potatoes and steamed asparagus; oil and lemon to finish."]),
  M("Turkey & Rice Skillet with Peppers", "american", 20, ["p0", "p2"], [
    I("Turkey, ground, 93% lean, 7% fat, raw", 240, "protein"), I("White rice, cooked", 180, "carb"),
    I("Peppers, bell, red, raw", 120, "veg"), I("Onions, raw", 50, "veg"),
    I("Smoked Paprika", 4, "other", false), I("Oil, canola", 4, "fat"),
  ], ["Brown the turkey; add peppers, onion and paprika and cook 5 minutes.",
      "Stir through the rice until everything is hot."]),
  M("Smoked Haddock with Rice & Peas, Lean", "american", 18, ["p0", "p2"], [
    I("Smoked Haddock", 220, "protein"), I("White rice, cooked", 200, "carb"),
    I("Frozen Peas", 100, "veg"), I("Olive Oil", 5, "fat"), I("Lemon juice, raw", 10, "other", false),
  ], ["Poach and flake the haddock.",
      "Fold through the hot rice and peas with the oil and lemon."]),
  M("Tuna Rice Bowl with Charred Corn", "mexican", 12, ["p0", "p2"], [
    I("Fish, tuna, light, canned in water, drained solids", 160, "protein"),
    I("White rice, cooked", 200, "carb"), I("Sweetcorn", 100, "veg"),
    I("Lime juice, raw", 15, "other", false), I("Cilantro", 8, "other", false), I("Olive Oil", 5, "fat"),
  ], ["Char the corn in a dry pan.",
      "Bowl the rice, flaked tuna and corn; dress with oil, lime and cilantro."]),
  M("Sirloin & Baked Potato, Trimmed", "steakhouse", 25, ["p0", "p2"], [
    I("Sirloin steak, cooked, lean", 220, "protein"), I("Potato, baked with skin", 280, "carb"),
    I("Broccoli, raw", 150, "veg"), I("Olive Oil", 5, "fat"),
  ], ["Sear the trimmed sirloin to your line; rest it.",
      "Serve with the baked potato and steamed broccoli; the oil goes on the broccoli."]),
  M("Egg White Veggie Cups", "american", 15, ["p0", "p2"], [
    I("Eggs, Grade A, Large, egg white", 250, "protein"), I("Peppers, bell, red, raw", 80, "veg"),
    I("Spring Onions", 20, "veg"),
  ], ["Whisk the egg whites with the chopped vegetables; pour into greased ramekins.",
      "Bake at 190°C until just set, ~12 minutes."], "snack"),
  M("Deli Turkey & Rice Cake Stack", "american", 5, ["p0", "p2"], [
    I("Turkey breast, low salt, prepackaged or deli, luncheon meat", 100, "protein"),
    I("White rice, cooked", 100, "carb"), I("Cucumber", 80, "veg"),
  ], ["Stack turkey and cucumber over warm rice (or rice cakes if you have them)."], "snack"),
  M("Salt Cod Brandade-Style Potato Bowl", "mediterranean", 25, ["open", "p2"], [
    I("Salt Cod", 120, "protein"), I("Potato, baked with skin", 300, "carb"),
    I("Garlic, raw", 6, "other", false), I("Olive Oil", 8, "fat"), I("Parsley, fresh", 10, "other", false),
  ], ["Soak the salt cod per the pack, then poach and flake it.",
      "Mash roughly into the hot potatoes with garlic, oil and parsley."]),
];
