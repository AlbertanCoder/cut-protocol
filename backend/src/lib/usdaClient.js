const BASE = "https://api.nal.usda.gov/fdc/v1";
// "Foundation" data-type foods report energy under 2047/2048 (Atwater
// General/Specific Factors) instead of the standard 1008 that SR
// Legacy/Branded items use — checked in priority order. Confirmed via a
// live API response: protein/fat/carb (1003/1004/1005) are consistent
// across data types, only Energy moves.
const KCAL_IDS = [1008, 2047, 2048];
const NUTRIENT_ID = { protein: 1003, fat: 1004, carb: 1005, fiber: 1079 };

// Foundation/SR Legacy = USDA-vetted whole foods with standardized per-100g
// nutrients. Branded is a fallback for packaged items with no good match there.
const PREFERRED_DATA_TYPES = "Foundation,SR Legacy";

function apiKey() {
  const key = process.env.USDA_API_KEY;
  if (!key) throw new Error("Missing USDA_API_KEY env var");
  return key;
}

function extractPer100g(foodNutrients) {
  const byId = {};
  for (const n of foodNutrients || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const val = n.value ?? n.amount;
    if (id != null && val != null) byId[id] = val;
  }
  const kcal = KCAL_IDS.map((id) => byId[id]).find((v) => v != null) ?? 0;
  return {
    kcal,
    protein: byId[NUTRIENT_ID.protein] ?? 0,
    fat: byId[NUTRIENT_ID.fat] ?? 0,
    carb: byId[NUTRIENT_ID.carb] ?? 0,
    fiber: byId[NUTRIENT_ID.fiber] ?? 0,
  };
}

function guessCategory(foodCategory = "", name = "") {
  const s = (foodCategory + " " + name).toLowerCase();
  if (/(butter|oil|nuts?|seeds?|nut butter)/.test(s)) return "fat";
  if (/(milk|yogurt|cheese|dairy)/.test(s)) return "dairy";
  if (/(vegetable|greens|pepper|cucumber|broccoli|spinach|salad)/.test(s)) return "veg";
  if (/(rice|potato|bread|pasta|grain|oat|cereal|starch|bean|legume)/.test(s)) return "carb";
  if (/(beef|pork|poultry|chicken|turkey|fish|seafood|sausage|meat|egg|protein)/.test(s)) return "protein";
  if (/(fruit|berry|berries|apple|banana)/.test(s)) return "fruit";
  return "other";
}

function normalize(item) {
  return {
    fdcId: item.fdcId,
    name: item.description,
    dataType: item.dataType,
    category: guessCategory(item.foodCategory, item.description),
    per100g: extractPer100g(item.foodNutrients),
  };
}

async function searchFoods(query, { includeBranded = false, pageSize = 10 } = {}) {
  const params = new URLSearchParams({ api_key: apiKey(), query, pageSize: String(pageSize) });
  if (!includeBranded) params.set("dataType", PREFERRED_DATA_TYPES);

  const res = await fetch(`${BASE}/foods/search?${params.toString()}`);
  if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
  const json = await res.json();
  return (json.foods || []).map(normalize);
}

module.exports = { searchFoods };
