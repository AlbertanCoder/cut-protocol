// QC gauntlet v2 — Phase 1C invariants (metamorphic + determinism).
//
// SOLVER CLASS: the meal solver is a HEURISTIC best-of-N scored greedy, not an
// exact optimizer. So invariants that only hold for a proven optimum (e.g.
// "loosening a constraint never worsens the objective") are stated as bounded
// checks, not strict never-worse assertions — a strict version would fail
// correct heuristic code. The safety invariants below (floor dominance, pool
// monotonicity, determinism) hold regardless of solver class.

require("dotenv/config"); // resolve DATABASE_URL for the read-only pool load
const test = require("node:test");
const assert = require("node:assert");
const { createRequire } = require("node:module");
const req = createRequire(__filename);

const bmr = req("../../src/lib/bmrEngine.js");
const planner = req("../../src/lib/weeklyPlanner.js");
const ctx = req("../../src/lib/planContext.js");
const { prisma } = req("../../src/lib/prisma.js");

let genProfile, runSolve, rawPool;
test.before(async () => {
  ({ genProfile } = await import("../../scripts/qc/genProfile.mjs"));
  ({ runSolve } = await import("../../scripts/qc/runSolve.mjs"));
  rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
});
test.after(async () => { await prisma.$disconnect(); });

// ── FLOOR DOMINANCE — the safety-critical invariant, over many profiles ────
test("1C floor dominance: derived target >= effectiveFloor() over 2,000 profiles", () => {
  const violations = [];
  for (let i = 0; i < 2000; i++) {
    const { profile, weightKg } = genProfile(20260723, i);
    const energy = bmr.computeEnergy(profile, weightKg);
    const t = bmr.deriveTarget(profile, energy.tdee, energy.rmr);
    const floor = bmr.effectiveFloor(profile, energy.rmr);
    if (t.target < floor - 0.5) violations.push({ i, target: t.target, floor });
  }
  assert.deepEqual(violations, [], `floor breached in ${violations.length} profiles: ${JSON.stringify(violations.slice(0, 5))}`);
});

test("1C floor dominance: the three-term max includes the user's own floorKcal", () => {
  // A stricter personal floor must dominate even when it exceeds sex+RMR floors.
  const profile = { sex: "F", floorKcal: 1900 };
  assert.equal(bmr.effectiveFloor(profile, 1600), 1900, "user floorKcal 1900 must win over sexFloor 1200 and RMR*0.95=1520");
});

// ── UNIT INVARIANCE — same physical body, either unit path, same target ────
test("1C unit invariance: unitPref does not change the derived target", () => {
  for (const [kg, cm] of [[80, 178], [55, 160], [130, 190]]) {
    const base = { sex: "M", age: 35, heightCm: cm, bodyFatPct: 0, occupationKey: "desk-office", activityOverride: null, sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45, rateLbPerWeek: 1.0, floorKcal: null, excludedFormulas: [] };
    const imp = bmr.deriveTarget({ ...base, unitPref: "imperial" }, ...tdeeRmr({ ...base, unitPref: "imperial" }, kg));
    const met = bmr.deriveTarget({ ...base, unitPref: "metric" }, ...tdeeRmr({ ...base, unitPref: "metric" }, kg));
    assert.equal(imp.target, met.target, `${kg}kg/${cm}cm: imperial ${imp.target} vs metric ${met.target}`);
  }
});
function tdeeRmr(profile, kg) { const e = bmr.computeEnergy(profile, kg); return [e.tdee, e.rmr]; }

test("1C unit round-trip: kg2lb is monotonic and stable", () => {
  assert.ok(bmr.kg2lb(100) > bmr.kg2lb(99));
  assert.ok(Math.abs(bmr.kg2lb(100) - 220.462) < 0.01);
});

// ── MONOTONIC POOL SAFETY — an exclusion never grows the pool; no cross-talk ─
test("1C monotonic safety: adding an exclusion never grows the filtered pool", () => {
  const base = ctx.filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: [] });
  for (const ex of ["dairy", "gluten", "nuts", "soy", "fish"]) {
    const narrowed = ctx.filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: [ex] });
    assert.ok(narrowed.length <= base.length, `excluding ${ex} grew the pool (${narrowed.length} > ${base.length})`);
  }
});

test("1C no shared-cache cross-talk: interleaved filters are independent", () => {
  const a1 = ctx.filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: ["dairy"] }).length;
  ctx.filterRecipePool(rawPool, { dietaryStyle: "vegan", excludedFoods: ["nuts", "soy"] });
  const a2 = ctx.filterRecipePool(rawPool, { dietaryStyle: null, excludedFoods: ["dairy"] }).length;
  assert.equal(a1, a2, "a second user's filter changed the first user's pool result — shared-state bug");
});

// ── DETERMINISM — same seed+profile -> byte-identical plan ─────────────────
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canonical(slots) {
  return JSON.stringify((slots || []).map((s) => ({ d: s.dayOfWeek, t: s.slotType, r: s.recipeId, ps: s.proteinScale, ss: s.sidesScale, ing: (s.ingredients || []).map((i) => `${i.foodId}:${i.grams}`).sort() })));
}
test("1C determinism: same seed+profile -> byte-identical plan (twice)", async () => {
  for (const i of [3, 47, 128, 900]) {
    const gen = genProfile(424242, i);
    const a = await runSolve(gen, rawPool, mulberry(gen.seed ^ 0x1234567));
    const b = await runSolve(gen, rawPool, mulberry(gen.seed ^ 0x1234567));
    assert.equal(canonical(a.slots), canonical(b.slots), `run ${i} not reproducible`);
  }
});

// ── SCALING CLAMP — scales stay within [0.5, 2] under extreme targets ──────
test("1C scaling clamp: extreme targets clamp scales into [0.5, 2]", () => {
  const recipe = rawPool.find((r) => r.ingredients.length >= 2 && r.kcal > 0);
  const hi = planner.scaleRecipe(recipe, recipe.kcal * 20, recipe.protein * 20);
  const lo = planner.scaleRecipe(recipe, recipe.kcal * 0.05, recipe.protein * 0.05);
  const B = planner.SCALE_BOUNDS;
  for (const sc of [hi.proteinScale, hi.sidesScale, lo.proteinScale, lo.sidesScale]) {
    assert.ok(sc >= B.min - 1e-6 && sc <= B.max + 1e-6, `scale ${sc} escaped [${B.min}, ${B.max}]`);
  }
});

// ── SOLVER-PATH PURITY — no stray RNG/clock outside the injected rng ───────
test("1C purity: mealSolver + weeklyPlanner use no Math.random / Date.now / new Date", () => {
  const fs = req("node:fs"), path = req("node:path");
  for (const f of ["mealSolver.js", "weeklyPlanner.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", f), "utf8");
    assert.ok(!/Math\.random\(|Date\.now\(|new Date\(/.test(src), `${f} contains a stray RNG/clock call`);
  }
});
