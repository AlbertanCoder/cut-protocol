// Dietary-style + exclusion-list filtering — narrows a recipe pool BEFORE it
// ever reaches the solver, so the solver never has to know these rules
// exist. Ported verbatim (CommonJS syntax only, zero logic changes) from
// recomp-v2/src/engine/dietaryFilter.js, which itself had zero dependencies -
// this is a self-contained module by design in both codebases.
//
// cut-protocol previously had NO dietary-exclusion filtering anywhere in its
// actual meal-plan generation path (confirmed via grep across backend/src
// before this file was added) - recipePool loaded in plans.js's
// planContext() went straight to the solver unfiltered. That was a latent
// safety gap even with the original 27-recipe curated library; it became a
// real one once seedRecipesFromRecomp.mjs added 602 generic TheMealDB-sourced
// recipes (shellfish, gluten, dairy, etc. all present) to the same pool.

// Phase 4 hardening: the original short list (ported from recomp) knew
// "shrimp" and "cod" but not sardines, sea bass, squid, goat, or pepperoni —
// live verification caught prawn stew being offered to a vegan account.
// Vegan/vegetarian exclusion must cover every meat/fish/seafood species and
// processed-meat form in the real 600-recipe pool, erring on over-exclusion.
const MEAT_FISH_KEYWORDS = [
  // land meats + cuts
  "chicken", "turkey", "duck", "goose", "quail", "poussin", "beef", "pork",
  "bacon", "ham", "gammon", "steak", "sirloin", "flank", "brisket", "oxtail",
  "rib", "jerky", "elk", "venison", "bison", "game", "lamb", "mutton", "goat",
  "veal", "rabbit", "boar", "liver", "kidney", "tripe", "tongue", "bone marrow",
  "meat", "mince", "meatball",
  // processed meats
  "sausage", "salami", "pepperoni", "chorizo", "prosciutto", "pancetta",
  "spam", "hot dog", "frankfurter", "bratwurst", "kielbasa", "mortadella",
  "pastrami", "black pudding", "haggis", "luncheon", "deli",
  // fish
  "salmon", "tuna", "fish", "cod", "tilapia", "halibut", "trout", "mackerel",
  "sardine", "pilchard", "anchovy", "anchovies", "herring", "kipper", "haddock",
  "sole", "plaice", "bass", "snapper", "bream", "monkfish", "swordfish", "mahi",
  "pollock", "perch", "pike", "carp", "eel", "hake", "sprat", "whitebait",
  "barramundi", "grouper", "turbot", "flounder", "mullet", "catfish",
  "skate", "dogfish", "pomfret", "milkfish", "tilefish", "wahoo", "marlin",
  "caviar", "roe", "surimi",
  // shellfish + cephalopods
  "shrimp", "scallop", "prawn", "crab", "lobster", "mussel", "clam", "oyster",
  "crayfish", "crawfish", "squid", "calamari", "octopus", "cuttlefish",
  "seafood", "conch", "whelk", "cockle", "frog",
  // animal-derived binders
  "gelatin", "gelatine", "lard", "suet", "tallow", "worcestershire", "fish sauce",
  "oyster sauce", "shrimp paste", "dashi", "bonito",
];
// Meat-only subset (no fish) — used by kosher's meat+dairy rule, where fish
// + dairy is permitted but meat + dairy is not.
const MEAT_KEYWORDS = [
  "chicken", "turkey", "duck", "beef", "pork", "bacon", "ham", "lamb",
  "steak", "sirloin", "flank", "jerky", "elk", "venison", "bison", "game",
  "sausage", "salami", "pepperoni", "chorizo", "prosciutto", "mince", "meatball",
];
const PORK_KEYWORDS = [
  "pork", "bacon", "ham", "prosciutto", "pancetta", "lard", "chorizo",
  "salami", "pepperoni", "spam", "pork rinds", "black pudding",
];
const ALCOHOL_KEYWORDS = [
  "wine", "beer", "lager", "ale", "cider", "rum", "brandy", "whiskey",
  "whisky", "vodka", "gin", "sherry", "port", "sake", "liqueur", "tequila",
  "shaoxing", "prosecco", "champagne", "stout",
];
const PROCESSED_MEAT_KEYWORDS = [
  "bacon", "sausage", "salami", "pepperoni", "chorizo", "hot dog", "spam",
  "prosciutto", "pancetta", "deli meat", "luncheon meat",
];
// NOTE: no bare "butter"/"cream" here — those need compound guards (peanut
// butter, butter beans, coconut cream are all plant foods); see
// isVeganAnimalProduct() below.
const ANIMAL_DERIVED_EXTRA_KEYWORDS = [
  "egg", "eggs", "cheese", "yogurt", "yoghurt", "whey", "casein", "ghee",
  "honey", "mayonnaise", "skyr", "kefir", "custard", "quark", "milk powder",
  // Cheese VARIETY names — none contain the word "cheese", all are dairy
  // (caught by the 854-name food-table audit, Phase 4).
  "mozzarella", "cheddar", "parmesan", "feta", "ricotta", "brie", "gouda",
  "halloumi", "mascarpone", "paneer", "stilton", "gorgonzola", "camembert",
  "gruyere", "gruyère", "edam", "emmental", "manchego", "pecorino",
  "provolone", "burrata", "queso", "creme fraiche", "crème fraîche", "curd",
  // Hidden-animal carriers caught by the 854-name audit: milk-based sweets,
  // egg-based sauces/doughs, gelatin sweets, yogurt/ghee breads, and the
  // shrimp-paste-based Thai pastes (same safe-side reasoning as gluten's
  // stock cubes — over-exclusion is the correct failure direction).
  "dulce de leche", "marshmallow", "meringue", "white chocolate",
  "milk chocolate", "mars bar", "aioli", "aïoli", "christmas pudding",
  "perogi", "pierogi", "toffee", "caramel sauce", "naan", "wonton",
  "curry paste",
];
const PLANT_MILK_QUALIFIERS = ["almond", "soy", "oat", "coconut", "cashew", "rice", "hemp", "pea"];

// Paleo exclusions. Deliberately broader than the gluten-only synonym list
// above (paleo excludes gluten-free grains too - rice, corn, oats).
const GRAIN_KEYWORDS = [
  "rice", "wheat", "corn", "oat", "oats", "barley", "rye", "pasta", "noodle",
  "bread", "cereal", "couscous", "quinoa", "buckwheat", "cornmeal", "tortilla",
  "cracker", "flour",
];
const LEGUME_KEYWORDS = [
  "bean", "beans", "lentil", "lentils", "soy", "soya", "tofu", "tempeh",
  "edamame", "chickpea", "chickpeas", "peanut", "peanuts",
];
const NON_BUTTER_DAIRY_KEYWORDS = ["cheese", "yogurt", "yoghurt", "whey", "casein", "kefir", "custard"];

// Category synonym maps for hard exclusions (allergies/intolerances), keyed
// by the term a user is expected to pick from a profile allergy list. Guards
// against literal substring matching on "gluten" or "shellfish" matching
// almost nothing, because no real food is literally named that - only
// category members are ("wheat", "shrimp", "crab"...). A term that isn't a
// key here falls back to literal substring matching (below), which covers
// custom/free-text exclusions like "kiwi" or a specific product name.
const CATEGORY_SYNONYMS = {
  // "stock cube"/"bouillon"/"gravy mix" are common hidden-wheat AND
  // hidden-soy carriers (both wheat flour and hydrolyzed soy protein are
  // standard cheap thickener/flavor-enhancer fillers in commercial stock and
  // gravy products) - added to both gluten and soy for that reason, same
  // real-world-plausibility bar as the shellfish compound terms below.
  // Measured against the real 629-recipe pool before shipping: scoping these
  // terms to the specific categories they're actually plausible for (rather
  // than treating every compound/blended product name as ambiguous for every
  // exclusion, which was measured to newly exclude 38 recipes for this
  // account's actual shellfish/kiwi/soy-protein exclusions - 36 of them for
  // curry powder/five-spice, neither of which has an established
  // hidden-allergen risk) keeps the fix targeted at the real gap instead of
  // shrinking the pool for reasons unrelated to any declared allergy.
  gluten: [
    "gluten", "wheat", "barley", "rye", "couscous", "pasta", "bread", "farro",
    "malt", "seitan", "spelt", "semolina", "bulgur", "cracker", "crackers",
    "noodle", "noodles", "tortilla", "tortillas", "cereal", "breadcrumb",
    "breadcrumbs", "flour", "orzo", "panko",
    "stock cube", "stock powder", "bouillon", "gravy mix", "gravy granules",
    // Stage-C audit: gluten carriers the celiac live-test found on the plate —
    // pasta shapes, pastry, dumpling wrappers, and the hidden-wheat sauces
    // (standard soy/hoisin/teriyaki are wheat-brewed; beer is barley).
    "spaghetti", "macaroni", "penne", "lasagne", "lasagna", "lasagne sheets",
    "fettuccine", "linguine", "tagliatelle", "ravioli", "tortellini", "gnocchi",
    "vermicelli", "udon", "ramen", "filo", "phyllo", "puff pastry", "shortcrust",
    "pastry", "wonton", "won ton", "dumpling", "gyoza", "pierogi", "perogi",
    "biscuit", "biscuits", "cookie", "cookies", "pretzel", "pretzels", "beer",
    "ale", "lager", "pita", "naan", "bun", "buns", "bagel", "brioche",
    "croissant", "pancake", "pancakes", "waffle", "waffles", "muffin", "scone",
    "pie crust", "batter", "digestive", "soy sauce", "hoisin", "teriyaki",
    "worcestershire",
  ],
  shellfish: [
    "shellfish", "shrimp", "prawn", "crab", "lobster", "scallop", "mussel",
    "clam", "oyster", "crawfish", "crayfish", "langoustine", "scampi",
    "cockle", "whelk", "abalone",
    // Stage-C audit: cephalopods and gastropods reached a shellfish-allergic
    // user's plate/library/swaps live (squid, calamari, conch) — they are
    // shellfish (molluscs) and were entirely absent before.
    "squid", "calamari", "octopus", "cuttlefish", "conch",
    // Compound/generic product names that legitimately contain shellfish but
    // don't literally spell out any species word - confirmed real case:
    // "Frozen Seafood mix" on "Spanish seafood rice" (PABLO_REVIEW.md §2.5).
    // "seafood" ALONE is deliberately not in this list - "seafood" also
    // covers plain fish (see the "Smoked Haddock Kedgeree" case Pablo found
    // was a correct non-match), and adding bare "seafood" here would
    // over-exclude fish-only dishes for a shellfish-only allergy. The
    // multi-word phrases below are specific enough to reliably mean a
    // blended/mixed product, which in practice is shellfish-inclusive.
    "seafood mix", "seafood medley", "mixed seafood", "seafood stock", "surimi",
  ],
  dairy: [
    "dairy", "milk", "cheese", "yogurt", "yoghurt", "whey", "casein",
    "butter", "cream", "ghee", "custard", "kefir", "buttermilk", "curd",
    "skyr", "quark",
    // Stage-C audit: cheese-variety names (no literal "cheese") reached a
    // dairy-allergic user — Mozzarella 90 g on the plate. Over-exclusion is
    // the safe direction for an allergy.
    "mozzarella", "parmesan", "parmigiano", "cheddar", "feta", "ricotta",
    "gouda", "brie", "camembert", "gruyere", "gruyère", "pecorino", "provolone",
    "gorgonzola", "mascarpone", "halloumi", "paneer", "queso", "manchego",
    "emmental", "edam", "havarti", "roquefort", "stilton", "creme fraiche",
    "crème fraîche", "dulce de leche", "clotted cream",
  ],
  soy: [
    "soy", "soya", "tofu", "edamame", "tempeh", "miso", "soybean",
    "stock cube", "stock powder", "bouillon", "gravy mix", "gravy granules",
  ],
  // A free-text "soy protein" exclusion (this app's original primary account
  // uses it, permitting soybean OIL) must catch the protein forms without
  // touching oil. Mirrors aiRecipeClient's own definition of this allergy.
  "soy protein": [
    "soy protein", "tofu", "tempeh", "edamame", "soy milk", "tvp",
    "textured vegetable protein", "miso",
  ],
  nuts: [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut",
    "macadamia", "peanut", "nut",
    "mixed nuts", "nut mix", "trail mix",
  ],
  // egg carriers include the emulsions built on raw egg (Stage-C: aioli and
  // custard reached an egg-allergic user).
  egg: ["egg", "eggs", "mayonnaise", "meringue", "aioli", "aïoli", "custard", "hollandaise"],
  // Phase 3 allergy checkboxes — one key per checkbox, matching the UI values.
  eggs: ["egg", "eggs", "mayonnaise", "meringue", "aioli", "aïoli", "custard", "hollandaise"],
  fish: [
    "fish", "salmon", "tuna", "cod", "haddock", "tilapia", "halibut", "trout",
    "mackerel", "sardine", "anchovy", "anchovies", "herring", "sea bass",
    "snapper", "kipper", "surimi",
    // Stage-C audit: fish species present in the pool but absent here reached
    // a fish-allergic user (pilchards on the plate, barramundi/monkfish shown).
    "pilchard", "pilchards", "barramundi", "monkfish", "pollock", "pollack",
    "bream", "pangasius", "catfish", "sole", "plaice", "whiting", "hake",
    "mahi", "swordfish", "pike", "perch", "carp", "eel", "smelt", "whitebait",
    // Hidden-fish carriers (same plausibility bar as gluten's stock cubes):
    // Worcestershire and Caesar dressing are anchovy-based by standard recipe.
    "fish sauce", "worcestershire", "caesar dressing",
  ],
  kiwi: ["kiwi", "kiwifruit"],
  // Peanuts are legumes — a peanut allergy is NOT a tree-nut allergy and
  // vice-versa, so these are deliberately separate lists.
  peanuts: ["peanut", "peanuts", "groundnut", "peanut butter", "peanut oil", "satay"],
  "tree nuts": [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut",
    "macadamia", "brazil nut", "pine nut", "praline", "marzipan", "amaretto",
    "nut butter", "mixed nuts", "nut mix", "trail mix",
  ],
  sesame: ["sesame", "tahini", "halva", "benne", "gomashio", "hummus", "houmous"],
};

// Default keto threshold is on carb-per-100g of the raw ingredient, not a
// typical realistic serving size - a disclosed simplification.
const DEFAULT_KETO_CARB_THRESHOLD = 15;

function hasWord(name, word) {
  return new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(name);
}

// Same word-boundary match as hasWord(), but tolerant of a trailing "s" or
// "es" plural - CATEGORY_SYNONYMS lists singular keywords ("almond",
// "cracker") but real ingredient names are very often plural ("Almonds").
function hasWordOrPlural(name, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "(?:es|s)?\\b", "i").test(name);
}

// Plural-aware: real ingredient names are very often plural ("Prawns",
// "Sardines") while keyword lists are singular. The exact-match hasWord()
// let every plural-only species name straight through the vegan/vegetarian
// style filter — caught live in Phase 4 verification. Style keywords now get
// the same s/es tolerance the allergy synonym path always had.
function matchesAny(name, words) {
  return words.some((w) => (w.includes(" ") ? hasPhrase(name, w) : hasWordOrPlural(name, w)));
}

// hasWord()/hasWordOrPlural() are single-word, word-boundary regexes - they
// don't handle multi-word phrases like "seafood mix" or "stock cube" (a
// boundary-anchored regex per word would require matching word order and
// adjacency, which \b-per-word doesn't give you for free). Plain
// case-insensitive substring is the right tool for a fixed multi-word phrase;
// single-word entries still get the stricter word-boundary/plural treatment.
function hasPhrase(name, phrase) {
  return name.toLowerCase().includes(phrase.toLowerCase());
}

function matchesTermList(name, term) {
  return term.includes(" ") ? hasPhrase(name, term) : hasWordOrPlural(name, term);
}

// "milk" alone isn't a reliable animal-derived signal - "almond milk", "soy
// milk", "oat milk" are all plant-based. Only treat a "milk" match as dairy
// when no plant-milk qualifier is also present in the name.
function isDairyMilk(n) {
  return hasWord(n, "milk") && !matchesAny(n, PLANT_MILK_QUALIFIERS);
}

// Paleo's dairy exclusion, minus butter/ghee (see excludedByStyle's paleo
// branch). Same plant-qualifier guard as isDairyMilk() so "coconut cream"
// isn't excluded just because "cream" appears in the name.
function isNonButterDairy(n) {
  return isDairyMilk(n) || (hasWord(n, "cream") && !matchesAny(n, PLANT_MILK_QUALIFIERS)) || matchesAny(n, NON_BUTTER_DAIRY_KEYWORDS);
}

// A recipe is style-excluded if ANY of its ingredients matches the same
// keyword logic used for flat foods. recipe: {ingredients:[{name}]}.
// NOTE - keto is a real exception here: it depends on food.carb (a number),
// and this function is only ever called with ingredient NAMES (carb
// hardcoded to 0 below, since RecipeIngredient doesn't carry its own macro
// data - only a foodId reference) - so this path can never actually catch a
// high-carb recipe under keto. That's not fixable at the ingredient-name
// level; routes/plans.js's filterRecipePool() does a separate, correct
// per-recipe carb-ceiling check using the recipe's own cached `carb` total
// instead, specifically because of this limitation.
function recipeExcludedByStyle(recipe, dietaryStyle) {
  if (!dietaryStyle || dietaryStyle === "none") return false;
  if (recipe.ingredients.some((ing) => excludedByStyle({ name: ing.name, carb: 0 }, dietaryStyle))) return true;
  // Kosher has a COMBINATION rule no single ingredient can trip: meat and
  // dairy may not share a dish (fish + dairy is fine). Only checkable at
  // recipe level, so it lives here rather than in excludedByStyle().
  if (dietaryStyle === "kosher") {
    const names = recipe.ingredients.map((i) => i.name);
    const hasMeat = names.some((n) => matchesAny(n, MEAT_KEYWORDS));
    const hasDairy = names.some(isKosherDairy);
    if (hasMeat && hasDairy) return true;
  }
  return false;
}

// Dairy as kosher's meat+dairy rule sees it: real milk/cheese/cream/etc.
// plus butter — but never "peanut butter", "butter beans", "buttermilk
// squash"-style compounds or plant qualifiers.
function isKosherDairy(n) {
  if (isDairyMilk(n) || matchesAny(n, NON_BUTTER_DAIRY_KEYWORDS)) return true;
  return hasWord(n, "butter")
    && !hasPhrase(n, "peanut butter") && !hasPhrase(n, "nut butter")
    && !hasWordOrPlural(n, "bean") && !matchesAny(n, PLANT_MILK_QUALIFIERS);
}

// Adjuster/single-food equivalent of recipeExcludedByStyle(). Same keto
// caveat applies (adjusters are named ingredients here, not full Food rows).
function adjusterExcludedByStyle(adjuster, dietaryStyle) {
  if (!dietaryStyle || dietaryStyle === "none") return false;
  return excludedByStyle({ name: adjuster.name, carb: 0 }, dietaryStyle);
}

// Dairy butter/cream with the compound guards: "peanut butter", "butter
// beans", "coconut cream", "cream of tartar" are plant foods.
function isDairyButterOrCream(n) {
  const butterish = hasWordOrPlural(n, "butter")
    && !hasPhrase(n, "peanut butter") && !hasPhrase(n, "nut butter")
    && !hasWordOrPlural(n, "bean")
    && !matchesAny(n, PLANT_MILK_QUALIFIERS);
  const creamish = hasWord(n, "cream")
    && !hasPhrase(n, "cream of tartar")
    && !matchesAny(n, PLANT_MILK_QUALIFIERS);
  return butterish || creamish || hasWord(n, "buttermilk");
}

function isVeganAnimalProduct(n) {
  return matchesAny(n, MEAT_FISH_KEYWORDS)
    || matchesAny(n, ANIMAL_DERIVED_EXTRA_KEYWORDS)
    || isDairyMilk(n)
    || isDairyButterOrCream(n);
}

function excludedByStyle(food, dietaryStyle) {
  const n = food.name;
  if (dietaryStyle === "vegan") {
    return isVeganAnimalProduct(n);
  }
  if (dietaryStyle === "vegetarian") {
    return matchesAny(n, MEAT_FISH_KEYWORDS);
  }
  if (dietaryStyle === "keto") {
    return food.carb > DEFAULT_KETO_CARB_THRESHOLD;
  }
  if (dietaryStyle === "paleo") {
    // Excludes grains, legumes, and dairy. Butter/ghee are deliberately NOT
    // excluded (common paleo-friendly exception - mostly fat, milk solids
    // removed). Disclosed simplification: doesn't try to distinguish white
    // potato (excluded under some strict paleo interpretations) from sweet
    // potato - genuinely contested even within paleo itself, so excluding
    // either by default seemed more likely to be wrong than right.
    return matchesAny(n, GRAIN_KEYWORDS) || matchesAny(n, LEGUME_KEYWORDS) || isNonButterDairy(n);
  }
  if (dietaryStyle === "carnivore") {
    // Inverted vs. every style above: excludes everything that ISN'T an
    // animal product, rather than excluding specific categories. Dairy is
    // treated as allowed (common real-world carnivore practice, even though
    // the strictest "lion diet" variant excludes it too - same
    // mainstream-common-case-over-edge-case call paleo's potato question made).
    return !isVeganAnimalProduct(n);
  }
  if (dietaryStyle === "mediterranean") {
    // Mediterranean is a PATTERN, not a hard exclusion list — implemented as
    // its widely-agreed hard "avoid" core: processed meats and sugary
    // drinks/candy. Disclosed simplification (it does not police red-meat
    // frequency or olive-oil-vs-butter ratios; a filter can't count meals).
    return matchesAny(n, PROCESSED_MEAT_KEYWORDS) || matchesAny(n, ["candy", "soda", "cola", "energy drink"]);
  }
  if (dietaryStyle === "halal") {
    // Pork in all its cured forms + alcohol (including cooking wine — the
    // common strict practice) + gelatin (pork-derived unless certified,
    // which ingredient names can't tell us — excluded on the safe side).
    // Salami/pepperoni/chorizo are excluded although beef versions exist:
    // over-exclusion is the correct failure direction for a religious rule.
    return matchesAny(n, PORK_KEYWORDS) || matchesAny(n, ALCOHOL_KEYWORDS) || hasWord(n, "gelatin");
  }
  if (dietaryStyle === "kosher") {
    // Ingredient-level: pork family + shellfish + gelatin (same
    // safe-side reasoning as halal) + rabbit. The meat+dairy combination
    // rule lives in recipeExcludedByStyle() — it needs the whole dish.
    return matchesAny(n, PORK_KEYWORDS) || matchesAny(n, CATEGORY_SYNONYMS.shellfish.filter((w) => !w.includes(" "))) || hasWord(n, "gelatin") || hasWord(n, "rabbit");
  }
  return false;
}

// The styles the Profile UI offers — single source for route validation.
const DIETARY_STYLES = ["none", "mediterranean", "vegetarian", "vegan", "paleo", "keto", "carnivore", "halal", "kosher"];

// Does a single exclusion term match this food/ingredient name? Exported
// pure so callers can apply the exact same rule to recipe.ingredients[].name,
// not just food.name.
function matchesExclusionTerm(name, term) {
  // Defense-in-depth: a non-string term (e.g. a number that slipped past
  // validation) must never throw here — it would 500 every recipe screen.
  const key = String(term ?? "").trim().toLowerCase();
  if (!key) return false;
  const synonyms = CATEGORY_SYNONYMS[key];
  if (synonyms) {
    // "milk" needs the same plant-milk qualifier check the vegan/vegetarian
    // style filter already uses - a dairy allergy must not remove almond
    // milk just because "milk" is a dairy synonym. Multi-word synonym
    // entries ("seafood mix", "stock cube") use substring matching via
    // matchesTermList(); single-word entries keep the stricter
    // word-boundary/plural match.
    return synonyms.some((word) => {
      // milk/cream/butter get the same plant-qualifier guards the style filter
      // uses, so a dairy allergy doesn't wrongly remove coconut cream, almond
      // milk, or peanut butter (plant foods a dairy-allergic person can eat).
      if (word === "milk") return isDairyMilk(name);
      if (word === "cream") return hasWord(name, "cream") && !hasPhrase(name, "cream of tartar") && !matchesAny(name, PLANT_MILK_QUALIFIERS);
      if (word === "butter") return isDairyButterOrCream(name);
      return matchesTermList(name, word);
    });
  }
  // Not a known category - literal substring fallback. Covers free-text
  // entries like "kiwi" and specific multi-word phrases like "soy protein"
  // that should NOT expand to the whole soy category.
  return name.toLowerCase().includes(key);
}

function excludedByList(food, excludedFoods) {
  if (!excludedFoods || !excludedFoods.length) return false;
  return excludedFoods.some((term) => matchesExclusionTerm(food.name, term));
}

// profile: {dietaryStyle: "none"|"vegan"|"vegetarian"|"keto", excludedFoods: string[]}
function applyDietaryFilters(pool, profile) {
  const dietaryStyle = profile?.dietaryStyle || "none";
  const excludedFoods = profile?.excludedFoods || [];
  if (dietaryStyle === "none" && excludedFoods.length === 0) return pool;
  return pool.filter((food) => !excludedByStyle(food, dietaryStyle) && !excludedByList(food, excludedFoods));
}

// Per-term exclusion counts against a flat food pool, so the UI can render
// "N excluded for: gluten" - silent failure is banned.
function traceExclusions(pool, excludedFoods) {
  const counts = {};
  (excludedFoods || []).forEach((term) => {
    const key = String(term ?? "").trim().toLowerCase();
    if (!key) return;
    counts[key] = (pool || []).filter((food) => matchesExclusionTerm(food.name, key)).length;
  });
  return counts;
}

// Recipe-level equivalent of traceExclusions() - a recipe's top-level .name
// is its dish title ("Algerian Kefta"), not an ingredient, so matching a term
// against it would silently undercount. Checks every ingredient name instead.
// recipes: [{ingredients:[{name}]}]
function traceRecipeExclusions(recipes, excludedFoods) {
  const counts = {};
  (excludedFoods || []).forEach((term) => {
    const key = String(term ?? "").trim().toLowerCase();
    if (!key) return;
    counts[key] = (recipes || []).filter((recipe) =>
      (recipe.ingredients || []).some((ing) => matchesExclusionTerm(ing.name, key))
    ).length;
  });
  return counts;
}

module.exports = {
  DIETARY_STYLES,
  recipeExcludedByStyle,
  adjusterExcludedByStyle,
  matchesExclusionTerm,
  applyDietaryFilters,
  traceExclusions,
  traceRecipeExclusions,
};
