// Stage H — brain grocery aggregation. Deterministic + offline; the key
// guarantee is assertNoExcluded AFTER aggregation: an excluded item can never
// reappear on a shopping list via a combine step (LAW 2, fail-closed).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildBrainGroceryList, aggregateBrainPlan, assertNoExcluded, collectIngredients } = require("../../src/lib/brain/grocery.js");

const CHICKEN = { id: "f1", name: "Chicken breast" };
const RICE = { id: "f2", name: "White rice cooked" };
const PORK = { id: "f9", name: "Pork belly" };
const PROFILE = { dietaryStyle: "none", excludedFoods: [] };
const slot = (ings) => ({ recipe: { ingredients: ings } });
const PLAN = { slots: [slot([{ food: CHICKEN, grams: 200 }, { food: RICE, grams: 150 }]), slot([{ food: CHICKEN, grams: 100 }, { food: RICE, grams: 100 }])] };
const SECTIONS = ["produce", "protein", "dairy", "pantry", "spices", "other"];

test("aggregateBrainPlan sums grams per food across slots", () => {
  const rows = aggregateBrainPlan(PLAN);
  assert.equal(rows.length, 2);
  const chicken = rows.find((r) => r.foodId === "f1");
  assert.equal(chicken.grams, 300);
  assert.equal(chicken.occurrences, 2);
});

test("collectIngredients handles bare recipe / day / week shapes", () => {
  assert.equal(collectIngredients({ ingredients: [{ food: CHICKEN, grams: 100 }] }).length, 1);
  assert.equal(collectIngredients(PLAN).length, 4);
  assert.equal(collectIngredients({ days: [{ slots: [slot([{ food: CHICKEN, grams: 100 }])] }] }).length, 1);
});

test("buildBrainGroceryList returns a sectioned, purchase-unit list", () => {
  const g = buildBrainGroceryList(PLAN, PROFILE);
  assert.equal(g.ok, true);
  assert.equal(g.items.length, 2);
  for (const it of g.items) {
    assert.ok(SECTIONS.includes(it.section));
    assert.ok(it.purchase && typeof it.purchase === "object"); // reuses convertToPurchaseQuantity
  }
  // every item lands in exactly one section bucket
  const bucketed = SECTIONS.reduce((n, s) => n + g.bySection[s].length, 0);
  assert.equal(bucketed, g.items.length);
});

test("assertNoExcluded — clean list passes", () => {
  assert.equal(assertNoExcluded(aggregateBrainPlan(PLAN), PROFILE).ok, true);
});

test("assertNoExcluded — an excluded item is caught (LAW 2)", () => {
  const rows = aggregateBrainPlan({ slots: [slot([{ food: PORK, grams: 200 }, { food: RICE, grams: 100 }])] });
  const r = assertNoExcluded(rows, { dietaryStyle: "none", excludedFoods: ["pork"] });
  assert.equal(r.ok, false);
  assert.ok(r.rejections.some((x) => /pork/i.test(x.name)));
});

test("assertNoExcluded — FAIL-CLOSED on an unresolvable item", () => {
  const r = assertNoExcluded([{ name: null, food: null }], PROFILE);
  assert.equal(r.ok, false);
  assert.equal(r.rejections[0].failClosed, true);
});

test("buildBrainGroceryList refuses to emit a list with a leaked exclusion", () => {
  const plan = { slots: [slot([{ food: PORK, grams: 200 }, { food: RICE, grams: 100 }])] };
  const g = buildBrainGroceryList(plan, { dietaryStyle: "none", excludedFoods: ["pork"] });
  assert.equal(g.ok, false);
  assert.equal(g.items.length, 0); // NOT a list with the leaked item
  assert.ok(g.assertion.rejections.length > 0);
});

test("buildBrainGroceryList is deterministic", () => {
  assert.deepEqual(buildBrainGroceryList(PLAN, PROFILE), buildBrainGroceryList(PLAN, PROFILE));
});

// Regression (integration fleet): a planDay() result is { day:[...slots] }; that
// shape must aggregate, not silently produce an empty list.
test("buildBrainGroceryList handles a planDay result shape ({ day:[...slots] })", () => {
  const plan = { day: [{ recipeId: "cr", ingredients: [{ food: CHICKEN, grams: 200 }, { food: RICE, grams: 150 }] }] };
  const g = buildBrainGroceryList(plan, PROFILE);
  assert.equal(g.ok, true);
  assert.equal(g.items.length, 2); // NOT a silent empty list
});
