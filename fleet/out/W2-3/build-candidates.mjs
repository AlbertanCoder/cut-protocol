// W2-3 — build fleet/out/W2-3/candidates.json
// Pure computation over sourced macro rows. No DB writes, no network.
// Every FOOD row's macros are transcribed from the cited source URL; every DISH
// row's macros are COMPUTED from those foods (composition stated in the row).
import fs from "node:fs";
import { createRequire } from "node:module";

// The repo's OWN nutrition sanity gate — read-only import, never a reimplementation.
// Note it is 15% OR 10 kcal absolute, which is why low-calorie vegetables with a
// large percentage residual still pass.
const require_ = createRequire(
  "C:/Users/<account>/Desktop/cut-protocol/backend/package.json",
);
const foodValidation = require_("./src/lib/foodValidation.js");

const BOX_P = 8.16; // g protein per 100 kcal, floor
const BOX_F = 2.6; // g fat per 100 kcal, ceiling

// ── provenance tags ───────────────────────────────────────────────────────────
// USDA-VERIFIED : USDA FDC SR Legacy / Foundation — laboratory analysis.
// LABEL         : manufacturer Nutrition Facts panel, incl. USDA FDC "Branded"
//                 (Branded is label transcription submitted by the brand, NOT
//                 USDA lab work — it is LABEL data that happens to have an id).
// AI-ESTIMATED  : not used. Nothing here is unsourced.
const FDC = (id) => `https://fdc.nal.usda.gov/food-details/${id}/nutrients`;

// per-100 g basis unless serving_basis is set
const FOODS = [
  // ══ clears the box ══════════════════════════════════════════════════════════
  {
    key: "lupini_cooked",
    name: "Lupini beans, mature seeds, cooked, boiled, without salt",
    kcal: 119, protein: 15.6, fat: 2.92, carb: 9.88, fiber: 2.8,
    prov: "USDA-VERIFIED", fdcId: 172424, url: FDC(172424),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: "CROSS-REACTIVE", sesame: false, lupin: true },
    snack_shaped: true,
    already_in_db: true,
    cad: "Unico 540 mL jar approx CAD 2.25-2.49 at Loblaws banners",
    cad_url: "https://www.loblaws.ca/en/lupini-beans/p/20109604_EA",
    notes:
      "HIGHEST-DENSITY box-clearing whole food that is genuinely snack-shaped (eaten straight from the jar). " +
      "BUT Health Canada advises ALL peanut-allergic consumers to avoid lupin pending an allergist review " +
      "(5-37% clinical cross-reactivity). Lupin is NOT a Canadian priority allergen, so no 'Contains' statement " +
      "is required on Canadian packages. The 17-persona wall INCLUDES peanuts => this food is CONTRAINDICATED " +
      "for that population unless the gate links peanut -> lupin. Row already exists in dev.db, 0 recipe uses.",
  },
  {
    key: "lupini_cooked_salt",
    name: "Lupini beans, mature seeds, cooked, boiled, with salt",
    kcal: 116, protein: 15.6, fat: 2.92, carb: 9.29, fiber: 2.8,
    prov: "USDA-VERIFIED", fdcId: 173804, url: FDC(173804),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: "CROSS-REACTIVE", sesame: false, lupin: true },
    snack_shaped: true, already_in_db: true,
    notes: "Salted variant — closest USDA analogue to the brined jarred product. Same peanut contraindication.",
  },
  {
    key: "nooch_brm",
    name: "Nutritional yeast, large flake (Bob's Red Mill)",
    kcal: 400, protein: 53.3, fat: 3.33, carb: 33.3, fiber: 20,
    prov: "LABEL", fdcId: 2596118, url: FDC(2596118),
    allergens: { soy: "MAY_CONTAIN", gluten: false, tree_nut: "MAY_CONTAIN", peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    cad: "approx CAD 8.99-10.99 / 127 g (Bragg, Canadian retail)",
    cad_url: "https://naturamarket.ca/bragg-nutritional-yeast-seasoning-127g.html",
    notes:
      "THE density lever. Only cheap, widely-available, soy/gluten/nut/peanut/sesame-free ingredient with ~50%+ " +
      "protein and near-zero fat. Single ingredient ('INACTIVE NUTRITIONAL YEAST'), grown on cane/beet molasses " +
      "=> naturally gluten-free. NOT a protein isolate and NOT in fdcCategory 'Protein and nutritional powders' " +
      "(BRM rows sit in 'Baking Additives & Extracts' / 'Flours & Corn Meal'), so it is outside TRIAGE T-1's " +
      "blocked class — BUT the substring 'nutritional' invites exactly that misfiling; pin fdcCategory explicitly. " +
      "BRAND MATTERS: this BRM listing carries may-contain SOY and TREE NUT; Bulk Barn's bulk-bin flake declares " +
      "'May contain wheat'. Bragg's panel declares free of wheat/soy/milk and is labelled gluten-free — for the " +
      "soy+gluten+nut+sesame wall, specify BRAGG (or an equivalently-declared brand), never bulk-bin.",
  },
  {
    key: "nooch_bragg_bulkbarn_basis",
    name: "Nutritional yeast flakes (Bulk Barn panel basis)",
    kcal: 400, protein: 60, fat: 0, carb: 40, fiber: 20,
    prov: "LABEL", fdcId: null,
    url: "https://www.bulkbarn.ca/en/Products/All/Flaked-Nutritional-Yeast-939",
    allergens: { soy: false, gluten: "MAY_CONTAIN", tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    serving_basis: "panel is per 1 tbsp (5 g): 20 kcal, 3 g protein, 0 g fat, 2 g carb, 1 g fibre; x20 to 100 g",
    notes:
      "Canadian retail panel, included to show the brand spread (0 vs 3.33 g fat/100 g). DO NOT USE for the wall: " +
      "the Bulk Barn listing declares 'May contain wheat'. Bulk bins are a structural cross-contamination risk.",
  },
  {
    key: "seaweed_laver_nori",
    name: "Seaweed, laver (nori), raw",
    kcal: 35, protein: 5.81, fat: 0.28, carb: 5.11, fiber: 0.3,
    prov: "USDA-VERIFIED", fdcId: 168458, url: FDC(168458),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    cad: "plain sushi nori approx CAD 4-7 / 10-sheet pack",
    notes:
      "SESAME TRAP. Plain sushi/onigiri nori sheets are clean, but the SNACK format ('roasted seaweed snacks') is " +
      "conventionally finished with SESAME OIL (Korean style) — those are a sesame fail. Any recipe must specify " +
      "PLAIN nori sheets and say so. Also very low energy per sheet (~2-3 g), so it is a garnish, not a base. " +
      "*** FAILS the repo's checkAtwater (46 predicted vs 35 stated). Marginal — 11 kcal absolute against a 10 kcal " +
      "allowance. Needs a documented exception or a fibre-bearing record.",
    ref_url: "https://gimmeseaweed.com/pages/faqs-ingredients-and-allergens",
  },
  {
    key: "lentils_sprouted_raw",
    name: "Lentils, sprouted, raw",
    kcal: 106, protein: 8.96, fat: 0.55, carb: 22.1, fiber: null,
    prov: "USDA-VERIFIED", fdcId: 168427, url: FDC(168427),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: false,
    cad: "dry lentils approx CAD 3-5 / 900 g; sprouting is free (jar + water, 3-4 days)",
    notes:
      "Only calorie-carrying pulse that clears the box unaided. Sprouting is what does it: raw lentil Pd 6.99 -> " +
      "sprouted 8.45 (water loss plus germination protein). Home-sproutable from any bulk lentil, so cost and " +
      "supply-chain allergen risk are both near zero. Retail sprouted lentils are specialty/inconsistent in Canada. " +
      "*** FAILS the repo's own checkAtwater (129 predicted vs 106 stated, +21.7%). FDC 168427 carries NO fibre " +
      "datum, so the fibre-adjusted arm cannot rescue it. I cannot prove the residual is fibre. DO NOT INSERT " +
      "without either a fibre value or a documented exception — it would be flagged by the startup data audit.",
  },
  {
    key: "mung_sprouts_raw",
    name: "Mung bean sprouts, raw",
    kcal: 30, protein: 3.04, fat: 0.18, carb: 5.94, fiber: 1.8,
    prov: "USDA-VERIFIED", fdcId: 169957, url: FDC(169957),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    cad: "approx CAD 2-3 / 300 g bag, every Canadian banner, year round",
    notes: "Already in dev.db as both 'Mung Bean Sprouts' and 'Bean Sprouts' (both source:manual, fdcId null — provenance should be repointed to 169957).",
  },
  {
    key: "mushroom_crimini_raw",
    name: "Mushrooms, brown / Italian / crimini, raw",
    kcal: 22, protein: 2.5, fat: 0.1, carb: 4.3, fiber: 0.6,
    prov: "USDA-VERIFIED", fdcId: 168434, url: FDC(168434),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true,
    cad: "approx CAD 3-4 / 227 g", notes: "Commodity, year-round, every banner. Low energy density: a base, not a filler.",
  },
  {
    key: "mushroom_white_raw",
    name: "Mushrooms, white, raw",
    kcal: 22, protein: 3.09, fat: 0.34, carb: 3.26, fiber: 1,
    prov: "USDA-VERIFIED", fdcId: 169251, url: FDC(169251),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true, cad: "approx CAD 3-4 / 227 g",
  },
  {
    key: "asparagus_raw",
    name: "Asparagus, raw",
    kcal: 20, protein: 2.2, fat: 0.12, carb: 3.88, fiber: 2.1,
    prov: "USDA-VERIFIED", fdcId: 168389, url: FDC(168389),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true,
    cad: "approx CAD 4-7 / bunch fresh (seasonal spike); frozen approx CAD 4 / 500 g year-round",
    notes: "Fresh asparagus is genuinely SEASONAL/price-volatile in Canada. Frozen (FDC 169208, Pd 13.46) is the year-round form and scores better.",
  },
  {
    key: "spinach_raw",
    name: "Spinach, raw",
    kcal: 23, protein: 2.86, fat: 0.39, carb: 3.63, fiber: 2.2,
    prov: "USDA-VERIFIED", fdcId: 168462, url: FDC(168462),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true, cad: "approx CAD 4-5 / 312 g clamshell",
  },
  {
    key: "broccoli_raw",
    name: "Broccoli, raw",
    kcal: 34, protein: 2.82, fat: 0.37, carb: 6.64, fiber: 2.6,
    prov: "USDA-VERIFIED", fdcId: 170379, url: FDC(170379),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true, cad: "approx CAD 3-4 / crown",
    notes: "Clears the protein floor by 0.13 — the thinnest margin in the set. Any measurement variance flips it.",
  },
  {
    key: "watercress_raw",
    name: "Watercress, raw",
    kcal: 11, protein: 2.3, fat: 0.1, carb: 1.29, fiber: 0.5,
    prov: "USDA-VERIFIED", fdcId: 170068, url: FDC(170068),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true,
    notes: "Highest protein density in the whole set (20.91) but 11 kcal/100 g — it can steer a dish's ratio, it cannot feed a slot.",
  },
  {
    key: "fava_in_pod_raw",
    name: "Beans, fava, in pod, raw",
    kcal: 88, protein: 7.92, fat: 0.73, carb: 17.6, fiber: null,
    prov: "USDA-VERIFIED", fdcId: 168574, url: FDC(168574),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true,
    notes:
      "Fava/broad bean carries a real non-IgE hazard the app does not model: FAVISM (G6PD deficiency), which is " +
      "haemolytic and not an allergy. Flag for any fava-heavy dish. *** ALSO FAILS the repo's checkAtwater " +
      "(109 predicted vs 88 stated); FDC 168574 carries no fibre datum. Prefer the canned mature bean (173754), " +
      "which passes at +3.46%.",
  },
  {
    key: "kale_frozen",
    name: "Kale, frozen, unprepared",
    kcal: 28, protein: 2.66, fat: 0.46, carb: 4.88, fiber: 2,
    prov: "USDA-VERIFIED", fdcId: 169239, url: FDC(169239),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    notes: "FROZEN clears (Fd 1.64); RAW kale FAILS the fat ceiling outright (Fd 4.26, FDC 168421). The form is the whole difference — do not substitute.",
  },
  {
    key: "brussels_frozen",
    name: "Brussels sprouts, frozen, unprepared",
    kcal: 41, protein: 3.78, fat: 0.41, carb: 7.86, fiber: 3.8,
    prov: "USDA-VERIFIED", fdcId: 169972, url: FDC(169972),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false, cad: "approx CAD 3-4 / 750 g",
  },
  {
    key: "mustard_greens_frozen",
    name: "Mustard greens, frozen, unprepared",
    kcal: 20, protein: 2.49, fat: 0.27, carb: 3.41, fiber: 3.3,
    prov: "USDA-VERIFIED", fdcId: 169258, url: FDC(169258),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    notes: "MUSTARD is itself a Canadian priority allergen and a TIER_RARE key in allergenTaxonomy.js. Mustard GREENS are the leaf, not the seed, but a name-keyword gate ('mustard') will exclude them. Expect a false exclusion, not a leak.",
  },

  // ══ misses the box, but beats the current vegan-snack median of 3.23 ════════
  {
    key: "lentils_cooked",
    name: "Lentils, mature seeds, cooked, boiled, without salt",
    kcal: 116, protein: 9.02, fat: 0.38, carb: 20.1, fiber: 7.9,
    prov: "USDA-VERIFIED", fdcId: 172421, url: FDC(172421),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    cad: "Unico canned 540 mL approx CAD 1.69-2.49; dry approx CAD 3-5 / 900 g",
    cad_url: "https://www.loblaws.ca/en/lentils/p/20313447003_EA",
    notes: "NEAR-MISS by 0.38 on protein, and the single most useful base in the set: near-zero fat (Fd 0.33) means added nutritional yeast lifts it into the box without a fat cost. This is the workhorse.",
  },
  {
    key: "lentils_canned_unico",
    name: "Unico Lentils, canned (Canadian label)",
    kcal: 120, protein: 9, fat: 0.5, carb: 23, fiber: 6,
    prov: "LABEL", fdcId: null,
    url: "https://www.unico.ca/products.php?id=37&catid=5",
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: false,
    serving_basis: "panel is per 1/2 cup (125 mL): 120 kcal, 9 g protein, 0.5 g fat, 23 g carb, 6 g fibre, 230 mg sodium. NO gram weight is declared, so this row is per-SERVING, not per-100 g — do not silently treat it as per-100 g.",
    cad: "CAD 1.69 (Maxi) - 2.49 (Loblaws) / 540 mL",
    notes: "Ingredients: lentils, water, salt, calcium chloride, disodium EDTA. Clean against the wall. Agrees with USDA 172421 to within 4% on kcal and 0.2% on protein — reassuring convergence.",
  },
  {
    key: "split_peas_cooked",
    name: "Peas, split, mature seeds, cooked, boiled, without salt",
    kcal: 118, protein: 8.34, fat: 0.39, carb: 21.1, fiber: 8.3,
    prov: "USDA-VERIFIED", fdcId: 172429, url: FDC(172429),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false, cad: "dry approx CAD 2-4 / 900 g",
  },
  {
    key: "fava_canned",
    name: "Broadbeans (fava beans), mature seeds, canned",
    kcal: 71, protein: 5.47, fat: 0.22, carb: 12.4, fiber: 3.7,
    prov: "USDA-VERIFIED", fdcId: 173754, url: FDC(173754),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    notes: "Canned fava is a no-cook base. FAVISM caveat as above. Watch Middle-Eastern canned ful — many are packed in oil (see FDC 2067830, Fd 3.76).",
  },
  {
    key: "peas_green_frozen_cooked",
    name: "Peas, green, frozen, cooked, boiled, drained, without salt",
    kcal: 78, protein: 5.15, fat: 0.27, carb: 14.3, fiber: 4.5,
    prov: "USDA-VERIFIED", fdcId: 170017, url: FDC(170017),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: false, cad: "approx CAD 2-3 / 750 g frozen",
    notes: "Cheapest, most universally stocked wall-safe pulse in Canada. Fd 0.35 makes it an excellent nooch carrier.",
  },
  {
    key: "chickpeas_cooked",
    name: "Chickpeas (garbanzo), mature seeds, cooked, boiled, without salt",
    kcal: 164, protein: 8.86, fat: 2.59, carb: 27.4, fiber: 7.6,
    prov: "USDA-VERIFIED", fdcId: 173757, url: FDC(173757),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    notes: "Fails the box on PROTEIN (5.40), not fat. The existing 'Roasted Chickpeas' vegan snack sits at 3.16 because of added oil — the chickpea itself is the ceiling. Do not expect a chickpea snack to reach 8.16.",
  },
  {
    key: "barilla_red_lentil_pasta",
    name: "Barilla Red Lentil pasta, dry (single ingredient: red lentil flour)",
    kcal: 321, protein: 23.2, fat: 2.68, carb: 60.7, fiber: 10.7,
    prov: "LABEL", fdcId: 2158865, url: FDC(2158865),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    cad: "approx CAD 4-6 / 250 g box, Loblaws banners and Walmart.ca",
    notes:
      "MEAL ingredient, not a snack. Included because it is the direct object of TRIAGE H3: the gluten guard covers " +
      "flour/tortilla/cereal but NOT pasta/noodle, so all 57 'High-Protein ... Lentil/Chickpea Pasta' recipes are " +
      "hidden from celiacs and 53 of them are genuinely gluten-free. Produced on a dedicated gluten-free line.",
    ref_url: "https://www.barilla.com/en-us/products/pasta/legume/red-lentil-penne",
  },
  {
    key: "chickapea_pasta",
    name: "Chickapea organic chickpea & lentil pasta, dry",
    kcal: 375, protein: 23.2, fat: 3.57, carb: 60.7, fiber: 10.7,
    prov: "LABEL", fdcId: 2612548, url: FDC(2612548),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    cad: "approx CAD 6.00 / 227 g box (CAD 35.99 for a 6-pack direct)",
    cad_url: "https://chickapea.ca/products/penne-6-pack",
    notes:
      "CANADIAN company (Collingwood, ON). Certified gluten-free facility; the company states none of the major " +
      "allergens are present in the facility — the strongest allergen-control claim of anything I sourced. " +
      "Two ingredients. Still a MEAL, and still misses the box (6.19).",
    ref_url: "https://chickapea.ca/pages/faqs",
  },
  {
    key: "hemp_hearts",
    name: "Seeds, hemp seed, hulled (hemp hearts)",
    kcal: 553, protein: 31.6, fat: 48.8, carb: 8.67, fiber: 4,
    prov: "USDA-VERIFIED", fdcId: 170148, url: FDC(170148),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    cad: "Manitoba Harvest approx CAD 12-20 / 340-454 g, Costco CA / Walmart.ca / all banners",
    notes:
      "The obvious vegan answer, and it FAILS THE BOX BY 3.4x ON FAT (Fd 8.82 vs ceiling 2.60). Allergen-clean and " +
      "Canadian-grown (Manitoba Harvest states a dedicated line, no top allergens in facility), so it is safe — it " +
      "is just the wrong shape. 10 g of hemp adds 3.2 g protein and 4.9 g fat; in a 200 kcal snack that single " +
      "spoon spends 94% of the entire fat allowance. Use as garnish only, or not at all.",
    ref_url: "https://manitobaharvest.com/products/natural-hemp-hearts",
  },
  {
    key: "pumpkin_seed_kernels",
    name: "Seeds, pumpkin and squash seed kernels, dried",
    kcal: 559, protein: 30.2, fat: 49, carb: 10.7, fiber: 6,
    prov: "USDA-VERIFIED", fdcId: 170556, url: FDC(170556),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: true,
    cad: "approx CAD 8-14 / 500 g (pepitas), Bulk Barn / banners",
    notes: "Botanically nut-free and the usual 'nut-free school snack'. Fails the box by 3.4x on fat. Bulk-bin sourcing is a sesame/tree-nut cross-contamination risk — specify packaged.",
  },
  {
    key: "sunflower_seed_kernels",
    name: "Seeds, sunflower seed kernels, dried",
    kcal: 584, protein: 20.8, fat: 51.5, carb: 20, fiber: 8.6,
    prov: "USDA-VERIFIED", fdcId: 170562, url: FDC(170562),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: "CROSS-CONTAMINATION-RISK", lupin: false },
    snack_shaped: true, already_in_db: true,
    notes: "Fails the box worst of all (Pd 3.56, Fd 8.82) — sunflower is a FAT seed with modest protein. Also the classic shared-line partner for sesame in seed packing. Rejected on both axes.",
  },
  {
    key: "spirulina_dried",
    name: "Seaweed, spirulina, dried",
    kcal: 290, protein: 57.5, fat: 7.72, carb: 23.9, fiber: 3.6,
    prov: "USDA-VERIFIED", fdcId: 170495, url: FDC(170495),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    notes:
      "MISSES the fat ceiling by 0.06 (Fd 2.66) — and I am NOT recommending it anyway: it is a supplement powder, " +
      "the exact product shape TRIAGE T-1 blocks, and FDC files branded spirulina under supplement categories. " +
      "Listed only so nobody re-derives it and thinks it was overlooked.",
  },
  {
    key: "roasted_chickpea_snack",
    name: "Roasted chickpea snack, sea salt (Biena) — reference for the existing failure mode",
    kcal: 464, protein: 21.4, fat: 14.3, carb: 64.3, fiber: null,
    prov: "LABEL", fdcId: 2428331, url: FDC(2428331),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: false,
    notes: "Ingredients: roasted chickpeas, sunflower oil, sea salt. Pd 4.61 / Fd 3.08. Every roasted-pulse snack I sourced lands here — the oil is what makes it a crisp, and the oil is what kills it.",
  },
  {
    key: "roasted_fava_snack",
    name: "Roasted salted fava (broad) beans snack",
    kcal: 440, protein: 26, fat: 20, carb: 40, fiber: null,
    prov: "LABEL", fdcId: 2390653, url: FDC(2390653),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: true, already_in_db: false,
    notes: "Ingredients: broad beans, salt, vegetable oil. Pd 5.91 / Fd 4.55. Same story as roasted chickpeas.",
  },
  {
    key: "quinoa_cooked",
    name: "Quinoa, cooked",
    kcal: 120, protein: 4.4, fat: 1.92, carb: 21.3, fiber: 2.8,
    prov: "USDA-VERIFIED", fdcId: 168917, url: FDC(168917),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: true,
    notes: "The reputation is 'complete protein', which is about amino acid profile, NOT density. Pd 3.67 — it is a starch by macro shape and cannot carry this slot.",
  },
  {
    key: "amaranth_cooked",
    name: "Amaranth grain, cooked",
    kcal: 102, protein: 3.8, fat: 1.58, carb: 18.7, fiber: 2.1,
    prov: "USDA-VERIFIED", fdcId: 170683, url: FDC(170683),
    allergens: { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false },
    snack_shaped: false, already_in_db: false,
    notes: "Same as quinoa: Pd 3.73. The pseudocereals do not solve density. (Amaranth LEAVES do — Pd 10.05, FDC 169202 — but that is a green, not a grain.)",
  },
];

// ── dishes ────────────────────────────────────────────────────────────────────
// Composition is in grams of the FOODS above. Trivial acid/herb/spice additions
// are treated as 0 kcal per the repo's documented rule (water, black coffee,
// plain spices ~ 0 kcal). Every dish is stated with its full gram list.
const F = Object.fromEntries(FOODS.map((f) => [f.key, f]));

const DISHES = [
  { name: "Lemon-Herb Lentil Snack Cup", prep: "no-cook (canned lentils, rinsed)", portable: true,
    parts: { lentils_cooked: 170, nooch_brm: 10 }, extras: "15 g lemon juice, parsley, black pepper (counted: lemon juice 15 g @ 22 kcal/100 g)",
    extra_kcal: 3.3, extra_p: 0.05, extra_f: 0.04, extra_c: 1.04 },
  { name: "Minted Green Pea & Nutritional-Yeast Cup", prep: "no-cook (frozen peas thawed under tap)", portable: true,
    parts: { peas_green_frozen_cooked: 200, nooch_brm: 15 }, extras: "10 g lemon juice, fresh mint",
    extra_kcal: 2.2, extra_p: 0.04, extra_f: 0.02, extra_c: 0.69 },
  { name: "Savoury Mushroom & Spinach Skillet Cup", prep: "5 min dry-pan, no oil", portable: false,
    parts: { mushroom_crimini_raw: 200, spinach_raw: 100, nooch_brm: 12 }, extras: "garlic, black pepper, splash of vinegar",
    extra_kcal: 0, extra_p: 0, extra_f: 0, extra_c: 0 },
  { name: "Sprouted Lentil & Cucumber Crunch Bowl", prep: "no-cook (home-sprouted lentils)", portable: true,
    parts: { lentils_sprouted_raw: 130, cucumber_placeholder: 0, nooch_brm: 8 },
    extras: "100 g cucumber (15 kcal/100 g, FDC 168409), 10 g lemon juice",
    extra_kcal: 17.2, extra_p: 0.69, extra_f: 0.13, extra_c: 4.32 },
  { name: "Bean-Sprout & Nori Slaw", prep: "no-cook", portable: true,
    parts: { mung_sprouts_raw: 200, seaweed_laver_nori: 6, nooch_brm: 8 }, extras: "rice vinegar, chilli flakes. PLAIN nori sheets only — sesame-oil roasted seaweed snacks are a sesame fail.",
    extra_kcal: 0, extra_p: 0, extra_f: 0, extra_c: 0 },
  { name: "Fava & Herb Smash on Cucumber Rounds", prep: "no-cook (canned fava)", portable: true,
    parts: { fava_canned: 180, nooch_brm: 10 }, extras: "80 g cucumber, 10 g lemon juice, garlic, dill. FAVISM caveat (G6PD).",
    extra_kcal: 14.2, extra_p: 0.56, extra_f: 0.11, extra_c: 3.59 },
  { name: "Split-Pea & Dill Snack Bowl with Crudites", prep: "batch-cook the peas, assemble cold", portable: true,
    parts: { split_peas_cooked: 140, nooch_brm: 16 }, extras: "40 g carrot + 60 g cucumber sticks, 10 g lemon juice. NAME IT 'bowl', not 'dip' — 'dip'/'sauce' risks the condiment_or_sauce class, which is barred from meal slots (F3).",
    extra_kcal: 27.6, extra_p: 0.79, extra_f: 0.19, extra_c: 6.87 },
  { name: "Roasted Asparagus & Nooch Spears", prep: "12 min oven, NO oil", portable: false,
    parts: { asparagus_raw: 250, nooch_brm: 12 }, extras: "10 g lemon juice, cracked pepper",
    extra_kcal: 2.2, extra_p: 0.04, extra_f: 0.02, extra_c: 0.69 },
  { name: "Chilled Broccoli & White-Mushroom Chop Salad", prep: "no-cook", portable: true,
    parts: { broccoli_raw: 150, mushroom_white_raw: 100, nooch_brm: 10 }, extras: "10 g lemon juice, vinegar, pepper",
    extra_kcal: 2.2, extra_p: 0.04, extra_f: 0.02, extra_c: 0.69 },
  { name: "Pea & Lentil Protein Scoop", prep: "no-cook (frozen peas + canned lentils)", portable: true,
    parts: { peas_green_frozen_cooked: 120, lentils_cooked: 120, nooch_brm: 10 }, extras: "lemon, chilli, pepper",
    extra_kcal: 0, extra_p: 0, extra_f: 0, extra_c: 0 },
  { name: "Brussels & Kale Nooch Crisps", prep: "18 min oven from frozen, NO oil", portable: false,
    parts: { brussels_frozen: 150, kale_frozen: 80, nooch_brm: 10 }, extras: "salt, pepper, smoked paprika",
    extra_kcal: 0, extra_p: 0, extra_f: 0, extra_c: 0 },
  { name: "Lupini Snack Jar  [GATED — NOT for peanut-allergic users]", prep: "no-cook (jarred, rinsed)", portable: true,
    parts: { lupini_cooked: 130 }, extras: "10 g lemon juice, chilli flakes, oregano. MUST NOT be served to a peanut-allergic user (Health Canada advisory); requires a peanut->lupin gate link that does not currently exist.",
    extra_kcal: 2.2, extra_p: 0.04, extra_f: 0.02, extra_c: 0.69, gated: "peanut-allergy contraindicated" },
];

// ── computation ───────────────────────────────────────────────────────────────
const r2 = (x) => Math.round(x * 100) / 100;

function atwater(kcal, p, f, c, fiber) {
  const std = 4 * p + 4 * c + 9 * f;
  const stdPct = kcal > 0 ? ((std - kcal) / kcal) * 100 : 0;
  const out = {
    predicted_kcal: r2(std),
    stated_kcal: r2(kcal),
    residual_pct: r2(stdPct),
    passes_15pct: Math.abs(stdPct) <= 15,
  };
  if (fiber != null && c != null) {
    const fa = 4 * p + 4 * Math.max(0, c - fiber) + 9 * f;
    const faPct = kcal > 0 ? ((fa - kcal) / kcal) * 100 : 0;
    out.fibre_adjusted_predicted_kcal = r2(fa);
    out.fibre_adjusted_residual_pct = r2(faPct);
    out.high_fibre = fiber >= 6;
    out.fibre_adjusted_passes_30pct = Math.abs(faPct) <= 30;
  }
  return out;
}

// Verdict from the repo's real gate (foodValidation.checkAtwater), which is what
// a PUT /foods or a seeder would actually enforce. This is the authoritative
// column for W3-6; my own atwater_check is the explanatory breakdown.
function repoGate(name, kcal, p, f, c, fiber) {
  const res = foodValidation.checkAtwater({
    name,
    kcal,
    protein: p,
    fat: f,
    carb: c,
    fiber: fiber ?? null,
  });
  return {
    passes_repo_foodValidation_checkAtwater: res.ok,
    repo_classic_kcal: res.classic,
    repo_fibre_adjusted_kcal: res.fiberAdjusted,
    repo_tolerance: "15% OR 10 kcal absolute, whichever is looser",
  };
}

function densities(kcal, p, f) {
  const pd = (p / kcal) * 100;
  const fd = (f / kcal) * 100;
  return {
    protein_g_per_100kcal: r2(pd),
    fat_g_per_100kcal: r2(fd),
    clears_target_box: pd >= BOX_P && fd <= BOX_F,
    clears_protein_floor: pd >= BOX_P,
    clears_fat_ceiling: fd <= BOX_F,
    beats_current_vegan_snack_median_3_23: pd > 3.23,
  };
}

const out = [];

for (const f of FOODS) {
  out.push({
    kind: "food",
    name: f.name,
    key: f.key,
    basis: f.serving_basis ? "per serving as labelled — see serving_basis" : "per 100 g",
    serving_basis: f.serving_basis || null,
    per_100g: { kcal: f.kcal, protein_g: f.protein, fat_g: f.fat, carb_g: f.carb, fiber_g: f.fiber },
    ...densities(f.kcal, f.protein, f.fat),
    allergen_profile: f.allergens,
    snack_shaped: f.snack_shaped,
    already_in_dev_db: f.already_in_db,
    provenance_tag: f.prov,
    fdc_id: f.fdcId,
    source_url: f.url,
    secondary_source_url: f.ref_url || null,
    cad_price_estimate: f.cad || null,
    cad_price_source_url: f.cad_url || null,
    atwater_check: atwater(f.kcal, f.protein, f.fat, f.carb, f.fiber),
    repo_gate: repoGate(f.name, f.kcal, f.protein, f.fat, f.carb, f.fiber),
    notes: f.notes || null,
  });
}

for (const d of DISHES) {
  let kcal = d.extra_kcal || 0, p = d.extra_p || 0, fat = d.extra_f || 0, carb = d.extra_c || 0;
  const comp = [];
  const allerg = { soy: false, gluten: false, tree_nut: false, peanut: false, sesame: false, lupin: false };
  for (const [k, g] of Object.entries(d.parts)) {
    if (g === 0) continue;
    const src = F[k];
    if (!src) throw new Error("unknown ingredient " + k);
    kcal += (src.kcal * g) / 100;
    p += (src.protein * g) / 100;
    fat += (src.fat * g) / 100;
    carb += (src.carb * g) / 100;
    comp.push(`${g} g ${src.name} [${src.prov}${src.fdcId ? " FDC " + src.fdcId : ""}]`);
    for (const a of Object.keys(allerg)) {
      const v = src.allergens[a];
      if (v === true) allerg[a] = true;
      else if (v && allerg[a] === false) allerg[a] = v; // MAY_CONTAIN / CROSS-REACTIVE
    }
  }
  out.push({
    kind: "dish",
    name: d.name,
    basis: "per serving as composed",
    per_serving: { kcal: r2(kcal), protein_g: r2(p), fat_g: r2(fat), carb_g: r2(carb) },
    ...densities(kcal, p, fat),
    allergen_profile: allerg,
    snack_shaped: true,
    portable: d.portable,
    prep: d.prep,
    composition: comp,
    extras: d.extras,
    allergen_profile_note:
      allerg.soy === "MAY_CONTAIN" || allerg.tree_nut === "MAY_CONTAIN"
        ? "The soy / tree-nut MAY_CONTAIN is inherited ENTIRELY from the Bob's Red Mill nutritional yeast row used as the calculation basis. It is a BRAND fact, not a recipe fact. Substituting Bragg (panel declares free of wheat, soy, milk; labelled gluten-free) clears it and leaves the dish fully wall-safe. The macros barely move (Bragg-class panels run 0-3.33 g fat/100 g). W3-6: pick the brand before inserting."
        : null,
    gated: d.gated || null,
    already_in_dev_db: false,
    provenance_tag: "COMPUTED-FROM-SOURCED-FOODS",
    fdc_id: null,
    source_url: "derived — see composition[] for each ingredient's source",
    atwater_check: atwater(kcal, p, fat, carb, null),
    repo_gate: repoGate(d.name, kcal, p, fat, carb, null),
    notes: null,
  });
}

const doc = {
  agent: "W2-3",
  generated: new Date().toISOString(),
  target_box: { protein_g_per_100kcal_min: BOX_P, fat_g_per_100kcal_max: BOX_F },
  target_box_in_energy_terms:
    "protein >= 8.16 g/100 kcal == >= 32.6% of energy from protein; fat <= 2.60 g/100 kcal == <= 23.4% of energy from fat",
  wall: ["soy", "gluten", "tree nuts", "peanuts", "sesame"],
  provenance_legend: {
    "USDA-VERIFIED": "USDA FDC SR Legacy / Foundation — laboratory analysis; fdc_id given",
    LABEL: "manufacturer Nutrition Facts panel. NOTE: USDA FDC 'Branded' rows are label transcriptions submitted by the brand, NOT USDA lab work — they are tagged LABEL here even though they carry an fdc_id",
    "COMPUTED-FROM-SOURCED-FOODS": "dish macros summed from the foods listed in composition[]; not independently measured",
  },
  critical_notes: [
    "BRAND DECIDES THE WALL. Every box-clearing dish here leans on nutritional yeast. The macro basis used for the arithmetic is Bob's Red Mill (FDC 2596118), whose retail allergen listing declares MAY CONTAIN soybean and tree nuts — so the computed dish rows inherit that. Bulk Barn's Canadian bulk flake declares MAY CONTAIN WHEAT. Bragg's panel declares free of wheat, soy and milk and is labelled gluten-free. For the soy+gluten+nut+sesame wall the dishes are safe ONLY with a Bragg-class brand. This is a sourcing instruction, not a nutrition one.",
    "LUPIN IS A PEANUT HAZARD. Lupini is the best box-clearing snack-shaped whole food found (Pd 13.11 / Fd 2.45) and three USDA-verified lupin rows ALREADY EXIST in dev.db with zero recipe references. Health Canada advises every peanut-allergic consumer to avoid lupin; 5-37% clinical cross-reactivity. Lupin is not a Canadian priority allergen so packages carry no 'Contains' warning. Probed on the real DB via the production path: foodMatchesExclusionTerm(lupinRow,'peanuts') === false while ('lupin') === true — a peanut-allergic user is NOT protected unless they separately tick the TIER_RARE lupin allergen. allergenTaxonomy.js:635 already documents the cross-reaction in PROSE, but no code consumes it. See risks section of the W2-3 report.",
    "MOST OF THESE FOODS ALREADY EXIST. 14 of the 17 box-clearing foods are already rows in dev.db, most USDA-verified with real FDC ids and zero recipe references. Nutritional yeast is the notable ABSENCE (0 rows). This corroborates W1-5: the gap is RECIPE authoring, not food-library coverage.",
  ],
  hard_blocks_respected: [
    "TRIAGE T-1: no protein powder, isolate, or 'nutritional powder mix' is recommended. Nutritional yeast is included and is NOT in fdcCategory 'Protein and nutritional powders' (BRM rows: 'Baking Additives & Extracts' / 'Flours & Corn Meal') — but see its notes, the name invites misfiling.",
    "No source modified. Read-only DB probes only.",
  ],
  counts: {
    foods: out.filter((o) => o.kind === "food").length,
    dishes: out.filter((o) => o.kind === "dish").length,
    clearing_box: out.filter((o) => o.clears_target_box).length,
    foods_clearing_box: out.filter((o) => o.kind === "food" && o.clears_target_box).length,
    dishes_clearing_box: out.filter((o) => o.kind === "dish" && o.clears_target_box).length,
    wall_safe_dishes_clearing_box: out.filter(
      (o) => o.kind === "dish" && o.clears_target_box && !o.gated,
    ).length,
    atwater_failures_raw_4_4_9: out.filter((o) => !o.atwater_check.passes_15pct)
      .length,
    repo_gate_failures: out.filter(
      (o) => !o.repo_gate.passes_repo_foodValidation_checkAtwater,
    ).length,
    repo_gate_failing_names: out
      .filter((o) => !o.repo_gate.passes_repo_foodValidation_checkAtwater)
      .map((o) => o.name),
  },
  candidates: out,
};

fs.writeFileSync(
  "C:/Users/<account>/Desktop/cut-protocol/fleet/out/W2-3/candidates.json",
  JSON.stringify(doc, null, 1),
);

// console summary
const rows = out.map((o) => ({
  kind: o.kind,
  name: o.name.slice(0, 58),
  kcal: (o.per_100g || o.per_serving).kcal,
  Pd: o.protein_g_per_100kcal,
  Fd: o.fat_g_per_100kcal,
  BOX: o.clears_target_box ? "YES" : "",
  snack: o.snack_shaped ? "s" : "",
  atw: o.atwater_check.residual_pct + "%" + (o.atwater_check.passes_15pct ? "" : " FAIL"),
}));
console.table(rows);
console.log(JSON.stringify(doc.counts, null, 1));
