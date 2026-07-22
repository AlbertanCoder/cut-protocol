// ── Micronutrient registry ──────────────────────────────────────────────
// The canonical contract for `Food.micros` (see schema.prisma): a per-100g
// map of { [nutrientKey]: amount }, where `amount` is ALWAYS expressed in
// THIS registry's declared canonical `unit` for that key — never mixed units
// (mg vs mcg vs g) within a key. The USDA import pipeline (a separate agent's
// lane) writes into this shape; this file is what makes that shape a
// contract instead of a guess. Anything reading `Food.micros` should go
// through `getNutrient(key)` rather than hand-rolling a unit/label.
//
// Why one JSON column instead of 40+ scalar columns (see also the schema
// comment on Food.micros): adding a nutrient here costs zero migrations —
// just a new entry below. Why not a normalized FoodNutrient table: ~50k
// foods x 40+ nutrients is ~2M rows in SQLite for no benefit this app needs.
//
// `null` on Food.micros, or a missing key inside it, means "no data" — an
// HONEST ABSENCE. It is never coerced to 0 anywhere downstream (see
// microAggregation.js). A food can legitimately contain zero of a nutrient
// (e.g. 0mg vitamin C in beef) — that is a real, known 0, and is stored as
// the number 0, distinct from "we don't know."
//
// fdcId — USDA FoodData Central's modern nutrient `id` (the value found at
// foodNutrients[].nutrient.id / foodNutrients[].nutrientId in the FDC API,
// i.e. the SAME numbering family this repo's usdaClient.js already keys off
// for protein/fat/carb/fiber (1003/1004/1005/1079) — NOT the legacy 3-digit
// SR "Nutr_No" scheme (301/303/321/...) used in some older USDA PDFs). Core
// ids below (protein/fat/carb/fiber/iron/sodium/energy) were cross-checked
// against usdaClient.js and independent USDA documentation while building
// this registry (2026-07-21); the remainder are the standard, long-stable
// FDC ids for these nutrients from the same numbering family, but were not
// each individually re-verified against a live API response — the import
// agent should spot-check a handful (especially the less common ones, e.g.
// iodine/biotin) against a real /v1/food/{id} response before a bulk write,
// and correct here if any drifted. Getting one wrong here is silent and
// load-bearing, so a name-based fallback should never substitute for it.
//
// target — a reference DAILY amount, always with its source cited (LAW: no
// number here without a citation). `type: "minimum"` = a nutrient you want
// to reach (vitamins, minerals, fiber, protein-adjacent aminos); `type:
// "maximum"` = a nutrient you want to stay under (sodium, saturated fat,
// cholesterol, trans fat). These are GENERAL ADULT POPULATION reference
// values (the same convention as FDA "%DV" on a nutrition label) — not
// personalized to the signed-in user's sex/weight/age, matching how every
// other %DV-style figure works. `target: null` means no established
// reference value exists; a `note` explains why rather than leaving it
// silently blank.
"use strict";

// ---- unit conversion -------------------------------------------------
// Minimal, explicit mass-unit conversion so any place comparing an amount
// against a target in a DIFFERENT (but compatible) unit does so correctly
// instead of silently dividing mismatched numbers. Deliberately narrow
// (grams/milligrams/micrograms only — every nutrient in this registry is a
// mass) so an incompatible request fails loudly rather than guessing.
const MASS_UNIT_TO_MG = { g: 1000, mg: 1, mcg: 0.001 };

function convertUnit(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  const from = MASS_UNIT_TO_MG[fromUnit];
  const to = MASS_UNIT_TO_MG[toUnit];
  if (from == null || to == null) {
    throw new Error(`convertUnit: unsupported unit conversion ${fromUnit} -> ${toUnit}`);
  }
  return (value * from) / to;
}

// ---- citation shorthands ----------------------------------------------
const FDA_DV = "FDA 21 CFR 101.9 (2020 Daily Value, general adult/child ≥4y population)";
const IOM_AMINO = "IOM (2005) Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, "
  + "Fatty Acids, Cholesterol, Protein, and Amino Acids, Table 10-5 (RDA per kg body weight) "
  + "— shown as an illustrative absolute amount at a 70kg reference body weight; the real "
  + "requirement scales with the user's own weight, which this registry does not model.";
const IOM_FATTY_ACID_AI = "IOM (2005) Dietary Reference Intakes, Adequate Intake — adult MALE "
  + "reference value shown (female AI differs, see note); not personalized by sex here.";

// mg/kg/day RDA -> illustrative mg/day at a 70kg reference body weight.
const aminoTargetMg = (mgPerKg) => Math.round(mgPerKg * 70);

function minTarget(amount, unit, source, note) {
  return { amount, unit, type: "minimum", source, note: note || null };
}
function maxTarget(amount, unit, source, note) {
  return { amount, unit, type: "maximum", source, note: note || null };
}
function noTarget(note) {
  return { amount: null, unit: null, type: null, source: null, note };
}

// ---- the registry -------------------------------------------------------
// group: "vitamin" | "mineral" | "fiber" | "other" | "fattyAcid" | "aminoAcid"
// sourceField: when set, this nutrient is read from that scalar Food column
// (currently only fiber, which already has a dedicated Food.fiber column —
// see schema.prisma) instead of the Food.micros JSON, so there is exactly
// ONE source of truth for it, never two that can drift apart.
const NUTRIENT_LIST = [
  // ── Vitamins ──────────────────────────────────────────────────────────
  { key: "vitaminA", name: "Vitamin A", unit: "mcg", group: "vitamin", fdcId: 1106,
    target: minTarget(900, "mcg", FDA_DV, "as retinol activity equivalents (RAE)") },
  { key: "vitaminC", name: "Vitamin C", unit: "mg", group: "vitamin", fdcId: 1162,
    target: minTarget(90, "mg", FDA_DV) },
  { key: "vitaminD", name: "Vitamin D", unit: "mcg", group: "vitamin", fdcId: 1114,
    target: minTarget(20, "mcg", FDA_DV, "sum of D2 + D3") },
  { key: "vitaminE", name: "Vitamin E", unit: "mg", group: "vitamin", fdcId: 1109,
    target: minTarget(15, "mg", FDA_DV, "as alpha-tocopherol") },
  { key: "vitaminK", name: "Vitamin K", unit: "mcg", group: "vitamin", fdcId: 1185,
    target: minTarget(120, "mcg", FDA_DV, "as phylloquinone (K1)") },
  { key: "thiaminB1", name: "Thiamin (B1)", unit: "mg", group: "vitamin", fdcId: 1165,
    target: minTarget(1.2, "mg", FDA_DV) },
  { key: "riboflavinB2", name: "Riboflavin (B2)", unit: "mg", group: "vitamin", fdcId: 1166,
    target: minTarget(1.3, "mg", FDA_DV) },
  { key: "niacinB3", name: "Niacin (B3)", unit: "mg", group: "vitamin", fdcId: 1167,
    target: minTarget(16, "mg", FDA_DV, "as niacin equivalents (NE)") },
  { key: "pantothenicAcidB5", name: "Pantothenic acid (B5)", unit: "mg", group: "vitamin", fdcId: 1170,
    target: minTarget(5, "mg", FDA_DV) },
  { key: "vitaminB6", name: "Vitamin B6", unit: "mg", group: "vitamin", fdcId: 1175,
    target: minTarget(1.7, "mg", FDA_DV) },
  { key: "folateB9", name: "Folate (B9)", unit: "mcg", group: "vitamin", fdcId: 1190,
    target: minTarget(400, "mcg", FDA_DV, "as dietary folate equivalents (DFE)") },
  { key: "vitaminB12", name: "Vitamin B12", unit: "mcg", group: "vitamin", fdcId: 1178,
    target: minTarget(2.4, "mcg", FDA_DV) },
  { key: "choline", name: "Choline", unit: "mg", group: "vitamin", fdcId: 1180,
    target: minTarget(550, "mg", FDA_DV) },
  { key: "biotinB7", name: "Biotin (B7)", unit: "mcg", group: "vitamin", fdcId: 1176,
    target: minTarget(30, "mcg", FDA_DV) },

  // ── Minerals ──────────────────────────────────────────────────────────
  { key: "calcium", name: "Calcium", unit: "mg", group: "mineral", fdcId: 1087,
    target: minTarget(1300, "mg", FDA_DV) },
  { key: "iron", name: "Iron", unit: "mg", group: "mineral", fdcId: 1089,
    target: minTarget(18, "mg", FDA_DV) },
  { key: "magnesium", name: "Magnesium", unit: "mg", group: "mineral", fdcId: 1090,
    target: minTarget(420, "mg", FDA_DV) },
  { key: "phosphorus", name: "Phosphorus", unit: "mg", group: "mineral", fdcId: 1091,
    target: minTarget(1250, "mg", FDA_DV) },
  { key: "potassium", name: "Potassium", unit: "mg", group: "mineral", fdcId: 1092,
    target: minTarget(4700, "mg", FDA_DV) },
  { key: "sodium", name: "Sodium", unit: "mg", group: "mineral", fdcId: 1093,
    target: maxTarget(2300, "mg", FDA_DV, "a ceiling, not a floor — 100% here means \"at the limit,\" not \"on target\"") },
  { key: "zinc", name: "Zinc", unit: "mg", group: "mineral", fdcId: 1095,
    target: minTarget(11, "mg", FDA_DV) },
  { key: "copper", name: "Copper", unit: "mg", group: "mineral", fdcId: 1098,
    target: minTarget(0.9, "mg", FDA_DV) },
  { key: "manganese", name: "Manganese", unit: "mg", group: "mineral", fdcId: 1101,
    target: minTarget(2.3, "mg", FDA_DV) },
  { key: "selenium", name: "Selenium", unit: "mcg", group: "mineral", fdcId: 1103,
    target: minTarget(55, "mcg", FDA_DV) },
  { key: "iodine", name: "Iodine", unit: "mcg", group: "mineral", fdcId: 1100,
    target: minTarget(150, "mcg", FDA_DV, "sparsely reported in USDA data — expect low coverage") },

  // ── Fiber (sourced from Food.fiber, not Food.micros — see header) ──
  { key: "fiber", name: "Fiber", unit: "g", group: "fiber", fdcId: 1079, sourceField: "fiber",
    target: minTarget(28, "g", FDA_DV) },

  // ── Other tracked components ─────────────────────────────────────────
  { key: "sugarsTotal", name: "Total sugars", unit: "g", group: "other", fdcId: 2000,
    target: noTarget("No DV exists for total sugars — only \"added sugars\" (50g DV) does, and "
      + "USDA per-100g composition data doesn't separate added from naturally-occurring sugar.") },
  { key: "cholesterol", name: "Cholesterol", unit: "mg", group: "other", fdcId: 1253,
    target: maxTarget(300, "mg", FDA_DV, "a ceiling reference value, not a floor") },

  // ── Fatty acid profile ───────────────────────────────────────────────
  { key: "saturatedFat", name: "Saturated fat", unit: "g", group: "fattyAcid", fdcId: 1258,
    target: maxTarget(20, "g", FDA_DV, "a ceiling, not a floor") },
  { key: "monounsaturatedFat", name: "Monounsaturated fat", unit: "g", group: "fattyAcid", fdcId: 1292,
    target: noTarget("No established DV.") },
  { key: "polyunsaturatedFat", name: "Polyunsaturated fat", unit: "g", group: "fattyAcid", fdcId: 1293,
    target: noTarget("No established DV.") },
  { key: "transFat", name: "Trans fat", unit: "g", group: "fattyAcid", fdcId: 1257,
    target: { amount: null, unit: "g", type: "maximum", source: FDA_DV,
      note: "FDA sets no numeric DV — guidance is \"as low as possible.\"" } },
  { key: "omega3ALA", name: "Omega-3 (ALA, 18:3 n-3)", unit: "g", group: "fattyAcid", fdcId: 1404,
    target: minTarget(1.6, "g", IOM_FATTY_ACID_AI, "female AI 1.1g/day") },
  { key: "omega3EPA", name: "Omega-3 (EPA, 20:5 n-3)", unit: "g", group: "fattyAcid", fdcId: 1278,
    target: noTarget("No formal DRI for EPA alone. AHA/WHO population guidance suggests ~250–500mg "
      + "combined EPA+DHA/day — informational, not a per-nutrient DV.") },
  { key: "omega3DHA", name: "Omega-3 (DHA, 22:6 n-3)", unit: "g", group: "fattyAcid", fdcId: 1272,
    target: noTarget("No formal DRI for DHA alone. AHA/WHO population guidance suggests ~250–500mg "
      + "combined EPA+DHA/day — informational, not a per-nutrient DV.") },
  { key: "omega6LinoleicAcid", name: "Omega-6 (linoleic acid, 18:2 n-6)", unit: "g", group: "fattyAcid", fdcId: 1269,
    target: minTarget(17, "g", IOM_FATTY_ACID_AI, "female AI 12g/day") },

  // ── Amino acid profile (essential + the two conditionally-essential
  // aminos USDA reports individually) ──────────────────────────────────
  { key: "histidine", name: "Histidine", unit: "mg", group: "aminoAcid", fdcId: 1221,
    target: minTarget(aminoTargetMg(14), "mg", IOM_AMINO) },
  { key: "isoleucine", name: "Isoleucine", unit: "mg", group: "aminoAcid", fdcId: 1212,
    target: minTarget(aminoTargetMg(19), "mg", IOM_AMINO) },
  { key: "leucine", name: "Leucine", unit: "mg", group: "aminoAcid", fdcId: 1213,
    target: minTarget(aminoTargetMg(42), "mg", IOM_AMINO) },
  { key: "lysine", name: "Lysine", unit: "mg", group: "aminoAcid", fdcId: 1214,
    target: minTarget(aminoTargetMg(38), "mg", IOM_AMINO) },
  { key: "methionine", name: "Methionine", unit: "mg", group: "aminoAcid", fdcId: 1215,
    target: noTarget("IOM's DRI (19mg/kg/day) is defined for methionine + cysteine COMBINED, not "
      + "methionine alone — no individual DV exists to split it honestly.") },
  { key: "cystine", name: "Cystine", unit: "mg", group: "aminoAcid", fdcId: 1216,
    target: noTarget("Part of the combined methionine+cysteine DRI (19mg/kg/day) — see methionine.") },
  { key: "phenylalanine", name: "Phenylalanine", unit: "mg", group: "aminoAcid", fdcId: 1217,
    target: noTarget("IOM's DRI (33mg/kg/day) is defined for phenylalanine + tyrosine COMBINED, not "
      + "phenylalanine alone — no individual DV exists to split it honestly.") },
  { key: "tyrosine", name: "Tyrosine", unit: "mg", group: "aminoAcid", fdcId: 1218,
    target: noTarget("Part of the combined phenylalanine+tyrosine DRI (33mg/kg/day) — see phenylalanine.") },
  { key: "threonine", name: "Threonine", unit: "mg", group: "aminoAcid", fdcId: 1211,
    target: minTarget(aminoTargetMg(20), "mg", IOM_AMINO) },
  { key: "tryptophan", name: "Tryptophan", unit: "mg", group: "aminoAcid", fdcId: 1210,
    target: minTarget(aminoTargetMg(5), "mg", IOM_AMINO) },
  { key: "valine", name: "Valine", unit: "mg", group: "aminoAcid", fdcId: 1219,
    target: minTarget(aminoTargetMg(24), "mg", IOM_AMINO) },
];

const NUTRIENTS = Object.fromEntries(NUTRIENT_LIST.map((n) => [n.key, n]));

const NUTRIENT_KEYS = NUTRIENT_LIST.map((n) => n.key);

function getNutrient(key) {
  return NUTRIENTS[key] || null;
}

function nutrientsByGroup(group) {
  return NUTRIENT_LIST.filter((n) => n.group === group);
}

module.exports = {
  NUTRIENT_LIST,
  NUTRIENTS,
  NUTRIENT_KEYS,
  getNutrient,
  nutrientsByGroup,
  convertUnit,
};
