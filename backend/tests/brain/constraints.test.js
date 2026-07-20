// Stage E — the constraint model. compileConstraints builds the canonical
// ConstraintSet; checkFeasibility is the pre-flight necessary test (never a
// false pass — missing inputs are INDETERMINATE); satisfies is the
// deterministic acceptance predicate; relaxNext walks the soft ladder.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compileConstraints, checkFeasibility, satisfies, relaxNext, SOFT_ORDER } = require("../../src/lib/brain/constraints.js");

const TARGET = { kcal: 2000, proteinLo: 150, proteinHi: 180, carbLo: 150, carbHi: 220, fatLo: 50, fatHi: 70 };

test("compileConstraints — HARD block from profile + target", () => {
  const cs = compileConstraints({ dietaryStyle: "halal", excludedFoods: ["peanuts"] }, TARGET);
  // energy band = kcal ± max(50, 3%): 2000 ± 60.
  assert.deepEqual(cs.hard.energy.value, { kcal: 2000, lo: 1940, hi: 2060 });
  assert.equal(cs.hard.energy.kind, "hard");
  assert.equal(cs.hard.energy.priority, 0);
  assert.equal(cs.hard.proteinFloor.value.g, 150); // proteinLo is the floor
  assert.deepEqual(cs.hard.exclusions.value, { dietaryStyle: "halal", excludedFoods: ["peanuts"] });
  assert.equal(cs.hard.exclusions.kind, "hard");
  assert.deepEqual(cs.relaxations, []);
});

test("compileConstraints — SOFT ladder null when profile is silent (null = no constraint)", () => {
  const cs = compileConstraints({}, TARGET);
  assert.equal(cs.soft.batch.value.allow, null);
  assert.equal(cs.soft.complexity.value.max, null);
  assert.equal(cs.soft.time.value.maxPrepMin, null);
  assert.equal(cs.soft.budget.value.tier, null);
  // carb/fat bands come from the target and carry a weight
  assert.deepEqual(cs.soft.carbBand.value, { lo: 150, hi: 220 });
  assert.equal(cs.soft.carbBand.weight, 0.075);
  // every soft leaf tagged + prioritised
  for (const k of SOFT_ORDER) assert.equal(cs.soft[k].kind, "soft", `${k} kind`);
});

test("compileConstraints — SOFT constraints carried from profile fields", () => {
  const cs = compileConstraints({ maxPrepMin: 20, budgetTier: "cheap", allowBatch: false, maxComplexity: 2 }, TARGET);
  assert.equal(cs.soft.time.value.maxPrepMin, 20);
  assert.equal(cs.soft.budget.value.tier, "cheap");
  assert.equal(cs.soft.batch.value.allow, false);
  assert.equal(cs.soft.complexity.value.max, 2);
});

test("checkFeasibility — feasible when the catalog can reach the floor", () => {
  const cs = compileConstraints({}, TARGET);
  const r = checkFeasibility(cs, { compliantCount: 40, bestProteinPerKcal: 0.12 });
  assert.equal(r.feasible, true);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.computed.neededProteinPerKcal, 0.075); // 150/2000
});

test("checkFeasibility — INFEASIBLE when protein density is unreachable", () => {
  const cs = compileConstraints({}, TARGET);
  const r = checkFeasibility(cs, { compliantCount: 40, bestProteinPerKcal: 0.05 });
  assert.equal(r.feasible, false);
  assert.ok(r.conflicts.some((c) => c.constraint === "proteinFloor"));
  assert.ok(r.fixes.length > 0);
});

test("checkFeasibility — INDETERMINATE on missing inputs, never a false pass (LAW 7)", () => {
  const cs = compileConstraints({}, TARGET);
  const r = checkFeasibility(cs, {}); // no compliantCount, no bestProteinPerKcal
  assert.equal(r.feasible, null); // NOT true
  assert.equal(r.conflicts.length, 0);
});

test("checkFeasibility — over-constrained: macro floors exceed the energy band", () => {
  const tight = { kcal: 1500, proteinLo: 200, proteinHi: 220, carbLo: 200, carbHi: 250, fatLo: 80, fatHi: 100 };
  const cs = compileConstraints({}, tight);
  const r = checkFeasibility(cs, { compliantCount: 40, bestProteinPerKcal: 0.3 });
  assert.equal(r.feasible, false);
  assert.ok(r.conflicts.some((c) => c.constraint === "energy"));
});

test("checkFeasibility — empty compliant catalog is a hard conflict", () => {
  const cs = compileConstraints({ dietaryStyle: "vegan" }, TARGET);
  const r = checkFeasibility(cs, { compliantCount: 0, bestProteinPerKcal: 0.2 });
  assert.equal(r.feasible, false);
  assert.ok(r.conflicts.some((c) => c.constraint === "exclusions"));
});

test("satisfies — on-target day passes every HARD constraint", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ kcal: 2000, protein: 160, carb: 180, fat: 60 }, cs);
  assert.equal(r.ok, true);
  assert.equal(r.hardUnmet.length, 0);
  assert.equal(r.softOutOfBand.length, 0);
});

test("satisfies — protein below the floor fails (HARD)", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ kcal: 2000, protein: 120, carb: 180, fat: 60 }, cs);
  assert.equal(r.ok, false);
  assert.ok(r.hardUnmet.some((u) => u.constraint === "proteinFloor"));
});

test("satisfies — kcal outside the energy band fails (HARD)", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ kcal: 1800, protein: 160, carb: 180, fat: 60 }, cs);
  assert.equal(r.ok, false);
  assert.ok(r.hardUnmet.some((u) => u.constraint === "energy"));
});

test("satisfies — a soft band miss is reported but does not fail acceptance", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ kcal: 2000, protein: 160, carb: 260, fat: 60 }, cs);
  assert.equal(r.ok, true); // hard constraints still met
  assert.ok(r.softOutOfBand.some((s) => s.constraint === "carbBand"));
});

test("satisfies — accepts a {totals:{...}} envelope", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ totals: { kcal: 2000, protein: 160, carb: 180, fat: 60 } }, cs);
  assert.equal(r.ok, true);
});

test("relaxNext — relaxes the lowest-priority ACTIVE soft first, logging it", () => {
  const cs = compileConstraints({ maxPrepMin: 20, budgetTier: "cheap" }, TARGET);
  const next = relaxNext(cs); // time(4) is lower priority than budget(5) / bands(6)
  assert.equal(next.soft.time.value.maxPrepMin, null);
  assert.equal(next.relaxations.length, 1);
  assert.equal(next.relaxations[0].constraint, "time");
  // original is untouched (pure)
  assert.equal(cs.soft.time.value.maxPrepMin, 20);
  assert.equal(cs.relaxations.length, 0);
});

test("relaxNext — drops the carb band (then advances to fat, then terminates)", () => {
  const cs = compileConstraints({}, TARGET); // only carb/fat bands are active
  const step1 = relaxNext(cs);
  assert.equal(step1.relaxations[0].constraint, "carbBand");
  assert.equal(step1.soft.carbBand.value.lo, null); // dropped, not widened forever
  assert.equal(step1.soft.carbBand.value.hi, null);
  const step2 = relaxNext(step1);
  assert.equal(step2.relaxations[1].constraint, "fatBand");
  assert.equal(relaxNext(step2), null); // nothing left -> terminates
});

test("relaxNext — returns null when nothing soft is left to relax", () => {
  const cs = compileConstraints({}, { kcal: 2000, proteinLo: 150 }); // no bands, no soft profile fields
  assert.equal(relaxNext(cs), null);
});

// --- regression: fixes from the pre-turn-on verification fleet ---------------

test("relaxNext — allowBatch:true is NOT an active constraint (no infinite stick)", () => {
  const cs = compileConstraints({ allowBatch: true, maxPrepMin: 20 }, TARGET);
  assert.equal(relaxNext(cs).relaxations[0].constraint, "time"); // batch(true) is skipped
});

test("relaxNext — always TERMINATES with every soft constraint active", () => {
  let cs = compileConstraints({ allowBatch: false, maxComplexity: 2, maxPrepMin: 20, budgetTier: "cheap" }, TARGET);
  let steps = 0;
  while ((cs = relaxNext(cs)) !== null) { if (++steps > 15) break; }
  assert.ok(steps <= 15, `relaxNext did not terminate (steps=${steps})`);
});

test("checkFeasibility — non-positive kcal with a protein floor is a CONFLICT, never a false pass", () => {
  const cs = compileConstraints({}, { proteinLo: 150 }); // no kcal -> energy.kcal 0
  const r = checkFeasibility(cs, { compliantCount: 40 });
  assert.notEqual(r.feasible, true); // must NOT be a false pass
  assert.ok(r.conflicts.some((c) => c.constraint === "energy"));
});

test("satisfies — a NaN protein total is treated as UNMET (fail-closed)", () => {
  const cs = compileConstraints({}, TARGET);
  const r = satisfies({ kcal: 2000, protein: NaN, carb: 180, fat: 60 }, cs);
  assert.equal(r.ok, false);
  assert.ok(r.hardUnmet.some((u) => u.constraint === "proteinFloor"));
});
