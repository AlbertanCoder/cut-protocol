// STAGE 2 — any-horizon generation (1 meal → 1 month).
//
// Verified against a scratch COPY of the REAL shipped recipe library (889
// recipes at the time of writing), never a hand-built fixture pool: the claims
// this file makes — "a month is not the same three meals on repeat", "a month
// is well under a second", "an over-constrained request names what is binding"
// — are claims about the library the user actually has. A fixture pool can be
// built to make any of them true.
//
// DB SAFETY: the real dev.db is copied to a temp directory and a PrismaClient
// is pointed at the COPY by absolute URL. Nothing here ever opens a handle on
// the real database, and nothing here writes at all. On CI (no dev.db, a seeded
// ci.db instead) it falls back to the app's own client, still read-only.
require("dotenv/config");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveHorizon, horizonWindows, varietyPlanFor, classifyBinding,
  generateHorizonPlan, solveOneMeal, applyPrepFilter,
  HORIZON_PRESETS, MAX_HORIZON_DAYS, BINDING,
} = require("../src/lib/mealSolver.js");
const { DEFAULT_REPEAT_CAP, BATCH_REPEAT_CAP, eligibleRecipes } = require("../src/lib/weeklyPlanner.js");
const { filterRecipePool } = require("../src/lib/planContext.js");
const { computeMacros } = require("../src/lib/bmrEngine.js");

// ── the real library, on a scratch copy ──────────────────────────────────

const REAL_DB = path.join(__dirname, "..", "prisma", "dev.db");
let prisma = null;
let ownsClient = false;
let scratchDir = null;
let RAW = [];
let POOL = [];
let VEGAN_POOL = [];

const PROFILE = {
  sex: "M", age: 33, heightCm: 185, bodyFatPct: 20, dietaryStyle: null,
  excludedFoods: [], mealsPerDay: 3, snacksPerDay: 0, excludedFormulas: [], unitPref: "metric",
};
const CFG = { meals: 3, snacks: 0 };
let TARGET = null;

// Seeded LCG so a re-run reproduces the same plans — a flaky variety assertion
// would be worse than no assertion.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test.before(async () => {
  if (fs.existsSync(REAL_DB)) {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-horizon-"));
    const copy = path.join(scratchDir, "library.db");
    fs.copyFileSync(REAL_DB, copy);
    // A live WAL would otherwise leave the copy missing the newest rows.
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(REAL_DB + suffix)) fs.copyFileSync(REAL_DB + suffix, copy + suffix);
    }
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient({ datasources: { db: { url: `file:${copy.replace(/\\/g, "/")}` } } });
    ownsClient = true;
  } else {
    ({ prisma } = require("../src/lib/prisma.js")); // CI: the seeded database
  }
  RAW = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  POOL = filterRecipePool(RAW, PROFILE);
  VEGAN_POOL = filterRecipePool(RAW, { ...PROFILE, dietaryStyle: "vegan" });
  TARGET = computeMacros(PROFILE, 95, 2400);
  assert.ok(RAW.length >= 100, `expected the real recipe library, got ${RAW.length} recipes — this suite must not run against a stub`);
});

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  if (ownsClient && scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
});

const solve = (horizonKey, over = {}) => generateHorizonPlan({
  dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
  horizon: resolveHorizon(horizonKey), filters: {}, rng: rng(20260724), ...over,
});

const countBy = (slots) => {
  const c = new Map();
  for (const s of slots) if (s.recipeId) c.set(s.recipeId, (c.get(s.recipeId) || 0) + 1);
  return c;
};

// ── horizon parsing: the control's menu and its refusals ─────────────────

test("horizon: the six presets resolve to the day counts they are labelled with", () => {
  const byKey = Object.fromEntries(HORIZON_PRESETS.map((p) => [p.key, p]));
  assert.deepEqual(
    { meal: byKey.meal.days, day: byKey.day.days, "3days": byKey["3days"].days, week: byKey.week.days, "2weeks": byKey["2weeks"].days, month: byKey.month.days },
    { meal: 0, day: 1, "3days": 3, week: 7, "2weeks": 14, month: 28 }
  );
  assert.equal(resolveHorizon("meal").kind, "meal");
  assert.equal(resolveHorizon("month").weeks, 4);
  assert.equal(resolveHorizon("2weeks").weeks, 2);
});

test("horizon: an absent horizon is exactly '1 week' — the pre-Stage-2 default", () => {
  for (const absent of [undefined, null, ""]) {
    assert.deepEqual(resolveHorizon(absent), { key: "week", label: "1 week", days: 7, kind: "days", weeks: 1, custom: false });
  }
});

test("horizon: an arbitrary N-days request is accepted and reported as custom", () => {
  const h = resolveHorizon(21);
  assert.equal(h.days, 21);
  assert.equal(h.weeks, 3);
  assert.equal(h.custom, true);
  assert.equal(resolveHorizon("21").days, 21, "a numeric string from a form input is the same request");
  // A count that coincides with a preset resolves to the PRESET, so the UI and
  // the server never disagree about what "7" is called.
  assert.equal(resolveHorizon(7).key, "week");
  assert.equal(resolveHorizon(1).key, "day");
});

test("horizon: an out-of-range or unknown horizon is REFUSED with a reason, never clamped", () => {
  for (const bad of [0, -3, MAX_HORIZON_DAYS + 1, 5000]) {
    assert.throws(() => resolveHorizon(bad), (e) => e.status === 400 && /1-90 days/.test(e.message), `expected a 400 for ${bad}`);
  }
  assert.throws(() => resolveHorizon("fortnight"), (e) => e.status === 400 && /unknown horizon/.test(e.message));
  // Silently truncating a 200-day request to 90 would be a silent target miss
  // wearing a different hat, so the refusal names the real limit.
  assert.throws(() => resolveHorizon(200), (e) => /calorie target has been re-derived/.test(e.message));
});

test("horizonWindows: a horizon is split into per-week day windows, starting where it starts", () => {
  assert.deepEqual(horizonWindows(7, 0), [[0, 1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(horizonWindows(28, 0), [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(horizonWindows(1, 2), [[2]], "one day, on a Wednesday");
  assert.deepEqual(horizonWindows(3, 5), [[5, 6], [0]], "three days from Saturday spill into next week's plan row");
  assert.deepEqual(horizonWindows(10, 4), [[4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]);
  assert.equal(horizonWindows(28, 0).flat().length, 28, "every requested day is placed exactly once");
});

// ── each horizon returns the right number of days ────────────────────────

test("every horizon returns exactly the days it promised, each with its own published match", async () => {
  const expected = { day: 1, "3days": 3, week: 7, "2weeks": 14, month: 28 };
  for (const [key, days] of Object.entries(expected)) {
    const r = await solve(key);
    assert.equal(r.score.totalDays, days, `${key}: expected ${days} days, got ${r.score.totalDays}`);
    assert.equal(r.score.days.length, days);
    const slots = r.windows.flatMap((w) => w.slots);
    assert.equal(slots.length, days * (CFG.meals + CFG.snacks), `${key}: slot count must be days x slots-per-day`);
    assert.equal(r.windows.reduce((s, w) => s + w.dayIndices.length, 0), days);
    // No silent day: every day states a match %, a verdict, and — when it
    // misses — what it missed by.
    for (const d of r.score.days) {
      assert.equal(typeof d.matchPct, "number", `${key}: a day with no published match is a silent miss`);
      assert.equal(typeof d.inTolerance, "boolean");
      if (!d.inTolerance) assert.ok(d.miss && d.miss.length > 0, `${key}: ${d.dayName} missed with nothing said about it`);
    }
  }
});

test("a sub-week horizon touches ONLY its own days — the rest of the week is not its business", async () => {
  // "3 days starting Saturday" is Sat+Sun of this plan row and Monday of the next.
  const r = await solve("3days", { startDayOfWeek: 5 });
  assert.deepEqual(r.windows.map((w) => w.dayIndices), [[5, 6], [0]]);
  assert.deepEqual(r.windows[0].slots.map((s) => s.dayOfWeek).sort(), [5, 5, 5, 6, 6, 6]);
  assert.deepEqual(r.windows[1].slots.map((s) => s.dayOfWeek), [0, 0, 0]);
  // Mid-week starts must not produce NaN targets — targetsForSlots used to read
  // its per-day weight off dayOfWeek 0 unconditionally, which is a zero divisor
  // for a window that does not contain Monday.
  for (const s of r.windows.flatMap((w) => w.slots)) {
    assert.ok(Number.isFinite(s.kcal) && s.kcal >= 0, `slot kcal must be a real number, got ${s.kcal}`);
  }
  assert.ok(r.score.days.every((d) => Number.isFinite(d.matchPct)));
});

// ── variety, scaled to the horizon ───────────────────────────────────────

test("variety contract scales with the horizon instead of multiplying with it", () => {
  const w = varietyPlanFor({ weeks: 1, days: 7, mealConfig: CFG, filters: {} });
  const m = varietyPlanFor({ weeks: 4, days: 28, mealConfig: CFG, filters: {} });
  const mb = varietyPlanFor({ weeks: 4, days: 28, mealConfig: CFG, filters: { allowBatchRepeats: true } });
  assert.equal(w.perWeekCap, DEFAULT_REPEAT_CAP);
  assert.equal(w.horizonRepeatCap, DEFAULT_REPEAT_CAP, "over one week the horizon cap IS the existing weekly cap");
  assert.equal(m.perWeekCap, DEFAULT_REPEAT_CAP, "the per-week rule is extended, not replaced");
  assert.equal(m.horizonRepeatCap, 5, "4 weeks allows 5 servings of a dish, not 2x4=8");
  assert.ok(m.horizonRepeatCap < DEFAULT_REPEAT_CAP * 4, "a month must not simply inherit four weeks' worth of repeats");
  assert.equal(mb.perWeekCap, BATCH_REPEAT_CAP);
  assert.equal(mb.horizonRepeatCap, 7, "batch-cooking raises the cap; it does not remove it");
  assert.equal(m.distinctFloor, Math.ceil(84 / 5));
});

test("28-day plan: the repeat caps HOLD — per week and across the whole month", async () => {
  const r = await solve("month");
  const v = r.variety;
  assert.equal(v.weeks, 4);
  assert.equal(v.horizonRepeatCap, 5);

  // (a) horizon cap
  assert.ok(v.capHeld, `a dish appeared ${v.maxRepeat} times against a ${v.horizonRepeatCap} cap`);
  const all = countBy(r.windows.flatMap((w) => w.slots));
  assert.ok(Math.max(...all.values()) <= v.horizonRepeatCap, "horizon repeat cap breached in the raw slot set");

  // (b) the existing per-WEEK cap still binds inside the month
  for (const w of r.windows) {
    const perWeek = countBy(w.slots);
    assert.ok(Math.max(...perWeek.values()) <= v.perWeekCap,
      `week ${w.windowIndex} served a dish ${Math.max(...perWeek.values())} times against the ${v.perWeekCap}/week cap`);
  }

  // (c) distinct-recipe floor — the arithmetic consequence of the cap, checked
  // rather than assumed, so a cap that silently stopped being enforced fails here.
  assert.ok(v.floorHeld, `${v.distinctRecipes} distinct dishes for ${v.filledSlots} filled slots — floor is ${v.requiredDistinct}`);
  assert.equal(v.requiredDistinct, Math.ceil(v.filledSlots / v.horizonRepeatCap));
  assert.equal(v.distinctRecipes, all.size);

  // (d) and the point of all of it: a month is NOT the same few meals on repeat.
  // Measured against the real 889-recipe library: 71-79 distinct dishes over
  // 28 days across 15 seeds. 40 is a floor with room, not the observed number.
  assert.ok(v.distinctRecipes >= 40,
    `a 28-day plan drew only ${v.distinctRecipes} distinct dishes from a pool of ${POOL.length}`);
});

test("a month is more varied than a week, and batch-cooking is the only thing that loosens it", async () => {
  const week = await solve("week");
  const month = await solve("month");
  assert.ok(month.variety.distinctRecipes > week.variety.distinctRecipes * 2,
    `month ${month.variety.distinctRecipes} vs week ${week.variety.distinctRecipes} distinct — a month must not recycle a week`);
  const batched = await solve("month", { filters: { allowBatchRepeats: true } });
  assert.equal(batched.variety.horizonRepeatCap, 7);
  assert.ok(batched.variety.capHeld);
});

test("a long horizon never drops the diet/allergy filter to succeed", async () => {
  const allowed = new Set(VEGAN_POOL.map((r) => r.id));
  const r = await generateHorizonPlan({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: VEGAN_POOL,
    horizon: resolveHorizon("month"), filters: {}, rng: rng(4242),
  });
  const leaks = r.windows.flatMap((w) => w.slots).filter((s) => s.recipeId && !allowed.has(s.recipeId));
  assert.deepEqual(leaks.map((s) => s.recipeId), [], "a slot escaped the compliant pool over a 28-day horizon");
  assert.ok(r.variety.capHeld, "the variety cap must hold on a thin pool too — or the plan must say it did not");
});

// ── accuracy does not decay over the horizon ─────────────────────────────

test("a 28-day plan is no less on-target than a 7-day one, and never fake-green", async () => {
  const weekRates = [];
  const monthRates = [];
  for (let i = 0; i < 5; i++) {
    const w = await solve("week", { rng: rng(500 + i) });
    const m = await solve("month", { rng: rng(500 + i) });
    weekRates.push(w.score.daysInTolerance / w.score.totalDays);
    monthRates.push(m.score.daysInTolerance / m.score.totalDays);

    // THE honesty invariant, at every horizon: a day out of tolerance, or a
    // slot left empty, obliges a diagnosis. Green means on-target only.
    for (const r of [w, m]) {
      const missed = r.score.days.filter((d) => !d.inTolerance);
      const unfilled = r.windows.flatMap((x) => x.slots).filter((s) => !s.recipeId);
      if (missed.length || unfilled.length || !r.variety.capHeld) {
        assert.ok(r.diagnosis, "a plan that missed shipped with no diagnosis at all");
        assert.equal(r.diagnosis.feasible, false);
        assert.ok(r.diagnosis.reasons.length > 0);
        assert.ok(r.diagnosis.binding && r.diagnosis.binding.key, "a declared failure must NAME the binding constraint");
      } else {
        assert.equal(r.diagnosis, null, "a clean plan must not manufacture a complaint");
      }
    }
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  // Measured on the real library with a real computeMacros target: week 0.375,
  // month 0.415 — the month is slightly BETTER, because more days means more
  // pool to draw from. The 0.8 factor is headroom against solver noise; a real
  // decay (a month quietly degrading to fill itself) blows straight through it.
  assert.ok(mean(monthRates) >= mean(weekRates) * 0.8,
    `month on-target rate ${mean(monthRates).toFixed(3)} decayed against week ${mean(weekRates).toFixed(3)}`);
  const m = await solve("month");
  assert.ok(m.score.avgMatch >= 85, `28-day average match ${m.score.avgMatch}% — measured 96-98% on this library`);
});

// ── 1 meal ───────────────────────────────────────────────────────────────

test("1 meal: the solve targets the REMAINING macros, and says which basis it used", async () => {
  const remaining = { kcal: 640, protein: 48 };
  const r = await solveOneMeal({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
    remaining, basis: "diary", consumedKcal: TARGET.kcal - remaining.kcal, rng: rng(9),
  });
  assert.equal(r.basis, "diary");
  assert.equal(r.target.kcal, 640, "the target must be the remainder, not the whole day");
  assert.equal(r.target.protein, 48);
  assert.match(r.note, /LEFT of today/, "the basis has to be stated in words, not just a key");
  assert.match(r.note, /1,?760|1760/, "the note states how much is already logged");
  assert.ok(r.best, "a 640 kcal remainder is well inside what one dish can carry");
  assert.ok(r.options.length >= 1 && r.options.length <= 3);
  assert.ok(r.fits, `best option missed: ${r.miss}`);
  assert.equal(r.miss, null);
  assert.equal(r.binding, null);
});

test("1 meal: with nothing logged and nothing planned it uses the FULL day target and says so", async () => {
  const pMid = (TARGET.proteinLo + TARGET.proteinHi) / 2;
  const r = await solveOneMeal({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
    remaining: { kcal: TARGET.kcal, protein: pMid }, basis: "full-day", consumedKcal: 0, rng: rng(9),
  });
  assert.equal(r.basis, "full-day");
  assert.equal(r.target.kcal, TARGET.kcal);
  assert.match(r.note, /FULL day target/);
  assert.match(r.note, /0\.5x-2x portion limit/, "it must warn that one dish rarely carries a whole day");
  // Whatever it returns, it is judged against the target it was given — no
  // quiet substitution of an easier one.
  if (!r.fits) {
    assert.ok(r.miss && r.miss.length > 0);
    assert.ok(r.binding && r.binding.key);
  }
});

test("1 meal: a spent budget is declared, not solved around", async () => {
  const r = await solveOneMeal({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
    remaining: { kcal: -30, protein: 0 }, basis: "diary", consumedKcal: TARGET.kcal + 30, rng: rng(1),
  });
  assert.equal(r.fits, false);
  assert.deepEqual(r.options, [], "there is no honest dish to offer against a spent budget");
  assert.equal(r.best, null);
  assert.equal(r.binding.key, BINDING.NO_BUDGET);
  assert.match(r.miss, /no room left/);
});

test("1 meal: an out-of-reach remainder names the portion limit and what one dish can actually carry", async () => {
  // A pool of small dishes cannot cover a whole day in one plate, and the app
  // has to say that rather than ship a 40%-match dish as an answer.
  const small = POOL.filter((r) => r.kcal > 0 && r.kcal < 260);
  assert.ok(small.length > 5, `expected some small dishes in the real library, found ${small.length}`);
  const r = await solveOneMeal({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: small,
    remaining: { kcal: 2400, protein: 200 }, basis: "full-day", consumedKcal: 0, rng: rng(2),
  });
  assert.equal(r.fits, false);
  assert.ok(r.miss && /kcal against 2400/.test(r.miss), `miss line should state both numbers, got: ${r.miss}`);
  assert.equal(r.binding.key, BINDING.PORTION_BOUNDS);
  assert.match(r.binding.detail, /double portion/);
});

test("1 meal: a remainder too SMALL for any dish is named as such, not filled with a near-miss", async () => {
  // 3 kcal left after a fully-planned day is a real state (the route hits it),
  // and "here is a 116 kcal dish" is not an answer to it.
  const r = await solveOneMeal({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
    remaining: { kcal: 3, protein: 1 }, basis: "plan", consumedKcal: TARGET.kcal - 3, rng: rng(8),
  });
  assert.equal(r.fits, false);
  assert.equal(r.binding.key, BINDING.PORTION_BOUNDS);
  assert.match(r.binding.detail, /half portion/, `expected the small-remainder wall, got: ${r.binding.detail}`);
  assert.match(r.note, /PLANNED meals/);
});

// ── honest failure, with the binding constraint NAMED ────────────────────

test("an over-constrained month honest-fails and names the binding constraint", async () => {
  // Five real recipes from the real library — a genuinely impossible ask for
  // 84 meal slots under any variety rule worth having.
  const slice = POOL.slice(0, 5);
  const r = await generateHorizonPlan({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: slice,
    horizon: resolveHorizon("month"), filters: {},
    counts: { raw: RAW.length, afterDiet: slice.length, afterPrep: slice.length },
    rng: rng(11),
  });
  assert.ok(r.diagnosis, "an unfillable month must not come back clean");
  assert.equal(r.diagnosis.feasible, false);
  assert.equal(r.diagnosis.binding.key, BINDING.POOL_DEPTH);
  assert.match(r.diagnosis.binding.detail, /5 meal-eligible recipe/);
  assert.ok(r.diagnosis.reasons.some((x) => /came back empty/.test(x)), "empty slots must be counted out loud");
  assert.ok(r.diagnosis.suggestions.length > 0, "a declared failure owes an action");
  // It fails HONESTLY: it does not quietly break the cap to fill the month.
  assert.ok(r.variety.capHeld, "the solver must leave slots empty rather than exceed the variety cap silently");
  assert.ok(r.variety.unfilledSlots > 0);
});

test("classifyBinding names the ONE thing that is binding, per stack", () => {
  const base = { dailyTarget: TARGET, mealConfig: CFG, days: 28, variety: varietyPlanFor({ weeks: 4, days: 28, mealConfig: CFG, filters: {} }) };
  assert.equal(
    classifyBinding({ ...base, pool: [], counts: { raw: RAW.length, afterDiet: 0, afterPrep: 0 }, filters: {} }).key,
    BINDING.DIET);
  assert.equal(
    classifyBinding({ ...base, pool: [], counts: { raw: RAW.length, afterDiet: 400, afterPrep: 0 }, filters: { maxPrepMin: 5 } }).key,
    BINDING.PREP);
  // A pool that ONLY the repeat cap keeps out of reach names the CAP — and says
  // batch-cooking would close it, because here that is arithmetically true:
  // 84 meal slots, 14 dishes x 5 servings = 70 (short), x 7 with batch = 98 (enough).
  const mealOnly = eligibleRecipes(POOL, "meal", new Map(), 99);
  const fourteen = mealOnly.slice(0, 14);
  const capBound = classifyBinding({ ...base, pool: fourteen, counts: { raw: RAW.length, afterDiet: 14, afterPrep: 14 }, filters: {} });
  assert.equal(capBound.key, BINDING.VARIETY_CAP);
  assert.match(capBound.detail, /batch-cooking repeats raises the cap/);
  // …and where batch-cooking could NOT close it (8 x 7 = 56 for 84 slots), the
  // pool is simply too shallow. Suggesting an option that would not work is the
  // failure mode this branch exists to avoid.
  const batchVariety = varietyPlanFor({ weeks: 4, days: 28, mealConfig: CFG, filters: { allowBatchRepeats: true } });
  assert.equal(
    classifyBinding({ ...base, pool: mealOnly.slice(0, 8), counts: { raw: RAW.length, afterDiet: 8, afterPrep: 8 }, filters: { allowBatchRepeats: true }, variety: batchVariety }).key,
    BINDING.POOL_DEPTH);
  // Snacks: the real library carries a handful of snack recipes, so asking for
  // two a day for a month is bound by the snack pool, not by anything else.
  const snacky = { ...base, mealConfig: { meals: 3, snacks: 2 }, pool: POOL, counts: { raw: RAW.length, afterDiet: POOL.length, afterPrep: POOL.length }, filters: {} };
  assert.equal(classifyBinding(snacky).key, BINDING.SNACK_POOL);
});

test("an impossible prep cap over a month is named as the prep cap, not blamed on the diet", async () => {
  const strict = applyPrepFilter(POOL, 5);
  const r = await generateHorizonPlan({
    dailyTarget: TARGET, mealConfig: CFG, recipePool: strict.slice(0, 8),
    horizon: resolveHorizon("month"), filters: { maxPrepMin: 5 },
    counts: { raw: RAW.length, afterDiet: POOL.length, afterPrep: 8 },
    rng: rng(3),
  });
  assert.ok(r.diagnosis);
  assert.equal(r.diagnosis.binding.key, BINDING.PREP);
  assert.match(r.diagnosis.binding.detail, /5-minute|max-prep|cuts the compliant pool/i);
  assert.ok(!/dietary style/i.test(r.diagnosis.binding.label), "the diet is not what is binding here");
});

// ── performance, measured ────────────────────────────────────────────────

test("performance: a 28-day solve stays well under a second, and 1 meal is instant", async () => {
  const monthMs = [];
  for (let i = 0; i < 10; i++) {
    const t = process.hrtime.bigint();
    await solve("month", { rng: rng(6000 + i) });
    monthMs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  monthMs.sort((a, b) => a - b);
  const p95 = monthMs[Math.min(monthMs.length - 1, Math.ceil(0.95 * monthMs.length) - 1)];

  const mealMs = [];
  for (let i = 0; i < 20; i++) {
    const t = process.hrtime.bigint();
    await solveOneMeal({
      dailyTarget: TARGET, mealConfig: CFG, recipePool: POOL,
      remaining: { kcal: 700, protein: 50 }, basis: "diary", consumedKcal: 1700, rng: rng(i),
    });
    mealMs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  mealMs.sort((a, b) => a - b);
  const mealP95 = mealMs[Math.ceil(0.95 * mealMs.length) - 1];

  console.log(`      [perf] 28-day solve over ${POOL.length} recipes: p50 ${monthMs[4].toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · max ${monthMs.at(-1).toFixed(1)} ms`);
  console.log(`      [perf] 1-meal solve: p50 ${mealMs[9].toFixed(2)} ms · p95 ${mealP95.toFixed(2)} ms`);

  // Budgets set from MEASURED numbers with ~4x headroom, not from a wish:
  // a 28-day solve measured p95 ~0.55-0.60 s on this machine (20 week-solves,
  // best-of-5 each). Anything past 2.5 s is a real regression, not noise on a
  // busy box. A month is 4 weeks of a 1-15 ms week solve — if this ever fails,
  // the composition, not the budget, is what changed.
  assert.ok(p95 < 2500, `28-day p95 was ${p95.toFixed(1)} ms`);
  assert.ok(mealP95 < 100, `1-meal p95 was ${mealP95.toFixed(2)} ms — this path must feel instant`);
});
