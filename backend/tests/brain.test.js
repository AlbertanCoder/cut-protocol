const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reviseDayWithCritic } = require("../src/lib/brain/index.js");
const { isBrainEnabled } = require("../src/lib/brain/llm.js");
const { normalize: normalizeCritic } = require("../src/lib/brain/critic.js");

// Pure tests: NO Prisma, NO network. The critic is injected as a fake and the
// gate is driven explicitly, so nothing here ever touches the Anthropic SDK.
// These lock the two load-bearing guarantees: (1) with the brain on, the loop
// applies the critic's constraints and keeps the better day; (2) with the brain
// off, ZERO LLM calls happen and the deterministic day is returned unchanged.

// A day is just an array of slots; we carry its intended score on a private
// field so the injected scoreDay is trivial and deterministic.
function day(matchPct, tag) {
  const slots = [{ recipeId: tag, warning: null }];
  slots._score = matchPct;
  return slots;
}
const scoreDay = (slots) => ({ matchPct: slots._score, totals: { kcal: 0, protein: 0, carb: 0, fat: 0 } });

// Fake deterministic solver: unconstrained call returns `base`, a constrained
// (re-solve) call returns `revised`. Records every constraints arg it saw.
function makeSolver({ base, revised }) {
  const calls = [];
  return {
    calls,
    solve: async (constraints) => {
      calls.push(constraints);
      return { slots: constraints ? revised : base };
    },
  };
}

test("brain ON: applies the critic's constraints and keeps the better re-solved day", async () => {
  const base = day(50, "base");
  const revised = day(85, "revised");
  const solver = makeSolver({ base, revised });
  let reviewCalls = 0;
  const fakeCritic = async () => {
    reviewCalls++;
    return { ok: false, issues: [{ slotRef: "meal:0", problem: "protein short" }], constraints: { excludeRecipeIds: ["x"], minProteinBoost: 0.1 } };
  };

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: fakeCritic, enabled: true, roughMatch: 70,
  });

  assert.equal(reviewCalls, 1, "the rough day was reviewed exactly once");
  assert.equal(solver.calls.length, 2, "exactly one deterministic solve + one re-solve (cap respected)");
  assert.equal(solver.calls[0], null, "first solve is unconstrained");
  assert.deepEqual(solver.calls[1], { excludeRecipeIds: ["x"], minProteinBoost: 0.1 }, "the re-solve receives the critic's constraints verbatim");
  assert.equal(out.revised, true);
  assert.equal(out.slots, revised, "kept the better-scoring revised day");
  assert.equal(out.score.matchPct, 85);
});

test("brain ON: keeps the deterministic day when the re-solve scores no better", async () => {
  const base = day(60, "base");
  const worse = day(40, "worse");
  const solver = makeSolver({ base, revised: worse });
  const fakeCritic = async () => ({ ok: false, issues: [{ slotRef: "meal:0", problem: "monotony" }], constraints: { excludeRecipeIds: ["y"] } });

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: fakeCritic, enabled: true, roughMatch: 70,
  });

  assert.equal(solver.calls.length, 2, "still attempted exactly one re-solve");
  assert.equal(out.revised, false);
  assert.equal(out.slots, base, "kept the better (deterministic) day");
  assert.equal(out.score.matchPct, 60);
});

test("brain OFF: ZERO LLM/critic calls, deterministic result returned unchanged", async () => {
  const base = day(30, "base"); // deliberately rough — but the brain is off
  const revised = day(99, "revised");
  const solver = makeSolver({ base, revised });
  let reviewCalls = 0;
  const countingCritic = async () => {
    reviewCalls++;
    return { ok: false, issues: [{ slotRef: "meal:0", problem: "x" }], constraints: {} };
  };

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: countingCritic, enabled: false, roughMatch: 70,
  });

  assert.equal(reviewCalls, 0, "no critic/LLM call when the brain is off");
  assert.equal(solver.calls.length, 1, "only the single deterministic solve ran");
  assert.equal(out.revised, false);
  assert.equal(out.slots, base, "the deterministic day is returned byte-for-byte unchanged");
});

test("brain ON but the day is already good: no critic call, no re-solve", async () => {
  const base = day(95, "base");
  const solver = makeSolver({ base, revised: day(99, "revised") });
  let reviewCalls = 0;
  const countingCritic = async () => { reviewCalls++; return { ok: false, issues: [{ slotRef: "s", problem: "p" }] }; };

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: countingCritic, enabled: true, roughMatch: 70,
  });

  assert.equal(reviewCalls, 0, "a good day is never sent to the critic (saves an LLM call)");
  assert.equal(solver.calls.length, 1);
  assert.equal(out.slots, base);
});

test("brain ON, critic says ok: deterministic day kept, no re-solve", async () => {
  const base = day(50, "base");
  const solver = makeSolver({ base, revised: day(90, "revised") });
  let reviewCalls = 0;
  const okCritic = async () => { reviewCalls++; return { ok: true, issues: [] }; };

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: okCritic, enabled: true, roughMatch: 70,
  });

  assert.equal(reviewCalls, 1, "the rough day was reviewed");
  assert.equal(solver.calls.length, 1, "an ok verdict means no re-solve");
  assert.equal(out.slots, base);
  assert.equal(out.revised, false);
});

test("brain ON, a throwing critic degrades to the deterministic day", async () => {
  const base = day(50, "base");
  const solver = makeSolver({ base, revised: day(90, "revised") });
  const throwingCritic = async () => { throw new Error("network/timeout"); };

  const out = await reviseDayWithCritic({
    solve: solver.solve, scoreDay, targets: {}, profile: {}, reviewDay: throwingCritic, enabled: true, roughMatch: 70,
  });

  assert.equal(solver.calls.length, 1, "no re-solve after a critic failure");
  assert.equal(out.revised, false);
  assert.equal(out.slots, base, "any brain-path error is a no-op == current behaviour");
});

test("isBrainEnabled: explicit opt-in — needs a key AND BRAIN=on", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  const flag = process.env.BRAIN;
  try {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.BRAIN;
    assert.equal(isBrainEnabled(), false, "key present but no BRAIN=on => disabled (opt-in default off)");

    process.env.BRAIN = "off";
    assert.equal(isBrainEnabled(), false, "BRAIN=off disables even with a key present");

    delete process.env.ANTHROPIC_API_KEY;
    process.env.BRAIN = "on";
    assert.equal(isBrainEnabled(), false, "no key => disabled regardless of BRAIN");

    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.BRAIN = "on";
    assert.equal(isBrainEnabled(), true, "key present + BRAIN=on => enabled");
  } finally {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key;
    if (flag === undefined) delete process.env.BRAIN; else process.env.BRAIN = flag;
  }
});

test("critic.normalize: coerces junk to the safe shape and never lets the LLM set macros", () => {
  // The model tries to smuggle a macro number + an out-of-range boost + junk ids.
  const raw = {
    ok: false,
    issues: [{ slotRef: "meal:0", problem: "same protein all day" }, { nope: 1 }],
    constraints: { excludeRecipeIds: ["a", 5, null, "b"], minProteinBoost: 9, kcal: 1234, proteinTarget: 200 },
  };
  const n = normalizeCritic(raw);
  assert.equal(n.ok, false);
  assert.deepEqual(n.issues, [{ slotRef: "meal:0", problem: "same protein all day" }], "malformed issues dropped");
  assert.deepEqual(n.constraints.excludeRecipeIds, ["a", "b"], "only string ids survive");
  assert.equal(n.constraints.minProteinBoost, 0.5, "protein boost clamped to <= 0.5");
  assert.equal("kcal" in n.constraints, false, "no macro fields ever leak through");
  assert.equal("proteinTarget" in n.constraints, false, "the LLM cannot set a macro target");

  const empty = normalizeCritic({ ok: true, issues: [] });
  assert.deepEqual(empty, { ok: true, issues: [], constraints: {} }, "a clean day normalizes to an empty no-op");
});
