const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPool } = require("../../src/lib/brain/pool.js");
const { makeTools } = require("../../src/lib/brain/tools.js");

function food(name, over = {}) {
  return { id: name, name, category: "other", kcal: 100, protein: 5, fat: 2, carb: 10, fiber: 0, ...over };
}
function recipe(name, foods, over = {}) {
  return {
    id: name, name, slotType: "meal", mealCategory: null, cuisine: "american",
    kcal: 400, protein: 30, fat: 12, carb: 40,
    ingredients: foods.map((f) => ({ foodId: f.id, baseGrams: 150, scalable: true, role: f.category === "protein" ? "protein" : "carb", food: f })),
    ...over,
  };
}

const CHICKEN = food("Chicken Breast", { category: "protein", kcal: 165, protein: 31, fat: 3.6, carb: 0 });
const RICE = food("White Rice", { category: "carb", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 });
const SHRIMP = food("Shrimp", { category: "protein", kcal: 99, protein: 24, fat: 0.3, carb: 0 });
const KIWI = food("Kiwi", { category: "veg", kcal: 61, protein: 1.1, fat: 0.5, carb: 15 });

const LIBRARY = {
  recipes: [recipe("Chicken & Rice", [CHICKEN, RICE]), recipe("Shrimp & Rice", [SHRIMP, RICE])],
  foods: [CHICKEN, RICE, SHRIMP, KIWI],
};

test("buildPool: exclusions are applied once — excluded recipes/foods never enter the pool", () => {
  const pool = buildPool({ excludedFoods: ["shellfish", "kiwi"] }, LIBRARY);
  assert.equal(pool.recipes.has("Chicken & Rice"), true);
  assert.equal(pool.recipes.has("Shrimp & Rice"), false, "shrimp recipe excluded");
  assert.equal(pool.foods.has("Shrimp"), false);
  assert.equal(pool.foods.has("Kiwi"), false);
  assert.equal(pool.foods.has("White Rice"), true);
  assert.equal(pool.excludedIds.has("Shrimp & Rice"), true);
  assert.equal(pool.excludedIds.has("Kiwi"), true);
  assert.deepEqual(pool.filterSpec.counts, { recipesIn: 2, recipesKept: 1, recipesOut: 1, foodsIn: 4, foodsKept: 2, foodsOut: 2 });
});

test("buildPool: fail-closed exclusions are recorded in filterSpec for logging", () => {
  const bad = recipe("Mystery", [CHICKEN]);
  bad.ingredients.push({ foodId: "x", baseGrams: 20, scalable: true, role: null, food: null });
  const pool = buildPool({}, { recipes: [bad], foods: [] });
  assert.equal(pool.recipes.has("Mystery"), false);
  assert.equal(pool.filterSpec.failClosed.length, 1);
  assert.equal(pool.filterSpec.failClosed[0].reason, "unresolvable-ingredient");
});

test("tools.searchRecipes: returns only pool recipes and carries prov", () => {
  const pool = buildPool({ excludedFoods: ["shellfish"] }, LIBRARY);
  const tools = makeTools(pool);
  const res = tools.searchRecipes({ query: "rice" });
  const names = res.value.map((r) => r.name);
  assert.deepEqual(names, ["Chicken & Rice"], "the excluded shrimp recipe is structurally invisible");
  assert.equal(res.prov.formulaId, "searchRecipes");
  assert.equal(res.prov.value, 1);
});

test("tools.computeMacros: per-100g × grams / 100, returns a MacroVector with prov", () => {
  const pool = buildPool({}, LIBRARY);
  const tools = makeTools(pool);
  const res = tools.computeMacros({ items: [{ foodId: "Chicken Breast", grams: 200 }, { foodId: "White Rice", grams: 100 }] });
  // chicken 200g: 330 kcal, 62 p, 7.2 f, 0 c ; rice 100g: 130 kcal, 2.7 p, 0.3 f, 28 c
  assert.equal(Math.round(res.value.kcal), 460);
  assert.equal(Math.round(res.value.protein_g * 10) / 10, 64.7);
  assert.equal(Math.round(res.value.carb_g), 28);
  assert.equal(res.prov.formulaId, "computeMacros");
  assert.deepEqual(res.prov.value, res.value, "prov carries the produced value");
});

test("tools reject unknown/excluded ids — never a silent zero", () => {
  const pool = buildPool({ excludedFoods: ["shellfish"] }, LIBRARY);
  const tools = makeTools(pool);
  assert.throws(() => tools.computeMacros({ items: [{ foodId: "Shrimp", grams: 100 }] }), /not in the pool/);
  assert.throws(() => tools.scaleRecipe({ recipeId: "Shrimp & Rice", kcalTarget: 500, proteinTarget: 40 }), /not in the pool/);
});

test("tools.scaleRecipe wraps the solver's authoritative scale and carries prov", () => {
  const pool = buildPool({}, LIBRARY);
  const tools = makeTools(pool);
  const res = tools.scaleRecipe({ recipeId: "Chicken & Rice", kcalTarget: 600, proteinTarget: 45 });
  assert.ok(res.value.kcal > 0 && res.value.protein_g > 0);
  assert.equal(res.prov.formulaId, "scaleRecipe");
  assert.ok(Array.isArray(res.ingredients) && res.ingredients.length === 2);
});

test("every tool result carries prov {formulaId, inputs, value}", () => {
  const pool = buildPool({}, LIBRARY);
  const tools = makeTools(pool);
  const results = [
    tools.searchRecipes({ query: "" }),
    tools.searchFoods({ query: "rice" }),
    tools.computeMacros({ items: [{ foodId: "White Rice", grams: 100 }] }),
    tools.dayTotals({ slots: [{ kcal: 500, protein: 40, carb: 50, fat: 15 }] }),
  ];
  for (const r of results) {
    assert.ok(r.prov && typeof r.prov.formulaId === "string" && "inputs" in r.prov && "value" in r.prov, `${JSON.stringify(r.prov)} is a valid prov`);
  }
});
