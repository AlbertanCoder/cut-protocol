// W4-2 — "missing word" probe. Takes the INDEPENDENT vocabulary (authored in
// oracleVocab.mjs before any of the gate's own lists were read) and asks the
// gate, for a synthetic food row bearing that name and NO metadata, whether it
// would be excluded. This is the only shape of test that can find a word the
// filter does not know — a sweep restricted to rows already in the DB can only
// find the misses the corpus happens to contain.
//   node fleet/out/W4-2/hostileNames.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/<account>/Desktop/cut-protocol";
const require = createRequire(path.join(ROOT, "backend/package.json"));
const df = require(path.join(ROOT, "backend/src/lib/dietaryFilter.js"));

// name -> the exclusion term a user would have ticked, plus why it carries it
const CASES = [
  // sesame — the historical miss class
  ["Tahina", "sesame", "Levantine transliteration of tahini"],
  ["Tehina Sauce", "sesame", "Israeli transliteration"],
  ["Gomashio", "sesame", "Japanese sesame salt"],
  ["Gingelly Oil", "sesame", "Indian name for sesame oil"],
  ["Simsim Paste", "sesame", "Arabic/Swahili for sesame"],
  ["Benne Wafers", "sesame", "US Lowcountry name for sesame"],
  ["Za'atar Blend", "sesame", "spice blend, sesame is a defining component"],
  ["Halva", "sesame", "sesame confection"],
  // peanut / lupin cross-reaction
  ["Lupin Flour", "peanuts", "Health Canada peanut cross-reactant"],
  ["Tremoços", "peanuts", "Portuguese lupini"],
  ["Altramuces", "peanuts", "Spanish lupini"],
  ["Kacang Sauce", "peanuts", "Indonesian/Malay for peanut"],
  ["Pindakaas", "peanuts", "Dutch peanut butter"],
  ["Arachis Oil", "peanuts", "botanical name, used on UK labels"],
  ["Mani Tostado", "peanuts", "Latin American for peanut"],
  // fish hidden carriers
  ["Katsuobushi Flakes", "fish", "dried bonito"],
  ["Hondashi", "fish", "bonito stock powder"],
  ["Nam Pla", "fish", "Thai fish sauce"],
  ["Nuoc Mam", "fish", "Vietnamese fish sauce"],
  ["Colatura di Alici", "fish", "Italian anchovy sauce"],
  ["Garum", "fish", "anchovy ferment"],
  ["Bottarga", "fish", "cured fish roe"],
  ["Worcestershire Sauce", "fish", "contains anchovy"],
  // shellfish hidden carriers
  ["Belacan", "shellfish", "Malay shrimp paste"],
  ["Terasi", "shellfish", "Indonesian shrimp paste"],
  ["Bagoong", "shellfish", "Filipino shrimp/fish paste"],
  ["XO Sauce", "shellfish", "dried scallop + shrimp"],
  ["Kamaboko", "shellfish", "surimi cake"],
  // gluten hidden carriers
  ["Seitan Strips", "gluten", "vital wheat gluten"],
  ["Freekeh", "gluten", "green durum wheat"],
  ["Einkorn Berries", "gluten", "ancient wheat"],
  ["Kamut Pasta", "gluten", "khorasan wheat"],
  ["Matzo Meal", "gluten", "wheat"],
  ["Panko", "gluten", "wheat breadcrumb"],
  ["Fu (wheat gluten)", "gluten", "Japanese wheat gluten"],
  ["Malt Extract", "gluten", "barley"],
  // dairy hidden carriers
  ["Labneh", "dairy", "strained yoghurt"],
  ["Khoya", "dairy", "reduced milk solids"],
  ["Smen", "dairy", "fermented butter"],
  ["Skyr", "dairy", "Icelandic cultured dairy"],
  ["Sodium Caseinate", "dairy", "milk protein"],
  ["Lactalbumin Powder", "dairy", "milk protein"],
  ["Mizithra", "dairy", "Greek cheese"],
  // egg hidden carriers
  ["Ovalbumin Powder", "eggs", "egg protein"],
  ["Aioli", "eggs", "emulsified with egg yolk"],
  ["Tamagoyaki", "eggs", "Japanese rolled omelette"],
  ["Century Egg", "eggs", "preserved egg"],
  ["Zabaglione", "eggs", "egg custard"],
  // soy hidden carriers
  ["Doenjang", "soy", "Korean soybean paste"],
  ["Douchi", "soy", "fermented black soybean"],
  ["Yuba Sheets", "soy", "tofu skin"],
  ["Okara", "soy", "soy pulp"],
  ["Kecap Manis", "soy", "sweet soy sauce"],
  // tree nuts
  ["Gianduja", "tree nuts", "hazelnut chocolate"],
  ["Frangipane", "tree nuts", "almond cream"],
  ["Orgeat Syrup", "tree nuts", "almond syrup"],
  ["Pignoli", "tree nuts", "pine nuts"],
  ["Dukkah", "tree nuts", "nut+seed blend"],
  // nightshades (the family this sweep found leaking)
  ["Scotch Bonnet", "nightshades", "Capsicum chinense — FOUND LEAKING"],
  ["Banana Pepper", "nightshades", "Capsicum annuum — FOUND LEAKING"],
  ["Enchilada sauce", "nightshades", "tomato+chili — FOUND LEAKING"],
  ["Gochugaru", "nightshades", "Korean chili flake"],
  ["Aji Amarillo Paste", "nightshades", "Peruvian chili"],
  ["Pimentón", "nightshades", "smoked paprika"],
  ["Guajillo Chile", "nightshades", "dried chili"],
  ["Piri Piri Sauce", "nightshades", "chili sauce"],
  ["Sambal Oelek", "nightshades", "chili paste"],
  ["Tomatillo Salsa", "nightshades", "Physalis, nightshade family"],
  // legumes
  ["Besan", "legumes", "chickpea flour"],
  ["Gram Flour", "legumes", "chickpea flour"],
  ["Toor Dal", "legumes", "pigeon pea"],
  ["Carob Powder", "legumes", "legume-family pod"],
  // NEGATIVE CONTROLS — these must come back false or the probe is worthless
  ["Ground Nutmeg", "peanuts", "NEGATIVE CONTROL — must not match"],
  ["Coconut Milk", "dairy", "NEGATIVE CONTROL — must not match"],
  ["Eggplant", "eggs", "NEGATIVE CONTROL — must not match"],
  ["Butternut Squash", "tree nuts", "NEGATIVE CONTROL — must not match"],
  ["Water Chestnut", "tree nuts", "NEGATIVE CONTROL — must not match"],
  ["Black Pepper", "nightshades", "NEGATIVE CONTROL — must not match"],
  ["Sweet Potato", "nightshades", "NEGATIVE CONTROL — must not match"],
  ["Gluten-Free Penne", "gluten", "NEGATIVE CONTROL — must not match (H3)"],
  ["Green Beans", "legumes", "NEGATIVE CONTROL — botanically legume, culinary vegetable"],
];

const rows = [];
for (const [name, term, why] of CASES) {
  const food = { id: "synthetic", name, category: null, fdcCategory: null, allergenTags: null, mayContain: null, source: "probe" };
  let matched = null, err = null;
  try { matched = df.foodMatchesExclusionTerm(food, term); } catch (e) { err = e.message; }
  const negative = why.startsWith("NEGATIVE CONTROL");
  rows.push({ name, term, why, gateExcludes: matched, err, expected: negative ? false : true, correct: negative ? matched === false : matched === true });
}

const positives = rows.filter((r) => !r.why.startsWith("NEGATIVE CONTROL"));
const negatives = rows.filter((r) => r.why.startsWith("NEGATIVE CONTROL"));
const summary = {
  generatedAt: new Date().toISOString(),
  positives: positives.length,
  positivesCaught: positives.filter((r) => r.gateExcludes).length,
  positivesMissed: positives.filter((r) => !r.gateExcludes).map((r) => `${r.name} -> ${r.term}`),
  negatives: negatives.length,
  negativesCorrect: negatives.filter((r) => r.gateExcludes === false).length,
  negativesWrong: negatives.filter((r) => r.gateExcludes !== false).map((r) => `${r.name} -> ${r.term}`),
  rows,
};
fs.writeFileSync(path.join(ROOT, "fleet/out/W4-2/hostile-names.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 1));
