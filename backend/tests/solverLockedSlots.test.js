// solver-core-1 — LOCKED SLOTS ARE PART OF THE SOLVE, AND THE PUBLISHED
// MATCH % DESCRIBES THE WEEK THAT WAS ACTUALLY STORED.
//
// The bug these lock down: the week was solved and SCORED with the solver's
// own picks in every slot, and only afterwards were the user's locked meals
// substituted into the final slot set. So the number the plan screen showed
// described a week that never existed — and the worse the locked meal fitted,
// the bigger the lie. Locked slots are now threaded INTO the solve as fixed
// constraints (the open slots are sized against what the locks left), which
// makes "the score is a rescore of the stored week" true by construction.
//
// Pure fixtures only — no DB, no clock, no network.
process.env.BRAIN = "off";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { generateWeekPlan, solveDay, targetsForSlots, buildSlots, DEFAULT_REPEAT_CAP } = require("../src/lib/weeklyPlanner.js");
const { generateBestWeekPlan, scoreWeek, generateDayCandidates } = require("../src/lib/mealSolver.js");
const { makeRng } = require("./helpers/seededRng.js");

// ── fixtures ──────────────────────────────────────────────────────────────

const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  rice: { name: "White Rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  oil: { name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 },
  cream: { name: "Heavy Cream", kcal: 340, protein: 2, fat: 36, carb: 3 },
  lettuce: { name: "Lettuce", kcal: 15, protein: 1.4, fat: 0.2, carb: 2.9 },
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

// A pool with real headroom, so nothing below is an artifact of a thin library.
function mealPool() {
  const pool = [];
  for (let i = 0; i < 12; i++) {
    pool.push(recipe(`main-${i}`, [[F.chicken, 150 + i * 8, "protein"], [F.rice, 150 + i * 6, "carb"], [F.oil, 8 + i, "fat"]]));
  }
  return pool;
}

// A dish nobody's day can absorb: 2,570 kcal and 276 g fat in ONE slot of a
// 2,400 kcal day. Locking this has to move the reported number.
const CREAM_BOMB = recipe("Cream Bomb", [[F.cream, 600, "other"], [F.oil, 60, "fat"]]);
// The opposite failure: a slot that contributes almost nothing.
const SAD_SALAD = recipe("Sad Salad", [[F.lettuce, 120, "veg"], [F.lettuce, 60, "other"]]);

const TARGET = { kcal: 2400, proteinLo: 170, proteinHi: 190, fatLo: 60, fatHi: 90, carbLo: 200, carbHi: 300 };
const CFG = { meals: 3, snacks: 0 };

// A PlanSlot-shaped locked row, exactly what the route reads off the DB.
function lockRow(r, dayOfWeek, slotIndex = 0) {
  return {
    dayOfWeek, slotType: "meal", slotIndex, recipeId: r.id, proteinScale: 1, sidesScale: 1,
    ingredients: r.ingredients.map((i) => ({ foodId: i.foodId, name: i.food.name, role: i.role, grams: i.baseGrams })),
    kcal: r.kcal, protein: r.protein, fat: r.fat, carb: r.carb, warning: null, locked: true,
  };
}

// ── 1. the headline property ──────────────────────────────────────────────

test("locking a badly-fitting meal DROPS the reported match % (the number describes the stored week)", async () => {
  const pool = [...mealPool(), CREAM_BOMB];
  const free = await generateBestWeekPlan(TARGET, CFG, pool, { rng: makeRng(3), attempts: 3 });
  const locked = await generateBestWeekPlan(TARGET, CFG, pool, {
    rng: makeRng(3), attempts: 3, lockedSlots: [lockRow(CREAM_BOMB, 2)],
  });

  assert.ok(locked.score.avgMatch < free.score.avgMatch,
    `locking a 2,570 kcal / 276 g fat meal into a 2,400 kcal day did not move the reported match ` +
    `(${free.score.avgMatch}% unlocked vs ${locked.score.avgMatch}% locked)`);
  assert.ok(locked.score.daysInTolerance < free.score.daysInTolerance,
    "and the day it was locked into must stop counting as in tolerance");

  const day = locked.score.days[2];
  assert.equal(day.inTolerance, false, "the day carrying the locked meal cannot report as in tolerance");
  assert.ok(day.miss, "and it must state what it missed by");
  assert.match(day.miss, /over/, `the miss line must name the overshoot: ${day.miss}`);
});

test("the published week score is a RESCORE of the exact slot set returned (no pre-swap number)", async () => {
  const pool = [...mealPool(), CREAM_BOMB, SAD_SALAD];
  for (const [seed, locks] of [
    [3, [lockRow(CREAM_BOMB, 2)]],
    [11, [lockRow(SAD_SALAD, 0), lockRow(CREAM_BOMB, 4, 1)]],
    [21, [lockRow(SAD_SALAD, 5, 2)]],
  ]) {
    const week = await generateBestWeekPlan(TARGET, CFG, pool, { rng: makeRng(seed), attempts: 3, lockedSlots: locks });
    const rescored = scoreWeek(TARGET, week.slots);
    assert.equal(rescored.avgMatch, week.score.avgMatch, `seed ${seed}: published avgMatch is not a rescore of the returned slots`);
    assert.equal(rescored.daysInTolerance, week.score.daysInTolerance, `seed ${seed}: published daysInTolerance is not a rescore of the returned slots`);
    assert.deepEqual(rescored.days.map((d) => d.matchPct), week.score.days.map((d) => d.matchPct), `seed ${seed}: per-day match % drifted from the stored week`);
  }
});

test("REGRESSION: scoring the week WITHOUT the locks and swapping them in afterwards publishes a number for a week that never existed", async () => {
  // This is the old behaviour, reproduced deliberately. Its whole point is to
  // fail loudly if anyone re-introduces the post-hoc substitution: the number
  // the user would have seen and the truth of what was stored differ.
  const pool = [...mealPool(), CREAM_BOMB];
  const lock = lockRow(CREAM_BOMB, 2);
  const free = await generateBestWeekPlan(TARGET, CFG, pool, { rng: makeRng(3), attempts: 3 });
  const swappedIn = free.slots.map((s) =>
    (s.dayOfWeek === lock.dayOfWeek && s.slotType === lock.slotType && s.slotIndex === lock.slotIndex) ? { ...s, ...lock } : s);
  const truth = scoreWeek(TARGET, swappedIn);
  assert.notEqual(free.score.avgMatch, truth.avgMatch,
    "the fixture no longer demonstrates the bug — pick a locked meal the solver's week cannot absorb");

  // …and the current code path publishes the truth instead.
  const honest = await generateBestWeekPlan(TARGET, CFG, pool, { rng: makeRng(3), attempts: 3, lockedSlots: [lock] });
  assert.equal(honest.score.avgMatch, scoreWeek(TARGET, honest.slots).avgMatch);
});

// ── 2. locks are CONSTRAINTS, not decoration ──────────────────────────────

test("the locked meal survives verbatim and the open slots are sized against what it left", async () => {
  const pool = mealPool();
  const dayTargets = targetsForSlots(TARGET, buildSlots(CFG)).filter((s) => s.dayOfWeek === 0);
  const lock = lockRow(CREAM_BOMB, 0, 1);
  const lockedByKey = new Map([[`0:meal:1`, lock]]);

  const { slots } = await solveDay(dayTargets, TARGET, pool, new Map(), new Set(), makeRng(9), null, null, DEFAULT_REPEAT_CAP, null, lockedByKey);
  assert.equal(slots.length, 3);
  const kept = slots[1];
  assert.equal(kept.recipeId, CREAM_BOMB.id, "the locked slot must keep its own meal");
  assert.equal(kept.locked, true);
  assert.equal(kept.kcal, CREAM_BOMB.kcal, "and its stored macros verbatim — never re-solved");

  // The open slots must have shrunk: the lock already spent the whole day.
  const open = slots.filter((_, i) => i !== 1);
  const openKcal = open.reduce((s, x) => s + x.kcal, 0);
  const unlocked = await solveDay(dayTargets, TARGET, pool, new Map(), new Set(), makeRng(9), null, null, DEFAULT_REPEAT_CAP);
  const unlockedOpenKcal = unlocked.slots.filter((_, i) => i !== 1).reduce((s, x) => s + x.kcal, 0);
  assert.ok(openKcal < unlockedOpenKcal,
    `the open slots did not shrink around the lock (${Math.round(openKcal)} kcal locked vs ${Math.round(unlockedOpenKcal)} unlocked) — ` +
    "the solver is still sizing them against a budget the lock already spent");
});

test("a locked recipe counts against the weekly variety cap from day 0", async () => {
  const pool = mealPool();
  const chosen = pool[0];
  const locks = [lockRow(chosen, 6, 0), lockRow(chosen, 6, 1)]; // already at the default cap
  const slots = await generateWeekPlan(TARGET, CFG, pool, { rng: makeRng(4), lockedSlots: locks });
  const served = slots.filter((s) => s.recipeId === chosen.id).length;
  assert.equal(served, DEFAULT_REPEAT_CAP,
    `the locked dish was served ${served}× against a cap of ${DEFAULT_REPEAT_CAP} — locks must be counted before the open slots are picked`);
});

test("day candidates respect a lock on that day too (and score it, not a day without it)", async () => {
  const pool = [...mealPool(), CREAM_BOMB];
  const lock = lockRow(CREAM_BOMB, 0, 1);
  const res = await generateDayCandidates({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: pool, dayOfWeek: 0,
    lockedSlots: [lock], rng: makeRng(6), attempts: 6,
  });
  assert.ok(res.candidates.length > 0);
  for (const c of res.candidates) {
    const held = c.slots.find((s) => s.slotType === "meal" && s.slotIndex === 1);
    assert.equal(held.recipeId, CREAM_BOMB.id, "every candidate must carry the locked meal");
    assert.equal(c.inTolerance, false, "a day built around a 2,570 kcal lock cannot claim to be in tolerance");
    assert.ok(c.miss, "and it must publish what it missed by");
  }
  assert.ok(res.diagnosis, "a day whose best option misses target owes a reason");
});

// ── 3. the unlocked path is untouched ─────────────────────────────────────

test("with no locks the solve is byte-identical to before the lock plumbing", async () => {
  const pool = mealPool();
  for (const seed of [1, 5, 17]) {
    const a = await generateWeekPlan(TARGET, CFG, pool, { rng: makeRng(seed) });
    const b = await generateWeekPlan(TARGET, CFG, pool, { rng: makeRng(seed), lockedSlots: [] });
    const c = await generateWeekPlan(TARGET, CFG, pool, { rng: makeRng(seed), lockedSlots: null });
    assert.deepEqual(b, a, `seed ${seed}: an EMPTY lock list changed the solve`);
    assert.deepEqual(c, a, `seed ${seed}: a NULL lock list changed the solve`);
  }
});
