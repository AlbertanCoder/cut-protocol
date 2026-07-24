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
    // QC gauntlet v2 (2026-07-23) — wheat-based grains the celiac sweep missed.
    "triticale", "matzo", "matzah", "graham",
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
    // QC gauntlet v2 (2026-07-23) — gelato is milk-based; it was uncaught.
    "gelato",
    // Wave 2 (2026-07-23) — a name that says "lactose" is a milk-derived
    // product by definition, including the LACTOSE-FREE ones: lactose-free
    // milk and lactose-free infant formula are still cow's-milk protein, which
    // is the thing a dairy ALLERGY reacts to (lactose intolerance and milk
    // allergy are different conditions and this filter serves the dangerous
    // one). Measured leak: three "Infant formula, ABBOTT NUTRITION, SIMILAC,
    // SENSITIVE (LACTOSE FREE)" rows reached a dairy allergy in the real
    // 14,124-food table.
    "lactose",
  ],
  soy: [
    "soy", "soya", "tofu", "edamame", "tempeh", "miso", "soybean",
    // QC gauntlet v2 (2026-07-23) — P0 soy leak: the "soy" checkbox did NOT
    // catch textured vegetable protein (defatted soy flour, ~50% soy protein),
    // so a soy-allergic user was being served TVP. These protein forms are now
    // excluded here too (they were only in the separate "soy protein" key).
    // Oil is deliberately NOT added — soybean oil stays permitted, as before.
    "tvp", "textured vegetable protein", "textured soy protein",
    "soy protein isolate", "soy protein concentrate", "soy protein", "natto",
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
    // QC gauntlet v2 (2026-07-23) — nut leak: "Cooked Chestnut" (an ingredient
    // in a real recipe) and the hazelnut/almond confections below reached a
    // nut-allergic user. chestnut is an FDA tree nut; it gets a per-word guard
    // (below) so WATER chestnut — not a nut — is not swept up.
    "chestnut", "brazil nut", "pine nut",
    "nutella", "praline", "pralines", "gianduja", "marzipan",
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
  // THIS is the key the UI's "Tree nuts" checkbox actually sends (see
  // routes/profile.js allergyOptions). It MUST stay in sync with `nuts` above —
  // a QC persona (2026-07-23) found chestnut/nutella missing HERE while present
  // in `nuts`, so an anaphylactic tree-nut user was served "Cooked Chestnut".
  // A drift-guard test (tests/qc/treeNutParity.test.js) now asserts the two keys
  // agree on the critical terms. chestnut uses the water-chestnut word-guard in
  // matchesExclusionTerm.
  "tree nuts": [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut",
    "macadamia", "brazil nut", "pine nut", "praline", "pralines", "marzipan", "amaretto",
    "chestnut", "nutella", "gianduja",
    "nut butter", "mixed nuts", "nut mix", "trail mix",
  ],
  sesame: ["sesame", "tahini", "halva", "benne", "gomashio", "hummus", "houmous"],
  // The remaining major declarable allergens. These keys exist so an Open Food
  // Facts `allergens_tags` value has somewhere to land (see
  // OFF_TAG_FAMILY below) and so a user who types one gets a category rather
  // than a substring. Nothing in the UI sends them today, so adding them
  // cannot change any existing profile's pool.
  celery: ["celery", "celeriac", "celery salt", "celery seed"],
  mustard: ["mustard", "dijon", "wholegrain mustard", "mustard seed"],
  lupin: ["lupin", "lupine", "lupini"],
  sulphites: ["sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide", "e220"],
};

// ─────────────────────────────────────────────────────────────────────────
// COMPOUND TOKENS — finding dietary-safety-2 (P0)
// ─────────────────────────────────────────────────────────────────────────
// Every keyword match in this file is word-boundary anchored (hasWordOrPlural),
// which is what stops "bass" matching "Basil" and "ham" matching "graham". The
// cost of that anchoring is that a PREPARED-DISH name written as one word hides
// its allergen from every list: "Cheeseburger" contains no word-bounded
// "cheese", "Eggnog" no word-bounded "egg", "Fishcake" no word-bounded "fish".
// Measured 2026-07-23: all three passed their allergy exclusion.
//
// The fix is a CURATED dictionary, deliberately not a general splitter. An
// unbounded splitter finds "ham" inside "graham", "nut" inside "doughnut" and
// "butternut", "milk" inside "milkfish" (which is a FISH, not dairy) — it
// trades one class of leak for a class of false positives that would quietly
// starve a pool. Here nothing fires unless it is listed, so a false friend is
// safe by construction rather than by a suppression list that can drift.
// COMPOUND_FALSE_FRIENDS below pins that property in tests anyway.
//
// Semantics: a hit ADDS the listed tokens to the text being matched. The
// original name is always preserved verbatim, so this can only ever widen a
// match, never narrow one (the add-only rule, top to bottom).
const COMPOUND_TOKENS = {
  // ── dairy carriers ──
  cheeseburger: ["cheese", "beef"],
  cheesesteak: ["cheese", "beef"],
  cheesecake: ["cheese"],
  cheeseball: ["cheese"],
  cheesy: ["cheese"],
  milkshake: ["milk"],
  milky: ["milk"],          // "Milky Way" — milk chocolate + nougat
  buttermilk: ["milk"],
  butterscotch: ["butter"],
  buttercream: ["butter", "cream"],
  butterfat: ["butter"],
  creamer: ["cream"],       // non-dairy creamers are overwhelmingly caseinate
  latte: ["milk"],
  cappuccino: ["milk"],
  alfredo: ["cream", "parmesan"],
  stroganoff: ["cream", "beef"],
  // ── egg carriers ──
  eggnog: ["egg", "milk"],
  eggwhite: ["egg"],
  eggyolk: ["egg"],
  eggroll: ["egg"],
  mayo: ["egg"],            // "Mayo" — the list knows "mayonnaise", not the clipping
  omelette: ["egg"],
  omelet: ["egg"],
  frittata: ["egg"],
  quiche: ["egg", "cream", "pastry"],
  carbonara: ["egg", "cheese", "bacon"],
  // ── fish / shellfish carriers ──
  fishcake: ["fish"],
  fishball: ["fish"],
  fishstick: ["fish"],
  fishfinger: ["fish"],
  tunafish: ["tuna"],
  kedgeree: ["haddock"],
  caesar: ["anchovy", "parmesan", "egg"], // Caesar dressing: anchovy + parmesan + raw egg
  crabcake: ["crab"],
  crabstick: ["surimi"],
  // ── gluten carriers ──
  shortbread: ["bread", "butter"],
  gingerbread: ["bread"],
  flatbread: ["bread"],
  cornbread: ["bread"],
  breadstick: ["bread"],
  sourdough: ["bread"],
  doughnut: ["bread"],      // deliberately NOT "nut" — see COMPOUND_FALSE_FRIENDS
  donut: ["bread"],
  wholewheat: ["wheat"],
  biscotti: ["wheat"],
  crouton: ["bread"],
  matzoball: ["matzo"],
  // ── nut carriers ──
  peanutbutter: ["peanut"],
};

// Names that CONTAIN an allergen substring but are not that allergen. They are
// absent from COMPOUND_TOKENS on purpose; this array is the executable record
// of that decision (tests/allergySweep.test.js asserts every one of them stays
// clear of the listed terms). Add to this list, not to a suppression rule.
const COMPOUND_FALSE_FRIENDS = [
  { name: "Graham crackers", mustNotMatch: ["peanuts"], mustNotStyle: ["halal"], why: "'ham' inside 'graham' is not pork" },
  { name: "Hamburger, plain", mustNotMatch: [], mustNotStyle: ["halal"], why: "a hamburger is beef; 'ham' inside 'hamburger' is not pork" },
  { name: "Eggplant, raw", mustNotMatch: ["egg", "eggs"], mustNotStyle: [], why: "aubergine is a vegetable" },
  { name: "Nutmeg, ground", mustNotMatch: ["tree nuts", "nuts"], mustNotStyle: [], why: "nutmeg is a seed spice, not a tree nut" },
  { name: "Butternut squash, raw", mustNotMatch: ["dairy", "tree nuts", "nuts"], mustNotStyle: [], why: "neither butter nor a nut" },
  { name: "Butterhead lettuce", mustNotMatch: ["dairy"], mustNotStyle: [], why: "a lettuce cultivar" },
  { name: "Butterflied chicken breast", mustNotMatch: ["dairy"], mustNotStyle: [], why: "'butterflied' is a cut, not butter" },
  { name: "Coconut, raw", mustNotMatch: ["tree nuts", "nuts"], mustNotStyle: [], why: "this codebase's nut lists deliberately exclude coconut" },
  { name: "Water chestnut, canned", mustNotMatch: ["tree nuts", "nuts"], mustNotStyle: [], why: "an aquatic vegetable" },
  { name: "Doughnuts, glazed", mustNotMatch: ["tree nuts", "nuts"], mustNotStyle: [], why: "'nut' inside 'doughnut' is not a nut" },
  { name: "Milkfish, raw", mustNotMatch: ["dairy"], mustNotStyle: [], why: "milkfish is a fish; it carries no milk" },
];

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One alternation, longest-first so a longer compound wins over a shorter one
// that prefixes it. Built once — this runs over 14,144 names in the sweep.
const COMPOUND_RE = new RegExp(
  "\\b(" + Object.keys(COMPOUND_TOKENS).sort((a, b) => b.length - a.length).map(escapeRe).join("|") + ")(?:es|s)?\\b",
  "gi",
);
const compoundCache = new Map();
const COMPOUND_CACHE_MAX = 20000;

/**
 * Return `name` with the tokens implied by any curated compound word appended.
 * ADD-ONLY BY CONSTRUCTION: the input string is returned unmodified with text
 * appended, never edited or removed, so every match that fired on the raw name
 * still fires on the expanded one.
 */
function expandCompoundTokens(name) {
  const s = String(name ?? "");
  if (!s) return s;
  const cached = compoundCache.get(s);
  if (cached !== undefined) return cached;

  let extra = null;
  COMPOUND_RE.lastIndex = 0;
  let m;
  while ((m = COMPOUND_RE.exec(s)) !== null) {
    for (const token of COMPOUND_TOKENS[m[1].toLowerCase()]) (extra ||= new Set()).add(token);
  }
  const out = extra ? `${s} ${[...extra].join(" ")}` : s;
  if (compoundCache.size >= COMPOUND_CACHE_MAX) compoundCache.clear();
  compoundCache.set(s, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// FREE-TEXT ALIASES — finding dietary-safety-5 (P1)
// ─────────────────────────────────────────────────────────────────────────
// A term that isn't a CATEGORY_SYNONYMS key used to degrade straight to literal
// substring matching. That silently under-excludes exactly the people most at
// risk: someone who types the symptom or the protein they react to rather than
// the checkbox label. Measured 2026-07-23: "lactose" did not exclude whole
// milk, "wheat" did not exclude semolina, "prawn" did not exclude shrimp.
//
// Each alias resolves to an existing CATEGORY_SYNONYMS key, so the user gets
// the WHOLE category. The literal term is still applied on top (union, never
// replacement) — "lactose" therefore matches both the dairy category and any
// product that literally says lactose.
const FREE_TEXT_ALIASES = {
  // dairy
  milk: "dairy", lactose: "dairy", "lactose intolerance": "dairy", casein: "dairy",
  caseinate: "dairy", "sodium caseinate": "dairy", whey: "dairy", "whey protein": "dairy",
  lactalbumin: "dairy", lactoglobulin: "dairy", "milk protein": "dairy",
  "milk solids": "dairy", milkfat: "dairy", "milk fat": "dairy", butter: "dairy",
  cheese: "dairy", cream: "dairy", yogurt: "dairy", yoghurt: "dairy", ghee: "dairy",
  // gluten / wheat
  wheat: "gluten", "wheat flour": "gluten", semolina: "gluten", durum: "gluten",
  spelt: "gluten", farro: "gluten", kamut: "gluten", einkorn: "gluten", emmer: "gluten",
  triticale: "gluten", seitan: "gluten", gliadin: "gluten", barley: "gluten",
  rye: "gluten", malt: "gluten", bulgur: "gluten", freekeh: "gluten", celiac: "gluten",
  coeliac: "gluten", "gluten intolerance": "gluten", "wheat protein": "gluten",
  // egg
  albumen: "egg", albumin: "egg", ovalbumin: "egg", "egg white": "egg",
  "egg whites": "egg", "egg yolk": "egg", ovomucoid: "egg", lysozyme: "egg",
  // peanut (a legume — deliberately NOT the tree-nut category)
  peanut: "peanuts", groundnut: "peanuts", groundnuts: "peanuts", arachis: "peanuts",
  "arachis oil": "peanuts", "monkey nut": "peanuts", "goober pea": "peanuts",
  // tree nuts
  nut: "tree nuts", "tree nut": "tree nuts", treenut: "tree nuts", "treenuts": "tree nuts",
  almond: "tree nuts", walnut: "tree nuts", cashew: "tree nuts", pecan: "tree nuts",
  pistachio: "tree nuts", hazelnut: "tree nuts", macadamia: "tree nuts",
  // soy
  soya: "soy", soybean: "soy", soybeans: "soy", soja: "soy", tofu: "soy",
  edamame: "soy", tempeh: "soy", "soy lecithin": "soy",
  // fish
  finfish: "fish", anchovy: "fish", anchovies: "fish", salmon: "fish", tuna: "fish",
  cod: "fish", "fish sauce": "fish",
  // shellfish
  crustacean: "shellfish", crustaceans: "shellfish", prawn: "shellfish",
  prawns: "shellfish", shrimp: "shellfish", crab: "shellfish", lobster: "shellfish",
  mollusc: "shellfish", molluscs: "shellfish", mollusk: "shellfish", mollusks: "shellfish",
  scampi: "shellfish", langoustine: "shellfish",
  // sesame + the remaining declarables
  tahini: "sesame", benne: "sesame", gingelly: "sesame", "sesame seed": "sesame",
  "sesame seeds": "sesame",
  celeriac: "celery",
  dijon: "mustard",
  lupine: "lupin", lupini: "lupin",
  sulphite: "sulphites", sulfite: "sulphites", sulfites: "sulphites",
  "sulphur dioxide": "sulphites", "sulfur dioxide": "sulphites",
};

// The canonical allergen family behind each CATEGORY_SYNONYMS key. Needed so a
// structured allergen TAG ("en:milk") and a typed term ("lactose") can be
// compared: both resolve to the family "dairy".
const SYNONYM_KEY_FAMILY = {
  dairy: "dairy", gluten: "gluten", egg: "egg", eggs: "egg", fish: "fish",
  shellfish: "shellfish", soy: "soy", "soy protein": "soy", peanuts: "peanut",
  nuts: "tree-nut", "tree nuts": "tree-nut", sesame: "sesame", celery: "celery",
  mustard: "mustard", lupin: "lupin", sulphites: "sulphites", kiwi: "kiwi",
};

/**
 * Resolve one user-supplied exclusion term.
 * Returns { term, key, synonymKey, family, kind, recognised, note }.
 *   kind "category" — the term IS a known category key
 *   kind "alias"    — the term maps onto one (lactose → dairy)
 *   kind "literal"  — unrecognised; applied as a plain substring match, and
 *                     flagged so the UI can say so out loud. Fail-safe: an
 *                     unrecognised term still filters, it is never dropped.
 */
function resolveExclusionTerm(term) {
  const key = String(term ?? "").trim().toLowerCase();
  if (!key) return { term, key: "", synonymKey: null, family: null, kind: "empty", recognised: false, note: null };
  if (CATEGORY_SYNONYMS[key]) {
    return { term, key, synonymKey: key, family: SYNONYM_KEY_FAMILY[key] || null, kind: "category", recognised: true, note: null };
  }
  const alias = FREE_TEXT_ALIASES[key];
  if (alias) {
    return {
      term, key, synonymKey: alias, family: SYNONYM_KEY_FAMILY[alias] || null, kind: "alias", recognised: true,
      note: `matched as the "${alias}" allergen category`,
    };
  }
  return {
    term, key, synonymKey: null, family: null, kind: "literal", recognised: false,
    note: "not a recognised allergen — matching on text only",
  };
}

/**
 * UI surface for the above: describe every term on a profile so the screen can
 * distinguish "we understand this allergy" from "we are grepping your text".
 * Silent failure is banned (CLAUDE.md), and a literal-only match is a partial
 * failure the user is entitled to see.
 */
function describeExclusionTerms(terms) {
  return (terms || [])
    .map((t) => resolveExclusionTerm(t))
    .filter((r) => r.kind !== "empty")
    .map(({ term, key, synonymKey, family, kind, recognised, note }) => ({ term, key, synonymKey, family, kind, recognised, note }));
}

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
    // Compound-expanded for the same reason every other path is: "Cheeseburger"
    // is the canonical meat+dairy dish and neither word is word-bounded in it.
    const names = recipe.ingredients.map((i) => expandCompoundTokens(i.name));
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
  // ADD-ONLY: persisted metadata can raise a style exclusion the name never
  // could ("Cheeseburger, fast food" under USDA's Fast Foods category still
  // relies on the name, but "Milk, whole" filed under "Dairy and Egg Products"
  // does not). It is checked FIRST and can only return true — it never
  // short-circuits to false, so the name logic below always still runs.
  // Carnivore is excluded from this by design; see styleExcludedByMetadata().
  if (dietaryStyle !== "carnivore" && styleExcludedByMetadata(food, dietaryStyle)) return true;
  // Prepared-dish compound names ("Cheeseburger" → cheese + beef) — additive,
  // the raw name is preserved inside the expanded string.
  const n = expandCompoundTokens(food.name);
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
function matchesExclusionTerm(rawName, term) {
  // Defense-in-depth: a non-string term (e.g. a number that slipped past
  // validation) must never throw here — it would 500 every recipe screen.
  const resolved = resolveExclusionTerm(term);
  const key = resolved.key;
  if (!key) return false;
  // Prepared-dish names are matched against the compound-expanded text (the
  // raw name plus any tokens a curated compound implies). Purely additive —
  // see expandCompoundTokens().
  const name = expandCompoundTokens(rawName);
  const synonyms = resolved.synonymKey ? CATEGORY_SYNONYMS[resolved.synonymKey] : null;
  if (synonyms) {
    // An ALIAS also keeps its own literal text as an extra probe: "lactose"
    // means the dairy category UNION anything literally saying lactose. Union,
    // never replacement — an alias can only widen what the raw term matched.
    if (resolved.kind === "alias" && name.toLowerCase().includes(key)) return true;
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
      // chestnut is a tree nut, but WATER chestnut is an aquatic vegetable — a
      // nut allergy must not remove it. Same guard shape as the dairy words.
      // hasWordOrPlural, NOT hasWord: the singular-only match leaked all 18
      // "Nuts, chestnuts, japanese/chinese/european, …" rows plus bare
      // "Chestnuts" to a tree-nut allergy — measured against the real
      // 14,124-food table by scripts/qc/sweep14k.mjs on 2026-07-23, the same
      // plural-blindness class as the Phase 4 "Prawns" finding. The water-
      // chestnut guard still holds: hasPhrase("water chestnuts", "water
      // chestnut") is true, so the vegetable stays available.
      if (word === "chestnut") return hasWordOrPlural(name, "chestnut") && !hasPhrase(name, "water chestnut");
      return matchesTermList(name, word);
    });
  }
  // Not a known category - literal substring fallback. Covers free-text
  // entries like "kiwi" and specific multi-word phrases like "soy protein"
  // that should NOT expand to the whole soy category.
  return name.toLowerCase().includes(key);
}

// ═════════════════════════════════════════════════════════════════════════
// PERSISTED ALLERGEN METADATA — findings dietary-safety-2 and -4
// ═════════════════════════════════════════════════════════════════════════
// Food rows can now carry three signals the import paths always computed and
// then discarded (see backend/prisma/schema.prisma → model Food):
//
//   fdcCategory   USDA's own category string ("Dairy and Egg Products")
//   allergenTags  declared allergens, normalised Open Food Facts tag slugs
//   mayContain    trace / "may contain" statements, same shape
//
// ── THE ADD-ONLY RULE (the whole point of this section) ───────────────────
// Metadata may only ADD an exclusion. It may NEVER clear one that the
// name/keyword logic already raised. This is enforced STRUCTURALLY, not by
// discipline: every probe below can only PUSH a reason onto an array, the
// verdict is `reasons.length > 0`, and there is no code path anywhere in
// exclusionEvidence() that removes a reason or short-circuits a later probe on
// a negative result. A probe returning "no evidence" contributes nothing; it
// cannot veto another probe. If ANY source says "contains dairy", the food is
// dairy. tests/allergenMetadata.test.js asserts this against deliberately
// contradictory metadata (empty tag arrays, a "Vegetables" category on a
// cheeseburger) — an invariant that isn't tested will be violated within a
// month.

// Trace / "may contain" policy. DEFAULT: EXCLUDE.
// Rationale: `mayContain` only ever appears because a manufacturer chose to
// declare cross-contamination risk on a product they sell. For a DECLARED
// allergy that is a medical-severity signal, and the cost of honouring it is a
// slightly smaller pool while the cost of ignoring it is anaphylaxis. It is
// also the direction this codebase already chose everywhere else ("over-
// exclusion is the correct failure direction"). Callers who want the softer
// behaviour pass { traces: "flag" }: the evidence still comes back in
// `reasons` marked advisory, so the UI can show it, but it alone will not
// remove the food.
const TRACE_POLICY_DEFAULT = "exclude";

// Open Food Facts allergen/traces tag slug → canonical allergen family.
// OFF ships tags language-prefixed ("en:milk", "fr:lait"); normaliseAllergenTag
// strips the prefix, so only the slug is keyed here. Sub-species tags are
// mapped to their family so "en:hazelnuts" behaves like "en:nuts".
const OFF_TAG_FAMILY = {
  milk: "dairy", milks: "dairy", "milk-proteins": "dairy", lactose: "dairy",
  cream: "dairy", butter: "dairy", cheese: "dairy", whey: "dairy", casein: "dairy",
  gluten: "gluten", wheat: "gluten", barley: "gluten", rye: "gluten", oats: "gluten",
  spelt: "gluten", kamut: "gluten", "cereals-containing-gluten": "gluten",
  eggs: "egg", egg: "egg",
  peanuts: "peanut", peanut: "peanut",
  nuts: "tree-nut", "tree-nuts": "tree-nut", almonds: "tree-nut", hazelnuts: "tree-nut",
  walnuts: "tree-nut", "cashew-nuts": "tree-nut", cashews: "tree-nut",
  pistachios: "tree-nut", "pecan-nuts": "tree-nut", "macadamia-nuts": "tree-nut",
  "brazil-nuts": "tree-nut", "queensland-nuts": "tree-nut",
  soybeans: "soy", soy: "soy", soja: "soy",
  fish: "fish",
  crustaceans: "shellfish", molluscs: "shellfish", mollusks: "shellfish", shellfish: "shellfish",
  "sesame-seeds": "sesame", sesame: "sesame",
  celery: "celery",
  mustard: "mustard",
  lupin: "lupin",
  "sulphur-dioxide-and-sulphites": "sulphites", sulphites: "sulphites", sulfites: "sulphites",
};

// USDA FoodData Central category → the allergen families a food in it carries.
// Only categories that are UNAMBIGUOUS about a family appear. USDA combines
// pairs ("Dairy and Egg Products", "Finfish and Shellfish Products"), and a row
// in such a category is treated as carrying BOTH — a dairy-allergic user
// therefore also loses eggs filed under that category. That is over-exclusion,
// which is this codebase's documented safe direction, and it only ever applies
// as a BACKSTOP: the name almost always says which one it is, and the name is
// checked first and independently.
//
// Deliberately absent, because they are too heterogeneous to be evidence of any
// one allergen: "Nut and Seed Products" (sunflower/sesame/peanut/tree nut all
// share it), "Legumes and Legume Products", "Cereal Grains and Pasta" (rice,
// corn, quinoa live there), "Fast Foods", "Restaurant Foods", "Meals, Entrees,
// and Side Dishes", "Soups, Sauces, and Gravies", "Snacks", "Sweets".
const FDC_CATEGORY_FAMILIES = {
  "dairy and egg products": ["dairy", "egg"],
  "finfish and shellfish products": ["fish", "shellfish"],
  "baked products": ["gluten"],
};

// Flesh categories — excluded for BOTH vegan and vegetarian.
const FDC_FLESH_CATEGORIES = new Set([
  "beef products", "pork products", "poultry products",
  "lamb, veal, and game products", "sausages and luncheon meats",
  "finfish and shellfish products",
]);
// Animal but not flesh — excluded for vegan only (vegetarians eat these).
const FDC_ANIMAL_NONFLESH_CATEGORIES = new Set(["dairy and egg products"]);

/** "en:milk" / "  MILK " / "fr:lait" → "milk" / "lait". Never throws. */
function normaliseAllergenTag(tag) {
  const s = String(tag ?? "").trim().toLowerCase();
  if (!s) return "";
  const colon = s.indexOf(":");
  return (colon === -1 ? s : s.slice(colon + 1)).trim();
}

/**
 * Normalise a raw allergens_tags / traces_tags value into the array shape the
 * Food columns store. Accepts an array, a comma-separated string (OFF also
 * ships `allergens` as free text), null, or junk. Returns null for "no
 * declaration available" — honest absence, distinct from [] which means "the
 * source explicitly declared none".
 */
function normaliseAllergenTags(raw) {
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : null);
  if (!list) return null;
  const out = [];
  for (const t of list) {
    const slug = normaliseAllergenTag(t);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** The canonical families declared by a stored tag array. */
function allergenTagFamilies(tags) {
  const fams = new Set();
  for (const t of normaliseAllergenTags(tags) || []) {
    const fam = OFF_TAG_FAMILY[t];
    if (fam) fams.add(fam);
  }
  return fams;
}

/**
 * Every reason this food is excluded for this term, from every evidence
 * source. `excluded` is the UNION — reasons.length > 0.
 *
 * food: { name, fdcCategory?, allergenTags?, mayContain? } — a plain
 * ingredient { name } works too and simply yields name-only evidence.
 */
function exclusionEvidence(food, term, options = {}) {
  const tracePolicy = options.traces || TRACE_POLICY_DEFAULT;
  const resolved = resolveExclusionTerm(term);
  const reasons = [];
  if (!resolved.key) return { excluded: false, reasons, resolved };

  const name = food?.name ?? food;

  // ── probe 1: name / keyword evidence (incl. compound tokens + aliases) ──
  if (matchesExclusionTerm(name, resolved.key)) {
    reasons.push({ source: "name", detail: `name matches the "${resolved.synonymKey || resolved.key}" exclusion`, advisory: false });
  }

  // ── probe 2: authoritative USDA food category ──
  const fdcCategory = typeof food?.fdcCategory === "string" ? food.fdcCategory.trim().toLowerCase() : null;
  if (fdcCategory && resolved.family) {
    const fams = FDC_CATEGORY_FAMILIES[fdcCategory];
    if (fams && fams.includes(resolved.family)) {
      reasons.push({ source: "fdc-category", detail: `USDA files this under "${food.fdcCategory}"`, advisory: false });
    }
  }

  // ── probe 3: declared allergen tags ──
  if (resolved.family && allergenTagFamilies(food?.allergenTags).has(resolved.family)) {
    reasons.push({ source: "allergen-tag", detail: `the product declares ${resolved.family} in its allergen list`, advisory: false });
  }

  // ── probe 4: trace / "may contain" statements ──
  if (resolved.family && allergenTagFamilies(food?.mayContain).has(resolved.family)) {
    reasons.push({
      source: "may-contain",
      detail: `the product declares it may contain traces of ${resolved.family}`,
      advisory: tracePolicy !== "exclude",
    });
  }

  // The union. An advisory-only reason (traces under { traces: "flag" }) is
  // surfaced but does not on its own remove the food.
  return { excluded: reasons.some((r) => !r.advisory), reasons, resolved };
}

/**
 * Boolean form of exclusionEvidence() — the object-aware sibling of
 * matchesExclusionTerm(). Guaranteed to be at least as exclusive as the
 * name-only matcher: probe 1 IS the name-only matcher, and no later probe can
 * unset it.
 */
function foodMatchesExclusionTerm(food, term, options) {
  return exclusionEvidence(food, term, options).excluded;
}

// ── style-level metadata evidence ────────────────────────────────────────
// Same add-only rule for the dietary STYLES, with one deliberate exception:
// carnivore is the inverted style (it excludes everything that ISN'T animal),
// so "this row is animal" evidence would have to CLEAR an exclusion rather than
// add one. Rather than introduce a probe with the opposite polarity into an
// add-only union, carnivore simply does not consult metadata at all and keeps
// its existing name-based behaviour.
function styleExcludedByMetadata(food, dietaryStyle) {
  const cat = typeof food?.fdcCategory === "string" ? food.fdcCategory.trim().toLowerCase() : null;
  if (cat) {
    if (FDC_FLESH_CATEGORIES.has(cat) && (dietaryStyle === "vegan" || dietaryStyle === "vegetarian")) return true;
    if (FDC_ANIMAL_NONFLESH_CATEGORIES.has(cat) && dietaryStyle === "vegan") return true;
  }
  if (dietaryStyle === "vegan") {
    const fams = allergenTagFamilies(food?.allergenTags);
    if (fams.has("dairy") || fams.has("egg") || fams.has("fish") || fams.has("shellfish")) return true;
  }
  if (dietaryStyle === "vegetarian") {
    const fams = allergenTagFamilies(food?.allergenTags);
    if (fams.has("fish") || fams.has("shellfish")) return true;
  }
  return false;
}

// Object-aware: unions the name/keyword verdict with the persisted
// fdcCategory / allergenTags / mayContain evidence (see exclusionEvidence).
// A plain { name } still works and simply yields name-only evidence.
function excludedByList(food, excludedFoods, options) {
  if (!excludedFoods || !excludedFoods.length) return false;
  return excludedFoods.some((term) => foodMatchesExclusionTerm(food, term, options));
}

// Whole-recipe keto carb ceiling (grams of carb in the cached recipe total),
// distinct from DEFAULT_KETO_CARB_THRESHOLD's per-100g ingredient rule.
// Single-sourced here so the solver pool (plans.js) and the library listing
// (recipes.js) can never diverge on what "keto" hides (Stage-C fix M8).
const KETO_RECIPE_CARB_CEILING_G = 30;
// Keto excludes a recipe on the SHARE of its calories that come from carbs, not
// an absolute base-gram count — because the solver scales portions up to 2x, and
// a base-gram ceiling let a 25 g recipe through that shipped 50 g at 2x scale (a
// QC customer found quinoa/naan/rice dishes on a "keto" plate this way). A carb
// energy FRACTION is scale-invariant: a dish that is 25% carbs by calories is 25%
// at any portion size. ≤15% keeps genuinely low-carb dishes while dropping the
// grain/starch-based ones. (2026-07-23.)
// 0.10 = the textbook keto line; measured against this library it lands the daily
// plan at ~28 g carb/day (under the strict 30 g ceiling) with 36 meal recipes
// eligible. Tighter (0.08 -> 25 recipes) starts emptying the pool.
const KETO_CARB_ENERGY_FRACTION = 0.10;

// True if this recipe is hidden for a keto profile.
function recipeExceedsKetoCeiling(recipe, dietaryStyle) {
  if (dietaryStyle !== "keto" || typeof recipe.carb !== "number") return false;
  // Prefer the scale-invariant fraction; fall back to the gram ceiling only if
  // kcal is missing/zero (can't form a ratio).
  if (typeof recipe.kcal === "number" && recipe.kcal > 0) {
    return (recipe.carb * 4) / recipe.kcal > KETO_CARB_ENERGY_FRACTION;
  }
  return recipe.carb > KETO_RECIPE_CARB_CEILING_G;
}

// Some imported recipes declare extra ingredients in their STEP TEXT that never
// became structured ingredient rows — the importer's "Add'l ingredients: mayonnaise,
// siracha" pattern (QC customer #7: mayo/egg reached an egg-allergic user because
// the filter only reads ingredient rows). Pull those declared names so the allergen
// and diet-style checks can see them too. Defence-in-depth; the underlying data
// still wants fixing (see docs/qc/recipe-allergen-audit.md).
function additionalIngredientNames(steps) {
  // Match WITHIN a single step element — joining steps first let the capture run
  // past the declaration into the next step ("siracha  Cook the rice").
  const arr = Array.isArray(steps) ? steps : (typeof steps === "string" ? [steps] : []);
  for (const step of arr) {
    const m = String(step).match(/add'?l ingredients?:\s*(.+)/i);
    if (m) return m[1].split(/,|;|\band\b/i).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40);
  }
  return [];
}

// profile: {dietaryStyle: "none"|"vegan"|"vegetarian"|"keto", excludedFoods: string[]}
function applyDietaryFilters(pool, profile, options) {
  const dietaryStyle = profile?.dietaryStyle || "none";
  const excludedFoods = profile?.excludedFoods || [];
  if (dietaryStyle === "none" && excludedFoods.length === 0) return pool;
  return pool.filter((food) => !excludedByStyle(food, dietaryStyle) && !excludedByList(food, excludedFoods, options));
}

// Per-term exclusion counts against a flat food pool, so the UI can render
// "N excluded for: gluten" - silent failure is banned.
// Counts the SAME way applyDietaryFilters() filters (metadata included), so
// the number the UI shows can never diverge from the number of foods actually
// removed.
function traceExclusions(pool, excludedFoods, options) {
  const counts = {};
  (excludedFoods || []).forEach((term) => {
    const key = String(term ?? "").trim().toLowerCase();
    if (!key) return;
    counts[key] = (pool || []).filter((food) => foodMatchesExclusionTerm(food, key, options)).length;
  });
  return counts;
}

// Recipe-level equivalent of traceExclusions() - a recipe's top-level .name
// is its dish title ("Algerian Kefta"), not an ingredient, so matching a term
// against it would silently undercount. Checks every ingredient name instead.
// recipes: [{ingredients:[{name}]}]
function traceRecipeExclusions(recipes, excludedFoods, options) {
  const counts = {};
  (excludedFoods || []).forEach((term) => {
    const key = String(term ?? "").trim().toLowerCase();
    if (!key) return;
    counts[key] = (recipes || []).filter((recipe) =>
      // An ingredient row carrying its joined Food (ing.food) contributes that
      // row's persisted metadata too; a bare { name } falls back to name-only.
      (recipe.ingredients || []).some((ing) => foodMatchesExclusionTerm(ing.food ? { ...ing.food, name: ing.name } : ing, key, options))
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
  additionalIngredientNames,
  // ── allergen metadata + compound tokens + free-text aliases (2026-07-23) ──
  foodMatchesExclusionTerm,
  exclusionEvidence,
  styleExcludedByMetadata,
  resolveExclusionTerm,
  describeExclusionTerms,
  expandCompoundTokens,
  normaliseAllergenTag,
  normaliseAllergenTags,
  allergenTagFamilies,
  COMPOUND_TOKENS,
  COMPOUND_FALSE_FRIENDS,
  FREE_TEXT_ALIASES,
  OFF_TAG_FAMILY,
  FDC_CATEGORY_FAMILIES,
  FDC_FLESH_CATEGORIES,
  FDC_ANIMAL_NONFLESH_CATEGORIES,
  SYNONYM_KEY_FAMILY,
  CATEGORY_SYNONYMS,
  TRACE_POLICY_DEFAULT,
};
