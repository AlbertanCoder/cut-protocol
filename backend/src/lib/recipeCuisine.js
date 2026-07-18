// Name-keyword cuisine classification for the Phase 4 filter bar. The
// imported TheMealDB recipes carry no region metadata, so this is a
// DISCLOSED ESTIMATE (good enough for a soft preference bias — cuisine
// never hard-filters anything). scripts/backfillCuisines.mjs writes these
// onto recipes with no cuisine; hand-set values are never overwritten.
const CUISINES = [
  { key: "mexican", label: "Mexican" },
  { key: "italian", label: "Italian" },
  { key: "mediterranean", label: "Mediterranean" },
  { key: "asian", label: "Asian" },
  { key: "indian", label: "Indian" },
  { key: "middle-eastern", label: "Middle Eastern" },
  { key: "british-irish", label: "British & Irish" },
  { key: "western-comfort", label: "Western / Comfort" },
];

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (name, w) =>
  w.includes(" ") ? name.toLowerCase().includes(w) : new RegExp("\\b" + esc(w) + "(?:es|s)?\\b", "i").test(name);
const any = (name, ws) => ws.some((w) => hasWord(name, w));

// Checked in order — first match wins, so the more distinctive sets come
// first (e.g. "thai green curry" must land asian before indian sees "curry").
const RULES = [
  ["mexican", ["taco", "burrito", "enchilada", "quesadilla", "fajita", "salsa", "carnitas", "pozole", "mexican", "tex-mex", "chimichanga", "tostada", "migas", "elote", "mole", "tamale", "huevos rancheros"]],
  ["asian", ["thai", "pad thai", "pho", "ramen", "teriyaki", "stir-fry", "stir fry", "szechuan", "sichuan", "kung pao", "sushi", "katsu", "satay", "wok", "chow mein", "gyoza", "bibimbap", "bulgogi", "korean", "chinese", "japanese", "vietnamese", "cantonese", "gochujang", "miso", "tempura", "spring roll", "fried rice", "laksa", "rendang", "nasi", "banh mi", "dumpling", "wonton", "hoisin", "shaoxing", "sweet and sour", "singapore", "malaysian", "indonesian", "filipino", "adobo"]],
  ["indian", ["masala", "tikka", "biryani", "dal", "dahl", "tandoori", "korma", "vindaloo", "paneer", "rogan josh", "saag", "bhaji", "samosa", "naan", "madras", "jalfrezi", "keema", "indian", "curry"]],
  ["middle-eastern", ["kebab", "kofta", "kefta", "shawarma", "falafel", "hummus", "tagine", "harissa", "tabbouleh", "fattoush", "shakshuka", "baba ganoush", "algerian", "moroccan", "lebanese", "turkish", "persian", "israeli", "za'atar", "couscous", "dukkah", "labneh"]],
  ["italian", ["pasta", "spaghetti", "penne", "lasagne", "lasagna", "risotto", "carbonara", "parmigiana", "bolognese", "pizza", "gnocchi", "minestrone", "bruschetta", "caprese", "osso buco", "piccata", "italian", "alfredo", "pesto", "arrabiata", "puttanesca", "frittata", "panzanella", "tiramisu", "cannoli", "focaccia", "ragu", "orzo"]],
  ["mediterranean", ["greek", "souvlaki", "moussaka", "gyro", "tzatziki", "spanakopita", "paella", "spanish", "gazpacho", "tapas", "mediterranean", "feta", "halloumi", "portuguese", "piri piri", "chorizo"]],
  ["british-irish", ["shepherd's pie", "cottage pie", "yorkshire", "fish and chips", "toad in the hole", "bangers", "colcannon", "irish", "welsh", "scottish", "british", "english", "cornish", "eton mess", "sticky toffee", "victoria sponge", "trifle", "crumble", "roast dinner", "sunday roast", "full breakfast", "kedgeree", "ploughman"]],
  ["western-comfort", ["burger", "meatloaf", "mac and cheese", "casserole", "bbq", "barbecue", "fried chicken", "pot roast", "chili con carne", "sloppy joe", "grilled cheese", "pancake", "waffle", "hash", "biscuits and gravy", "corn dog", "coleslaw", "jambalaya", "gumbo", "cajun", "buffalo"]],
];

// Legacy AI-generated occasion tags that map onto real cuisines.
const LEGACY_REMAP = { "tex-mex": "mexican" };

function classifyCuisine(name) {
  for (const [cuisine, words] of RULES) {
    if (any(name, words)) return { cuisine, confidence: "rule" };
  }
  return { cuisine: "western-comfort", confidence: "fallback" };
}

module.exports = { CUISINES, classifyCuisine, LEGACY_REMAP };
