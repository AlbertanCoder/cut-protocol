// ── The 1-meal floor is what keeps the 0-slot hole shut (A6+) ─────────────
//
// The 2026-07-31 fleet found that persona p233 — config `mealsPerDay: 0,
// snacksPerDay: 0` — produced zero slots, emitted no day record at all, and
// returned `diagnosis: null`. It did not become "unjudged", it VANISHED, which
// is why every published all-planned n in that campaign is 639 and not 640. It
// was the single silent miss in 250 personas.
//
// Checked against the product rather than the harness: p233 is a synthetic
// ROBUSTNESS persona whose config the app itself REFUSES. `validateProfileFields`
// requires mealsPerDay in 1..8, so no user can reach the state the rig generated.
// The finding is real about the measurement harness and does not describe a live
// product defect.
//
// That makes the floor load-bearing rather than cosmetic, and it was untested.
// These tests exist so it cannot be loosened quietly: the first three lock the
// boundary, and the last one documents WHY by exercising the solver at meals:0
// and showing what a caller would get if the floor ever went away — an empty
// plan, carrying nothing that says so.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProfileFields } = require("../src/routes/profile.js");
const { buildSlots, generateWeekPlan } = require("../src/lib/weeklyPlanner.js");

test("A6+: a zero-meal config is refused at the door", () => {
  const f = validateProfileFields({ mealsPerDay: 0 });
  assert.ok(f.mealsPerDay, "mealsPerDay: 0 must be rejected — it is the config that produces zero slots");
});

test("A6+: one meal a day is allowed, and eight is still the ceiling", () => {
  // A floor that also refused legitimate values would be its own defect.
  assert.equal(validateProfileFields({ mealsPerDay: 1 }).mealsPerDay, undefined, "one meal a day is a real way to eat");
  assert.equal(validateProfileFields({ mealsPerDay: 8 }).mealsPerDay, undefined);
  assert.ok(validateProfileFields({ mealsPerDay: 9 }).mealsPerDay, "nine is still out of range");
  assert.ok(validateProfileFields({ mealsPerDay: 2.5 }).mealsPerDay, "and it must be a whole number");
});

test("A6+: zero SNACKS stays legal — it is zero MEALS that opens the hole", () => {
  assert.equal(validateProfileFields({ snacksPerDay: 0 }).snacksPerDay, undefined, "eating no snacks is not a misconfiguration");
  assert.ok(buildSlots({ meals: 3, snacks: 0 }).length > 0, "and it still produces a solvable day");
});

test("A6+: what the floor is protecting — meals:0 yields an empty plan that says nothing", async () => {
  // Reached here only by calling the solver directly, which is exactly what the
  // measurement rig did. If the 1..8 validation above is ever loosened, this is
  // the behaviour that ships: no slots, and nothing anywhere explaining why.
  assert.equal(buildSlots({ meals: 0, snacks: 0 }).length, 0, "zero meals and zero snacks is zero slots");

  const dailyTarget = {
    kcal: 2200, kcalTarget: 2200,
    proteinLo: 150, proteinHi: 190, fatLo: 55, fatHi: 70, carbLo: 180, carbHi: 260,
  };
  const plan = await generateWeekPlan(dailyTarget, { meals: 0, snacks: 0 }, [], {});

  assert.ok(Array.isArray(plan), "generateWeekPlan returns a slot array");
  assert.equal(plan.length, 0, "…and for a zero-slot config that array is empty");
  // The point of the test: nothing in this result distinguishes "you asked for no
  // meals" from "the solver failed". A caller reading plan.length sees 0 either way.
  assert.equal(plan.find((s) => s?.warning) ?? null, null, "no slot carries a warning, because there are no slots to carry one");
});
