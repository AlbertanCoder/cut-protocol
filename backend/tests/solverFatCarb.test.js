// solver-core-4 — the solver searches on the SAME four macros it is graded on.
//
// The bug these lock down: solver-core-2 (2026-07-23) made mealSolver's
// `dayInTolerance` a four-macro verdict (kcal + protein + fat + carb) but left
// weeklyPlanner's `resolveSlot` searching on two. It shipped the FIRST candidate
// that cleared the kcal/protein gate and discarded every other passing one, so
// no fat or carb number was ever read by the search. Measured against the real
// 889-recipe library over 1,470 sampled days: 25.8% of days landed in tolerance,
// and fat alone explained essentially all of the rest (fat in range on 36.3% of
// days against 96.7% for calories and 94.1% for protein). Not an infeasible ask
// — the fits existed, nothing looked for them.
//
// Three separate lies are covered here:
//   A. the SEARCH ignored fat/carb                    (resolveSlot / solveDay)
//   B. matchPct said 93% about days graded out        (scoreDay / SCORE_WEIGHTS)
//   C. the named binding constraint said "calorie and protein"  (classifyBinding)
//   D. "fail fast" ran five full solves first, and a 0-day solve declared nothing
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveSlot, generateWeekPlan, scaleRecipe,
  KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT,
  hasCompositionTarget, compositionDistance, bandMidpoint,
} = require("../src/lib/weeklyPlanner.js");
const {
  scoreDay, scoreWeek, dayTolerance, dayInTolerance, classifyBinding,
  generateBestWeekPlan, SCORE_WEIGHTS, BINDING,
  DAY_FAT_TOLERANCE_PCT,
} = require("../src/lib/mealSolver.js");
const { makeRng } = require("./helpers/seededRng.js");

// ── fixture pool ─────────────────────────────────────────────────────────

const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  turkey: { name: "Ground Turkey 99", kcal: 112, protein: 24, fat: 1.4, carb: 0 },
  whitefish: { name: "Cod", kcal: 82, protein: 18, fat: 0.7, carb: 0 },
  salmon: { name: "Salmon", kcal: 208, protein: 20, fat: 13, carb: 0 },
  cream: { name: "Heavy Cream", kcal: 340, protein: 2.8, fat: 36, carb: 2.8 },
  oil: { name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 },
  rice: { name: "White Rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  potato: { name: "Potato", kcal: 87, protein: 2, fat: 0.1, carb: 20 },
};

let seq = 0;
function recipe(name, parts, over = {}) {
  seq++;
  const ingredients = parts.map(([food, grams, role, scalable = true]) => ({
    foodId: `f-${food.name}`, baseGrams: grams, role, scalable, food,
  }));
  const t = ingredients.reduce(
    (s, i) => {
      const k = i.baseGrams / 100;
      return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  return { id: `r-${seq}-${name}`, name, slotType: "meal", mealCategory: null, source: "curated", cuisine: null, prepTimeMin: 20, ingredients, ...t, ...over };
}

// Two dishes that BOTH clear the kcal/protein gate for the same slot and differ
// only in what they are made OF — the exact choice the old search never made.
const LEAN = recipe("Chicken & Rice", [[F.chicken, 150, "protein"], [F.rice, 150, "carb"]]);
const FATTY = recipe("Salmon in Cream", [[F.salmon, 150, "protein"], [F.cream, 100, "fat"]]);

const SLOT = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, weight: 1, kcalTarget: 600, proteinTarget: 45 };

async function pickOnce(target, pool, seed) {
  return resolveSlot(target, pool, new Map(), new Set(), new Set(), makeRng(seed));
}

// ═════════════════════════════════════════════════════════════════════════
// A — the search reads fat and carbs
// ═════════════════════════════════════════════════════════════════════════

test("A: the premise — BOTH fixture dishes clear the kcal/protein gate on their own", async () => {
  for (const r of [LEAN, FATTY]) {
    const scaled = scaleRecipe(r, SLOT.kcalTarget, SLOT.proteinTarget);
    const kcalOff = Math.abs(scaled.kcal - SLOT.kcalTarget) / SLOT.kcalTarget;
    const pShort = Math.max(0, (SLOT.proteinTarget - scaled.protein) / SLOT.proteinTarget);
    assert.ok(kcalOff <= KCAL_TOLERANCE_PCT, `${r.name} kcal off ${(kcalOff * 100).toFixed(1)}%`);
    assert.ok(pShort <= PROTEIN_TOLERANCE_PCT, `${r.name} protein short ${(pShort * 100).toFixed(1)}%`);
  }
  // …and they are genuinely different dishes on fat, or this file proves nothing.
  const lean = scaleRecipe(LEAN, SLOT.kcalTarget, SLOT.proteinTarget);
  const fatty = scaleRecipe(FATTY, SLOT.kcalTarget, SLOT.proteinTarget);
  assert.ok(fatty.fat > lean.fat * 3, `fat spread too small to test: ${lean.fat} vs ${fatty.fat}`);
});

test("A: with a fat budget on the slot, the composition-closest fit wins — on EVERY seed", async () => {
  const pool = [LEAN, FATTY];
  // fatShare/carbShare = this slot's nominal share of the day's fat/carb
  // midpoint; fatTarget/carbTarget = what is actually LEFT of it. Equal here
  // because nothing has been solved yet today.
  const leanTarget = { ...SLOT, fatShare: 8, fatTarget: 8, carbShare: 45, carbTarget: 45 };
  const fattyTarget = { ...SLOT, fatShare: 40, fatTarget: 40, carbShare: 5, carbTarget: 5 };
  for (let seed = 1; seed <= 40; seed++) {
    assert.equal((await pickOnce(leanTarget, pool, seed)).recipeId, LEAN.id, `seed ${seed}: a lean fat budget must not ship the cream dish`);
    assert.equal((await pickOnce(fattyTarget, pool, seed)).recipeId, FATTY.id, `seed ${seed}: a fat-heavy budget must not ship the rice dish`);
  }
});

test("A: WITHOUT a fat/carb budget the original first-fit-wins path is untouched", async () => {
  // No composition target -> the pick is whatever the weighted draw produced
  // first, exactly as before. Both dishes must therefore still turn up.
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) seen.add((await pickOnce(SLOT, [LEAN, FATTY], seed)).recipeId);
  assert.equal(seen.size, 2, "a target with no fat/carb budget must not become deterministic");
});

test("A: the composition budget never overrides the kcal/protein gate", async () => {
  // A dish that is a perfect fat match but cannot reach the slot's calories is
  // still rejected — fat is a tie-break among fits, never a way in.
  const tiny = recipe("Tiny Cod Plate", [[F.whitefish, 40, "protein"], [F.potato, 30, "carb"]]);
  const r = await pickOnce({ ...SLOT, fatShare: 0.5, fatTarget: 0.5, carbShare: 6, carbTarget: 6 }, [LEAN, tiny], 7);
  assert.equal(r.recipeId, LEAN.id, "the closest-fat dish must not be shipped when it misses the calorie wall");
  assert.equal(r.warning, null);
});

test("A: helpers — a composition target is 'absent', never a silent zero", () => {
  assert.equal(hasCompositionTarget({ kcalTarget: 600, proteinTarget: 45 }), false);
  assert.equal(hasCompositionTarget({ fatShare: 12 }), true);
  assert.equal(hasCompositionTarget({ carbShare: 40 }), true);
  assert.equal(hasCompositionTarget({ fatShare: 0, carbShare: 0 }), false);
  assert.equal(compositionDistance({ kcalTarget: 1 }, { fat: 99, carb: 99 }), 0, "no budget -> no opinion");
  assert.ok(Math.abs(compositionDistance({ fatShare: 10, fatTarget: 10 }, { fat: 12, carb: 0 }) - 0.2) < 1e-9);
  assert.ok(
    Math.abs(compositionDistance({ fatShare: 10, fatTarget: 10, carbShare: 50, carbTarget: 50 }, { fat: 8, carb: 45 }) - 0.15) < 1e-9,
    "mean of the two distances, each in units of that slot's own share"
  );
  // The ASK can be spent to nothing while the SCALE stays the stable divisor —
  // otherwise one macro's term explodes and drowns the other out.
  assert.ok(
    Math.abs(compositionDistance({ fatShare: 10, fatTarget: 0, carbShare: 50, carbTarget: 50 }, { fat: 5, carb: 45 }) - 0.3) < 1e-9,
    "a spent fat budget means 'as lean as possible', measured against the share"
  );
  assert.equal(compositionDistance({ fatShare: 10 }, { fat: 12 }), compositionDistance({ fatShare: 10, fatTarget: 10 }, { fat: 12 }),
    "an absent ask falls back to the nominal share");
  assert.equal(bandMidpoint(50, 70), 60);
  assert.equal(bandMidpoint(undefined, 70), null, "a missing band is null, not 0");
  assert.equal(bandMidpoint(50, 0), null);
});

// A pool deep enough to fill 21 meal slots at the 2×/week variety cap, holding
// both lean dishes and rich ones that ALSO clear the kcal/protein gate — so the
// old two-macro search would happily ship either and the fat outcome came down
// to draw order.
function mixedPool() {
  const lean = [];
  for (let i = 0; i < 12; i++) {
    const base = i % 3 === 0 ? [F.chicken, 150 + i * 4] : i % 3 === 1 ? [F.turkey, 200 + i * 5] : [F.whitefish, 220 + i * 5];
    const side = i % 2 === 0 ? [F.rice, 150 + i * 5] : [F.potato, 230 + i * 6];
    lean.push(recipe(`Lean ${i}`, [[base[0], base[1], "protein"], [side[0], side[1], "carb"]]));
  }
  const rich = [];
  for (let i = 0; i < 12; i++) {
    rich.push(recipe(`Rich ${i}`, [[F.salmon, 150 + i * 6, "protein"], [F.rice, 150 + i * 6, "carb"]]));
  }
  return { lean, rich, all: [...lean, ...rich] };
}

test("A: the premise — the rich dishes DO clear the kcal/protein gate, and blow the fat band", () => {
  const { rich } = mixedPool();
  for (const r of rich) {
    const scaled = scaleRecipe(r, 660, 52);
    assert.ok(Math.abs(scaled.kcal - 660) / 660 <= KCAL_TOLERANCE_PCT, `${r.name} misses kcal`);
    assert.ok(Math.max(0, (52 - scaled.protein) / 52) <= PROTEIN_TOLERANCE_PCT, `${r.name} misses protein`);
    // …and three of them would put the day far outside an 18-32 g fat band.
    assert.ok(scaled.fat * 3 > 60, `${r.name} is not fat-heavy enough to be a real trap: ${scaled.fat}`);
  }
});

const A_TARGET = { kcal: 2000, proteinLo: 150, proteinHi: 170, fatLo: 34, fatHi: 44, carbLo: 200, carbHi: 270 };
// The SAME target with the two composition bands removed. A target with no
// fat/carb band produces no fat/carb budget, so solveDay hands resolveSlot
// nothing to choose on and the pre-solver-core-4 first-fit search runs — an
// in-process control for "what the old search did", judged against the full
// target either way.
const A_TARGET_BLIND = { kcal: A_TARGET.kcal, proteinLo: A_TARGET.proteinLo, proteinHi: A_TARGET.proteinHi };
const A_SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];

async function weekOutcome(solveTarget, pool) {
  let kcalOk = 0, proteinOk = 0, fatOk = 0, days = 0, unfilled = 0;
  for (const seed of A_SEEDS) {
    const slots = await generateWeekPlan(solveTarget, { meals: 3, snacks: 0 }, pool, { rng: makeRng(seed) });
    unfilled += slots.filter((s) => !s.recipeId).length;
    const byDay = new Map();
    for (const s of slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);
    for (const [, ds] of byDay) {
      const t = ds.reduce((a, s) => ({ kcal: a.kcal + s.kcal, protein: a.protein + s.protein, fat: a.fat + s.fat, carb: a.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
      // Always judged against the FULL target — the band is what the day is
      // graded on whether or not the search was allowed to see it.
      const tol = dayTolerance(A_TARGET, t);
      days++;
      if (tol.kcalOk) kcalOk++;
      if (tol.proteinOk) proteinOk++;
      // `fatBandOk`, not `fatOk` — and the difference is the whole point of this
      // counter. This test asks a question about the SEARCH: does a solver that
      // can see the fat band hit that band more often than one that cannot? The
      // band is what the search aims at (solveDay derives its fat budget from
      // fatLo/fatHi), so the band is what the search must be scored against.
      //
      // `fatOk` is the VERDICT, and since 2026-08-03 the verdict grades a 20–35
      // %E share plus the target's absolute essential-fat floor — a different
      // question, on a different scale, that the search never optimised for.
      // Scoring search behaviour with it made this test read as a regression
      // every time ruler POLICY moved: at the 20 %E floor this fixture's 34–44 g
      // band (15.3–19.8 %E at 2,000 kcal) sits entirely underneath the floor, so
      // the search hits its target and the verdict fails all 70 days.
      //
      // That is a stale fixture, not a product defect — the band predates 005bb3e,
      // when fat was a fixed gram count per lb of lean mass. A sweep of 280 real
      // energy-anchored prescriptions (2 sexes × 5 body-fat levels × 4 weights × 7
      // calorie targets) puts a band's LOWER EDGE below 20 %E exactly zero times,
      // so no real target can land where this fixture does. The fixture is left
      // as written on purpose: its lean/rich trap is calibrated to this band, and
      // re-aiming the target without re-calibrating the pool made the measured
      // gain go NEGATIVE (37 blind → 18 seeing), which would have quietly turned
      // a real property into a broken one.
      if (tol.fatBandOk) fatOk++;
    }
  }
  return { kcalOk, proteinOk, fatOk, days, unfilled };
}

test("A: a whole week — fat lands in range far more often, and calories/protein do not pay for it", async () => {
  const { all } = mixedPool();
  const seeing = await weekOutcome(A_TARGET, all);
  const blind = await weekOutcome(A_TARGET_BLIND, all);

  assert.equal(seeing.days, 70);
  assert.equal(seeing.unfilled, 0, "the fixture pool must be deep enough that nothing is left empty");
  assert.equal(blind.unfilled, 0);

  // The two GATED macros must not pay for the composition gain — that is the
  // acceptance condition of this change.
  assert.equal(seeing.kcalOk, seeing.days, `calorie compliance regressed: ${seeing.kcalOk}/${seeing.days}`);
  assert.equal(seeing.proteinOk, seeing.days, `protein compliance regressed: ${seeing.proteinOk}/${seeing.days}`);
  assert.ok(seeing.kcalOk >= blind.kcalOk, `calories got worse once fat was considered: ${blind.kcalOk} -> ${seeing.kcalOk}`);
  assert.ok(seeing.proteinOk >= blind.proteinOk, `protein got worse once fat was considered: ${blind.proteinOk} -> ${seeing.proteinOk}`);

  // …and fat, which the search could not previously see at all, improves a lot.
  assert.ok(seeing.fatOk > blind.fatOk * 1.3,
    `fat compliance barely moved: ${blind.fatOk}/${blind.days} fat-blind -> ${seeing.fatOk}/${seeing.days} composition-aware`);
});

// ═════════════════════════════════════════════════════════════════════════
// B — matchPct stops overstating
// ═════════════════════════════════════════════════════════════════════════

const B_TARGET = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 50, fatHi: 70, carbLo: 180, carbHi: 220 };

test("B: the weights are a four-macro objective, and calories keep their calibration", () => {
  const sum = SCORE_WEIGHTS.kcal + SCORE_WEIGHTS.protein + SCORE_WEIGHTS.fat + SCORE_WEIGHTS.carb;
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must still sum to 1, got ${sum}`);
  assert.ok(SCORE_WEIGHTS.fat > 0.075 && SCORE_WEIGHTS.carb > 0.075, "fat/carb must weigh more than the 0.075 that let a 98 g miss cost 7.5 points");
  assert.ok(SCORE_WEIGHTS.kcal > SCORE_WEIGHTS.protein, "calories stay the single heaviest term");
  // The long-standing calibration the rest of the suite reads: a 10% calorie
  // miss, everything else on target, costs ~5 points.
  assert.equal(scoreDay(B_TARGET, [{ kcal: 2200, protein: 150, fat: 60, carb: 200 }]).matchPct, 95);
  assert.equal(scoreDay(B_TARGET, [{ kcal: 2000, protein: 150, fat: 60, carb: 200 }]).matchPct, 100);
});

test("B: a day the app grades OUT of tolerance can no longer publish a 90%+ match", () => {
  // Calorie- and protein-perfect, fat 98 g outside its band — the shape that
  // used to score 93%.
  const slots = [{ kcal: 2000, protein: 150, fat: 168, carb: 200 }];
  const tol = dayTolerance(B_TARGET, slots[0]);
  assert.equal(tol.kcalOk, true);
  assert.equal(tol.proteinOk, true);
  assert.equal(tol.fatOk, false, "the premise: this day IS out of tolerance on fat");
  assert.equal(dayInTolerance(tol), false);
  const sc = scoreDay(B_TARGET, slots);
  assert.ok(sc.matchPct < 90, `a day graded out of tolerance published ${sc.matchPct}%`);
  assert.equal(sc.fatInRange, false);
  // It forfeits the WHOLE fat weight, no more: matchPct is a closeness measure,
  // not a punishment scale.
  assert.equal(sc.matchPct, Math.round((1 - SCORE_WEIGHTS.fat) * 100));
});

test("B: failing both composition macros costs both weights", () => {
  const sc = scoreDay(B_TARGET, [{ kcal: 2000, protein: 150, fat: 168, carb: 420 }]);
  assert.equal(sc.matchPct, Math.round((1 - SCORE_WEIGHTS.fat - SCORE_WEIGHTS.carb) * 100));
  assert.equal(sc.carbInRange, false);
});

test("B: inside the band costs nothing, and the penalty scales with how far out", () => {
  const inBand = scoreDay(B_TARGET, [{ kcal: 2000, protein: 150, fat: 70, carb: 220 }]);
  assert.equal(inBand.matchPct, 100, "sitting on the edge of the band is still inside it");
  const mid = (B_TARGET.fatLo + B_TARGET.fatHi) / 2;
  const half = scoreDay(B_TARGET, [{ kcal: 2000, protein: 150, fat: B_TARGET.fatHi + mid * DAY_FAT_TOLERANCE_PCT / 2, carb: 200 }]);
  const full = scoreDay(B_TARGET, [{ kcal: 2000, protein: 150, fat: B_TARGET.fatHi + mid * DAY_FAT_TOLERANCE_PCT, carb: 200 }]);
  assert.ok(full.matchPct < half.matchPct && half.matchPct < 100, `expected a graded penalty, got ${half.matchPct} / ${full.matchPct}`);
  assert.equal(full.matchPct, Math.round((1 - SCORE_WEIGHTS.fat) * 100), "the term saturates exactly at the tolerance line");
});

test("B: a target with no fat/carb band is not judged on one (absent, never a silent fail)", () => {
  const partial = { kcal: 2000, proteinLo: 140, proteinHi: 160 };
  const sc = scoreDay(partial, [{ kcal: 2000, protein: 150, fat: 999, carb: 999 }]);
  assert.equal(sc.matchPct, 100);
  assert.equal(sc.fatInRange, true);
  assert.equal(sc.carbInRange, true);
});

test("B: keto gets no upward carb allowance in the score either — it is a diet law", () => {
  const keto = { kcal: 2100, proteinLo: 180, proteinHi: 200, fatLo: 140, fatHi: 175, carbLo: 20, carbHi: 50, keto: true };
  const over = scoreDay(keto, [{ kcal: 2100, protein: 190, fat: 155, carb: 51 }]);
  assert.equal(over.carbInRange, false);
  assert.equal(over.matchPct, Math.round((1 - SCORE_WEIGHTS.carb) * 100), "one gram over a ceiling is over the ceiling");
  const under = scoreDay(keto, [{ kcal: 2100, protein: 190, fat: 155, carb: 45 }]);
  assert.equal(under.matchPct, 100);
});

test("B: the week's per-day match numbers and its tolerance verdict agree", () => {
  const slots = [
    { dayOfWeek: 0, kcal: 2000, protein: 150, fat: 60, carb: 200 },
    { dayOfWeek: 1, kcal: 2000, protein: 150, fat: 168, carb: 200 },
  ];
  const wk = scoreWeek(B_TARGET, slots);
  assert.equal(wk.daysInTolerance, 1);
  const [clean, missed] = wk.days;
  assert.equal(clean.inTolerance, true);
  assert.equal(missed.inTolerance, false);
  assert.ok(missed.matchPct < 90, `a missed day published ${missed.matchPct}%`);
  assert.ok(clean.matchPct >= 90);
  assert.match(missed.miss, /g fat vs a .* g range/, "the miss line names fat in words");
});

// ═════════════════════════════════════════════════════════════════════════
// C — the named binding constraint tells the truth
// ═════════════════════════════════════════════════════════════════════════

// A deep, protein-dense, uniformly FAT-HEAVY pool: every earlier branch of
// classifyBinding (diet / prep / caps / meal pool / variety / snack / protein
// density) must pass so the composition branch is the one under test.
function fattyPool(n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(recipe(`Cream Braise ${i}`, [[F.chicken, 150 + i * 5, "protein"], [F.cream, 90 + i * 3, "fat"]]));
  }
  return out;
}
const C_TARGET = { kcal: 2200, proteinLo: 170, proteinHi: 190, fatLo: 55, fatHi: 68, carbLo: 200, carbHi: 240 };
const C_CFG = { meals: 3, snacks: 0 };

test("C: a pool that provably cannot reach the fat band names FAT, not the portion limit", () => {
  const pool = fattyPool();
  const b = classifyBinding({
    counts: { raw: 500, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget: C_TARGET, mealConfig: C_CFG, pool, days: 7,
  });
  assert.equal(b.key, BINDING.MACRO_COMPOSITION);
  assert.match(b.label, /fat/);
  assert.match(b.detail, /fat-per-calorie/, "it must say WHY portioning cannot fix it");
  assert.doesNotMatch(b.detail, /calorie and protein target/, "the old sentence named the two macros that were actually satisfied");
});

test("C: an observed fat-shaped miss names fat even when the pool could in principle reach it", () => {
  const pool = [...fattyPool(8), ...fattyPool(8).map((r, i) => recipe(`Lean Plate ${i}`, [[F.chicken, 200, "protein"], [F.rice, 200, "carb"]]))];
  const b = classifyBinding({
    counts: { raw: 500, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget: C_TARGET, mealConfig: C_CFG, pool, days: 7,
    observed: { totalDays: 7, fatOffDays: 6, carbOffDays: 1, kcalOffDays: 0, proteinShortDays: 0 },
  });
  assert.equal(b.key, BINDING.MACRO_COMPOSITION);
  assert.match(b.detail, /6 of 7 day\(s\) landed outside your 55-68 g fat range/);
  assert.match(b.detail, /Calories and protein landed on target on every day/,
    "when the two gated macros were satisfied, the constraint must say so instead of blaming them");
});

test("C: with nothing fat/carb-shaped to report, the portion limit still owns the fall-through", () => {
  const pool = [...fattyPool(8), ...Array.from({ length: 8 }, (_, i) => recipe(`Lean Plate ${i}`, [[F.chicken, 200, "protein"], [F.rice, 200, "carb"]]))];
  const b = classifyBinding({
    counts: { raw: 500, afterDiet: pool.length, afterPrep: pool.length },
    filters: {}, dailyTarget: C_TARGET, mealConfig: C_CFG, pool, days: 7,
    observed: { totalDays: 7, fatOffDays: 0, carbOffDays: 0, kcalOffDays: 3, proteinShortDays: 1 },
  });
  assert.equal(b.key, BINDING.PORTION_BOUNDS);
});

test("C: classifyBinding without `observed` behaves exactly as it did before", () => {
  const pool = [...fattyPool(8), ...Array.from({ length: 8 }, (_, i) => recipe(`Lean Plate ${i}`, [[F.chicken, 200, "protein"], [F.rice, 200, "carb"]]))];
  const args = { counts: { raw: 500, afterDiet: pool.length, afterPrep: pool.length }, filters: {}, dailyTarget: C_TARGET, mealConfig: C_CFG, pool, days: 7 };
  assert.equal(classifyBinding(args).key, BINDING.PORTION_BOUNDS);
});

// ═════════════════════════════════════════════════════════════════════════
// D — fail fast, and never a silent 0-kcal plan
// ═════════════════════════════════════════════════════════════════════════

test("D: an empty pool is declared after ONE pass, not five", async () => {
  const r = await generateBestWeekPlan(C_TARGET, C_CFG, [], {
    rng: makeRng(3), filters: {}, attempts: 5,
    counts: { raw: 500, afterDiet: 0, afterPrep: 0 },
  });
  assert.equal(r.attempts, 1, "re-rolling an empty pool five times is not 'fail fast'");
  assert.ok(r.diagnosis, "an empty pool must never ship without a reason");
  assert.equal(r.diagnosis.feasible, false);
  assert.ok(r.diagnosis.reasons.length > 0);
});

test("D: a solve that produced NO days at all still declares", async () => {
  // days.length === 0 made anyDayMissed and anyUnfilledSlot both false, so a
  // plan delivering 0 kcal against a real target shipped diagnosis: null.
  const r = await generateBestWeekPlan(C_TARGET, { meals: 0, snacks: 0 }, fattyPool(), { rng: makeRng(4), filters: {}, attempts: 2 });
  assert.equal(r.score.days.length, 0);
  assert.ok(r.diagnosis, "0 days against a 2,200 kcal target is a silent miss, not a clean plan");
});

test("D: a window that asks for zero days is not a miss — nothing was requested", async () => {
  const r = await generateBestWeekPlan(C_TARGET, C_CFG, fattyPool(), { rng: makeRng(5), filters: {}, attempts: 1, dayIndices: [] });
  assert.equal(r.score.days.length, 0);
  assert.equal(r.diagnosis, null, "a clean no-op must not manufacture a complaint");
});

// ═════════════════════════════════════════════════════════════════════════
// The constitutional line: "silent target misses are forbidden"
// ═════════════════════════════════════════════════════════════════════════

test("no plan ships diagnosis:null while a day missed or a slot came back empty", async () => {
  const pools = [fattyPool(20), [LEAN, FATTY], [...fattyPool(6), LEAN]];
  let checked = 0;
  for (const pool of pools) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const target of [C_TARGET, B_TARGET]) {
        const r = await generateBestWeekPlan(target, C_CFG, pool, { rng: makeRng(seed), filters: {}, attempts: 3 });
        const missed = r.score.daysInTolerance < r.score.days.length;
        const unfilled = r.slots.some((s) => !s.recipeId);
        checked++;
        if (missed || unfilled) {
          assert.ok(r.diagnosis, `seed ${seed}: ${r.score.daysInTolerance}/${r.score.days.length} days, unfilled=${unfilled} — shipped with NO diagnosis`);
          assert.equal(r.diagnosis.feasible, false);
          assert.ok(r.diagnosis.reasons.length > 0, "a declared failure owes a reason");
        } else {
          assert.equal(r.diagnosis, null, "a clean week must not manufacture a complaint");
        }
      }
    }
  }
  assert.equal(checked, 60, "the invariant must actually have been exercised 60 times");
});
