// ── macroCloser · the "no worse" guard (G4) ──────────────────────────────
//
// `macroCloser.js` shipped untracked and with zero tests. Its own docstring says
// "'No worse' is the whole rule" — but `wouldHarm` tested band MEMBERSHIP:
//
//     const wasOver = bandMiss(before, lo, hi).over > 0;
//     const isOver  = bandMiss(now,    lo, hi).over > 0;
//     return isOver && !wasOver;          // wasOver === true ⇒ "no harm", always
//
// Read as "harm means crossing the line", that silently exempted every macro
// that had ALREADY crossed it. The one day that most needs the guard — the day
// already failing — was the one day without it. Measured over 639 real days: the
// closer acted on 106 days whose fat was already above its ceiling and pushed fat
// further out on 106 of 106, by as much as +16.1 g.
//
// The fix compares the SIZE of the overage instead of membership. What each test
// below would catch if that regressed:
//
//   1. reverting to the membership test — an already-over macro is pushed further
//      out and the closer calls it harmless (this is G4 itself, reproduced with
//      the real Chicken breast row and the 180 g the algorithm actually chooses);
//   2. over-correcting into a blanket ban — the guard refusing a move that keeps
//      the macro comfortably inside its band, which would quietly disable the
//      closer everywhere;
//   3. over-correcting into a ban on NEUTRAL moves — refusing an adjuster that
//      does not touch the offending macro at all, which is the cheap way to make
//      test 1 pass while breaking the closer's whole purpose.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { closeDayMacros } = require("../src/lib/macroCloser.js");

// A day graded on these bands. Fat 55–70 g is the band under test throughout.
const TARGET = {
  kcal: 2200,
  proteinLo: 150, proteinHi: 190,
  fatLo: 55, fatHi: 70,
  carbLo: 180, carbHi: 260,
};

// One real, unlocked, filled slot — the only shape the closer will attach to.
// Macros are carried on the slot; `totalsOf` sums them across the day.
const dayWith = ({ fat }) => [{
  recipeId: "r1",
  locked: false,
  ingredients: [{ foodId: "f0", name: "Base dish", grams: 300 }],
  kcal: 1800, protein: 100, fat, carb: 200,
}];

// The real ADJUSTER_CANDIDATES row from the campaign reproduction.
const CHICKEN = {
  food: { id: "chicken", name: "Chicken breast, cooked, skinless", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  role: "protein",
};

// Same protein pull, but carrying no fat at all — a move that is neutral on the
// macro that is already out of band.
const FAT_FREE_PROTEIN = {
  food: { id: "isolate", name: "Egg white, cooked", kcal: 100, protein: 24, fat: 0, carb: 0 },
  role: "protein",
};

test("G4: an already-over macro is protected — the closer will not push fat further past its ceiling", () => {
  // Fat starts at 95 g against a 55–70 band: over by 25 g before anything is added.
  const slots = dayWith({ fat: 95 });
  const { added } = closeDayMacros({ slots, dailyTarget: TARGET, adjusters: [CHICKEN] });

  // Protein is 100 vs a midpoint of 170, so the closer WANTS to add 180 g of
  // chicken. That carries 6.48 g of fat and takes the overage 25 → 31.48 g.
  // Under the membership test this was permitted, because fat was "already over".
  assert.equal(added.length, 0, "closer must refuse an add that increases an existing fat overage");
});

test("G4 control: the guard still permits a move that keeps fat inside its band", () => {
  // Identical day, except fat starts at 60 g — inside 55–70. The same 180 g add
  // lands fat at 66.48 g, still inside. A guard that refuses this one is not
  // protecting anything, it is just switched off.
  const slots = dayWith({ fat: 60 });
  const { added } = closeDayMacros({ slots, dailyTarget: TARGET, adjusters: [CHICKEN] });

  assert.equal(added.length, 1, "an add that leaves fat inside its band must still be permitted");
  assert.equal(added[0].foodId, "chicken");
  assert.equal(added[0].grams, 180, "the algorithm's own choice: capped by MAX_GRAMS.protein");
});

// ── G6 · adjusters must not all land on the same plate ───────────────────
//
// `slots.find(...)` chose one host before the loop and all three rounds appended
// to that same object, so the round cap — justified in the source as "the most a
// plate can absorb" — could never bind. Over the 250-persona fleet every adjuster
// landed on slot 0 on 250 of 250 days; worst observed 123 -> 685 kcal (x5.56) and
// 375 g of added food on one dish.
//
// A day short on all three macros, with three eligible plates to spread across.
const SPREAD_TARGET = {
  kcal: 2200,
  proteinLo: 150, proteinHi: 190,
  fatLo: 55, fatHi: 70,
  carbLo: 180, carbHi: 260,
};

const threePlateDay = () => [0, 1, 2].map((i) => ({
  recipeId: `r${i}`,
  locked: false,
  ingredients: [{ foodId: `f${i}`, name: `Dish ${i}`, grams: 200 }],
  kcal: 400, protein: 100 / 3, fat: 10, carb: 100 / 3,
}));

const SPREAD_ADJUSTERS = [
  { food: { id: "chicken", name: "Chicken breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 }, role: "protein" },
  { food: { id: "rice", name: "White rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 }, role: "carb" },
  { food: { id: "oil", name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 }, role: "fat" },
];

// How many adjuster ingredients each slot ended up carrying.
const adjusterCounts = (slots) => slots.map(
  (s) => (s.ingredients || []).filter((i) => i.adjuster).length,
);

test("G6: three adjusters land on three different plates, not all on slot 0", () => {
  const { slots, added } = closeDayMacros({
    slots: threePlateDay(), dailyTarget: SPREAD_TARGET, adjusters: SPREAD_ADJUSTERS,
  });

  assert.equal(added.length, 3, "the day is short on all three macros; expect three adds");
  const counts = adjusterCounts(slots);
  assert.deepEqual(counts, [1, 1, 1], "one adjuster per plate — pre-fix this was [3, 0, 0]");
  assert.equal(Math.max(...counts), 1, "no single dish absorbs the whole day's correction");
});

test("G6: a one-plate day still works — spreading is least-loaded-first, not a refusal", () => {
  // Only one eligible slot, so piling up is not a choice. This must behave exactly
  // as it always did; a fix that made single-slot days no-op would be worse than
  // the bug.
  const slots = [{
    recipeId: "solo", locked: false,
    ingredients: [{ foodId: "f0", name: "Only dish", grams: 200 }],
    kcal: 1200, protein: 100, fat: 30, carb: 100,
  }];
  const { slots: out, added } = closeDayMacros({
    slots, dailyTarget: SPREAD_TARGET, adjusters: SPREAD_ADJUSTERS,
  });

  assert.ok(added.length >= 1, "a one-plate day must still be corrected");
  assert.equal(adjusterCounts(out)[0], added.length, "with one host, every adjuster goes there");
});

test("G6: locked and empty slots never host an adjuster, however short the day is", () => {
  const slots = [
    { recipeId: "locked", locked: true, ingredients: [{ foodId: "fa", name: "User's pick", grams: 200 }], kcal: 400, protein: 33, fat: 10, carb: 33 },
    { recipeId: null, locked: false, ingredients: [], kcal: 0, protein: 0, fat: 0, carb: 0 },
    { recipeId: "open", locked: false, ingredients: [{ foodId: "fc", name: "Open dish", grams: 200 }], kcal: 800, protein: 67, fat: 20, carb: 67 },
  ];
  const { slots: out, added } = closeDayMacros({ slots, dailyTarget: SPREAD_TARGET, adjusters: SPREAD_ADJUSTERS });

  assert.ok(added.length >= 1, "there is an eligible plate; the day should be corrected");
  const counts = adjusterCounts(out);
  assert.equal(counts[0], 0, "a locked slot is the user's explicit choice — never touched");
  assert.equal(counts[1], 0, "an empty slot has no dish for a side to belong to");
  assert.equal(counts[2], added.length, "everything lands on the one eligible plate");
});

test("G4: a NEUTRAL adjuster is still allowed on an already-over day — 'no worse', not 'no move'", () => {
  // Fat is over by 25 g and stays over by exactly 25 g: this add does not touch
  // fat. Refusing it would mean an already-failing day can never be helped at
  // all, which is a different bug in the opposite direction.
  const slots = dayWith({ fat: 95 });
  const { added } = closeDayMacros({ slots, dailyTarget: TARGET, adjusters: [FAT_FREE_PROTEIN] });

  assert.ok(added.length >= 1, "an adjuster that does not worsen the over macro must still be allowed");
  assert.equal(added[0].foodId, "isolate");
});

// ── drift guard: the closer's ceiling IS the day's ceiling ────────────────
test("the closer may never push a day past the calorie ceiling it is graded on", () => {
  // macroCloser inlines the band because importing mealSolver would close a cycle
  // (mealSolver -> weeklyPlanner -> macroCloser). Inlined constants drift: this one
  // sat at 1.15 with a comment claiming it matched the verdict long after the band
  // moved to ±10%, licensing the closer to walk a day it was fixing out of
  // tolerance. Assert the behaviour, so the two cannot separate again.
  const solver = require("../src/lib/mealSolver.js");
  const target = { kcal: 2000, proteinLo: 140, proteinHi: 160, fatLo: 60, fatHi: 75, carbLo: 180, carbMid: 200, carbHi: 220 };
  const ceiling = 2000 * (1 + solver.DAY_KCAL_TOLERANCE_PCT);
  assert.equal(solver.dayTolerance(target, { kcal: ceiling, protein: 150, fat: 55, carb: 200 }).kcalOk, true,
    "at the day's ceiling is still in tolerance");
  assert.equal(solver.dayTolerance(target, { kcal: ceiling + 1, protein: 150, fat: 55, carb: 200 }).kcalOk, false,
    "one kcal past it is not — and the closer's own limit must be this same number");
});
