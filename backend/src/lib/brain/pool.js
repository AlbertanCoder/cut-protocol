// Brain v3 — the filtered candidate pool (LAW 2). Exclusions are applied ONCE,
// here, in code, BEFORE any LLM turn runs. The tool layer then reads ONLY from
// this pool, so the model is structurally unable to surface an excluded item —
// it never sees one. Fail-closed (unresolvable) exclusions are recorded in
// filterSpec.failClosed so the caller can LOG them; they are still removed.
//
// `library` is injected (already loaded from Prisma by the caller), keeping this
// module pure and unit-testable with no DB.
const { explainExclusion } = require("./exclusions.js");

/**
 * buildPool(profile, library, constraints) -> {
 *   recipes:     Map<id, recipe>,   // kept recipes, keyed by id
 *   foods:       Map<id, food>,     // kept foods, keyed by id
 *   excludedIds: Set<id>,           // every recipe/food id removed by exclusions
 *   filterSpec:  {...}              // what was applied + counts + fail-closed log
 * }
 * library: { recipes: [...], foods: [...] }
 * constraints: recorded on filterSpec for later stages (prep/budget/time); only
 * LAW-2 exclusions are enforced at pool-build time.
 */
function buildPool(profile, library = {}, constraints = {}) {
  const recipesIn = Array.isArray(library.recipes) ? library.recipes : [];
  const foodsIn = Array.isArray(library.foods) ? library.foods : [];

  const recipes = new Map();
  const foods = new Map();
  const excludedIds = new Set();
  const failClosed = [];
  let recipesOut = 0;
  let foodsOut = 0;

  for (const r of recipesIn) {
    const { excluded, failClosed: fc, reason } = explainExclusion(r, profile);
    if (excluded) {
      excludedIds.add(r.id);
      recipesOut++;
      if (fc) failClosed.push({ kind: "recipe", id: r.id, name: r.name, reason });
    } else {
      recipes.set(r.id, r);
    }
  }
  for (const f of foodsIn) {
    const { excluded, failClosed: fc, reason } = explainExclusion(f, profile);
    if (excluded) {
      excludedIds.add(f.id);
      foodsOut++;
      if (fc) failClosed.push({ kind: "food", id: f.id, name: f.name, reason });
    } else {
      foods.set(f.id, f);
    }
  }

  const filterSpec = {
    dietaryStyle: profile?.dietaryStyle || "none",
    excludedFoods: Array.isArray(profile?.excludedFoods) ? [...profile.excludedFoods] : [],
    constraints: { ...constraints },
    counts: {
      recipesIn: recipesIn.length, recipesKept: recipes.size, recipesOut,
      foodsIn: foodsIn.length, foodsKept: foods.size, foodsOut,
    },
    failClosed,
  };
  return { recipes, foods, excludedIds, filterSpec };
}

module.exports = { buildPool };
