// grocery.js — Brain v3 Stage H. Deterministic, OFFLINE grocery aggregation for
// a brain-built plan, with a defense-in-depth assertNoExcluded pass AFTER
// aggregation: an excluded ingredient can never reappear on a shopping list via
// a combine/substitution step (LAW 2, fail-closed). Reuses the app's existing
// unit-conversion + store-section classifiers so the brain and the deterministic
// solver produce the SAME kind of list. No LLM, no network — ever.
const { convertToPurchaseQuantity, classifyStoreSection } = require("../groceryList.js");
const { explainExclusion } = require("./exclusions.js");

const round1 = (n) => Math.round(n * 10) / 10;
const emptySections = () => ({ produce: [], protein: [], dairy: [], pantry: [], spices: [], other: [] });

// Walk a brain plan into flat ingredient rows. Accepts a bare recipe, a day of
// slots, or a multi-day plan — anything exposing recipes with resolved
// ingredients [{ food:{id,name}, grams }].
function collectIngredients(plan) {
  const recipes = [];
  const push = (r) => { if (r && Array.isArray(r.ingredients)) recipes.push(r); };
  if (plan?.ingredients) push(plan); // a bare recipe
  for (const s of plan?.slots || []) push(s.recipe || s); // a day of slots
  for (const s of plan?.day || []) push(s.recipe || s); // a planDay() result ({ day:[...slots] })
  for (const d of plan?.days || []) for (const s of d.slots || []) push(s.recipe || s); // a week
  const rows = [];
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      if (!ing || !(ing.grams > 0)) continue;
      const name = ing.food?.name ?? ing.name ?? null;
      rows.push({ name, grams: ing.grams, food: ing.food || (name != null ? { name } : null), foodId: ing.food?.id ?? ing.foodId ?? null });
    }
  }
  return rows;
}

// Aggregate by food (id when known, else name), summing grams. One row per food.
function aggregateBrainPlan(plan) {
  const byKey = new Map();
  for (const row of collectIngredients(plan)) {
    const key = `${String(row.name ?? "").toLowerCase().trim()}__${row.foodId ?? ""}`;
    const ex = byKey.get(key);
    if (ex) { ex.grams += row.grams; ex.occurrences += 1; }
    else byKey.set(key, { name: row.name, foodId: row.foodId, food: row.food, grams: row.grams, occurrences: 1 });
  }
  return [...byKey.values()].map((r) => ({ ...r, grams: round1(r.grams) }));
}

// The post-aggregation gate (LAW 2, fail-closed). Re-runs the exclusion engine
// over every aggregated item — an excluded OR unresolvable item is a rejection.
function assertNoExcluded(items, profile) {
  const rejections = [];
  for (const it of items || []) {
    const target = it.food || (it.name != null ? { name: it.name } : null);
    const ex = explainExclusion(target, profile);
    if (ex.excluded) rejections.push({ name: it.name ?? null, reason: ex.reason, failClosed: ex.failClosed });
  }
  return { ok: rejections.length === 0, rejections };
}

/**
 * buildBrainGroceryList(plan, profile) -> { ok, items, bySection, assertion, prov }
 * Aggregates the plan, ASSERTS no excluded item survived aggregation, then builds
 * purchase-unit + store-section rows. If the assertion fails the list is NOT
 * returned as usable (ok:false + rejections) — never a list with a leaked item.
 */
function buildBrainGroceryList(plan, profile) {
  const aggregated = aggregateBrainPlan(plan);
  const assertion = assertNoExcluded(aggregated, profile);
  const prov = { formulaId: "buildBrainGroceryList", inputs: { itemCount: aggregated.length }, value: assertion.ok };
  if (!assertion.ok) return { ok: false, items: [], bySection: emptySections(), assertion, prov };

  const items = aggregated
    .map((row) => ({
      name: row.name,
      section: classifyStoreSection(row.name),
      preparedGrams: row.grams,
      occurrences: row.occurrences,
      purchase: convertToPurchaseQuantity(row.name, row.grams, null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const bySection = emptySections();
  for (const it of items) (bySection[it.section] || bySection.other).push(it);
  return { ok: true, items, bySection, assertion, prov };
}

module.exports = { buildBrainGroceryList, aggregateBrainPlan, assertNoExcluded, collectIngredients };
