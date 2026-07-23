// Seeded random profile generator for the QC gauntlet (Phase 0).
//
// Produces a FULL, engine-valid profile over realistic ranges — the same shape
// the real Profile row has, so computeEnergy / deriveTarget / computeMacros and
// the dietary filter all run on it unmodified, no mocks. Every corner the prompt
// names is reachable: imperial AND metric rounding paths, body-fat present and
// absent (so Katch/Cunningham drop in and out), floor-clamping rate/weight combos,
// every diet style, allergy stacks up to worst-case, and the full meal/snack range.

import { childSeed, mulberry32, sampler } from "./rng.mjs";

const OCCUPATIONS = [
  "desk-office", "software-tech", "accounting-finance", "customer-support",
  "student", "driver-truck", "unemployed-home", "teacher", "retail-sales",
  "cashier", "lab-technician", "reception-admin", "security-guard", "nurse-healthcare",
  "server-bartender", "warehouse", "mechanic", "electrician", "carpenter-finish",
  "chef-kitchen", "cleaner-janitorial", "postal-courier", "personal-trainer",
  "construction-labourer", "roofer-scaffolder", "landscaper", "farm-work",
  "mover", "welder-fabricator", "firefighter", "logging-forestry", "mining",
];
const TRAINING_STYLES = ["weights", "cardio", "mixed", "sport"];
// none => no dietary restriction (stored as null); the rest are the real supported styles.
const DIET_STYLES = ["none", "mediterranean", "vegetarian", "vegan", "paleo", "keto", "carnivore", "halal", "kosher"];
// The 10 canonical allergen keys the dietary filter recognises (dietaryFilter.js).
const ALLERGENS = ["gluten", "shellfish", "dairy", "soy", "nuts", "eggs", "fish", "kiwi", "peanuts", "sesame"];
const BUDGETS = ["cheap", "moderate", "premium"];

const cm = (inches) => Math.round(inches * 2.54 * 10) / 10;
const kg = (lb) => Math.round((lb / 2.2046226218) * 10) / 10;

export function genProfile(baseSeed, i) {
  const seed = childSeed(baseSeed, i);
  const S = sampler(mulberry32(seed));
  const { float, int, bool, pick, sample } = S;

  const sex = bool(0.5) ? "M" : "F";

  // Exercise BOTH unit paths for real: imperial profiles are generated in whole
  // inches / pounds then converted (the rounding the UI actually produces),
  // metric profiles in whole cm / kg. Either way the engine sees cm + kg.
  const imperial = bool(0.6);
  let heightCm, weightKg, weightLb;
  if (imperial) {
    const inches = sex === "M" ? int(63, 78) : int(58, 73);
    weightLb = sex === "M" ? int(120, 330) : int(100, 300);
    heightCm = cm(inches);
    weightKg = kg(weightLb);
  } else {
    const h = sex === "M" ? int(160, 198) : int(148, 185);
    const wk = sex === "M" ? int(55, 150) : int(45, 135);
    heightCm = h;
    weightKg = wk;
    weightLb = Math.round(wk * 2.2046226218);
  }

  const age = int(18, 80);

  // Body-fat present ~65% of the time; 0 = "unknown" (the engine convention that
  // hides Katch-McArdle / Cunningham). Present values span lean to high.
  const hasBf = bool(0.65);
  const bodyFatPct = hasBf ? Math.round(float(sex === "M" ? 6 : 14, sex === "M" ? 38 : 48) * 10) / 10 : 0;

  const occupationKey = pick(OCCUPATIONS);
  // A minority carry a manual multiplier override (exercises that branch).
  const activityOverride = bool(0.12) ? Math.round(float(1.2, 1.9) * 100) / 100 : null;

  const sessionsPerWeek = int(0, 6);
  const trainingStyle = pick(TRAINING_STYLES);
  const minutesPerSession = sessionsPerWeek === 0 ? 45 : pick([30, 45, 60, 75, 90]);

  // Rate spans the real menu. Deliberately biased toward including aggressive
  // rates on lighter bodies so the floor clamp is exercised often.
  const rateLbPerWeek = pick([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);
  // ~10% carry a stricter personal floor above the sex minimum.
  const floorKcal = bool(0.1) ? int(1400, 2100) : null;

  // Formula exclusions: usually none; sometimes drop 1–2 (never forced all —
  // the all-excluded fallback is a rare edge left to Phase 3 break-it).
  const ALL_FORMULAS = ["mifflin", "harris", "katch", "cunningham"];
  const excludedFormulas = bool(0.15) ? sample(ALL_FORMULAS, int(1, 2)) : [];

  // Diet + allergies. Allergy distribution: ~45% none, ~30% single, ~18% pair,
  // ~7% worst-case stack (3–4). Stacks are where feasibility collapses.
  const dietaryStyle = pick(DIET_STYLES);
  const roll = float(0, 1);
  let excludedFoods;
  if (roll < 0.45) excludedFoods = [];
  else if (roll < 0.75) excludedFoods = sample(ALLERGENS, 1);
  else if (roll < 0.93) excludedFoods = sample(ALLERGENS, 2);
  else excludedFoods = sample(ALLERGENS, int(3, 4));

  const mealsPerDay = int(2, 6);
  const snacksPerDay = int(0, 3);

  // Optional soft filters, on/off.
  const maxPrepMin = bool(0.35) ? pick([15, 20, 30, 45]) : null;
  const budgetTier = bool(0.3) ? pick(BUDGETS) : null;
  const cuisinePreferences = [];

  const profile = {
    sex, age, heightCm, bodyFatPct,
    occupationKey, activityOverride,
    sessionsPerWeek, trainingStyle, minutesPerSession,
    rateLbPerWeek, floorKcal, excludedFormulas,
    // stored fields the engine ignores but a real row carries:
    unitPref: imperial ? "imperial" : "metric",
    startWeightKg: weightKg, goalWeightKg: Math.max(kg(90), Math.round((weightKg * 0.85) * 10) / 10),
    rateAcknowledged: true, // harness derives targets directly; UI's 422 gate is out of scope here
    dietaryStyle: dietaryStyle === "none" ? null : dietaryStyle,
    mealsPerDay, snacksPerDay, excludedFoods,
    cuisinePreferences, maxPrepMin, budgetTier,
    allowBatch: false, maxComplexity: null,
    adaptiveTdee: true, proteinPriorityMode: false,
  };

  return {
    seed,
    profile,
    weightKg,
    weightLb,
    // the exact inputs the solve path needs, pre-shaped:
    mealConfig: { meals: mealsPerDay, snacks: snacksPerDay },
    dietProfile: { dietaryStyle: profile.dietaryStyle, excludedFoods },
    filters: { cuisines: [], protein: null, budget: budgetTier, maxPrepMin, allowBatchRepeats: false },
    // corner tags for the failure-pattern taxonomy:
    corner: {
      diet: dietaryStyle,
      allergyStack: excludedFoods.length === 0 ? "none" : excludedFoods.slice().sort().join("+"),
      allergyCount: excludedFoods.length,
      bodyFat: hasBf ? "known" : "unknown",
      units: imperial ? "imperial" : "metric",
      meals: `${mealsPerDay}m+${snacksPerDay}s`,
    },
  };
}
