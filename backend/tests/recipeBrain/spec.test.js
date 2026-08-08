const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSpec, specFingerprint, gapSpecsFromDay, meetsDensityFloor, densityOf,
  SPEC_VERSION, FAT_ENERGY_FRAC_CEILING,
} = require("../../src/lib/recipeBrain/spec.js");
const { KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT } = require("../../src/lib/weeklyPlanner.js");

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE BRAIN — the spec engine. Pure math, zero network, zero DB. Every
// derived number is re-derived here BY HAND from the same formula the module
// documents, so a drifting implementation fails against the spec's own claim.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210, keto: false };
const TARGET = { slotType: "meal", kcalTarget: 620, proteinTarget: 45 };

test("density floor and mid are exactly the documented formulas", () => {
  const s = buildSpec({ target: TARGET, dailyTarget: DAY });
  const mid = (45 / 620) * 100;
  const floor = ((45 * (1 - PROTEIN_TOLERANCE_PCT)) / (620 * (1 + KCAL_TOLERANCE_PCT))) * 100;
  assert.equal(s.proteinDensityMid, Math.round(mid * 100) / 100);
  assert.equal(s.proteinDensityFloor, Math.round(floor * 100) / 100);
  assert.ok(s.proteinDensityFloor < s.proteinDensityMid, "the tolerance corner is below the on-target density");
});

test("fat/carb guidance is the day band scaled by the slot's kcal share — and absent without a dailyTarget", () => {
  const s = buildSpec({ target: TARGET, dailyTarget: DAY });
  const share = 620 / 2100;
  assert.equal(s.fatTargetG.lo, Math.round(55 * share * 10) / 10);
  assert.equal(s.fatTargetG.hi, Math.round(65 * share * 10) / 10);
  assert.equal(s.carbTargetG.lo, Math.round(180 * share * 10) / 10);
  const bare = buildSpec({ target: TARGET });
  assert.equal(bare.fatTargetG, null, "no day target → no fabricated fat band");
  assert.equal(bare.carbTargetG, null);
});

test("fat-energy fraction aim is capped at the evidence ceiling and never above it", () => {
  const s = buildSpec({ target: TARGET, dailyTarget: DAY });
  assert.ok(s.fatEnergyFracMax <= FAT_ENERGY_FRAC_CEILING);
  const fatty = buildSpec({ target: TARGET, dailyTarget: { ...DAY, fatLo: 200, fatHi: 260 } });
  assert.equal(fatty.fatEnergyFracMax, FAT_ENERGY_FRAC_CEILING, "an absurd band cannot raise the aim past the ceiling");
});

test("walls ride from the profile only, and the matrix dials prefer filters over profile", () => {
  const s = buildSpec({
    target: TARGET, dailyTarget: DAY,
    filters: { cuisines: ["mexican"], maxCostCad: 6 },
    profile: { dietaryStyle: "vegetarian", excludedFoods: ["peanuts", "shellfish"], cuisinePreferences: ["italian"], maxPrepMin: 30, budgetTier: "cheap" },
  });
  assert.equal(s.walls.dietaryStyle, "vegetarian");
  assert.deepEqual(s.walls.excludedFoods, ["peanuts", "shellfish"]);
  assert.deepEqual(s.soft.cuisines, ["mexican"], "explicit filter cuisines beat profile preferences");
  assert.equal(s.caps.maxCostCad, 6);
  assert.equal(s.caps.maxPrepMin, 30, "profile back-fills a dial the filters left unset");
  assert.equal(s.soft.budget, "cheap");
});

test("buildSpec refuses a target it cannot derive from", () => {
  assert.throws(() => buildSpec({ target: { slotType: "meal" } }), /required positive numbers/);
  assert.throws(() => buildSpec({ target: { kcalTarget: -5, proteinTarget: 40 } }));
});

test("every derived number carries its formula in prov", () => {
  const s = buildSpec({ target: TARGET, dailyTarget: DAY });
  assert.equal(s.version, SPEC_VERSION);
  assert.match(s.prov.formulas.proteinDensityFloor, /proteinTarget/);
  assert.equal(s.prov.derivedFrom.dayKcal, 2100);
});

// ── fingerprint ─────────────────────────────────────────────────────────────

test("fingerprint is stable across exclusion casing/dupes and blind to irrelevant fields", () => {
  const a = buildSpec({ target: TARGET, dailyTarget: DAY, profile: { excludedFoods: ["Peanuts", "dairy "] } });
  const b = buildSpec({ target: TARGET, dailyTarget: DAY, profile: { excludedFoods: ["dairy", "peanuts", "PEANUTS"] } });
  assert.equal(specFingerprint(a), specFingerprint(b));
});

test("fingerprint changes when a matrix cap changes — a $4 request is not an unlimited request", () => {
  const base = buildSpec({ target: TARGET, dailyTarget: DAY });
  const capped = buildSpec({ target: TARGET, dailyTarget: DAY, filters: { maxCostCad: 4 } });
  assert.notEqual(specFingerprint(base), specFingerprint(capped));
});

test("fingerprint buckets nearby targets together (618 and 622 kcal are the same ask)", () => {
  // 618 and 622 both round to the 625 bucket (KCAL_BUCKET 25). Values that
  // straddle a bucket EDGE (612 vs 618) key apart — that is the documented
  // trade: the bucket decides where to LOOK, the fit gate decides what ships,
  // so an edge miss costs a scan, never a wrong serve.
  const a = buildSpec({ target: { ...TARGET, kcalTarget: 618 }, dailyTarget: DAY });
  const b = buildSpec({ target: { ...TARGET, kcalTarget: 622 }, dailyTarget: DAY });
  assert.equal(specFingerprint(a), specFingerprint(b));
  const far = buildSpec({ target: { ...TARGET, kcalTarget: 812 }, dailyTarget: DAY });
  assert.notEqual(specFingerprint(a), specFingerprint(far));
});

test("fingerprint separates slot types and diets", () => {
  const meal = buildSpec({ target: TARGET, dailyTarget: DAY });
  const snack = buildSpec({ target: { ...TARGET, slotType: "snack" }, dailyTarget: DAY });
  const vegan = buildSpec({ target: TARGET, dailyTarget: DAY, profile: { dietaryStyle: "vegan" } });
  assert.notEqual(specFingerprint(meal), specFingerprint(snack));
  assert.notEqual(specFingerprint(meal), specFingerprint(vegan));
});

// ── density screen ──────────────────────────────────────────────────────────

const food = (name, kcal, protein, fat, carb) => ({ name, kcal, protein, fat, carb });
const ing = (f, baseGrams, role, scalable = true) => ({ foodId: f.name, baseGrams, role, scalable, food: f });

test("meetsDensityFloor is bundle-aware: a lean protein bundle rescues a carby recipe", () => {
  const chicken = food("chicken", 165, 31, 3.6, 0); // 18.8 g P / 100 kcal
  const rice = food("rice", 130, 2.7, 0.3, 28); // 2.1
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY }); // floor ≈ 5.55
  const dish = { kcal: 442, protein: 50, ingredients: [ing(chicken, 150, "protein"), ing(rice, 150, "carb")] };
  assert.equal(meetsDensityFloor(dish, spec), true);
});

test("meetsDensityFloor rejects a structurally protein-thin recipe (no portion can save it)", () => {
  const oil = food("olive oil", 884, 0, 100, 0);
  const bread = food("bread", 265, 9, 3.2, 49); // 3.4 g P / 100 kcal
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY });
  const dish = { kcal: 400, protein: 8, ingredients: [ing(bread, 100, "carb"), ing(oil, 15, "fat")] };
  assert.equal(meetsDensityFloor(dish, spec), false);
  assert.ok(densityOf(dish) < spec.proteinDensityFloor);
});

// ── gap specs from a solved day ─────────────────────────────────────────────

test("gapSpecsFromDay specs ONLY the slots the solver itself flagged, and derives fat emphasis from the day totals", () => {
  const candidate = {
    slots: [
      { slotType: "meal", slotIndex: 0, recipeId: "r-ok", warning: null, kcal: 640, protein: 44 },
      { slotType: "meal", slotIndex: 1, recipeId: null, warning: null, kcal: 0, protein: 0 },
      { slotType: "snack", slotIndex: 0, recipeId: "r-warn", warning: "landed 180 kcal vs a 260 target", kcal: 180, protein: 9 },
    ],
    score: { matchPct: 71, totals: { kcal: 1900, protein: 120, fat: 80, carb: 150 } }, // fat over the 65 g band
  };
  const gaps = gapSpecsFromDay({ candidate, dailyTarget: DAY, mealConfig: { meals: 2, snacks: 1 }, profile: {} });
  assert.equal(gaps.length, 2, "the clean slot is left alone");
  assert.deepEqual(gaps.map((g) => g.slot.slotType), ["meal", "snack"]);
  assert.equal(gaps[0].reason, "unfilled");
  assert.match(gaps[1].reason, /180 kcal/);
  for (const g of gaps) {
    assert.equal(g.spec.emphasis.fat, "lower", "a fat-heavy day asks its gaps for lean recipes");
    assert.ok(g.spec.kcalTarget > 0 && g.spec.proteinTarget > 0);
  }
});

test("gapSpecsFromDay returns [] for a clean day and for garbage input", () => {
  const clean = { slots: [{ slotType: "meal", slotIndex: 0, recipeId: "r", warning: null }], score: {} };
  assert.deepEqual(gapSpecsFromDay({ candidate: clean, dailyTarget: DAY, mealConfig: { meals: 1, snacks: 0 } }), []);
  assert.deepEqual(gapSpecsFromDay({}), []);
  assert.deepEqual(gapSpecsFromDay({ candidate: null }), []);
});
