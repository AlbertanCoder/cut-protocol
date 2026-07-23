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
  // ── USDA FoodData Central import hardening (2026-07-22) ──────────────────
  // The list above was audited exhaustively against an 854-name table. The FDC
  // bulk import took that table to 14,144 names carrying whole food classes the
  // old corpus never contained — ratites, Alaska Native game and marine mammals,
  // organ meats, and USDA's processed-meat vocabulary. Every term below was a
  // MEASURED leak from scripts/auditDietaryCoverage.mjs (animal food that reached
  // a vegan/vegetarian pool unexcluded), not a speculative addition.
  // Ratites + additional game birds
  "ostrich", "emu", "rhea", "pheasant", "squab", "pigeon", "grouse", "partridge",
  "guinea hen", "poultry",
  // Large game + marine mammals (FDC carries an Alaska Native food set)
  "caribou", "moose", "antelope", "buffalo", "beaver", "muskrat", "opossum",
  "raccoon", "woodchuck", "whale", "muktuk", "blubber", "seal meat", "walrus",
  "horse meat", "alligator", "turtle", "terrapin",
  // Organ + offal forms not already covered
  "gizzard", "chitterling", "chitlins", "sweetbread", "giblet", "headcheese",
  "scrapple", "pate", "foie gras", "trotter", "chine", "hock", "cracklings",
  "mechanically deboned", "mechanically separated",
  // Processed-meat forms in USDA's vocabulary
  "bologna", "liverwurst", "braunschweiger", "knockwurst", "knackwurst",
  "andouille", "capicola", "soppressata", "cervelat", "thuringer", "souse",
  // Fish + shellfish the old corpus missed
  "shark", "shark fin", "brain", "brains",
  "smelt", "burbot", "cusk", "roughy", "sturgeon", "shad", "croaker", "cisco",
  "wolffish", "whiting", "sablefish", "lingcod", "sucker", "stingray",
  "snail", "escargot", "abalone", "periwinkle", "urchin", "mollusk", "mollusc",
  "crustacean", "langostino", "krill",
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
    // "curry paste" (Thai red/green/massaman, etc.) standardly contains shrimp
    // paste (kapi) - a hidden shellfish source with no species word in the
    // name, the same structural gap as "seafood mix". This codebase's OWN
    // vegan filter already flags "curry paste" as animal-derived for exactly
    // this reason (ANIMAL_DERIVED_EXTRA_KEYWORDS above), so leaving it clear
    // for a shellfish ALLERGY was an indefensible inconsistency - a vegan was
    // protected but an allergic user was not. Confirmed live: "Thai Red/Green
    // Curry Paste" (3 corpus ingredient rows, ~9 recipes) passed a shellfish
    // exclusion. Curry POWDER - a dried spice blend, no shrimp paste - is
    // deliberately NOT here and stays clear (guarded by an explicit test),
    // matching the measured scoping decision documented on CATEGORY_SYNONYMS.
    "curry paste",
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
    // Tier-1 close-out: the one leak a 941-name pool sweep still found —
    // "White Chocolate Chips" reached a dairy allergy (white chocolate is
    // cocoa butter + milk solids, no "milk" word to match). Plus the
    // remaining milk-carrying sweets/breads from the vegan-side list
    // (butter/cream confections, yogurt/ghee flatbread) and burrata.
    "burrata", "white chocolate", "toffee", "caramel sauce", "naan",
  ],
  soy: [
    "soy", "soya", "tofu", "edamame", "tempeh", "miso", "soybean",
    // QC gauntlet v2 (2026-07-23) — P0 soy leak: the "soy" checkbox did NOT
    // catch textured vegetable protein (defatted soy flour, ~50% soy protein),
    // so a soy-allergic user was being served TVP. These protein forms are now
    // excluded here too (they were only in the separate "soy protein" key).
    // Oil is deliberately NOT added — soybean oil stays permitted, as before.
    "tvp", "textured vegetable protein", "textured soy protein",
    "soy protein isolate", "soy protein concentrate", "soy protein",
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
    // Tier-1 close-out: complete the port from MEAT_FISH_KEYWORDS so the two
    // lists can never drift again (locked by tests/allergySweep.test.js).
    // None of these currently appear in the 941-name pool — they exist so the
    // importer/AI paths can't introduce a leak with a new species name.
    "bass", "sprat", "grouper", "turbot", "flounder", "mullet", "skate",
    "dogfish", "pomfret", "milkfish", "tilefish", "wahoo", "marlin",
    // Fish-derived roe and stock bases (dashi is bonito-flake stock).
    "caviar", "roe", "dashi", "bonito",
    // Hidden-fish carriers (same plausibility bar as gluten's stock cubes):
    // Worcestershire and Caesar dressing are anchovy-based by standard recipe;
    // "curry paste" (Thai red/green) standardly carries fish sauce and/or
    // shrimp paste (see the shellfish list's curry-paste note for the full
    // reasoning). Curry POWDER is a dried spice blend with no such carrier and
    // stays clear.
    "fish sauce", "worcestershire", "caesar dressing", "curry paste",
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
// The plant-qualifier guard only holds when the qualifier is ADJACENT to the
// dairy noun ("coconut milk", "soymilk", "almond butter"). The original guard
// looked for the qualifier ANYWHERE in the name, which meant any food merely
// CONTAINING one of those eight words escaped dairy exclusion outright.
// Measured against the 14,144-name FDC table (scripts/auditDietaryCoverage.mjs,
// 2026-07-22): "Rice, white, cooked, made with butter" and "Puddings, rice, dry
// mix, prepared with whole milk" both reached vegan pools unexcluded, because
// the bare word "rice" vetoed the butter/milk match. Same class of hole as the
// Phase 4 prawn finding — a guard that was too generous in the unsafe direction.
// "butter beans" (limas) in either word order — the curated tables write
// "Butter Beans", FDC writes "Beans, butter, mature seeds, canned". Adjacency is
// what makes this safe: "Green beans ... cooked with butter" does not match.
function isButterBean(n) {
  return /\bbutter\s*,?\s*beans?\b|\bbeans?\s*,\s*butter\b/i.test(String(n || ""));
}

function plantQualified(n, noun) {
  const q = PLANT_MILK_QUALIFIERS.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b(?:${q})[\\s-]*${noun}(?:es|s)?\\b`, "i").test(n);
}

function isDairyMilk(n) {
  return hasWordOrPlural(n, "milk") && !plantQualified(n, "milk");
}

// Paleo's dairy exclusion, minus butter/ghee (see excludedByStyle's paleo
// branch). Same plant-qualifier guard as isDairyMilk() so "coconut cream"
// isn't excluded just because "cream" appears in the name.
function isNonButterDairy(n) {
  return isDairyMilk(n) || (hasWordOrPlural(n, "cream") && !plantQualified(n, "cream")) || matchesAny(n, NON_BUTTER_DAIRY_KEYWORDS);
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
    // The butter-bean exemption must be ADJACENT, not "bean" anywhere in the
    // name — the loose form vetoed real dairy in "Green beans, fresh, cooked
    // with butter or margarine". Both word orders are required because FDC
    // inverts it: "Beans, butter, mature seeds, canned".
    && !isButterBean(n)
    && !hasPhrase(n, "cocoa butter") && !hasPhrase(n, "shea butter")
    && !hasPhrase(n, "apple butter")
    && !plantQualified(n, "butter");
  // hasWordOrPlural, not hasWord: "Ice creams, vanilla, light" is how FDC writes
  // it, and the singular-only match let every plural-form dairy dessert through.
  const creamish = hasWordOrPlural(n, "cream")
    && !hasPhrase(n, "cream of tartar")
    && !plantQualified(n, "cream");
  return butterish || creamish || hasWord(n, "buttermilk");
}

// "meat" is a MEAT_FISH_KEYWORDS entry, but botanists and USDA both use it for
// plant flesh: FDC writes coconut milk as "liquid expressed from grated meat and
// water". That excluded coconut milk — a vegan staple — from every vegan pool.
// Strip only these exact plant-flesh phrases before matching; every other animal
// keyword still applies to the remaining text, so "Beef, grated meat" stays
// excluded via "beef". Over-exclusion is the documented preference, but not when
// it removes a core ingredient on a phrasing artifact.
const PLANT_FLESH_PHRASES = [
  "coconut meat", "grated meat", "kernel meat", "nut meat", "nutmeat",
  "palm meat", "dried meat of the coconut",
];
function stripPlantFlesh(n) {
  let s = String(n || "");
  for (const p of PLANT_FLESH_PHRASES) s = s.replace(new RegExp(p, "gi"), " ");
  return s;
}

function isVeganAnimalProduct(n) {
  return matchesAny(stripPlantFlesh(n), MEAT_FISH_KEYWORDS)
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
    // Same plant-flesh guard as the vegan path — see stripPlantFlesh().
    return matchesAny(stripPlantFlesh(n), MEAT_FISH_KEYWORDS);
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

// Whole-recipe keto carb ceiling (grams of carb in the cached recipe total),
// distinct from DEFAULT_KETO_CARB_THRESHOLD's per-100g ingredient rule.
// Single-sourced here so the solver pool (plans.js) and the library listing
// (recipes.js) can never diverge on what "keto" hides (Stage-C fix M8).
const KETO_RECIPE_CARB_CEILING_G = 30;

// True if this recipe is hidden for a keto profile by the whole-recipe ceiling.
function recipeExceedsKetoCeiling(recipe, dietaryStyle) {
  return dietaryStyle === "keto" && typeof recipe.carb === "number" && recipe.carb > KETO_RECIPE_CARB_CEILING_G;
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
  KETO_RECIPE_CARB_CEILING_G,
  recipeExceedsKetoCeiling,
};
