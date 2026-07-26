// P0-1 — the brain, in the solve loop.
//
// THE BUG THESE TESTS EXIST TO KEEP FIXED: the Library→Brain router
// (lib/mealRouter.js) has existed and worked for some time, but nothing ever
// invoked it during a real generate. Three breaks:
//   1. routes/plans.js POST /generate passed no `aiFallback`
//   2. generateHorizonPlan had no `aiFallback` parameter to forward
//   3. generateBestWeekPlan strips it from every attempt
//      (`{ ...options, aiFallback: undefined }`) — correct, so best-of-N stays
//      free — but nothing filled the winner's gaps afterwards
//
// The strip is deliberate and stays. These tests pin the other half: the brain
// runs ONCE, on the winning week, over the gaps that survived.
//
// No DB, no network, no model. The router is injected through the documented
// `aiFallback.routeMealSlotImpl` seam, so these assert the WIRING — that the
// router is called, with a real target, and that its result reaches the plan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fillGapsWithBrain } = require("../src/lib/weeklyPlanner.js");
const { generateHorizonPlan, resolveHorizon } = require("../src/lib/mealSolver.js");

function food(id, kcal, protein, fat, carb) {
  return { id, name: id, kcal, protein, fat, carb };
}
function flexible(id, slotType = "meal") {
  return {
    id, name: id, slotType, source: "curated", kcal: 400, protein: 30, fat: 12, carb: 40,
    ingredients: [
      { foodId: `${id}-p`, baseGrams: 150, scalable: true, role: "protein", food: food(`${id}-p`, 165, 31, 3.6, 0) },
      { foodId: `${id}-c`, baseGrams: 150, scalable: true, role: "carb", food: food(`${id}-c`, 130, 2.7, 0.3, 28) },
    ],
  };
}
// Stands in for a brain-designed, engine-verified recipe coming back from the
// router. Shaped like any other pool recipe, because that is exactly what the
// router persists.
function designed(id) {
  return { ...flexible(id), source: "brain", verified: true };
}

const DAILY = { kcal: 2000, proteinLo: 150, proteinHi: 180 };
const CONFIG = { meals: 3, snacks: 0 };

// ── the pass itself ──────────────────────────────────────────────────────────

test("fillGapsWithBrain is a NO-OP without aiFallback — this is what keeps BRAIN=off byte-identical", async () => {
  const slots = [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: null }];
  const out = await fillGapsWithBrain(slots, { dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [], aiFallback: null });
  assert.equal(out.slots, slots, "the very same array is handed back");
  assert.deepEqual(
    { attempted: out.attempted, filled: out.filled, callsUsed: out.callsUsed },
    { attempted: 0, filled: 0, callsUsed: 0 }
  );
});

test("fillGapsWithBrain fills an EMPTY slot through the router and reports it honestly", async () => {
  const calls = [];
  const pool = [flexible("f1")];
  const slots = [
    { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: "f1", kcal: 600, protein: 45, fat: 18, carb: 60, warning: null },
    { dayOfWeek: 0, slotType: "meal", slotIndex: 1, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: "nothing eligible" },
  ];

  const out = await fillGapsWithBrain(slots, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: pool,
    aiFallback: {
      enabled: true, maxCalls: 3, profile: { dietaryStyle: null },
      routeMealSlotImpl: async ({ target }) => {
        calls.push(target);
        return { ok: true, recipe: designed("brain-1") };
      },
    },
  });

  assert.equal(calls.length, 1, "the router was asked about the empty slot only");
  assert.ok(calls[0].kcalTarget > 0, "and it was handed a REAL target, not an empty object");
  assert.equal(calls[0].slotType, "meal");
  assert.equal(out.filled, 1);
  assert.equal(out.replaced, 0);
  assert.equal(out.slots[1].recipeId, "brain-1", "the designed recipe reached the plan");
  assert.equal(out.slots[0].recipeId, "f1", "the already-good slot was left alone");
});

test("an out-of-tolerance slot is offered to the brain — but only AFTER every empty one", async () => {
  const order = [];
  const slots = [
    { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: "f1", warning: "landed 900 kcal vs a 600 target", kcal: 900, protein: 40, fat: 20, carb: 80 },
    { dayOfWeek: 0, slotType: "meal", slotIndex: 1, recipeId: null, warning: "nothing eligible", kcal: 0, protein: 0, fat: 0, carb: 0 },
  ];
  const out = await fillGapsWithBrain(slots, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 5, profile: {},
      routeMealSlotImpl: async ({ target }) => {
        order.push(target.slotIndex);
        return { ok: true, recipe: designed(`d${target.slotIndex}`) };
      },
    },
  });
  // An empty plate is strictly worse than a rough one, so on a bounded budget
  // it gets first call.
  assert.deepEqual(order, [1, 0], "empty slot first, rough slot second");
  assert.equal(out.filled, 1);
  assert.equal(out.replaced, 1);
});

test("the call budget is a HARD ceiling — three gaps, a budget of one, one call", async () => {
  let n = 0;
  const slots = [0, 1, 2].map((i) => ({ dayOfWeek: 0, slotType: "meal", slotIndex: i, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: null }));
  const out = await fillGapsWithBrain(slots, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 1, profile: {},
      routeMealSlotImpl: async ({ target }) => { n++; return { ok: true, recipe: designed(`d${target.slotIndex}`) }; },
    },
  });
  assert.equal(n, 1, "budget spent, no further calls");
  assert.equal(out.callsUsed, 1);
  assert.equal(out.slots.filter((s) => s.recipeId).length, 1, "two gaps remain, honestly unfilled");
});

test("a router that declines leaves the slot honestly empty rather than inventing one", async () => {
  const slots = [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: null }];
  const out = await fillGapsWithBrain(slots, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: { enabled: true, maxCalls: 2, profile: {}, routeMealSlotImpl: async () => ({ ok: false, recipe: null }) },
  });
  assert.equal(out.filled, 0);
  assert.equal(out.slots[0].recipeId, null, "no fake fill");
});

test("a router that THROWS degrades to an empty slot, never a crashed generate", async () => {
  const slots = [{ dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: null }];
  const out = await fillGapsWithBrain(slots, {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: { enabled: true, maxCalls: 2, profile: {}, routeMealSlotImpl: async () => { throw new Error("upstream on fire"); } },
  });
  assert.equal(out.filled, 0);
  assert.equal(out.slots[0].recipeId, null);
});

// ── the horizon: one budget for the whole thing ──────────────────────────────

test("the horizon shares ONE brain budget across windows — a month does not get 4x the spend", async () => {
  let calls = 0;
  // An empty pool guarantees every slot is a gap, so the ONLY thing bounding
  // the call count is the budget itself.
  const result = await generateHorizonPlan({
    dailyTarget: DAILY, mealConfig: { meals: 2, snacks: 0 }, recipePool: [],
    horizon: resolveHorizon("2weeks"), // two windows
    attempts: 1, rng: () => 0.5,
    aiFallback: {
      enabled: true, maxCalls: 3, profile: {},
      routeMealSlotImpl: async () => { calls++; return { ok: false, recipe: null }; },
    },
  });
  assert.equal(result.horizon.days, 14);
  assert.ok(result.windows.length >= 2, "a fortnight is more than one window");
  assert.equal(calls, 3, "3 total across ALL windows, not 3 per window");
  assert.equal(result.brain.callsUsed, 3);
  assert.equal(result.brain.callsRemaining, 0);
});

test("without aiFallback the horizon result carries NO brain key — the response shape is unchanged", async () => {
  const result = await generateHorizonPlan({
    dailyTarget: DAILY, mealConfig: { meals: 2, snacks: 0 }, recipePool: [flexible("f1"), flexible("f2")],
    horizon: resolveHorizon("day"), attempts: 1, rng: () => 0.5,
  });
  assert.equal("brain" in result, false, "a BRAIN=off response is shaped exactly as before P0-1");
});

test("a brain-filled slot is NOT still reported as a miss — the pass runs before the diagnosis", async () => {
  // The ordering bug this guards: fill the gaps, then diagnose. Diagnosing
  // first would have the app report a slot as empty that it had just filled.
  const result = await generateHorizonPlan({
    dailyTarget: DAILY, mealConfig: { meals: 1, snacks: 0 }, recipePool: [],
    horizon: resolveHorizon("day"), attempts: 1, rng: () => 0.5,
    aiFallback: {
      enabled: true, maxCalls: 5, profile: {},
      routeMealSlotImpl: async () => ({ ok: true, recipe: designed("brain-fill") }),
    },
  });
  const slots = result.windows.flatMap((w) => w.slots);
  const filled = slots.filter((s) => s.recipeId);
  assert.ok(filled.length > 0, "the brain filled at least one slot from an EMPTY pool");
  assert.ok(
    !/came back empty/.test(JSON.stringify(result.diagnosis || {})),
    "the diagnosis must not report emptiness the brain already resolved"
  );
});
