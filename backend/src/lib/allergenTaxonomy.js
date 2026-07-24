// ════════════════════════════════════════════════════════════════════════════
// ALLERGEN TAXONOMY — the one DATA TABLE behind every allergen the app knows.
// ════════════════════════════════════════════════════════════════════════════
//
// WHY THIS FILE EXISTS
// Before Stage 1 the allergen knowledge lived as four hand-maintained objects
// inside dietaryFilter.js (CATEGORY_SYNONYMS, FREE_TEXT_ALIASES,
// SYNONYM_KEY_FAMILY, OFF_TAG_FAMILY). Adding one allergen meant editing four
// places and hoping they agreed; the 2026-07-24 audit measured the predictable
// result — `perogi` was a declared dairy carrier for VEGAN but not for a dairy
// ALLERGY, `teriyaki`/`hoisin` were declared for GLUTEN but not for SOY,
// `worcestershire` for gluten and fish but not soy. Same food, same risk, three
// different answers depending on which list you happened to land in.
//
// Here, ONE row describes an allergen completely:
//
//   key            canonical id (also the CATEGORY_SYNONYMS key it owns)
//   label          display string for the UI
//   tier           "major" (regulated) | "common" | "rare" — UI grouping
//   parent         set on a SPECIES/sub-type row; it folds into its parent
//   family         canonical family shared with OFF tags + USDA categories
//   synonyms[]     what a USER might type (the UI searches these)
//   nameKeywords[] what a FOOD NAME might say (the matcher matches these)
//   fdcCategories[] USDA/FNDDS category strings that are unambiguous evidence
//   offTags[]      Open Food Facts allergen tag slugs
//   note           the honest caveat, shown to nobody but read by the next dev
//
// dietaryFilter.js MERGES this table into its own maps ADD-ONLY (it may create
// a key or extend a list; it may never shorten one). This file has ZERO
// dependencies and must keep it that way — dietaryFilter requires it, never the
// reverse.
//
// THE MATCHING CONTRACT (why keywords look the way they do)
//   · a single-word keyword is matched word-boundary + plural-tolerant, so
//     "nut" does NOT fire inside "coconut"/"doughnut"/"nutmeg";
//   · a multi-word keyword is matched as a plain case-insensitive SUBSTRING, so
//     it must not be a substring of an innocent name. "nut milk" is deliberately
//     ABSENT because it sits inside "coconut milk"; "ground nut" is present but
//     carries a word-boundary guard in dietaryFilter (it sits inside "Ground
//     Nutmeg", a real row in the 14,122-name table).
// Every keyword below was checked against that table before it was added.

"use strict";

// ── tiers ────────────────────────────────────────────────────────────────
const TIER_MAJOR = "major";   // regulated top allergens (FDA/EU declarables)
const TIER_COMMON = "common"; // widespread, not regulated as a major
const TIER_RARE = "rare";     // real, less common — opt-in from the UI search

/**
 * The table. Order is display order within a tier.
 * Rows carrying `parent` are SPECIES/sub-type rows: their keywords fold into the
 * parent's keyword list and their key+synonyms become free-text aliases onto the
 * parent. They never become categories of their own — a user allergic to cashew
 * is over-excluded to the whole tree-nut family, which is this codebase's
 * documented safe direction.
 */
const ALLERGEN_TAXONOMY = [
  // ══ MAJORS ══════════════════════════════════════════════════════════════
  {
    key: "dairy",
    label: "Milk & dairy",
    tier: TIER_MAJOR,
    family: "dairy",
    synonyms: [
      "milk", "cows milk", "cow milk", "dairy products", "dairy produce",
      "milk allergy", "cmpa", "cows milk protein allergy", "dairy free",
      "lactose free", "lactose intolerant", "milk free",
    ],
    nameKeywords: [
      // The historical dairy list stays in dietaryFilter; these are the rows the
      // 2026-07-24 audit measured leaking.
      "perogi", "pierogi",           // agent 05 P0-2: shipped to a dairy allergy in 8/40 weeks
      "fudge", "scalloped", "au gratin", "souffle", "soufflé", "mousse",
      "tiramisu", "tzatziki", "creme brulee", "crème brûlée", "sherbet", "flan",
      "brioche", "pesto", "eclair", "éclair", "crepe", "crêpe", "ladyfinger",
      "panna cotta", "cannoli", "tres leches", "alfredo", "bechamel", "béchamel",
      "raita", "cheesecake", "custard", "condensed milk", "evaporated milk",
    ],
    fdcCategories: [
      "Dairy and Egg Products", "Cheese", "Cottage/ricotta cheese",
      "Cream cheese, sour cream, whipped cream", "Ice cream and frozen dairy desserts",
      "Milk shakes and other dairy drinks", "Yogurt, regular", "Yogurt, Greek",
      "Milk, whole", "Milk, reduced fat", "Milk, lowfat", "Milk, nonfat",
      "Flavored milk, whole", "Flavored milk, reduced fat", "Flavored milk, lowfat",
      "Flavored milk, nonfat", "Macaroni and cheese", "Cheese sandwiches",
      "Soups, cream-based",
    ],
    offTags: ["milk", "milks", "milk-proteins", "lactose", "cream", "butter", "cheese", "whey", "casein"],
    note:
      "Deliberately NOT sourced from the USDA 'Cream and cream substitutes' category — that " +
      "is where the plant creamers live. 'Plant-based milk'/'Plant-based yogurt' are likewise " +
      "excluded from the evidence list.",
  },
  {
    key: "lactose",
    parent: "dairy",
    label: "Lactose (milk sugar)",
    tier: TIER_COMMON,
    synonyms: ["lactose intolerance", "lactose intolerant", "milk sugar", "hypolactasia"],
    nameKeywords: ["lactose", "milk sugar"],
    note:
      "Lactose INTOLERANCE and a milk-protein ALLERGY are different conditions, and this app " +
      "serves the dangerous one: a 'lactose free' product is still cow's-milk protein, so it " +
      "stays excluded. Typing 'lactose' therefore gets the whole dairy family on purpose.",
  },
  {
    key: "milk protein",
    parent: "dairy",
    label: "Milk protein (casein / whey)",
    tier: TIER_COMMON,
    synonyms: ["casein", "caseinate", "sodium caseinate", "whey", "whey protein", "lactalbumin", "lactoglobulin", "milk solids"],
    nameKeywords: ["casein", "caseinate", "lactalbumin", "lactoglobulin", "milk solids", "milk protein"],
  },
  {
    key: "eggs",
    label: "Eggs",
    tier: TIER_MAJOR,
    family: "egg",
    synonyms: ["egg", "hen egg", "chicken egg", "egg white", "egg whites", "egg yolk", "albumen", "albumin", "ovalbumin", "ovomucoid", "lysozyme", "egg free"],
    nameKeywords: [
      "souffle", "soufflé", "nougat", "mousse", "macaroon", "macaron",
      "ladyfinger", "tiramisu", "creme brulee", "crème brûlée", "angel food",
      "brioche", "eclair", "éclair", "flan", "tempura", "egg wash", "crepe", "crêpe",
      "pavlova", "zabaglione", "tamagoyaki",
    ],
    fdcCategories: ["Dairy and Egg Products", "Eggs and omelets", "Mayonnaise"],
    offTags: ["eggs", "egg"],
    note: "'Egg Plants' (the real spelling in this corpus) is an aubergine and is guarded out in dietaryFilter.",
  },
  {
    // LEGACY MIRROR. dietaryFilter has carried both "egg" and "eggs" as separate
    // category keys since the Phase-3 checkboxes landed, and the two lists have
    // to stay identical — a user whose profile stores the singular must not get
    // weaker protection than one who stores the plural. `includes` makes that
    // structural instead of a copy-paste both keys have to remember.
    key: "egg",
    label: "Eggs",
    tier: TIER_MAJOR,
    family: "egg",
    includes: ["eggs"],
    hidden: true,
    synonyms: [],
    nameKeywords: [],
    fdcCategories: ["Dairy and Egg Products", "Eggs and omelets", "Mayonnaise"],
    offTags: [],
    note: "Not shown in the picker — 'eggs' is the row a user sees.",
  },
  {
    key: "peanuts",
    label: "Peanuts",
    tier: TIER_MAJOR,
    family: "peanut",
    synonyms: ["peanut", "groundnut", "groundnuts", "ground nut", "ground nuts", "arachis", "arachis oil", "monkey nut", "goober pea", "peanut free"],
    nameKeywords: [
      "ground nut",     // agent 09 #1: the corpus writes peanut oil as "Ground Nut Oil"
      "groundnut oil", "kung pao", "pad thai", "peanut flour", "peanut sauce",
    ],
    fdcCategories: [],
    offTags: ["peanuts", "peanut"],
    note:
      "Peanuts are LEGUMES. A peanut allergy is not a tree-nut allergy and this table keeps " +
      "them apart on purpose. 'ground nut' carries a word-boundary guard so it cannot fire on " +
      "the real row 'Ground Nutmeg'.",
  },
  {
    key: "tree nuts",
    label: "Tree nuts",
    tier: TIER_MAJOR,
    family: "tree-nut",
    synonyms: ["tree nut", "treenut", "treenuts", "nut", "nuts", "nut allergy", "nut free"],
    nameKeywords: [
      "nut",            // agent 09 #1: bare "nut" was in `nuts` but not `tree nuts`
      "hazlenut",       // agent 09 #2: real misspelled corpus row "Hazlenuts"
      "pesto", "nougat", "baklava",
    ],
    offTags: ["nuts", "tree-nuts"],
    note:
      "Coconut is deliberately NOT a tree nut here (FDA lists it; allergists and this corpus " +
      "treat it as a fruit, and excluding it would delete a vegan staple). 'nut milk' and " +
      "'nut oil' are deliberately absent as keywords — both are substrings of 'coconut milk' / " +
      "'peanut oil'.",
  },
  // ── tree-nut species depth ───────────────────────────────────────────────
  { key: "almond", parent: "tree nuts", label: "Almond", tier: TIER_MAJOR, synonyms: ["almonds", "almond milk", "marzipan", "amaretto", "frangipane"], nameKeywords: ["almond", "marzipan", "amaretto", "frangipane"] },
  { key: "cashew", parent: "tree nuts", label: "Cashew", tier: TIER_MAJOR, synonyms: ["cashews", "cashew nut"], nameKeywords: ["cashew"] },
  { key: "walnut", parent: "tree nuts", label: "Walnut", tier: TIER_MAJOR, synonyms: ["walnuts", "black walnut"], nameKeywords: ["walnut"] },
  { key: "pecan", parent: "tree nuts", label: "Pecan", tier: TIER_MAJOR, synonyms: ["pecans"], nameKeywords: ["pecan"] },
  { key: "pistachio", parent: "tree nuts", label: "Pistachio", tier: TIER_MAJOR, synonyms: ["pistachios"], nameKeywords: ["pistachio"] },
  { key: "hazelnut", parent: "tree nuts", label: "Hazelnut / filbert", tier: TIER_MAJOR, synonyms: ["hazelnuts", "filbert", "filberts", "nutella", "gianduja", "praline"], nameKeywords: ["hazelnut", "hazlenut", "filbert", "nutella", "gianduja", "praline"] },
  { key: "macadamia", parent: "tree nuts", label: "Macadamia", tier: TIER_MAJOR, synonyms: ["macadamias", "queensland nut"], nameKeywords: ["macadamia"] },
  { key: "brazil nut", parent: "tree nuts", label: "Brazil nut", tier: TIER_MAJOR, synonyms: ["brazil nuts", "para nut"], nameKeywords: ["brazil nut"] },
  { key: "pine nut", parent: "tree nuts", label: "Pine nut (pignoli)", tier: TIER_MAJOR, synonyms: ["pine nuts", "pignoli", "pinon", "piñon"], nameKeywords: ["pine nut", "pignoli"] },
  {
    key: "chestnut", parent: "tree nuts", label: "Chestnut", tier: TIER_MAJOR,
    synonyms: ["chestnuts", "marron"], nameKeywords: ["chestnut"],
    note: "WATER chestnut is an aquatic vegetable and is guarded out in dietaryFilter.",
  },

  {
    key: "soy",
    label: "Soy",
    tier: TIER_MAJOR,
    family: "soy",
    synonyms: ["soya", "soja", "soybean", "soybeans", "soy free", "soy lecithin", "soy protein"],
    nameKeywords: [
      "teriyaki", "hoisin",     // agent 09 §2: in the GLUTEN list, missing from SOY
      "worcestershire",         // agent 05 P1-1: declared for gluten + fish, not soy
      "tamari", "shoyu", "ponzu", "gochujang", "doubanjiang", "okara", "yuba",
      "black bean sauce", "soy sauce",
    ],
    fdcCategories: ["Soy-based condiments", "Stir-fry and soy-based sauce mixtures", "Soy and meat-alternative products"],
    offTags: ["soybeans", "soy", "soja"],
    note:
      "Soybean OIL stays permitted (highly refined, protein-free) — that is why no '*oil' " +
      "keyword appears here and why the separate 'soy protein' key exists. The odd-looking " +
      "keyword string above is inert on purpose: it documents the decision inside the data.",
  },
  {
    key: "gluten",
    label: "Gluten (wheat, barley, rye)",
    tier: TIER_MAJOR,
    family: "gluten",
    synonyms: [
      "wheat", "celiac", "coeliac", "celiac disease", "coeliac disease",
      "gluten free", "wheat free", "gluten intolerance", "gluten sensitivity",
      "non celiac gluten sensitivity", "wheat protein", "gliadin",
    ],
    nameKeywords: [
      // agent 05 P0-1 + agent 09 #4: pasta shapes the list never had
      "farfalle", "fusilli", "rigatoni", "conchiglie", "cannelloni", "ziti",
      "rotini", "bucatini", "orecchiette", "ditalini", "campanelle", "linguini",
      "manicotti", "pappardelle", "cavatappi",
      // agent 09 #5-#8 + §2: the real leaking rows
      "toast", "gravy", "rice krispies", "christmas pudding", "stuffing",
      "empanada", "lo mein", "chow mein", "strudel", "eclair", "éclair",
      "crepe", "crêpe", "wafer", "zwieback", "funnel cake", "tempura",
      "focaccia", "ciabatta", "baguette", "challah", "beignet", "churro",
      "knish", "samosa", "shortcake", "coffee cake", "baklava", "tiramisu",
      "ladyfinger", "roux", "melba", "pierogi", "perogi",
      // wheat species the alias map knew but the keyword list did not
      "durum", "kamut", "einkorn", "emmer", "freekeh",
    ],
    fdcCategories: [
      "Baked Products", "Yeast breads", "Rolls and buns", "Bagels and English muffins",
      "Biscuits, muffins, quick breads", "Cookies and brownies", "Cakes and pies",
      "Doughnuts, sweet rolls, pastries", "Crackers, excludes saltines", "Saltine crackers",
      "Pancakes, waffles, French toast", "Pasta mixed dishes, excludes macaroni and cheese",
      "Macaroni and cheese", "Pizza", "Turnovers and other grain-based items",
    ],
    offTags: ["gluten", "wheat", "barley", "rye", "oats", "spelt", "kamut", "cereals-containing-gluten"],
    note:
      "'Cereal Grains and Pasta' is deliberately NOT evidence — rice, corn and quinoa live " +
      "there. Oats are gluten-free grain but standard celiac guidance is certified-GF oats " +
      "only; that call is left to the existing list, unchanged.",
  },
  { key: "barley", parent: "gluten", label: "Barley", tier: TIER_COMMON, synonyms: ["pearl barley", "barley malt"], nameKeywords: ["barley"] },
  { key: "rye", parent: "gluten", label: "Rye", tier: TIER_COMMON, synonyms: ["rye bread", "pumpernickel"], nameKeywords: ["rye", "pumpernickel"] },
  { key: "malt", parent: "gluten", label: "Malt", tier: TIER_COMMON, synonyms: ["malt extract", "malted barley", "maltodextrin from barley"], nameKeywords: ["malt", "malted"] },
  { key: "brewers yeast", parent: "gluten", label: "Brewer's yeast", tier: TIER_RARE, synonyms: ["brewer's yeast", "brewer yeast"], nameKeywords: ["brewers yeast", "brewer's yeast"] },
  { key: "seitan", parent: "gluten", label: "Seitan (wheat gluten)", tier: TIER_COMMON, synonyms: ["wheat gluten", "vital wheat gluten"], nameKeywords: ["seitan", "wheat gluten"] },

  {
    key: "fish",
    label: "Fish (finned)",
    tier: TIER_MAJOR,
    family: "fish",
    synonyms: ["finfish", "fish free", "seafood"],
    nameKeywords: [
      "sturgeon", "shad", "croaker", "cisco", "burbot", "cusk", "roughy",
      "wolffish", "sablefish", "lingcod", "sucker", "stingray", "shark",
      "bouillabaisse", "lutefisk", "gravlax", "lox", "nam pla", "garum",
      "anchovy paste", "fish stick", "fish finger", "fishcake", "kedgeree",
    ],
    fdcCategories: ["Finfish and Shellfish Products", "Fish", "Seafood mixed dishes", "Seafood sandwiches"],
    offTags: ["fish"],
    note:
      "'seafood' is a SYNONYM (what a user types) but bare 'seafood' is deliberately not a " +
      "shellfish KEYWORD — a haddock kedgeree is seafood and is not shellfish.",
  },
  {
    key: "shellfish",
    label: "Shellfish (all)",
    tier: TIER_MAJOR,
    family: "shellfish",
    synonyms: ["shell fish", "shellfish free"],
    nameKeywords: ["bouillabaisse", "seafood boil", "paella mixta"],
    fdcCategories: ["Finfish and Shellfish Products", "Shellfish", "Seafood mixed dishes"],
    offTags: ["crustaceans", "molluscs", "mollusks", "shellfish"],
  },
  {
    key: "crustaceans", parent: "shellfish", label: "Crustacean shellfish", tier: TIER_MAJOR,
    synonyms: ["crustacean", "shrimp", "prawn", "prawns", "crab", "lobster", "crayfish", "crawfish", "langoustine", "scampi", "krill"],
    nameKeywords: ["crustacean", "langostino", "krill", "barnacle", "shrimp paste", "crawdad"],
    offTags: ["crustaceans"],
  },
  {
    key: "molluscs", parent: "shellfish", label: "Molluscan shellfish", tier: TIER_MAJOR,
    synonyms: ["mollusc", "mollusk", "mollusks", "snail", "escargot", "urchin", "sea urchin", "clam", "mussel", "oyster", "scallop", "squid", "octopus"],
    nameKeywords: ["mollusc", "mollusk", "snail", "escargot", "urchin", "periwinkle", "limpet", "geoduck", "winkle", "oyster sauce"],
    offTags: ["molluscs", "mollusks"],
    note: "Cephalopods (squid/octopus/cuttlefish) and gastropods are molluscs — the 2026 Stage-C audit found them entirely absent.",
  },
  {
    key: "seafood",
    label: "Seafood (fish + shellfish)",
    tier: TIER_MAJOR,
    family: "fish",
    includes: ["fish", "shellfish"],
    synonyms: ["sea food", "fish and shellfish", "all seafood", "no seafood"],
    nameKeywords: ["seafood"],
    note:
      "An UMBRELLA row: its keyword list is the UNION of fish and shellfish at merge time, so " +
      "it can never drift from either. Measured 2026-07-24 (agent 07): typing 'seafood' removed " +
      "3 of 889 recipes and a White Fish still shipped. `family` is 'fish' because a single " +
      "family is all the tag/category probes can carry — the NAME probe covers both.",
  },
  {
    key: "sesame",
    label: "Sesame",
    tier: TIER_MAJOR,
    family: "sesame",
    synonyms: ["sesame seed", "sesame seeds", "tahini", "benne", "gingelly", "til", "sesame free"],
    nameKeywords: ["sesame oil", "zaatar", "za'atar", "goma", "simsim"],
    offTags: ["sesame-seeds", "sesame"],
  },

  // ══ COMMON, NOT REGULATED AS A MAJOR ════════════════════════════════════
  {
    key: "corn",
    label: "Corn / maize",
    tier: TIER_COMMON,
    family: "corn",
    synonyms: ["maize", "corn free", "corn allergy", "zein"],
    nameKeywords: [
      "corn", "maize", "cornmeal", "cornflour", "cornstarch", "corn starch",
      "corn syrup", "cornbread", "cornflake", "corn flake", "popcorn", "polenta",
      "grits", "hominy", "masa", "corn tortilla", "corn chip", "nacho",
    ],
    offTags: [],
    note: "'corn' is word-boundary matched, so 'corned beef' does not fire; 'popcorn'/'cornbread' need their own entries for the same reason.",
  },
  {
    key: "nightshades",
    label: "Nightshades",
    tier: TIER_COMMON,
    family: "nightshade",
    synonyms: ["nightshade", "solanaceae", "solanine"],
    nameKeywords: [
      "potato", "tomato", "tomatillo", "eggplant", "egg plant", "aubergine",
      "bell pepper", "capsicum", "chili", "chilli", "chile", "jalapeno",
      "jalapeño", "paprika", "cayenne", "pimento", "pimiento", "poblano",
      "serrano", "habanero", "chipotle", "ancho", "goji", "wolfberry",
      "ashwagandha", "ketchup", "marinara", "salsa",
    ],
    note:
      "SWEET potato is not a nightshade (Convolvulaceae) and is guarded out in dietaryFilter. " +
      "Black pepper is not a nightshade either, which is why bare 'pepper' is absent and only " +
      "the capsicum forms are listed.",
  },
  {
    key: "alliums",
    label: "Alliums (onion & garlic)",
    tier: TIER_COMMON,
    family: "allium",
    synonyms: ["allium", "onion", "garlic", "onion and garlic", "fodmap alliums"],
    nameKeywords: ["onion", "garlic", "leek", "shallot", "chive", "scallion", "spring onion", "green onion", "allium", "ramps"],
  },
  {
    key: "legumes",
    label: "Legumes / pulses",
    tier: TIER_COMMON,
    family: "legume",
    synonyms: ["legume", "pulses", "pulse", "bean allergy"],
    nameKeywords: [
      "bean", "lentil", "chickpea", "garbanzo", "pea", "soy", "soya", "tofu",
      "tempeh", "edamame", "peanut", "lupin", "fava", "broad bean", "mung",
      "adzuki", "pinto", "black eyed pea", "split pea", "hummus", "houmous",
      "dal", "dhal", "miso", "carob",
    ],
    note: "Peanuts and soy are legumes and are intentionally listed here as well as in their own rows.",
  },
  {
    key: "buckwheat",
    label: "Buckwheat",
    tier: TIER_COMMON,
    family: "buckwheat",
    synonyms: ["soba", "kasha", "groats"],
    nameKeywords: ["buckwheat", "soba", "kasha"],
    note: "Buckwheat is NOT a wheat and NOT gluten — it is its own allergen, significant in Japan and Korea.",
  },
  {
    key: "msg",
    label: "MSG / glutamate",
    tier: TIER_COMMON,
    family: "msg",
    synonyms: ["monosodium glutamate", "glutamate", "e621", "msg sensitivity", "chinese restaurant syndrome"],
    nameKeywords: ["msg", "monosodium glutamate", "glutamate", "e621", "yeast extract", "autolyzed yeast", "autolysed yeast", "hydrolyzed vegetable protein", "hydrolysed vegetable protein"],
    note: "Not an IgE allergy — a self-reported sensitivity. Included because the audit measured users typing it and getting zero protection.",
  },
  {
    key: "red meat",
    label: "Red meat (alpha-gal)",
    tier: TIER_COMMON,
    family: "red-meat",
    synonyms: ["alpha gal", "alpha-gal", "alphagal", "mammalian meat", "mammal meat", "beef allergy", "pork allergy", "tick bite meat allergy"],
    nameKeywords: [
      "beef", "pork", "lamb", "mutton", "veal", "venison", "goat", "bison",
      "buffalo", "elk", "moose", "caribou", "rabbit", "boar", "steak", "sirloin",
      "brisket", "oxtail", "mince", "meatball", "bacon", "ham", "gammon",
      "sausage", "salami", "pepperoni", "chorizo", "prosciutto", "pancetta",
      "bologna", "liverwurst", "pastrami", "jerky", "lard", "tallow", "suet",
      "gelatin", "gelatine", "ground beef", "hamburger",
    ],
    note:
      "Alpha-gal is a carbohydrate on non-primate MAMMAL tissue, so it covers mammalian meat, " +
      "mammalian fats and gelatin — but not poultry and not fish. Severe cases also react to " +
      "dairy; that is a separate box, not folded in here.",
  },

  // ══ RARE — the owner asked for these explicitly ═════════════════════════
  {
    key: "lupin",
    label: "Lupin",
    tier: TIER_RARE,
    family: "lupin",
    synonyms: ["lupine", "lupini", "lupin flour", "lupin bean"],
    nameKeywords: ["lupin", "lupine", "lupini"],
    offTags: ["lupin"],
    note: "EU-declarable. Cross-reacts strongly with peanut; common in gluten-free bakery flour blends.",
  },
  {
    key: "mustard",
    label: "Mustard",
    tier: TIER_RARE,
    family: "mustard",
    synonyms: ["dijon", "mustard seed", "wholegrain mustard", "english mustard", "mustard powder"],
    nameKeywords: ["mustard", "dijon", "kasundi"],
    fdcCategories: [],
    offTags: ["mustard"],
  },
  {
    key: "celery",
    label: "Celery / celeriac",
    tier: TIER_RARE,
    family: "celery",
    synonyms: ["celeriac", "celery salt", "celery seed", "celery root"],
    nameKeywords: ["celery", "celeriac"],
    offTags: ["celery"],
  },
  {
    key: "sulphites",
    label: "Sulphites (E220–E228)",
    tier: TIER_RARE,
    family: "sulphites",
    synonyms: ["sulphite", "sulfite", "sulfites", "sulphur dioxide", "sulfur dioxide", "e220", "metabisulphite", "metabisulfite"],
    nameKeywords: ["sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide", "e220", "metabisulphite", "metabisulfite"],
    offTags: ["sulphur-dioxide-and-sulphites", "sulphites", "sulfites"],
    note:
      "HONEST LIMIT: sulphites are almost never in a food NAME. Until allergenTags/mayContain " +
      "are populated (barcode import only), this key protects a coeliac-grade zero. The UI must " +
      "say so rather than imply protection — audit agent 07, finding F4.",
  },
  {
    key: "kiwi",
    label: "Kiwi fruit",
    tier: TIER_RARE,
    family: "kiwi",
    synonyms: ["kiwifruit", "kiwi fruit", "chinese gooseberry", "actinidia"],
    nameKeywords: ["kiwi", "kiwifruit", "chinese gooseberry"],
  },
  {
    key: "latex fruit",
    label: "Latex-fruit syndrome",
    tier: TIER_RARE,
    family: "latex-fruit",
    synonyms: ["latex", "latex allergy", "latex fruit syndrome", "banana avocado kiwi"],
    nameKeywords: ["banana", "plantain", "avocado", "kiwi", "kiwifruit", "chestnut", "papaya", "fig", "passion fruit", "guacamole"],
    note: "The latex cross-reactive fruit set. Kiwi and chestnut appear in their own rows too; that overlap is intentional.",
  },
  {
    key: "sunflower",
    label: "Sunflower seed",
    tier: TIER_RARE,
    family: "sunflower",
    synonyms: ["sunflower seed", "sunflower seeds", "sunflower butter", "sunbutter", "helianthus"],
    nameKeywords: ["sunflower"],
  },
  {
    key: "poppy seed",
    label: "Poppy seed",
    tier: TIER_RARE,
    family: "poppy",
    synonyms: ["poppy", "poppyseed", "poppy seeds"],
    nameKeywords: ["poppy"],
  },
  {
    key: "mango",
    label: "Mango (urushiol)",
    tier: TIER_RARE,
    family: "mango",
    synonyms: ["urushiol", "mango skin", "poison ivy cross reaction"],
    nameKeywords: ["mango", "amchur"],
    note:
      "Mango skin carries urushiol — the poison-ivy compound — which also occurs in cashew and " +
      "pistachio SHELLS. Those two are NOT added as keywords here: a urushiol-sensitive user who " +
      "also reacts to them should tick tree nuts, and folding them in would silently delete two " +
      "whole species for everyone who typed 'mango'.",
  },
  {
    key: "cinnamon",
    label: "Cinnamon",
    tier: TIER_RARE,
    family: "cinnamon",
    synonyms: ["cassia", "cinnamon allergy", "ceylon cinnamon"],
    nameKeywords: ["cinnamon", "cassia", "snickerdoodle"],
  },
  {
    key: "spices",
    label: "Spices (general)",
    tier: TIER_RARE,
    family: "spice",
    synonyms: ["spice", "spice allergy", "seasoning", "spice blend"],
    nameKeywords: [
      "spice", "seasoning", "curry powder", "chili powder", "garam masala",
      "five spice", "ras el hanout", "berbere", "harissa", "cumin", "coriander",
      "turmeric", "fenugreek", "cardamom", "caraway", "anise", "paprika",
    ],
    note:
      "A blunt instrument by nature — 'spice allergy' is usually to one or two specific spices. " +
      "The UI should encourage naming the actual spice; this row exists so the term is never " +
      "silently inert.",
  },
];

// ════════════════════════════════════════════════════════════════════════════
// TERM NORMALISATION — audit agent 07, findings F1 + F2
// ════════════════════════════════════════════════════════════════════════════
// Measured 2026-07-24 against the real 889-recipe pool: `cow's milk`,
// `dairy-free`, `gluten free`, `lactose-intolerant`, `no dairy`, `dairies`,
// `dairy!`, `milk allergy`, `nut allergy`, `MSG`, `red meat`, `nightshades` and
// a dozen more each excluded **0 of 889 recipes**, because term resolution
// normalised with `trim().toLowerCase()` and nothing else.
//
// The giveaway that this was an accident, not a policy: `lactose intolerance`
// and `coeliac` WERE aliases while `lactose-intolerant` and `gluten free` were
// not. Same user, same sentence, different outcome.
//
// These helpers produce an ORDERED candidate list. The caller tries the raw term
// first (so nothing that resolved before can change), then each candidate.

/** Curly quotes → straight, then drop apostrophes entirely: "cow's" → "cows". */
function stripApostrophes(s) {
  return s.replace(/[‘’ʼ`´']/g, "");
}

/** Punctuation → space, whitespace collapsed. "gluten-free" → "gluten free". */
function normaliseExclusionText(raw) {
  let s = String(raw ?? "");
  try { s = s.normalize("NFKC"); } catch { /* exotic input — keep as-is */ }
  s = stripApostrophes(s.toLowerCase());
  s = s.replace(/[^a-z0-9À-ɏ]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

// Intent wrappers. A user writing the CONSTRAINT ("dairy-free") or the
// DIAGNOSIS ("milk allergy") means the same allergen as one writing the noun.
const LEADING_AFFIXES = [
  "no ", "non ", "not ", "never ", "avoid ", "avoiding ", "without ", "minus ",
  "free of ", "free from ", "anti ", "allergic to ", "allergy to ",
  "intolerant to ", "intolerance to ", "sensitive to ", "sensitivity to ",
  "cant eat ", "cannot eat ", "i cant eat ", "i cannot eat ", "exclude ",
];
const TRAILING_AFFIXES = [
  " free", " allergy", " allergies", " allergic", " intolerant", " intolerance",
  " intolerances", " sensitivity", " sensitivities", " sensitive", " reaction",
  " reactions", " anaphylaxis", " avoidance", " avoid", " excluded", " exclusion",
];

/** Peel intent wrappers until stable. "no gluten free" → "gluten". */
function stripIntentAffixes(text) {
  let s = text;
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const a of LEADING_AFFIXES) {
      if (s.startsWith(a) && s.length > a.length) { s = s.slice(a.length).trim(); changed = true; }
    }
    for (const a of TRAILING_AFFIXES) {
      if (s.endsWith(a) && s.length > a.length) { s = s.slice(0, -a.length).trim(); changed = true; }
    }
  }
  return s;
}

/** Singularise the LAST word only: "dairies"→"dairy", "nightshades"→"nightshade". */
function singularise(text) {
  const parts = text.split(" ");
  const last = parts[parts.length - 1];
  if (!last || last.length < 4) return text;
  let s = last;
  if (/[^aeiou]ies$/.test(last)) s = last.slice(0, -3) + "y";
  else if (/(ses|xes|zes|ches|shes)$/.test(last)) s = last.slice(0, -2);
  else if (/[^s]s$/.test(last)) s = last.slice(0, -1);
  if (s === last) return text;
  parts[parts.length - 1] = s;
  return parts.join(" ");
}

/**
 * Ordered, de-duplicated normalisation candidates for a user-typed term.
 * The raw lowercase form is ALWAYS first, so a term that already resolved keeps
 * resolving exactly as it did — this can only add matches, never remove one.
 */
function exclusionTermCandidates(raw) {
  const out = [];
  const push = (s) => { if (s && !out.includes(s)) out.push(s); };
  const lower = String(raw ?? "").trim().toLowerCase();
  push(lower);
  const normalised = normaliseExclusionText(raw);
  push(normalised);
  push(singularise(normalised));
  const stripped = stripIntentAffixes(normalised);
  push(stripped);
  push(singularise(stripped));
  // "dairy free products" → "dairy free" → "dairy": affix-strip AFTER singularising
  push(stripIntentAffixes(singularise(stripped)));
  // ORDER IS LOAD-BEARING: least-normalised first (so a term that already
  // resolved keeps resolving), most-normalised LAST — callers that fall through
  // to a literal grep take the last entry as "what the user probably meant".
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// INDEXES
// ════════════════════════════════════════════════════════════════════════════

const ALLERGEN_BY_KEY = Object.create(null);
for (const e of ALLERGEN_TAXONOMY) ALLERGEN_BY_KEY[e.key] = e;

/** Rows that own a category (no parent). */
const TOP_LEVEL_ALLERGENS = ALLERGEN_TAXONOMY.filter((e) => !e.parent);

/** The category a row resolves to: itself, or its parent. */
function categoryKeyOf(entry) {
  return entry.parent || entry.key;
}

/**
 * normalised search term → category key. Built from every key, label and
 * synonym in the table (children resolve to their parent).
 */
const ALLERGEN_TERM_INDEX = Object.create(null);
for (const e of ALLERGEN_TAXONOMY) {
  const target = categoryKeyOf(e);
  for (const term of [e.key, e.label, ...(e.synonyms || [])]) {
    const n = normaliseExclusionText(term);
    if (n && !ALLERGEN_TERM_INDEX[n]) ALLERGEN_TERM_INDEX[n] = target;
  }
}

/**
 * UI lookup: search the taxonomy by label OR synonym. Returns entries ranked
 * exact → prefix → substring, so a search box can render as-you-type.
 * An empty query returns the whole catalogue in tier order.
 */
function searchAllergens(query, options = {}) {
  const limit = options.limit || 25;
  const q = normaliseExclusionText(query);
  const base = (options.includeSpecies === false ? TOP_LEVEL_ALLERGENS : ALLERGEN_TAXONOMY).filter((e) => !e.hidden);
  const catalogue = base;
  if (!q) return catalogue.slice(0, limit).map(publicShape);
  const scored = [];
  for (const e of catalogue) {
    const haystacks = [e.key, e.label, ...(e.synonyms || [])].map(normaliseExclusionText);
    let best = Infinity;
    for (const h of haystacks) {
      if (!h) continue;
      if (h === q) best = Math.min(best, 0);
      else if (h.startsWith(q)) best = Math.min(best, 1);
      else if (h.includes(q)) best = Math.min(best, 2);
      else if (q.includes(h)) best = Math.min(best, 3);
    }
    if (best < Infinity) scored.push([best, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
  return scored.slice(0, limit).map(([, e]) => publicShape(e));
}

/** The shape the UI/meta route should render. No matcher internals leak out. */
function publicShape(e) {
  return {
    key: e.key,
    label: e.label,
    tier: e.tier,
    parent: e.parent || null,
    categoryKey: categoryKeyOf(e),
    family: e.family || (e.parent ? (ALLERGEN_BY_KEY[e.parent] || {}).family : null) || null,
    synonyms: [...(e.synonyms || [])],
    note: e.note || null,
  };
}

/** The whole table in UI shape (tier order preserved as authored). */
function allergenCatalog() {
  return ALLERGEN_TAXONOMY.filter((e) => !e.hidden).map(publicShape);
}

/**
 * Resolve a user-typed term against the taxonomy alone (dietaryFilter layers
 * its own legacy maps on top of this — see resolveExclusionTerm there).
 * Returns { key, matchedAs, categoryKey, entry } or null.
 */
function resolveTaxonomyTerm(raw) {
  for (const cand of exclusionTermCandidates(raw)) {
    const target = ALLERGEN_TERM_INDEX[normaliseExclusionText(cand)];
    if (target) return { key: target, matchedAs: cand, categoryKey: target, entry: ALLERGEN_BY_KEY[target] || null };
  }
  return null;
}

module.exports = {
  ALLERGEN_TAXONOMY,
  ALLERGEN_BY_KEY,
  ALLERGEN_TERM_INDEX,
  TOP_LEVEL_ALLERGENS,
  TIER_MAJOR,
  TIER_COMMON,
  TIER_RARE,
  categoryKeyOf,
  publicShape,
  allergenCatalog,
  searchAllergens,
  resolveTaxonomyTerm,
  // normalisation (shared with dietaryFilter.resolveExclusionTerm)
  normaliseExclusionText,
  stripIntentAffixes,
  singularise,
  exclusionTermCandidates,
  LEADING_AFFIXES,
  TRAILING_AFFIXES,
};
