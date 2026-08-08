const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  solveRecipeForSlot, fillDayGaps, solveDayWithGapFill, routeSlotCompat, makeStats,
} = require("../../src/lib/recipeBrain/orchestrator.js");
const { buildSpec, specFingerprint } = require("../../src/lib/recipeBrain/spec.js");
const { makeSlotCache } = require("../../src/lib/brain/slotCache.js");
const { makeBudget } = require("../../src/lib/brain/userBudget.js");
const { memoryStore } = require("../../src/lib/brain/ledger.js");

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE BRAIN — the orchestrator. NOTHING HERE TOUCHES NETWORK OR DB:
//   • generation is an injected recorder (aiDeps.generateDraftsImpl) with an
//     in-memory budget — a wrong orchestrator REACHES it and fails loudly;
//   • the durable cache is an injected lookup; persistence is a recorder;
//   • ingredient resolution and food loads are literal maps;
//   • the web channel gets a fixture site with injected fetch/import.
// The claims: channel order and economics (free before paid, pay once), the
// shared verify gate on every proposal, wall enforcement, matrix honesty, and
// the solver-loop composition (fillDayGaps / solveDayWithGapFill).
// ─────────────────────────────────────────────────────────────────────────────

// ── fixtures ────────────────────────────────────────────────────────────────
const food = (id, name, m, over = {}) => ({ id, name, category: "other", kcal: m[0], protein: m[1], fat: m[2], carb: m[3], fiber: 0, ...over });
const CHICKEN = food("f-chicken", "Chicken breast", [165, 31, 3.6, 0]);
const RICE = food("f-rice", "White rice", [130, 2.7, 0.3, 28]);
const PEANUT_BUTTER = food("f-pb", "Peanut butter", [588, 25, 50, 20]);
const FOODS = { [CHICKEN.name]: CHICKEN, [RICE.name]: RICE, [PEANUT_BUTTER.name]: PEANUT_BUTTER };
const ALL_FOODS = [CHICKEN, RICE, PEANUT_BUTTER];

const ing = (f, grams, role, scalable = true) => ({ foodId: f.id, baseGrams: grams, scalable, role, food: f });
function recipe(id, name, ings, over = {}) {
  const t = ings.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name, slotType: "meal", mealCategory: null, source: "curated", steps: ["Cook."], description: null, cuisine: null, prepTimeMin: 20, ingredients: ings, ...t, ...over };
}

const CHICKEN_RICE = recipe("r-chicken-rice", "Chicken & Rice", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")]);
const CHICKEN_ONLY = recipe("r-chicken-only", "Plain Chicken", [ing(CHICKEN, 100, "protein")]); // dense, but can't reach the slot
const RICE_ONLY = recipe("r-rice", "Plain Rice Bowl", [ing(RICE, 100, "carb")]); // structurally protein-thin
const PB_TOAST = recipe("r-pb", "PB Power Bowl", [ing(PEANUT_BUTTER, 60, "protein"), ing(RICE, 120, "carb")]);

const DAY = { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210, keto: false };
const TARGET = { slotType: "meal", kcalTarget: 620, proteinTarget: 45 };
const PROFILE = { userId: "u1", dietaryStyle: null, excludedFoods: ["peanuts"], mealsPerDay: 3, snacksPerDay: 0 };

const AI_DRAFT = {
  name: "Grilled Chicken Rice Plate", description: "Lean and simple.", cuisine: "western-comfort",
  slotType: "meal", prepTimeMin: 20, servings: 1, steps: ["Grill chicken.", "Serve over rice."],
  ingredients: [
    { name: "Chicken breast", grams: 150, role: "protein", scalable: true },
    { name: "White rice", grams: 150, role: "carb", scalable: true },
  ],
  tasteTier: "decent",
};
const PB_DRAFT = { ...AI_DRAFT, name: "Peanut Rice Bowl", ingredients: [{ name: "Peanut butter", grams: 60, role: "protein", scalable: true }, { name: "White rice", grams: 150, role: "carb", scalable: true }] };

// ── shared deps builder ─────────────────────────────────────────────────────
function makeDeps({ drafts = [AI_DRAFT], durableRows = [], registry = null, fetchTextImpl, importImpl } = {}) {
  const rec = { generateCalls: [], persisted: [], durableLookups: [] };
  const store = memoryStore();
  const cache = makeSlotCache();
  let nextId = 1;
  const deps = {
    persistRecipeImpl: async (resolved, opts) => {
      const id = `r-new-${nextId++}`;
      rec.persisted.push({ id, resolved, opts });
      return { id, name: resolved.name };
    },
    resolveIngredientImpl: async (name) => {
      const f = FOODS[name];
      if (!f) return { food: { id: `ph-${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0 }, matched: "placeholder", status: "needs_review", needsReview: true };
      return { food: f, matched: "existing", status: "resolved", needsReview: false, confidence: 1 };
    },
    loadFoodsImpl: async (ids) => ALL_FOODS.filter((f) => ids.includes(f.id)),
    stats: makeStats(),
    now: () => new Date("2026-08-06T12:00:00Z"),
    cacheDeps: {
      cache,
      findByFingerprintImpl: async (fp) => { rec.durableLookups.push(fp); return durableRows; },
    },
    aiDeps: {
      budget: makeBudget({ store, userId: "u1" }),
      generateDraftsImpl: async (params, callDeps) => {
        rec.generateCalls.push({ params, model: callDeps?.model });
        return { drafts, droppedForAllergies: [], droppedForShape: [] };
      },
    },
    webDeps: {
      registry: registry || { maxImportsPerSite: 2, sources: [] },
      fetchTextImpl: fetchTextImpl || (async () => { throw new Error("no web in this test"); }),
      importImpl: importImpl || (async () => { throw new Error("no web in this test"); }),
      delayImpl: async () => {},
    },
  };
  return { deps, rec, cache };
}

// ─────────────────────────────────────────────────────────────────────────────

test("LIBRARY FIRST: a fitting pool recipe is served with zero model calls, zero web, zero persistence", async () => {
  const { deps, rec } = makeDeps();
  const out = await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_RICE, RICE_ONLY] }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.status, "library-hit");
  assert.equal(out.recipe.id, "r-chicken-rice");
  assert.ok(out.scaled.kcal > 0 && out.scaled.protein > 0);
  assert.equal(rec.generateCalls.length, 0, "free answer = no spend");
  assert.equal(rec.persisted.length, 0);
  assert.equal(out.spec.slotType, "meal");
  assert.ok(out.fingerprint, "every outcome carries the spec fingerprint");
});

test("THE WALL: an excluded-food recipe is never served from any channel, even when it fits the macros", async () => {
  const { deps, rec } = makeDeps({ drafts: [PB_DRAFT] }); // AI also proposes peanut
  const out = await solveRecipeForSlot(
    { target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [PB_TOAST, CHICKEN_ONLY] },
    deps
  );
  assert.notEqual(out.recipe?.id, "r-pb", "the wall holds on the library path");
  assert.equal(out.status, "closest-fit", "chicken-only is offered honestly as the closest fit");
  assert.equal(out.ok, false);
  // the AI's peanut proposal was verified against the resolved foods and discarded
  assert.ok(deps.stats.discarded > 0, "the AI peanut draft was discarded by the shared verify gate");
  assert.ok(rec.persisted.length === 0, "nothing failing the gate is ever persisted");
  assert.ok(out.notice, "a degraded outcome always says why");
});

test("AI GENERATION: an unfillable gap escalates to the governed generator; the verified draft is persisted WITH the durable fingerprint stamp", async () => {
  const { deps, rec } = makeDeps();
  const out = await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [RICE_ONLY] }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.status, "generated");
  assert.equal(rec.generateCalls.length, 1, "one model call, first tier");
  assert.equal(rec.persisted.length, 1);
  const p = rec.persisted[0];
  assert.equal(p.opts.source, "ai-generated");
  assert.equal(p.opts.aiFingerprint, out.fingerprint, "the constraint fingerprint is persisted — the durable cache is finally durable");
  assert.ok(p.opts.aiVerifiedAt instanceof Date);
  assert.ok(Array.isArray(p.opts.aiVerifiedBy.screens) && p.opts.aiVerifiedBy.screens.includes("matrix-caps"));
  assert.equal(out.provenance.verified, true);
  // the spec hints reached the drafter
  const params = rec.generateCalls[0].params;
  assert.ok(params.targetFatG && Number.isFinite(params.targetFatG.lo), "fat guidance rides into the prompt");
  assert.equal(params.allowAllergens, false, "never negotiable on an unattended path");
  assert.deepEqual(params.excludedFoods, ["peanuts"]);
});

test("PAY ONCE: the same spec asked twice costs one generation — the second answer is a cache hit", async () => {
  const { deps, rec } = makeDeps();
  const first = await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [RICE_ONLY] }, deps);
  assert.equal(first.status, "generated");
  // the persisted row joins the pool (as it would via the DB) — same cache instance
  const newRow = { ...first.recipe, id: rec.persisted[0].id, source: "ai-generated" };
  const second = await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [RICE_ONLY, newRow] }, deps);
  assert.equal(second.ok, true);
  assert.equal(second.status, "cache-hit");
  assert.equal(rec.generateCalls.length, 1, "the gap was paid for exactly once");
  assert.equal(second.cached, true);
});

test("DURABLE CACHE: a verified row found by fingerprint is served across 'restarts'; an unverified row is refused", async () => {
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY, profile: PROFILE });
  const fp = specFingerprint(spec);
  const verifiedRow = { ...CHICKEN_RICE, id: "r-durable", source: "ai-generated", aiFingerprint: fp, aiVerifiedAt: new Date("2026-08-01") };
  const { deps, rec } = makeDeps({ durableRows: [verifiedRow] });
  const out = await solveRecipeForSlot({ spec, profile: PROFILE, recipePool: [verifiedRow, RICE_ONLY] }, deps);
  assert.equal(out.status, "cache-hit");
  assert.equal(out.via, "durable");
  assert.equal(rec.durableLookups[0], fp);
  assert.equal(rec.generateCalls.length, 0);

  // unverified: refused by the durable channel (recorded), served only via the ordinary library scan
  const unverified = { ...verifiedRow, id: "r-unverified", aiVerifiedAt: null };
  const { deps: deps2 } = makeDeps({ durableRows: [unverified] });
  const out2 = await solveRecipeForSlot({ spec, profile: PROFILE, recipePool: [unverified, RICE_ONLY] }, deps2);
  const cacheAttempt = out2.attempts.find((a) => a.channel === "cache");
  assert.ok(cacheAttempt.records.some((r) => r.outcome === "unverified-row-refused"), "a null aiVerifiedAt is never served from the durable cache");
});

test("DURABLE CACHE fails open to a MISS, never an error, when the lookup itself breaks", async () => {
  const { deps } = makeDeps();
  deps.cacheDeps.findByFingerprintImpl = async () => { throw new Error("db offline"); };
  const out = await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_RICE] }, deps);
  assert.equal(out.status, "library-hit", "the scan answers what the index could not");
  const cacheAttempt = out.attempts.find((a) => a.channel === "cache");
  assert.ok(cacheAttempt.records.some((r) => r.outcome === "lookup-failed"), "the failure is recorded, not swallowed");
});

test("WEB CHANNEL: an owner-enabled site fills the gap through the same verify gate; the row persists as IMPORTED", async () => {
  const site = { key: "t", name: "T", homepage: "https://r.example.com", searchUrl: "https://r.example.com/?s={query}", linkPattern: "r.example.com/", enabled: true };
  const { deps, rec } = makeDeps({
    registry: { maxImportsPerSite: 2, sources: [site] },
    fetchTextImpl: async (u) => (u.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : `<a href="https://r.example.com/chicken-rice-plate/">hit</a>`),
    importImpl: async (url) => ({ ...AI_DRAFT, name: "Web Chicken Rice", sourceUrl: url }),
  });
  const out = await solveRecipeForSlot(
    { target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [RICE_ONLY], options: { allowWeb: true, allowGeneration: false } },
    deps
  );
  assert.equal(out.ok, true);
  assert.equal(out.status, "web-imported");
  assert.equal(rec.persisted[0].opts.source, "imported");
  assert.equal(rec.generateCalls.length, 0, "the web answered before AI was ever asked");
  assert.equal(out.provenance.sourceUrl, "https://r.example.com/chicken-rice-plate/");
});

test("MATRIX HONESTY: an impossible taste cap is named as the binding constraint end-to-end", async () => {
  const { deps, rec } = makeDeps();
  const out = await solveRecipeForSlot(
    { target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_RICE], filters: { minTaste: 0.9 } },
    deps
  );
  assert.equal(out.ok, false);
  assert.match(out.notice, /TASTE/, "the degrade copy names the measured binding cap");
  assert.equal(rec.persisted.length, 0, "an AI draft that fails a matrix cap is discarded, never persisted");
  assert.ok(rec.generateCalls.length >= 1, "generation was tried — and its output faced the same matrix");
});

test("generation off + no fit → honest degrade, zero spend", async () => {
  const { deps, rec } = makeDeps();
  const out = await solveRecipeForSlot(
    { target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_ONLY], options: { allowGeneration: false } },
    deps
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, "closest-fit");
  assert.match(out.notice, /not requested/i);
  assert.equal(rec.generateCalls.length, 0);
});

test("routeSlotCompat speaks mealRouter's contract for the weeklyPlanner seam", async () => {
  const { deps } = makeDeps();
  const out = await routeSlotCompat(
    { target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_RICE], existingRecipeNames: [], allowGeneration: true },
    deps
  );
  for (const key of ["ok", "status", "recipe", "scaled", "fingerprint", "cached", "modelCalls", "attempts", "notice", "reason", "stats"]) {
    assert.ok(key in out, `contract key: ${key}`);
  }
  assert.equal(out.ok, true);
  assert.equal(out.status, "library-hit");
  assert.ok(out.recipeBrain.spec, "the recipe-brain extras ride in their own namespace");
});

// ── the synergy loop ────────────────────────────────────────────────────────

const GAP_DAY_CANDIDATE = {
  slots: [
    { slotType: "meal", slotIndex: 0, recipeId: "r-chicken-rice", warning: null, kcal: 620, protein: 45 },
    { slotType: "meal", slotIndex: 1, recipeId: null, warning: null, kcal: 0, protein: 0 },
  ],
  score: { matchPct: 58, totals: { kcal: 1240, protein: 90, fat: 40, carb: 120 } },
};

test("fillDayGaps: a solver miss becomes a spec, a sourced recipe, and an addition for the re-solve", async () => {
  const { deps, rec } = makeDeps();
  const out = await fillDayGaps(
    { candidate: GAP_DAY_CANDIDATE, dailyTarget: DAY, mealConfig: { meals: 3, snacks: 0 }, profile: PROFILE, recipePool: [CHICKEN_RICE, RICE_ONLY] },
    deps
  );
  assert.equal(out.report.gaps, 1);
  assert.equal(out.additions.length, 1, "the generated recipe is returned for the pool");
  assert.equal(out.outcomes[0].outcome.status, "generated");
  assert.equal(out.outcomes[0].reason, "unfilled");
  assert.equal(rec.persisted.length, 1);
});

test("solveDayWithGapFill: solver → recipe brain → solver, keeping the honestly better day", async () => {
  const { deps } = makeDeps();
  const calls = [];
  deps.generateDayCandidatesImpl = async ({ recipePool }) => {
    calls.push(recipePool.map((r) => r.id));
    // first pass: a day with a hole; second pass (enriched pool): clean and better
    if (calls.length === 1) return { candidates: [GAP_DAY_CANDIDATE], diagnosis: null, poolSize: recipePool.length };
    return {
      candidates: [{ slots: [{ slotType: "meal", slotIndex: 0, recipeId: "r-chicken-rice", warning: null }, { slotType: "meal", slotIndex: 1, recipeId: "r-new-1", warning: null }], score: { matchPct: 93, totals: { kcal: 2050, protein: 158, fat: 60, carb: 195 } } }],
      diagnosis: null, poolSize: recipePool.length,
    };
  };
  const out = await solveDayWithGapFill(
    { dailyTarget: DAY, mealConfig: { meals: 3, snacks: 0 }, profile: PROFILE, recipePool: [CHICKEN_RICE, RICE_ONLY], dayOfWeek: 0 },
    deps
  );
  assert.equal(out.improved, true);
  assert.equal(out.best.score.matchPct, 93);
  assert.equal(calls.length, 2, "the solver ran twice — before and after sourcing");
  assert.ok(calls[1].length > calls[0].length, "the second solve saw the enriched pool");
  assert.equal(out.gapFill.additions.length, 1);
});

test("solveDayWithGapFill: a clean first pass never sources anything (the free path stays free)", async () => {
  const { deps, rec } = makeDeps();
  const clean = { candidates: [{ slots: [{ slotType: "meal", slotIndex: 0, recipeId: "r-chicken-rice", warning: null }], score: { matchPct: 97, totals: {} } }] };
  deps.generateDayCandidatesImpl = async () => clean;
  const out = await solveDayWithGapFill(
    { dailyTarget: DAY, mealConfig: { meals: 1, snacks: 0 }, profile: PROFILE, recipePool: [CHICKEN_RICE] },
    deps
  );
  assert.equal(out.improved, false);
  assert.equal(out.gapFill, null);
  assert.equal(rec.generateCalls.length, 0);
});

test("stats counters tell the economic story", async () => {
  const { deps } = makeDeps();
  await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [CHICKEN_RICE] }, deps);
  await solveRecipeForSlot({ target: TARGET, dailyTarget: DAY, profile: PROFILE, recipePool: [RICE_ONLY] }, deps);
  assert.equal(deps.stats.requests, 2);
  assert.equal(deps.stats.libraryHits, 1);
  assert.equal(deps.stats.generations, 1);
  assert.equal(deps.stats.modelCalls, 1);
});
