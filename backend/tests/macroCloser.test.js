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

test("G4: a NEUTRAL adjuster is still allowed on an already-over day — 'no worse', not 'no move'", () => {
  // Fat is over by 25 g and stays over by exactly 25 g: this add does not touch
  // fat. Refusing it would mean an already-failing day can never be helped at
  // all, which is a different bug in the opposite direction.
  const slots = dayWith({ fat: 95 });
  const { added } = closeDayMacros({ slots, dailyTarget: TARGET, adjusters: [FAT_FREE_PROTEIN] });

  assert.ok(added.length >= 1, "an adjuster that does not worsen the over macro must still be allowed");
  assert.equal(added[0].foodId, "isolate");
});
