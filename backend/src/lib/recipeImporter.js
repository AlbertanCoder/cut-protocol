// Phase 5 recipe importer: paste a URL → find the site's recipe data → convert
// ingredient lines to grams → match each to the validated food DB (USDA stays
// the nutrition source of truth via resolveIngredient) → return a per-serving
// DRAFT for human review. Nothing is saved here — the reviewed draft goes
// through the same validated save-draft path AI drafts use.
//
// EXTRACTION LADDER (real recipe pages are messier than schema.org JSON-LD
// alone): 1) JSON-LD  2) HTML microdata (itemscope/itemtype/itemprop)
// 3) RDFa (typeof/property)  4) heuristic scan (ingredient/instruction-shaped
// class names, or an "Ingredients" heading followed by a list) for pages that
// ship neither. Each stage is honest about failure — if nothing recognizable
// is found, the importer says so instead of fabricating a recipe.
//
// PROVIDER SEAM: getRecipeFromUrl() walks PROVIDERS in order. To add a paid
// API later (Spoonacular/Edamam), implement { name, canHandle(url), extract(url) }
// returning the same RawRecipe shape and register it below — nothing else
// changes. Deliberately NOT integrated now (Phase 5 spec).
const { resolveIngredient } = require("./ingredientResolver.js");
const { parseHtmlTree, cleanText, queryAll, queryOne, hasClassOrId, decodeEntities } = require("./htmlLite.js");

// ── RawRecipe shape every provider returns ───────────────────────────────
// { name, description, servings, prepTimeMin, cuisine, ingredients: [raw
//   strings], steps: [strings], sourceUrl }

// ── fetch ─────────────────────────────────────────────────────────────────

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

// ── shared helpers ───────────────────────────────────────────────────────

// JSON-LD text is JSON.parse'd raw — it never passes through an HTML parser,
// so sites whose recipe-schema generator forgot to decode entities before
// embedding them ship literal "&frac12;"/"&#8217;" text right in the JSON
// string (seen live on a real recipe blog while verifying this importer).
// Every string pulled out of JSON-LD goes through decodeEntities so those
// don't reach the ingredient parser or the saved recipe as garbage text.
function textOf(v) {
  if (v == null) return null;
  if (typeof v === "string") return decodeEntities(v).trim();
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

// PT1H30M → minutes. Returns null (never a guess) on anything unparseable.
function isoDurationToMinutes(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.round((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

// Freeform "45 minutes", "1 hr 30 min" durations — the plain-text form
// microdata/RDFa/heuristic pages often use instead of ISO-8601.
function freeformDurationToMinutes(v) {
  if (typeof v !== "string") return null;
  const hm = v.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const mm = v.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  if (!hm && !mm) return null;
  return Math.round((hm ? +hm[1] * 60 : 0) + (mm ? +mm[1] : 0));
}

const durationToMinutes = (v) => isoDurationToMinutes(v) ?? freeformDurationToMinutes(v);

// Recipe "section header" lines real sites embed inside the ingredient list
// itself ("For the sauce:", "For the crust:", "Dressing:") — not food, so
// dropping them isn't the honest-null path, it's correctly recognizing
// there's nothing to convert in the first place.
function isSectionHeaderLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^for\s+(the\s+)?[\w\s]{2,40}:?$/i.test(t)) return true;
  if (/^(to\s+serve|to\s+garnish|garnish|toppings?|dressing|sauce|marinade|filling|glaze|frosting|crust|dough|equipment|optional|notes?|assembly|to\s+finish)\s*:$/i.test(t)) return true;
  return false;
}

const cleanIngredientLines = (lines) =>
  lines.map((s) => decodeEntities(String(s).replace(/<[^>]+>/g, "")).trim()).filter((s) => s && !isSectionHeaderLine(s));

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
  // strip residual HTML tags and decode stray entities some sites embed in step text
  return steps.map((s) => decodeEntities(s.replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
}

// ── stage 1: JSON-LD ─────────────────────────────────────────────────────

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

function extractFromJsonLd(html) {
  const node = findRecipeNode(extractJsonLdBlocks(html));
  if (!node) return null;
  const ingredients = cleanIngredientLines(node.recipeIngredient || node.ingredients || []);
  if (ingredients.length === 0) return null;
  return {
    name: textOf(node.name) || "Imported recipe",
    description: textOf(node.description),
    servings: parseServings(node.recipeYield) || 4,
    prepTimeMin: durationToMinutes(node.totalTime) ?? durationToMinutes(node.cookTime) ?? durationToMinutes(node.prepTime),
    cuisine: textOf(Array.isArray(node.recipeCuisine) ? node.recipeCuisine[0] : node.recipeCuisine),
    ingredients,
    steps: parseSteps(node.recipeInstructions),
    extractionMethod: "json-ld",
  };
}

// ── stage 2 + 3: microdata & RDFa ───────────────────────────────────────
// Both are schema.org's other two encodings and share the same shape: a root
// "this is a Recipe" element, and descendant elements naming a property —
// scoped so that a NESTED item (author, aggregateRating, nutrition) doesn't
// leak its own same-named properties (e.g. author's "name") into the recipe.

const isRecipeTypeUrl = (v) => !!v && v.split(/\s+/).some((t) => /\/recipe\/?(#.*)?$/i.test(t.trim()));

function itemValue(node) {
  if (node.tag === "meta") return node.attrs.content ?? "";
  if (node.attrs.content != null && node.attrs.content !== "") return node.attrs.content;
  if (node.tag === "time" && node.attrs.datetime) return node.attrs.datetime;
  if (node.tag === "data" && node.attrs.value != null) return node.attrs.value;
  if (node.tag === "link" && node.attrs.href) return node.attrs.href;
  return cleanText(node);
}

function collectScopedProps(root, { isRootNode, scopeAttr, propAttr }) {
  const rootNode = queryOne(root, isRootNode);
  if (!rootNode) return null;
  const props = {};
  (function walk(node, owner) {
    for (const child of node.children || []) {
      if (!child.tag) continue;
      const opensNewScope = scopeAttr in child.attrs;
      const propRaw = child.attrs[propAttr];
      if (propRaw && owner) {
        for (const p of propRaw.split(/\s+/)) {
          const key = p.toLowerCase().replace(/^schema:/, "");
          (props[key] ||= []).push(child);
        }
      }
      walk(child, owner && !opensNewScope);
    }
  })(rootNode, true);
  return { rootNode, props };
}

// Steps may be one node per step (repeated prop) or a single container node
// wrapping its own <li>/<p> children with no itemprop of their own.
function stepsFromPropNodes(nodes) {
  if (!nodes || nodes.length === 0) return [];
  if (nodes.length > 1) return nodes.map((n) => cleanText(n)).filter(Boolean);
  const only = nodes[0];
  const items = queryAll(only, (n) => n.tag === "li");
  if (items.length) return items.map((n) => cleanText(n)).filter(Boolean);
  const text = cleanText(only);
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean).length > 1
    ? text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    : [text].filter(Boolean);
}

function buildFromScopedProps(scoped) {
  if (!scoped) return null;
  const { props } = scoped;
  const get1 = (key) => (props[key] && props[key][0] ? itemValue(props[key][0]) : null);
  const ingredientNodes = props.recipeingredient || props.ingredients || [];
  const ingredients = cleanIngredientLines(ingredientNodes.map((n) => itemValue(n)));
  if (ingredients.length === 0) return null;
  const totalTime = get1("totaltime");
  const cookTime = get1("cooktime");
  const prepTime = get1("preptime");
  return {
    name: get1("name") || "Imported recipe",
    description: get1("description"),
    servings: parseServings(get1("recipeyield") || get1("yield")) || 4,
    prepTimeMin: durationToMinutes(totalTime) ?? durationToMinutes(cookTime) ?? durationToMinutes(prepTime),
    cuisine: get1("recipecuisine"),
    ingredients,
    steps: stepsFromPropNodes(props.recipeinstructions),
  };
}

function extractFromMicrodata(tree) {
  const scoped = collectScopedProps(tree, {
    isRootNode: (n) => "itemscope" in n.attrs && isRecipeTypeUrl(n.attrs.itemtype),
    scopeAttr: "itemscope",
    propAttr: "itemprop",
  });
  const built = buildFromScopedProps(scoped);
  return built && { ...built, extractionMethod: "microdata" };
}

function extractFromRdfa(tree) {
  const scoped = collectScopedProps(tree, {
    isRootNode: (n) => !!n.attrs.typeof && isRecipeType(n.attrs.typeof.split(/\s+/)),
    scopeAttr: "typeof",
    propAttr: "property",
  });
  const built = buildFromScopedProps(scoped);
  return built && { ...built, extractionMethod: "rdfa" };
}

// ── stage 4: heuristic fallback for pages with no structured data at all ──

const INGREDIENT_HINT_RE = /ingredient/i;
const INSTRUCTION_HINT_RE = /instruction|direction|method|steps?\b/i;

function bestListContainer(tree, hintRe) {
  const candidates = queryAll(tree, (n) => hasClassOrId(n, hintRe));
  let best = null, bestCount = 0;
  for (const c of candidates) {
    const items = queryAll(c, (n) => n.tag === "li");
    if (items.length > bestCount) { bestCount = items.length; best = c; }
  }
  return bestCount >= 2 ? best : null;
}

// Fallback when no ingredient/instruction *container* is class-hinted: an
// "Ingredients" heading immediately followed by the next list in document
// order (the plain-blog case — zero classes, zero microdata).
function listAfterHeading(tree, headingRe) {
  const heading = queryAll(tree, (n) => /^h[1-6]$/.test(n.tag) && headingRe.test(cleanText(n)))[0];
  if (!heading) return null;
  // walk forward through the flattened document to find the next <ul>/<ol>
  const flat = [];
  (function walk(n) { for (const c of n.children || []) { if (c.tag) { flat.push(c); walk(c); } } })(tree);
  const idx = flat.indexOf(heading);
  for (let i = idx + 1; i < flat.length; i++) {
    if (flat[i].tag === "ul" || flat[i].tag === "ol") return flat[i];
  }
  return null;
}

function linesFromListNode(node) {
  const items = queryAll(node, (n) => n.tag === "li");
  return cleanIngredientLines(items.map((n) => cleanText(n)));
}

function extractHeuristicServings(tree) {
  const text = cleanText(tree);
  const m = text.match(/\b(?:serves|yield[s]?|makes)\s*:?\s*(\d+)/i) || text.match(/(\d+)\s*servings?\b/i);
  return m ? Math.max(1, parseInt(m[1], 10)) : null;
}

function extractHeuristicTime(tree) {
  const text = cleanText(tree);
  const m = text.match(/total\s*time\s*:?\s*([^|·•\n]{1,40})/i) || text.match(/(?:prep|cook)\s*time\s*:?\s*([^|·•\n]{1,40})/i);
  return m ? freeformDurationToMinutes(m[1]) : null;
}

// Prefers an actual <h1>, then a heading/element explicitly classed as the
// recipe title (WPRM/Tasty-style recipe cards often title the card in an h2
// rather than the page's real h1), then the <title> tag with a trailing
// " - Site Name" / " | Site Name" suffix trimmed off.
function extractHeuristicTitle(tree) {
  const h1 = queryOne(tree, (n) => n.tag === "h1");
  if (h1) { const t = cleanText(h1); if (t) return t; }
  const titled = queryOne(tree, (n) => hasClassOrId(n, /recipe[-_]?(title|name)|title[-_]?recipe/i));
  if (titled) { const t = cleanText(titled); if (t) return t; }
  const titleTag = queryOne(tree, (n) => n.tag === "title");
  if (titleTag) {
    const t = cleanText(titleTag).split(/\s+[-|·–]\s+/)[0].trim();
    if (t) return t;
  }
  return null;
}

function extractHeuristic(tree) {
  const ingredientContainer = bestListContainer(tree, INGREDIENT_HINT_RE) || listAfterHeading(tree, /ingredient/i);
  if (!ingredientContainer) return null;
  const ingredients = linesFromListNode(ingredientContainer);
  if (ingredients.length < 2) return null;

  const instructionContainer = bestListContainer(tree, INSTRUCTION_HINT_RE) || listAfterHeading(tree, /instructions?|directions?|method/i);
  const steps = instructionContainer ? queryAll(instructionContainer, (n) => n.tag === "li").map((n) => cleanText(n)).filter(Boolean) : [];

  return {
    name: extractHeuristicTitle(tree) || "Imported recipe",
    description: null,
    servings: extractHeuristicServings(tree) || 4,
    prepTimeMin: extractHeuristicTime(tree),
    cuisine: null,
    ingredients,
    steps,
    extractionMethod: "heuristic",
  };
}

// ── ladder entry point (pure — takes html text, no network) ──────────────

function extractRecipeFromHtml(html, url) {
  const tree = parseHtmlTree(html);
  const built = extractFromJsonLd(html) || extractFromMicrodata(tree) || extractFromRdfa(tree) || extractHeuristic(tree);
  if (!built) {
    throw new Error(
      "no recipe data found on that page — tried schema.org JSON-LD, HTML microdata, RDFa, and a plain-text ingredient-list scan; this page doesn't structure its recipe in a way this importer can recognize"
    );
  }
  return { ...built, sourceUrl: url };
}

const schemaOrgProvider = {
  name: "schema.org",
  canHandle: () => true,
  async extract(url) {
    const html = await fetchHtml(url);
    return extractRecipeFromHtml(html, url);
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
const UNICODE_FRACTION_CHARS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞";

// Parses ONE quantity token ("2", "2.5", "1/2", "1 1/2", "½", "1½") at the
// very start of s. Returns { qty, len } or null — never partial-matches.
function parseSingleQtyToken(s) {
  let m;
  m = s.match(new RegExp(`^(\\d+)\\s*([${UNICODE_FRACTION_CHARS}])`));
  if (m) return { qty: (+m[1] || 0) + UNICODE_FRACTIONS[m[2]], len: m[0].length };
  m = s.match(new RegExp(`^([${UNICODE_FRACTION_CHARS}])`));
  if (m) return { qty: UNICODE_FRACTIONS[m[1]], len: m[0].length };
  m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/); // mixed number "1 1/2"
  if (m && +m[3] !== 0) return { qty: +m[1] + +m[2] / +m[3], len: m[0].length };
  m = s.match(/^(\d+)\s*\/\s*(\d+)/); // simple fraction "3/4"
  if (m && +m[2] !== 0) return { qty: +m[1] / +m[2], len: m[0].length };
  m = s.match(/^(\d+(?:[.,]\d+)?)/); // decimal/integer; "1,5" (EU decimal comma)
  if (m) return { qty: parseFloat(m[1].replace(",", ".")), len: m[0].length };
  return null;
}

function parseQty(text) {
  const s = text.trim();
  const first = parseSingleQtyToken(s);
  if (!first) return { qty: null, rest: s };
  const afterFirst = s.slice(first.len);
  const sep = afterFirst.match(/^\s*(?:-|–|—|to\b)\s*/i);
  if (sep) {
    const afterSep = afterFirst.slice(sep[0].length);
    const second = parseSingleQtyToken(afterSep);
    if (second) {
      return { qty: (first.qty + second.qty) / 2, rest: afterSep.slice(second.len).trim() };
    }
  }
  return { qty: first.qty, rest: afterFirst.trim() };
}

// unit → canonical code. Volume units get a per-food density from CUP_GRAMS
// when available; otherwise a water-ish default with an `estimated` flag.
const UNIT_ALIASES = {
  g: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  dl: "dl", deciliter: "dl", deciliters: "dl", decilitre: "dl", decilitres: "dl",
  cl: "cl", centiliter: "cl", centiliters: "cl", centilitre: "cl", centilitres: "cl",
  cup: "cup", cups: "cup", c: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbsps: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  floz: "floz",
  pt: "pt", pint: "pt", pints: "pt",
  qt: "qt", quart: "qt", quarts: "qt",
  gal: "gal", gallon: "gal", gallons: "gal",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can", tin: "can", tins: "can",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  pinch: "pinch", pinches: "pinch", dash: "pinch",
  handful: "handful", handfuls: "handful",
  bunch: "bunch", bunches: "bunch",
  stick: "stick", sticks: "stick",
  stalk: "stalk", stalks: "stalk", rib: "stalk", ribs: "stalk",
  sprig: "sprig", sprigs: "sprig",
  head: "head", heads: "head",
  fillet: "fillet", fillets: "fillet",
  breast: "breast", breasts: "breast",
  egg: "egg", eggs: "egg",
  jar: "jar", jars: "jar",
  bag: "bag", bags: "bag",
  box: "box", boxes: "box",
  package: "package", packages: "package", pkg: "package", pkgs: "package", packet: "packet", packets: "packet",
  bottle: "bottle", bottles: "bottle",
  container: "container", containers: "container",
  tub: "tub", tubs: "tub",
  carton: "carton", cartons: "carton",
  bulb: "bulb", bulbs: "bulb",
  ear: "ear", ears: "ear",
  leaf: "leaf", leaves: "leaf",
  knob: "knob", knobs: "knob",
  wedge: "wedge", wedges: "wedge",
  square: "square", squares: "square",
};

// Countable-piece units it's safe to recognize in TRAILING position, i.e.
// "2 garlic cloves" (name then unit) as well as the normal "2 cloves garlic"
// (unit then name). Deliberately excludes weight/volume units — "2 cups
// flour" is never written "2 flour cups", so allowing that direction would
// only invite false positives.
const TRAILING_UNIT_OK = new Set([
  "clove", "wedge", "slice", "stick", "stalk", "sprig", "leaf", "ear", "head",
  "fillet", "breast", "piece", "knob", "bulb", "packet", "square",
]);

function tryTrailingUnit(rest) {
  const commaIdx = rest.indexOf(",");
  const clause = (commaIdx === -1 ? rest : rest.slice(0, commaIdx)).trim();
  const m = clause.match(/^(.+?)\s+([a-zA-Z]+)$/);
  if (!m) return null;
  const nameCandidate = m[1].trim();
  const unit = UNIT_ALIASES[m[2].toLowerCase()];
  if (!unit || !TRAILING_UNIT_OK.has(unit) || !nameCandidate) return null;
  return { unit, name: nameCandidate };
}

// "fl oz" / "fl. oz." / "fluid ounce(s)" are two words — fold to one token
// before the normal word-based unit lookup runs.
function normalizeUnitPhrases(s) {
  return s
    .replace(/\bfl\.?\s*oz\.?\b/gi, "floz")
    .replace(/\bfluid\s+ounces?\b/gi, "floz");
}

// grams per cup for common cookables (used for cup/tbsp/tsp/ml/l density).
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
  ["garlic", { clove: 5, bulb: 40 }],
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
  ["butter", { stick: 113 }],
  ["ginger", { knob: 15 }],
  ["chicken breast", { breast: 175, piece: 175 }],
  ["chicken thigh", { piece: 120 }],
  ["fish", { fillet: 150 }],
  ["salmon", { fillet: 150 }],
  ["lime", { piece: 65, wedge: 16 }],
  ["lemon", { piece: 85, wedge: 21 }],
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

const CUP_ML = 236.588;
const VOLUME_IN_CUPS = { cup: 1, tbsp: 1 / 16, tsp: 1 / 48, floz: 1 / 8, pt: 2, qt: 4, gal: 16 };
const VOLUME_UNITS = new Set(["ml", "l", "dl", "cl", ...Object.keys(VOLUME_IN_CUPS)]);

// Every volume unit converts through a food-specific cup density when one's
// known (CUP_GRAMS), falling back to a water-ish 240 g/cup default — the
// SAME rule cup/tbsp/tsp always used; ml/l/etc. now get the same treatment
// instead of a flat, food-blind 1 ml = 1 g assumption.
function gramsForVolume(qty, unit, name) {
  let cups;
  if (unit === "ml") cups = qty / CUP_ML;
  else if (unit === "l") cups = (qty * 1000) / CUP_ML;
  else if (unit === "dl") cups = (qty * 100) / CUP_ML;
  else if (unit === "cl") cups = (qty * 10) / CUP_ML;
  else if (VOLUME_IN_CUPS[unit] != null) cups = qty * VOLUME_IN_CUPS[unit];
  else return null;
  const matched = cupGramsFor(name);
  return { grams: cups * (matched ?? 240), estimated: matched == null };
}

const WEIGHT_UNIT_GRAMS = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };
const CONTAINER_WORDS = ["can", "cans", "jar", "jars", "bag", "bags", "box", "boxes", "package", "packages", "pkg", "pkgs", "bottle", "bottles", "container", "containers", "tin", "tins", "tub", "tubs", "carton", "cartons"];

// "(14.5 oz) cans diced tomatoes" / "14.5 oz. cans diced tomatoes" / "28-ounce can" —
// an explicit per-container WEIGHT that should convert exactly, count included
// ("2 (14.5 oz) cans" is 2 × 14.5 oz, not one 14.5 oz total). Volume-based
// container sizes ("12 fl oz bottle") are deliberately not covered here —
// they'd need a name-aware density at match time; they fall through to the
// general unit path instead, which is still correct, just not exact-labeled.
const SIZED_CONTAINER_RE = new RegExp(
  `^\\(?\\s*([\\d.]+)\\s*-?\\s*(${Object.keys(WEIGHT_UNIT_GRAMS).join("|")})\\.?\\)?\\s+(${CONTAINER_WORDS.join("|")})\\b`,
  "i"
);

function extractSizedContainer(rest) {
  const m = rest.match(SIZED_CONTAINER_RE);
  if (!m) return null;
  const perUnit = WEIGHT_UNIT_GRAMS[m[2].toLowerCase()];
  if (!perUnit) return null;
  return {
    gramsEach: parseFloat(m[1]) * perUnit,
    matchLen: m[0].length,
    unit: UNIT_ALIASES[m[3].toLowerCase()] || "can",
  };
}

// An explicit "(240g)" / "(about 150 g)" alongside a vaguer primary quantity
// is the recipe author's own stated conversion — more trustworthy than our
// generic density tables, so it overrides them when present. By convention
// the parenthetical states the TOTAL for the line's stated quantity (e.g.
// "2 cups (240g) flour" means 2 cups totals 240g), so it's used as-is, not
// multiplied by the outer qty again.
function extractGramHintFromParens(text) {
  const groups = [...text.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  for (const g of groups) {
    const m = g.match(/(?:about\s+|approx\.?\s*|~\s*)?([\d.\/]+)\s*(kilograms?|kg|grams?|g|pounds?|lbs?|lb|ounces?|oz|milliliters?|millilitres?|ml|liters?|litres?|l)\b/i);
    if (!m) continue;
    const tok = parseSingleQtyToken(m[1]);
    if (!tok) continue;
    const unit = UNIT_ALIASES[m[2].toLowerCase()];
    if (!unit) continue;
    if (unit === "g") return { grams: tok.qty, estimated: false };
    if (unit === "kg") return { grams: tok.qty * 1000, estimated: false };
    if (unit === "oz") return { grams: tok.qty * 28.35, estimated: false };
    if (unit === "lb") return { grams: tok.qty * 453.6, estimated: false };
    if (unit === "ml") return { grams: tok.qty, estimated: true };
    if (unit === "l") return { grams: tok.qty * 1000, estimated: true };
  }
  return null;
}

const PREP_WORDS_RE = /\b(finely|coarsely|freshly|roughly|thinly|chopped|minced|diced|sliced|grated|shredded|peeled|crushed|ground|melted|softened|beaten|drained|rinsed|cooked|uncooked|raw|large|small|medium|ripe|fresh|frozen|optional|to taste|plus more)\b/gi;

function cleanName(words) {
  let name = words.join(" ")
    .replace(/^of\s+/i, "")
    .replace(/,.*$/, "")
    .replace(PREP_WORDS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name;
}

/**
 * "2 cloves garlic, minced" → { qty: 2, unit: "clove", name: "garlic",
 * grams, estimated } — grams null when honestly unconvertible.
 */
function parseIngredientLine(raw) {
  const normalizedRaw = raw.replace(/\s+/g, " ").trim();
  const { qty: leadQty, rest: afterQty } = parseQty(normalizedRaw);

  // explicit sized container ("2 (14.5 oz) cans diced tomatoes") is read
  // from the pre-paren-strip text, since the size usually lives in parens.
  const sizedContainer = extractSizedContainer(afterQty);
  // an explicit weight/volume hint anywhere in parens, read the same way.
  const gramHint = extractGramHintFromParens(normalizedRaw);

  let rest = sizedContainer ? afterQty.slice(sizedContainer.matchLen) : afterQty;
  rest = normalizeUnitPhrases(rest.replace(/\(.*?\)/g, " ")).replace(/\s+/g, " ").trim();
  const qty = leadQty;

  let unit = sizedContainer ? sizedContainer.unit : null;
  let words = rest.split(" ").filter(Boolean);

  if (!unit) {
    const maybeUnit = (words[0] || "").toLowerCase().replace(/[.,]$/, "");
    const found = UNIT_ALIASES[maybeUnit];
    if (found) { unit = found; words = words.slice(1); }
  }
  if (!unit && qty != null) {
    const trailing = tryTrailingUnit(words.join(" "));
    if (trailing) { unit = trailing.unit; words = trailing.name.split(" "); }
  }

  let name = cleanName(words);
  if (!name) name = rest.replace(/,.*$/, "").trim();

  let grams = null;
  let estimated = false;
  const q = qty ?? 1;

  if (sizedContainer) {
    grams = q * sizedContainer.gramsEach;
    estimated = false;
  } else if (unit === "g") grams = q;
  else if (unit === "kg") grams = q * 1000;
  else if (unit === "mg") grams = q / 1000;
  else if (unit === "oz") grams = q * 28.35;
  else if (unit === "lb") grams = q * 453.6;
  else if (unit && VOLUME_UNITS.has(unit)) {
    const v = gramsForVolume(q, unit, name);
    grams = v.grams;
    estimated = v.estimated;
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

  // An explicit weight-in-parens always wins over a generic estimate — it's
  // the author's own stated conversion. Skip it when a sized-container match
  // already used the same parens correctly (accounting for the outer count).
  if (gramHint && !sizedContainer) {
    grams = gramHint.grams;
    estimated = gramHint.estimated;
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
  if (raw.extractionMethod === "heuristic") {
    notes.push("this page has no structured recipe data (no JSON-LD, microdata, or RDFa) — ingredients and steps were scraped from the page text; double-check everything below before saving.");
  }
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
  importRecipeFromUrl, getRecipeFromUrl, parseIngredientLine, extractRecipeFromHtml,
  isoDurationToMinutes, freeformDurationToMinutes, extractJsonLdBlocks, findRecipeNode,
  parseSteps, parseServings, isSectionHeaderLine,
  CATEGORY_ROLE, PROVIDERS,
};
