const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prismaUsageStore } = require("../../src/lib/brain/usageStore.js");
const { makeLedger, withUsageLogging } = require("../../src/lib/brain/ledger.js");
const { planDay } = require("../../src/lib/brain/planner.js");

// ── prismaUsageStore (fake db — no real database) ──
test("prismaUsageStore.add maps + rounds token fields into the LlmUsage row", async () => {
  const created = [];
  const fakeDb = { llmUsage: { create: async ({ data }) => { created.push(data); return { id: "x", ...data }; } } };
  await prismaUsageStore(fakeDb).add({ userId: "u1", model: "claude-sonnet-5", phase: "plan", inputTokens: 100.6, outputTokens: 50, cacheReadTokens: 10, costUsd: 0.002 });
  assert.equal(created.length, 1);
  assert.equal(created[0].model, "claude-sonnet-5");
  assert.equal(created[0].userId, "u1");
  assert.equal(created[0].inputTokens, 101, "rounded to an Int");
  assert.equal(created[0].costUsd, 0.002);
});

test("prismaUsageStore.sumSince returns the aggregated cost (0 when empty)", async () => {
  const withRows = { llmUsage: { aggregate: async () => ({ _sum: { costUsd: 4.25 } }) } };
  assert.equal(await prismaUsageStore(withRows).sumSince(new Date()), 4.25);
  const empty = { llmUsage: { aggregate: async () => ({ _sum: { costUsd: null } }) } };
  assert.equal(await prismaUsageStore(empty).sumSince(new Date()), 0);
});

// ── withUsageLogging ──
test("withUsageLogging records the ACTUAL cost from a response's usage block", async () => {
  const ledger = makeLedger();
  const call = async () => ({ content: [], usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } });
  const res = await withUsageLogging(ledger, { model: "claude-sonnet-5", phase: "plan", userId: "u1" }, call);
  assert.ok(res.usage, "returns the response");
  assert.equal(await ledger.spentThisMonth(), 18); // 1M in ×$3 + 1M out ×$15
});

test("withUsageLogging records nothing for a degraded call (no usage block)", async () => {
  const ledger = makeLedger();
  await withUsageLogging(ledger, { model: "claude-sonnet-5" }, async () => ({ status: "unavailable" }));
  assert.equal(await ledger.spentThisMonth(), 0);
});

// ── offline degrade (LAW 4) ──
function food(id, kcal, p, f, c) { return { id, name: id, category: "other", kcal, protein: p, fat: f, carb: c }; }
function ing(fd, g, role) { return { foodId: fd.id, baseGrams: g, scalable: true, role, food: fd }; }
function withCache(r) {
  const t = r.ingredients.reduce((s, i) => { const k = i.baseGrams / 100; return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k }; }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { ...r, ...t };
}
const CR = withCache({ id: "cr", name: "Chicken & Rice", slotType: "meal", mealCategory: null, ingredients: [ing(food("chicken", 165, 31, 3.6, 0), 150, "protein"), ing(food("rice", 130, 2.7, 0.3, 28), 150, "carb")] });
const LIBRARY = { recipes: [CR], foods: [] };
const TARGET = { kcal: 1800, proteinLo: 150, proteinHi: 170, fatLo: 40, fatHi: 90, carbLo: 120, carbHi: 220 };

test("planDay: an offline/throwing selector degrades to {status:'unavailable'} — no crash", async () => {
  const proposeDayFn = async () => { throw new Error("ETIMEDOUT"); };
  const res = await planDay(
    { profile: {}, target: TARGET, mealConfig: { meals: 3, snacks: 0 }, library: LIBRARY },
    { enabled: true, depth: "fast", proposeDayFn }
  );
  assert.equal(res.status, "unavailable");
  assert.equal(res.reason, "offline");
});
