// Solver honesty + variety regression tests (solver benchmark, 2026-07-21).
//
// These lock the properties the benchmark harness was built to prove, so they
// can never silently regress:
//   1. NO SILENT TARGET MISS — every day the solver ships publishes its own
//      match %, and any day outside tolerance carries a plain-English miss
//      line; any imperfect week carries an "unsolvable + why" diagnosis.
//   2. An ingredient is never rounded out of existence (the 0 g artifact).
//   3. A slot type the pool cannot fill says so in its own words (snacks).
//   4. Cross-week variety memory really reduces week-over-week repetition.
//
// Pure fixtures only — no DB, no clock, no network.
process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  scaleRecipe, practicalGrams, buildPriorUsage, generateWeekPlan, RECENCY_WEIGHTS,
} = require("../src/lib/weeklyPlanner.js");
const {
  scoreWeek, dayMissLine, dayTolerance, diagnose, varietyOutlook, generateBestWeekPlan,
} = require("../src/lib/mealSolver.js");
const { makeRng } = require("./helpers/seededRng.js");

// ── fixtures ──────────────────────────────────────────────────────────────

const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  beef: { name: "Lean Beef", kcal: 217, protein: 26, fat: 12, carb: 0 },
  tofu: { name: "Firm Tofu", kcal: 144, protein: 15.5, fat: 8.7, carb: 2.8 },
  salmon: { name: "Salmon", kcal: 208, protein: 20.4, fat: 13.4, carb: 0 },
  rice: { name: "White Rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  potato: { name: "Potato", kcal: 87, protein: 1.9, fat: 0.1, carb: 20 },
  broccoli: { name: "Broccoli", kcal: 34, protein: 2.8, fat: 0.4, carb: 7 },
  saffron: { name: "Saffron", kcal: 310, protein: 11, fat: 6, carb: 65 },
  yogurt: { name: "Greek Yogurt", kcal: 59, protein: 10, fat: 0.4, carb: 3.6 },
  banana: { name: "Banana", kcal: 89, protein: 1.1, fat: 0.3, carb: 23 },
};

let seq = 0;
function recipe(name, parts, over = {}) {
  seq++;
  const ingredients = parts.map(([food, grams, role, scalable = true]) => ({
    foodId: `f-${food.name}`, baseGrams: grams, role, scalable, food,
  }));
  const totals = ingredients.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id: `r${seq}-${name}`, name, slotType: "meal", cuisine: null, prepTimeMin: 30, mealCategory: null, ingredients, ...totals, ...over };
}

// A deep-enough meal pool: 36 mains built from 4 proteins × 3 carb/veg bases
// × 3 portion sizes, so a 21-slot week has real headroom to pick fresh dishes.
function deepMealPool() {
  const proteins = [["chicken", F.chicken], ["beef", F.beef], ["tofu", F.tofu], ["salmon", F.salmon]];
  const bases = [["rice", F.rice, "carb"], ["potato", F.potato, "carb"], ["broccoli", F.broccoli, "veg"]];
  const pool = [];
  for (const [pn, pf] of proteins) {
    for (const [bn, bf, role] of bases) {
      for (const size of [140, 170, 200]) {
        pool.push(recipe(`${pn}-${bn}-${size}`, [[pf, size, "protein"], [bf, size + 40, role]]));
      }
    }
  }
  return pool;
}

const TARGET = { kcal: 2200, proteinLo: 150, proteinHi: 170, fatLo: 50, fatHi: 85, carbLo: 150, carbHi: 260 };

// ── 1. portion rounding never deletes an ingredient ───────────────────────

test("practicalGrams: 5 g steps above 20 g, whole grams below, and NEVER 0 for a real amount", () => {
  assert.equal(practicalGrams(217), 215);
  assert.equal(practicalGrams(22.4), 20);
  assert.equal(practicalGrams(19.4), 19);
  assert.equal(practicalGrams(1.6), 2);
  // The bug this floor exists for: sub-half-gram amounts used to round to 0,
  // deleting the ingredient from the plate AND the grocery list while the
  // recipe card still named it.
  assert.equal(practicalGrams(0.4), 1);
  assert.equal(practicalGrams(0.05), 1);
  // A genuinely absent amount stays absent.
  assert.equal(practicalGrams(0), 0);
  assert.equal(practicalGrams(-3), 0);
});

test("scaleRecipe: a pinch-sized ingredient survives a 0.5× portion instead of vanishing", () => {
  const r = recipe("saffron rice", [[F.chicken, 200, "protein"], [F.rice, 200, "carb"], [F.saffron, 0.6, "other"]]);
  // Ask for a small slot so the solve drives the scale toward the 0.5× floor.
  const scaled = scaleRecipe(r, 300, 25);
  const saffron = scaled.ingredients.find((i) => i.name === "Saffron");
  assert.ok(saffron, "saffron must still be listed");
  assert.ok(saffron.grams > 0, `saffron shipped at ${saffron.grams} g — an ingredient must never be rounded out of existence`);
  for (const ing of scaled.ingredients) {
    assert.ok(ing.grams > 0, `${ing.name} shipped at 0 g`);
  }
});

// ── 2. every day publishes its own match % ────────────────────────────────

test("scoreWeek: publishes one honest row per day — match %, deltas, and a miss line when it misses", async () => {
  const pool = deepMealPool();
  const slots = await generateWeekPlan(TARGET, { meals: 3, snacks: 0 }, pool, { rng: makeRng(11) });
  const score = scoreWeek(TARGET, slots);

  assert.equal(score.days.length, 7, "all 7 days must be reported, not just the rough ones");
  for (const d of score.days) {
    assert.ok(Number.isInteger(d.matchPct) && d.matchPct >= 0 && d.matchPct <= 100, `day ${d.dayOfWeek} match % is ${d.matchPct}`);
    assert.equal(typeof d.dayName, "string");
    assert.equal(typeof d.inTolerance, "boolean");
    if (d.inTolerance) assert.equal(d.miss, null, "a day inside tolerance states no miss");
    else assert.ok(typeof d.miss === "string" && d.miss.length > 0, `day ${d.dayOfWeek} is out of tolerance with no miss line`);
  }
  assert.equal(score.daysInTolerance, score.days.filter((d) => d.inTolerance).length);
});

test("dayMissLine: plain English, names the direction, silent only when on target", () => {
  const t = { kcal: 2000, proteinLo: 140, proteinHi: 160 };
  assert.equal(dayMissLine(t, { kcal: 2000, protein: 150 }), null);
  const under = dayMissLine(t, { kcal: 1500, protein: 150 });
  assert.match(under, /1,500 kcal vs a 2,000 target/);
  assert.match(under, /500 under/);
  const over = dayMissLine(t, { kcal: 2600, protein: 150 });
  assert.match(over, /600 over/);
  const short = dayMissLine(t, { kcal: 2000, protein: 90 });
  assert.match(short, /90 g protein vs 150 g — 60 g short/);
  // No guilt language anywhere — this text renders on food data (CLAUDE.md law b).
  for (const line of [under, over, short]) {
    assert.doesNotMatch(line, /fail|bad|wrong|blew|ruin/i);
  }
});

test("scoreWeek: a marginal miss is judged on exact totals, never on display-rounded ones", () => {
  // 15.009% under target. Rounding the day total to 2,720 kcal first makes it
  // read as exactly -15.0% — inside tolerance — and the miss disappears.
  const target = { kcal: 3200, proteinLo: 200, proteinHi: 220, fatLo: 70, fatHi: 110, carbLo: 250, carbHi: 400 };
  const slots = [
    { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: "x", kcal: 2719.71, protein: 210, fat: 90, carb: 300, ingredients: [], warning: null },
  ];
  const score = scoreWeek(target, slots);
  assert.equal(score.days[0].inTolerance, false, "a 15.009% miss must not round its way to clean");
  assert.ok(score.days[0].miss, "and it must say what it missed by");
  assert.equal(score.daysInTolerance, 0);
});

test("dayTolerance: ±15% calories, protein shortfall only (over-delivering protein is never a miss)", () => {
  const t = { kcal: 2000, proteinLo: 140, proteinHi: 160 };
  assert.equal(dayTolerance(t, { kcal: 2300, protein: 150 }).kcalOk, true);   // +15% exactly
  assert.equal(dayTolerance(t, { kcal: 2301, protein: 150 }).kcalOk, false);
  assert.equal(dayTolerance(t, { kcal: 1700, protein: 150 }).kcalOk, true);   // -15% exactly
  assert.equal(dayTolerance(t, { kcal: 2000, protein: 260 }).proteinOk, true, "protein over the band is not a miss");
  assert.equal(dayTolerance(t, { kcal: 2000, protein: 120 }).proteinOk, false);
});

// ── 3. THE headline property: no silent target miss, ever ─────────────────

const HONESTY_CASES = [
  { tag: "deep pool, 3 meals", pool: deepMealPool(), mealConfig: { meals: 3, snacks: 0 } },
  { tag: "deep pool + snacks the pool cannot fill", pool: deepMealPool(), mealConfig: { meals: 3, snacks: 1 } },
  { tag: "thin pool (3 recipes, 21 slots)", pool: deepMealPool().slice(0, 3), mealConfig: { meals: 3, snacks: 0 } },
  { tag: "single recipe", pool: deepMealPool().slice(0, 1), mealConfig: { meals: 3, snacks: 1 } },
  { tag: "empty pool", pool: [], mealConfig: { meals: 3, snacks: 1 } },
  { tag: "4 meals + 2 snacks", pool: deepMealPool(), mealConfig: { meals: 4, snacks: 2 } },
];

for (const c of HONESTY_CASES) {
  test(`no silent miss — ${c.tag}`, async () => {
    for (const seed of [1, 7, 99, 4242]) {
      const week = await generateBestWeekPlan(TARGET, c.mealConfig, c.pool, { rng: makeRng(seed), attempts: 3 });

      // (a) every day publishes a match % — the number IS the honesty.
      assert.ok(Array.isArray(week.score.days) && week.score.days.length === 7,
        `${c.tag}/seed ${seed}: week shipped without a per-day match %`);

      // (b) any day outside tolerance names its own miss.
      for (const d of week.score.days) {
        if (!d.inTolerance) {
          assert.ok(d.miss, `${c.tag}/seed ${seed}: day ${d.dayOfWeek} missed target with no miss line`);
        }
      }

      // (c) any imperfect week carries "unsolvable + why", with at least one
      // reason AND at least one suggestion the user can act on.
      const imperfect = week.score.daysInTolerance < 7 || week.slots.some((s) => !s.recipeId);
      if (imperfect) {
        assert.ok(week.diagnosis, `${c.tag}/seed ${seed}: imperfect week shipped with no diagnosis`);
        assert.ok(week.diagnosis.reasons.length > 0, `${c.tag}/seed ${seed}: diagnosis with no reason`);
        assert.ok(week.diagnosis.suggestions.length > 0, `${c.tag}/seed ${seed}: diagnosis with no suggestion`);
        // Never tell someone to loosen an allergy to make the math work.
        for (const s of week.diagnosis.suggestions) {
          assert.doesNotMatch(s, /allerg/i, `${c.tag}: a suggestion mentioned allergies`);
        }
      } else {
        assert.equal(week.diagnosis, null, `${c.tag}/seed ${seed}: clean week carried a diagnosis`);
      }

      // (d) an unfilled slot always says why it is unfilled.
      for (const s of week.slots) {
        if (!s.recipeId) assert.ok(s.warning, `${c.tag}/seed ${seed}: an empty slot shipped with no explanation`);
        for (const ing of s.ingredients || []) {
          assert.ok(ing.grams > 0, `${c.tag}/seed ${seed}: "${ing.name}" shipped at 0 g`);
        }
      }
    }
  });
}

test("a week that misses only ONE day still gets a reason (no threshold lottery)", async () => {
  // The old rule attached a diagnosis only BELOW 6/7 days, so a 6/7 week shipped
  // with one day off target and nothing saying why. This target/pool combination
  // lands on 6/7 for a known share of seeds, so the assertion is never vacuous.
  const pool = deepMealPool();
  const stretchTarget = { kcal: 3400, proteinLo: 230, proteinHi: 250, fatLo: 50, fatHi: 95, carbLo: 150, carbHi: 320 };
  let sixOfSeven = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const week = await generateBestWeekPlan(stretchTarget, { meals: 3, snacks: 0 }, pool, { rng: makeRng(seed), attempts: 1 });
    if (week.score.daysInTolerance !== 6) continue;
    sixOfSeven++;
    assert.ok(week.diagnosis?.reasons.length, `a 6/7 week shipped with no reason (seed ${seed})`);
    const missed = week.score.days.filter((d) => !d.inTolerance);
    assert.equal(missed.length, 1);
    assert.ok(missed[0].miss, `the one missed day (${missed[0].dayName}) shipped with no miss line`);
  }
  assert.ok(sixOfSeven > 0, "sweep produced no 6/7 week — this test would have passed vacuously; retune the fixture");
});

// ── 4. a slot type the pool cannot fill says so ───────────────────────────

test("diagnose: names the snack shortage in its own words when snack slots cannot be filled", () => {
  const pool = deepMealPool(); // zero snack-eligible recipes
  const d = diagnose({
    counts: { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget: TARGET, mealConfig: { meals: 3, snacks: 1 }, pool,
  });
  assert.ok(d.reasons.some((r) => /snack/i.test(r)), `no snack reason given:\n${d.reasons.join("\n")}`);
  assert.ok(d.reasons.some((r) => /snack slots this week come back empty/i.test(r)));
  assert.ok(d.suggestions.some((s) => /snack/i.test(s)));
  for (const s of d.suggestions) assert.doesNotMatch(s, /allerg/i);
});

test("diagnose: says nothing about snacks when the pool can cover them", () => {
  const pool = [
    ...deepMealPool(),
    ...Array.from({ length: 6 }, (_, i) =>
      recipe(`snack-${i}`, [[F.yogurt, 200, "protein"], [F.banana, 100, "carb"]], { slotType: "snack" })),
  ];
  const d = diagnose({
    counts: { raw: pool.length, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget: TARGET, mealConfig: { meals: 3, snacks: 1 }, pool,
  });
  assert.ok(!d.reasons.some((r) => /snack slots this week come back empty/i.test(r)));
});

test("varietyOutlook: reports how many weeks of distinct dinners the pool can actually carry", () => {
  const pool = deepMealPool(); // 36 meal-eligible
  const wide = varietyOutlook({ pool, mealConfig: { meals: 2, snacks: 0 }, horizonWeeks: 2 });
  assert.equal(wide.mealEligible, 36);
  assert.equal(wide.weeklyMealSlots, 14);
  assert.ok(wide.distinctWeeks >= 2);
  assert.equal(wide.sustainsHorizon, true);
  assert.deepEqual(wide.notes, []);

  const tight = varietyOutlook({ pool, mealConfig: { meals: 3, snacks: 1 }, horizonWeeks: 4 });
  assert.equal(tight.sustainsHorizon, false);
  assert.ok(tight.notes.length >= 1, "a pool that cannot carry the horizon must say so");
  assert.ok(tight.notes.some((n) => /snack/i.test(n)), "and must call out the empty snack slots");
});

test("varietyOutlook: counts only the dishes that can actually be PORTIONED into the slot, not the whole pool", () => {
  // Raw pool size overstated variety: a pool of small dishes cannot fill big
  // dinner slots inside the 0.5–2× portion band, so the solver keeps reusing
  // the handful that can. The outlook has to reflect that, not the headcount.
  const pool = deepMealPool();
  const cfg = { meals: 3, snacks: 0 };
  const bigDay = { kcal: 4500, proteinLo: 250, proteinHi: 280, fatLo: 90, fatHi: 130, carbLo: 400, carbHi: 520 };
  const withTarget = varietyOutlook({ pool, mealConfig: cfg, horizonWeeks: 4, dailyTarget: bigDay });
  const headcountOnly = varietyOutlook({ pool, mealConfig: cfg, horizonWeeks: 4 });

  assert.equal(headcountOnly.usableForSlot, headcountOnly.mealEligible, "with no target it can only count heads");
  assert.ok(withTarget.usableForSlot < withTarget.mealEligible,
    `a ${withTarget.slotKcal} kcal slot should exclude dishes that cannot stretch to it (${withTarget.usableForSlot}/${withTarget.mealEligible})`);
  assert.ok(withTarget.notes.some((n) => n.includes(`${withTarget.usableForSlot} of your ${withTarget.mealEligible}`)),
    `the note must show both numbers:\n${withTarget.notes.join("\n")}`);
});

// ── 5. cross-week variety memory ──────────────────────────────────────────

test("buildPriorUsage: recency-weights previous plans, newest first, ignoring empty slots", () => {
  const plans = [
    { slots: [{ recipeId: "a" }, { recipeId: "b" }, { recipeId: null }] },
    { slots: [{ recipeId: "a" }] },
    { slots: [{ recipeId: "c" }] },
    { slots: [{ recipeId: "d" }] }, // beyond the weight table — ignored
  ];
  const u = buildPriorUsage(plans);
  assert.equal(u.get("a"), RECENCY_WEIGHTS[0] + RECENCY_WEIGHTS[1]);
  assert.equal(u.get("b"), RECENCY_WEIGHTS[0]);
  assert.equal(u.get("c"), RECENCY_WEIGHTS[2]);
  assert.equal(u.get("d"), undefined, "plans older than the weight table carry no weight");
  assert.equal(buildPriorUsage(null).size, 0);
  assert.equal(buildPriorUsage([{ slots: null }]).size, 0);
});

test("priorUsage measurably reduces week-over-week repetition on a pool with headroom", async () => {
  const pool = deepMealPool(); // 36 recipes, 21 meal slots/week
  const cfg = { meals: 3, snacks: 0 };
  let overlapWithout = 0, overlapWith = 0;
  const seeds = [2, 4, 6, 8, 10, 12, 14, 16];
  for (const seed of seeds) {
    const week1 = await generateWeekPlan(TARGET, cfg, pool, { rng: makeRng(seed) });
    const ids1 = new Set(week1.filter((s) => s.recipeId).map((s) => s.recipeId));

    const plain = await generateWeekPlan(TARGET, cfg, pool, { rng: makeRng(seed + 1000) });
    const memo = await generateWeekPlan(TARGET, cfg, pool, {
      rng: makeRng(seed + 1000), priorUsage: buildPriorUsage([{ slots: week1 }]),
    });
    overlapWithout += plain.filter((s) => s.recipeId && ids1.has(s.recipeId)).length;
    overlapWith += memo.filter((s) => s.recipeId && ids1.has(s.recipeId)).length;
  }
  assert.ok(overlapWith < overlapWithout,
    `cross-week memory did not reduce repeats: ${overlapWith} repeated servings with memory vs ${overlapWithout} without`);
});

test("priorUsage is SOFT — a pool with no alternative still fills every slot", async () => {
  const pool = deepMealPool().slice(0, 2);
  const cfg = { meals: 2, snacks: 0 };
  const week1 = await generateWeekPlan(TARGET, cfg, pool, { rng: makeRng(5) });
  // Every recipe heavily "used" — the discount must never become a veto.
  const priorUsage = buildPriorUsage([{ slots: week1 }, { slots: week1 }, { slots: week1 }]);
  const week2 = await generateWeekPlan(TARGET, cfg, pool, { rng: makeRng(6), priorUsage });
  const filled = week2.filter((s) => s.recipeId).length;
  const plain = await generateWeekPlan(TARGET, cfg, pool, { rng: makeRng(6) });
  assert.equal(filled, plain.filter((s) => s.recipeId).length,
    "the cross-week discount changed how many slots could be filled — it must only re-rank, never exclude");
});
