// Stage A0 — golden BASELINE fixtures + producer.
//
// `computeBaseline()` runs the current (BRAIN=off) engine across a small,
// documented, fixed fixture set and returns one plain object covering the four
// subsystems the master build prompt names: solver / grocery / trend / diary.
// The SAME function both (a) generates the committed golden JSON and (b) is run
// by goldenBaseline.test.js, so any drift in deterministic output is caught
// byte-for-byte. Determinism comes from a seeded RNG + pure functions only —
// no DB, no network, no wall-clock.
//
// Regenerate the committed golden ONLY on an intended change (and review the diff):
//   cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\n'))"

const { generateBestWeekPlan, generateDayCandidates } = require("../../src/lib/mealSolver.js");
const { buildGroceryList } = require("../../src/lib/groceryList.js");
const { trendRate, verdict, computeEnergy } = require("../../src/lib/bmrEngine.js");
const { toDiaryShape } = require("../../src/routes/diary.js");
const { makeRng } = require("../helpers/seededRng.js");

// ── recipe pool fixture ────────────────────────────────────────────────────
// Each recipe carries a scalable protein-role ingredient + a scalable carb/veg
// ingredient — the shape scaleRecipe()'s 2-factor solve targets. Cached totals
// are derived from the ingredients, exactly as the seeded DB pool stores them.

function food(id, kcal, protein, fat, carb) {
  return { id, name: id, kcal, protein, fat, carb };
}

function recipe(id, proteinFood, proteinG, carbFood, carbG, opts = {}) {
  const ingredients = [
    { foodId: proteinFood.id, baseGrams: proteinG, scalable: true, role: "protein", food: proteinFood },
    { foodId: carbFood.id, baseGrams: carbG, scalable: true, role: opts.carbRole || "carb", food: carbFood },
  ];
  const t = ingredients.reduce(
    (s, i) => {
      const f = i.baseGrams / 100;
      return { kcal: s.kcal + i.food.kcal * f, protein: s.protein + i.food.protein * f, fat: s.fat + i.food.fat * f, carb: s.carb + i.food.carb * f };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  return {
    id, name: id, slotType: opts.slotType || "meal", source: "curated",
    cuisine: opts.cuisine || null, prepTimeMin: opts.prepTimeMin ?? null, mealCategory: opts.mealCategory ?? null,
    kcal: t.kcal, protein: t.protein, fat: t.fat, carb: t.carb, ingredients,
  };
}

const F = {
  chicken: food("Chicken Breast", 165, 31, 3.6, 0),
  beef: food("Lean Beef", 250, 26, 15, 0),
  tofu: food("Firm Tofu", 144, 15, 8, 3),
  salmon: food("Salmon", 208, 20, 13, 0),
  rice: food("White Rice", 130, 2.7, 0.3, 28),
  potato: food("Potato", 87, 2, 0.1, 20),
  oats: food("Oats", 389, 17, 7, 66),
  broccoli: food("Broccoli", 34, 2.8, 0.4, 7),
};

// 8 distinct meal recipes across proteins × carbs/veg — enough material for the
// week solver to fill 7 days at the 2× repeat cap without collapsing to one dish.
const RECIPE_POOL = [
  recipe("Chicken & Rice", F.chicken, 150, F.rice, 150, { cuisine: "american" }),
  recipe("Beef & Potato", F.beef, 150, F.potato, 200, { cuisine: "american" }),
  recipe("Tofu & Rice", F.tofu, 200, F.rice, 150, { cuisine: "asian" }),
  recipe("Salmon & Broccoli", F.salmon, 170, F.broccoli, 150, { carbRole: "veg", cuisine: "american" }),
  recipe("Chicken & Oats", F.chicken, 150, F.oats, 80, { cuisine: "american" }),
  recipe("Beef & Broccoli", F.beef, 150, F.broccoli, 200, { carbRole: "veg", cuisine: "asian" }),
  recipe("Tofu & Potato", F.tofu, 200, F.potato, 200, { cuisine: "american" }),
  recipe("Salmon & Rice", F.salmon, 170, F.rice, 150, { cuisine: "asian" }),
];

const DAILY_TARGET = { kcal: 2200, proteinLo: 180, proteinHi: 200, fatLo: 50, fatHi: 85, carbLo: 150, carbHi: 260 };
const BASE_PROFILE = { dietaryStyle: "none", excludedFoods: [] };

// ── grocery fixture ────────────────────────────────────────────────────────
// A fixed solved/unsolved plan in buildGroceryList's own input contract
// ({meals:[{status,anchor,adjusters}]}). Locks aggregation (rice summed across
// two meals), yield conversion, store-section classification, and CAD costing;
// the unsolved slot must contribute nothing.
const GROCERY_PLAN = {
  meals: [
    { status: "solved", anchor: { ingredients: [{ name: "Chicken Breast", grams: 200, state: "raw" }, { name: "White Rice", grams: 75, state: "dry" }] }, adjusters: [{ name: "Broccoli", grams: 120, state: "raw" }] },
    { status: "solved", anchor: { ingredients: [{ name: "Lean Beef", grams: 180, state: "raw" }, { name: "Potato", grams: 260, state: "raw" }] }, adjusters: [{ name: "Olive Oil", grams: 12, state: "raw" }] },
    { status: "solved", anchor: { ingredients: [{ name: "Salmon", grams: 150, state: "raw" }, { name: "White Rice", grams: 60, state: "dry" }] }, adjusters: [] },
    { status: "unsolved", anchor: null, adjusters: [] },
  ],
};

// ── trend fixture ──────────────────────────────────────────────────────────
// 10 daily weigh-ins declining ~1.5 lb/wk with mild noise — ≥8 points, so
// trendRate's 14-day regression returns a real slope; verdict reads off it.
const WEIGHINS = [
  { date: "2026-07-01", weightLb: 210.2 },
  { date: "2026-07-02", weightLb: 209.8 },
  { date: "2026-07-03", weightLb: 210.0 },
  { date: "2026-07-04", weightLb: 209.5 },
  { date: "2026-07-05", weightLb: 209.1 },
  { date: "2026-07-06", weightLb: 209.3 },
  { date: "2026-07-07", weightLb: 208.7 },
  { date: "2026-07-08", weightLb: 208.4 },
  { date: "2026-07-09", weightLb: 208.6 },
  { date: "2026-07-10", weightLb: 208.0 },
];

// ── diary fixture ──────────────────────────────────────────────────────────
// Mixed planned + manual day — locks toDiaryShape's entry mapping + running totals.
const DIARY_LOGS = [
  { id: "log1", name: "Oats & Whey", kcal: 420, proteinG: 34, carbG: 55, fatG: 9, slotType: "meal", source: "planned" },
  { id: "log2", name: "Chicken & Rice", kcal: 610, proteinG: 52, carbG: 68, fatG: 12, slotType: "meal", source: "planned" },
  { id: "log3", name: "Greek Yogurt", kcal: 150, proteinG: 25, carbG: 9, fatG: 2, slotType: "snack", source: "manual" },
];

// ── BMR fixture (A0, Stage 3 v2) ────────────────────────────────────────────
// Locks the BMR MEAN (the number that materializes Profile.targetKcal) across
// the age bands + the body-fat gate, at bodyFatPct null / 0 / known. The
// snapshot captures ONLY the load-bearing numbers — rmr + the INCLUDED formulas'
// rounded values — so E1's additive fields (sd/spreadPct/prov/defaultOn) and the
// 4 new DEFAULT-OFF formulas never false-trip the byte diff. Under Option A the
// included set is unchanged, so every value here must stay identical after E1.
const BMR_FIXTURES = [
  { name: "M 33 bf null", weightKg: 80, profile: { heightCm: 180, age: 33, sex: "M", bodyFatPct: null, excludedFormulas: [] } },
  { name: "M 33 bf 0 (legacy unknown)", weightKg: 80, profile: { heightCm: 180, age: 33, sex: "M", bodyFatPct: 0, excludedFormulas: [] } },
  { name: "F 45 bf 0", weightKg: 65, profile: { heightCm: 165, age: 45, sex: "F", bodyFatPct: 0, excludedFormulas: [] } },
  { name: "M 65 bf 0 (schofield drops)", weightKg: 85, profile: { heightCm: 175, age: 65, sex: "M", bodyFatPct: 0, excludedFormulas: [] } },
  { name: "M 33 bf 20 (LBM formulas apply)", weightKg: 80, profile: { heightCm: 180, age: 33, sex: "M", bodyFatPct: 20, excludedFormulas: [] } },
  { name: "F 28 bf 22", weightKg: 60, profile: { heightCm: 168, age: 28, sex: "F", bodyFatPct: 22, excludedFormulas: [] } },
];

function bmrSnapshot(profile, weightKg) {
  const e = computeEnergy(profile, weightKg);
  return {
    rmr: e.rmr,
    includedCount: e.includedCount,
    spreadLo: e.spreadLo,
    spreadHi: e.spreadHi,
    included: e.rows.filter((r) => !r.excluded).map((r) => ({ key: r.key, v: Math.round(r.v) })),
  };
}

// Fresh seeded RNG per scenario so each is independent of call order.
async function computeBaseline() {
  const week = await generateBestWeekPlan(DAILY_TARGET, { meals: 3, snacks: 0 }, RECIPE_POOL, { rng: makeRng(0xa0), attempts: 3 });
  const dayCandidates = await generateDayCandidates({
    dailyTarget: DAILY_TARGET, mealConfig: { meals: 3, snacks: 1 }, recipePool: RECIPE_POOL,
    dayOfWeek: 0, rng: makeRng(0xb0), profile: BASE_PROFILE, count: 3, attempts: 6,
  });
  const grocery = buildGroceryList(GROCERY_PLAN);
  const rate = trendRate(WEIGHINS);
  const trend = { rate, verdict: verdict({ rate, chosenRate: 1.5, daysIn: 15, atFloor: false }) };
  const diary = toDiaryShape(DIARY_LOGS);
  const bmr = BMR_FIXTURES.map((f) => ({ name: f.name, ...bmrSnapshot(f.profile, f.weightKg) }));
  return { solver: { week, dayCandidates }, grocery, trend, diary, bmr };
}

module.exports = { computeBaseline, RECIPE_POOL, DAILY_TARGET, BMR_FIXTURES };
