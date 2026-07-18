// Grocery-store food categories — the single source of truth for category
// slugs, display labels, and name-based classification. Used by the audit/fix
// scripts, ingredientResolver, usdaClient, and the Foods UI.
//
// Categories work like store sections (Phase 2 spec), not macro classes:
// a canned bean is pantry even though it's carb-dominant; fresh basil is
// fruit-veg even though dried basil is pantry.

const CATEGORIES = [
  { slug: "protein", label: "Protein" },
  { slug: "dairy-eggs", label: "Dairy & Eggs" },
  { slug: "fruit-veg", label: "Fruit & Veg" },
  { slug: "grains", label: "Grains & Carbs" },
  { slug: "fats-nuts-oils", label: "Fats, Nuts & Oils" },
  { slug: "pantry", label: "Pantry, Spices & Sauces" },
  { slug: "drinks", label: "Drinks" },
];
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.label]));

// Legacy slugs from the pre-Phase-2 scheme, still present in old GroceryList
// item snapshots. Mapped for display only — no live Food row keeps these.
const LEGACY_CATEGORY_LABEL = {
  protein: "Protein", carb: "Carbs", veg: "Veg", fat: "Fats",
  dairy: "Dairy", fruit: "Fruit", other: "Other",
};

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hasWord(name, word) {
  // Multi-word phrases match as substrings; single words get word-boundary +
  // plural ("berry" → berries, "nut" → nuts) — same convention
  // dietaryFilter.js established, plus the y→ies case.
  if (word.includes(" ")) return name.toLowerCase().includes(word.toLowerCase());
  const stem = word.endsWith("y") ? esc(word.slice(0, -1)) + "(?:y|ies)" : esc(word) + "(?:es|s)?";
  return new RegExp("\\b" + stem + "\\b", "i").test(name);
}
const matchesAny = (name, words) => words.some((w) => hasWord(name, w));

// ── keyword sets, checked in a specific order (specific → general) ──

const DRINK_WORDS = [
  "water", "coffee", "espresso", "tea", "wine", "beer", "lager", "ale", "cider",
  "cola", "soda", "lemonade", "juice", "kombucha", "smoothie", "sherry", "port",
  "rum", "vodka", "whiskey", "whisky", "brandy", "gin", "tequila", "liqueur",
  "sake", "stout", "prosecco", "champagne",
];
// Broth/stock look drink-ish but live in the soup aisle.
const DRINK_BLOCKERS = ["broth", "stock", "bouillon", "sauce", "vinegar", "syrup", "coconut water"];

const FAT_WORDS = [
  "oil", "butter", "ghee", "margarine", "lard", "suet", "shortening", "tallow",
  "mayonnaise", "mayo", "aioli", "tahini",
  "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia",
  "peanut", "pine nut", "brazil nut", "chestnut", "nut",
  "sunflower seed", "pumpkin seed", "sesame seed", "chia seed", "flax", "hemp seed", "seed",
];
// "Almond milk", "peanut sauce", "nut-free granola" etc. should not land in fats.
const FAT_BLOCKERS = ["milk", "drink", "essence", "extract", "sauce", "butter bean", "buttermilk", "butternut"];

const DAIRY_EGG_WORDS = [
  "milk", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "halloumi",
  "brie", "gouda", "ricotta", "mascarpone", "paneer", "stilton", "gorgonzola",
  "yogurt", "yoghurt", "cream", "creme fraiche", "buttermilk", "kefir", "custard",
  "skyr", "quark", "whey", "casein", "egg", "curd",
];
const DAIRY_BLOCKERS = ["coconut cream", "coconut milk", "cream of tartar", "creamed corn", "eggplant"];

const PROTEIN_WORDS = [
  "chicken", "turkey", "duck", "goose", "quail", "beef", "steak", "sirloin",
  "flank", "brisket", "oxtail", "veal", "pork", "bacon", "ham", "prosciutto",
  "chorizo", "salami", "pepperoni", "sausage", "mince", "meatball", "jerky",
  "lamb", "mutton", "goat", "venison", "elk", "bison", "rabbit", "liver", "kidney",
  "salmon", "tuna", "cod", "haddock", "tilapia", "halibut", "trout", "mackerel",
  "sardine", "anchovy", "herring", "sea bass", "snapper", "fish", "shrimp",
  "prawn", "crab", "lobster", "scallop", "mussel", "clam", "oyster", "squid",
  "octopus", "seafood", "tofu", "tempeh", "seitan", "protein powder", "deli",
  "luncheon meat", "gelatin", "black pudding", "conch",
];
const PROTEIN_BLOCKERS = ["broth", "stock", "bouillon", "sauce", "seasoning", "rinds", "crackling", "fish sauce", "oyster sauce"];

const GRAIN_WORDS = [
  "rice", "pasta", "spaghetti", "penne", "macaroni", "fettuccine", "linguine",
  "lasagne", "lasagna", "noodle", "vermicelli", "orzo", "gnocchi", "bread",
  "baguette", "brioche", "bun", "bagel", "roll", "pita", "naan", "tortilla",
  "wrap", "oat", "oatmeal", "porridge", "granola", "muesli", "cereal", "flour",
  "quinoa", "couscous", "bulgur", "barley", "rye", "spelt", "semolina",
  "cornmeal", "polenta", "grits", "cracker", "crispbread", "rice cake",
  "breadcrumb", "panko", "croissant", "pastry", "wheat", "millet", "buckwheat",
];
const GRAIN_BLOCKERS = ["rice vinegar", "rice wine", "cauliflower rice"];

const PRODUCE_WORDS = [
  "tomato", "onion", "shallot", "garlic", "ginger", "potato", "yam", "cassava",
  "carrot", "parsnip", "beet", "beetroot", "turnip", "radish", "celery",
  "celeriac", "pepper", "chili", "chilli", "jalapeno", "cucumber", "zucchini",
  "courgette", "squash", "pumpkin", "aubergine", "eggplant", "broccoli",
  "cauliflower", "cabbage", "kale", "spinach", "lettuce", "rocket", "arugula",
  "chard", "leek", "spring onion", "scallion", "green bean", "pea", "sweetcorn",
  "corn", "mushroom", "asparagus", "artichoke", "okra", "fennel", "avocado",
  "salad", "greens", "sprout", "watercress", "bok choy", "vegetable",
  "apple", "banana", "orange", "lemon", "lime", "grapefruit", "berry",
  "strawberry", "blueberry", "raspberry", "blackberry", "cranberry", "grape",
  "melon", "watermelon", "cantaloupe", "mango", "pineapple", "peach",
  "nectarine", "apricot", "plum", "cherry", "pear", "kiwi", "fig", "date",
  "pomegranate", "passion fruit", "papaya", "fruit", "rhubarb", "coconut",
  "basil", "parsley", "cilantro", "coriander leaf", "coriander leaves", "mint",
  "dill", "chive", "rosemary", "thyme", "sage", "tarragon", "lemongrass",
  "pak choi", "pak koi", "bok choi", "bok choy", "chinese leaf", "bamboo shoot",
  "snap",
];
// Dried/preserved/processed forms belong in pantry, not produce.
const PRODUCE_PANTRY_MODIFIERS = [
  "canned", "tinned", "dried", "dehydrated", "powder", "powdered", "paste",
  "passata", "sun-dried", "sundried", "pickled", "jarred", "sauce", "ketchup",
  "juice", "chutney", "jam", "jelly", "syrup", "puree", "crisps", "chips",
];

// Explicit assignments for names the rule chain gets wrong or can't know.
// Checked FIRST (case-insensitive exact match). Keep alphabetized-ish.
const NAME_OVERRIDES = {
  "baking powder": "pantry",
  "baking soda": "pantry",
  "bicarbonate of soda": "pantry",
  "black beans, canned, drained": "pantry",
  "cocoa": "pantry",
  "cocoa powder": "pantry",
  "chocolate": "pantry",
  "dark chocolate": "pantry",
  "honey": "pantry",
  "hummus": "pantry",
  "maple syrup": "pantry",
  "marmite": "pantry",
  "miso": "pantry",
  "nutritional yeast": "pantry",
  "olives": "pantry",
  "peanut butter": "fats-nuts-oils",
  "almond butter": "fats-nuts-oils",
  "soup, beef broth, cubed, dry": "pantry",
  "stock cube": "pantry",
  "sugar": "pantry",
  "brown sugar": "pantry",
  "icing sugar": "pantry",
  "tomato powder": "pantry",
  "onions, dehydrated flakes": "pantry",
  "carrot, dehydrated": "pantry",
  "bananas, dehydrated, or banana powder": "pantry",
  "yeast": "pantry",
  "water": "drinks",
  "bay leaf": "pantry",
  "bay leaves": "pantry",
};

/**
 * Classify a food name into one of the 7 grocery categories.
 * Returns { category, confidence: "override" | "rule" | "fallback" }.
 * Unmatched names fall back to pantry (the store's misc aisle) — callers
 * that care (the audit) surface fallback assignments for human review.
 */
function classifyFood(name) {
  const key = name.trim().toLowerCase();
  if (NAME_OVERRIDES[key]) return { category: NAME_OVERRIDES[key], confidence: "override" };

  const isDriedProduceForm = matchesAny(name, PRODUCE_PANTRY_MODIFIERS);

  if (matchesAny(name, DRINK_WORDS) && !matchesAny(name, DRINK_BLOCKERS)) {
    // "Lemon juice"/"lime juice" are cooking ingredients (produce-adjacent
    // pantry), not beverages — but bare "juice" drinks (orange juice, apple
    // juice) belong here. Citrus juice used in cooking goes to pantry below.
    if (/\b(lemon|lime) juice\b/i.test(name)) return { category: "pantry", confidence: "rule" };
    return { category: "drinks", confidence: "rule" };
  }
  if (matchesAny(name, DAIRY_EGG_WORDS) && !matchesAny(name, DAIRY_BLOCKERS)) {
    // Plant milks sit in the dairy fridge/aisle in practice; keep them here.
    return { category: "dairy-eggs", confidence: "rule" };
  }
  if (matchesAny(name, FAT_WORDS) && !matchesAny(name, FAT_BLOCKERS)) {
    return { category: "fats-nuts-oils", confidence: "rule" };
  }
  if (matchesAny(name, PROTEIN_WORDS) && !matchesAny(name, PROTEIN_BLOCKERS)) {
    return { category: "protein", confidence: "rule" };
  }
  if (matchesAny(name, GRAIN_WORDS) && !matchesAny(name, GRAIN_BLOCKERS)) {
    return { category: "grains", confidence: "rule" };
  }
  if (matchesAny(name, PRODUCE_WORDS)) {
    if (isDriedProduceForm) return { category: "pantry", confidence: "rule" };
    return { category: "fruit-veg", confidence: "rule" };
  }
  return { category: "pantry", confidence: "fallback" };
}

module.exports = {
  CATEGORIES,
  CATEGORY_SLUGS,
  CATEGORY_LABEL,
  LEGACY_CATEGORY_LABEL,
  classifyFood,
};
