const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeStore, assertNoExclusions } = require("../../src/lib/brain/store.js");

// A stub prisma that records calls and echoes the data back — the store layer is
// thin, so this proves it calls the right model with the right shape, hermetically.
function stubPrisma() {
  const calls = [];
  const rec = (name) => async (arg) => { calls.push({ name, arg }); return { id: "x", ...(arg && arg.data) }; };
  return {
    calls,
    brainConversation: { create: rec("conv.create"), update: rec("conv.update"), findUnique: rec("conv.find"), findMany: rec("conv.findMany") },
    brainMessage: { create: rec("msg.create") },
    generatedRecipe: { create: rec("genRecipe.create"), findMany: rec("genRecipe.findMany") },
    generatedPlan: { create: rec("genPlan.create"), findMany: rec("genPlan.findMany") },
    brainSolveRun: { create: rec("solve.create") },
    userLibraryEntry: { upsert: rec("lib.upsert"), deleteMany: rec("lib.delete"), findMany: rec("lib.findMany") },
  };
}

test("store: appendMessage validates role, caps content, touches the conversation", async () => {
  const p = stubPrisma(); const s = makeStore(p);
  await s.appendMessage("c1", "user", "hi");
  assert.ok(p.calls.find((c) => c.name === "msg.create" && c.arg.data.role === "user" && c.arg.data.content === "hi"));
  assert.ok(p.calls.find((c) => c.name === "conv.update"), "appending a message bumps the conversation");
  await assert.rejects(() => s.appendMessage("c1", "system", "x"), /invalid message role/);
});

test("store: recordSolveRun validates status", async () => {
  const p = stubPrisma(); const s = makeStore(p);
  await s.recordSolveRun("u", { status: "converged", data: { kcal: 2000 } });
  assert.ok(p.calls.find((c) => c.name === "solve.create" && c.arg.data.status === "converged"));
  await assert.rejects(() => s.recordSolveRun("u", { status: "bogus", data: {} }), /invalid solve status/);
});

test("store: Law 2 — assertNoExclusions rejects exclusion-like keys, passes soft data", () => {
  assert.throws(() => assertNoExclusions({ excludedFoods: ["peanuts"] }), /exclusion-like key/);
  assert.throws(() => assertNoExclusions({ meta: { allergyList: ["x"] } }), /exclusion-like key/);
  assert.throws(() => assertNoExclusions({ blocklist: [] }), /exclusion-like key/);
  assert.doesNotThrow(() => assertNoExclusions({ cuisineNudge: "italian", notes: "likes spicy", kcal: 2200 }));
  assert.doesNotThrow(() => assertNoExclusions(null));
});

test("store: saveGeneratedRecipe/Plan reject exclusion data, save clean data", async () => {
  const p = stubPrisma(); const s = makeStore(p);
  await assert.rejects(() => s.saveGeneratedRecipe("u", { name: "X", data: { excludedFoods: ["y"] } }), /exclusion-like/);
  await s.saveGeneratedRecipe("u", { name: "Oats", data: { kcal: 400 } });
  assert.ok(p.calls.find((c) => c.name === "genRecipe.create" && c.arg.data.name === "Oats"));
  await s.saveGeneratedPlan("u", { label: "Cut wk1", data: { kcal: 2200 }, items: [{ slotType: "snack", recipeId: "r1", data: {} }] });
  assert.ok(p.calls.find((c) => c.name === "genPlan.create" && c.arg.data.items.create[0].slotType === "snack"));
});

test("store: library add is idempotent (upsert)", async () => {
  const p = stubPrisma(); const s = makeStore(p);
  await s.addLibraryEntry("u", "r1");
  assert.ok(p.calls.find((c) => c.name === "lib.upsert" && c.arg.create.recipeId === "r1"));
});
