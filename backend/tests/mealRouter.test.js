const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __setClient } = require("../src/lib/brain/llm.js");
const {
  routeMealSlot, fitFor, makeRouterStats, cacheHitRate, MODEL_LADDER,
} = require("../src/lib/mealRouter.js");
const { makeSlotCache, slotFingerprint } = require("../src/lib/brain/slotCache.js");
const { makeBudget } = require("../src/lib/brain/userBudget.js");
const { memoryStore } = require("../src/lib/brain/ledger.js");
const { CAPS, USER_CAPS } = require("../src/lib/brain/config.js");

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4 — the library→brain router.
//
// NOTHING HERE TOUCHES THE NETWORK OR THE DATABASE.
//   • The Anthropic transport is replaced via the sanctioned __setClient seam,
//     so the ONLY way any code path can reach a model is through an object this
//     file owns and counts. "Zero model calls" is therefore asserted against the
//     CLIENT ITSELF — a recorded invocation list — not against a counter the
//     router maintains about itself.
//   • The ledger is an in-memory store; the real LlmUsage table is never
//     written or read.
//   • Every Food/Recipe row is a literal below; prisma is never queried
//     (loadFoodsImpl / persistRecipeImpl / resolveIngredientImpl are injected).
//   • ANTHROPIC_API_KEY is a placeholder string in every test. A test that arms
//     the gate does so precisely so that a wrong router would REACH the fake
//     client and fail loudly, instead of passing vacuously because governance
//     refused first.
// ─────────────────────────────────────────────────────────────────────────────

// ── fixtures ────────────────────────────────────────────────────────────────
const food = (id, name, m, over = {}) => ({ id, name, category: "other", kcal: m[0], protein: m[1], fat: m[2], carb: m[3], fiber: 0, ...over });

const CHICKEN = food("f-chicken", "Chicken breast", [165, 31, 3.6, 0]);
const RICE = food("f-rice", "White rice", [130, 2.7, 0.3, 28]);
// The whole point of the allergen test: a food whose NAME is innocent and whose
// DECLARED ALLERGENS are not. The name-only matcher cannot see this; the pool
// filter's metadata probes can.
const SUNSPREAD = food("f-sunspread", "SunSpread", [600, 25, 50, 20], { allergenTags: ["peanuts"] });
// The name-level case: resolution lands on a differently-named row that IS the
// allergen, even though the model wrote something else.
const PEANUT_BUTTER = food("f-pb", "Peanut butter", [588, 25, 50, 20]);
const ALL_FOODS = [CHICKEN, RICE, SUNSPREAD, PEANUT_BUTTER];

const ing = (f, grams, role, scalable = true) => ({ foodId: f.id, baseGrams: grams, scalable, role, food: f });

function recipe(id, name, ingredients, over = {}) {
  const t = ingredients.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name, slotType: "meal", mealCategory: null, source: "curated", steps: [], description: null, cuisine: null, prepTimeMin: 20, ingredients, ...t, ...over };
}

// Scales cleanly onto TARGET with both factors inside the 0.5–2 bounds.
const CHICKEN_RICE = recipe("r-chicken-rice", "Chicken & Rice", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")]);
// Cannot reach the target at any legal portion: 100g of rice maxes out at 2×.
const RICE_ONLY = recipe("r-rice", "Plain Rice Bowl", [ing(RICE, 100, "carb")]);

const TARGET = { slotType: "meal", kcalTarget: 600, proteinTarget: 50 };
const PROFILE = { userId: "u1", dietaryStyle: null, excludedFoods: [], cuisinePreferences: [], mealPreferencesNote: null };
const PEANUT_FREE = { ...PROFILE, excludedFoods: ["peanuts"] };

// ── environment ─────────────────────────────────────────────────────────────
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
  const out = fn();
  return out && typeof out.then === "function" ? out.finally(restore) : (restore(), out);
}

const ARMED = { ANTHROPIC_API_KEY: "test-key-not-used", BRAIN: undefined, AI_RECIPE_DRAFTS: "on" };
const BRAIN_OFF = { ANTHROPIC_API_KEY: "test-key-not-used", BRAIN: undefined, AI_RECIPE_DRAFTS: undefined };

// ── the fake transport ──────────────────────────────────────────────────────
// Installed through llm.__setClient, the same seam the brain's own tests use.
// `calls` is ground truth for "was a model reached".
function recordingClient(script = []) {
  const calls = [];
  const client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        const body = script[calls.length - 1] ?? { recipes: [] };
        return {
          content: [{ type: "text", text: JSON.stringify(body) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1200, output_tokens: 900 },
        };
      },
    },
  };
  return { client, calls };
}

// A transport that must NEVER run. Reaching it is a real spend in production.
function forbiddenClient() {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params) => {
          calls.push(params);
          throw new Error("THE MODEL TRANSPORT WAS REACHED — a control that was supposed to refuse pre-call did not");
        },
      },
    },
  };
}

function draft(over = {}) {
  return {
    name: "Grilled Chicken Bowl", description: "d", cuisine: "american", slotType: "meal",
    prepTimeMin: 20, servings: 1, steps: ["Grill the chicken.", "Serve over rice."],
    ingredients: [
      { name: "Chicken breast", grams: 150, role: "protein", scalable: true },
      { name: "White rice", grams: 150, role: "carb", scalable: true },
    ],
    ...over,
  };
}

// ── injected deps ───────────────────────────────────────────────────────────
function makeDeps({ pool, client, store = memoryStore(), userId = "u1", ladder, nameToFood = {} } = {}) {
  const persisted = [];
  let n = 0;
  const lookup = { "Chicken breast": CHICKEN, "White rice": RICE, ...nameToFood };
  const byId = new Map(ALL_FOODS.map((f) => [f.id, f]));

  return {
    persisted,
    store,
    deps: {
      cache: makeSlotCache(),
      stats: makeRouterStats(),
      budget: makeBudget({ store, userId }),
      ...(ladder ? { ladder } : {}),
      resolveIngredientImpl: async (name) => {
        const f = lookup[name];
        if (!f) return { food: { id: `ph-${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0 }, matched: "placeholder", status: "needs_review", needsReview: true };
        return { food: f, matched: "existing", status: "resolved", needsReview: false, confidence: 1 };
      },
      loadFoodsImpl: async (ids) => ids.map((id) => byId.get(id)).filter(Boolean),
      persistRecipeImpl: async (resolved, opts) => {
        const saved = {
          id: `gen-${++n}`, name: resolved.name, slotType: resolved.slotType || "meal", mealCategory: null,
          source: opts.source, tasteTier: opts.tasteTier ?? null, tasteTierSource: opts.tasteTierSource ?? null,
          steps: resolved.steps || [], description: resolved.description || null, cuisine: resolved.cuisine || null, prepTimeMin: resolved.prepTimeMin || null,
          kcal: resolved.kcal, protein: resolved.protein, fat: resolved.fat, carb: resolved.carb,
          ingredients: resolved.ingredients.map((i) => ({ foodId: i.foodId, baseGrams: i.grams, scalable: i.scalable !== false, role: i.role || null, food: byId.get(i.foodId) })),
        };
        persisted.push({ saved, opts });
        if (pool) pool.push(saved); // the library IS the cache — it grows
        return saved;
      },
    },
    install() { __setClient(client); },
  };
}

function uninstall() { __setClient(null); }

// ═══════════════════════════════════════════════════════════════════════════
// THE HARD INVARIANT — a library-solvable request costs nothing.
// ═══════════════════════════════════════════════════════════════════════════

test("library-first: a solvable slot invokes ZERO model calls — asserted on the injected client, not on a counter", async () => {
  await withEnv(ARMED, async () => {
    // The gate is ARMED on purpose. If the router asked for a generation it
    // would reach this client and throw — a passing test here means the router
    // never asked, not that governance saved it.
    const { client, calls } = forbiddenClient();
    const pool = [CHICKEN_RICE, RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);

      assert.equal(calls.length, 0, "the model transport was invoked for a slot the library could already fill");
      assert.equal(out.ok, true);
      assert.equal(out.status, "library-hit");
      assert.equal(out.recipe.id, CHICKEN_RICE.id);
      assert.equal(out.modelCalls, 0);
      assert.equal(h.store._rows.length, 0, "a free request must not write a usage row");
      assert.equal(h.persisted.length, 0, "a library hit must not write to the library");
      // The deterministic engine set the number, and it is on target.
      assert.ok(Math.abs(out.scaled.kcal - TARGET.kcalTarget) / TARGET.kcalTarget <= 0.15, `kcal ${out.scaled.kcal}`);
      assert.ok(out.scaled.protein >= TARGET.proteinTarget * 0.88, `protein ${out.scaled.protein}`);
    } finally { uninstall(); }
  });
});

test("library-first: the pool is built by the REAL filter — an excluded recipe is never served, even if it fits perfectly", async () => {
  await withEnv(ARMED, async () => {
    const { client, calls } = forbiddenClient();
    // A recipe that would fit the target beautifully but carries the allergen.
    const satay = recipe("r-satay", "Satay Chicken", [ing(CHICKEN, 150, "protein"), ing(PEANUT_BUTTER, 30, "fat", false), ing(RICE, 100, "carb")]);
    const pool = [satay];
    const h = makeDeps({ pool, client, ladder: [] }); // empty ladder = no generation attempt
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PEANUT_FREE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 0);
      assert.equal(out.ok, false);
      assert.equal(out.status, "unsolved", "an excluded recipe must not be offered even as a closest fit");
      assert.equal(out.recipe, null);
    } finally { uninstall(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A GENUINE GAP WITH THE BRAIN OFF — honest failure, no crash, no partial write.
// ═══════════════════════════════════════════════════════════════════════════

test("gap + BRAIN off: degrades to the deterministic closest fit with honest copy — never throws, never writes", async () => {
  await withEnv(BRAIN_OFF, async () => {
    const { client, calls } = forbiddenClient();
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);

      assert.equal(calls.length, 0, "a gated-off build must not reach the transport");
      assert.equal(out.ok, false);
      assert.equal(out.status, "closest-fit");
      assert.equal(out.reason, "llm-disabled");
      assert.match(out.notice, /switched off/i);
      assert.match(out.notice, /closest deterministic fit/i);
      assert.ok(out.scaled, "a closest fit must still carry engine-computed numbers");
      assert.equal(out.modelCalls, 0);
      assert.equal(h.persisted.length, 0, "no partial write");
      assert.equal(h.store._rows.length, 0, "no usage row");
    } finally { uninstall(); }
  });
});

test("gap + BRAIN off + nothing in the library: honest 'unsolved', not a crash and not a silent miss", async () => {
  await withEnv(BRAIN_OFF, async () => {
    const { client, calls } = forbiddenClient();
    const h = makeDeps({ pool: [], client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: [] }, h.deps);
      assert.equal(calls.length, 0);
      assert.equal(out.ok, false);
      assert.equal(out.status, "unsolved");
      assert.equal(out.recipe, null);
      assert.match(out.notice, /No compliant recipe in the library/i);
      assert.equal(h.persisted.length, 0);
    } finally { uninstall(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COST GOVERNANCE — refused BEFORE the call, degraded gracefully.
// ═══════════════════════════════════════════════════════════════════════════

test("cost cap: an exhausted GLOBAL daily budget refuses BEFORE the call — the transport is never reached", async () => {
  await withEnv(ARMED, async () => {
    const { client, calls } = forbiddenClient();
    const store = memoryStore();
    await store.add({ costUsd: CAPS.dailyUsd + 1, at: new Date(), userId: "someone-else" });
    const rowsBefore = store._rows.length;

    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client, store });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);

      assert.equal(calls.length, 0, "a capped request reached the model — the cap is post-call, which is not a cap");
      assert.equal(out.ok, false);
      assert.equal(out.status, "closest-fit");
      assert.equal(out.reason, "cost-cap");
      assert.equal(out.attempts[0].outcome, "cost-cap");
      assert.equal(out.modelCalls, 0);
      assert.match(out.notice, /cap|budget/i);
      assert.equal(store._rows.length, rowsBefore, "a refused request must not be recorded — there was no spend to record");
      assert.equal(h.persisted.length, 0);
    } finally { uninstall(); }
  });
});

test("cost cap: a PER-USER budget binds even when the global budget has plenty left", async () => {
  await withEnv(ARMED, async () => {
    const { client, calls } = forbiddenClient();
    const store = memoryStore();
    // Over this user's daily cap, comfortably under the global one.
    await store.add({ costUsd: USER_CAPS.dailyUsd + 0.01, at: new Date(), userId: "u1" });
    assert.ok(USER_CAPS.dailyUsd + 0.01 < CAPS.dailyUsd, "fixture assumes the global cap still has headroom");

    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client, store, userId: "u1" });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 0);
      assert.equal(out.reason, "cost-cap");
      assert.match(out.attempts[0].reason, /^user-/, `expected a per-user denial, got ${out.attempts[0].reason}`);
      assert.match(out.notice, /this account/i, "the copy must say WHOSE budget ran out");
    } finally { uninstall(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY-THEN-GATE — the AI proposed; the code decides.
// ═══════════════════════════════════════════════════════════════════════════

test("allergy: an AI recipe is DISCARDED when its RESOLVED food declares the allergen — even though every name the model wrote is clean", async () => {
  await withEnv(ARMED, async () => {
    // "SunSpread" trips nothing by name. The Food row it resolves to declares
    // peanuts in allergenTags. This is the audit finding: screening only the
    // names the MODEL wrote makes ingredient resolution an allergen-erasure path.
    const sneaky = draft({
      name: "Protein Power Bowl",
      ingredients: [
        { name: "SunSpread", grams: 30, role: "fat", scalable: false },
        { name: "Chicken breast", grams: 150, role: "protein", scalable: true },
        { name: "White rice", grams: 150, role: "carb", scalable: true },
      ],
    });
    const { client, calls } = recordingClient([{ recipes: [sneaky] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client, ladder: [MODEL_LADDER[0]], nameToFood: { SunSpread: SUNSPREAD } });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PEANUT_FREE, recipePool: pool }, h.deps);

      assert.equal(calls.length, 1, "the model was asked exactly once");
      assert.equal(h.persisted.length, 0, "an allergen-violating recipe must NEVER reach the library");
      assert.equal(out.ok, false);
      assert.equal(out.reason, "verification-failed");
      const reasons = out.attempts[0].reasons.join(" ");
      assert.match(reasons, /pool filter/i, `expected the pool-filter screen to be the one that caught it, got: ${reasons}`);
      assert.equal(out.stats.discarded, 1);
      // And the user still gets something honest rather than an error.
      assert.equal(out.status, "closest-fit");
      assert.match(out.notice, /safety and macro checks/i);
    } finally { uninstall(); }
  });
});

test("allergy: an AI recipe is DISCARDED when resolution lands on a differently-NAMED allergen row", async () => {
  await withEnv(ARMED, async () => {
    // The model wrote "Nut-Free Spread"; the resolver matched "Peanut butter".
    const sneaky = draft({
      name: "Satay-Style Bowl",
      ingredients: [
        { name: "Nut-Free Spread", grams: 30, role: "fat", scalable: false },
        { name: "Chicken breast", grams: 150, role: "protein", scalable: true },
        { name: "White rice", grams: 150, role: "carb", scalable: true },
      ],
    });
    const { client, calls } = recordingClient([{ recipes: [sneaky] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client, ladder: [MODEL_LADDER[0]], nameToFood: { "Nut-Free Spread": PEANUT_BUTTER } });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PEANUT_FREE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 1);
      assert.equal(h.persisted.length, 0);
      assert.equal(out.ok, false);
      assert.match(out.attempts[0].reasons.join(" "), /after ingredient resolution/i);
    } finally { uninstall(); }
  });
});

test("macro math: a safe AI recipe that cannot reach the slot target is discarded, not shipped off-target", async () => {
  await withEnv(ARMED, async () => {
    // Rice only: no legal portion reaches 600 kcal / 50g protein.
    const thin = draft({ name: "Rice Cup", ingredients: [{ name: "White rice", grams: 100, role: "carb", scalable: true }] });
    const { client, calls } = recordingClient([{ recipes: [thin] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client, ladder: [MODEL_LADDER[0]] });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 1);
      assert.equal(h.persisted.length, 0, "an off-target recipe must not be cached as a solution");
      assert.equal(out.ok, false);
      assert.match(out.attempts[0].reasons.join(" "), /protein|kcal/i);
    } finally { uninstall(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE FOREVER — one generation, then free.
// ═══════════════════════════════════════════════════════════════════════════

test("cache round-trip: the same constrained request twice = 1 generation + 1 free hit", async () => {
  await withEnv(ARMED, async () => {
    const { client, calls } = recordingClient([{ recipes: [draft()] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const first = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(first.ok, true, `first request failed: ${first.notice}`);
      assert.equal(first.status, "generated");
      assert.equal(calls.length, 1);
      assert.equal(h.persisted.length, 1);
      assert.equal(h.persisted[0].opts.source, "ai-generated", "an AI recipe may never be filed as curated");
      assert.equal(h.persisted[0].opts.tasteTierSource, "llm", "the taste prior must be labelled as model-sourced");
      assert.ok(first.provenance.verified, "a persisted AI recipe must carry its verification provenance");
      assert.deepEqual(first.provenance.verifiedBy, ["post-resolution-names", "pool-filter", "placeholder-audit", "macro-math"]);
      assert.equal(h.store._rows.length, 1, "the generation must be on the ledger");

      const second = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 1, "the second identical request cost a model call — the cache did nothing");
      assert.equal(second.ok, true);
      assert.equal(second.status, "cache-hit");
      assert.equal(second.via, "index", "the fingerprint index should serve it, not a rescan");
      assert.equal(second.recipe.id, first.recipe.id);
      assert.equal(second.modelCalls, 0);
      assert.equal(h.persisted.length, 1, "a cache hit must not re-persist");
      assert.equal(h.store._rows.length, 1, "a cache hit must not add usage");

      assert.equal(second.stats.generations, 1);
      assert.equal(second.stats.cacheHits, 1);
      assert.equal(second.stats.cacheHitRate, 0.5, "1 hit / (1 hit + 1 generation)");
    } finally { uninstall(); }
  });
});

test("cache: an indexed recipe that no longer survives the pool filter is EVICTED, never served", async () => {
  await withEnv(BRAIN_OFF, async () => {
    const { client } = forbiddenClient();
    const h = makeDeps({ pool: [], client });
    const fp = slotFingerprint({ slotType: "meal", kcalTarget: TARGET.kcalTarget, proteinTarget: TARGET.proteinTarget, dietaryStyle: null, excludedFoods: [] });
    h.deps.cache.remember(fp, "r-vanished");
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: [] }, h.deps);
      assert.equal(out.status, "unsolved");
      assert.deepEqual(h.deps.cache.get(fp), [], "a stale id must be dropped from the index, not retried forever");
    } finally { uninstall(); }
  });
});

test("cache: a DIFFERENT constraint set is a different fingerprint — an allergy change can never hit another user's entry", () => {
  const base = { slotType: "meal", kcalTarget: 600, proteinTarget: 50, dietaryStyle: null, excludedFoods: [] };
  const fp = slotFingerprint(base);
  assert.notEqual(fp, slotFingerprint({ ...base, excludedFoods: ["peanuts"] }));
  assert.notEqual(fp, slotFingerprint({ ...base, dietaryStyle: "vegan" }));
  assert.notEqual(fp, slotFingerprint({ ...base, slotType: "snack" }));
  assert.notEqual(slotFingerprint({ ...base, excludedFoods: ["peanuts"] }), slotFingerprint({ ...base, excludedFoods: ["peanuts", "dairy"] }));
  // …but formatting is not identity.
  assert.equal(slotFingerprint({ ...base, excludedFoods: ["Peanuts", " dairy"] }), slotFingerprint({ ...base, excludedFoods: ["dairy", "peanuts"] }));
  assert.equal(fp, slotFingerprint({ ...base, dietaryStyle: "none" }), "'none' and null are the same statement");
});

// ═══════════════════════════════════════════════════════════════════════════
// TIERED MODELS — cheapest first, escalate only after a real failure.
// ═══════════════════════════════════════════════════════════════════════════

test("tiering: a first-try success never escalates — the expensive model is not touched", async () => {
  await withEnv(ARMED, async () => {
    const { client, calls } = recordingClient([{ recipes: [draft()] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(out.status, "generated");
      assert.equal(calls.length, 1, "one call, one tier");
      assert.equal(calls[0].model, MODEL_LADDER[0], "the cheapest capable tier must be tried first");
      assert.equal(out.attempts.length, 1);
      assert.equal(out.attempts[0].model, MODEL_LADDER[0]);
    } finally { uninstall(); }
  });
});

test("tiering: escalation happens ONLY after the cheaper tier was tried and failed", async () => {
  await withEnv(ARMED, async () => {
    // Tier 0 returns something unusable; tier 1 returns a good recipe.
    const bad = draft({ name: "Rice Cup", ingredients: [{ name: "White rice", grams: 100, role: "carb", scalable: true }] });
    const { client, calls } = recordingClient([{ recipes: [bad] }, { recipes: [draft()] }]);
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);

      assert.equal(calls.length, 2);
      assert.equal(calls[0].model, MODEL_LADDER[0]);
      assert.equal(calls[1].model, MODEL_LADDER[1], "the escalation tier must be the second call, not the first");
      assert.equal(out.attempts[0].outcome, "verification-failed", "the escalation must be justified by a recorded prior failure");
      assert.equal(out.attempts[1].outcome, "generated");
      assert.equal(out.status, "generated");
    } finally { uninstall(); }
  });
});

test("tiering: a TERMINAL refusal stops the ladder — the app never pays a second time for a decided no", async () => {
  await withEnv(BRAIN_OFF, async () => {
    const { client, calls } = forbiddenClient();
    const pool = [RICE_ONLY];
    const h = makeDeps({ pool, client });
    h.install();
    try {
      const out = await routeMealSlot({ target: TARGET, profile: PROFILE, recipePool: pool }, h.deps);
      assert.equal(calls.length, 0);
      assert.equal(out.attempts.length, 1, "a switched-off feature must not be re-asked on a pricier model");
      assert.equal(out.attempts[0].outcome, "llm-disabled");
    } finally { uninstall(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The metric, and the engine's ownership of the numbers.
// ═══════════════════════════════════════════════════════════════════════════

test("stats: cacheHitRate is null with no data — an empty denominator is never reported as 0%", () => {
  const s = makeRouterStats();
  assert.equal(cacheHitRate(s), null);
  s.generations = 3;
  assert.equal(cacheHitRate(s), 0);
  s.cacheHits = 1;
  assert.equal(cacheHitRate(s), 0.25);
});

test("fitFor: the accept gate is the solver's, and every number it returns is recomputed from grams", () => {
  const fit = fitFor(CHICKEN_RICE, TARGET);
  assert.equal(fit.ok, true);
  const recomputed = fit.scaled.ingredients.reduce((s, r) => {
    const f = ALL_FOODS.find((x) => x.id === r.foodId);
    return s + f.kcal * (r.grams / 100);
  }, 0);
  assert.ok(Math.abs(recomputed - fit.scaled.kcal) < 0.01, "the reported kcal must be the sum of the shipped grams, not a model claim");
  assert.ok(fit.scaled.proteinScale >= 0.5 && fit.scaled.proteinScale <= 2);
  assert.ok(fit.scaled.sidesScale >= 0.5 && fit.scaled.sidesScale <= 2);
});
