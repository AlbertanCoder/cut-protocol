// ── weeklyPlanner · the closer must not leave the warning lying (E4) ──────
//
// A slot's warning is built from the recipe AS SCALED in resolveSlot() and frozen
// onto the record ~290 lines before closeDayMacros() touches the plate. Nothing
// recomputed it, so once the closer added food the sentence went on quoting a kcal
// figure the slot no longer had.
//
// Measured over the 250-persona fleet at seed 424242: 250 adjusted slots, 15 of
// them (6.0%) quoting a kcal the slot does not have, 8 off by =>50, worst 701 kcal.
// Eight of the fifteen UNDERSTATED the gap. The worst case, p115 d1, stored:
//
//     "…closest was 'Steak with Garlic Mushrooms' (landed 470 kcal vs a 557 target)."
//
// while the slot actually shipped 1,171 kcal. The warning reported the slot 87 kcal
// UNDER target when it was 614 OVER — the SIGN was wrong, not just the magnitude.
// Under this repo's constitution ("silent target misses are forbidden") a wrong
// number that reads as reassuring is the failure mode that matters.
//
// What these tests would catch: dropping the restatement (the frozen sentence ships
// alone again), losing the slotIndex the closer now reports (the caller cannot tell
// WHICH slot moved, so it restates nothing or restates the wrong one), and the two
// cheap over-corrections — restating a slot the closer never touched, or inventing
// a warning on a slot that never had one.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { restateAdjustedWarnings } = require("../src/lib/weeklyPlanner.js");
const { closeDayMacros } = require("../src/lib/macroCloser.js");

// The p115 shape: a slot whose recipe landed well under its own target, so it
// carries a warning — and which the closer then loads up.
const STALE_SENTENCE =
  'Tried 12 recipe(s) for this slot, none fit within tolerance — closest was "Steak with Garlic Mushrooms" (landed 470 kcal vs a 557 target).';

test("E4: a slot the closer moved has its warning restated with what it actually ships", () => {
  const slots = [{ recipeId: "r0", locked: false, warning: STALE_SENTENCE, kcal: 1171, protein: 60, fat: 40, carb: 90, ingredients: [] }];
  const added = [{ foodId: "rice", name: "White rice", grams: 160, role: "carb", slotIndex: 0 }];

  const [slot] = restateAdjustedWarnings(slots, added);

  assert.match(slot.warning, /now provides 1171 kcal/, "the warning must quote what the slot actually ships");
  assert.match(slot.warning, /160g white rice/, "and name what was added to it");
  assert.ok(slot.warning.startsWith(STALE_SENTENCE), "the original reason the recipe was chosen is kept, not overwritten");
});

test("E4: the restated number is the slot's own, so the reader can see the SIGN", () => {
  // The defect that mattered: the stored sentence says 470 against a 557 target,
  // which reads as 87 UNDER. The slot ships 1,171 — 614 OVER. Both numbers are now
  // on the record, so the reassuring one cannot be the only one.
  const slots = [{ recipeId: "r0", locked: false, warning: STALE_SENTENCE, kcal: 1171, protein: 60, fat: 40, carb: 90, ingredients: [] }];
  const [slot] = restateAdjustedWarnings(slots, [{ foodId: "oil", name: "Olive Oil", grams: 20, role: "fat", slotIndex: 0 }]);

  const quoted = [...slot.warning.matchAll(/(\d+) kcal/g)].map((m) => Number(m[1]));
  assert.ok(quoted.includes(470), "the original landed figure stays visible");
  assert.ok(quoted.includes(1171), "the real shipped figure is now visible too");
  assert.ok(Math.max(...quoted) > 557, "a reader can see the slot is over its 557 target, not under it");
});

test("E4: a slot the closer did NOT touch is left byte-identical", () => {
  const untouched = { recipeId: "r1", locked: false, warning: STALE_SENTENCE, kcal: 470, protein: 30, fat: 15, carb: 40, ingredients: [] };
  const slots = [
    { recipeId: "r0", locked: false, warning: "slot zero warning", kcal: 800, protein: 40, fat: 20, carb: 60, ingredients: [] },
    untouched,
  ];
  const out = restateAdjustedWarnings(slots, [{ foodId: "rice", name: "White rice", grams: 100, role: "carb", slotIndex: 0 }]);

  assert.equal(out[1], untouched, "an untouched slot is not even re-created, let alone re-narrated");
  assert.equal(out[1].warning, STALE_SENTENCE);
});

test("E4: a slot with no warning does not get one invented", () => {
  // A slot the closer pushed out of band that never carried a warning is a MISSING
  // warning — a different defect. Manufacturing a sentence here would hide it.
  const slots = [{ recipeId: "r0", locked: false, warning: null, kcal: 900, protein: 40, fat: 20, carb: 60, ingredients: [] }];
  const [slot] = restateAdjustedWarnings(slots, [{ foodId: "rice", name: "White rice", grams: 100, role: "carb", slotIndex: 0 }]);

  assert.equal(slot.warning, null, "no warning in, no warning out");
});

test("E4: closeDayMacros reports WHICH slot each adjuster landed on", () => {
  // Without slotIndex the planner cannot restate anything, so this is the wiring
  // the fix stands on — and it must survive the G6 spread across plates.
  const day = [0, 1, 2].map((i) => ({
    recipeId: `r${i}`, locked: false,
    ingredients: [{ foodId: `f${i}`, name: `Dish ${i}`, grams: 200 }],
    kcal: 400, protein: 100 / 3, fat: 10, carb: 100 / 3,
  }));
  const { added } = closeDayMacros({
    slots: day,
    dailyTarget: { kcal: 2200, proteinLo: 150, proteinHi: 190, fatLo: 55, fatHi: 70, carbLo: 180, carbHi: 260 },
    adjusters: [
      { food: { id: "chicken", name: "Chicken breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 }, role: "protein" },
      { food: { id: "rice", name: "White rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 }, role: "carb" },
      { food: { id: "oil", name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 }, role: "fat" },
    ],
  });

  assert.ok(added.length >= 1);
  for (const a of added) assert.ok(Number.isInteger(a.slotIndex), "every adjuster reports its host slot");
  assert.equal(new Set(added.map((a) => a.slotIndex)).size, added.length, "G6: distinct plates, so distinct slot indices");
});
