const { test } = require("node:test");
const assert = require("node:assert/strict");
const { looksLikePlanRequest, generateDayForChat, planIntro } = require("../../src/lib/brain/chatPlan.js");

test("looksLikePlanRequest: matches explicit build-a-day asks", () => {
  for (const m of [
    "plan me a day", "plan me a high-protein day", "build me a full day",
    "generate a meal plan", "make me a day of meals", "can you put together a day",
    "give me a menu for today", "map out a day of eating",
  ]) assert.ok(looksLikePlanRequest(m), `should match: ${m}`);
});

test("looksLikePlanRequest: does NOT match ideas / swaps / follow-ups", () => {
  for (const m of [
    "vegan dinner ideas", "swap a meal that's too high in fat", "why not fish?",
    "what's a good high-protein lunch", "low-carb snack under my target",
    "tell me about oats", "is peanut butter ok on keto",
  ]) assert.ok(!looksLikePlanRequest(m), `should NOT match: ${m}`);
});

test("looksLikePlanRequest: non-strings are safe", () => {
  assert.equal(looksLikePlanRequest(null), false);
  assert.equal(looksLikePlanRequest(undefined), false);
  assert.equal(looksLikePlanRequest(123), false);
});

test("generateDayForChat: shapes the solver's best candidate into a display plan (engine numbers)", async () => {
  const planContext = async () => ({
    dailyTarget: { kcal: 2200, proteinLo: 150, proteinHi: 190, fatLo: 50, fatHi: 80, carbLo: 180, carbHi: 260 },
    mealConfig: { meals: 2, snacks: 0 },
    recipePool: [{ id: "a", name: "Oats & Whey" }, { id: "b", name: "Salmon Bowl" }],
  });
  const generateDayCandidates = async ({ dailyTarget, mealConfig, recipePool, profile }) => {
    assert.ok(dailyTarget && mealConfig && recipePool, "solver receives the full context");
    assert.equal(profile, undefined, "no profile passed → the LLM critic block is skipped (deterministic)");
    return { candidates: [{ slots: [
      { recipeId: "a", slotType: "meal", kcal: 600.4, protein: 45.6, fat: 15.2, carb: 70.8 },
      { recipeId: "b", slotType: "meal", kcal: 1600.2, protein: 120.1, fat: 55.9, carb: 150.3 },
    ], score: { matchPct: 92, totals: { kcal: 2201, protein: 166, fat: 71, carb: 221 } } }] };
  };
  const plan = await generateDayForChat({ userId: "u" }, { planContext, generateDayCandidates });
  assert.equal(plan.slots.length, 2);
  assert.deepEqual(plan.slots[0], { slotType: "meal", label: "Oats & Whey", kcal: 600, protein: 46, fat: 15, carb: 71, warning: null });
  assert.equal(plan.total.kcal, 2201, "day total is the solver's own rounded total");
  assert.equal(plan.matchPct, 92);
  assert.equal(plan.target.kcal, 2200);
});

test("generateDayForChat: null when the solver returns no candidate", async () => {
  const planContext = async () => ({ dailyTarget: { kcal: 2000 }, mealConfig: { meals: 3, snacks: 0 }, recipePool: [] });
  assert.equal(await generateDayForChat({ userId: "u" }, { planContext, generateDayCandidates: async () => ({ candidates: [] }) }), null);
  assert.equal(await generateDayForChat({ userId: "u" }, { planContext, generateDayCandidates: async () => ({}) }), null);
});

test("generateDayForChat: an unfilled slot (no recipe) renders a blank label, not a crash", async () => {
  const planContext = async () => ({ dailyTarget: { kcal: 2000, proteinLo: 1, proteinHi: 2, fatLo: 1, fatHi: 2, carbLo: 1, carbHi: 2 }, mealConfig: { meals: 2, snacks: 0 }, recipePool: [{ id: "a", name: "Oats" }] });
  const generateDayCandidates = async () => ({ candidates: [{ slots: [
    { recipeId: "a", slotType: "meal", kcal: 500, protein: 40, fat: 10, carb: 55 },
    { recipeId: null, slotType: "meal", kcal: 0, protein: 0, fat: 0, carb: 0 },
  ], score: { matchPct: 40, totals: { kcal: 500, protein: 40, fat: 10, carb: 55 } } }] });
  const plan = await generateDayForChat({ userId: "u" }, { planContext, generateDayCandidates });
  assert.equal(plan.slots[1].label, null);
  assert.equal(plan.slots[0].label, "Oats");
});

test("planIntro: contains NO digit (LAW 1 — numbers live only in the card)", () => {
  for (const mp of [null, 95, 80, 50]) {
    const intro = planIntro({ slots: [{ label: "x" }], matchPct: mp });
    assert.ok(!/\d/.test(intro), `intro must state no number (matchPct=${mp}): ${intro}`);
    assert.ok(/Plan tab/.test(intro), "intro points to the Plan tab");
  }
});
