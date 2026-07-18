const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../src/lib/prisma.js");
const { sumMacros, resolveDraftIngredients, generateAndSaveSlotRecipe } = require("../src/lib/recipeGeneration.js");

// These tests never call the real Anthropic API or write real Recipe/Food
// rows — every external dependency (generateDraftsImpl, resolveIngredientImpl,
// persistRecipeImpl) is injected as a fake, matching this codebase's existing
// fdcClient.js-style DI pattern rather than mocking require()'d modules.
// resolveIngredientImpl's fakes point at REAL, already-existing Food rows
// (read-only lookup below) so resolveDraftIngredients()'s own internal
// prisma.food.findMany() re-fetch succeeds against real data without this
// suite ever creating anything.

let realFoods;
test.before(async () => {
  realFoods = await prisma.food.findMany({ take: 3 });
  assert.ok(realFoods.length === 3, "expected at least 3 real Food rows to exist in the dev DB for these tests to borrow read-only");
});
test.after(async () => {
  await prisma.$disconnect();
});

test("sumMacros sums grams-scaled macros across ingredients", () => {
  const result = sumMacros([
    { food: { kcal: 200, protein: 20, fat: 5, carb: 10 }, grams: 100 },
    { food: { kcal: 100, protein: 5, fat: 2, carb: 20 }, grams: 50 },
  ]);
  assert.equal(result.kcal, 250); // 200*1 + 100*0.5
  assert.equal(result.protein, 22.5);
});

test("resolveDraftIngredients resolves every ingredient and sums real macros, never trusting the AI's own numbers", async () => {
  const fakeResolve = async (name) => ({ food: realFoods[0], matched: "existing" });
  const draft = {
    name: "Test Draft", description: "d", cuisine: "test", slotType: "meal",
    prepTimeMin: 10, servings: 1, steps: ["step 1"],
    ingredients: [{ name: "anything", grams: 100, role: "protein", scalable: true }],
  };
  const resolved = await resolveDraftIngredients(draft, fakeResolve);
  assert.equal(resolved.ingredients.length, 1);
  assert.equal(resolved.ingredients[0].foodId, realFoods[0].id);
  assert.equal(resolved.kcal, realFoods[0].kcal); // 100g = the food's own per-100g figure exactly
});

test("generateAndSaveSlotRecipe picks the draft whose protein/kcal ratio best matches the target, not just draft #1", async () => {
  // Ratio is invariant to grams (both protein and kcal scale by the same
  // factor), so it's determined entirely by which real food each draft's
  // single ingredient resolves to - pick 3 foods spanning a real ratio
  // spread from the dev DB itself rather than hardcoding assumed values.
  const candidates = await prisma.food.findMany({ where: { kcal: { gt: 0 } }, take: 30 });
  const withRatio = candidates.map((f) => ({ food: f, ratio: f.protein / f.kcal })).sort((a, b) => a.ratio - b.ratio);
  assert.ok(withRatio.length >= 3, "need at least 3 real foods with distinct ratios for this test");
  const low = withRatio[0], mid = withRatio[Math.floor(withRatio.length / 2)], high = withRatio[withRatio.length - 1];
  assert.ok(low.ratio < mid.ratio && mid.ratio < high.ratio, "test fixture needs 3 strictly-ordered ratios, got a tie in the real data sample");

  // Target ratio = mid's real ratio exactly, so "Best fit" must win over the low/high extremes.
  const target = { slotType: "meal", kcalTarget: 500, proteinTarget: 500 * mid.ratio };

  const draftShape = (name, food) => ({
    name, description: "d", cuisine: "test", slotType: "meal", prepTimeMin: 10, servings: 1, steps: ["s"],
    ingredients: [{ name: food.name, grams: 100, role: "protein", scalable: true }],
  });
  const drafts = [draftShape("Low-ratio draft", low.food), draftShape("Best fit", mid.food), draftShape("High-ratio draft", high.food)];
  const foodByDraftName = { "Low-ratio draft": low.food, "Best fit": mid.food, "High-ratio draft": high.food };

  let lastRequestedName = null;
  const fakeResolve = async (name) => {
    lastRequestedName = name;
    return { food: candidates.find((f) => f.name === name), matched: "existing" };
  };

  let persistedName = null;
  const fakePersist = async (resolvedDraft) => {
    persistedName = resolvedDraft.name;
    return { id: "fake-recipe-id", name: resolvedDraft.name, ingredients: [] };
  };

  await generateAndSaveSlotRecipe(
    target,
    { cuisinePreferences: [], mealPreferencesNote: null },
    [],
    { generateDraftsImpl: async () => ({ drafts }), resolveIngredientImpl: fakeResolve, persistRecipeImpl: fakePersist }
  );

  assert.equal(persistedName, "Best fit", `expected the mid-ratio draft to win (target ratio ${mid.ratio}); low=${low.ratio}, high=${high.ratio}`);
});

test("generateAndSaveSlotRecipe passes cuisine (from profile.cuisinePreferences) and freeText (from mealPreferencesNote) through to draft generation", async () => {
  let capturedParams = null;
  const target = { slotType: "snack", kcalTarget: 300, proteinTarget: 20 };
  const fakeResolve = async () => ({ food: realFoods[0], matched: "existing" });
  const draft = { name: "D", description: "d", cuisine: "thai", slotType: "snack", prepTimeMin: 5, servings: 1, steps: ["s"], ingredients: [{ name: "x", grams: 50, role: "protein", scalable: true }] };

  await generateAndSaveSlotRecipe(
    target,
    { cuisinePreferences: ["thai"], mealPreferencesNote: "high protein, air fryer only" },
    ["Existing Recipe A"],
    {
      generateDraftsImpl: async (params) => { capturedParams = params; return { drafts: [draft] }; },
      resolveIngredientImpl: fakeResolve,
      persistRecipeImpl: async (d) => ({ id: "x", name: d.name, ingredients: [] }),
    }
  );

  assert.equal(capturedParams.slotType, "snack");
  assert.equal(capturedParams.cuisine, "thai"); // only one option in the list, deterministic
  assert.equal(capturedParams.freeText, "high protein, air fryer only");
  assert.equal(capturedParams.allowAllergens, false, "the unattended path must always be safety-first");
  assert.deepEqual(capturedParams.existingRecipeNames, ["Existing Recipe A"]);
});

test("generateAndSaveSlotRecipe throws honestly (never silently returns nothing) when every draft was dropped for allergy-rule violations", async () => {
  const target = { slotType: "meal", kcalTarget: 500, proteinTarget: 40 };
  await assert.rejects(
    () => generateAndSaveSlotRecipe(target, { cuisinePreferences: [], mealPreferencesNote: null }, [], {
      generateDraftsImpl: async () => ({ drafts: [], droppedForAllergies: [{ name: "x", reason: "shellfish" }] }),
    }),
    /no usable drafts/i
  );
});
