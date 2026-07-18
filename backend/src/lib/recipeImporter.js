// Phase 5 recipe importer: paste a URL → parse the site's embedded
// schema.org/Recipe markup → convert ingredient lines to grams → match each
// to the validated food DB (USDA stays the nutrition source of truth via
// resolveIngredient) → return a per-serving DRAFT for human review. Nothing
// is saved here — the reviewed draft goes through the same validated
// save-draft path AI drafts use.
//
// PROVIDER SEAM: getRecipeFromUrl() walks PROVIDERS in order. To add a paid
// API later (Spoonacular/Edamam), implement { name, canHandle(url), extract(url) }
// returning the same RawRecipe shape and register it below — nothing else
// changes. Deliberately NOT integrated now (Phase 5 spec).
const { resolveIngredient } = require("./ingredientResolver.js");

// ── RawRecipe shape every provider returns ───────────────────────────────
// { name, description, servings, prepTimeMin, cuisine, ingredients: [raw
//   strings], steps: [strings], sourceUrl }

// ── schema.org provider ──────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 3_000_000;

async function fetchHtml(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("only http(s) URLs are supported");
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0 (CutProtocol desktop importer)", accept: "text/html" },
  });
  if (!res.ok) throw new Error(`site returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_HTML_BYTES) return text.slice(0, MAX_HTML_BYTES);
  return text;
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Some sites ship JSON with stray HTML comments/trailing commas — skip
      // unparseable blocks rather than failing the whole import.
    }
  }
  return blocks;
}

const isRecipeType = (t) => {
  if (!t) return false;
  const arr = Array.isArray(t) ? t : [t];
  return arr.some((x) => String(x).toLowerCase() === "recipe");
};

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (isRecipeType(node["@type"])) return node;
  if (node["@graph"]) return findRecipeNode(node["@graph"]);
  if (node.mainEntity) return findRecipeNode(node.mainEntity);
  return null;
}

// PT1H30M → minutes. Returns null (never a guess) on anything unparseable.
function isoDurationToMinutes(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.round((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

function textOf(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") return textOf(v.text || v.name || v["@value"]);
  return String(v);
}

function parseServings(recipeYield) {
  const t = textOf(Array.isArray(recipeYield) ? recipeYield[0] : recipeYield);
  if (!t) return null;
  const m = String(t).match(/\d+/);
  return m ? Math.max(1, parseInt(m[0], 10)) : null;
}

function parseSteps(instructions) {
  if (!instructions) return [];
  const arr = Array.isArray(instructions) ? instructions : [instructions];
  const steps = [];
  for (const item of arr) {
    if (typeof item === "string") {
      steps.push(...item.split(/\n+/).map((s) => s.trim()).filter(Boolean));
    } else if (item && typeof item === "object") {
      if (Array.isArray(item.itemListElement)) steps.push(...parseSteps(item.itemListElement));
      else {
        const t = textOf(item.text || item.name);
        if (t) steps.push(t);
      }
    }
  }
  // strip residual HTML tags some sites embed in step text
  return steps.map((s) => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
}

const schemaOrgProvider = {
  name: "schema.org",
  canHandle: () => true,
  async extract(url) {
    const html = await fetchHtml(url);
    const node = findRecipeNode(extractJsonLdBlocks(html));
    if (!node) throw new Error("no schema.org/Recipe markup found on that page — this importer needs sites that embed standard recipe data (most major recipe sites do)");
    const ingredients = (node.recipeIngredient || node.ingredients || []).map((s) => String(s).replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    if (ingredients.length === 0) throw new Error("the page's recipe markup has no ingredient list");
    return {
      name: textOf(node.name) || "Imported recipe",
      description: textOf(node.description),
      servings: parseServings(node.recipeYield) || 4,
      prepTimeMin: isoDurationToMinutes(node.totalTime) ?? isoDurationToMinutes(node.cookTime) ?? isoDurationToMinutes(node.prepTime),
      cuisine: textOf(Array.isArray(node.recipeCuisine) ? node.recipeCuisine[0] : node.recipeCuisine),
      ingredients,
      steps: parseSteps(node.recipeInstructions),
      sourceUrl: url,
    };
  },
};

const PROVIDERS = [
  schemaOrgProvider,
  // Paid-API seam (deliberately not implemented — Phase 5 spec):
  // spoonacularProvider: { name: "spoonacular", canHandle: (url) => !!process.env.SPOONACULAR_KEY, extract(url) {...} }
  // edamamProvider:      { name: "edamam", ... }
];

async function getRecipeFromUrl(url) {
  let lastError = null;
  for (const p of PROVIDERS) {
    if (!p.canHandle(url)) continue;
    try {
      return { raw: await p.extract(url), provider: p.name };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("no provider could handle that URL");
}

// ── ingredient line parsing: "1 ½ cups chopped onion" → qty/unit/name ────

const UNICODE_FRACTIONS = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

function parseQty(text) {
  let s = text.trim();
  let qty = 0;
  let matched = false;
  // unicode fraction, optionally after a whole number: "1½"
  const uni = s.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞])/);
  if (uni) {
    qty = (+uni[1] || 0) + UNICODE_FRACTIONS[uni[2]];
    s = s.slice(uni[0].length);
    matched = true;
  } else {
    // "1 1/2", "3/4", "2.5", "1-2" (ranges use the midpoint)
    const range = s.match(/^([\d.]+)\s*[-–—to]+\s*([\d.]+)/);
    const frac = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
    const simpleFrac = s.match(/^(\d+)\s*\/\s*(\d+)/);
    const dec = s.match(/^([\d.]+)/);
    if (range && /\d\s*[-–—]|to/.test(range[0])) {
      qty = (+range[1] + +range[2]) / 2;
      s = s.slice(range[0].length);
      matched = true;
    } else if (frac) {
      qty = +frac[1] + +frac[2] / +frac[3];
      s = s.slice(frac[0].length);
      matched = true;
    } else if (simpleFrac) {
      qty = +simpleFrac[1] / +simpleFrac[2];
      s = s.slice(simpleFrac[0].length);
      matched = true;
    } else if (dec) {
      qty = +dec[1];
      s = s.slice(dec[0].length);
      matched = true;
    }
  }
  return { qty: matched ? qty : null, rest: s.trim() };
}

// unit → grams-per-unit. Volume units get a per-food density from CUP_GRAMS
// when available; otherwise the water-ish default with an `estimated` flag.
const UNIT_ALIASES = {
  g: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  cup: "cup", cups: "cup", c: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbsps: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can", tin: "can", tins: "can",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  pinch: "pinch", pinches: "pinch", dash: "pinch",
  handful: "handful", handfuls: "handful",
  bunch: "bunch", bunches: "bunch",
  stick: "stick", sticks: "stick",
  stalk: "stalk", stalks: "stalk",
  sprig: "sprig", sprigs: "sprig",
  head: "head", heads: "head",
  fillet: "fillet", fillets: "fillet",
  breast: "breast", breasts: "breast",
  egg: "egg", eggs: "egg",
};

// grams per cup for common cookables (used for cup/tbsp/tsp density).
const CUP_GRAMS = [
  ["flour", 120], ["sugar", 200], ["brown sugar", 220], ["rice", 185],
  ["oats", 90], ["quinoa", 170], ["couscous", 175], ["breadcrumb", 108],
  ["butter", 227], ["oil", 218], ["milk", 240], ["cream", 240], ["yogurt", 245],
  ["water", 240], ["broth", 240], ["stock", 240], ["wine", 240],
  ["cheese", 113], ["parmesan", 100], ["beans", 170], ["lentils", 198],
  ["chickpeas", 164], ["corn", 165], ["peas", 145], ["spinach", 30],
  ["kale", 20], ["onion", 160], ["tomato", 180], ["salsa", 260],
  ["honey", 340], ["syrup", 320], ["peanut butter", 258], ["tahini", 240],
  ["nuts", 140], ["almonds", 143], ["walnuts", 100], ["cashews", 137],
  ["berries", 145], ["coconut milk", 240], ["tomato sauce", 245],
  ["tomato paste", 262], ["mayonnaise", 232], ["soy sauce", 255],
];

const PIECE_GRAMS = [
  ["garlic", { clove: 5 }],
  ["egg", { egg: 50, piece: 50 }],
  ["onion", { piece: 150 }],
  ["tomato", { piece: 120, can: 400 }],
  ["beans", { can: 240 }],
  ["chickpea", { can: 240 }],
  ["coconut milk", { can: 400 }],
  ["tuna", { can: 120 }],
  ["bread", { slice: 40 }],
  ["bacon", { slice: 15 }],
  ["celery", { stalk: 40 }],
  ["cinnamon", { stick: 3 }],
  ["chicken breast", { breast: 175, piece: 175 }],
  ["chicken thigh", { piece: 120 }],
  ["fish", { fillet: 150 }],
  ["salmon", { fillet: 150 }],
  ["lime", { piece: 65 }],
  ["lemon", { piece: 85 }],
  ["pepper", { piece: 120 }],
  ["carrot", { piece: 60 }],
  ["potato", { piece: 170 }],
  ["broccoli", { head: 300 }],
  ["cauliflower", { head: 500 }],
  ["lettuce", { head: 300 }],
];

function cupGramsFor(name) {
  const n = name.toLowerCase();
  for (const [kw, g] of CUP_GRAMS) if (n.includes(kw)) return g;
  return null;
}

function pieceGramsFor(name, unit) {
  const n = name.toLowerCase();
  for (const [kw, units] of PIECE_GRAMS) {
    if (n.includes(kw) && units[unit] != null) return units[unit];
  }
  return null;
}

/**
 * "2 cloves garlic, minced" → { qty: 2, unit: "clove", name: "garlic",
 * grams, estimated } — grams null when honestly unconvertible.
 */
function parseIngredientLine(raw) {
  const cleaned = raw.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  const { qty, rest } = parseQty(cleaned);
  const words = rest.split(" ");
  const maybeUnit = (words[0] || "").toLowerCase().replace(/[.,]$/, "");
  const unit = UNIT_ALIASES[maybeUnit] || null;
  let name = (unit ? words.slice(1) : words).join(" ");
  name = name
    .replace(/^of\s+/i, "")
    .replace(/,.*$/, "")
    .replace(/\b(finely|coarsely|freshly|roughly|thinly|chopped|minced|diced|sliced|grated|shredded|peeled|crushed|ground|melted|softened|beaten|drained|rinsed|cooked|uncooked|raw|large|small|medium|ripe|fresh|frozen|optional|to taste|plus more)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "3 eggs" leaves nothing after the unit word — the unit IS the food.
  if (!name) name = rest.replace(/,.*$/, "").trim();

  let grams = null;
  let estimated = false;
  const q = qty ?? 1;
  if (unit === "g") grams = q;
  else if (unit === "kg") grams = q * 1000;
  else if (unit === "mg") grams = q / 1000;
  else if (unit === "oz") grams = q * 28.35;
  else if (unit === "lb") grams = q * 453.6;
  else if (unit === "ml") { grams = q; estimated = true; }
  else if (unit === "l") { grams = q * 1000; estimated = true; }
  else if (unit === "cup" || unit === "tbsp" || unit === "tsp") {
    const cup = cupGramsFor(name) ?? 240;
    estimated = cupGramsFor(name) == null;
    const per = unit === "cup" ? cup : unit === "tbsp" ? cup / 16 : cup / 48;
    grams = q * per;
  } else if (unit === "pinch") { grams = q * 0.5; estimated = true; }
  else if (unit === "handful") { grams = q * 30; estimated = true; }
  else if (unit === "bunch") { grams = q * 100; estimated = true; }
  else if (unit === "sprig") { grams = q * 2; estimated = true; }
  else if (unit) {
    const piece = pieceGramsFor(name, unit);
    if (piece != null) { grams = q * piece; estimated = true; }
  } else if (qty != null) {
    // bare count: "2 onions", "3 eggs"
    const piece = pieceGramsFor(name, "piece") ?? pieceGramsFor(name, "egg");
    if (piece != null) { grams = qty * piece; estimated = true; }
  }
  if (grams != null) grams = Math.round(grams * 10) / 10;
  return { raw, qty, unit, name: name || rest, grams, estimated };
}

// Food category → ingredient role for the solver's dual-scale math.
const CATEGORY_ROLE = {
  "protein": "protein", "dairy-eggs": "protein", "grains": "carb",
  "fruit-veg": "veg", "fats-nuts-oils": "fat", "pantry": "other", "drinks": "other",
};

/**
 * URL → reviewable draft (per-serving, matching the AI-draft shape the
 * frontend already renders). Nothing saved; unresolvable amounts come back
 * with grams 0 + a note instead of an invented number.
 */
async function importRecipeFromUrl(url) {
  const { raw, provider } = await getRecipeFromUrl(url);
  const servings = Math.max(1, raw.servings || 1);
  const notes = [];
  const ingredients = [];

  for (const line of raw.ingredients) {
    const parsed = parseIngredientLine(line);
    if (parsed.grams == null) {
      notes.push(`"${line}" — couldn't convert the amount to grams; set it manually.`);
    } else if (parsed.estimated) {
      notes.push(`"${line}" — amount estimated from typical sizes/densities; check the grams.`);
    }
    const { food, matched } = await resolveIngredient(parsed.name);
    const perServingGrams = parsed.grams != null ? Math.round((parsed.grams / servings) * 10) / 10 : 0;
    ingredients.push({
      foodId: food.id,
      name: food.name,
      grams: perServingGrams,
      role: CATEGORY_ROLE[food.category] || null,
      scalable: true,
      matched,
      placeholderMacros: matched === "placeholder",
      sourceLine: line,
    });
  }

  return {
    name: raw.name,
    description: raw.description ? `${raw.description}`.slice(0, 300) : `Imported from ${new URL(url).hostname}`,
    cuisine: null, // auto-classified at save time
    slotType: "meal",
    prepTimeMin: raw.prepTimeMin,
    servings,
    steps: raw.steps.length ? raw.steps : ["(No instructions found in the page's recipe markup.)"],
    ingredients,
    importNotes: notes,
    provider,
    sourceUrl: url,
  };
}

module.exports = {
  importRecipeFromUrl, getRecipeFromUrl, parseIngredientLine,
  isoDurationToMinutes, extractJsonLdBlocks, findRecipeNode, parseSteps, parseServings,
  CATEGORY_ROLE, PROVIDERS,
};
