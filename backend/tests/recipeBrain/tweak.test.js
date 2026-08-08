const { test } = require("node:test");
const assert = require("node:assert/strict");

const { refit, verdict, roleBundles, QUALITY_WEIGHTS } = require("../../src/lib/recipeBrain/tweak.js");
const { buildSpec } = require("../../src/lib/recipeBrain/spec.js");
const { scaleRecipe, SCALE_BOUNDS } = require("../../src/lib/weeklyPlanner.js");

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE BRAIN — the tweak engine. The load-bearing claims under test:
//   1. with no fat/carb guidance, refit IS the portion brain (two-factor,
//      untouched) — zero behavioural drift on the existing path;
//   2. the guarded repartition only ever REPLACES a two-factor result when it
//      measurably improves the deviation while still passing the slot gate;
//   3. scaling can never add/remove/substitute an ingredient (the structural
//      allergy invariant);
//   4. every scale stays inside the same 0.5–2 box the server validates.
// Pure, zero network, zero DB.
// ─────────────────────────────────────────────────────────────────────────────

const food = (name, kcal, protein, fat, carb) => ({ name, kcal, protein, fat, carb });
const ing = (f, baseGrams, role, scalable = true) => ({ foodId: f.name, baseGrams, role, scalable, food: f });
const mk = (id, ings, over = {}) => {
  const t = ings.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name: id, slotType: "meal", ingredients: ings, steps: [], ...t, ...over };
};

const CHICKEN = food("chicken", 165, 31, 3.6, 0);
const RICE = food("rice", 130, 2.7, 0.3, 28);
const SALMON = food("salmon", 208, 20, 13, 0);
const OIL = food("olive oil", 884, 0, 100, 0);
const BROCCOLI = food("broccoli", 34, 2.8, 0.4, 7);

const DAY = { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210, keto: false };
const TARGET = { slotType: "meal", kcalTarget: 620, proteinTarget: 45 };

test("no fat/carb guidance → refit is byte-identical to the solver's own two-factor scale", () => {
  const dish = mk("chicken-rice", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")]);
  const spec = buildSpec({ target: TARGET }); // no dailyTarget → no bands
  const out = refit(dish, spec);
  assert.equal(out.method, "two-factor");
  assert.equal(out.accepted, false);
  const solver = scaleRecipe(dish, 620, 45);
  assert.deepEqual(out.scaled, solver, "the portion brain's result, untouched");
});

test("two-factor already inside the bands → repartition is not even attempted", () => {
  const dish = mk("chicken-rice", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb")]);
  const spec = buildSpec({ target: TARGET, dailyTarget: { ...DAY, fatLo: 5, fatHi: 60, carbLo: 5, carbHi: 350 } });
  const out = refit(dish, spec);
  assert.equal(out.method, "two-factor");
  assert.match(out.prov.note, /two-factor stands/);
});

test("fat-heavy dish + fat guidance → guarded repartition accepts only a measured improvement", () => {
  // Salmon + oil + rice + broccoli: the fat rides in its own bundles, so role
  // repartition CAN cut it while two-factor (protein vs everything-else)
  // cannot cut oil without also cutting the carbs it needs.
  const dish = mk("salmon-oil-rice", [
    ing(SALMON, 140, "protein"), ing(OIL, 25, "fat"), ing(RICE, 120, "carb"), ing(BROCCOLI, 100, "veg"),
  ]);
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY }); // fat band ≈ 16.2–19.2 g for this slot
  const out = refit(dish, spec);
  assert.ok(out.verdicts.twoFactor.fatMiss > 0, "precondition: the two-factor result is over the fat guidance");
  if (out.accepted) {
    assert.equal(out.method, "repartition");
    assert.ok(out.verdicts.repartition.quality < out.verdicts.twoFactor.quality, "accepted means measurably better");
    assert.ok(out.verdicts.repartition.slotOk, "and still inside the solver's slot gate");
    assert.ok(out.verdicts.repartition.fatMiss <= out.verdicts.twoFactor.fatMiss, "the fat axis actually moved toward the band");
    for (const s of Object.values(out.scaled.roleScales)) {
      assert.ok(s >= SCALE_BOUNDS.min - 1e-9 && s <= SCALE_BOUNDS.max + 1e-9, "every role scale inside the server's 0.5–2 box");
    }
  } else {
    // The guard refusing is a LEGAL outcome — but then the shipped result must
    // be the two-factor one and the refusal must be named.
    assert.equal(out.method, "two-factor");
    assert.ok(out.prov.rejectedBecause, "a refused repartition names its reason");
  }
});

test("the guard refuses a repartition that would break the slot gate — two-factor survives", () => {
  const dish = mk("salmon-oil", [ing(SALMON, 140, "protein"), ing(OIL, 25, "fat"), ing(RICE, 120, "carb")]);
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY });
  // Force the "improvement" to fail the slot gate: a solver that returns
  // garbage scales. The guard must throw it away.
  const out = refit(dish, spec, {
    solvePortionsImpl: () => ({ scales: [SCALE_BOUNDS.min, SCALE_BOUNDS.min, SCALE_BOUNDS.min], macros: {}, residual: 0 }),
  });
  assert.equal(out.method, "two-factor", "a repartition that misses the gate never ships");
  assert.equal(out.accepted, false);
  assert.ok(["would break the slot kcal/protein gate", "did not strictly improve quality"].includes(out.prov.rejectedBecause));
});

test("STRUCTURAL ALLERGY INVARIANT: refit never adds, removes, or renames an ingredient", () => {
  const dish = mk("four-part", [ing(SALMON, 140, "protein"), ing(OIL, 25, "fat"), ing(RICE, 120, "carb"), ing(BROCCOLI, 100, "veg")]);
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY });
  const out = refit(dish, spec);
  const before = dish.ingredients.map((i) => i.foodId).sort();
  const after = out.scaled.ingredients.map((i) => i.foodId).sort();
  assert.deepEqual(after, before);
  for (const row of out.scaled.ingredients) assert.ok(row.grams >= 0);
});

test("fixed (non-scalable) ingredients ship at 1× through both moves", () => {
  const egg = food("egg", 155, 13, 11, 1);
  const dish = mk("with-fixed", [ing(CHICKEN, 150, "protein"), ing(RICE, 150, "carb"), ing(egg, 50, "other", false)]);
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY });
  const out = refit(dish, spec);
  const eggRow = out.scaled.ingredients.find((i) => i.foodId === "egg");
  assert.equal(eggRow.grams, 50, "a fixed row is never scaled by either move");
});

test("keto ceiling: a repartition that would breach the diet law is rejected, not trimmed", () => {
  const dish = mk("keto-edge", [ing(CHICKEN, 150, "protein"), ing(RICE, 200, "carb"), ing(OIL, 10, "fat")], { dietGuardStyle: "keto" });
  const spec = buildSpec({
    target: TARGET,
    dailyTarget: { ...DAY, keto: true, carbLo: 10, carbHi: 25 },
    profile: { dietaryStyle: "keto" },
  });
  const out = refit(dish, spec);
  // Whatever ships must be a legal outcome: either null (unrepairable at any
  // portion) or a scaled result that the diet ceiling accepted.
  if (out.scaled) {
    assert.ok(["two-factor", "repartition"].includes(out.method));
    if (out.method === "repartition") assert.notEqual(out.prov.rejectedBecause, "diet carb ceiling");
  } else {
    assert.match(out.prov.reason, /carb ceiling/);
  }
});

test("verdict math: quality is the documented weighted sum and slotOk mirrors the solver's tolerances", () => {
  const spec = buildSpec({ target: TARGET, dailyTarget: DAY });
  const dead_on = verdict({ kcal: 620, protein: 45, fat: 17.5, carb: 57 }, spec);
  assert.equal(dead_on.slotOk, true);
  assert.equal(dead_on.quality, 0);
  const off = verdict({ kcal: 620 * 1.3, protein: 45, fat: 17.5, carb: 57 }, spec);
  assert.equal(off.slotOk, false, "30% over calories is outside the slot gate");
  assert.ok(off.quality > 0);
  assert.equal(QUALITY_WEIGHTS.kcal, 1, "kcal weight is load-bearing and pinned");
});

test("roleBundles: protein bundle first, fixed rows separated, null roles pooled into other", () => {
  const dish = mk("bundles", [
    ing(RICE, 100, "carb"), ing(CHICKEN, 100, "protein"), ing(OIL, 10, null), ing(food("salt", 0, 0, 0, 0), 2, "other", false),
  ]);
  const { fixed, bundles } = roleBundles(dish);
  assert.equal(bundles[0].key, "protein", "protein bundle leads (optimizer k=2 parity expects it)");
  assert.equal(fixed.length, 1);
  assert.ok(bundles.find((b) => b.key === "other").ingredients.some((i) => i.foodId === "olive oil"), "null role pools into other");
});
