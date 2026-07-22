// Open Food Facts client — manual UPC/barcode lookup for branded/packaged
// foods (the barcode-off track, CLAUDE.md). OFF is free, keyless, and
// self-hostable, which is exactly why it's the on-ethos choice for this app
// over a paid/cloud barcode API — but it is crowd-sourced, so real rows
// regularly ship: missing products, incomplete nutrition panels, data
// declared per-serving instead of per-100g, and non-numeric junk in fields
// a schema promises are numbers ("<1", "", "traces", stray units).
//
// This module's ONLY job is an honest fetch-and-normalize: a null field
// means "Open Food Facts doesn't know", never an invented 0. Nothing here
// writes to the database or decides whether a row is good enough to keep —
// that's offImport.js, which runs every normalized row through the shared
// fiber-adjusted-Atwater validator before anything is saved.
const BASE = "https://world.openfoodfacts.org/api/v2/product";
const FETCH_TIMEOUT_MS = 10000;
const KCAL_PER_KJ = 1 / 4.184;

// Micronutrient registry — the fixed Food.micros contract (per-100g,
// {[nutrientKey]: amount} in that registry's canonical unit, null = no
// data, a missing key = not reported, 0 = a real verified zero). Mirrored
// verbatim from backend/src/lib/nutrients.js on track/micronutrients
// (commit f3b0b0c) so this branch stays self-contained and buildable in
// isolation — identical content, so merging the two branches later is a
// no-op on this file. Imported here read-only, same convention as
// foodValidation.js.
const { getNutrient, convertUnit } = require("./nutrients.js");

// registryKey -> Open Food Facts's own nutriment taxonomy slug (see
// https://static.openfoodfacts.org/data/taxonomies/nutrients.json).
// Verified against live product data during this track's build (Mars bar,
// barcode 5000159407236, carried a genuinely fortified panel matching
// every key below). Deliberately NOT exhaustive against the full registry
// — omitted registry keys (most amino acids in practice, EPA/DHA/ALA,
// choline, biotin, several B-vitamins) either aren't in OFF's branded-food
// taxonomy at all or weren't independently confirmed against a real
// response; per the "omit rather than guess" rule, they're simply never
// populated from this source rather than mapped on a guess.
const OFF_MICRO_KEY = {
  vitaminA: "vitamin-a", vitaminC: "vitamin-c", vitaminD: "vitamin-d", vitaminE: "vitamin-e", vitaminK: "vitamin-k",
  thiaminB1: "vitamin-b1", riboflavinB2: "vitamin-b2", niacinB3: "vitamin-pp", pantothenicAcidB5: "pantothenic-acid",
  vitaminB6: "vitamin-b6", folateB9: "vitamin-b9", vitaminB12: "vitamin-b12",
  calcium: "calcium", iron: "iron", magnesium: "magnesium", phosphorus: "phosphorus", potassium: "potassium",
  sodium: "sodium", zinc: "zinc", copper: "copper", manganese: "manganese", selenium: "selenium", iodine: "iodine",
  sugarsTotal: "sugars", cholesterol: "cholesterol",
  saturatedFat: "saturated-fat", monounsaturatedFat: "monounsaturated-fat", polyunsaturatedFat: "polyunsaturated-fat", transFat: "trans-fat",
};

const FIELDS = [
  "code", "product_name", "generic_name", "brands", "quantity",
  "nutrition_data_per", "serving_size", "serving_quantity",
  "nutriments", "status", "status_verbose",
].join(",");

// Accepts UPC-E (6-8), UPC-A (12), EAN-8/13, GTIN-14 — digits only, spaces
// and dashes stripped first since manual entry commonly includes them.
function normalizeUpc(raw) {
  return String(raw ?? "").trim().replace(/[\s-]/g, "");
}

// Crowd-sourced "numeric" fields ship trace markers ("<1"), unit-suffixed
// text, empty strings, and nulls. Only a genuine finite non-negative number
// survives; everything else comes back null — an honest "unknown", never a
// guess (a negative number in source data is equally untrustworthy junk,
// not a real deficit, so it's treated the same as missing).
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

// The gram weight implied by the product's declared serving, when it has
// one — needed to convert per-serving nutrients to per-100g. Returns null
// (never a guess) for servings with no parseable weight ("1 bar", "1 packet").
function servingGrams(product) {
  const direct = num(product.serving_quantity);
  if (direct != null) return direct;
  const s = product.serving_size;
  if (typeof s === "string") {
    const m = s.match(/([\d.]+)\s*g\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// kcal per 100g, trying direct kcal, then a kJ→kcal unit conversion (exact,
// not a guess — still "estimated: false"), then per-serving kcal or kJ
// scaled by the serving weight (a real estimate — flagged true).
function energyKcal100g(n, grams) {
  const direct = num(n["energy-kcal_100g"]);
  if (direct != null) return { value: direct, estimated: false };
  const kj = num(n["energy_100g"]);
  if (kj != null) return { value: Math.round(kj * KCAL_PER_KJ * 10) / 10, estimated: false };
  if (grams) {
    const servingKcal = num(n["energy-kcal_serving"]);
    if (servingKcal != null) return { value: Math.round((servingKcal / grams) * 100 * 100) / 100, estimated: true };
    const servingKj = num(n["energy_serving"]);
    if (servingKj != null) return { value: Math.round((servingKj / grams) * 100 * KCAL_PER_KJ * 10) / 10, estimated: true };
  }
  return { value: null, estimated: false };
}

/**
 * Per-100g macro block for one OFF product. Prefers the *_100g fields OFF
 * ships directly. When a nutrient only has a *_serving figure (the product
 * declared "per serving" instead of "per 100g"), it's scaled up using the
 * serving weight and flagged `estimated` — this app's whole data model is
 * per-100g, so a per-serving-only product is unusable without this step,
 * but the derivation depends on a second crowd-sourced number (serving
 * size) potentially also being wrong, so it must stay visibly flagged
 * rather than presented as an OFF-declared figure.
 */
function extractPer100g(product) {
  const n = product.nutriments || {};
  const grams = servingGrams(product);
  const notes = [];
  const OFF_KEY = { protein: "proteins", fat: "fat", carb: "carbohydrates", fiber: "fiber" };

  const out = { estimated: {} };
  const kcal = energyKcal100g(n, grams);
  out.kcal = kcal.value;
  out.estimated.kcal = kcal.estimated;
  if (kcal.estimated) notes.push(`kcal derived from per-serving energy (${grams}g serving) — not a direct per-100g figure`);
  if (out.kcal == null) notes.push("kcal missing from this product's panel (no energy-kcal_100g, energy_100g/kJ, or per-serving energy with a known serving weight)");

  for (const [field, offKey] of Object.entries(OFF_KEY)) {
    let val = num(n[`${offKey}_100g`]);
    let estimated = false;
    if (val == null) {
      const perServing = num(n[`${offKey}_serving`]);
      if (perServing != null && grams) {
        val = Math.round(((perServing / grams) * 100) * 100) / 100;
        estimated = true;
        notes.push(`${field} derived from per-serving data (${perServing}g / ${grams}g serving) — not a direct per-100g figure`);
      }
    }
    out[field] = val;
    out.estimated[field] = estimated;
    if (val == null && field !== "fiber") notes.push(`${field} missing from this product's panel`);
  }
  return { ...out, notes };
}

/**
 * Micronutrients per 100g, in the exact Food.micros shape: a flat
 * {[nutrientKey]: amount} object in each nutrient's canonical unit, or null
 * if nothing usable was found. A registry key simply never appears in the
 * object when OFF doesn't report it — "missing key" is the honest-absence
 * signal the schema promises, never a written 0.
 *
 * Same per-100g-vs-per-serving discipline as extractPer100g: OFF's own
 * *_100g field is trusted first (it's normalized server-side even for
 * per-serving entries, whenever OFF could compute it); a *_serving figure
 * is scaled by the known serving weight ONLY when that weight is known,
 * otherwise the nutrient is left out rather than guessed.
 *
 * Unit handling: OFF's API reports every mass-based nutriment amount in
 * GRAMS regardless of magnitude or the nutrient's natural unit — confirmed
 * against live data (e.g. a chocolate bar's selenium_100g of 0.0000038
 * with unit:"g", which is 3.8mcg — the *_unit field otherwise shown in
 * OFF's own edit UI is not what the API numeric fields are expressed in).
 * If OFF ever reports a *_unit other than "g" for a field, that field is
 * skipped rather than risk a silent unit-conversion error.
 */
function extractMicros(product) {
  const n = product.nutriments || {};
  const grams = servingGrams(product);
  const out = {};
  for (const [registryKey, offKey] of Object.entries(OFF_MICRO_KEY)) {
    const nutrient = getNutrient(registryKey);
    if (!nutrient || nutrient.sourceField) continue; // fiber lives on Food.fiber, never micros

    const unitField = n[`${offKey}_unit`];
    if (unitField != null && unitField !== "g") continue; // unexpected basis — omit, don't guess

    let valueG = num(n[`${offKey}_100g`]);
    if (valueG == null) {
      const perServing = num(n[`${offKey}_serving`]);
      if (perServing != null && grams) valueG = (perServing / grams) * 100;
    }
    if (valueG == null) continue; // not reported for this product — honest absence

    out[registryKey] = Math.round(convertUnit(valueG, "g", nutrient.unit) * 1000) / 1000;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pickBrand(brandsField) {
  if (!brandsField || typeof brandsField !== "string") return null;
  // OFF ships a crowd-edited comma-separated list ("Simply Asia, Thai
  // Kitchen") — first entry is the primary brand in practice.
  const first = brandsField.split(",")[0].trim();
  return first || null;
}

/**
 * Look up one barcode against Open Food Facts. Never throws for "not
 * found" or "malformed barcode" — those are honest results, not exceptions.
 * Throws only on a real network/HTTP failure so the caller can tell "OFF
 * doesn't have this product" apart from "OFF couldn't be reached".
 *
 * Returns either:
 *   { found: false, reason }
 *   { found: true, upc, name, brand, per100g: {kcal,protein,fat,carb,fiber},
 *     estimated: {kcal,protein,fat,carb,fiber}, incomplete, notes }
 * per100g fields are null where genuinely unknown — never 0, never guessed.
 */
async function lookupUpc(rawUpc) {
  const upc = normalizeUpc(rawUpc);
  if (!/^\d{6,14}$/.test(upc)) {
    return { found: false, reason: `"${rawUpc}" doesn't look like a barcode (expected 6-14 digits)` };
  }

  const res = await fetch(`${BASE}/${upc}.json?fields=${FIELDS}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // OFF asks integrations to identify themselves with a contactable UA.
      "user-agent": "CutProtocol/1.0 (desktop nutrition app; https://github.com/AlbertanCoder/cut-protocol)",
      "accept": "application/json",
    },
  });

  // Confirmed against the live API: OFF answers a genuinely unknown barcode
  // with HTTP 404 (not 200), but still ships its normal
  // {status:0, status_verbose:"product not found"} JSON body — that's an
  // honest "missing product" result (the single most common real-world
  // case), not a transport failure, so it's read the same as a 200. Only a
  // response that ISN'T OFF's own JSON shape (429 rate-limit HTML, 5xx,
  // proxy errors) counts as a hard failure the caller needs to know about.
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Open Food Facts lookup failed: HTTP ${res.status} (non-JSON response — likely rate-limited or the service is down)`);
  }
  if (typeof json.status !== "number") {
    throw new Error(`Open Food Facts lookup failed: HTTP ${res.status}`);
  }
  if (json.status !== 1 || !json.product) {
    return { found: false, reason: json.status_verbose || "product not found in Open Food Facts" };
  }

  const p = json.product;
  const macros = extractPer100g(p);
  const micros = extractMicros(p);
  const rawName = (p.product_name || p.generic_name || "").trim();

  return {
    found: true,
    upc,
    name: rawName || `Unnamed product (UPC ${upc})`,
    brand: pickBrand(p.brands),
    per100g: {
      kcal: macros.kcal, protein: macros.protein, fat: macros.fat,
      carb: macros.carb, fiber: macros.fiber ?? 0, // fiber unknown → 0, matching the Food schema's own default; every other macro stays null when unknown
    },
    micros, // { [nutrientKey]: amount } per 100g in canonical units, or null — see extractMicros
    estimated: macros.estimated,
    incomplete: [macros.kcal, macros.protein, macros.fat, macros.carb].some((v) => v == null),
    notes: macros.notes,
  };
}

module.exports = { lookupUpc, extractPer100g, extractMicros, pickBrand, servingGrams, normalizeUpc, num };
