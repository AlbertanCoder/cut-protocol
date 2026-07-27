// M3 — THE CLOCK. Regression lock for the S2 defect in autopsy-20260727-0126.
//
// A COUNT of calls is not a bound on TIME. routes/plans.js budgeted up to 12
// designs; at the transport's 90s draft timeout that is 18 minutes, against a
// client that hung up at 45s. The user got a spinner that resolved into neither
// a plan nor an error.
//
// THE RULE THESE TESTS PIN: the server always answers before the client hangs
// up. The brain pass gets a hard wall-clock budget, a design is only STARTED
// when the remaining budget covers a whole one, and slots the clock leaves
// behind are REPORTED, never silently dropped.
//
// No DB, no network, no model — the router is injected through the documented
// aiFallback.routeMealSlotImpl seam and the transport through `ask`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fillGapsWithBrain } = require("../../src/lib/weeklyPlanner.js");
const { generateRecipeDrafts } = require("../../src/lib/aiRecipeClient.js");
const { DRAFT_TIMEOUT_MS } = require("../../src/lib/brain/llm.js");
const { makeLedger, memoryStore } = require("../../src/lib/brain/ledger.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const designed = (id) => ({ ...flexible(id), source: "brain", verified: true });

const DAILY = { kcal: 2000, proteinLo: 150, proteinHi: 180 };
const CONFIG = { meals: 3, snacks: 0 };

// Three empty slots on day 0 — three chances for the brain to spend time.
const threeGaps = () => [
  { dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: "nothing eligible" },
  { dayOfWeek: 0, slotType: "meal", slotIndex: 1, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: "nothing eligible" },
  { dayOfWeek: 0, slotType: "meal", slotIndex: 2, recipeId: null, kcal: 0, protein: 0, fat: 0, carb: 0, warning: "nothing eligible" },
];

test("M3: a SLOW brain cannot run the pass past its wall-clock budget", async () => {
  // budget 100ms, each design bounded at 60ms, and the injected router takes
  // 70ms. After design #1 the clock reads ~70ms and 70 + 60 > 100, so design #2
  // is never STARTED. That is the whole guarantee.
  let started = 0;
  const t0 = Date.now();
  const out = await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      budgetMs: 100, slotTimeoutMs: 60, now: () => Date.now(),
      routeMealSlotImpl: async () => {
        started++;
        await sleep(70);
        return { ok: true, recipe: designed(`b${started}`), scaled: null };
      },
    },
  });
  const elapsed = Date.now() - t0;

  assert.equal(started, 1, `the pass started ${started} designs; the budget only had room for 1`);
  assert.equal(out.attempted, 1);
  assert.ok(out.stoppedForTime > 0, "slots left behind by the clock must be COUNTED, not silently dropped");
  assert.ok(elapsed < 400, `the pass took ${elapsed}ms — a bounded pass must not run on`);
});

test("M3: the pass reports the slots the clock left behind, and they keep their warnings", async () => {
  const out = await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      budgetMs: 100, slotTimeoutMs: 60, now: () => Date.now(),
      routeMealSlotImpl: async () => { await sleep(70); return { ok: true, recipe: designed("b1"), scaled: null }; },
    },
  });
  assert.equal(out.stoppedForTime, 2, "two of the three gaps were never attempted");
  const untouched = out.slots.filter((s) => !s.recipeId);
  assert.equal(untouched.length, 2);
  for (const s of untouched) {
    assert.ok(s.warning, "a slot the clock skipped must still carry its honest warning into the diagnosis");
  }
});

test("M3: with NO budget the pass is unbounded exactly as before — the legacy swap path is untouched", async () => {
  let started = 0;
  const out = await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      // no budgetMs, no slotTimeoutMs — the shape every pre-M3 caller passes
      routeMealSlotImpl: async () => { started++; await sleep(20); return { ok: true, recipe: designed(`b${started}`), scaled: null }; },
    },
  });
  assert.equal(started, 3, "an absent budget must impose no deadline");
  assert.equal(out.stoppedForTime, 0);
  assert.equal(out.filled, 3);
});

test("M3: a fast library-only pass is unaffected by the clock", async () => {
  const t0 = Date.now();
  const out = await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      budgetMs: 75000, slotTimeoutMs: 35000, now: () => Date.now(),
      // Instant router — the library/cache hit case, which costs no time at all.
      routeMealSlotImpl: async () => ({ ok: true, recipe: designed("fast"), scaled: null }),
    },
  });
  assert.equal(out.attempted, 3, "every gap is still attempted when there is time to spare");
  assert.equal(out.stoppedForTime, 0);
  assert.ok(Date.now() - t0 < 1000);
});

test("M3: the per-design bound is handed to the router on every request", async () => {
  const seen = [];
  await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      budgetMs: 75000, slotTimeoutMs: 35000, now: () => Date.now(),
      routeMealSlotImpl: async (req) => { seen.push(req.timeoutMs); return { ok: true, recipe: designed("x"), scaled: null }; },
    },
  });
  assert.equal(seen.length, 3);
  for (const t of seen) assert.equal(t, 35000, "the router must receive the caller's per-design bound");
});

test("M3: the clock is INJECTED — a budget with no clock arms no deadline, and the solver stays pure", async () => {
  // This is not a curiosity. mealSolver.js and weeklyPlanner.js are held to the
  // solver-path purity invariant (tests/qc/invariants.test.js "1C purity": no
  // Math.random / Date.now / new Date), because a solver that reads an ambient
  // clock is not reproducible and the byte-identical goldens stop meaning
  // anything. So the deadline needs a caller-supplied `now`; without one there
  // is no deadline at all, and the pass behaves exactly as an unbudgeted one.
  let started = 0;
  const out = await fillGapsWithBrain(threeGaps(), {
    dailyTarget: DAILY, mealConfig: CONFIG, recipePool: [flexible("f1")],
    aiFallback: {
      enabled: true, maxCalls: 10, profile: { dietaryStyle: null },
      budgetMs: 1, slotTimeoutMs: 60, // a budget so small it would stop everything…
      // …but NO `now`, so nothing is armed.
      routeMealSlotImpl: async () => { started++; await sleep(20); return { ok: true, recipe: designed(`b${started}`), scaled: null }; },
    },
  });
  assert.equal(started, 3, "with no injected clock the deadline must not engage");
  assert.equal(out.stoppedForTime, 0);

  const fs = require("node:fs");
  const path = require("node:path");
  for (const f of ["mealSolver.js", "weeklyPlanner.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", f), "utf8");
    assert.ok(
      !/Math\.random\(|Date\.now\(|new Date\(/.test(src),
      `${f} reads an ambient clock or RNG — the wall clock must be injected, never read here`
    );
  }
});

// ── the transport end of the same leash ─────────────────────────────────────

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return Promise.resolve(fn()).finally(restore);
}
const ARMED = { ANTHROPIC_API_KEY: "test-key-not-used", BRAIN: "on", BRAIN_RELAY_URL: undefined, BRAIN_RELAY_TOKEN: undefined };
const DRAFT = {
  name: "Bowl", description: "d", cuisine: "american", slotType: "meal",
  prepTimeMin: 10, servings: 1, steps: ["Cook."],
  ingredients: [{ name: "Chicken breast", grams: 180, role: "protein", scalable: true }],
};

function captureAsk() {
  const seen = [];
  const impl = async (params) => {
    seen.push(params.timeoutMs);
    return { data: { recipes: [DRAFT] }, text: JSON.stringify({ recipes: [DRAFT] }), usage: { input_tokens: 10, output_tokens: 10 } };
  };
  impl.seen = seen;
  return impl;
}

test("M3: generateRecipeDrafts honours a caller's shorter deadline", async () => {
  await withEnv(ARMED, async () => {
    const ask = captureAsk();
    await generateRecipeDrafts(
      { slotType: "meal", targetKcal: 600, targetProtein: 50, existingRecipeNames: [], timeoutMs: 35000 },
      { ask, ledger: makeLedger({ store: memoryStore() }) }
    );
    assert.deepEqual(ask.seen, [35000]);
  });
});

test("M3: a caller may SHORTEN the transport's leash but never lengthen it", async () => {
  await withEnv(ARMED, async () => {
    const ask = captureAsk();
    await generateRecipeDrafts(
      { slotType: "meal", targetKcal: 600, targetProtein: 50, existingRecipeNames: [], timeoutMs: DRAFT_TIMEOUT_MS * 10 },
      { ask, ledger: makeLedger({ store: memoryStore() }) }
    );
    assert.deepEqual(ask.seen, [DRAFT_TIMEOUT_MS], "an over-long request must clamp to the module's own hard bound");
  });
});

test("M3: with no caller deadline the drafting route keeps its own default — /generate-drafts is unchanged", async () => {
  await withEnv(ARMED, async () => {
    const ask = captureAsk();
    await generateRecipeDrafts(
      { slotType: "meal", targetKcal: 600, targetProtein: 50, existingRecipeNames: [] },
      { ask, ledger: makeLedger({ store: memoryStore() }) }
    );
    assert.deepEqual(ask.seen, [DRAFT_TIMEOUT_MS]);
  });
});
