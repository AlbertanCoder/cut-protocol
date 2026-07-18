// Local, editable CAD grocery price table. Ported verbatim (CommonJS syntax
// only) from recomp-v2/src/data/groceryPrices.js.
//
// THESE ARE NOT SOURCED DATA. Every figure below is a rough, round,
// manually-entered guess at typical Canadian grocery pricing, NOT pulled
// from any flyer, API, or receipt. Every lookup result carries
// isEstimate: true and a note, and an unmatched ingredient returns null
// rather than a fabricated number. Edit this file directly to correct a
// price - that's the point of "local editable" per the original spec this
// was built against.
//
// Keyed by a keyword matched against the ingredient/adjuster name (first
// match wins - more specific entries listed first).
const PRICE_PER_100G_CAD = [
  // protein
  ["chicken breast", 3.00], ["chicken thigh", 2.50], ["chicken", 2.75],
  ["turkey", 3.25], ["duck", 5.00],
  ["ground beef", 3.50], ["beef", 4.50], ["steak", 6.00], ["sirloin", 5.50],
  ["pork", 3.25], ["bacon", 4.00], ["ham", 3.50], ["sausage", 3.00],
  ["salmon", 5.50], ["tuna", 4.00], ["cod", 3.75], ["tilapia", 3.25],
  ["halibut", 6.50], ["trout", 4.50], ["shrimp", 5.50], ["fish", 4.00],
  ["egg", 0.65], ["tofu", 1.20], ["tempeh", 1.80],
  // dairy
  ["greek yogurt", 0.70], ["yogurt", 0.55], ["yoghurt", 0.55],
  ["milk", 0.20], ["cheese", 1.60], ["butter", 1.20], ["cream", 0.90],
  ["skyr", 0.75],
  // grains / pantry dry goods
  ["white rice", 0.30], ["brown rice", 0.35], ["rice", 0.30],
  ["quinoa", 1.00], ["oats", 0.35], ["oatmeal", 0.35],
  ["pasta", 0.35], ["noodle", 0.40], ["couscous", 0.60],
  ["bread", 0.50], ["tortilla", 0.60], ["cracker", 0.70],
  ["flour", 0.15], ["sugar", 0.20], ["honey", 1.20], ["syrup", 1.00],
  ["lentil", 0.35], ["chickpea", 0.40], ["bean", 0.35],
  // nuts / fats
  ["almond", 1.80], ["walnut", 2.00], ["cashew", 2.20], ["peanut", 1.00],
  ["pecan", 2.50], ["pistachio", 2.80], ["hazelnut", 2.50],
  ["olive oil", 1.50], ["oil", 0.80], ["peanut butter", 0.90],
  // produce
  ["banana", 0.25], ["apple", 0.45], ["orange", 0.45], ["lemon", 0.60],
  ["lime", 0.60], ["blueberr", 1.20], ["strawberr", 0.90], ["berry", 1.00],
  ["potato", 0.30], ["onion", 0.25], ["tomato", 0.45], ["carrot", 0.25],
  ["spinach", 0.70], ["lettuce", 0.50], ["broccoli", 0.55], ["cabbage", 0.30],
  ["cucumber", 0.40], ["mushroom", 0.80], ["garlic", 1.00], ["ginger", 1.20],
  ["avocado", 1.50], ["pepper", 0.60],
  // spices/condiments — priced low and flat, negligible line-item weight
  ["salt", 0.10], ["cumin", 2.00], ["paprika", 2.00], ["cinnamon", 2.50],
  ["oregano", 3.00], ["basil", 3.00], ["seasoning", 2.00], ["vinegar", 0.40],
  ["sauce", 0.60],
];

const DEFAULT_NOTE = "rough manually-entered CAD estimate, not sourced pricing data — edit src/lib/groceryPrices.js to correct";

function matchKeyword(name) {
  const n = (name || "").toLowerCase();
  for (const [kw, pricePer100g] of PRICE_PER_100G_CAD) {
    if (n.includes(kw)) return pricePer100g;
  }
  return null;
}

// Best-effort CAD cost estimate for a purchase-quantity gram amount. Returns
// null (never a fabricated number) when no keyword matches - callers must
// show "cost unknown" rather than silently omitting the item or presenting
// a $0.00 as if it were free.
function estimateCostCad(name, grams) {
  const pricePer100g = matchKeyword(name);
  if (pricePer100g == null || !Number.isFinite(grams) || grams <= 0) return null;
  const amountCad = Math.round((pricePer100g * (grams / 100)) * 100) / 100;
  return { amountCad, isEstimate: true, note: DEFAULT_NOTE };
}

module.exports = { PRICE_PER_100G_CAD, estimateCostCad };
