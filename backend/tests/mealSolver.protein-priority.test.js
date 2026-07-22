// Protein-priority / recomposition mode — the LIVE deterministic solver path
// (mealSolver.js + weeklyPlanner.js), the one every real plan generation and
// swap actually runs through (unlike the Brain v3 spine, which is dormant
// until wired to a route). Fixtures are hand-built foods/recipes with known-
// correct macros, per the track brief: ~242 of 864 live Food rows carry
// another food's macros from a fuzzy-match import bug, protein values
// specifically among them, and another agent is repairing that table in
// parallel — validating against it right now would validate against noise.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreDay, scoreWeek, diagnoseFromResult, generateDayCandidates,
  generateBestWeekPlan, alternatesForSlot, PROTEIN_PRIORITY_WEIGHTS, SCORE_WEIGHTS,
} = require("../src/lib/mealSolver.js");

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// ── controlled fixture foods (known-correct, per-100g) ───────────────────
const F = {
  chicken: { name: "Chicken Breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 },
  rice: { name: "White Rice, cooked", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 },
  pasta: { name: "Pasta, cooked", kcal: 157, protein: 5.8, fat: 0.9, carb: 31 },
  oil: { name: "Olive Oil", kcal: 884, protein: 0, fat: 100, carb: 0 },
  broccoli: { name: "Broccoli", kcal: 34, protein: 2.8, fat: 0.4, carb: 7 },
};

let seq = 0;
function recipe(name, parts, over = {}) {
  seq++;
  const ingredients = parts.map(([food, grams, role, scalable = true]) => ({ foodId: `f-${food.name}`, baseGrams: grams, role, scalable, food }));
  const totals = ingredients.reduce(
    (s, i) => {
      const k = i.baseGrams / 100;
      return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );
  return { id: `r-${seq}-${name}`, name, slotType: "meal", cuisine: null, prepTimeMin: 20, mealCategory: null, ingredients, ...totals, ...over };
}

// Rich pool: plenty of dense-protein mains AND some pasta-heavy (protein-thin,
// kcal-dense) mains — a realistic mixed pool where a naive kcal-first pick
// CAN land protein-short even though better options exist.
function richPool() {
  return [
    recipe("Chicken Rice Bowl A", [[F.chicken, 220, "protein"], [F.rice, 200, "carb"], [F.broccoli, 100, "veg"]]),
    recipe("Chicken Rice Bowl B", [[F.chicken, 200, "protein"], [F.rice, 220, "carb"], [F.broccoli, 100, "veg"]]),
    recipe("Chicken Rice Bowl C", [[F.chicken, 240, "protein"], [F.rice, 180, "carb"], [F.broccoli, 100, "veg"]]),
    recipe("Buttered Pasta A", [[F.pasta, 350, "carb"], [F.oil, 15, "fat", false], [F.chicken, 40, "protein"]]),
    recipe("Buttered Pasta B", [[F.pasta, 380, "carb"], [F.oil, 18, "fat", false], [F.chicken, 30, "protein"]]),
  ];
}

// Protein-desert pool: every recipe's protein-per-kcal ratio is far below
// what a high-protein target needs, and no amount of 0.5-2x scaling closes
// the gap — the floor is genuinely unreachable, not just poorly picked.
function proteinDesertPool() {
  return [
    recipe("Plain Pasta A", [[F.pasta, 300, "carb"], [F.oil, 10, "fat", false]]),
    recipe("Plain Pasta B", [[F.pasta, 320, "carb"], [F.oil, 12, "fat", false]]),
    recipe("Rice Bowl", [[F.rice, 300, "carb"], [F.broccoli, 150, "veg"]]),
    recipe("Rice and Oil", [[F.rice, 280, "carb"], [F.oil, 8, "fat", false]]),
  ];
}

const HIGH_PROTEIN_TARGET = { kcal: 2200, proteinLo: 180, proteinHi: 200, fatLo: 50, fatHi: 80, carbLo: 150, carbHi: 260 };

// ── scoreDay ───────────────────────────────────────────────────────────────

test("scoreDay: default mode carries no proteinFloor key at all (byte-identical contract)", () => {
  const sc = scoreDay(HIGH_PROTEIN_TARGET, [{ kcal: 2200, protein: 140, fat: 65, carb: 200 }]);
  assert.equal("proteinFloor" in sc, false);
});

test("scoreDay: protein-priority mode uses PROTEIN_PRIORITY_WEIGHTS and attaches proteinFloor", () => {
  const slots = [{ kcal: 2200, protein: 140, fat: 65, carb: 200 }]; // kcal-perfect, 40g under the 180g floor
  const std = scoreDay(HIGH_PROTEIN_TARGET, slots);
  const pri = scoreDay(HIGH_PROTEIN_TARGET, slots, { proteinPriority: true });
  assert.ok(pri.matchPct < std.matchPct, "the identical shortfall must score worse once protein is the priority");
  assert.equal(pri.proteinFloor.met, false);
  assert.equal(pri.proteinFloor.floorG, 180);
  assert.equal(pri.proteinFloor.shortG, 40);
  assert.ok(pri.proteinFloor.reason.includes("180"), "the reason must name the actual floor number");
});

test("scoreDay: floor met -> reason is null (no narration on success)", () => {
  const sc = scoreDay(HIGH_PROTEIN_TARGET, [{ kcal: 2200, protein: 190, fat: 65, carb: 200 }], { proteinPriority: true });
  assert.equal(sc.proteinFloor.met, true);
  assert.equal(sc.proteinFloor.reason, null);
});

test("PROTEIN_PRIORITY_WEIGHTS gives protein more than half the objective, well above SCORE_WEIGHTS.protein", () => {
  assert.ok(PROTEIN_PRIORITY_WEIGHTS.protein > SCORE_WEIGHTS.protein);
  assert.ok(PROTEIN_PRIORITY_WEIGHTS.protein >= PROTEIN_PRIORITY_WEIGHTS.kcal);
});

// ── scoreWeek ────────────────────────────────────────────────────────────

test("scoreWeek: default mode has no floorDaysMet/floorDaysTotal keys", () => {
  const slots = [
    { dayOfWeek: 0, kcal: 2200, protein: 190, fat: 65, carb: 200 },
    { dayOfWeek: 1, kcal: 2200, protein: 130, fat: 65, carb: 200 },
  ];
  const sc = scoreWeek(HIGH_PROTEIN_TARGET, slots);
  assert.equal("floorDaysMet" in sc, false);
  assert.equal("floorDaysTotal" in sc, false);
});

test("scoreWeek: protein-priority mode counts exactly the days that defended the floor", () => {
  const slots = [
    { dayOfWeek: 0, kcal: 2200, protein: 190, fat: 65, carb: 200 }, // meets 180g floor
    { dayOfWeek: 1, kcal: 2200, protein: 130, fat: 65, carb: 200 }, // 50g short
    { dayOfWeek: 2, kcal: 2200, protein: 185, fat: 65, carb: 200 }, // meets floor
  ];
  const sc = scoreWeek(HIGH_PROTEIN_TARGET, slots, { proteinPriority: true });
  assert.equal(sc.floorDaysTotal, 3);
  assert.equal(sc.floorDaysMet, 2);
});

// ── diagnoseFromResult ───────────────────────────────────────────────────

test("diagnoseFromResult: protein-priority mode names the floor explicitly when it's structurally unreachable", () => {
  const pool = proteinDesertPool();
  const slots = [
    { dayOfWeek: 0, kcal: 2200, protein: 60, fat: 40, carb: 350 },
    { dayOfWeek: 1, kcal: 2180, protein: 55, fat: 38, carb: 340 },
  ];
  const d = diagnoseFromResult({
    dailyTarget: HIGH_PROTEIN_TARGET, slots, pool, mealConfig: { meals: 3, snacks: 0 },
    filters: { proteinPriority: true },
  });
  assert.equal(d.feasible, false);
  assert.ok(d.reasons.some((r) => r.includes("Protein-priority mode") && r.includes("180g/day floor")), `expected an explicit floor-named reason, got: ${JSON.stringify(d.reasons)}`);
  assert.ok(d.suggestions.length > 0, "a diagnosis must always ship an actionable suggestion, never just a complaint");
});

test("diagnoseFromResult: outside protein-priority mode, the mode-specific floor message never appears (but the miss is still explained)", () => {
  const pool = proteinDesertPool();
  const slots = [
    { dayOfWeek: 0, kcal: 2200, protein: 60, fat: 40, carb: 350 },
  ];
  const d = diagnoseFromResult({ dailyTarget: HIGH_PROTEIN_TARGET, slots, pool, mealConfig: { meals: 3, snacks: 0 }, filters: {} });
  assert.equal(d.feasible, false);
  assert.equal(d.reasons.some((r) => r.includes("Protein-priority mode")), false, "the mode-specific message must not appear when the mode is off");
  assert.ok(d.reasons.some((r) => r.toLowerCase().includes("protein")), "a protein-thin pool must still be explained honestly without the mode on");
});

// ── generateDayCandidates (integration, controlled fixture pool) ─────────

test("generateDayCandidates: protein-priority mode's top candidate carries an honest proteinFloor verdict", async () => {
  const pool = richPool();
  const { candidates, diagnosis } = await generateDayCandidates({
    dailyTarget: HIGH_PROTEIN_TARGET, mealConfig: { meals: 3, snacks: 0 }, recipePool: pool,
    filters: { proteinPriority: true }, rng: seeded(11), attempts: 12, count: 3,
  });
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.ok(c.score.proteinFloor, "every candidate must carry a proteinFloor verdict in this mode");
    assert.equal(typeof c.score.proteinFloor.met, "boolean");
  }
  // A rich, protein-dense pool at this target should let the best candidate
  // actually defend the floor — if it can't, the diagnosis must say so (never
  // silent), so this assertion is an either/or, not a blind pass requirement.
  if (!candidates[0].score.proteinFloor.met) {
    assert.ok(diagnosis && diagnosis.reasons.some((r) => r.includes("Protein-priority mode")));
  }
});

test("generateDayCandidates: a structurally protein-poor pool triggers diagnosis in priority mode even if kcal fits fine", async () => {
  const pool = proteinDesertPool();
  const { candidates, diagnosis } = await generateDayCandidates({
    dailyTarget: HIGH_PROTEIN_TARGET, mealConfig: { meals: 3, snacks: 0 }, recipePool: pool,
    filters: { proteinPriority: true }, rng: seeded(5), attempts: 9, count: 3,
  });
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].score.proteinFloor.met, false, "this pool cannot reach the floor — the top candidate must say so");
  assert.ok(diagnosis, "an unmeetable floor must never ship without a diagnosis");
  assert.equal(diagnosis.feasible, false);
  assert.ok(diagnosis.reasons.some((r) => r.includes("Protein-priority mode")));
});

// ── generateBestWeekPlan (integration) ────────────────────────────────────

test("generateBestWeekPlan: floorDaysMet/floorDaysTotal ride on the week's score only in priority mode", async () => {
  const pool = richPool();
  const off = await generateBestWeekPlan(HIGH_PROTEIN_TARGET, { meals: 3, snacks: 0 }, pool, { rng: seeded(3), attempts: 2, filters: {} });
  assert.equal("floorDaysMet" in off.score, false);

  const on = await generateBestWeekPlan(HIGH_PROTEIN_TARGET, { meals: 3, snacks: 0 }, pool, { rng: seeded(3), attempts: 3, filters: { proteinPriority: true } });
  assert.equal(typeof on.score.floorDaysTotal, "number");
  assert.ok(on.score.floorDaysTotal > 0);
  assert.ok(on.score.floorDaysMet <= on.score.floorDaysTotal);
});

test("generateBestWeekPlan: an unreachable floor across the whole week always ships a diagnosis in priority mode", async () => {
  const pool = proteinDesertPool();
  const week = await generateBestWeekPlan(HIGH_PROTEIN_TARGET, { meals: 3, snacks: 0 }, pool, {
    rng: seeded(9), attempts: 2, filters: { proteinPriority: true },
  });
  assert.ok(week.score.floorDaysMet < week.score.floorDaysTotal, "sanity: this pool really can't meet the floor");
  assert.ok(week.diagnosis, "a week that structurally misses the floor must never ship silently");
  assert.equal(week.diagnosis.feasible, false);
});

// ── alternatesForSlot ──────────────────────────────────────────────────────

test("alternatesForSlot: protein-priority mode re-weights matchPct exactly as designed (0.35 kcal / 0.65 protein vs 0.6 / 0.4)", async () => {
  // scaleRecipe's achieved kcal/protein for a given recipe+target are
  // independent of the matchPct WEIGHTING (the weighting is a pure post-hoc
  // read of the already-solved macros) — so run once, read the achieved
  // numbers back, and verify BOTH modes' matchPct against the exact formula
  // rather than guessing which recipe "should" win in the abstract.
  const denseProtein = { name: "Dense Protein", kcal: 200, protein: 40, fat: 6, carb: 0 };
  const A = recipe("Protein Forward", [[denseProtein, 250, "protein"], [F.rice, 40, "carb"]]);
  const slotTarget = { dayOfWeek: 0, slotType: "meal", slotIndex: 0, kcalTarget: 480, proteinTarget: 70 };

  const std = await alternatesForSlot({ slotTarget, recipePool: [A], existingSlots: [], filters: {}, count: 1, rng: seeded(2) });
  const pri = await alternatesForSlot({ slotTarget, recipePool: [A], existingSlots: [], filters: { proteinPriority: true }, count: 1, rng: seeded(2) });
  assert.equal(std.length, 1);
  assert.equal(pri.length, 1);
  // Same recipe, same target, same rng -> scaleRecipe must land on identical
  // achieved macros regardless of the scoring mode (mode only reweights the
  // already-solved result).
  assert.equal(std[0].kcal, pri[0].kcal);
  assert.equal(std[0].protein, pri[0].protein);

  const kcalErr = Math.abs(std[0].kcal - slotTarget.kcalTarget) / slotTarget.kcalTarget;
  const pShort = Math.max(0, (slotTarget.proteinTarget - std[0].protein) / slotTarget.proteinTarget);
  const expected = (kw, pw) => Math.round(Math.max(0, 1 - (kw * Math.min(1, kcalErr) + pw * Math.min(1, pShort))) * 100);
  assert.equal(std[0].matchPct, expected(0.6, 0.4), "default weighting must match the documented 0.6 kcal / 0.4 protein formula");
  assert.equal(pri[0].matchPct, expected(0.35, 0.65), "priority weighting must match the documented 0.35 kcal / 0.65 protein formula");
});
