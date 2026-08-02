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
// NOTE: "cheese"/"yogurt"/"yoghurt" are deliberately NOT here — they need the
// same plant-qualifier guard butter/cream/milk already had, or a vegan pool
// loses "Soy yogurt" and "Vegan cheese", which are vegan foods. See
// isDairyCheese()/isDairyYogurt(), called from isVeganAnimalProduct().
// ── The lacto-ovo split ──────────────────────────────────────────────────
// WHY THIS IS TWO LISTS AND NOT ONE. A vegan eats neither dairy/egg nor
// slaughter/marine products; a lacto-ovo vegetarian eats the first and not the
// second. Before 2026-07-29 that was expressed by giving vegetarian its own,
// SHORTER list — `MEAT_FISH_KEYWORDS` alone — which made vegetarian a strict
// subset of vegan by construction and left every vegan-only term invisible to it.
//
// Measured cost of that shape, on this corpus: three curry pastes IN LIVE USE as
// recipe ingredients ("Thai Red Curry Paste", "Red Curry Paste", "Thai Green
// Curry Paste") reached vegetarian plans and grocery lists — while THIS SAME FILE
// excluded them for vegan, for a fish allergy, and for a shellfish allergy, and
// `CATEGORY_SYNONYMS.fish` carries a comment explaining they standardly contain
// fish sauce and shrimp paste. 15 foods in total violated
// `vegetarian ⊇ (fish ∪ shellfish)`. Marshmallows reached vegetarian grocery
// lists the same way.
//
// So: one definition, split by what each style actually permits. Adding a term
// now requires deciding which side it belongs on, which is the whole point.
// The invariant in tests/dietaryStyleLattice.test.js asserts the containment
// mechanically, so this cannot silently drift again.

// Dairy and egg. Permitted for lacto-ovo vegetarians, excluded for vegans.
const LACTO_OVO_KEYWORDS = [
  "egg", "eggs", "whey", "casein", "ghee",
  "honey", "mayonnaise", "skyr", "kefir", "custard", "quark", "milk powder",
  // Cheese VARIETY names — none contain the word "cheese", all are dairy
  // (caught by the 854-name food-table audit, Phase 4).
  "mozzarella", "cheddar", "parmesan", "feta", "ricotta", "brie", "gouda",
  "halloumi", "mascarpone", "paneer", "stilton", "gorgonzola", "camembert",
  "gruyere", "gruyère", "edam", "emmental", "manchego", "pecorino",
  "provolone", "burrata", "queso", "creme fraiche", "crème fraîche", "curd",
  // Milk-based sweets, egg-based sauces/doughs, yogurt/ghee breads — all
  // lacto-ovo. Caught by the 854-name audit.
  "dulce de leche", "meringue", "white chocolate", "milk chocolate", "mars bar",
  "aioli", "aïoli", "perogi", "pierogi", "toffee", "caramel sauce", "naan",
  "wonton",
  // `nougat` belongs HERE, not with the gelatin confections. Traditional and
  // commercial nougat is whipped EGG WHITE, and this repo's own taxonomy already
  // says so: allergenTaxonomy.js:133 lists "nougat" in the `eggs` entry's
  // nameKeywords (and again under tree nuts at :197). It was briefly placed in
  // SLAUGHTER_OR_MARINE_KEYWORDS below, which wrongly hid 7 real corpus rows
  // (TOBLERONE, REESE'S FAST BREAK, "Candies, nougat, with almonds", …) from
  // vegetarians and — because carnivore is `!isVeganAnimalProduct` — wrongly
  // admitted those same 5 candy rows to a CARNIVORE pool. Vegan is unaffected
  // either way, because vegan takes the union of both lists.
  "nougat",
];

// Slaughter- or marine-derived. Excluded for BOTH vegan and vegetarian.
// `gelatin`, `gelatine`, `lard`, `tallow`, `suet`, `worcestershire`, `dashi` and
// `bonito` already live in MEAT_FISH_KEYWORDS, which vegetarian has always
// consulted — these are the ones that did not, plus the gelatin confections and
// clarifying agents whose names never say "gelatin". Over-exclusion is the
// correct failure direction here, the same reasoning gluten's stock cubes use.
// Corpus reach over the live 14,148-name food table is recorded per term, because
// a keyword that matches nothing is a claim without evidence — the same standard
// mergeAllergenTaxonomy() applies to itself further down this file.
const SLAUGHTER_OR_MARINE_KEYWORDS = [
  "curry paste",        // Thai red/green: fish sauce and/or shrimp paste — 3 rows, all in live use
  "christmas pudding",  // suet — 1 row, live
  "marshmallow",        // gelatin — 24 rows incl. "Miniature Marshmallows", live
  "gummy",              // gelatin — 1 row
  // `nougat` was here and is NOT: it is egg-based. See LACTO_OVO_KEYWORDS above.
  // The three below currently match ZERO corpus rows. They are kept deliberately
  // as forward guards for imported/AI-generated names, not because they earn a
  // place on measured reach — stated plainly so nobody later mistakes them for
  // evidence-backed entries.
  "jell-o", "aspic", "isinglass", // gelatin dessert; meat jelly; fish-bladder fining agent
];

// Vegan's set is the union, so vegan behaviour is unchanged by the split itself.
const ANIMAL_DERIVED_EXTRA_KEYWORDS = [
  ...LACTO_OVO_KEYWORDS,
  ...SLAUGHTER_OR_MARINE_KEYWORDS,
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

// The maintainable allergen DATA TABLE (labels, synonyms, species depth, the
// rare allergens the owner asked for) plus the term-normalisation helpers. It
// is merged into the four maps below by mergeAllergenTaxonomy() ADD-ONLY —
// see that function. allergenTaxonomy.js has zero dependencies and must never
// require this file back.
const {
  ALLERGEN_TAXONOMY,
  CROSS_REACTANTS,
  allergenCatalog,
  searchAllergens,
  categoryKeyOf,
  exclusionTermCandidates,
  normaliseExclusionText,
} = require("./allergenTaxonomy.js");

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
  // "tahina"/"tehina" are the standard Arabic/Egyptian transliterations of tahini
  // and are how the imported corpus actually spells it in serving instructions.
  // Measured 2026-07-29: `matchesExclusionTerm("Tahini","sesame")` was true and
  // `("Tahina","sesame")` was FALSE, so "Ful Medames" and "Tamiya" — which name
  // "tahina sauce" in their own steps — reached a sesame-allergic user's pool.
  // The gate reads full step prose by design; it read this and did not know the word.
  sesame: ["sesame", "tahini", "tahina", "tehina", "halva", "benne", "gomashio", "hummus", "houmous"],
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
  // ── REAL corpus spellings (audit agent 09 §3.6, 2026-07-24) ──────────────
  // The eleven entries above were written from memory: only "Graham crackers"
  // and "Eggplant, raw" are actual rows in the 14,122-name table. An executable
  // record asserted against strings the app will never see is how the REAL
  // "Egg Plants" spelling slipped through and hid six aubergine recipes from an
  // egg-allergic user. Every entry below is a verbatim row name from that table.
  { name: "Egg Plants", mustNotMatch: ["egg", "eggs"], mustNotStyle: ["vegan", "vegetarian"], why: "the corpus spells aubergine as two words; it is still a vegetable" },
  { name: "Ground Nutmeg", mustNotMatch: ["peanuts", "tree nuts", "nuts"], mustNotStyle: [], why: "'ground nut' must not fire inside 'Ground Nutmeg' — nutmeg is a seed spice" },
  { name: "LITTLE CAESARS 14\" Original Round Cheese Pizza, Regular Crust", mustNotMatch: ["fish", "eggs"], mustNotStyle: [], why: "a pizza brand is not Caesar dressing" },
  { name: "Caesar salad, with romaine, no dressing", mustNotMatch: ["fish"], mustNotStyle: [], why: "the name states the anchovy carrier is absent" },
  { name: "SILK Original Creamer", mustNotMatch: ["dairy"], mustNotStyle: ["vegan"], why: "a plant-milk brand's creamer is not dairy" },
  { name: "Beverages, coffee, instant, vanilla, sweetened, decaffeinated, with non dairy creamer", mustNotMatch: ["dairy"], mustNotStyle: ["vegan"], why: "the name literally says non dairy" },
  { name: "Seeds, sunflower seed butter, without salt", mustNotMatch: ["dairy"], mustNotStyle: ["vegan"], why: "a seed butter is not butter" },
  { name: "Sweet potato, cooked, baked in skin", mustNotMatch: ["nightshades"], mustNotStyle: [], why: "sweet potato is Convolvulaceae, not a nightshade" },
];

// ── COMPOUND VETOES — audit agent 09 §3, over-exclusion the splitter caused ──
// A compound word normally IMPLIES its tokens. These are the measured cases
// where the surrounding name says, in plain English, that it does not. A veto
// suppresses ONE compound's expansion for ONE name; every other list, keyword
// and probe still runs on the untouched raw name, so this can never clear an
// exclusion something else raised.
//
// Measured against the real 14,122-row table on 2026-07-24:
//   caesar  → "LITTLE CAESARS 14\" ... Pizza" (6 rows) excluded for FISH + EGGS
//             on an anchovy/raw-egg inference about a pizza brand, and three
//             "...caesar ... NO DRESSING" rows excluded although the name states
//             the anchovy carrier is absent.
//   creamer → the plant creamers. "Beverages, coffee, instant, ... with NON
//             DAIRY creamer" and the SILK range (a plant-milk brand) were called
//             dairy — and were also lost to VEGAN, which is the worst possible
//             direction for a vegan product.
// NOT vetoed, deliberately: a generic "Coffee creamer, liquid/powder" with no
// plant or dairy-free declaration. Those are overwhelmingly sodium CASEINATE,
// which is a milk protein — the word "non-dairy" on a label is a marketing term,
// not an allergy statement, so the exclusion there is medically correct.
const COMPOUND_VETOES = {
  caesar: [/\blittle\s+caesar/i, /\bno\s+dressing\b/i],
  creamer: [
    /\bnon[\s-]?dairy\b/i, /\bdairy[\s-]?free\b/i,
    /\bsilk\b/i, // plant-milk brand; its whole creamer range is soy/almond based
    /\b(?:soy|soya|almond|oat|coconut|cashew|rice|hemp|pea|flax)\b/i,
  ],
};

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
    const compound = m[1].toLowerCase();
    const vetoes = COMPOUND_VETOES[compound];
    if (vetoes && vetoes.some((re) => re.test(s))) continue;
    for (const token of COMPOUND_TOKENS[compound]) (extra ||= new Set()).add(token);
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
  if (!key) return { term, key: "", normalisedKey: "", synonymKey: null, family: null, kind: "empty", recognised: false, note: null };
  // ── 1. EXACT, unchanged. Anything that resolved before this fix resolves
  //       identically, so normalisation can only ever ADD a match. ───────────
  if (CATEGORY_SYNONYMS[key]) {
    return { term, key, normalisedKey: key, synonymKey: key, family: SYNONYM_KEY_FAMILY[key] || null, kind: "category", recognised: true, note: null };
  }
  const alias = FREE_TEXT_ALIASES[key];
  if (alias) {
    return {
      term, key, normalisedKey: key, synonymKey: alias, family: SYNONYM_KEY_FAMILY[alias] || null, kind: "alias", recognised: true,
      note: `matched as the "${alias}" allergen category`,
    };
  }
  // ── 2. NORMALISED. Punctuation, possessives, plurals and intent affixes —
  //       see allergenTaxonomy.js for the measured failures this closes
  //       ("cow's milk", "gluten free", "dairy!", "milk allergy", "dairies",
  //       "lactose-intolerant", "no dairy" — every one of them excluded 0 of
  //       889 recipes before). ────────────────────────────────────────────────
  const candidates = exclusionTermCandidates(key);
  for (const cand of candidates) {
    if (!cand || cand === key) continue;
    const target = CATEGORY_SYNONYMS[cand] ? cand : (FREE_TEXT_ALIASES[cand] || null);
    if (!target) continue;
    return {
      term, key, normalisedKey: cand, synonymKey: target, family: SYNONYM_KEY_FAMILY[target] || null,
      kind: "alias", recognised: true,
      note: `matched as the "${target}" allergen category`,
    };
  }
  // ── 3. Unrecognised. Still filters — fail-safe, never dropped — and still
  //       says so out loud. The normalised form is carried so the literal probe
  //       can use it too ("no mushrooms" should find mushrooms). ─────────────
  // The most-normalised candidate (last in the list) is the one worth grepping
  // for: "no mushrooms" should find "mushroom", not "no mushrooms".
  const normalised = [...candidates].reverse().find((c) => c && c !== key && c.length > 1) || key;
  return {
    term, key, normalisedKey: normalised, synonymKey: null, family: null, kind: "literal", recognised: false,
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
    // `normalisedKey` is what we UNDERSTOOD the term as ("cow's milk" → "cows
    // milk"). The screen should show it whenever it differs from what the user
    // typed — silent reinterpretation is as dishonest as a silent miss.
    .map(({ term, key, normalisedKey, synonymKey, family, kind, recognised, note }) =>
      ({ term, key, normalisedKey, synonymKey, family, kind, recognised, note }));
}

// Default keto threshold is on carb-per-100g of the raw ingredient, not a
// typical realistic serving size - a disclosed simplification.
const DEFAULT_KETO_CARB_THRESHOLD = 15;

// ─────────────────────────────────────────────────────────────────────────
// COMPILED-PATTERN CACHE — the hottest thing in this file
// ─────────────────────────────────────────────────────────────────────────
// hasWord() and hasWordOrPlural() used to call `new RegExp(...)` on EVERY
// invocation, and they are the innermost call in the exclusion gate. Profiled
// over one `partitionRecipes(889)`:
//
//   profile                     new RegExp()   distinct patterns   redundancy
//   one excluded food ["wheat"]      741,280                 136       5,451x
//   dietaryStyle "vegan"           1,025,255                 293       3,499x
//   sixteen excluded foods        5,308,982                 153      34,699x
//
// The single hottest pattern, /\btortilla(?:es|s)?\b/i, was compiled 11,144
// times in one request. 70.1% of CPU self time was in hasWordOrPlural and a
// further 8.1% in escapeRe. `GET /api/recipes` went 1.8 ms (no rules) ->
// 390 ms (one allergy) -> 2,914 ms (sixteen). COMPOUND_RE two hundred lines
// above is already hoisted with the note "Built once - this runs over 14,144
// names in the sweep"; the same reasoning simply never reached here.
//
// Cache on the WORD, not the name. That is the whole trick: names are
// effectively unbounded (14,148 foods x expansions) while the vocabulary is a
// few hundred terms, so a word-keyed cache converges after the first pass and
// every later call is a Map hit. Measured 3-5x end to end with verdicts
// byte-identical on every one of 14,148 foods and 889 recipes.
//
// SAFE TO REUSE A COMPILED REGEX: these patterns carry only the `i` flag.
// `lastIndex` is stateful for .test()/.exec() only under `g` or `y`, so a
// shared non-global regex cannot leak position between calls. (COMPOUND_RE
// above IS `gi`, which is exactly why it has to reset `lastIndex = 0` before
// every use. Do not add `g` here without revisiting that.)
//
// BOUNDED, because `word` is NOT always ours: `matchesExclusionTerm` passes
// user-supplied `excludedFoods` entries straight in, and profile.js:134 allows
// up to 40 free-text terms of 60 chars each per user. An unbounded Map keyed on
// that is a memory-growth vector across users. Same clear-on-full policy as
// compoundCache, for the same reason.
const wordReCache = new Map();
const WORD_RE_CACHE_MAX = 20000;

function wordRe(word, plural) {
  // " " cannot appear in a food name or a keyword, so it is a collision-proof
  // separator between the flag and the term: without it, hasWord("...","xs") and
  // hasWordOrPlural("...","x") could share a key and return each other's pattern.
  const key = (plural ? "p " : "w ") + word;
  let re = wordReCache.get(key);
  if (re === undefined) {
    re = new RegExp("\\b" + escapeRe(word) + (plural ? "(?:es|s)?" : "") + "\\b", "i");
    if (wordReCache.size >= WORD_RE_CACHE_MAX) wordReCache.clear();
    wordReCache.set(key, re);
  }
  return re;
}

function hasWord(name, word) {
  return wordRe(word, false).test(name);
}

// Same word-boundary match as hasWord(), but tolerant of a trailing "s" or
// "es" plural - CATEGORY_SYNONYMS lists singular keywords ("almond",
// "cracker") but real ingredient names are very often plural ("Almonds").
function hasWordOrPlural(name, word) {
  return wordRe(word, true).test(name);
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

// FDC INVERTS the qualifier into a comma field: the corpus writes plant yogurt
// as "Yogurt, almond milk" / "Yogurt, soy", never "almond yogurt". plantQualified
// above only sees the adjacent QUALIFIER-FIRST order, so all three plant-yogurt
// rows were excluded for a DAIRY allergy — the same two-word-order problem
// isButterBean() already solves for "Beans, butter". Adjacency is still what
// makes it safe: the qualifier has to be the noun's own comma field (up to two
// intervening fields, which is how FDC writes "Yogurt, Greek, plain, soy"), not
// merely present somewhere in the name.
function plantQualifiedEitherOrder(n, noun) {
  if (plantQualified(n, noun)) return true;
  const q = PLANT_MILK_QUALIFIERS.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b${noun}(?:es|s)?\\b\\s*,\\s*(?:[a-z0-9 '()/&-]+,\\s*){0,2}(?:${q})\\b`, "i").test(String(n || ""));
}

// A name that DECLARES itself plant-based. "Vegan cheese" and "Soy yogurt" are
// the foods a dairy-allergic user is supposed to be able to eat; blocking them
// is the same class of error as blocking gluten-free bread from a celiac.
// "non-dairy"/"dairy-free" are here for cheese/yogurt only — they deliberately
// do NOT clear the undeclared coffee creamers or the caseinate whipped
// toppings, which are handled by their own keywords (see COMPOUND_VETOES' note
// on why "non-dairy" is a marketing term, not an allergy statement: a product
// that calls itself non-dairy CHEESE is a plant cheese, whereas a "non-dairy
// creamer" is overwhelmingly sodium caseinate).
const PLANT_FOOD_DECLARED = /\b(?:vegan|plant[\s-]?based|dairy[\s-]?free|non[\s-]?dairy|meat[\s-]?free)\b/i;

// Dairy yogurt/cheese with the same plant guard milk/cream/butter already had.
// Measured 2026-07-24: "Yogurt, soy", "Yogurt, almond milk", "Yogurt, coconut
// milk" and all ten "SILK … soy yogurt" rows were removed from a dairy-allergic
// pool AND from every vegan pool.
function isDairyYogurt(n) {
  return hasWordOrPlural(n, "yogurt") || hasWordOrPlural(n, "yoghurt")
    ? !plantQualifiedEitherOrder(n, "yogurt") && !plantQualifiedEitherOrder(n, "yoghurt")
      && !PLANT_FOOD_DECLARED.test(String(n || ""))
    : false;
}
function isDairyCheese(n) {
  if (!hasWordOrPlural(n, "cheese")) return false;
  // "Soybean, curd cheese" / "Soybean curd cheese" is tofu.
  if (/\b(?:soy|soya|soybean)\b[a-z, ]*\bcurd\b/i.test(String(n || ""))) return false;
  return !plantQualifiedEitherOrder(n, "cheese") && !PLANT_FOOD_DECLARED.test(String(n || ""));
}

function isDairyMilk(n) {
  const s = String(n || "");
  // FNDDS uses "non-dairy milk" to describe a PREPARATION, not to make a label
  // claim: "Coffee, Latte, with non-dairy milk", "Oatmeal … made with non-dairy
  // milk", and "Non-dairy milk, NFS" IS the plant-milk row — 33 rows, all
  // removed from a dairy-allergic pool by the bare word "milk". This is NOT the
  // "non-dairy creamer" case COMPOUND_VETOES warns about; those are sodium
  // caseinate and stay excluded, because "creamer" and "whipped topping" are
  // matched by their own keywords, not by this one.
  if (/\bnon[\s-]?dairy\s+milk\b/i.test(s)) return false;
  return hasWordOrPlural(s, "milk") && !plantQualified(s, "milk");
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
    // Audit agent 09 §3.5: "Seeds, sunflower seed butter, with/without salt" —
    // two real rows — were excluded for DAIRY (and for vegan). A seed butter is
    // a ground seed; the existing exemptions covered peanut/nut/cocoa/shea/apple
    // butter but not the seed forms.
    && !hasPhrase(n, "seed butter") && !hasPhrase(n, "sunflower butter")
    && !hasPhrase(n, "sesame butter") && !hasPhrase(n, "tahini")
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

// "Egg Plants" is how the RecipeIngredient corpus spells aubergine — two words,
// so the word-bounded "egg" match fires on a vegetable. Measured 2026-07-24
// (audit agent 09 §3.4): six real recipes (Baba Ghanoush, Eggplant Adobo,
// Sichuan Eggplant, …) were hidden from an egg-allergic user, and the same shape
// removed the row from vegan/vegetarian pools. Strip only this exact phrase —
// every other word in the name is still matched, so "Eggs and eggplant" is
// still egg.
function stripEggPlant(n) {
  return String(n || "").replace(/\begg\s*plants?\b/gi, " ");
}

// Slaughter- or marine-derived: what BOTH vegan and vegetarian must exclude.
//
// The last two clauses are the important ones, and they are deliberately not a
// third keyword list. `MEAT_FISH_KEYWORDS` is the STYLE vocabulary and
// `CATEGORY_SYNONYMS.fish`/`.shellfish` is the ALLERGEN vocabulary, and the two
// drifted: measured 2026-07-29, twelve foods were excluded for a fish or shellfish
// allergy and admitted to a vegetarian pool — `Shellfish, NFS`, `Soup,
// bouillabaisse`, `Paella, NFS`, `Soup, bisque`, four `Shellfish mixture …` rows,
// `Cabbage, kimchi` and `Kimchi` (fish sauce / shrimp paste) and `Olive tapenade`
// (anchovies). Every one was a real leak, not a false positive of the check.
//
// Consulting the allergen vocabulary directly makes
// `vegetarian ⊇ (fish ∪ shellfish)` and `vegan ⊇ vegetarian` true BY
// CONSTRUCTION, so neither can drift again by someone adding a word to one list
// and not the other. It uses `matchesExclusionTerm`, the GUARDED matcher, so the
// WORD_GUARDS and free-from vetoes that stop "water chestnut" and "tomato bisque"
// still apply. (Hoisting: `matchesExclusionTerm` is a function declaration later
// in this file, so calling it here is resolved at call time, not load time.)
// A DISH-NAME keyword (paella, bisque, kimchi, pho, tapenade) names a dish that
// standardly carries a marine ingredient — which is why the allergen taxonomy carries
// them, and correctly so, since a bare "Paella, NFS" really is usually mixta. But the
// same word appears on rows that state their own plant identity, and there the keyword
// is a FALSE POSITIVE in the gate's own terms.
//
// This was found by widening `vegetarian` to consult the allergen vocabulary (so that
// `vegetarian ⊇ (fish ∪ shellfish)` holds by construction). That change did not create
// the over-exclusion — it made an EXISTING one visible in a second place. Measured
// before this guard existed:
//
//     matchesExclusionTerm("Roast fennel and aubergine paella", "shellfish") = true
//     matchesExclusionTerm("Vegan kimchi", "fish")                           = true
//     matchesExclusionTerm("Vegetarian pho", "fish")                         = true
//     matchesExclusionTerm("Vegan tapenade", "fish")                         = true
//
// A shellfish-allergic user was losing a fennel-and-aubergine paella whose ingredient
// rows contain no shellfish at all. `bisque` already carried this exemption and was
// consequently correct; the other four simply never got one. Fixing it HERE rather than
// in the style path is deliberate: it repairs both the allergy gate and the style filter
// from one place, and it keeps the ⊇ invariant true instead of carving out an exception
// that would break it.
//
// Deliberately NOT a general "does this name contain a vegetable" test — that would
// exempt "Paella with shrimp and peas". It requires either an explicit plant-identity
// declaration (vegan / vegetarian / plant-based / meat-free) or a vegetable in the
// HEAD-NOUN position of the dish, which is the shape `bisque` was already using.
const PLANT_DECLARED_DISH =
  /\b(?:vegan|vegetarian|veggie|plant[-\s]?based|meat[-\s]?free|fish[-\s]?free)\b/i;
// A vegetable may only appear here if it signals a SUBSTITUTION for the marine
// ingredient — never if it is one of the dish's own ordinary components. Two that were
// tried and removed, both caught by the control list in dietaryStyleLattice.test.js:
//   `cabbage` — cabbage is KIMCHI'S OWN BASE. Traditional "Cabbage, kimchi" carries
//               jeotgal (salted shrimp), so exempting it wrongly admitted a real
//               shellfish carrier to a vegetarian and a shellfish-allergic pool.
//   `pea`     — peas are an ordinary paella co-ingredient sitting beside the shrimp,
//               not a replacement for it.
const DISH_VEGETABLE_QUALIFIER =
  /\b(?:tomato|tomatoe|squash|pumpkin|butternut|corn|mushroom|carrot|sweet\s+potato|potato|vegetable|asparagus|pepper|bean|lentil|cauliflower|broccoli|chestnut|fennel|aubergine|eggplant|artichoke|courgette|zucchini|leek|spinach)\b/i;
function plantDeclaredDish(name) {
  const s = String(name || "");
  return PLANT_DECLARED_DISH.test(s) || DISH_VEGETABLE_QUALIFIER.test(s);
}

function isSlaughterOrMarine(n) {
  return matchesAny(stripPlantFlesh(n), MEAT_FISH_KEYWORDS)
    || matchesAny(stripEggPlant(n), SLAUGHTER_OR_MARINE_KEYWORDS)
    || matchesExclusionTerm(n, "fish")
    || matchesExclusionTerm(n, "shellfish");
}

function isVeganAnimalProduct(n) {
  return isSlaughterOrMarine(n)
    || matchesAny(stripEggPlant(n), LACTO_OVO_KEYWORDS)
    || isDairyMilk(n)
    || isDairyButterOrCream(n)
    || isDairyCheese(n)
    || isDairyYogurt(n);
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
    // Lacto-ovo: exactly what vegan excludes, minus dairy and egg. ONE shared
    // predicate, so vegetarian can no longer be a silently shorter list than
    // vegan — see the comment on isSlaughterOrMarine().
    return isSlaughterOrMarine(n);
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

// ─────────────────────────────────────────────────────────────────────────
// WORD GUARDS — keywords that need more than a word-boundary match
// ─────────────────────────────────────────────────────────────────────────
// A synonym listed here is matched by its guard instead of the default
// word/plural/phrase rule. Every one exists because a real row in the
// 14,122-name table is a FALSE FRIEND of the keyword: the word is present and
// the allergen is not. Keeping them in one table (rather than an if-chain
// inside the matcher) is what lets the taxonomy add keywords like "ground nut"
// and "potato" without re-opening the matcher.

// ── gluten-free grain guard (the mirror of plantQualified, for grains) ────
// "flour", "cereal" and "tortilla" are gluten keywords because the DEFAULT of
// each is wheat. But FDC files the corn/rice/quinoa forms under the same nouns,
// and blocking those deletes the staples a celiac actually lives on: 11 corn
// grits rows, 7 corn tortilla rows and 5 gluten-free flours ("Flour, quinoa",
// "Flour, amaranth", "Flour, sorghum") were all removed from a celiac pool.
//
// ADJACENCY IS WHAT MAKES THIS SAFE. The grain must qualify the noun ("corn
// tortilla", "rice flour") or be the noun's own FDC comma field ("Tortillas,
// ready-to-bake or -fry, corn"). A grain merely PRESENT somewhere in the name
// does not count — "Corned beef and potatoes in tortilla (Apache)" is a wheat
// tortilla and stays excluded, which the loose form would have cleared.
//
// OATS ARE DELIBERATELY ABSENT from this list. The gluten row's note leaves the
// oats call to the existing list, unchanged; adding "oat" here would silently
// reverse it.
const GLUTEN_FREE_GRAINS = [
  "corn", "maize", "hominy", "masa", "cornmeal", "polenta", "rice", "quinoa",
  "amaranth", "sorghum", "millet", "teff", "buckwheat", "potato", "tapioca",
  "cassava", "arrowroot", "chickpea", "garbanzo", "almond", "coconut",
  "chestnut", "soy", "peanut", "plantain", "lentil",
];
function gfGrainQualified(n, noun) {
  const s = String(n || "");
  const q = GLUTEN_FREE_GRAINS.map(escapeRe).join("|");
  // "corn tortilla" | "brown rice flour" | "whole grain corn cereal"
  if (new RegExp(`\\b(?:${q})[a-z]*[\\s-]+(?:flour[\\s-]+)?${noun}(?:es|s)?\\b`, "i").test(s)) return true;
  // FDC's inverted comma form: "Tortillas, ready-to-bake or -fry, corn"
  return new RegExp(`\\b${noun}(?:es|s)?\\b\\s*,\\s*(?:[a-z0-9 '()/&-]+,\\s*){0,3}(?:${q})\\b`, "i").test(s);
}
// Named wheat/barley/rye anywhere in the name overrides the guard outright —
// "Pasta, gluten-free, corn flour and quinoa flour" is safe, "Wheat flour,
// white, tortilla mix" is not, and both carry a GF grain.
const NAMES_A_GLUTEN_GRAIN = /\b(?:wheat|barley|rye|spelt|semolina|durum|kamut|triticale|farro|bulgur|malt|malted|seitan|graham)\b/i;
const glutenFreeGrainForm = (n, noun) => gfGrainQualified(n, noun) && !NAMES_A_GLUTEN_GRAIN.test(String(n || ""));

// ── the SAME rule for the pasta nouns, on a NARROWER grain set (H3) ──────
// "pasta" and "noodle" are wheat-DEFAULT nouns exactly like "flour" and
// "tortilla", and they are the two that never got the guard above. Measured on
// the real library: 57 of 57 "High-Protein … with Lentil/Chickpea Pasta"
// recipes were hidden from a celiac and 53 of them carry no gluten at all —
// the library's best high-protein assets, deleted from the people who most
// need them. Eight food rows go with them ("Lentil pasta, dry", "Rice
// noodles", …). This is the over-exclusion mirror of a leak, the same class
// b28bd17 fixed for free text.
//
// WHY A SEPARATE, SMALLER LIST INSTEAD OF REUSING GLUTEN_FREE_GRAINS. "X
// flour" means flour milled FROM x — the qualifier IS the base, which is what
// makes the adjacency rule safe there. "X noodles" does not carry that
// meaning: "Peanut noodles" and "Chestnut noodles" are wheat noodles in a
// sauce made of the thing, and "Potato noodles" (gnocchi, Schupfnudeln) are
// potato bound with WHEAT flour. Reusing the flour list was measured and
// clears all four — trading H3's over-block for a LEAK, which is strictly
// worse. So the pasta guard drops the members that read as an accompaniment
// rather than a base, and adds the three pulses sold as pasta that a FLOUR
// list never needed to name.
//
// DERIVED, not retyped: a grain added to GLUTEN_FREE_GRAINS reaches the pasta
// nouns automatically unless it is explicitly named below, so the two lists
// cannot silently drift apart.
const NOT_A_PASTA_BASE = new Set(["peanut", "almond", "coconut", "chestnut", "soy", "potato"]);
const PASTA_BASE_GRAINS = GLUTEN_FREE_GRAINS
  .filter((g) => !NOT_A_PASTA_BASE.has(g))
  .concat(["edamame", "mung bean", "black bean"]);
// Soba is the one noodle whose GF-sounding name is not a GF claim: Japanese
// soba may legally be as little as 30% buckwheat and is normally cut with
// wheat flour, so standard celiac guidance is "avoid unless labelled
// gluten-free". Same reasoning the `cereal` guard uses for barley-malted corn
// flakes. Vetoing the WORD covers "Buckwheat noodles" too, which names no
// wheat and would otherwise clear on adjacency.
const SOBA_OR_BUCKWHEAT = /\b(?:soba|buckwheat)\b/i;
function glutenFreePastaForm(n, noun) {
  const s = String(n || "");
  if (NAMES_A_GLUTEN_GRAIN.test(s) || SOBA_OR_BUCKWHEAT.test(s)) return false;
  const q = PASTA_BASE_GRAINS.map(escapeRe).join("|");
  // "lentil pasta" | "brown rice noodles" | "corn flour pasta"
  if (new RegExp(`\\b(?:${q})[a-z]*[\\s-]+(?:flour[\\s-]+)?${noun}(?:es|s)?\\b`, "i").test(s)) return true;
  // FDC's inverted comma form: "Noodles, rice, cooked" · "Pasta, corn, dry"
  return new RegExp(`\\b${noun}(?:es|s)?\\b\\s*,\\s*(?:[a-z0-9 '()/&-]+,\\s*){0,3}(?:${q})\\b`, "i").test(s);
}

// :253 promises "soybean oil stays permitted" (highly refined, protein-free) —
// but the "soybean" keyword catches it anyway, so all 15 refined-soy-oil rows
// were removed from a soy-allergic pool in direct contradiction of the comment.
// Narrow by design: the row must BE the oil, not a food MADE with it. "Salad
// dressing, mayonnaise, soybean oil" and "Snacks, potato chips, … soybean oil"
// stay excluded — a composite food can carry soy protein the name never states.
// A soy form that is NOT the refined oil. If any of these is named, the row is
// not oil-only and the veto does not apply.
const OTHER_SOY_FORM = /\bsoy\w*\b|\btofu\b|\btempeh\b|\bmiso\b|\bedamame\b|\bnatto\b|\btamari\b|\bshoyu\b|\btvp\b|\bbean curd\b/i;
const isRefinedSoyOilRow = (n) => {
  const s = String(n || "");
  // The row IS the oil: "Oil, soybean, salad or cooking" · "Oil, industrial,
  // soy, refined" · "Oil, vegetable, soybean, refined" · "Soybean oil".
  if (/^\s*oils?\s*,\s*(?:vegetable\s*,\s*|industrial\s*,\s*)?soy(?:a|bean)?\b/i.test(s)) return true;
  if (/^\s*soy(?:a|bean)?\s+oil\b/i.test(s)) return true;
  if (!/\bsoy(?:a|bean)?\s+oil\b/i.test(s)) return false;
  // …or a composite whose ONLY declared soy is the oil: "Snacks, potato chips,
  // … made with partially hydrogenated soybean oil". Blocking a potato chip for
  // a soy allergy because of the frying oil is over-exclusion with no safety
  // gain, and it is the same reasoning :253 already committed to. Strike out
  // every "soy(bean) oil" mention first — testing for a leftover soy word on the
  // raw string would match the word "soybean" inside "soybean oil" itself.
  const rest = s.replace(/\bsoy(?:a|bean)?\s+oil\b/gi, " ");
  return !OTHER_SOY_FORM.test(rest);
};

// FNDDS uses "meatless" for two different things. A MEAT-PRODUCT noun qualified
// by it is a textured-soy analogue ("Chicken, meatless" is TVP); a DISH
// qualified by it is just the meat-free version and may contain no soy at all
// ("Stuffed tomato, with rice, meatless"). Bare "meatless" would have closed 15
// leaks by over-blocking 25 rows, which is not a fix.
const MEAT_ANALOGUE_NOUN = /\b(?:chicken|beef|pork|turkey|bacon|ham|sausage|frankfurter|hot ?dogs?|meatballs?|meatloaf|burgers?|patt(?:y|ies)|luncheon|deli|salami|pepperoni|steak|jerky|nuggets?|strips?|links?|slices?|bits|crumbles|cutlets?|spread|fillets?|tenders?|riblets?|scallopini)\b/i;

const WORD_GUARDS = {
  // milk/cream/butter: the plant-qualifier guards the style filter already uses,
  // so a dairy allergy doesn't wrongly remove coconut cream, almond milk or
  // peanut butter (plant foods a dairy-allergic person can eat).
  // The bare word "dairy" must not fire on a name that DECLARES its absence.
  // Real row: "Beverages, coffee, instant, vanilla, sweetened, decaffeinated,
  // with NON DAIRY creamer" was excluded for dairy — the name literally says it
  // is not (audit agent 09 §3.3). A "dairy free" claim is a regulated label
  // statement, unlike the marketing word "non-dairy" on a generic creamer, which
  // is why the un-declared creamers below stay excluded.
  dairy: (name) => hasWordOrPlural(name, "dairy")
    && !/\bnon[\s-]?dairy\b/i.test(String(name || ""))
    && !/\bdairy[\s-]?free\b/i.test(String(name || "")),
  milk: (name) => isDairyMilk(name),
  cream: (name) => hasWord(name, "cream") && !hasPhrase(name, "cream of tartar") && !matchesAny(name, PLANT_MILK_QUALIFIERS),
  butter: (name) => isDairyButterOrCream(name),
  // …and the two dairy nouns that never got one. "Yogurt, soy", "Yogurt, almond
  // milk", "Yogurt, coconut milk" and the ten "SILK … soy yogurt" rows were all
  // removed from a dairy-allergic pool; so would "Vegan cheese" / "Cashew
  // cheese" be. See isDairyYogurt()/isDairyCheese().
  yogurt: (name) => isDairyYogurt(name),
  yoghurt: (name) => isDairyYogurt(name),
  cheese: (name) => isDairyCheese(name),
  // "curd" is a dairy synonym, but BEAN curd is tofu — the corpus row is
  // "Soybean, curd cheese", and "bean curd" is what a large share of users type
  // for tofu. Both word orders, because FDC inverts them.
  curd: (name) => hasWordOrPlural(name, "curd")
    && !/\b(?:bean|soy|soya|soybean|tofu)\b[a-z, ]{0,12}\bcurds?\b/i.test(String(name || ""))
    && !/\bcurds?\b[a-z, ]{0,12}\b(?:bean|soy|soya|soybean)\b/i.test(String(name || "")),
  // "nondairy whipped topping" is sodium caseinate — milk protein. The one
  // exception is a row that IS an industrial fat ("Oil, industrial, palm kernel
  // (hydrogenated), used for whipped toppings"): a refined oil carries no
  // protein, and excluding it would be over-blocking for no safety gain.
  "whipped topping": (name) => hasPhrase(name, "whipped topping")
    && !/^\s*oils?\s*,|\bindustrial\b|\bshortening\b/i.test(String(name || "")),
  // chestnut is a tree nut, but WATER chestnut is an aquatic vegetable — a nut
  // allergy must not remove it. hasWordOrPlural, NOT hasWord: the singular-only
  // match leaked all 18 "Nuts, chestnuts, japanese/chinese/european, …" rows
  // plus bare "Chestnuts" (scripts/qc/sweep14k.mjs, 2026-07-23) — the same
  // plural-blindness class as the Phase 4 "Prawns" finding.
  chestnut: (name) => hasWordOrPlural(name, "chestnut") && !hasPhrase(name, "water chestnut"),
  // "Egg Plants" is the corpus spelling of aubergine — see stripEggPlant().
  egg: (name) => hasWordOrPlural(stripEggPlant(name), "egg"),
  eggs: (name) => hasWordOrPlural(stripEggPlant(name), "egg"),
  // "Ground Nut Oil" IS peanut oil (audit agent 09 #1 — four recipes reached a
  // peanut allergy through it). But "ground nut" is a two-word keyword, and
  // two-word keywords match as plain substrings, which would also fire on the
  // real row "Ground Nutmeg". Word-boundary the phrase instead.
  "ground nut": (name) => /\bground\s+nuts?\b/i.test(String(name || "")),
  // SWEET potato is Convolvulaceae, not a nightshade.
  potato: (name) => hasWordOrPlural(name, "potato") && !hasPhrase(name, "sweet potato"),

  // ── Stage-2 adversarial sweep (2026-07-24) ──────────────────────────────
  // GLUTEN — inflections the boundary matcher could not reach (84 rows), and
  // the two rows whose names state the breading is absent.
  breaded: (name) => hasWordOrPlural(name, "breaded")
    && !/\bnot\s+breaded\b|\bwithout\s+breading\b|\bno\s+breading\b/i.test(String(name || "")),
  // Granola: standard celiac guidance is "not gluten-free unless labelled so".
  // The absence guard mirrors COMPOUND_VETOES.caesar's "no dressing" rule —
  // "McDONALD'S, Fruit 'n Yogurt Parfait (without granola)" is a real row.
  granola: (name) => hasWordOrPlural(name, "granola")
    && !/\b(?:without|no|free\s+of)\s+granola\b/i.test(String(name || "")),
  // GLUTEN over-block: the three wheat-DEFAULT nouns that FDC also uses for
  // corn/rice/quinoa forms. Guard = the gluten-free-grain adjacency rule.
  flour: (name) => hasWordOrPlural(name, "flour") && !glutenFreeGrainForm(name, "flour"),
  tortilla: (name) => hasWordOrPlural(name, "tortilla")
    && !glutenFreeGrainForm(name, "tortilla")
    // Tortilla CHIPS are corn masa essentially without exception; the ones that
    // are not say "flour"/"wheat", which NAMES_A_GLUTEN_GRAIN catches below.
    && !(/\btortilla\s+chips?\b/i.test(String(name || "")) && !NAMES_A_GLUTEN_GRAIN.test(String(name || ""))),
  // "cereal" is scoped harder than flour/tortilla: a ready-to-eat cereal is
  // wheat or malt-flavoured far more often than not (corn flakes carry barley
  // malt), so only the COOKED grits/porridge shelf is cleared.
  cereal: (name) => hasWordOrPlural(name, "cereal")
    && !(/^\s*cereals?\s*,/i.test(String(name || ""))
      && /\b(?:corn|hominy)\s+grits\b/i.test(String(name || ""))
      && !NAMES_A_GLUTEN_GRAIN.test(String(name || ""))),
  // GLUTEN over-block, H3: the two wheat-DEFAULT nouns the guard above
  // skipped. Same adjacency rule, narrower grain set — see
  // glutenFreePastaForm(). "noodles" is a synonym in its own right and picks
  // this up through the singular→plural mirror below.
  pasta: (name) => hasWordOrPlural(name, "pasta") && !glutenFreePastaForm(name, "pasta"),
  noodle: (name) => hasWordOrPlural(name, "noodle") && !glutenFreePastaForm(name, "noodle"),

  // SOY — the promise at :253 that "soybean oil stays permitted", finally kept.
  soy: (name) => hasWordOrPlural(name, "soy") && !isRefinedSoyOilRow(name),
  soya: (name) => hasWordOrPlural(name, "soya") && !isRefinedSoyOilRow(name),
  soybean: (name) => hasWordOrPlural(name, "soybean") && !isRefinedSoyOilRow(name),
  // SOY — the USDA meat analogues, without the meat-free DISHES. See
  // MEAT_ANALOGUE_NOUN.
  meatless: (name) => hasWordOrPlural(name, "meatless") && MEAT_ANALOGUE_NOUN.test(String(name || "")),

  // SHELLFISH — restaurant paella is mixta (shellfish) far more often than not,
  // which is why the taxonomy already carried "paella mixta"; "Paella, NFS" is
  // the same dish under USDA's not-further-specified label. "Paella Rice" is the
  // raw bomba-rice INGREDIENT and carries nothing.
  paella: (name) => hasWordOrPlural(name, "paella")
    && !/\bpaella\s+rice\b/i.test(String(name || ""))
    && !plantDeclaredDish(name),
  // SHELLFISH — a bisque is a crustacean-shell soup; the modern vegetable
  // "bisques" are not. Same shape as plantQualified() for dairy.
  bisque: (name) => hasWordOrPlural(name, "bisque")
    && !plantDeclaredDish(name),
  // SHELLFISH/FISH — traditional kimchi carries jeotgal (salted shrimp/anchovy)
  // and traditional pho a fish-sauce broth, which is why the taxonomy carries
  // them. A row that SAYS "vegan" or names its vegetable does not.
  kimchi: (name) => hasWordOrPlural(name, "kimchi") && !plantDeclaredDish(name),
  pho: (name) => hasWordOrPlural(name, "pho") && !plantDeclaredDish(name),
  // FISH — tapenade standardly carries anchovy; the vegan versions say so.
  tapenade: (name) => hasWordOrPlural(name, "tapenade") && !plantDeclaredDish(name),

  // TREE NUTS — the two false friends that were costing whole safe food groups.
  // "nut butter" is a MULTI-WORD keyword, so the default rule matches it as a
  // plain SUBSTRING — and it sits inside "peanut butter", which removed 57
  // peanut-butter rows from a tree-nut-allergic (peanut-safe) pool. This is the
  // exact trap allergenTaxonomy :178-182 warns about for "nut milk"/"nut oil".
  // A word-boundary on the phrase fixes it: "peanut butter" has no boundary
  // before "nut", "coconut butter" has none either, "Almond nut butter" does.
  "nut butter": (name) => /\bnut\s+butter/i.test(String(name || "")),
  // Bare "nut" fires on FDC's SHELF PREFIX: it files coconut as "Nuts, coconut
  // meat, raw" (15 rows). Coconut is deliberately not a tree nut here
  // (allergenTaxonomy :178-182) and is a vegan staple. Only the shelf prefix is
  // discounted — "Frostings, coconut-nut" keeps its own "-nut" and stays out.
  nut: (name) => {
    const s = String(name || "");
    if (!hasWordOrPlural(s, "nut")) return false;
    const withoutShelf = s.replace(/^\s*nuts?\s*,\s*/i, "");
    if (/\bcoconut\b/i.test(withoutShelf) && !hasWordOrPlural(withoutShelf, "nut")) return false;
    return true;
  },
};

// CATEGORY_SYNONYMS carries several keywords in BOTH singular and plural form
// ("tortilla"/"tortillas", "cracker"/"crackers", "biscuit"/"biscuits"), and
// WORD_GUARDS is keyed by the exact synonym string — so a guard written for the
// singular is silently bypassed by the plural entry sitting next to it in the
// same list. That is precisely how "Tortillas, ready-to-bake or -fry, corn"
// stayed excluded from a celiac pool AFTER the corn-tortilla guard landed: the
// guard was consulted for "tortilla" and skipped for "tortillas". Mirroring the
// table onto its plurals once, here, makes the class of bug unrepeatable.
// Existing entries always win, so this can never change a hand-written guard.
for (const [word, guard] of Object.entries(WORD_GUARDS)) {
  for (const plural of [`${word}s`, `${word}es`]) {
    if (!WORD_GUARDS[plural]) WORD_GUARDS[plural] = guard;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DECLARED ABSENCE — the one licensed reduction, and its exact leash
// ─────────────────────────────────────────────────────────────────────────
// "Pasta, gluten-free, corn, dry" · "Bread, gluten-free, white" · "Rolls,
// gluten-free" — 47 rows whose names carry a REGULATED absence claim were
// removed from a celiac pool by the very category they are formulated for. That
// is the worst over-block in this file: it deletes exactly the foods the user
// is supposed to eat. WORD_GUARDS.dairy has had a "dairy-free"/"non-dairy" veto
// since audit 09; gluten never got one, and the guard mechanism is per-KEYWORD,
// so gluten would have needed ~140 copies of it. It belongs one level up.
//
// SCOPE, deliberately tight:
//   · Only a claim about THIS category counts. "Pizza, cheese, gluten-free thin
//     crust" is cleared for gluten and still excluded for dairy.
//   · Only the regulated FREE-FROM form. "lactose free" is NOT a dairy claim —
//     lactose-free milk is still cow's-milk protein, which this file already
//     excludes on purpose and must keep excluding.
//   · It suppresses the NAME probe and the coarse USDA-CATEGORY probe (a shelf
//     label like "Baked Products" cannot outrank a free-from claim in the
//     product's own name — every one of the 47 rows is filed there). It does
//     NOT suppress allergenTags / mayContain: those are declarations ABOUT THE
//     PRODUCT, and a product that declares both is telling us something the
//     name is not, so the declaration wins.
const CATEGORY_ABSENCE_DECLARED = {
  gluten: /\b(?:gluten|wheat)[\s-]?free\b/i,
  dairy: /\b(?:dairy|milk)[\s-]?free\b/i,
  egg: /\beggs?[\s-]?free\b/i,
  eggs: /\beggs?[\s-]?free\b/i,
  soy: /\bsoya?[\s-]?free\b/i,
  "soy protein": /\bsoya?[\s-]?free\b/i,
  peanuts: /\bpeanut[\s-]?free\b/i,
  nuts: /\b(?:tree[\s-]?nut|nut)[\s-]?free\b/i,
  "tree nuts": /\b(?:tree[\s-]?nut|nut)[\s-]?free\b/i,
  fish: /\bfish[\s-]?free\b/i,
  shellfish: /\bshellfish[\s-]?free\b/i,
  seafood: /\bseafood[\s-]?free\b/i,
  sesame: /\bsesame[\s-]?free\b/i,
};

// ── THREE LEASHES ON THE VETO ────────────────────────────────────────────
// A whole-string veto is dangerous in a way the over-block it fixes is not: it
// converts an over-block into a LEAK, which is strictly worse. This matcher is
// run over recipe STEP TEXT as well as product names (planContext scans steps),
// so "Cook the rice without butter for a dairy-free version." must still be
// excluded for dairy — the butter is right there — and "serve with gluten-free
// bread, or regular sourdough if you prefer" must still be excluded for gluten.
//
// 1. PROSE IS NEVER A LABEL CLAIM. The three signals below were measured
//    against all 14,122 real names: of the 65 rows carrying a free-from claim,
//    ZERO match any of them, and " your"/" you"/" if"/" until"/" then"/" while"
//    and a trailing period appear in no claim-carrying name at all. (An
//    imperative-verb signal was tried and REJECTED — "Roll, gluten free" and
//    "Roast beef" start with cooking verbs.)
const LOOKS_LIKE_PROSE = [
  /\.\s*$/,                                    // a sentence ends; a food name does not
  /\s(?:the|your|you|if|until|then|while)\s/,  // lowercase function words
];
// 2. A CONDITIONAL claim OFFERS an allergen-free variant; it does not assert
//    one. "Bread, gluten-free" asserts. "…or omit for a dairy-free version"
//    offers, and cooks the allergen in for everyone who doesn't take the offer.
const CONDITIONAL_ABSENCE = /\b(?:for|or|to make|make it|if|instead|optional|omit|substitute|swap)\b[^.,;]{0,24}(?:gluten|wheat|dairy|milk|soya?|eggs?|nut|peanut|fish|shellfish|seafood|sesame)[\s-]?free\b|(?:gluten|wheat|dairy|milk|soya?|eggs?|nut|peanut|fish|shellfish|seafood|sesame)[\s-]?free\s+(?:version|option|alternative|variation|swap)\b/i;
// 3. A claim governs ITS OWN CLAUSE, never an alternative offered AFTER it.
//    "gluten-free pasta or regular spaghetti" — the spaghetti is still gluten.
//    Two deliberate limits, both measured against the real table:
//      · `\sor\s` does not fire inside "and/or" (no space before "or"), which is
//        how FDC writes "…rice flour, corn starch, and/or tapioca";
//      · the split only applies when the claim comes FIRST. FDC also uses " or "
//        to list product VARIANTS — "Cake or cupcake, gluten free", "Chow mein or
//        chop suey" — where the claim at the end governs everything before it.
const ALTERNATIVE_CLAUSE = /\s(?:or|but|otherwise|instead|however|except|unless)\s/i;

/**
 * How much of `name` a free-from claim for `synonymKey` does NOT cover.
 *   null  — there is no claim to honour (no claim, or prose, or conditional):
 *           match the whole string exactly as before.
 *   ""    — the claim governs everything: nothing is left to match.
 *   other — the ungoverned remainder, which still gets matched in full.
 */
function absenceUngoverned(name, synonymKey) {
  const re = CATEGORY_ABSENCE_DECLARED[synonymKey];
  const s = String(name || "");
  if (!re) return null;                 // NB: s.match(undefined) matches EVERYTHING
  const claim = s.match(re);
  if (!claim) return null;
  if (LOOKS_LIKE_PROSE.some((p) => p.test(s))) return null;
  if (CONDITIONAL_ABSENCE.test(s)) return null;
  const alt = s.match(ALTERNATIVE_CLAUSE);
  return alt && alt.index > claim.index ? s.slice(alt.index + alt[0].length) : "";
}

/** True if an unconditional free-from claim governs the WHOLE of `name`. */
function declaresAbsenceOf(name, synonymKey) {
  return absenceUngoverned(name, synonymKey) === "";
}

// The second (and last) name statement allowed to outrank the coarse USDA shelf
// category, for gluten only. USDA files corn tortillas under "Baked Products",
// which the taxonomy declares gluten evidence — so "Tortillas, ready-to-bake or
// -fry, corn" survived the name guard and was then removed by the shelf label
// anyway. Naming the grain IS the product statement here, and it is more
// specific than the aisle the product is sold in. Restricted to the three nouns
// the guard covers: "bread" and "muffin" are deliberately absent, because
// "cornbread" and "corn muffins" are wheat-flour products.
function namesAGlutenFreeGrainForm(name) {
  if (NAMES_A_GLUTEN_GRAIN.test(String(name || ""))) return false;
  return gfGrainQualified(name, "tortilla") || gfGrainQualified(name, "flour") || /\b(?:corn|hominy)\s+grits\b/i.test(String(name || ""));
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
  // A regulated free-from claim for THIS category clears only the text it
  // GOVERNS — its own clause, and only on a product name, and only when it
  // asserts rather than offers. Everything it does not govern is still matched
  // in full, so the veto can never turn an over-block into a leak. Evaluated on
  // the RAW name so a compound expansion cannot smuggle a keyword past it.
  const ungoverned = absenceUngoverned(rawName, resolved.synonymKey);
  if (ungoverned !== null) return ungoverned.trim() ? matchesExclusionTerm(ungoverned, term) : false;
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
    const hitsCategory = (list) => list.some((word) => {
      const guard = WORD_GUARDS[word];
      return guard ? guard(name) : matchesTermList(name, word);
    });
    if (hitsCategory(synonyms)) return true;
    // CROSS-REACTION. Excluding one allergen can oblige us to exclude another:
    // lupin cross-reacts strongly with peanut and turns up in the gluten-free
    // bakery blends a careful eater reaches for, so a peanut exclusion has to
    // carry lupin with it. That fact was already in the taxonomy — as PROSE in a
    // `note` field, which no code could read (allergenTaxonomy.js, the lupin
    // entry). It is now `crossReactsInto`, and this is the one place it is read.
    //
    // Directional by construction: CROSS_REACTANTS maps the EXCLUDED term to the
    // extra categories it drags in, never the reverse. Excluding lupin does not
    // imply a peanut allergy.
    for (const extra of CROSS_REACTANTS[resolved.synonymKey] || []) {
      const extraSynonyms = CATEGORY_SYNONYMS[extra];
      if (extraSynonyms && hitsCategory(extraSynonyms)) return true;
    }
    return false;
  }
  // Not a known category - literal substring fallback. Covers free-text
  // entries like "kiwi" and specific multi-word phrases like "soy protein"
  // that should NOT expand to the whole soy category.
  const lower = name.toLowerCase();
  // A single-word free-text term must land on the START of a word, not inside
  // one. Plain substring made "oats" exclude "G-oat- cheese" (through the
  // normalised singular "oat") and "rape" exclude "G-rape- juice" — H5, the
  // over-exclusion mirror of a leak. It hides food from people who can eat it,
  // and on a thin diet pool that is the difference between a plan and no plan.
  //
  // Anchoring the START rather than requiring a full word BOUNDARY is
  // deliberate: "oat" must still catch "Oatmeal" and "Oat flour", which a
  // \b…\b rule would have let straight through. Prefix-at-word-start keeps
  // every compound that matters and drops the ones that were never the word.
  //
  // Multi-word phrases keep plain substring on purpose — "soy protein" is meant
  // to catch "textured soy protein" without expanding to the whole soy
  // category, and a phrase is already specific enough not to collide.
  //
  // Scope: this branch is reached ONLY for terms with no synonymKey, i.e.
  // unrecognised free text. Category terms ("butter" → dairy, "nut" → tree
  // nuts, "sesame") never arrive here, so this cannot loosen a known allergen.
  const hitsFreeText = (needle) => {
    if (!needle) return false;
    if (/\s/.test(needle)) return lower.includes(needle);
    return new RegExp("(?:^|[^a-z0-9])" + escapeRe(needle), "i").test(lower);
  };
  if (hitsFreeText(key)) return true;
  // ...and the normalised form of it, so an unrecognised phrasing still greps
  // for the thing the user meant ("no mushrooms" → "mushroom"). Union with the
  // raw text above.
  const norm = resolved.normalisedKey;
  return Boolean(norm) && norm !== key && norm.length > 1 && hitsFreeText(norm);
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

// USDA/FNDDS categories that are evidence of NOTHING — too heterogeneous to
// imply any one allergen. Named here so the taxonomy merge can never introduce
// one by accident (tests/allergenMetadata.test.js asserts the first four stay
// out, and the reasoning is on FDC_CATEGORY_FAMILIES above).
const NON_EVIDENCE_FDC_CATEGORIES = new Set([
  "nut and seed products", "nuts and seeds", "cereal grains and pasta",
  "legumes and legume products", "fast foods", "restaurant foods",
  "meals, entrees, and side dishes", "soups, sauces, and gravies", "snacks",
  "sweets", "cream and cream substitutes", "plant-based milk",
  "plant-based yogurt", "not included in a food category",
]);

// ═════════════════════════════════════════════════════════════════════════
// TAXONOMY MERGE — one data table, four legacy maps, ADD-ONLY
// ═════════════════════════════════════════════════════════════════════════
// Every write below either CREATES a key or APPENDS to a list. Nothing is
// removed, overwritten or reordered, and existing entries always win (`if
// (!x) x = …`), so this merge cannot change any exclusion that already fired —
// it can only add ones that were missing. That is the same add-only rule the
// metadata probes follow, applied to the data layer.
//
// Pass order matters: categories must all exist before aliases are registered,
// or an alias could shadow a category key (an invariant
// tests/dietaryAliasMap.test.js asserts).
function mergeAllergenTaxonomy() {
  // 1 — every top-level row owns a CATEGORY_SYNONYMS key and declares a family.
  for (const e of ALLERGEN_TAXONOMY) {
    if (e.parent) continue;
    if (!CATEGORY_SYNONYMS[e.key]) CATEGORY_SYNONYMS[e.key] = [];
    if (!SYNONYM_KEY_FAMILY[e.key]) SYNONYM_KEY_FAMILY[e.key] = e.family || e.key;
    // A category is more specific than an alias; if a legacy alias shadows a
    // key the taxonomy now owns, the key wins (and the invariant test stays
    // green forever rather than at the mercy of table edits).
    if (FREE_TEXT_ALIASES[e.key]) delete FREE_TEXT_ALIASES[e.key];
  }
  // 2 — keywords fold into the owning category (a species row folds into its
  //     parent: a cashew allergy gets the whole tree-nut family, the documented
  //     safe direction).
  for (const e of ALLERGEN_TAXONOMY) {
    const list = CATEGORY_SYNONYMS[categoryKeyOf(e)];
    if (!list) continue;
    for (const kw of e.nameKeywords || []) {
      const w = String(kw).trim().toLowerCase();
      if (w && !list.includes(w)) list.push(w);
    }
  }
  // 3 — umbrella rows (`includes`) take the UNION of their members' lists, so
  //     "seafood" can never drift from fish or shellfish.
  for (const e of ALLERGEN_TAXONOMY) {
    if (!e.includes || e.parent) continue;
    const list = CATEGORY_SYNONYMS[e.key];
    for (const member of e.includes) {
      for (const w of CATEGORY_SYNONYMS[member] || []) if (!list.includes(w)) list.push(w);
    }
  }
  // 4 — every key/synonym a user might type becomes a free-text alias onto its
  //     category. Never over a category key, never over an existing alias.
  for (const e of ALLERGEN_TAXONOMY) {
    const target = categoryKeyOf(e);
    for (const term of [e.key, ...(e.synonyms || [])]) {
      const a = normaliseExclusionText(term);
      if (!a || CATEGORY_SYNONYMS[a] || FREE_TEXT_ALIASES[a]) continue;
      FREE_TEXT_ALIASES[a] = target;
    }
  }
  // 4b — KEYWORDS ARE ALSO THINGS PEOPLE TYPE. Measured 2026-07-24: "panko",
  //      "dashi", "ponzu", "surimi", "shrimp paste" and "nougat" each excluded
  //      0 of 889 recipes, because a term that is only a KEYWORD (what a food
  //      name says) and never a SYNONYM (what a user types) fell through to a
  //      literal grep — and nothing in the corpus is literally named "panko".
  //      Mapping them onto their category is the same call this file already
  //      made for "salmon"→fish and "cashew"→tree nuts: a user naming a
  //      carrier is over-excluded to the family, the documented safe direction.
  //
  //      TWO LEASHES, both measured:
  //      · MAJOR categories only. The broad avoidance rows must not do this —
  //        "tomato" would drag in every potato and pepper via nightshades,
  //        "cumin" would delete the whole spice shelf, "banana" would take
  //        avocado and kiwi with it through latex-fruit.
  //      · ≥5 characters. The literal-substring probe in matchesExclusionTerm
  //        is a plain includes(), so a short keyword is a landmine: "sole" is
  //        inside "casserole", "roe" inside a dozen words. Those stay literal.
  const ALIASABLE_KEYWORD_CATEGORIES = [
    "gluten", "dairy", "egg", "eggs", "soy", "fish", "shellfish", "seafood",
    "nuts", "tree nuts", "peanuts", "sesame",
  ];
  for (const cat of ALIASABLE_KEYWORD_CATEGORIES) {
    for (const kw of CATEGORY_SYNONYMS[cat] || []) {
      const a = normaliseExclusionText(kw);
      if (!a || a.length < 5 || CATEGORY_SYNONYMS[a] || FREE_TEXT_ALIASES[a]) continue;
      FREE_TEXT_ALIASES[a] = cat;
    }
  }
  // 5 — metadata evidence: USDA/FNDDS categories and Open Food Facts tags.
  for (const e of ALLERGEN_TAXONOMY) {
    const fam = SYNONYM_KEY_FAMILY[categoryKeyOf(e)];
    if (!fam) continue;
    for (const cat of e.fdcCategories || []) {
      const k = String(cat).trim().toLowerCase();
      if (!k || NON_EVIDENCE_FDC_CATEGORIES.has(k)) continue;
      const fams = FDC_CATEGORY_FAMILIES[k] || (FDC_CATEGORY_FAMILIES[k] = []);
      if (!fams.includes(fam)) fams.push(fam);
    }
    for (const tag of e.offTags || []) {
      const t = String(tag).trim().toLowerCase();
      if (t && !OFF_TAG_FAMILY[t]) OFF_TAG_FAMILY[t] = fam;
    }
  }
}
mergeAllergenTaxonomy();

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
  // Suppressed by a free-from claim in the product's own name: all 47
  // "gluten-free" rows are filed under "Baked Products", and a coarse shelf
  // label cannot outrank a regulated absence claim on the product itself. This
  // is the ONLY place a probe is conditioned on another signal, and it is
  // conditioned on a NAME claim, never on another probe's negative result — the
  // add-only rule between probes is intact. Probes 3 and 4 (the product's own
  // declarations) are deliberately NOT suppressed.
  const fdcCategory = typeof food?.fdcCategory === "string" ? food.fdcCategory.trim().toLowerCase() : null;
  const nameOutranksCategory = declaresAbsenceOf(name, resolved.synonymKey)
    || (resolved.family === "gluten" && namesAGlutenFreeGrainForm(name));
  if (fdcCategory && resolved.family && !nameOutranksCategory) {
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
  COMPOUND_VETOES,
  WORD_GUARDS,
  NON_EVIDENCE_FDC_CATEGORIES,
  FREE_TEXT_ALIASES,
  OFF_TAG_FAMILY,
  FDC_CATEGORY_FAMILIES,
  FDC_FLESH_CATEGORIES,
  FDC_ANIMAL_NONFLESH_CATEGORIES,
  SYNONYM_KEY_FAMILY,
  CATEGORY_SYNONYMS,
  TRACE_POLICY_DEFAULT,
  // ── allergen taxonomy (2026-07-24) — re-exported so a caller needs one
  //    import to both resolve a term and render the picker that produced it.
  ALLERGEN_TAXONOMY,
  allergenCatalog,
  searchAllergens,
  normaliseExclusionText,
  exclusionTermCandidates,
};
