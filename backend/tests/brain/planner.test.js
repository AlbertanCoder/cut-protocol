const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planDay, satisfies } = require("../../src/lib/brain/planner.js");
const { scorePlan } = require("../../src/lib/brain/scorer.js");

function food(id, kcal, protein, fat, carb) { return { id, name: id, category: "other", kcal, protein, fat, carb }; }
function ing(f, g, role) { return { foodId: f.id, baseGrams: g, scalable: true, role, food: f }; }
const CHICKEN = food("chicken", 165, 31, 3.6, 0);
const RICE = food("rice", 130, 2.7, 0.3, 28);
function withCache(r) {
  const t = r.ingredients.reduce((s, i) => { const f = i.baseGrams / 100; return { kcal: s.kcal + i.food.kcal * f, protein: s.protein + i.food.protein * f, fat: s.fat + i.food.fat * f, carb: s.carb + i.food.carb * f }; }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { ...r, ...t };
}
const CR = withCache({ id: "cr", name: "Chicken & Rice", slotType: "meal", mealCategory: null, ingredients: [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")] });
const LIBRARY = { recipes: [CR], foods: [CHICKEN, RICE] };
const TARGET = { kcal: 1800, proteinLo: 150, proteinHi: 170, fatLo: 40, fatHi: 80, carbLo: 120, carbHi: 220 };

test("planDay: GATE — brain off returns {status:'unavailable'} and builds NO pool / calls NO selector", async () => {
  let poolBuilt = false;
  let proposed = false;
  const res = await planDay(
    { profile: {}, target: TARGET, mealConfig: { meals: 3, snacks: 0 }, library: LIBRARY },
    {
      enabled: false,
      buildPoolFn: () => { poolBuilt = true; return { recipes: new Map(), foods: new Map(), excludedIds: new Set(), filterSpec: {} }; },
      proposeDayFn: async () => { proposed = true; return { slots: [] }; },
    }
  );
  assert.equal(res.status, "unavailable");
  assert.equal(res.reason, "brain-off");
  assert.equal(poolBuilt, false, "gated off BEFORE any pool build");
  assert.equal(proposed, false, "gated off BEFORE any LLM/selector call");
});

test("planDay: offline / over-cap also degrade to 'unavailable' (caller falls back to the solver)", async () => {
  const off = await planDay({ profile: {}, target: TARGET, library: LIBRARY }, { enabled: true, online: false });
  assert.equal(off.status, "unavailable");
  assert.equal(off.reason, "offline");
  const cap = await planDay({ profile: {}, target: TARGET, library: LIBRARY }, { enabled: true, underCaps: false });
  assert.equal(cap.reason, "cost-cap");
});

test("planDay: infeasible pool fails fast with ZERO selector/LLM calls", async () => {
  let proposed = false;
  const res = await planDay(
    { profile: {}, target: TARGET, mealConfig: { meals: 3, snacks: 0 }, library: { recipes: [], foods: [] } },
    { enabled: true, proposeDayFn: async () => { proposed = true; return { slots: [] }; } }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "empty-pool");
  assert.equal(proposed, false, "no selector call on an infeasible pool");
});

test("planDay: happy path with an injected selector — macros are computed deterministically and pass the verifier", async () => {
  // The selector only picks ids (no LLM here); planDay computes the real macros
  // via the tool layer and the verifier gates them.
  const proposeDayFn = async ({ slotTargets }) => ({ slots: slotTargets.map((st) => ({ ...st, recipeId: "cr" })) });
  const res = await planDay(
    { profile: {}, target: TARGET, mealConfig: { meals: 3, snacks: 0 }, library: LIBRARY },
    { enabled: true, proposeDayFn }
  );
  assert.ok(["converged", "partial"].includes(res.status), `status=${res.status}`);
  assert.equal(res.day.length, 3, "3 meal slots resolved");
  assert.ok(res.verification && res.verification.ok, "every slot passes the verifier (macros from the tool layer)");
  assert.ok(res.day.every((s) => s.prov && s.prov.formulaId === "scaleRecipe"), "every slot macro carries scaleRecipe provenance");
  assert.ok(res.day.every((s) => s.macros && typeof s.macros.kcal === "number"), "slots carry computed MacroVectors");
});

// --- regression: the cross-module `_g` MacroVector seam (integration fleet) ---

test("satisfies() reads a _g-suffixed MacroVector — the convergence seam", () => {
  // dayTotals() emits protein_g/carb_g/fat_g; the acceptance predicate must read them.
  const onTarget = { kcal: 1800, protein_g: 160, carb_g: 170, fat_g: 60 };
  assert.equal(satisfies(onTarget, TARGET), true, "a _g-shaped on-target day must CONVERGE");
  assert.equal(satisfies({ kcal: 1800, protein_g: 100, carb_g: 170, fat_g: 60 }, TARGET), false, "protein-short does not converge");
  assert.equal(satisfies({ kcal: 1800, protein_g: NaN, carb_g: 170, fat_g: 60 }, TARGET), false, "NaN protein fails closed");
});

test("planDay gaps are FINITE, not NaN (macro-shape seam fixed)", async () => {
  const proposeDayFn = async ({ slotTargets }) => ({ slots: slotTargets.map((st) => ({ ...st, recipeId: "cr" })) });
  const res = await planDay({ profile: {}, target: TARGET, mealConfig: { meals: 3, snacks: 0 }, library: LIBRARY }, { enabled: true, proposeDayFn });
  assert.ok(res.gaps && Number.isFinite(res.gaps.kcal) && Number.isFinite(res.gaps.protein), `gaps must be finite, got ${JSON.stringify(res.gaps)}`);
});

test("scorePlan accepts a _g-suffixed MacroVector (finite score, not NaN)", () => {
  const s = scorePlan({ totals: { kcal: 1800, protein_g: 160, carb_g: 170, fat_g: 60 } }, TARGET);
  assert.ok(Number.isFinite(s.score) && s.score > 0, `score must be finite, got ${s.score}`);
});
