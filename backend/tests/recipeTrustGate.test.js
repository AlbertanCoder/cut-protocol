// The ingredient-trust gate on the PLAN path (QC 2026-08-10 finding 2, owner
// ruling 2026-08-12: "Exclude flagged recipes from the solver pool for the
// trial").
//
// A recipe carrying ANY untrusted (non-placeholder) ingredient row must never
// become a solver candidate — the audit's 131-recipe set, per the owner's
// ruling. The worst case is a systematically UNDER-counted cut, which the
// adaptive loop then compounds by lowering the target in response to the
// phantom stall. The gate lives at the one plan-pool chokepoint
// (planContext.filterRecipePool) so no plan entry point — generate, day
// options, swap alternates, apply, place-recipe, fill-today-from-cart, the
// router's draft screen — can bypass it.
//
// Browse is deliberately NOT gated: the Recipes tab keeps showing flagged
// recipes, named in their trust detail (frontend/src/lib/recipeTrust.js) —
// the visible half of this same verdict. The amber ROW marker stays at the
// display-only MATERIAL_SHARE loudness threshold.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  recipeTrustExclusion, explainRecipeExclusion, partitionRecipes,
} = require("../src/lib/exclusionGate.js");
const { filterRecipePool } = require("../src/lib/planContext.js");
const { generateWeekPlan, buildSlots, targetsForSlots } = require("../src/lib/weeklyPlanner.js");
const { alternatesForSlot, diagnose, classifyBinding } = require("../src/lib/mealSolver.js");

// ── fixtures — same DB-row shape the gated surfaces load ─────────────────
function food(name, over = {}) {
  return { id: `f-${name}`, name, category: "other", kcal: 100, protein: 5, fat: 2, carb: 10, fiber: 0, ...over };
}
function recipe(name, ings, over = {}) {
  return {
    id: `r-${name}`, name, slotType: "meal", mealCategory: null, cuisine: null,
    kcal: 400, protein: 30, fat: 12, carb: 40, steps: ["Cook it."],
    ingredients: ings.map(([f, baseGrams, role]) => ({
      id: `i-${f.id}`, foodId: f.id, baseGrams, scalable: true, role: role || null, food: f,
    })),
    ...over,
  };
}
// A solvable meal (mirrors weeklyPlanner.test.js's flexibleRecipe): protein
// role scales independently of the sides, so it can land a wide target range.
function flexibleRecipe(id, over = {}) {
  const protein = food(`${id}-protein`, { kcal: 165, protein: 31, fat: 3.6, carb: 0, ...(over.proteinFood || {}) });
  const carb = food(`${id}-carb`, { kcal: 130, protein: 2.7, fat: 0.3, carb: 28, ...(over.carbFood || {}) });
  return recipe(id, [[protein, 150, "protein"], [carb, 150, "carb"]], { kcal: 400, protein: 30, fat: 12, carb: 40 });
}

const QUARANTINED = { source: "quarantined" };
const NO_RULES = { dietaryStyle: null, excludedFoods: [] };
const DAILY = { kcal: 2000, proteinLo: 180, proteinHi: 200 };

// ── the predicate itself ─────────────────────────────────────────────────

test("ANY untrusted non-placeholder row excludes, however small its share (owner ruling 2026-08-12); the frontend twin still declares its display threshold", () => {
  const clean = food("rice", { kcal: 100 });
  const bad = food("mystery", { kcal: 100, ...QUARANTINED });
  // a dominant untrusted row -> excluded, and share still reports the scale
  const heavy = recipe("heavy", [[bad, 600], [clean, 400]]);
  assert.equal(recipeTrustExclusion(heavy).excluded, true);
  assert.equal(recipeTrustExclusion(heavy).share, 0.6);
  // a MINOR untrusted row -> STILL excluded: the gate is any-flagged, not
  // share-based — the solver takes no bet of any size on wrong-food macros.
  const pinch = recipe("pinch", [[bad, 20], [clean, 980]]);
  const v = recipeTrustExclusion(pinch);
  assert.equal(v.excluded, true, "a small wrong-record row must still exclude");
  assert.equal(v.untrustedCount, 1);
  assert.ok(v.share < 0.1, "the fixture must be genuinely minor, or this is vacuous");
  // untouched clean recipe -> nothing flagged, eligible
  const cleanR = recipe("clean", [[clean, 500]]);
  assert.deepEqual(recipeTrustExclusion(cleanR), { excluded: false, share: 0, flaggedCount: 0, untrustedCount: 0 });
  // the frontend keeps its own DISPLAY threshold; it deliberately no longer
  // mirrors the gate (any-flagged is stricter than the amber row marker).
  const twin = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "lib", "recipeTrust.js"), "utf8");
  assert.ok(/export const MATERIAL_SHARE = /.test(twin), "the display-side threshold moved or vanished — re-check both sides of the trust story");
});

test("provenance-cleared dataQuality counts as untrusted; zero-kcal placeholders are flagged but cannot move the share", () => {
  const cleared = food("cleared", { kcal: 200, dataQuality: 'exception:provenance-cleared — carried fdcId 169225 ("Cucumber, peeled, raw")' });
  const r = recipe("cleared-heavy", [[cleared, 400], [food("side", { kcal: 100 }), 100]]);
  assert.equal(recipeTrustExclusion(r).excluded, true, "800 of 900 kcal carry another food's record");

  const placeholder = food("tbd", { kcal: 0, protein: 0, fat: 0, carb: 0, source: "manual-placeholder" });
  const p = recipe("placeholder-only-flag", [[placeholder, 100], [food("main", { kcal: 300 }), 200]]);
  const verdict = recipeTrustExclusion(p);
  assert.equal(verdict.flaggedCount, 1, "the placeholder is reported");
  assert.equal(verdict.untrustedCount, 0, "placeholders are not wrong-record rows");
  assert.equal(verdict.excluded, false, "placeholders belong to the placeholder gate, not the trust gate");
});

// ── the plan pool — every entry point builds through filterRecipePool ────

test("filterRecipePool drops every recipe carrying an untrusted row — heavy or minor — and keeps clean ones", () => {
  const material = recipe("material", [[food("m1", { kcal: 200, ...QUARANTINED }), 300], [food("m2", { kcal: 100 }), 100]]);
  const minor = recipe("minor", [[food("n1", { kcal: 100, ...QUARANTINED }), 50], [food("n2", { kcal: 200 }), 300]]);
  const cleanR = flexibleRecipe("cleanflex");
  const pool = filterRecipePool([material, minor, cleanR], NO_RULES);
  assert.deepEqual(pool.map((r) => r.id), ["r-cleanflex"]);
});

test("BROWSE is untouched — the exclusion gate's own verdict still allows the flagged recipe", () => {
  const material = recipe("material", [[food("m1", { kcal: 200, ...QUARANTINED }), 300]]);
  assert.equal(explainRecipeExclusion(material, NO_RULES).excluded, false,
    "GET /recipes must keep showing it (with its amber marker) — hiding it would bury the data problem");
  const { allowed } = partitionRecipes([material], NO_RULES);
  assert.equal(allowed.length, 1);
});

// ── (a) a recipe above the threshold never appears in a generated plan ───

test("an untrusted recipe never appears in a generated plan, even as the best macro fit", async () => {
  // The flagged recipe is macro-identical to the clean ones — if it were
  // eligible, the solver would happily serve it. Both its foods are
  // quarantined, so 100% of its stated calories are another food's numbers.
  const flagged = flexibleRecipe("too-good-to-be-true", { proteinFood: QUARANTINED, carbFood: QUARANTINED });
  // 12 clean recipes x the 2-per-week variety cap = 24 servings for 21 meal
  // slots — deep enough that an unfilled slot could only mean a gate bug.
  const raw = [flagged, ...Array.from({ length: 12 }, (_, i) => flexibleRecipe(`flex${i}`))];
  const pool = filterRecipePool(raw, NO_RULES);
  assert.equal(pool.some((r) => r.id === flagged.id), false);

  const plan = await generateWeekPlan(DAILY, { meals: 3, snacks: 0 }, pool, { rng: () => 0.5 });
  assert.ok(plan.length > 0, "the clean pool still solves a week");
  assert.equal(plan.some((s) => s.recipeId === flagged.id), false, "the flagged recipe reached a plan slot");
  assert.equal(plan.every((s) => s.recipeId), true, "clean recipes fill every slot — the gate cost nothing here");
});

// ── (b) placeholder-flagged stays eligible HERE (its own gate owns it) ───

test("a recipe whose only flag is a zero-kcal placeholder still reaches a generated plan", async () => {
  const placeholder = food("tbd2", { kcal: 0, protein: 0, fat: 0, carb: 0, source: "manual-placeholder" });
  const protein = food("mb-protein", { kcal: 165, protein: 31, fat: 3.6, carb: 0 });
  const carb = food("mb-carb", { kcal: 130, protein: 2.7, fat: 0.3, carb: 28 });
  const withPh = recipe("ph-flag", [[protein, 150, "protein"], [carb, 150, "carb"], [placeholder, 10]]);
  assert.equal(recipeTrustExclusion(withPh).excluded, false);
  assert.equal(recipeTrustExclusion(withPh).flaggedCount, 1, "the fixture must actually carry a flag, or this is vacuous");

  const pool = filterRecipePool([withPh], NO_RULES);
  assert.equal(pool.length, 1);
  const plan = await generateWeekPlan(DAILY, { meals: 3, snacks: 0 }, pool, { rng: () => 0.5 });
  assert.equal(plan.some((s) => s.recipeId === withPh.id), true, "the trust gate must not annex the placeholder gate's territory");
});

// ── (c) swap alternates respect the gate ─────────────────────────────────

test("swap alternates never offer an untrusted recipe (route composition: planContext pool -> alternatesForSlot)", async () => {
  const flagged = flexibleRecipe("flagged-alt", { proteinFood: QUARANTINED, carbFood: QUARANTINED });
  const raw = [flagged, flexibleRecipe("alt1"), flexibleRecipe("alt2"), flexibleRecipe("alt3"), flexibleRecipe("alt4")];
  const recipePool = filterRecipePool(raw, NO_RULES); // exactly what the /alternates route hands over
  const slotTarget = targetsForSlots(DAILY, buildSlots({ meals: 3, snacks: 0 }))
    .find((s) => s.dayOfWeek === 0 && s.slotType === "meal" && s.slotIndex === 0);
  const alternates = await alternatesForSlot({
    slotTarget, recipePool, existingSlots: [], filters: {}, excludeRecipeIds: [], rng: () => 0.5,
  });
  assert.ok(alternates.length > 0, "the clean pool must produce alternates, or the exclusion assertion is vacuous");
  assert.equal(alternates.some((a) => a.recipeId === flagged.id), false, "a swap alternate bypassed the trust gate");

  // …and a minor untrusted row is enough to keep a recipe out of the
  // alternates too — the gate has no small-share mercy on any path.
  const minor = flexibleRecipe("minor-alt");
  minor.ingredients.push({ id: "i-minor-bad", foodId: "f-minor-bad", baseGrams: 50, scalable: true, role: null, food: food("minor-bad", { kcal: 100, ...QUARANTINED }) });
  const minorPool = filterRecipePool([minor], NO_RULES);
  assert.equal(minorPool.length, 0, "any-flagged means the minor-flagged recipe never enters the pool");
  const minorOnly = await alternatesForSlot({
    slotTarget, recipePool: minorPool, existingSlots: [], filters: {}, excludeRecipeIds: [], rng: () => 0.5,
  });
  assert.equal(minorOnly.some((a) => a.recipeId === minor.id), false);
});

// ── the honesty layer — the removal is named, never silent ───────────────

test("diagnose() names the trust gate's removals whenever it reports at all, and never blames diet rules for them", () => {
  // Trust alone emptied the library: the diet/allergy sentence must NOT appear.
  const emptied = diagnose({
    counts: { raw: 5, trustExcluded: 5, afterDiet: 0, afterPrep: 0 },
    filters: {}, dailyTarget: DAILY, mealConfig: { meals: 3, snacks: 0 }, pool: [],
  });
  assert.equal(emptied.feasible, false);
  assert.ok(emptied.reasons.some((r) => /nutrition data isn't trusted/.test(r)), "the trust removal must be named");
  assert.equal(emptied.reasons.some((r) => /dietary style \+ allergy rules/.test(r)), false,
    "billing a trust removal to diet rules makes the user fix the wrong thing");
  assert.equal(emptied.reasons.join(" ").includes("allerg"), false, "never steer anyone toward loosening allergies");

  // A rough-but-nonempty pool: the trust note rides along with the real reasons.
  const thin = diagnose({
    counts: { raw: 900, trustExcluded: 7, afterDiet: 2, afterPrep: 2 },
    filters: {}, dailyTarget: DAILY, mealConfig: { meals: 3, snacks: 0 },
    pool: [flexibleRecipe("a"), flexibleRecipe("b")].map((r) => filterRecipePool([r], NO_RULES)[0]),
  });
  assert.equal(thin.feasible, false);
  assert.ok(thin.reasons.some((r) => /7 recipe\(s\) sit out of planning/.test(r)));

  // A healthy pool with trust removals stays FEASIBLE — the note never
  // manufactures an infeasibility on its own (it appears in poolCounts instead).
  const healthyPool = Array.from({ length: 40 }, (_, i) => flexibleRecipe(`ok${i}`));
  const healthy = diagnose({
    counts: { raw: 47, trustExcluded: 7, afterDiet: 40, afterPrep: 40 },
    filters: {}, dailyTarget: DAILY, mealConfig: { meals: 3, snacks: 0 }, pool: healthyPool,
  });
  assert.equal(healthy.feasible, true);
  assert.deepEqual(healthy.reasons, []);
});

test("classifyBinding attributes an emptied pool honestly when the trust gate did part of the emptying", () => {
  const b = classifyBinding({
    counts: { raw: 10, trustExcluded: 4, afterDiet: 0, afterPrep: 0 },
    filters: {}, dailyTarget: DAILY, mealConfig: { meals: 3, snacks: 0 }, pool: [],
  });
  assert.equal(b.key, "dietary-rules");
  assert.match(b.detail, /4 of them by the ingredient-trust gate/);
});
