// personas/fixtures.js — the synthetic customers (CUT_PROTOCOL_DIRECTIVE §7).
//
// Personas declare EXPLICIT calorie and macro targets — the harness never
// depends on the onboarding engine (the formula engine has its own tests).
// Where the directive's table omits a number, the value chosen here is a
// recorded build-time default (marked `assumed`). Every fixture passed
// prescription/feasibility.js at authoring time.
//
// PRIVACY (docs/BLOCKERS.md B5): p0 is a synthetic high-protein/four-
// exclusion stress profile. No name, no identity, no personal data.
//
// P7 (the override attempter) joins at Phase 7 with the safety rails —
// its gate needs the rails to exist (§7 gate list).

"use strict";

const PERSONAS = [
  {
    id: "p0",
    label: "high-protein founder-shaped profile, four allergen walls",
    profile: { dietaryStyle: null, excludedFoods: ["shellfish", "gluten", "kiwi", "soy"] },
    targets: { kcal: 2150, proteinG: { lo: 200, hi: 220 }, fatG: { lo: 60, hi: 70 }, netCarbG: { lo: 135, hi: 160 }, floorKcal: 2000 },
    mealConfig: { meals: 3, snacks: 1 },
    likesCuisines: ["mexican", "steakhouse", "american"],
    stresses: "high protein under four simultaneous exclusions",
  },
  {
    id: "p1",
    label: "celiac vegan woman, 1,600 kcal",
    profile: { dietaryStyle: "vegan", excludedFoods: ["gluten"] },
    targets: { kcal: 1600, proteinG: { lo: 85, hi: 105 }, fatG: { lo: 45, hi: 55 }, netCarbG: { lo: 165, hi: 195 } }, // macros assumed
    mealConfig: { meals: 3, snacks: 1 },
    forbiddenIngredientWords: /(chicken|beef|pork|lamb|turkey|fish|salmon|tuna|prawn|shrimp|egg|yogurt|cheese|milk|butter|honey|seitan)/i,
    stresses: "protein without meat OR gluten — seitan is pure wheat gluten and must never appear",
  },
  {
    id: "p2",
    label: "soy + wheat allergy, 2,000 kcal, loves Chinese",
    profile: { dietaryStyle: null, excludedFoods: ["soy", "wheat"] },
    targets: { kcal: 2000, proteinG: { lo: 140, hi: 160 }, fatG: { lo: 60, hi: 70 }, netCarbG: { lo: 180, hi: 200 } }, // macros assumed
    mealConfig: { meals: 3, snacks: 1 },
    likesCuisines: ["chinese"],
    stresses: "the derived-ingredient trap: soy sauce, hoisin, oyster sauce; coconut aminos must rescue the cuisine",
  },
  {
    id: "p3",
    label: "keto OMAD, 2,400 kcal, ≤25 g net carbs",
    profile: { dietaryStyle: "keto", excludedFoods: [] },
    // netCarbG lo is 0 on purpose: under a CEILING, less is never a miss.
    targets: { kcal: 2400, proteinG: { lo: 150, hi: 170 }, fatG: { lo: 175, hi: 195 }, netCarbG: { lo: 0, hi: 25 }, netCarbMaxG: 25 }, // P/F assumed
    mealConfig: { meals: 1, snacks: 0 },
    stresses: "one giant meal inside a hard carb ceiling — the slot holds several dishes",
  },
  {
    id: "p4",
    label: "budget student, $60/week, 3,000 kcal",
    profile: { dietaryStyle: null, excludedFoods: [] },
    targets: { kcal: 3000, proteinG: { lo: 150, hi: 180 }, fatG: { lo: 80, hi: 100 }, netCarbG: { lo: 350, hi: 380 } }, // macros assumed
    mealConfig: { meals: 3, snacks: 2 },
    budgetPerDayCad: 60 / 7, // cost is a bias + a REPORTED number; the price table is loud about being estimates
    stresses: "cost tier as a real constraint",
  },
  {
    id: "p5",
    label: "pescatarian Mediterranean, 1,800 kcal",
    // "pescatarian" is NOT a dietary style in this app (AUDIT §5.4 correction;
    // 9 styles, none of them pescatarian). Expressed as meat exclusions until
    // the lattice grows the style — recorded gap, BUILD_LOG Phase 2.
    profile: { dietaryStyle: null, excludedFoods: ["beef", "pork", "chicken", "lamb", "turkey", "bacon", "ham", "sausage"] },
    targets: { kcal: 1800, proteinG: { lo: 110, hi: 130 }, fatG: { lo: 60, hi: 70 }, netCarbG: { lo: 160, hi: 180 } }, // macros assumed
    mealConfig: { meals: 3, snacks: 1 },
    likesCuisines: ["mediterranean"],
    forbiddenIngredientWords: /(chicken|beef|pork|lamb|turkey|bacon|ham|sausage|chorizo|pepperoni)/i,
    stresses: "fish allowed, shellfish allowed — ontology precision in the other direction",
  },
  {
    id: "p6",
    label: "lactose-intolerant powerlifter, 3,200 kcal, 220 g protein, dislikes cottage cheese",
    profile: { dietaryStyle: null, excludedFoods: ["lactose"] }, // resolves to the dairy wall — hard
    targets: { kcal: 3200, proteinG: { lo: 213, hi: 227 }, fatG: { lo: 90, hi: 110 }, netCarbG: { lo: 325, hi: 355 } }, // F/C assumed
    mealConfig: { meals: 4, snacks: 2 },
    dislikes: /cottage cheese/i, // SOFT — a bias, never a wall; handled differently from the allergy by design
    stresses: "hard exclusion + soft dislike handled differently",
  },
];

module.exports = { PERSONAS };
