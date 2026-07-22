// Protein-priority mode — Brain v3 scorer. Fixtures are hand-built numbers
// (no live Food/Recipe rows), per the track brief: the food table is known to
// carry ~242 wrong-macro rows from a fuzzy-match import bug and protein values
// are specifically among them, so this validates the WEIGHTING MATH against
// known-correct inputs, not against today's (partly corrupt) live data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scorePlan, clampWeights, DEFAULT_WEIGHTS, PROTEIN_PRIORITY_WEIGHTS } = require("../../src/lib/brain/scorer.js");

const TARGET = { kcal: 2000, proteinLo: 160, proteinHi: 180, fatLo: 55, fatHi: 65, carbLo: 150, carbHi: 220 };

// A day that hits calories dead-on but is meaningfully protein-short (140g
// vs a 160g floor — a real-world "kcal-perfect, protein-thin" plate).
const KCAL_PERFECT_PROTEIN_SHORT = { totals: { kcal: 2000, protein: 140, fat: 60, carb: 190 } };
// A day that meets the floor with room to spare, kcal slightly over.
const FLOOR_MET = { totals: { kcal: 2050, protein: 175, fat: 60, carb: 185 } };
// A day where the floor is unreachable even at the pool's best density — the
// solver should be ABLE to know this from achieved << floor, not guess.
const FAR_SHORT = { totals: { kcal: 2000, protein: 95, fat: 60, carb: 200 } };

test("default mode (no opts.mode): scorePlan is byte-identical to before — no proteinFloor key at all", () => {
  const r = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET);
  assert.equal("proteinFloor" in r, false, "omitting mode must not add a new key to the return shape");
  assert.deepEqual(r.breakdown.weights, DEFAULT_WEIGHTS);
});

test("clampWeights defaults to DEFAULT_WEIGHTS and accepts a custom base", () => {
  assert.deepEqual(clampWeights(), DEFAULT_WEIGHTS);
  const merged = { ...DEFAULT_WEIGHTS, ...PROTEIN_PRIORITY_WEIGHTS };
  assert.deepEqual(clampWeights(undefined, merged), merged);
  // out-of-range proposals still clamp to [0,1] against the custom base
  const w = clampWeights({ protein: 9, kcal: -3 }, merged);
  assert.equal(w.protein, 1);
  assert.equal(w.kcal, 0);
});

test("protein-priority mode elevates protein's weight above kcal's (default mode weights them equally)", () => {
  const r = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" });
  assert.ok(r.breakdown.weights.protein > r.breakdown.weights.kcal, "protein must outweigh kcal in this mode");
  // default mode weights protein and kcal EQUALLY (0.35 each) — priority mode
  // is the one that breaks the tie in protein's favor.
  const d = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET);
  assert.equal(d.breakdown.weights.protein, d.breakdown.weights.kcal);
  assert.ok(r.breakdown.weights.protein > d.breakdown.weights.protein, "protein's weight itself increases under priority mode");
});

test("a kcal-perfect but protein-short day scores WORSE in protein-priority mode than default mode", () => {
  const priority = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" });
  const standard = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET);
  assert.ok(priority.score < standard.score, "the same protein shortfall must cost more when protein is the priority");
});

test("proteinFloor is attached ONLY in protein-priority mode, and is honest about a miss", () => {
  const r = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" });
  assert.equal(r.proteinFloor.met, false);
  assert.equal(r.proteinFloor.floorG, 160); // proteinLo
  assert.equal(r.proteinFloor.achievedG, 140);
  assert.equal(r.proteinFloor.shortG, 20);
  assert.ok(typeof r.proteinFloor.reason === "string" && r.proteinFloor.reason.length > 0, "a miss must always carry a stated reason (never silent)");
});

test("proteinFloor.met is true (and reason null) once achieved protein is within tolerance of the floor", () => {
  const r = scorePlan(FLOOR_MET, TARGET, { mode: "proteinPriority" });
  assert.equal(r.proteinFloor.met, true);
  assert.equal(r.proteinFloor.reason, null);
});

test("a bigger shortfall produces a worse score and a bigger reported gap than a smaller one", () => {
  const small = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" }); // 20g short
  const big = scorePlan(FAR_SHORT, TARGET, { mode: "proteinPriority" }); // 65g short
  assert.ok(big.proteinFloor.shortG > small.proteinFloor.shortG);
  assert.ok(big.score < small.score, "the bigger the miss, the worse the score — monotonic, not a cliff");
});

test("respects an explicit target.proteinFloor override ahead of proteinLo", () => {
  const r = scorePlan(FLOOR_MET, { ...TARGET, proteinFloor: 200 }, { mode: "proteinPriority" });
  assert.equal(r.proteinFloor.floorG, 200);
  assert.equal(r.proteinFloor.met, false); // 175g achieved vs a 200g explicit floor
});

test("LLM-proposed weights are still clamped to [0,1] in protein-priority mode (LAW 1)", () => {
  const r = scorePlan(FLOOR_MET, TARGET, { mode: "proteinPriority", weights: { protein: 50, kcal: -10 } });
  assert.equal(r.breakdown.weights.protein, 1);
  assert.equal(r.breakdown.weights.kcal, 0);
});

test("deterministic: identical inputs give identical output", () => {
  const a = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" });
  const b = scorePlan(KCAL_PERFECT_PROTEIN_SHORT, TARGET, { mode: "proteinPriority" });
  assert.deepEqual(a, b);
});

test("a zero/unset floor never claims false compliance and never divides by zero", () => {
  const r = scorePlan(FLOOR_MET, { ...TARGET, proteinLo: 0, proteinHi: 0 }, { mode: "proteinPriority" });
  assert.equal(Number.isFinite(r.cost), true);
  assert.equal(r.proteinFloor.met, true); // floor 0 => trivially met, never a false "short"
  assert.equal(r.proteinFloor.floorG, 0);
});
