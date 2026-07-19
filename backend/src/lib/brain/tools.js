// Brain v3 — the deterministic tool layer (pure/sync, NO LLM). The selector
// (Stage A2) calls these; the model proposes IDs + intents, these tools produce
// the NUMBERS. computeMacros / dayTotals are the ONLY producers of displayed
// macros (LAW 1). Every result carries prov (LAW 3): {formulaId, inputs, value}.
// Tools read ONLY from the pool — an unknown or excluded id is rejected, never
// silently guessed (fail-closed at the tool boundary too).
//
// MacroVector = { kcal, protein_g, carb_g, fat_g }.
const { scaleRecipe } = require("../weeklyPlanner.js");

function prov(formulaId, inputs, value) {
  return { formulaId, inputs, value };
}

// per-100g × grams / 100, summed — the ONE macro formula, mirrored from the
// solver's bundleMacros so the brain and solver can never disagree on a total.
function macrosFromItems(items) {
  return items.reduce(
    (s, it) => {
      const f = (it.grams || 0) / 100;
      const food = it.food || it;
      return {
        kcal: s.kcal + (food.kcal || 0) * f,
        protein_g: s.protein_g + (food.protein || 0) * f,
        carb_g: s.carb_g + (food.carb || 0) * f,
        fat_g: s.fat_g + (food.fat || 0) * f,
      };
    },
    { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }
  );
}

function makeTools(pool, profile = null) {
  const recipes = pool?.recipes instanceof Map ? pool.recipes : new Map();
  const foods = pool?.foods instanceof Map ? pool.foods : new Map();

  function searchRecipes({ query = "", slotType = null, limit = 20 } = {}) {
    const q = String(query).trim().toLowerCase();
    const out = [];
    for (const r of recipes.values()) {
      if (slotType && !(r.slotType === slotType || r.slotType === "either")) continue;
      if (q && !r.name.toLowerCase().includes(q)) continue;
      out.push({ id: r.id, name: r.name, slotType: r.slotType, cuisine: r.cuisine ?? null, kcal: r.kcal, protein: r.protein });
      if (out.length >= limit) break;
    }
    return { value: out, prov: prov("searchRecipes", { query: q, slotType, poolSize: recipes.size }, out.length) };
  }

  function searchFoods({ query = "", limit = 20 } = {}) {
    const q = String(query).trim().toLowerCase();
    const out = [];
    for (const f of foods.values()) {
      if (q && !f.name.toLowerCase().includes(q)) continue;
      out.push({ id: f.id, name: f.name, category: f.category ?? null });
      if (out.length >= limit) break;
    }
    return { value: out, prov: prov("searchFoods", { query: q, poolSize: foods.size }, out.length) };
  }

  // items: [{ foodId, grams }] — foodId MUST resolve against the pool (an
  // unknown/excluded id throws, never a silent 0). Returns a MacroVector + prov.
  function computeMacros({ items = [] } = {}) {
    const resolved = items.map((it) => {
      const food = it.food || (it.foodId != null ? foods.get(it.foodId) : null);
      if (!food) throw new Error(`computeMacros: foodId "${it.foodId}" is not in the pool (unknown or excluded)`);
      return { food, grams: it.grams };
    });
    const value = macrosFromItems(resolved);
    return { value, prov: prov("computeMacros", { items: items.map((i) => ({ foodId: i.foodId, grams: i.grams })) }, value) };
  }

  // Wraps the solver's authoritative 2-factor scaleRecipe. Recipe MUST be in the
  // pool. Returns MacroVector + the resolved gram-level ingredients + prov.
  function scaleRecipeTool({ recipeId, kcalTarget, proteinTarget } = {}) {
    const recipe = recipes.get(recipeId);
    if (!recipe) throw new Error(`scaleRecipe: recipe "${recipeId}" is not in the pool (unknown or excluded)`);
    const scaled = scaleRecipe(recipe, kcalTarget, proteinTarget);
    const value = { kcal: scaled.kcal, protein_g: scaled.protein, carb_g: scaled.carb, fat_g: scaled.fat };
    return {
      value,
      ingredients: scaled.ingredients,
      proteinScale: scaled.proteinScale,
      sidesScale: scaled.sidesScale,
      prov: prov("scaleRecipe", { recipeId, kcalTarget, proteinTarget }, value),
    };
  }

  // Sum a day's already-computed slots. Accepts solver slot shape (kcal/protein)
  // or MacroVector shape (protein_g/…) or a {value} wrapper. Returns MacroVector + prov.
  function dayTotals({ slots = [] } = {}) {
    const value = slots.reduce(
      (s, sl) => {
        const v = sl.value || sl;
        return {
          kcal: s.kcal + (v.kcal || 0),
          protein_g: s.protein_g + (v.protein_g ?? v.protein ?? 0),
          carb_g: s.carb_g + (v.carb_g ?? v.carb ?? 0),
          fat_g: s.fat_g + (v.fat_g ?? v.fat ?? 0),
        };
      },
      { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }
    );
    return { value, prov: prov("dayTotals", { slotCount: slots.length }, value) };
  }

  return { searchRecipes, searchFoods, scaleRecipe: scaleRecipeTool, computeMacros, dayTotals };
}

module.exports = { makeTools, macrosFromItems };
