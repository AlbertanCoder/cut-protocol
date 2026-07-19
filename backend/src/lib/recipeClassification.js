// Recipe meal-category classification — PURE, no DB, no I/O.
//
// Why this exists (roadmap/03-recipe-curation.md, docs/audit/04-recipe-curation-report.md):
// ~602 of the recipe pool are unreviewed TheMealDB imports, and the seed
// tagged every one `slotType: "meal"` regardless of content. That let
// desserts (Flan, Key Lime Pie, cheesecakes, cookies) be scaled up and
// served as an ordinary lunch/dinner by weeklyPlanner.js's solver — the
// exact overshoot incidents both the code audit and the nutritionist review
// traced. This module decides a recipe's real `mealCategory` from its
// name + ingredients + macros (+ optional source tags) so the solver can
// exclude non-meal items from main-meal slots.
//
// DESIGN CONTRACT
// ---------------
// classifyRecipe(recipe) is the single source of truth for classification.
// It is intentionally pure and side-effect-free so it can run:
//   - over the static seed data (backend/src/lib/portedFromRecomp/recipeLibrary.mjs)
//   - over live DB rows (backend/scripts/retagRecipeCategories.mjs)
//   - inside the seeder (backend/scripts/seedRecipesFromRecomp.mjs)
//   - inside a unit test with plain object fixtures (no prisma)
// It accepts a deliberately flexible recipe shape (see classifyRecipe docs).
//
// SAFETY BIAS (a project rule, see CLAUDE.md + the task spec): when in doubt,
// err toward NOT letting a sweet be served as a main meal. Over-excluding a
// dessert-as-dinner is the safe direction; under-excluding is the bug this
// module exists to kill. Every decision is explainable via the returned
// `reason`/`matchedOn` fields.
//
// KEYWORD MATCHING: single words match on \bword\b boundaries (so "cake"
// does NOT match inside "pancake", and "ham" does NOT match inside "graham"
// — both are real false-positive bugs caught during development). Multi-word
// phrases ("hot chocolate", "rice pudding") match as literal substrings, the
// spaces acting as natural boundaries. This mirrors dietaryFilter.js's
// hasWord() convention already used elsewhere in this codebase.

"use strict";

// ---------------------------------------------------------------------------
// Category vocabulary
// ---------------------------------------------------------------------------

// The full set of classifier verdicts. "proper_meal" is the default and maps
// to a NULL mealCategory (the ~three-quarters of the pool that are genuine
// whole dishes). The rest are the persisted Recipe.mealCategory values.
const CATEGORIES = Object.freeze([
  "proper_meal",
  "dessert",
  "beverage",
  "bread_or_pastry_side",
  "condiment_or_sauce",
  "breakfast_only",
]);

// The non-null values Recipe.mealCategory can take (schema.prisma comment).
const MEAL_CATEGORY_VALUES = Object.freeze([
  "dessert",
  "beverage",
  "bread_or_pastry_side",
  "condiment_or_sauce",
  "breakfast_only",
]);

// Categories the meal solver must NOT draw from for a "meal" slot. This is
// THE source of truth for that set — weeklyPlanner.js imports it from here so
// the classifier's notion of "not a main meal" and the solver's stay in sync
// (previously duplicated as a literal in weeklyPlanner.js).
//
// breakfast_only is deliberately NOT in this set: the solver has no
// time-of-day concept (roadmap/03 §1.5), so excluding porridge/pancakes would
// just shrink the pool with no offsetting benefit. Those recipes are tagged
// for a future time-of-day-aware solver, but stay meal-eligible today.
const NON_MEAL_CATEGORIES = new Set([
  "dessert",
  "beverage",
  "bread_or_pastry_side",
  "condiment_or_sauce",
]);

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------
// Compiled from the real recipe names in this pool (roadmap/03 §1.3) plus the
// international dessert names the source's own "dessert" tag revealed
// (Alfajores, Lamingtons, Æbleskiver, Stroopwafel, Timbits, …). Every entry
// is a genuine sweet/confection head noun in this corpus with no known savory
// collision; the ambiguous head nouns (pie/cake/pudding/bun) are handled
// separately by the sweet-vs-savory gate below.

const DESSERT_KEYWORDS = [
  "cookie", "cookies", "brownie", "brownies", "mousse", "cheesecake",
  "cheescake", "ice cream", "sorbet", "gelato", "trifle", "parfait", "fudge",
  "toffee", "meringue", "eclair", "éclair", "doughnut", "donut", "doughnuts",
  "crumble", "cobbler", "strudel", "shortbread", "gingerbread", "candy",
  "marshmallow", "baklava", "tiramisu", "macaron", "cupcake", "muffin",
  "scone", "shortcake", "panna cotta", "creme brulee", "crème brûlée",
  "banoffee", "pavlova", "eton mess", "kheer", "gulab jamun", "rasgulla",
  "sundae", "biscotti", "florentine", "praline", "streusel", "nougat",
  "halva", "barfi", "ladoo", "jalebi", "dulce de leche", "chajá", "chaja",
  "postre", "buñuelo", "bunuelo", "churro", "churros", "flapjack", "biscuit",
  "biscuits", "tart", "tarts", "tartlet", "tartlets", "custard", "truffle",
  "truffles", "natilla", "fool", "flan", "rice pudding", "bread pudding",
  "spotted dick", "roly-poly", "roly poly", "battenberg", "bakewell",
  "victoria sponge", "sponge cake", "rock cake", "rock cakes", "brittle",
  "turron", "turrón", "alfajor", "alfajores", "brigadeiro", "quindim",
  "gateau", "gâteau", "stroopwafel", "speculaas", "lamington", "lamingtons",
  "kransekake", "krumkake", "æbleskiver", "aebleskiver", "friand", "friands",
  "budino", "souffle", "soufflé", "gazelle horns", "skoleboller", "beavertail",
  "beavertails", "timbit", "timbits", "pączki", "paczki", "ensaimada",
  "tamarind balls",
];

// Ambiguous head nouns: real SAVORY dishes in this pool use these too (Steak
// and Kidney Pie, Cumberland Pie, Cheese & Onion pie). Gate on a sweet/savory
// qualifier before deciding; unresolved → proper_meal + needsReview.
const AMBIGUOUS_HEAD_NOUNS = ["pie", "pies", "cake", "cakes", "pudding", "puddings", "bun", "buns"];

const SWEET_QUALIFIERS = [
  "apple", "cherry", "pecan", "pumpkin", "lemon", "chocolate", "banana",
  "berry", "blueberry", "strawberry", "raspberry", "peach", "treacle",
  "toffee", "caramel", "coconut", "mango", "key lime", "fruit", "raisin",
  "honey", "molasses", "maple", "fig", "plum", "rhubarb", "apricot", "sugar",
  "sweet potato", "carrot", "orange", "tapioca", "walnut", "date", "almond",
  "cinnamon", "spiced", "cream", "custard", "jam", "currant", "madeira",
  "dundee", "sticky", "butter cake",
];

const SAVORY_QUALIFIERS = [
  "beef", "steak", "chicken", "turkey", "pork", "lamb", "kidney", "mutton",
  "mince", "minced", "meat", "cottage", "shepherd", "tourtière", "tourtiere",
  "fish", "salmon", "crab", "cheese and onion", "leek", "bacon", "sausage",
  "game", "venison", "curry", "chilli", "chili", "scotch pie", "omelette",
  "omelet",
];

const BEVERAGE_KEYWORDS = [
  "smoothie", "milkshake", "milk shake", "cocktail", "mocktail", "punch",
  "lassi", "lemonade", "iced tea", "hot chocolate", "cordial", "sangria",
  "mojito", "margarita", "daiquiri", "spritz", "toddy", "eggnog", "horchata",
  "chai latte",
];

// Breads/pastry accompaniments never eaten as a whole meal on their own.
const BREAD_SIDE_KEYWORDS = [
  "yorkshire pudding", "yorkshire puddings", "popover", "popovers",
  "dinner roll", "garlic bread", "breadstick", "cornbread", "flatbread",
  "flatbreads", "soda bread", "rye bread", "challah", "salt bread",
  "semolina bread", "tandoori bread", "cheese bread", "spice bun",
  "sweet bread", "shawarma bread", "syrian bread",
];

// Condiment/sauce head nouns — NAME candidates only. Confirmed as
// condiment_or_sauce solely if the macro gate below also agrees (a real
// standalone sauce is low-protein/low-kcal), so "Chicken in Orange Sauce" or
// "Falafel Pita with Tahini Sauce" (a full 60g-protein dish) is NOT excluded.
const CONDIMENT_HEAD_NOUNS = [
  "sauce", "chutney", "relish", "dressing", "gravy", "salsa", "pesto",
  "marinade", "glaze", "vinaigrette", "dip",
];

// If any of these appear in the NAME, a "sauce"/"dip" recipe is really a dish
// named after its sauce, not a standalone condiment.
const PROTEIN_ANCHOR_WORDS = [
  "chicken", "beef", "pork", "lamb", "turkey", "fish", "salmon", "shrimp",
  "prawn", "prawns", "tofu", "egg", "eggs", "bean", "beans", "lentil",
  "lentils", "chickpea", "chickpeas", "steak", "duck", "goat", "venison",
  "crab", "cod", "haddock", "mutton", "sausage", "mince", "minced", "tuna",
  "seafood", "clam", "oyster", "mussel",
];

// Legitimate whole meals that read as breakfast dishes. Tagged for a future
// time-of-day-aware solver but NOT excluded from meal slots today (see
// NON_MEAL_CATEGORIES note). This rule intentionally takes precedence over
// the source "dessert" tag for sweet pancakes/waffles (roadmap §1.4/§1.5):
// a pancake is a breakfast DISH first; keeping it meal-eligible matches the
// roadmap's documented decision. (If the owner would rather exclude sweet
// pancakes, moving these names to dessert is a one-line change — see report.)
const BREAKFAST_ONLY_KEYWORDS = [
  "pancake", "pancakes", "waffle", "waffles", "porridge", "granola",
  "french toast", "overnight oats", "oatmeal", "crepe", "crêpe", "crepes",
  "poffertjes", "grits", "kedgeree", "shakshuka", "eggs benedict",
];

// Ingredient-name signals for the secondary (macro/ingredient) pass. These
// catch non-English dessert names the keyword list misses (e.g. "Arroz con
// Leche", "Coconut Natilla") by their sugar/baking ingredient signature.
const SUGAR_INGREDIENTS = [
  "sugar", "icing sugar", "powdered sugar", "condensed milk", "chocolate",
  "cocoa", "honey", "syrup", "cream cheese", "whipped cream", "marshmallow",
  "golden syrup", "maple syrup", "jam", "caramel",
];
const BAKING_INGREDIENTS = [
  "flour", "butter", "baking powder", "baking soda", "vanilla", "egg yolk",
  "egg white", "cornstarch", "cornflour", "semolina",
];

// A real protein SOURCE in the ingredient list (used to veto a dessert
// verdict on the ingredient pass). Deliberately includes eggs/dairy-protein
// here because THIS check answers "is there any protein anchor at all" for
// the sugar-heavy-dessert rule.
const PROTEIN_SOURCE_INGREDIENTS = [
  "beef", "chicken", "pork", "lamb", "turkey", "bacon", "sausage", "ham",
  "fish", "salmon", "tuna", "cod", "haddock", "prawn", "shrimp", "crab",
  "clam", "oyster", "mussel", "anchovy", "anchovies", "sardine", "sardines",
  "mackerel", "egg", "eggs", "tofu", "tempeh", "lentil", "lentils",
  "chickpea", "chickpeas", "bean", "beans", "black bean", "kidney bean",
  "cannellini", "yogurt", "greek yogurt", "cottage cheese", "paneer",
  "seitan", "duck", "venison",
];

// STRONG savory anchors — meat/fish/poultry/main-legume ONLY. Deliberately
// EXCLUDES egg/dairy/potato: desserts are full of eggs, butter and cream, so
// counting those as "savory" wrongly flags custards, Æbleskiver, Crema
// Catalana etc. as non-desserts. Used only to veto the source "dessert" tag
// in the rare case a dessert-tagged recipe genuinely looks like a meat dish.
const STRONG_SAVORY_ANCHORS = [
  "beef", "steak", "chicken", "pork", "lamb", "mutton", "bacon", "sausage",
  "ham", "fish", "salmon", "tuna", "cod", "haddock", "prawn", "shrimp",
  "crab", "clam", "oyster", "mussel", "anchovy", "anchovies", "sardine",
  "sardines", "mackerel", "tofu", "lentil", "lentils", "chickpea",
  "chickpeas", "bean", "beans", "mince", "minced", "turkey", "duck",
  "venison", "curry", "chilli", "chili",
];

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

function escapeRegExp(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary match for single words; literal substring for multi-word
// phrases. Case-insensitive. See the module header for why this matters.
function hasWord(text, phrase) {
  if (!text || !phrase) return false;
  const t = String(text);
  if (phrase.includes(" ")) return t.toLowerCase().includes(phrase.toLowerCase());
  return new RegExp("\\b" + escapeRegExp(phrase) + "\\b", "i").test(t);
}

function matchesAny(text, words) {
  return words.some((w) => hasWord(text, w));
}

function firstMatch(text, words) {
  return words.find((w) => hasWord(text, w)) || null;
}

// Plural-aware variant, used ONLY for matching against ingredient NAMES
// (which appear in arbitrary singular/plural forms: "Prawns", "Eggs", "Long
// Beans", "Sardines"). Same stemming convention as foodCategories.js:
// word + optional s/es, and y→ies. Kept separate from hasWord() so name
// classification stays under tight, explicit control (its keyword tables
// already list the exact plural forms they need). Multi-word phrases still
// match as literal substrings. Word boundaries still prevent "ham" from
// matching inside "graham".
function hasWordStem(text, phrase) {
  if (!text || !phrase) return false;
  const t = String(text);
  if (phrase.includes(" ")) return t.toLowerCase().includes(phrase.toLowerCase());
  const stem = phrase.endsWith("y")
    ? escapeRegExp(phrase.slice(0, -1)) + "(?:y|ies)"
    : escapeRegExp(phrase) + "(?:es|s)?";
  return new RegExp("\\b" + stem + "\\b", "i").test(t);
}

function ingredientMatchesAny(ingredientName, words) {
  return words.some((w) => hasWordStem(ingredientName, w));
}

// Normalize a flexible ingredient list into [{ name, role }]. Accepts:
//   - "Sugar"                             (plain string)
//   - { name: "Sugar", role: "carb" }     (static seed / import shape)
//   - { food: { name: "Sugar" }, role }   (prisma `include: { food: true }`)
function normalizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients.map((ing) => {
    if (ing == null) return { name: "", role: null };
    if (typeof ing === "string") return { name: ing, role: null };
    const name = ing.name != null ? ing.name : ing.food && ing.food.name != null ? ing.food.name : "";
    return { name: String(name), role: ing.role != null ? ing.role : null };
  });
}

function toFiniteNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Does this recipe have any real protein source? Role-first (works on DB rows
// with backfilled roles), falling back to ingredient-name keywords (works on
// the static seed data, which has no roles).
function hasProteinSource(ingredients) {
  return ingredients.some(
    (i) => i.role === "protein" || ingredientMatchesAny(i.name, PROTEIN_SOURCE_INGREDIENTS)
  );
}

// A genuinely savory (meat/fish/poultry/legume) signal in name or
// ingredients. Vetoes an ingredient/macro-based dessert verdict so a savory
// stir-fry ("Kung Po Prawns", "Sichuan Long Beans") that happens to be
// carb-dominant with a little sugar is never called a dessert.
function hasStrongSavorySignal(name, ingredients) {
  return matchesAny(name, SAVORY_QUALIFIERS) || ingredients.some((i) => ingredientMatchesAny(i.name, STRONG_SAVORY_ANCHORS));
}

function countIngredientHits(ingredients, keywords) {
  return ingredients.filter((i) => ingredientMatchesAny(i.name, keywords)).length;
}

// Macro-only "does this look sweet" heuristic: very low protein density and a
// carbohydrate-dominant energy profile. Returns false when macros are missing
// or nonsensical. Used ONLY as corroboration alongside a sugar ingredient —
// never on its own, so plain rice/bread (high-carb, low-protein, but NOT
// sweet) is not mistaken for a dessert.
function looksSweetByMacros(macros) {
  const kcal = toFiniteNumber(macros && macros.kcal);
  const protein = toFiniteNumber(macros && macros.protein);
  const carb = toFiniteNumber(macros && macros.carb);
  if (kcal == null || protein == null || carb == null || kcal < 50) return false;
  const proteinPer100kcal = (protein / kcal) * 100;
  const carbEnergyShare = (carb * 4) / kcal;
  return proteinPer100kcal < 2.0 && carbEnergyShare > 0.5;
}

// ---------------------------------------------------------------------------
// Name pass
// ---------------------------------------------------------------------------
// Returns { category, confidence, matchedOn }. confidence is one of:
//   "high"                  - confidently classified
//   "ambiguous"             - ambiguous head noun, no sweet/savory resolution
//   "pending_macro"         - looks like a condiment by name; needs macro gate
function classifyByName(name) {
  if (matchesAny(name, DESSERT_KEYWORDS)) {
    return { category: "dessert", confidence: "high", matchedOn: firstMatch(name, DESSERT_KEYWORDS) };
  }

  const head = firstMatch(name, AMBIGUOUS_HEAD_NOUNS);
  if (head) {
    const sweet = matchesAny(name, SWEET_QUALIFIERS);
    const savory = matchesAny(name, SAVORY_QUALIFIERS);
    if (sweet && !savory) return { category: "dessert", confidence: "high", matchedOn: head };
    if (savory && !sweet) return { category: "proper_meal", confidence: "high", matchedOn: head };
    return { category: "proper_meal", confidence: "ambiguous", matchedOn: head };
  }

  if (matchesAny(name, BEVERAGE_KEYWORDS)) {
    return { category: "beverage", confidence: "high", matchedOn: firstMatch(name, BEVERAGE_KEYWORDS) };
  }
  if (matchesAny(name, BREAD_SIDE_KEYWORDS)) {
    return { category: "bread_or_pastry_side", confidence: "high", matchedOn: firstMatch(name, BREAD_SIDE_KEYWORDS) };
  }

  const condiment = firstMatch(name, CONDIMENT_HEAD_NOUNS);
  if (condiment) {
    if (!matchesAny(name, PROTEIN_ANCHOR_WORDS)) {
      return { category: "condiment_or_sauce", confidence: "pending_macro", matchedOn: condiment };
    }
    return { category: "proper_meal", confidence: "high", matchedOn: condiment };
  }

  if (matchesAny(name, BREAKFAST_ONLY_KEYWORDS)) {
    return { category: "breakfast_only", confidence: "high", matchedOn: firstMatch(name, BREAKFAST_ONLY_KEYWORDS) };
  }

  return { category: "proper_meal", confidence: "high", matchedOn: null };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * Classify a recipe into its meal category. PURE — no DB, no I/O.
 *
 * @param {object} recipe
 * @param {string}   recipe.name                    required
 * @param {Array}    [recipe.ingredients]           string | {name,role} | {food:{name},role}
 * @param {number}   [recipe.kcal]                  per-serving macros (used by
 * @param {number}   [recipe.protein]               the condiment + dessert
 * @param {number}   [recipe.carb]                  macro gates; gates skip
 * @param {number}   [recipe.fat]                   gracefully when absent)
 * @param {string[]} [recipe.sourceTags]            optional source tags (e.g.
 * @param {string[]} [recipe.tags]                  TheMealDB "dessert"/"breakfast");
 *                                                  `tags` is accepted as an alias
 * @returns {{
 *   category: string,          // full verdict incl. proper_meal / breakfast_only
 *   mealCategory: string|null, // value to persist to Recipe.mealCategory (null = proper_meal)
 *   mealSlotEligible: boolean, // may this fill a main "meal" slot?
 *   confidence: "high"|"ambiguous",
 *   needsReview: boolean,      // true = do NOT auto-write; human should eyeball it
 *   matchedOn: string|null,    // the keyword/tag/rule that decided it
 *   reason: string             // human-readable explanation
 * }}
 */
function classifyRecipe(recipe) {
  const name = String((recipe && recipe.name) || "");
  const ingredients = normalizeIngredients(recipe && recipe.ingredients);
  const macros = {
    kcal: toFiniteNumber(recipe && recipe.kcal),
    protein: toFiniteNumber(recipe && recipe.protein),
    carb: toFiniteNumber(recipe && recipe.carb),
    fat: toFiniteNumber(recipe && recipe.fat),
  };
  const sourceTags = Array.isArray(recipe && recipe.sourceTags)
    ? recipe.sourceTags
    : Array.isArray(recipe && recipe.tags)
      ? recipe.tags
      : [];
  const tagSet = new Set(sourceTags.map((t) => String(t).toLowerCase()));

  const nameResult = classifyByName(name);
  let category = nameResult.category;
  let confidence = nameResult.confidence === "ambiguous" ? "ambiguous" : "high";
  let matchedOn = nameResult.matchedOn;
  let needsReview = nameResult.confidence === "ambiguous";
  let reason = matchedOn
    ? `name keyword "${matchedOn}" → ${category}`
    : "no category keyword matched → proper_meal";
  if (nameResult.confidence === "ambiguous") {
    reason = `ambiguous head noun "${matchedOn}" (no clear sweet/savory qualifier) → left proper_meal, flagged for review`;
  }

  const sugarHits = countIngredientHits(ingredients, SUGAR_INGREDIENTS);
  const bakingHits = countIngredientHits(ingredients, BAKING_INGREDIENTS);
  const proteinSource = hasProteinSource(ingredients);

  // --- Condiment macro gate ---
  if (nameResult.category === "condiment_or_sauce" && nameResult.confidence === "pending_macro") {
    const lowProtein = macros.protein != null && macros.protein < 10;
    const lowKcal = macros.kcal != null && macros.kcal < 250;
    if (lowProtein && lowKcal && !proteinSource) {
      category = "condiment_or_sauce";
      confidence = "high";
      needsReview = false;
      reason = `named "${matchedOn}" + low protein (${macros.protein.toFixed(0)}g) + low kcal (${macros.kcal.toFixed(0)}) + no protein source → condiment_or_sauce`;
    } else if (macros.protein == null || macros.kcal == null) {
      // Can't confirm without macros — don't exclude a possibly-real dish.
      category = "proper_meal";
      confidence = "high";
      needsReview = true;
      reason = `named "${matchedOn}" but no macros to confirm it's a standalone condiment → left proper_meal, flagged for review`;
    } else {
      category = "proper_meal";
      confidence = "high";
      needsReview = true;
      reason = `named "${matchedOn}" but macros look like a full dish (protein ${macros.protein.toFixed(0)}g, ${macros.kcal.toFixed(0)} kcal) → left proper_meal, flagged for review`;
    }
  }

  // --- Ingredient/macro dessert pass (only for still-proper_meal, name unmatched) ---
  // Catches non-English dessert names the keyword list misses (e.g. "Arroz
  // con Leche", "Coconut Natilla") by their sugar/baking-ingredient signature.
  // A strong savory (meat/fish/legume) signal always vetoes it — that guard
  // plus plural-aware protein detection keeps savory dishes out.
  const strongSavory = hasStrongSavorySignal(name, ingredients);
  if (category === "proper_meal" && !needsReview && nameResult.matchedOn == null && !proteinSource && !strongSavory) {
    if (sugarHits >= 2 && bakingHits >= 1) {
      category = "dessert";
      confidence = "high";
      matchedOn = "ingredients";
      reason = `${sugarHits} sugar-type + ${bakingHits} baking ingredient(s), no protein source → dessert (name matched no dessert keyword — likely non-English dessert name)`;
    } else if (sugarHits >= 1 && looksSweetByMacros(macros)) {
      category = "dessert";
      confidence = "high";
      matchedOn = "macros+ingredients";
      reason = `sweet macro profile (protein ${macros.protein.toFixed(0)}g / ${macros.kcal.toFixed(0)} kcal, carb-dominant) + ${sugarHits} sugar ingredient, no protein source → dessert`;
    }
  }

  // --- Source-tag corroboration (only overrides the meal-eligible verdict) ---
  // The source's own "dessert"/"breakfast" tags are a strong, high-recall
  // signal (TheMealDB cleanly separates desserts from mains). We only use
  // them to correct a proper_meal verdict — never to downgrade a more
  // specific name/ingredient verdict.
  if (category === "proper_meal") {
    if (tagSet.has("dessert")) {
      if (hasStrongSavorySignal(name, ingredients)) {
        // Contradiction: source says dessert but it reads like a meat dish.
        // Don't guess — flag it.
        needsReview = true;
        reason = `source tag "dessert" but a strong savory (meat/fish) signal is present → left proper_meal, flagged for review`;
      } else {
        category = "dessert";
        confidence = "high";
        matchedOn = "sourceTag:dessert";
        needsReview = false;
        reason = "source tag \"dessert\" + no protein/savory signal → dessert";
      }
    } else if (tagSet.has("breakfast")) {
      category = "breakfast_only";
      confidence = "high";
      matchedOn = "sourceTag:breakfast";
      needsReview = false;
      reason = "source tag \"breakfast\" → breakfast_only (tagged, still meal-eligible)";
    }
  }

  const mealCategory = category === "proper_meal" ? null : category;
  const mealSlotEligible = !NON_MEAL_CATEGORIES.has(mealCategory);

  return { category, mealCategory, mealSlotEligible, confidence, needsReview, matchedOn, reason };
}

// Convenience: is a given persisted mealCategory value eligible for a main
// "meal" slot? (null / "breakfast_only" → true; the rest → false.)
function isMealSlotEligible(mealCategory) {
  return !NON_MEAL_CATEGORIES.has(mealCategory);
}

module.exports = {
  classifyRecipe,
  isMealSlotEligible,
  looksSweetByMacros,
  hasWord,
  NON_MEAL_CATEGORIES,
  MEAL_CATEGORY_VALUES,
  CATEGORIES,
  // exported for tests / downstream inspection
  DESSERT_KEYWORDS,
  AMBIGUOUS_HEAD_NOUNS,
  SWEET_QUALIFIERS,
  SAVORY_QUALIFIERS,
  BEVERAGE_KEYWORDS,
  BREAD_SIDE_KEYWORDS,
  CONDIMENT_HEAD_NOUNS,
  BREAKFAST_ONLY_KEYWORDS,
};
