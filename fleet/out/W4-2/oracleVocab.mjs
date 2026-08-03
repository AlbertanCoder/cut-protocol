// ═══════════════════════════════════════════════════════════════════════════
// W4-2 INDEPENDENT ALLERGEN ORACLE — VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════
//
// PROVENANCE OF THIS LIST (this is the whole point of the file):
// It was authored on 2026-08-02 by W4-2 from culinary/food-science knowledge —
// Health Canada priority allergens, FDA Big-9, restaurant/menu practice, and
// non-English + regional ingredient names — WITHOUT reading
// `backend/src/lib/dietaryFilter.js` or `backend/src/lib/allergenTaxonomy.js`
// first. It deliberately over-weights the terms an English-keyword filter is
// structurally likely to LACK: transliterations (tahina/tehina, besan, dhania,
// kacang), processed carriers that name no allergen (surimi, kamaboko,
// worcestershire, dashi, XO sauce), dish names that imply an ingredient
// (falafel→sesame, caesar→anchovy+egg, wonton→egg+wheat), and the
// cross-reactive families (lupin↔peanut).
//
// WHY THAT MATTERS: a sweep built from the filter's own term list can only
// detect DISAGREEMENT between two copies of the same vocabulary. It can never
// detect a MISSING WORD, which is the only failure mode that has ever actually
// shipped here (`tahina`, bare `Coriander`, `Wonton Skin`). Overlap between
// this list and the app's is measured, not avoided — see
// `independence.json`, emitted by lawsweep.mjs.
//
// STRENGTH LADDER (used for triage, never for suppression):
//   certain  — the term names the allergen or a food that always contains it
//   standard — commercial/culinary default; a specific recipe could omit it
//   advisory — cross-contamination, botanical adjacency, or variable sourcing
//
// Matching contract: `re` is applied to lowercased text. Single words carry
// \b and optional plural; guards are expressed as lookbehind/lookahead inside
// the regex so a hit is suppressed at match time, not by post-filtering.

export const ORACLE_VERSION = "W4-2/oracle/v1 (2026-08-02)";

export const ORACLE = {
  dairy: [
    { re: /(?<!coconut |almond |soy |soya |oat |rice |cashew |hemp |flax |pea |nut |hazelnut |macadamia |walnut |seed |plant )\bmilks?\b/, s: "certain" },
    { re: /\bbutter\b(?<!peanut butter)(?<!nut butter)(?<!cocoa butter)(?<!shea butter)(?<!apple butter)(?<!almond butter)(?<!cashew butter)(?<!seed butter)(?<!sunflower butter)(?<!body butter)(?!\s*(?:beans?|nut|head|fly|milk squash))/, s: "certain" },
    { re: /\bbuttermilk\b/, s: "certain" },
    { re: /\bghee\b|\bsmen\b|\bniter kibbeh\b/, s: "certain" },
    { re: /(?<!vegan |plant |cashew |nut |soy |almond )\bcheeses?\b/, s: "certain" },
    { re: /\b(cheddar|mozzarella|parmesan|parmigiano|reggiano|pecorino|romano|gouda|edam|brie|camembert|feta|halloumi|haloumi|ricotta|mascarpone|gruyere|gruyère|emmental|emmenthal|provolone|asiago|manchego|queso|cotija|boursin|stilton|roquefort|gorgonzola|jarlsberg|monterey jack|colby|havarti|paneer|panir|quark|labneh|labaneh|skyr|kefir|mizithra|kasseri|taleggio|fontina|raclette|burrata|halloom)\b/, s: "certain" },
    { re: /\b(yogh?urts?|yoghourt)\b/, s: "certain" },
    { re: /(?<!coconut |cashew |oat |soy |sour )\bcreams?\b(?!\s*of\s*tartar)/, s: "certain" },
    { re: /\b(creme fraiche|crème fraîche|smetana|crema|clotted cream|double cream|heavy cream|half and half|condensed milk|evaporated milk|dulce de leche|khoa|khoya|mawa|malai|rabri|kulfi)\b/, s: "certain" },
    { re: /\b(whey|casein|caseinate|caseinates|lactose|lactalbumin|lactoglobulin|milk solids|milk powder|milk protein|curds?)\b/, s: "certain" },
    { re: /\b(custard|tiramisu|cheesecake|panna cotta|gelato|ice cream|milkshake|alfredo|bechamel|béchamel|au gratin|gratin|tzatziki|tzaziki|raita|lassi|ayran|doogh|horchata de arroz|creme brulee|crème brûlée|flan|dulce)\b/, s: "standard" },
    { re: /\b(latte|cappuccino|macchiato|mocha)\b/, s: "standard" },
    { re: /\b(scalloped potatoes|mac and cheese|macaroni and cheese|queso fresco|nacho)\b/, s: "standard" },
    { re: /\b(milk chocolate|white chocolate|butterscotch|toffee|fudge|caramel sauce)\b/, s: "standard" },
    { re: /\b(pierogi|perogi|perogies|pierogies|blintz|kaiserschmarrn|naan|garlic bread)\b/, s: "advisory" },
  ],
  // sheep/goat carve-out for the one free-text persona lives in lawsweep.mjs
  cowSpecificDairy: [
    { re: /\b(sheep|ewe|goat|chevre|chèvre|caprino|pecorino|feta|halloumi|haloumi|manchego|roquefort|mizithra|kasseri)\b/, s: "exempt" },
  ],
  eggs: [
    { re: /\beggs?\b(?!\s*plants?)(?<!egg plant)/, s: "certain" },
    { re: /\b(egg white|egg yolk|albumen|albumin|ovalbumin|ovomucoid|lysozyme|meringue|eggnog|egg noodle|egg wash)\b/, s: "certain" },
    { re: /\b(mayonnaise|mayo|aioli|aïoli|hollandaise|bearnaise|béarnaise|remoulade|rémoulade|tartar sauce|caesar dressing|caesar salad)\b/, s: "certain" },
    { re: /\b(omelett?es?|frittata|quiche|shakshuka|shakshouka|huevos|oeufs?|tamago|tamagoyaki|century egg|souffl[ée]|pavlova|zabaglione|carbonara)\b/, s: "certain" },
    { re: /\b(wonton|won ton|wontons|gyoza wrapper|dumpling wrapper|lo mein|ramen noodle)\b/, s: "standard" },
    { re: /\b(brioche|challah|macarons?|financiers?|madeleine|angel food|meringues?|marshmallow fluff|custard|flan|creme brulee|crème brûlée|tiramisu|hollandaise)\b/, s: "standard" },
    { re: /\b(surimi|kamaboko|imitation crab|fish cake|fishcake|narutomaki)\b/, s: "standard" },
    { re: /\b(schnitzel|katsu|tempura|breaded|panko-crusted|meatloaf|meatballs?|falafel)\b/, s: "advisory" },
    { re: /\b(pasta all'uovo|fresh pasta|tagliatelle|fettuccine|pappardelle)\b/, s: "advisory" },
  ],
  peanuts: [
    { re: /\bpeanuts?\b/, s: "certain" },
    { re: /\b(ground ?nuts?|arachis|monkey nuts?|goober|mani|cacahuete|cacahuète|kacang|pindakaas|pb2|peanut butter|beer nuts?)\b/, s: "certain" },
    // Health Canada: every peanut-allergic consumer should avoid lupin.
    // 5-37% cross-reactivity; lupin is not a Canadian priority allergen so the
    // package carries no warning either.
    { re: /\b(lupins?|lupini|lupine|lupinus|altramuces|tremoços|tremocos)\b/, s: "certain", note: "peanut cross-reactant (Health Canada advisory)" },
    { re: /\b(satay|sate sauce|gado ?gado|kung pao|pad thai|bun bo xao|nasi goreng|romesco)\b/, s: "standard" },
    { re: /\b(mixed nuts?|trail mix|granola bar|nut mix)\b/, s: "advisory" },
  ],
  "tree nuts": [
    { re: /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|filberts?|macadamias?|brazil nuts?|pine ?nuts?|pignoli|pinon|piñon|chestnuts?|marron|beechnut|hickory nut|butternuts?|shea nut)\b/, s: "certain" },
    { re: /\b(badam|kaju|akhrot|pista|mandeln|noisette|nocciola|mandorla|nuez|avellana)\b/, s: "certain" },
    { re: /\b(marzipan|frangipane|praline|prali?n[ée]s?|gianduja|nutella|amaretti|amaretto|orgeat|nougat|torrone|turr[óo]n|baklava|dukkah|dukka|pesto|romesco|nut butter|almond flour|almond meal|nut milk|almond milk|cashew cream|cashew cheese)\b/, s: "certain" },
    { re: /\b(mortadella|waldorf|financiers?|macarons?|halva)\b/, s: "standard" },
    { re: /\b(coconuts?|coconut milk|coconut cream|coconut oil)\b/, s: "advisory", note: "FDA classifies coconut as a tree nut; most clinical guidance does not" },
    { re: /\b(mixed nuts?|trail mix|muesli|granola|nut mix|nuts)\b/, s: "advisory" },
  ],
  shellfish: [
    { re: /\b(shrimps?|prawns?|crabs?|lobsters?|crayfish|crawfish|langoustines?|scampi|krill|yabby|moreton bay bug)\b/, s: "certain" },
    { re: /\b(clams?|mussels?|oysters?|scallops?|abalone|cockles?|whelks?|periwinkles?|geoduck|razor shell)\b/, s: "certain" },
    { re: /\b(squid|calamari|calamares|octopus|pulpo|snails?|escargots?)\b/, s: "certain" },
    { re: /\b(surimi|kamaboko|imitation crab|krab|seafood stick|crab stick|kani)\b/, s: "certain" },
    { re: /\b(ebi|tako|ika|hotate|amaebi|gambas|camarones|langosta|jaiba)\b/, s: "certain" },
    { re: /\b(shrimp paste|belacan|belachan|terasi|kapi|bagoong|xo sauce|oyster sauce|hae ko|patis)\b/, s: "certain" },
    { re: /\b(paella|jambalaya|cioppino|bouillabaisse|tom yum|laksa|gumbo|seafood|frutti di mare|marinara sauce with seafood|kimchi)\b/, s: "standard" },
  ],
  fish: [
    { re: /\bfish\b|\bfishes\b/, s: "certain" },
    { re: /\b(salmon|tuna|cod|haddock|halibut|tilapia|trout|mackerel|sardines?|pilchards?|anchov(?:y|ies)|herrings?|kippers?|sprats?|snapper|barramundi|pollock|pollack|catfish|sole|plaice|monkfish|swordfish|bass|bream|mahi|hake|whiting|turbot|eel|unagi|anago|shishamo)\b/, s: "certain" },
    { re: /\b(roe|caviar|ikura|tobiko|masago|bottarga|taramasalata|lox|gravlax|gravadlax|brandade|kedgeree|surimi|kamaboko|imitation crab)\b/, s: "certain" },
    { re: /\b(bonito|katsuobushi|dashi|hondashi|nam pla|nuoc mam|nước mắm|fish sauce|garum|colatura|worcestershire|worcester sauce|caesar dressing|caesar salad|puttanesca|xo sauce)\b/, s: "certain", note: "hidden fish carrier — names no fish" },
    { re: /\b(ceviche|sashimi|poke bowl|nicoise|niçoise|fish and chips|fishcake|fish cake|bagna cauda)\b/, s: "standard" },
    { re: /\b(kimchi|banh mi|pad thai|som tam|omega-3|fish oil)\b/, s: "advisory" },
  ],
  gluten: [
    { re: /\b(wheat|wheaten|whole ?wheat|wheatgerm|wheat germ|wheat bran|atta|maida|farina|graham)\b/, s: "certain" },
    { re: /\b(barley|malt|malted|maltose|rye|triticale|spelt|farro|emmer|einkorn|kamut|khorasan|freekeh|frikeh|bulgur|burghul|semolina|semolina flour|durum|couscous|seitan|fu gluten|vital wheat gluten|gluten flour)\b/, s: "certain" },
    { re: /(?<!gluten[- ]free )(?<!rice )(?<!chickpea )(?<!lentil )(?<!corn )(?<!buckwheat )(?<!almond )(?<!coconut )(?<!cassava )(?<!quinoa )\b(flour|breads?|pastas?|noodles?|spaghetti|macaroni|penne|fusilli|rigatoni|linguine|fettuccine|tagliatelle|lasagn[ae]|orzo|udon|somen|ramen|vermicelli)\b/, s: "certain" },
    { re: /\b(panko|breadcrumbs?|bread crumbs?|croutons?|cracker|crackers|biscuits?|pastry|filo|phyllo|puff pastry|pie crust|pizza dough|baguette|ciabatta|focaccia|brioche|challah|croissant|bagel|pretzel|matzo|matzah|matzoh|pita|naan|roti|chapati|paratha|tortilla wrap|flour tortilla|dumpling wrapper|wonton|gyoza|spring roll wrapper|scone|muffin|pancake|waffle|crumpet|yorkshire pudding)\b/, s: "certain" },
    { re: /\b(soy sauce|shoyu|teriyaki|hoisin|oyster sauce|black bean sauce|miso|mirin seasoning|beer|ale|lager|stout|malt vinegar|seitan)\b/, s: "certain", note: "hidden wheat carrier — names no grain" },
    { re: /\b(soba|oats?|oatmeal|porridge|rolled oats|granola|muesli|couscous|bran)\b/, s: "advisory" },
    { re: /\b(schnitzel|katsu|tempura|breaded|batter|roux|gravy|stuffing|meatloaf|falafel|dumpling)\b/, s: "advisory" },
  ],
  soy: [
    { re: /\b(soy|soya|soybeans?|soja|soy sauce|shoyu|tamari|soy lecithin|soybean oil|soy protein|tvp|textured vegetable protein|edamame|mukimame)\b/, s: "certain" },
    { re: /\b(tofu|dofu|doufu|bean ?curd|yuba|tofu skin|okara|tempeh|tempe|natto|nattō)\b/, s: "certain" },
    { re: /\b(miso|doenjang|gochujang|douchi|tauco|kecap manis|ponzu|teriyaki|hoisin|black bean sauce|sriracha mayo|worcestershire)\b/, s: "certain", note: "soy-containing condiment" },
    { re: /\b(vegetable oil|margarine|vegetable broth|bouillon|mock duck|veggie burger|meat alternative|plant-based patty)\b/, s: "advisory" },
  ],
  sesame: [
    { re: /\b(sesames?|sesame seeds?|sesame oil|toasted sesame|benne|gingelly|til seeds?|simsim|ajonjol[ií]|goma|gomashio|gomasio|furikake)\b/, s: "certain" },
    { re: /\b(tahini|tahina|tehina|t'?hina|ardeh)\b/, s: "certain", note: "the exact word an English keyword list has historically missed" },
    { re: /\b(halva|halvah|halwa|za'?atar|zaatar|dukkah|dukka|hummus|houmous|hommus|baba ?gh?anoush|baba ?ganouj|falafel|shawarma|everything bagel|bagel seasoning|burger bun|brioche bun|sesame ball|jian dui|nan khatai)\b/, s: "standard" },
    { re: /\b(tiger sauce|kung pao|bang bang|korean bbq|bibimbap|japchae|smashburger sauce)\b/, s: "advisory" },
  ],
  nightshades: [
    { re: /\b(tomato(?:es)?|tomatillos?|passata|marinara|ketchup|pomodoro|sugo|arrabbiata|puttanesca|salsa|pico de gallo|sun-?dried tomato)\b/, s: "certain" },
    { re: /(?<!sweet )\bpotato(?:es)?\b/, s: "certain" },
    { re: /\b(eggplants?|aubergines?|brinjal|baingan|melanzane)\b/, s: "certain" },
    { re: /\b(bell peppers?|red peppers?|green peppers?|yellow peppers?|chill?ies?|chill?i|chile|chiles|jalape[nñ]os?|habanero|serrano|poblano|ancho|chipotle|cayenne|paprika|piment[oó]n|pimento|pimiento|capsicum|aji|guajillo|scotch bonnet|birds? eye chili|padr[oó]n|shishito|banana pepper|peperoncini|pepperoncini)\b/, s: "certain" },
    { re: /\b(sriracha|siracha|harissa|gochujang|gochugaru|sambal|piri ?piri|peri ?peri|tabasco|hot sauce|chili oil|chili crisp|chili powder|curry paste|romesco|adobo sauce|enchilada sauce|taco seasoning|cajun seasoning|creole seasoning|old bay|berbere|shakshuka|guacamole|nacho|chorizo|goulash|ratatouille|caponata)\b/, s: "certain" },
    { re: /\b(goji|wolfberry|ashwagandha|tomatillo|ground cherry|cape gooseberry|pepino)\b/, s: "standard" },
    { re: /\b(curry|masala|tandoori|jerk|kimchi|bloody mary|steak seasoning|italian seasoning|mixed herbs)\b/, s: "advisory" },
  ],
  legumes: [
    { re: /\b(beans?|lentils?|chickpeas?|garbanzos?|dals?|dahls?|daals?|dhals?|channa|chana|rajma|chole|toor|urad|masoor|moong|mung)\b(?<!vanilla bean)(?<!coffee bean)(?<!cocoa bean)(?<!cacao bean)/, s: "certain" },
    { re: /\b(peas?|split peas?|black-?eyed peas?|pigeon peas?|snow peas?|sugar snap|petits pois)\b/, s: "certain" },
    { re: /\b(soy|soya|soybeans?|tofu|tempeh|natto|edamame|miso|peanuts?|groundnuts?|lupins?|lupini|besan|gram flour|chickpea flour|fava|faba|broad beans?|adzuki|azuki|cannellini|borlotti|pinto|navy beans?|kidney beans?|butter beans?|lima beans?|great northern)\b/, s: "certain" },
    { re: /\b(hummus|houmous|falafel|dal makhani|refried|frijoles|feijoada|cassoulet|minestrone|chana masala|pea protein|carob|locust bean gum|guar gum|fenugreek|liquorice|licorice|tamarind|alfalfa|clover)\b/, s: "standard" },
    { re: /\b(green beans?|string beans?|haricot vert|runner beans?|bean sprouts?)\b/, s: "advisory" },
  ],
  cilantro: [
    // The bare word IS the leaf in this corpus — L1, found by T-2.
    { re: /\b(cilantro|coriander|corianders|fresh coriander|coriander leaf|coriander leaves|dhania|dhaniya|kothmir|chinese parsley|culantro|recao|pak chee)\b/, s: "certain" },
    { re: /\b(pico de gallo|guacamole|salsa verde|chimichurri|pho|banh mi|larb|som tam|ceviche|nam jim|sofrito|green curry|thai basil)\b/, s: "standard" },
  ],
  pork: [
    { re: /\b(porks?|bacons?|hams?|prosciutto|pancetta|guanciale|lardons?|lardo|lard|speck|jam[oó]n|serrano ham|mortadella|capicola|coppa|salami|salame|pepperoni|chorizo|jamon|schinken|char siu|tonkotsu|carnitas|cochinita|chicharr[oó]n|tocino|spam|scrapple|bratwurst|andouille|kielbasa|pulled pork|pork belly|pork loin|pork chop|spare ?ribs|baby back|siu yuk|bak kwa|nduja|'nduja|liverwurst|braunschweiger|head cheese)\b/, s: "certain" },
    { re: /\b(sausages?|hot ?dogs?|frankfurters?|wieners?|bologna|meatballs?|gelatin|gelatine|rennet|bacon bits|refried beans|baked beans|carbonara|katsu|schnitzel|dumplings?|wonton|siu mai|char siu bao)\b/, s: "advisory" },
  ],
  beef: [
    { re: /\b(beef|steaks?|sirloin|ribeye|rib eye|brisket|chuck roast|tenderloin|filet mignon|ground beef|minced beef|hamburgers?|burger patty|veal|oxtail|tripe|corned beef|pastrami|bresaola|carne asada|bulgogi|kalbi|galbi|wagyu|tallow|suet|beef stock|beef broth|beef bouillon|rendang|bistec|roast beef|prime rib|flank steak|skirt steak|short ribs?|shepherds? pie|cottage pie|bolognese|picadillo|birria|barbacoa|pho)\b/, s: "certain" },
    { re: /\b(meatballs?|meatloaf|burgers?|mince|jerky|chili con carne|lasagn[ae]|taco meat|gelatin|gelatine|stock cube|beef flavour|beef flavor)\b/, s: "advisory" },
  ],
};

// Animal-product vocabulary for diet-style checks (vegan / vegetarian).
// Same provenance rule: authored here, not lifted from the app.
export const DIET_ORACLE = {
  meat: /\b(chickens?|beef|steaks?|porks?|bacon|hams?|lambs?|mutton|veal|turkeys?|ducks?|goose|gooses|quail|venison|bison|rabbits?|goat meat|sausages?|salami|pepperoni|prosciutto|chorizo|meatballs?|mince|brisket|sirloin|ribeye|drumsticks?|thighs?|wings?|breast fillet|liver|kidneys?|gizzards?|oxtail|tripe|lard|tallow|suet|gelatin|gelatine|bone broth|chicken stock|beef stock|anchov(?:y|ies))\b/,
  fish: /\b(fish|salmon|tuna|cod|haddock|halibut|tilapia|trout|mackerel|sardines?|anchov(?:y|ies)|herrings?|prawns?|shrimps?|crabs?|lobsters?|squid|calamari|octopus|clams?|mussels?|oysters?|scallops?|surimi|kamaboko|fish sauce|nam pla|dashi|bonito|katsuobushi|worcestershire|caviar|roe)\b/,
  // guards mirror the dairy category: plant milks, nut butters and coconut
  // cream are not animal products and must not fire on a vegan plate
  dairyEgg: /(?<!coconut |almond |soy |soya |oat |rice |cashew |hemp |flax |pea |nut |peanut |cocoa |shea |apple |seed |sunflower |plant )\b(milks?|cheeses?|butter|cream|yogh?urts?|ghee|whey|casein|paneer|eggs?|mayonnaise|mayo|honey|custard|ice cream)\b(?!\s*(?:beans?|nut|head|fly|substitute|alternative|of tartar|plants?))/,
};
