// Streaming reader for USDA FoodData Central bulk JSON datasets.
//
// The bulk files are big (SR Legacy is 210 MB of JSON inside a 13 MB zip), so
// nothing here ever holds the whole file: the single zip entry is inflated as
// a stream and the top-level array is cut into records by a string-aware brace
// scanner. No third-party dependency — `node_modules` is a shared junction in
// this worktree and must never be written to.
//
// Everything is per-100g. FDC publishes all Foundation / SR Legacy / Survey
// nutrient amounts on a 100 g basis, which is exactly the Food table's unit.

const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

// ── the three datasets we trust as "usda-verified" ───────────────────────
// Branded Foods is deliberately EXCLUDED: it is manufacturer-declared label
// data, not USDA analysis, and would land under the wrong provenance tier.
const DATASETS = [
  {
    key: "foundation",
    dataType: "Foundation",
    arrayKey: "FoundationFoods",
    file: "FoodData_Central_foundation_food_json_2026-04-30.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip",
    // Foundation is the most rigorously analysed tier — it wins ties.
    priority: 1,
  },
  {
    key: "sr_legacy",
    dataType: "SR Legacy",
    arrayKey: "SRLegacyFoods",
    file: "FoodData_Central_sr_legacy_food_json_2018-04.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
    priority: 2,
  },
  {
    key: "survey",
    dataType: "Survey (FNDDS)",
    arrayKey: "SurveyFoods",
    file: "FoodData_Central_survey_food_json_2024-10-31.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    priority: 3,
  },
];

const CACHE_DIR = path.join(__dirname, "..", "..", "data", "fdc-cache");
const FIXTURE_DIR = path.join(__dirname, "..", "..", "data", "fdc-fixtures");

// ── zip entry → byte stream ──────────────────────────────────────────────
// These archives hold exactly one entry, so we can read the local file header
// at offset 0 and inflate from just past it rather than parsing the central
// directory.
function openZipEntryStream(zipPath) {
  const fd = fs.openSync(zipPath, "r");
  let head;
  try {
    head = Buffer.alloc(30);
    const read = fs.readSync(fd, head, 0, 30, 0);
    if (read < 30) throw new Error(`${path.basename(zipPath)}: file is truncated`);
  } finally {
    fs.closeSync(fd);
  }
  if (head.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${path.basename(zipPath)}: not a zip file (bad local header signature)`);
  }
  const method = head.readUInt16LE(8);
  const dataStart = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = fs.createReadStream(zipPath, { start: dataStart });
  if (method === 0) return raw; // stored
  if (method !== 8) throw new Error(`${path.basename(zipPath)}: unsupported zip compression method ${method}`);
  return raw.pipe(zlib.createInflateRaw());
}

// ── streaming JSON array → records ───────────────────────────────────────
/**
 * Yield each top-level object of the single array in an FDC bulk file.
 * Accepts a .zip (single entry) or a plain .json file, so committed fixtures
 * and freshly-downloaded archives take the same code path.
 */
async function* iterateFdcRecords(filePath) {
  const isZip = filePath.toLowerCase().endsWith(".zip");
  const stream = isZip ? openZipEntryStream(filePath) : fs.createReadStream(filePath);
  const decoder = new StringDecoder("utf8");

  let buf = "";
  let pos = 0; // next index in buf still to examine — MUST persist across
  // chunks: rescanning an already-scanned partial record would double-count
  // its braces and `depth` would never return to zero.
  let started = false;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let objStart = -1;

  for await (const chunk of stream) {
    buf += decoder.write(chunk);
    if (!started) {
      const open = buf.indexOf("[");
      if (open === -1) { buf = ""; pos = 0; continue; }
      pos = open + 1;
      started = true;
    }
    for (; pos < buf.length; pos++) {
      const ch = buf[pos];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") { if (depth === 0) objStart = pos; depth++; continue; }
      if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          yield JSON.parse(buf.slice(objStart, pos + 1));
          objStart = -1;
        }
      }
    }
    // Compact: keep the record still being assembled, else drop everything
    // scanned (inter-record commas and whitespace).
    const keepFrom = depth > 0 && objStart !== -1 ? objStart : pos;
    if (keepFrom > 0) {
      buf = buf.slice(keepFrom);
      pos -= keepFrom;
      if (objStart !== -1) objStart -= keepFrom;
    }
  }
}

// ── nutrients ────────────────────────────────────────────────────────────
// FDC nutrient ids. Energy has several encodings; prefer the plain kcal
// record, then Atwater-specific / general, then kJ converted.
const NUTRIENT = { protein: 1003, fat: 1004, carb: 1005, fiber: 1079 };
const ENERGY_KCAL = 1008;
const ENERGY_ATWATER_SPECIFIC = 2048;
const ENERGY_ATWATER_GENERAL = 2047;
const ENERGY_KJ = 1062;
const KJ_PER_KCAL = 4.184;

function amountsById(record) {
  const out = new Map();
  for (const fn of record.foodNutrients || []) {
    const id = fn.nutrient?.id;
    if (id == null) continue;
    // `amount` is absent on grouping rows (e.g. the "Proximates" header).
    const amt = typeof fn.amount === "number" ? fn.amount : null;
    if (amt == null) continue;
    if (!out.has(id)) out.set(id, amt);
  }
  return out;
}

/**
 * Pull per-100g macros out of an FDC record.
 * Returns null when energy or any macro is missing — an incomplete record is
 * reported, never silently zero-filled (a 0 that means "unknown" is exactly
 * how bad numbers get into a food table).
 */
function extractMacros(record) {
  const a = amountsById(record);
  let kcal = a.get(ENERGY_KCAL);
  let energyBasis = "kcal";
  if (kcal == null) { kcal = a.get(ENERGY_ATWATER_SPECIFIC); energyBasis = "atwater-specific"; }
  if (kcal == null) { kcal = a.get(ENERGY_ATWATER_GENERAL); energyBasis = "atwater-general"; }
  if (kcal == null) {
    const kj = a.get(ENERGY_KJ);
    if (kj != null) { kcal = kj / KJ_PER_KCAL; energyBasis = "kJ-converted"; }
  }
  const protein = a.get(NUTRIENT.protein);
  const fat = a.get(NUTRIENT.fat);
  const carb = a.get(NUTRIENT.carb);
  const fiber = a.get(NUTRIENT.fiber);

  const missing = [];
  if (kcal == null) missing.push("energy");
  if (protein == null) missing.push("protein");
  if (fat == null) missing.push("fat");
  if (carb == null) missing.push("carbohydrate");
  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    energyBasis,
    kcal: round(kcal, 1),
    protein: round(protein, 2),
    fat: round(fat, 2),
    carb: round(carb, 2),
    // Fiber genuinely absent is 0 for Atwater purposes; it only ever widens
    // the tolerance band, so defaulting it cannot manufacture a pass.
    fiber: fiber == null ? 0 : round(fiber, 2),
  };
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Normalize one raw FDC record into the shape the importer and the audit both
 * consume. `dataset` is a DATASETS entry.
 */
/**
 * The Atwater factors USDA actually used to compute this record's energy.
 * Most FDC foods do NOT use the generic 4/4/9: limes are 3.36/8.37/2.48,
 * chicken is 4.27/9.02/3.87. Checking such a record against 4/4/9 reports a
 * discrepancy that exists in the model, not in the data — so the real factors
 * travel with the record and the validator uses them.
 * Returns null when the record does not declare them.
 */
function calorieConversionFactors(record) {
  const f = (record.nutrientConversionFactors || []).find(
    (x) => x.type === ".CalorieConversionFactor" || x.proteinValue != null,
  );
  if (!f) return null;
  const { proteinValue: protein, fatValue: fat, carbohydrateValue: carb } = f;
  if ([protein, fat, carb].some((v) => typeof v !== "number")) return null;
  // A few records declare 0/0/0 (or a single 0) — that is a missing value, not
  // a claim that protein yields no energy. Using it would compute 0 kcal for
  // every food and reject good data, so treat it as undeclared and fall back
  // to the generic factors.
  if ([protein, fat, carb].some((v) => v <= 0)) return null;
  return { protein, fat, carb };
}

function normalizeFdcRecord(record, dataset) {
  const macros = extractMacros(record);
  return {
    atwaterFactors: calorieConversionFactors(record),
    fdcId: record.fdcId,
    description: (record.description || "").trim(),
    dataType: record.dataType || dataset?.dataType || null,
    datasetKey: dataset?.key || null,
    priority: dataset?.priority ?? 99,
    fdcCategory:
      typeof record.foodCategory === "string"
        ? record.foodCategory
        : record.foodCategory?.description || record.wweiaFoodCategory?.wweiaFoodCategoryDescription || null,
    macros,
  };
}

function datasetPath(dataset, { fixture = false } = {}) {
  return fixture
    ? path.join(FIXTURE_DIR, `${dataset.key}.sample.json`)
    : path.join(CACHE_DIR, dataset.file);
}

function availableDatasets({ fixture = false } = {}) {
  return DATASETS.filter((d) => fs.existsSync(datasetPath(d, { fixture })));
}

module.exports = {
  DATASETS,
  CACHE_DIR,
  FIXTURE_DIR,
  openZipEntryStream,
  iterateFdcRecords,
  extractMacros,
  normalizeFdcRecord,
  datasetPath,
  availableDatasets,
  calorieConversionFactors,
  NUTRIENT,
  ENERGY_KCAL,
};
