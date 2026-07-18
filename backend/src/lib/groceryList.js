// Grocery list generation. Ported (CommonJS syntax only, logic unchanged)
// from recomp-v2/src/engine/groceryList.js — "aggregate across the plan,
// convert to raw/dry purchase quantities via yields, group by store section,
// cost from the local editable CAD price table, all labeled estimates."
//
// This replaces the plain macro-category grouping (no unit conversion, no
// cost) that previously lived inline in routes/plans.js's grocery-list
// route. Consumed via an adapter (see routes/plans.js) that reshapes
// cut-protocol's Plan/PlanSlot data into the {meals:[{status,anchor,adjusters}]}
// contract this module expects — cut-protocol's PlanSlot.ingredients has no
// per-ingredient raw/cooked/dry `state` field (confirmed against
// schema.prisma), so `state` is passed through as undefined rather than
// guessed; convertToPurchaseQuantity()'s own honest "state unrecorded"
// fallback handles that correctly without this file needing any change.

const { lookupYieldFromRaw } = require("./groceryYields.js");
const { estimateCostCad } = require("./groceryPrices.js");

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------
// Yield conversion: prepared (cooked) grams -> raw/dry purchase grams.
// ---------------------------------------------------------------------

/**
 * name: ingredient/adjuster display name.
 * grams: as-solved grams (the quantity actually eaten/portioned).
 * state: 'raw' | 'cooked' | 'dry' | undefined.
 *
 * Returns { grams, form, isConverted, yieldFactor }:
 *   - already raw/dry -> unchanged, isConverted: false (nothing to convert).
 *   - cooked + known yield -> converted via groceryYields.js, isConverted: true.
 *   - cooked + UNKNOWN yield, or state unrecorded -> grams pass through
 *     unchanged but explicitly labeled as NOT a purchase quantity, never
 *     silently presented as a shopping-list raw quantity.
 */
function convertToPurchaseQuantity(name, grams, state) {
  if (state === "raw" || state === "dry") {
    return { grams: round1(grams), form: state, isConverted: false, yieldFactor: null };
  }
  if (state === "cooked") {
    const yieldFactor = lookupYieldFromRaw(name);
    if (yieldFactor) {
      return {
        grams: round1(grams / yieldFactor),
        form: yieldFactor > 1 ? "dry" : "raw",
        isConverted: true,
        yieldFactor,
      };
    }
    return {
      grams: round1(grams),
      form: "as-prepared (cooked) — no known yield factor, NOT a raw/dry purchase quantity",
      isConverted: false,
      yieldFactor: null,
    };
  }
  return {
    grams: round1(grams),
    form: "as-prepared (state unrecorded) — NOT a raw/dry purchase quantity",
    isConverted: false,
    yieldFactor: null,
  };
}

// ---------------------------------------------------------------------
// Store-section classification - lightweight keyword matcher, checked in
// this order: protein, dairy, spices, produce, pantry, other.
// ---------------------------------------------------------------------

const PROTEIN_WORDS = [
  "chicken", "turkey", "duck", "beef", "pork", "bacon", "ham", "steak",
  "sirloin", "flank", "jerky", "elk", "venison", "bison", "lamb", "mutton",
  "veal", "sausage", "meatball",
  "salmon", "tuna", "fish", "cod", "tilapia", "halibut", "trout", "shrimp",
  "scallop", "prawn",
  "egg", "eggs", "tofu", "tempeh",
];
const DAIRY_WORDS = [
  "milk", "cheese", "yogurt", "yoghurt", "cream", "butter", "buttermilk",
  "ghee", "whey", "casein", "kefir", "custard", "skyr",
];
const SPICE_WORDS = [
  "salt", "pepper", "cumin", "paprika", "cinnamon", "nutmeg", "allspice",
  "turmeric", "curry powder", "chili powder", "chilli powder",
  "baking powder", "baking soda", "yeast", "extract", "vanilla", "oregano",
  "cayenne", "seasoning", "clove", "bay leaf", "basil", "thyme", "rosemary",
  "cilantro", "mint", "dill", "spice",
];
const PRODUCE_WORDS = [
  "onion", "shallot", "tomato", "potato", "sweet potato", "carrot", "celery",
  "lemon", "lime", "orange", "apple", "banana", "spinach", "lettuce",
  "cabbage", "kale", "cucumber", "broccoli", "cauliflower", "zucchini",
  "mushroom", "garlic", "ginger", "avocado", "berry", "blueberry",
  "blueberries", "strawberry", "strawberries", "grape", "mango",
  "pineapple", "peach", "pear", "plum", "kiwi",
];
const PANTRY_WORDS = [
  "rice", "pasta", "noodle", "quinoa", "oats", "oatmeal", "flour", "sugar",
  "honey", "syrup", "oil", "vinegar", "sauce", "broth", "stock", "bean",
  "lentil", "chickpea", "bread", "tortilla", "cracker", "cereal", "nut",
  "almond", "walnut", "cashew", "peanut", "pecan", "pistachio", "hazelnut",
  "seed", "breadcrumb", "panko", "cornstarch", "cocoa", "chocolate", "couscous",
];

function hasWord(name, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "(?:es|s)?\\b", "i").test(name);
}
function matchesAny(name, words) {
  return words.some((w) => hasWord(name, w));
}

// "Butter Beans", "Peanut Butter", "Coconut Cream", "Almond Milk" all carry a
// dairy word without being dairy — a plant/legume qualifier vetoes the dairy
// match. "Buttermilk" is one word, so no qualifier fires and it stays dairy.
const NON_DAIRY_QUALIFIERS = [
  "bean", "peanut", "almond", "cashew", "coconut", "soy", "soya", "oat",
  "rice", "hemp", "nut",
];
function isDairyName(name) {
  if (!matchesAny(name, DAIRY_WORDS)) return false;
  return !matchesAny(name, NON_DAIRY_QUALIFIERS);
}

// Fresh peppers are produce; "pepper" alone (black pepper, pepper flakes)
// stays a spice.
const FRESH_PEPPER_WORDS = [
  "bell pepper", "sweet pepper", "jalapeno", "jalapeño", "poblano",
  "serrano", "habanero", "banana pepper",
];
function isSpiceName(name) {
  if (!matchesAny(name, SPICE_WORDS)) return false;
  return !matchesAny(name, FRESH_PEPPER_WORDS);
}

function classifyStoreSection(name) {
  if (matchesAny(name, PROTEIN_WORDS)) return "protein";
  if (isDairyName(name)) return "dairy";
  if (isSpiceName(name)) return "spices";
  if (matchesAny(name, PRODUCE_WORDS) || matchesAny(name, FRESH_PEPPER_WORDS)) return "produce";
  if (matchesAny(name, PANTRY_WORDS)) return "pantry";
  return "other";
}

// ---------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------

// Walks a `{meals:[...]}` or `{days:[{meals:[...]}]}` shaped result and
// returns every SOLVED meal found (status === "solved"). An unsolved/
// unassigned slot contributes nothing to the grocery list.
function collectSolvedMeals(planResult) {
  if (!planResult) return [];
  if (Array.isArray(planResult.meals)) {
    return planResult.meals.filter((m) => m.status === "solved");
  }
  if (Array.isArray(planResult.days)) {
    return planResult.days.flatMap((day) => (Array.isArray(day.meals) ? day.meals.filter((m) => m.status === "solved") : []));
  }
  return [];
}

// One row per (name, state) pair - grams are only ever summed within the
// same prep state, so a name appearing in two different states across meals
// produces two honest line items rather than one blended, meaningless total.
function aggregateIngredients(meals) {
  const byKey = new Map();
  for (const meal of meals) {
    const rows = [
      ...(meal.anchor?.ingredients || []).map((ing) => ({ name: ing.name, grams: ing.grams, state: ing.state })),
      ...(meal.adjusters || []).map((adj) => ({ name: adj.name, grams: adj.grams, state: adj.state })),
    ];
    for (const row of rows) {
      if (!row.grams || row.grams <= 0) continue;
      const key = `${row.name.toLowerCase().trim()}__${row.state || "unknown"}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.preparedGrams += row.grams;
        existing.occurrences += 1;
      } else {
        byKey.set(key, { name: row.name, state: row.state, preparedGrams: row.grams, occurrences: 1 });
      }
    }
  }
  return [...byKey.values()];
}

/**
 * planResult: any object exposing `.meals` / `.days[].meals` of
 * {status, anchor:{ingredients:[{name,grams,state}]}, adjusters:[{name,grams,state}]}
 * shaped entries.
 *
 * Returns:
 *   items: [{ name, section, state, preparedGrams, occurrences,
 *             purchase: { grams, form, isConverted, yieldFactor },
 *             cost: { amountCad, isEstimate: true, note } | null }]
 *   bySection: { produce: [...], protein: [...], dairy: [...],
 *                pantry: [...], spices: [...], other: [...] }
 *   totalEstimatedCostCad: number | null (sum of items with a KNOWN price)
 *   costCoverageNote: string describing how many items have no price match
 */
function buildGroceryList(planResult) {
  const meals = collectSolvedMeals(planResult);
  const aggregated = aggregateIngredients(meals);

  const items = aggregated
    .map((row) => {
      const purchase = convertToPurchaseQuantity(row.name, row.preparedGrams, row.state);
      const cost = estimateCostCad(row.name, purchase.grams);
      return {
        name: row.name,
        section: classifyStoreSection(row.name),
        state: row.state,
        preparedGrams: round1(row.preparedGrams),
        occurrences: row.occurrences,
        purchase,
        cost,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const bySection = { produce: [], protein: [], dairy: [], pantry: [], spices: [], other: [] };
  for (const item of items) bySection[item.section].push(item);

  const pricedItems = items.filter((i) => i.cost);
  const totalEstimatedCostCad = pricedItems.length
    ? Math.round(pricedItems.reduce((sum, i) => sum + i.cost.amountCad, 0) * 100) / 100
    : null;
  const unpricedCount = items.length - pricedItems.length;
  const costCoverageNote = items.length === 0
    ? "no items to price"
    : unpricedCount === 0
      ? "all items priced (rough CAD estimates, not sourced data - see src/lib/groceryPrices.js)"
      : `${unpricedCount} of ${items.length} item(s) have no price match and are excluded from the total (rough CAD estimates for the rest, not sourced data)`;

  return { items, bySection, totalEstimatedCostCad, costCoverageNote };
}

module.exports = { convertToPurchaseQuantity, classifyStoreSection, buildGroceryList };
