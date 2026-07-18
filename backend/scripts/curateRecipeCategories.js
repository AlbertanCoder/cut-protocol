// Recipe category curation — DRY RUN BY DEFAULT.
//
// Why this exists: PABLO_REVIEW.md §2.7/§2.6 and AUDIT.md §3 independently
// traced the meal-planner's calorie/protein overshoot problem back to the
// same root cause — 602 of 629 recipes are unreviewed themealdb-import rows
// (`Recipe.source: "themealdb-import"`), and 621 of 629 recipes carry
// `slotType: "meal"` regardless of whether they're actually a whole dish, a
// dessert, a condiment, or a bread-basket side. weeklyPlanner.js's
// eligibleRecipes() (backend/src/lib/weeklyPlanner.js:67-70) treats every
// `slotType: "meal"` row as fair game to fill an entire lunch/dinner slot —
// including things like Flan, Postre Chajá, and Yorkshire Puddings, which is
// how those specific overshoot incidents happened (a dessert or side dish
// gets scaled up trying to hit a 400-600 kcal meal target it was never
// designed to carry).
//
// What this script does NOT do: it does not touch `Recipe.slotType` (see
// roadmap/03-recipe-curation.md §2 for why — that field is read by
// eligibleRecipes(), the RecipesTab.jsx edit form, the AI-draft schema, and
// several routes; retagging desserts to "snack" would flood the 7-recipe
// snack pool with 90+ sugar-heavy items, a worse outcome than the one it's
// fixing). Instead it computes a proposed value for a NEW, additive field —
// `Recipe.mealCategory` — that does not exist in the schema yet. Applying
// this script requires a migration first (see roadmap doc for the exact
// `schema.prisma` diff). Until that migration lands, --apply will refuse to
// run against a database missing the column, by design.
//
// Classification method: word-boundary keyword matching against the recipe
// name (same \bword\b convention as dietaryFilter.js's hasWord()), with an
// explicit sweet-vs-savory qualifier gate for ambiguous head nouns (pie,
// cake, pudding) so "Beef and Mustard Pie" doesn't get caught by the same
// rule that catches "Key Lime Pie". A secondary ingredient-based pass
// (sugar/baking ingredients present, zero protein-role ingredient) catches
// a small number of dessert-named-in-a-foreign-language recipes the English
// keyword list misses (e.g. "Arroz con Leche" = rice pudding). Genuinely
// unresolved cases go to a human-review list instead of being guessed at —
// see roadmap doc §4.
//
// Usage:
//   node scripts/curateRecipeCategories.js            # dry run (default) — logs only, no writes
//   node scripts/curateRecipeCategories.js --apply     # would write — REFUSES until the
//                                                       # mealCategory column exists AND
//                                                       # --confirm is also passed
//   node scripts/curateRecipeCategories.js --apply --confirm   # actually writes
require("dotenv/config");
const { prisma } = require("../src/lib/prisma.js");

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

// Unambiguous dessert/pastry head nouns — in this dataset (602 TheMealDB
// imports, largely Commonwealth/international home-cooking sources) every
// recipe actually containing these words was manually spot-checked (see
// roadmap doc §1) and found to be a genuine sweet dessert/confection, with
// no savory-usage collisions (e.g. no US-style savory "biscuit" in this
// pool — "biscuit" here is always the UK cookie sense).
const DESSERT_KEYWORDS = [
  "cookie", "cookies", "brownie", "mousse", "cheesecake", "ice cream",
  "sorbet", "gelato", "trifle", "parfait", "fudge", "toffee", "meringue",
  "eclair", "éclair", "doughnut", "donut", "crumble", "cobbler", "strudel",
  "shortbread", "gingerbread", "candy", "marshmallow", "baklava", "tiramisu",
  "macaron", "cupcake", "muffin", "scone", "shortcake", "panna cotta",
  "creme brulee", "crème brûlée", "banoffee", "pavlova", "eton mess",
  "kheer", "gulab jamun", "rasgulla", "sundae", "biscotti", "florentine",
  "praline", "streusel", "nougat", "halva", "barfi", "ladoo", "jalebi",
  "dulce de leche", "chajá", "chaja", "postre", "buñuelo", "bunuelo",
  "churro", "flapjack", "biscuit", "biscuits", "tart", "tarts", "custard",
  "truffle", "truffles", "natilla", "fool", "flan", "pudding basin",
  "arroz con leche", "rice pudding", "bread pudding", "spotted dick",
  "roly-poly", "roly poly", "battenberg", "bakewell", "victoria sponge",
  "sponge cake", "millionaire's shortbread", "rock cake", "rock cakes",
  "brittle", "turron", "turrón",
];

// Ambiguous head nouns: real savory dishes in this pool use these words too
// (Steak and Kidney Pie, Cumberland Pie, Ground Beef & Rice Skillet-style
// "cakes" aren't in this list, but Thai chicken cakes are). Gate on a
// sweet/savory qualifier before deciding.
const AMBIGUOUS_HEAD_NOUNS = ["pie", "pies", "cake", "cakes", "pudding", "puddings"];

const SWEET_QUALIFIERS = [
  "apple", "cherry", "pecan", "pumpkin", "lemon", "chocolate", "banana",
  "berry", "blueberry", "strawberry", "raspberry", "peach", "treacle",
  "toffee", "caramel", "coconut", "mango", "key lime", "fruit", "raisin",
  "honey", "molasses", "maple", "fig", "plum", "rhubarb", "apricot",
  "sugar", "sweet potato pudding", "carrot cake", "orange cake", "tapioca",
  "walnut, date", "walnut date",
];

const SAVORY_QUALIFIERS = [
  "beef", "steak", "chicken", "turkey", "pork", "lamb", "kidney", "mutton",
  "mince", "minced", "meat", "cottage", "shepherd", "tourtière", "tourtiere",
  "fish", "salmon", "crab", "potato", "cheese and onion", "leek", "bacon",
  "sausage", "game", "venison", "goat", "curry", "chilli", "chili",
  "scotch pie", "omelette", "omelet",
];

const BEVERAGE_KEYWORDS = [
  "smoothie", "milkshake", "shake", "cocktail", "mocktail", "punch", "lassi",
  "lemonade", "iced tea", "hot chocolate", "cordial", "sangria", "mojito",
  "margarita", "daiquiri", "float", "spritz", "toddy", "eggnog", "horchata",
  "chai",
];

// Bread/pastry accompaniments that are never eaten as a whole meal on their
// own — companion dishes, not entrees.
const BREAD_SIDE_KEYWORDS = [
  "yorkshire pudding", "yorkshire puddings", "popover", "popovers",
  "dinner roll", "garlic bread", "breadstick", "cornbread", "flatbread",
  "flatbreads",
];

// Condiment/sauce head nouns. These are name-only candidates — confirmed as
// condiment_or_sauce only if the macro-based gate below (low protein, no
// named protein anchor) also agrees, since plenty of real entrees have
// "sauce" in the name ("Chicken in Orange Sauce").
const CONDIMENT_HEAD_NOUNS = [
  "sauce", "chutney", "relish", "dressing", "gravy", "salsa", "pesto",
  "marinade", "glaze", "vinaigrette", "dip",
];
const PROTEIN_ANCHOR_WORDS = [
  "chicken", "beef", "pork", "lamb", "turkey", "fish", "salmon", "shrimp",
  "prawn", "tofu", "egg", "eggs", "bean", "beans", "lentil", "chickpea",
  "chickpeas", "steak", "duck", "goat", "venison", "crab", "cod", "haddock",
  "mutton", "sausage", "mince", "minced",
];

// Legitimate meals that only happen at breakfast — NOT excluded from
// meal-slot eligibility (the solver has no time-of-day concept at all, so
// excluding these would just shrink the pool with no corresponding fix).
// Tagged for visibility only; see roadmap doc for why this stays informational.
const BREAKFAST_ONLY_KEYWORDS = [
  "pancake", "pancakes", "waffle", "waffles", "porridge", "granola",
  "french toast", "overnight oats", "oatmeal", "crepe", "crêpe", "crepes",
];

// Categories excluded from ordinary meal-slot eligibility once mealCategory
// exists and weeklyPlanner.js's eligibleRecipes() is updated to read it
// (see roadmap doc §2 for the proposed diff — not applied by this script).
const EXCLUDE_FROM_MEAL_SLOT = new Set(["dessert", "beverage", "bread_or_pastry_side", "condiment_or_sauce"]);

function hasWord(name, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Multi-word phrases ("hot chocolate") use the literal spaces as natural
  // boundaries; single words get \b on both sides so "cake" doesn't match
  // inside "pancake" and "lassi" doesn't match inside "Classic".
  return new RegExp("\\b" + escaped + "\\b", "i").test(name);
}
function matchesAny(name, words) {
  return words.some((w) => hasWord(name, w));
}

const SUGAR_ING_KEYWORDS = [
  "sugar", "icing sugar", "powdered sugar", "condensed milk", "chocolate",
  "cocoa", "honey", "syrup", "cream cheese", "whipped cream", "marshmallow",
];
const FLOUR_ING_KEYWORDS = [
  "flour", "butter", "baking powder", "baking soda", "vanilla extract",
  "egg yolk", "egg white",
];

// Primary pass: name-only classification. Returns { category, matchedOn,
// confidence } where confidence is "high" | "ambiguous". "ambiguous" means
// an ambiguous head noun matched but neither qualifier list resolved it —
// these are NOT auto-tagged; they go to the human-review list.
function classifyByName(name) {
  if (matchesAny(name, DESSERT_KEYWORDS)) {
    return { category: "dessert", matchedOn: DESSERT_KEYWORDS.find((w) => hasWord(name, w)), confidence: "high" };
  }
  const ambiguousHead = AMBIGUOUS_HEAD_NOUNS.find((w) => hasWord(name, w));
  if (ambiguousHead) {
    const sweet = matchesAny(name, SWEET_QUALIFIERS);
    const savory = matchesAny(name, SAVORY_QUALIFIERS);
    if (sweet && !savory) return { category: "dessert", matchedOn: ambiguousHead, confidence: "high" };
    if (savory && !sweet) return { category: "proper_meal", matchedOn: ambiguousHead, confidence: "high" };
    // both matched, or neither matched — genuine toss-up
    return { category: "proper_meal", matchedOn: ambiguousHead, confidence: "ambiguous" };
  }
  if (matchesAny(name, BEVERAGE_KEYWORDS)) {
    return { category: "beverage", matchedOn: BEVERAGE_KEYWORDS.find((w) => hasWord(name, w)), confidence: "high" };
  }
  if (matchesAny(name, BREAD_SIDE_KEYWORDS)) {
    return { category: "bread_or_pastry_side", matchedOn: BREAD_SIDE_KEYWORDS.find((w) => hasWord(name, w)), confidence: "high" };
  }
  const condimentHead = CONDIMENT_HEAD_NOUNS.find((w) => hasWord(name, w));
  if (condimentHead) {
    const hasProteinAnchor = matchesAny(name, PROTEIN_ANCHOR_WORDS);
    if (!hasProteinAnchor) {
      return { category: "condiment_or_sauce", matchedOn: condimentHead, confidence: "ambiguous_pending_macro" };
    }
    return { category: "proper_meal", matchedOn: condimentHead, confidence: "high" };
  }
  if (matchesAny(name, BREAKFAST_ONLY_KEYWORDS)) {
    return { category: "breakfast_only", matchedOn: BREAKFAST_ONLY_KEYWORDS.find((w) => hasWord(name, w)), confidence: "high" };
  }
  return { category: "proper_meal", matchedOn: null, confidence: "high" };
}

// Secondary pass, macro/ingredient-based. Only consulted for recipes the
// name pass left as "proper_meal" (high confidence) or flagged
// "ambiguous_pending_macro" (condiment candidates).
function classifyByIngredients(recipe, nameResult) {
  const ingNames = recipe.ingredients.map((i) => i.food.name.toLowerCase());
  const sugarHits = ingNames.filter((n) => SUGAR_ING_KEYWORDS.some((k) => n.includes(k))).length;
  const flourHits = ingNames.filter((n) => FLOUR_ING_KEYWORDS.some((k) => n.includes(k))).length;
  const hasProteinRole = recipe.ingredients.some((i) => i.role === "protein");

  if (nameResult.category === "condiment_or_sauce" && nameResult.confidence === "ambiguous_pending_macro") {
    // Confirm condiment only if it's also low-protein/low-kcal — a real
    // standalone sauce/dip, not a full dish that happens to be named after
    // its sauce.
    if (recipe.protein < 10 && recipe.kcal < 250 && !hasProteinRole) {
      return { category: "condiment_or_sauce", confidence: "high", reason: `low protein (${recipe.protein.toFixed(1)}g) + low kcal (${recipe.kcal.toFixed(0)}) + no protein-role ingredient` };
    }
    // Name said "sauce/dip" but macros look like a real dish — treat as a
    // proper meal, but flag for human eyes since the name is still odd.
    return { category: "proper_meal", confidence: "ambiguous", reason: `name suggests condiment but protein=${recipe.protein.toFixed(1)}g kcal=${recipe.kcal.toFixed(0)} — probably a full dish named after its sauce` };
  }

  if (nameResult.category === "proper_meal" && nameResult.confidence === "high") {
    if (sugarHits >= 2 && flourHits >= 1 && !hasProteinRole) {
      return { category: "dessert", confidence: "high", reason: `${sugarHits} sugar-type + ${flourHits} baking ingredient(s), no protein-role ingredient (name didn't match any dessert keyword — likely non-English dessert name)` };
    }
    if (sugarHits >= 1 && flourHits >= 1 && !hasProteinRole && recipe.protein < 8) {
      return { category: "proper_meal", confidence: "ambiguous", reason: `${sugarHits} sugar-type + ${flourHits} baking ingredient(s), low protein (${recipe.protein.toFixed(1)}g) — possible dessert the name-based pass missed` };
    }
  }

  return null; // no override
}

async function classifyAll(recipes) {
  const results = [];
  for (const r of recipes) {
    const nameResult = classifyByName(r.name);
    const ingOverride = classifyByIngredients(r, nameResult);
    // Whenever the ingredient pass renders a verdict (high-confidence or
    // ambiguous downgrade), its category wins over the name pass's — this
    // matters for the "condiment_or_sauce, pending macro check" case: if the
    // macro gate downgrades it to "probably proper_meal, flag for review",
    // the reported category must say proper_meal, not still say
    // condiment_or_sauce (needsReview carries the "not auto-tagged" signal
    // separately from category).
    const final = ingOverride || nameResult;
    const needsReview =
      nameResult.confidence === "ambiguous" ||
      (ingOverride && ingOverride.confidence === "ambiguous") ||
      (nameResult.confidence === "ambiguous_pending_macro" && (!ingOverride || ingOverride.confidence !== "high"));
    results.push({
      recipe: r,
      category: final.category,
      matchedOn: ingOverride && ingOverride.confidence === "high" ? ingOverride.reason : nameResult.matchedOn,
      needsReview,
      reviewReason: needsReview ? (ingOverride?.reason || `ambiguous head noun "${nameResult.matchedOn}" — no clear sweet/savory qualifier`) : null,
    });
  }
  return results;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm");

  const recipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
  });
  console.log(`Loaded ${recipes.length} recipes.\n`);

  const classified = await classifyAll(recipes);

  // --- Summary: category counts ---
  const catCounts = {};
  for (const c of classified) catCounts[c.category] = (catCounts[c.category] || 0) + 1;
  console.log("=== Category counts (all recipes) ===");
  console.table(catCounts);

  // --- Cross-tab: classified category x current slotType ---
  const crossTab = {};
  for (const c of classified) {
    const key = `${c.category} | slotType=${c.recipe.slotType}`;
    crossTab[key] = (crossTab[key] || 0) + 1;
  }
  console.log("\n=== Classified category x current Recipe.slotType ===");
  console.table(crossTab);

  // --- Mistagged: non-proper-meal category, but currently slotType=meal ---
  const mistagged = classified.filter(
    (c) => c.category !== "proper_meal" && c.category !== "breakfast_only" && c.recipe.slotType === "meal" && !c.needsReview
  );
  console.log(`\n=== MISTAGGED: currently slotType="meal", classified as non-meal (${mistagged.length}) ===`);
  const mistaggedByCat = {};
  for (const m of mistagged) {
    mistaggedByCat[m.category] = mistaggedByCat[m.category] || [];
    mistaggedByCat[m.category].push(m.recipe.name);
  }
  for (const [cat, names] of Object.entries(mistaggedByCat)) {
    console.log(`\n-- ${cat} (${names.length}) --`);
    names.forEach((n) => console.log("   -", n));
  }

  const excludableCount = mistagged.filter((m) => EXCLUDE_FROM_MEAL_SLOT.has(m.category)).length;
  console.log(`\nOf those, ${excludableCount} would be excluded from meal-slot eligibility under the proposed fix ` +
    `(the rest are breakfast_only — tagged but not excluded; see script header).`);

  // --- Human review list ---
  const review = classified.filter((c) => c.needsReview);
  console.log(`\n=== FLAGGED FOR HUMAN REVIEW (${review.length}) — not auto-tagged ===`);
  review.forEach((r) => {
    console.log(`   - "${r.recipe.name}"  [current slotType=${r.recipe.slotType}]  reason: ${r.reviewReason}`);
  });

  // --- Dry run / apply ---
  const toWrite = classified.filter((c) => !c.needsReview && c.category !== "proper_meal");
  console.log(`\n=== ${apply ? "APPLY" : "DRY RUN"}: ${toWrite.length} recipes would get mealCategory set ===`);
  const sample = toWrite.slice(0, 25);
  sample.forEach((c) => console.log(`   UPDATE Recipe SET mealCategory='${c.category}' WHERE name='${c.recipe.name}';  -- was slotType=${c.recipe.slotType}`));
  if (toWrite.length > sample.length) console.log(`   ... and ${toWrite.length - sample.length} more (see full list above by category)`);

  if (!apply) {
    console.log("\nDry run complete. No database writes were made. Pass --apply --confirm to write (after the mealCategory migration lands).");
    return;
  }

  // Guard: refuse to write until the column actually exists, and require an
  // explicit second flag even then — this app has exactly one real user
  // with a real live meal plan; a 90+-row bulk update should never happen
  // from a single flag typed in a hurry.
  if (!confirmed) {
    console.log("\n--apply was passed without --confirm. Refusing to write. Re-run with both flags if you mean it.");
    return;
  }
  try {
    await prisma.recipe.findFirst({ select: { id: true } }); // sanity ping
    // Deliberately probe for the column rather than assuming it exists —
    // Prisma will throw if `mealCategory` isn't a recognized field, which is
    // exactly the "no migration yet" case this guard exists for.
    await prisma.recipe.findFirst({ select: { mealCategory: true } });
  } catch (e) {
    console.log("\nRefusing to write: Recipe.mealCategory does not exist in the current schema/DB yet.");
    console.log("Run the migration proposed in roadmap/03-recipe-curation.md §2 first, then re-run with --apply --confirm.");
    return;
  }

  for (const c of toWrite) {
    await prisma.recipe.update({ where: { id: c.recipe.id }, data: { mealCategory: c.category } });
  }
  console.log(`\nWrote mealCategory to ${toWrite.length} recipes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
